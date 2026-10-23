// IndexedDB の簡単なキー・値ストアと、端末ごとの設定（localStorage）

const DB = "study-mistakes";
let dbp;

function db() {
  if (!dbp) {
    dbp = new Promise((res, rej) => {
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => r.result.createObjectStore("kv");
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }
  return dbp;
}

export async function get(key, fallback = undefined) {
  const d = await db();
  return new Promise((res, rej) => {
    const r = d.transaction("kv").objectStore("kv").get(key);
    r.onsuccess = () => res(r.result === undefined ? fallback : r.result);
    r.onerror = () => rej(r.error);
  });
}

export async function set(key, value) {
  const d = await db();
  return new Promise((res, rej) => {
    const t = d.transaction("kv", "readwrite");
    t.objectStore("kv").put(value, key);
    t.oncomplete = () => res();
    t.onerror = () => rej(t.error);
  });
}

export async function clearAll() {
  const d = await db();
  return new Promise((res, rej) => {
    const t = d.transaction("kv", "readwrite");
    t.objectStore("kv").clear();
    t.oncomplete = () => res();
    t.onerror = () => rej(t.error);
  });
}

// ---- 設定（この端末だけ） ----
const DEFAULTS = {
  owner: "rolly634",
  repo: "study-mistakes",
  token: "",
  dailyLimit: 20,
  demo: false,
};

function safeLS(fn, fb) {
  try { return fn(); } catch { return fb; }
}

export function settings() {
  const s = safeLS(() => JSON.parse(localStorage.getItem("settings") || "{}"), {});
  return { ...DEFAULTS, ...s };
}

export function saveSettings(patch) {
  const s = { ...settings(), ...patch };
  safeLS(() => localStorage.setItem("settings", JSON.stringify(s)));
  return s;
}

export function deviceId() {
  let id = safeLS(() => localStorage.getItem("device"), null);
  if (!id) {
    id = Math.random().toString(36).slice(2, 6);
    safeLS(() => localStorage.setItem("device", id));
  }
  return id;
}
