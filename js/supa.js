// Supabase（進捗管理アプリと共有）への最小限のクライアント。ライブラリを使わず fetch だけで書く。
// ログインはメール＋パスワード。セッションはこの端末の localStorage に保存する（進捗管理アプリとは別のセッション）。

export const SUPABASE_URL = "https://yxqsdfskxwjimgypdudk.supabase.co";
export const SUPABASE_KEY = "sb_publishable_V7WokErFL8NYfiglYlmHSQ_PbU-nxKH"; // ブラウザ用の公開キー
const KEY = "supa-session";

export class SupaError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function load() {
  try { return JSON.parse(localStorage.getItem(KEY) || "null"); } catch { return null; }
}
function save(s) {
  try {
    if (s) localStorage.setItem(KEY, JSON.stringify(s));
    else localStorage.removeItem(KEY);
  } catch { /* 保存できない環境 */ }
}

let session = load();

export function user() {
  return session?.user ? { id: session.user.id, email: session.user.email } : null;
}

async function authCall(grant, body) {
  const r = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=${grant}`, {
    method: "POST",
    headers: { apikey: SUPABASE_KEY, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new SupaError(r.status, j.error_description || j.msg || j.message || r.statusText);
  session = {
    access_token: j.access_token,
    refresh_token: j.refresh_token,
    expires_at: j.expires_at || Math.floor(Date.now() / 1000) + (j.expires_in || 3600),
    user: { id: j.user?.id, email: j.user?.email },
  };
  save(session);
  return user();
}

export function signIn(email, password) {
  return authCall("password", { email, password });
}

export async function signOut() {
  const t = session?.access_token;
  session = null;
  save(null);
  if (t) {
    fetch(`${SUPABASE_URL}/auth/v1/logout`, { method: "POST", headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${t}` } }).catch(() => {});
  }
}

let refreshing = null;
async function token() {
  if (!session) throw new SupaError(401, "ログインしていません");
  if (session.expires_at - 60 > Date.now() / 1000) return session.access_token;
  if (!refreshing) {
    refreshing = authCall("refresh_token", { refresh_token: session.refresh_token })
      .catch((e) => {
        if (e.status === 400 || e.status === 401) { session = null; save(null); }
        throw e;
      })
      .finally(() => { refreshing = null; });
  }
  await refreshing;
  return session.access_token;
}

// REST（PostgREST）。path 例："attempts?select=*&order=at"
export async function rest(path, { method = "GET", body, prefer } = {}) {
  const t = await token();
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${t}`,
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(prefer ? { Prefer: prefer } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    throw new SupaError(r.status, j.message || r.statusText);
  }
  const text = await r.text();
  return text ? JSON.parse(text) : null;
}

// Storage（非公開バケット）のファイルを取得する。path 例："figures/x.svg"
export async function object(bucket, path) {
  const t = await token();
  const r = await fetch(`${SUPABASE_URL}/storage/v1/object/authenticated/${bucket}/${path.split("/").map(encodeURIComponent).join("/")}`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${t}` },
  });
  if (!r.ok) throw new SupaError(r.status, `取得できません（${path}）`);
  return r;
}
