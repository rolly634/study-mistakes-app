import * as store from "./store.js";
import * as data from "./data.js";
import { buildStates, todayQueue, ymd, daysBetween, EXAMS } from "./srs.js";
import { rich, inline, escapeHTML as esc } from "./render.js";

export const VERSION = "0.3.0";
const SUBJECTS = ["数学", "物理", "英語", "電験"];
const MARK = { o: "○", d: "△", x: "×" };
const LAB = "ABCDE";

const $ = (s, el = document) => el.querySelector(s);
const view = $("#view");
const ui = { subject: null, kind: null, listMode: "subject", session: null };
const KIND_LABEL = { mistake: "誤答", inquiry: "調べもの" };
const kindOf = (p) => p.kind || "mistake";
let states = {};

// ---------- 共通 ----------
function toast(msg, ms = 2600) {
  const t = $("#toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.h);
  toast.h = setTimeout(() => { t.hidden = true; }, ms);
}

function recompute() {
  states = buildStates(data.state.events, data.state.byId);
}

function doneToday() {
  const today = ymd();
  return new Set(data.state.events.filter((e) => ymd(new Date(e.t)) === today).map((e) => e.id)).size;
}

function md(s) { // "2026-10-28" → "10/28"
  const [, m, d] = s.split("-");
  return `${Number(m)}/${Number(d)}`;
}

function setSync(text) { $("#sync").textContent = text; }

function syncLabel() {
  const s = store.settings();
  const n = data.state.pending.length;
  if (s.demo) return "見本モード";
  if (!s.token) return "未設定";
  if (n) return `未送信 ${n}`;
  return data.state.lastSync ? `同期 ${new Date(data.state.lastSync).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })}` : "";
}

function header(title, back = false) {
  $("#title").textContent = title;
  $("#back").hidden = !back;
  setSync(syncLabel());
}

function tab(name) {
  document.querySelectorAll(".tabs button").forEach((b) => b.classList.toggle("on", b.dataset.go === name));
}

function chips(items, current, onPick) {
  const wrap = document.createElement("div");
  wrap.className = "chips";
  for (const [val, label] of items) {
    const b = document.createElement("button");
    b.className = "chip" + (val === current ? " on" : "");
    b.textContent = label;
    b.onclick = () => onPick(val);
    wrap.append(b);
  }
  return wrap;
}

// 科目と種類の絞り込みを通した問題
function pool() {
  return data.state.problems.filter((p) => (!ui.subject || p.subject === ui.subject) && (!ui.kind || kindOf(p) === ui.kind));
}

function filterChips(rerender) {
  const box = document.createElement("div");
  box.append(chips([[null, "すべて"], ["mistake", "誤答"], ["inquiry", "調べもの"]], ui.kind, (v) => { ui.kind = v; rerender(); }));
  box.append(chips([[null, "全科目"], ...SUBJECTS.map((x) => [x, x])], ui.subject, (v) => { ui.subject = v; rerender(); }));
  return box;
}

function filterLabel() {
  return [ui.kind ? KIND_LABEL[ui.kind] : "", ui.subject || ""].filter(Boolean).join("・");
}

function noteHTML(n) {
  if (!n) return '<p class="note">ノートが見つかりません（同期してください）</p>';
  const pts = (n.points || []).map((x) => `<li>${inline(x)}</li>`).join("");
  const srcs = (n.sources || []).map((x) => `<li>${x.url ? `<a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.title)}</a>` : esc(x.title)}</li>`).join("");
  const ups = (n.updates || []).map((u) => `<div class="exp" style="margin-top:8px"><h4>追記 ${md(u.date)}：${esc(u.asked)}</h4>${rich(u.explanation)}</div>`).join("");
  return `<div class="asked">Q. ${esc(n.asked)}</div>
    <div class="q">${rich(n.explanation)}</div>
    <div class="nfigs" data-note="${esc(n.id)}"></div>
    ${pts ? `<div class="pt"><h4>要点</h4><ul>${pts}</ul></div>` : ""}
    ${ups}
    ${srcs ? `<div class="srcs"><h4>出典</h4><ul>${srcs}</ul></div>` : ""}`;
}

async function fillNoteFigures(el, n) {
  const box = el.querySelector(".nfigs");
  if (box && n?.figures?.length) box.innerHTML = await figuresHTML(n);
}

function srcText(p) {
  const s = p.source || {};
  return [s.book, s.number, s.page ? `p${s.page}` : "", s.detail].filter(Boolean).join(" ");
}

// ---------- 同期 ----------
let pushTimer;
function schedulePush() {
  clearTimeout(pushTimer);
  pushTimer = setTimeout(async () => {
    try {
      const n = await data.push();
      if (n) setSync(syncLabel());
    } catch (e) {
      setSync("未送信 " + data.state.pending.length);
      console.warn(e);
    }
  }, 1500);
}

async function sync({ quiet = false } = {}) {
  try {
    setSync("同期中…");
    const r = await data.pull((s) => setSync(s));
    recompute();
    if (!quiet) toast(`${r.problems}問を読み込みました` + (r.events ? `（履歴 ${r.events}件）` : ""));
  } catch (e) {
    if (!quiet) toast(errText(e), 4000);
    console.warn(e);
  }
  setSync(syncLabel());
}

function errText(e) {
  if (e.status === 401) return "トークンが無効です。設定を確認してください";
  if (e.status === 403) return "権限がありません（トークンの権限を確認）";
  if (e.status === 404) return "リポジトリまたはファイルが見つかりません";
  if (!navigator.onLine) return "オフラインです。端末内のデータで続けます";
  return e.message || String(e);
}

// ---------- ホーム ----------
function home() {
  ui.session = null;
  header("誤答トレーニング");
  tab("home");
  const s = store.settings();
  const ps = data.state.problems;
  view.innerHTML = "";

  if (!ps.length) {
    view.innerHTML = `
      <div class="card">
        <h3 style="margin-top:0">はじめに</h3>
        <p class="note">${s.token || s.demo ? "まだ問題がありません。右上の表示が「同期」になってから、もう一度開いてください。" : "設定で GitHub のトークンを入力すると、study-mistakes の問題を読み込みます。先に見本の問題で操作を試すこともできます。"}</p>
        ${s.token || s.demo ? '<button class="btn" id="pull">今すぐ同期</button>' : '<button class="btn" id="toSettings">設定を開く</button><button class="btn ghost" id="demo">見本で試す</button>'}
      </div>`;
    $("#pull")?.addEventListener("click", async () => { await sync(); home(); });
    $("#toSettings")?.addEventListener("click", () => go("settings"));
    $("#demo")?.addEventListener("click", async () => { store.saveSettings({ demo: true }); await data.loadLocal(); await sync(); home(); });
    return;
  }

  view.append(filterChips(home));
  const limit = Number(s.dailyLimit) || 20;
  const done = doneToday();
  const q = todayQueue(pool(), states, { limit, doneToday: done });
  const dueAll = todayQueue(pool(), states, { limit: 9999 }).length;
  const exam = ui.subject === "電験" ? ["電験", EXAMS.電験] : ["入試", EXAMS.入試];

  const hero = document.createElement("div");
  hero.className = "card hero";
  hero.innerHTML = `
    <div class="lbl">今日の復習${filterLabel() ? `（${filterLabel()}）` : ""}</div>
    <div class="big">${q.length}<small style="font-size:18px">問</small></div>
    <div class="lbl">今日解いた問題 ${done} ／ 上限 ${limit}${dueAll > q.length ? `　残り ${dueAll - q.length}問は明日以降` : ""}</div>
    <div class="lbl">${exam[0]}まで あと${daysBetween(ymd(), exam[1])}日</div>
    <button class="btn" id="start" ${q.length ? "" : "disabled"}>${q.length ? "始める" : "今日の分は終わりました"}</button>`;
  view.append(hero);
  $("#start").onclick = () => startSession(q, "今日の復習");

  const grid = document.createElement("div");
  grid.className = "subj";
  for (const sub of SUBJECTS) {
    const all = ps.filter((p) => p.subject === sub);
    const list = all.filter((p) => !ui.kind || kindOf(p) === ui.kind);
    const due = todayQueue(list, states, { limit: 9999 }).length;
    const weak = list.filter((p) => states[p.id]?.last === "x").length;
    const inq = all.filter((p) => kindOf(p) === "inquiry").length;
    const c = document.createElement("button");
    c.className = `card c-${sub}`;
    c.style.textAlign = "left";
    c.innerHTML = `<b>${sub}</b><span class="n">誤答 ${all.length - inq}・調べもの ${inq}<br>今日 ${due}問　直近× ${weak}問</span>`;
    c.onclick = () => { ui.subject = sub; ui.listMode = "subject"; go("list"); };
    grid.append(c);
  }
  view.append(grid);

  const foot = document.createElement("div");
  foot.className = "card";
  foot.style.marginTop = "12px";
  foot.innerHTML = `<div class="row"><button class="btn ghost" id="weak" style="margin:0">直近×だけ解く</button><button class="btn ghost" id="sync2" style="margin:0">同期</button></div>
    <p class="note" style="margin:8px 0 0">${s.demo ? "見本モードです。設定で解除できます。" : data.state.lastSync ? `最終同期 ${new Date(data.state.lastSync).toLocaleString("ja-JP")}` : ""}</p>`;
  view.append(foot);
  $("#weak").onclick = () => {
    const w = pool().filter((p) => states[p.id]?.last === "x");
    if (!w.length) return toast("直近で×の問題はありません");
    startSession(w, "直近×の復習");
  };
  $("#sync2").onclick = async () => { await sync(); home(); };
}

// ---------- 出題 ----------
function startSession(list, title) {
  ui.session = { list: [...list], i: 0, title, results: [] };
  go("review");
}

function shuffle(n) {
  const a = [...Array(n).keys()];
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

async function figuresHTML(p) {
  const out = [];
  for (const f of p.figures || []) {
    const url = await data.figureURL(f.file).catch(() => "");
    out.push(url ? `<div class="figs"><img src="${url}" alt="${esc(f.caption || "図")}"><div class="cap">${esc(f.caption || "")}</div></div>`
      : `<div class="figs note">図を読み込めませんでした（${esc(f.file)}）</div>`);
  }
  return out.join("");
}

async function card(p, { onDone, progress }) {
  view.innerHTML = "";
  const box = document.createElement("div");
  box.innerHTML = `
    ${progress ? `<div class="progress"><i style="width:${progress}%"></i></div>` : ""}
    <div class="card c-${p.subject}">
      <div class="meta">${kindOf(p) === "inquiry" ? '<span class="badge">調べもの</span>' : ""}<b>${p.subject}</b><span>${p.week}</span><span>${esc(srcText(p))}</span><span class="topic">${esc(p.topic)}</span></div>
      <div class="q">${rich(p.question)}</div>
      <div id="figs"></div>
      <div class="choices" id="choices"></div>
      <p style="text-align:center;margin:10px 0 0"><button class="chip" id="reveal">わからない（答えを見る）</button></p>
      <div id="answer"></div>
    </div>`;
  view.append(box);
  window.scrollTo(0, 0);
  $("#figs", box).innerHTML = await figuresHTML(p);

  // 電験は本番と同じく (1)〜(5) の元の順（数値が小さい順）。ほかの科目は毎回並べ替える
  const denken = p.subject === "電験";
  const order = denken ? [...p.choices.keys()] : shuffle(p.choices.length);
  const wrap = $("#choices", box);
  order.forEach((idx, pos) => {
    const b = document.createElement("button");
    b.className = "choice";
    b.dataset.idx = idx;
    b.innerHTML = `<span class="lab">${denken ? `(${pos + 1})` : LAB[pos]}</span>${inline(p.choices[idx])}`;
    b.onclick = () => answer(idx);
    wrap.append(b);
  });
  $("#reveal", box).onclick = () => answer(null);

  function answer(chosen) {
    const correct = chosen === p.answer;
    wrap.querySelectorAll(".choice").forEach((b) => {
      const i = Number(b.dataset.idx);
      b.disabled = true;
      if (i === p.answer) b.classList.add("ok");
      if (i === chosen && !correct) b.classList.add("ng");
      if (i === p.my_answer && i !== p.answer) b.classList.add("mine");
    });
    $("#reveal", box).parentElement.remove();
    const m = p.mistake || {};
    const inquiry = kindOf(p) === "inquiry";
    const note = inquiry ? data.state.notesById[p.note] : null;
    const tail = inquiry
      ? `<div class="pt"><div><b>覚えておくこと</b>　${inline(p.point || "")}</div></div>
         <div class="photo"><button class="chip" id="noteBtn">元の疑問と解説を読む${note ? `：${esc(note.title)}` : ""}</button><div id="noteBox" class="notebox" hidden></div></div>`
      : `<div class="mis"><div><b>${esc(m.type || "")} 前回の間違い</b>　${inline(m.what || "")}</div><div><b>防ぐには</b>　${inline(m.prevent || "")}</div></div>`;
    const a = $("#answer", box);
    a.className = "answer";
    a.innerHTML = `
      <div class="verdict ${correct ? "ok" : "ng"}">${chosen === null ? "答えを確認" : correct ? "正解" : "不正解"}</div>
      <div class="exp"><h4>解説</h4>${rich(p.explanation)}</div>
      ${tail}
      ${p.originals?.length && data.canSync() ? '<div class="photo"><button class="chip" id="photo">元の写真を見る</button><div id="photos"></div></div>' : ""}
      <div class="rate">
        <button class="o ${correct ? "hint" : ""}" data-r="o"><b>○</b><small>わかった</small></button>
        <button class="d" data-r="d"><b>△</b><small>あやしい</small></button>
        <button class="x ${correct ? "" : "hint"}" data-r="x"><b>×</b><small>わからない</small></button>
      </div>`;
    $("#noteBtn", a)?.addEventListener("click", async () => {
      const nb = $("#noteBox", a);
      nb.hidden = !nb.hidden;
      if (!nb.hidden && !nb.dataset.done) {
        nb.innerHTML = noteHTML(note);
        nb.dataset.done = "1";
        await fillNoteFigures(nb, note);
      }
    });
    $("#photo", a)?.addEventListener("click", async (ev) => {
      ev.target.disabled = true;
      try {
        for (const o of p.originals) {
          const img = document.createElement("img");
          img.src = await data.originalURL(o);
          $("#photos", a).append(img);
        }
      } catch (e) { toast(errText(e)); }
    });
    a.querySelectorAll(".rate button").forEach((b) => {
      b.onclick = async () => {
        a.querySelectorAll(".rate button").forEach((x) => { x.disabled = true; });
        await data.record(p.id, b.dataset.r, chosen, correct);
        recompute();
        schedulePush();
        setSync(syncLabel());
        onDone(b.dataset.r);
      };
    });
    a.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

function review() {
  const s = ui.session;
  if (!s) return go("home");
  tab("home");
  if (s.i >= s.list.length) return summary();
  header(`${s.title}　${s.i + 1}/${s.list.length}`, true);
  const p = s.list[s.i];
  card(p, {
    progress: (s.i / s.list.length) * 100,
    onDone: (r) => {
      s.results.push({ id: p.id, r });
      s.i += 1;
      review();
    },
  });
}

function summary() {
  const s = ui.session;
  header(s.title, false);
  const c = { o: 0, d: 0, x: 0 };
  s.results.forEach((x) => { c[x.r] += 1; });
  view.innerHTML = `
    <div class="card hero">
      <div class="lbl">おつかれさまでした</div>
      <div class="big">${s.results.length}<small style="font-size:18px">問</small></div>
      <div class="stat" style="margin-top:12px"><div><b style="color:var(--ok)">${c.o}</b><span>○</span></div><div><b style="color:var(--mid)">${c.d}</b><span>△</span></div><div><b style="color:var(--ng)">${c.x}</b><span>×</span></div><div><b>${data.state.pending.length}</b><span>未送信</span></div></div>
      <p class="note">×は明日、△は3日後にまた出ます。</p>
      <button class="btn" id="home">ホームへ</button>
    </div>`;
  $("#home").onclick = () => go("home");
  ui.session = null;
}

// 一覧から1問だけ解く
function single(id) {
  const p = data.state.byId[id];
  if (!p) return go("list");
  header(p.topic, true);
  tab("list");
  card(p, { onDone: () => history.back() });
}

// ---------- 一覧 ----------
function list() {
  header("一覧");
  tab("list");
  view.innerHTML = "";
  view.append(chips([["subject", "科目別"], ["week", "週別"], ["notes", "疑問ノート"]], ui.listMode, (v) => { ui.listMode = v; list(); }));
  if (ui.listMode === "notes") return noteList();
  view.append(filterChips(list));
  const ps = pool();
  if (!ps.length) {
    view.insertAdjacentHTML("beforeend", '<div class="empty">問題がありません</div>');
    return;
  }
  const groups = new Map();
  const wkNum = (w) => Number(w.slice(1));
  const sorted = [...ps].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.id < b.id ? -1 : 1));
  for (const p of sorted) {
    const k = ui.listMode === "subject" ? `${p.subject}｜${p.week}` : `${p.week}｜${p.subject}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(p);
  }
  const keys = [...groups.keys()].sort((a, b) => {
    const [a1, a2] = a.split("｜"); const [b1, b2] = b.split("｜");
    if (ui.listMode === "subject") return SUBJECTS.indexOf(a1) - SUBJECTS.indexOf(b1) || wkNum(b2) - wkNum(a2);
    return wkNum(b1) - wkNum(a1) || SUBJECTS.indexOf(a2) - SUBJECTS.indexOf(b2);
  });
  const wrap = document.createElement("div");
  wrap.className = "list";
  for (const k of keys) {
    const [a, b] = k.split("｜");
    wrap.insertAdjacentHTML("beforeend", `<h3>${ui.listMode === "subject" ? `${a}　${b}` : `${a}　${b}`}（${groups.get(k).length}問）</h3>`);
    for (const p of groups.get(k)) {
      const st = states[p.id];
      const it = document.createElement("button");
      it.className = `item c-${p.subject}`;
      it.innerHTML = `<span class="mark ${st ? st.last : "n"}">${st ? MARK[st.last] : "新"}</span>
        <span class="t"><b>${kindOf(p) === "inquiry" ? '<span class="badge">調</span>' : ""}${esc(p.topic)}</b><span>${esc(srcText(p))}　${md(p.date)}${st ? `　次回 ${md(st.due)}` : ""}</span></span>`;
      it.onclick = () => go("problem/" + p.id);
      wrap.append(it);
    }
  }
  view.append(wrap);
}

function noteList() {
  view.append(chips([[null, "全科目"], ...SUBJECTS.map((x) => [x, x])], ui.subject, (v) => { ui.subject = v; list(); }));
  const ns = data.state.notes.filter((n) => !ui.subject || n.subject === ui.subject)
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.id < b.id ? 1 : -1));
  if (!ns.length) {
    view.insertAdjacentHTML("beforeend", '<div class="empty">疑問ノートはまだありません。<br>チャットで質問すると、ここに増えていきます。</div>');
    return;
  }
  const wrap = document.createElement("div");
  wrap.className = "list";
  for (const n of ns) {
    const it = document.createElement("button");
    it.className = `item c-${n.subject}`;
    it.innerHTML = `<span class="mark n">疑</span><span class="t"><b>${esc(n.title)}</b><span>${n.subject}　${md(n.date)}　問題 ${n.problems.length}問</span></span>`;
    it.onclick = () => go("note/" + n.id);
    wrap.append(it);
  }
  view.append(wrap);
}

async function noteView(id) {
  const n = data.state.notesById[id];
  if (!n) return go("list");
  header(n.title, true);
  tab("list");
  view.innerHTML = `<div class="card c-${n.subject}">
      <div class="meta"><span class="badge">疑問</span><b>${n.subject}</b><span>${n.week}</span><span>${md(n.date)}</span></div>
      ${noteHTML(n)}
      ${n.originals?.length && data.canSync() ? '<div class="photo"><button class="chip" id="photo">質問の画像を見る</button><div id="photos"></div></div>' : ""}
    </div>
    <div class="list"><h3>このノートの問題（${n.problems.length}問）</h3></div>`;
  await fillNoteFigures(view, n);
  $("#photo")?.addEventListener("click", async (ev) => {
    ev.target.disabled = true;
    try {
      for (const o of n.originals) {
        const img = document.createElement("img");
        img.src = await data.originalURL(o);
        $("#photos").append(img);
      }
    } catch (e) { toast(errText(e)); }
  });
  const wrap = $(".list", view);
  for (const pid of n.problems) {
    const p = data.state.byId[pid];
    if (!p) continue;
    const st = states[p.id];
    const it = document.createElement("button");
    it.className = `item c-${p.subject}`;
    it.innerHTML = `<span class="mark ${st ? st.last : "n"}">${st ? MARK[st.last] : "新"}</span><span class="t"><b>${esc(p.topic)}</b><span>${st ? `次回 ${md(st.due)}` : "まだ解いていません"}</span></span>`;
    it.onclick = () => go("problem/" + p.id);
    wrap.append(it);
  }
}

// ---------- 設定 ----------
function settingsView() {
  header("設定");
  tab("settings");
  const s = store.settings();
  view.innerHTML = `
    <div class="card">
      <h3 style="margin-top:0">GitHub</h3>
      <label class="f">リポジトリ（所有者 / 名前）</label>
      <div class="row"><input class="f" id="owner" value="${esc(s.owner)}" autocapitalize="off"><input class="f" id="repo" value="${esc(s.repo)}" autocapitalize="off"></div>
      <label class="f">トークン（fine-grained、Contents の読み書き）</label>
      <input class="f" id="token" type="password" value="${esc(s.token)}" placeholder="github_pat_..." autocomplete="off">
      <p class="note">トークンはこの端末の中だけに保存します。</p>
      <label class="f">1日の上限（問）</label>
      <input class="f" id="limit" type="number" min="5" max="100" value="${esc(s.dailyLimit)}">
      <button class="btn" id="save">保存して接続を確認</button>
    </div>
    <div class="card">
      <h3 style="margin-top:0">データ</h3>
      <div class="stat five"><div><b>${data.state.problems.length}</b><span>問題</span></div><div><b>${data.state.notes.length}</b><span>ノート</span></div><div><b>${data.state.events.length}</b><span>解答履歴</span></div><div><b>${data.state.pending.length}</b><span>未送信</span></div><div><b>${store.deviceId()}</b><span>端末ID</span></div></div>
      <button class="btn ghost" id="pull">今すぐ同期</button>
      <button class="btn ghost" id="demo">${s.demo ? "見本モードを終える" : "見本モードで試す"}</button>
      <button class="btn ghost" id="reset" style="color:var(--ng);border-color:var(--ng)">端末内のデータを消す</button>
      <p class="note">消しても、GitHub に保存済みの解答履歴は次の同期で戻ります（未送信の分は消えます）。</p>
    </div>
    <p class="note" style="text-align:center">誤答トレーニング v${VERSION}</p>`;
  $("#save").onclick = async () => {
    const n = store.saveSettings({
      owner: $("#owner").value.trim(), repo: $("#repo").value.trim(), token: $("#token").value.trim(),
      dailyLimit: Math.max(5, Math.min(100, Number($("#limit").value) || 20)),
    });
    if (!n.token) return toast("保存しました");
    try {
      const { Repo } = await import("./github.js");
      const info = await new Repo(n).check();
      if (info.push === false) toast(`${info.name} に接続しました。ただし書き込み権限がありません`, 4500);
      else toast(`${info.name} に接続しました`);
      if (!n.demo) { await sync({ quiet: true }); }
    } catch (e) {
      toast(errText(e), 4500);
    }
    setSync(syncLabel());
  };
  $("#pull").onclick = async () => { await sync(); settingsView(); };
  $("#demo").onclick = async () => {
    store.saveSettings({ demo: !s.demo });
    await data.loadLocal();
    recompute();
    if (!s.demo) await sync({ quiet: true });
    go("home");
  };
  $("#reset").onclick = async () => {
    if (!window.confirm("端末内の問題・図・解答履歴を消します。よろしいですか？")) return;
    await data.resetLocal();
    recompute();
    toast("消しました");
    settingsView();
  };
}

// ---------- 画面遷移 ----------
function go(name) {
  if (location.hash.slice(1) === name) route();
  else location.hash = name;
}

function route() {
  const h = decodeURIComponent(location.hash.slice(1)) || "home";
  if (h === "home") home();
  else if (h === "list") list();
  else if (h === "settings") settingsView();
  else if (h === "review") review();
  else if (h.startsWith("problem/")) single(h.slice(8));
  else if (h.startsWith("note/")) noteView(h.slice(5));
  else home();
}

document.querySelectorAll(".tabs button").forEach((b) => { b.onclick = () => { ui.session = null; go(b.dataset.go); }; });
$("#back").onclick = () => {
  if (ui.session && !window.confirm("復習を中断しますか？（答えた分は保存済み）")) return;
  ui.session = null;
  if (location.hash.startsWith("#problem/") || location.hash.startsWith("#note/")) history.back();
  else go("home");
};
window.addEventListener("hashchange", route);
window.addEventListener("online", () => { schedulePush(); });

async function init() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
  // defer のライブラリを待つ
  while (!(window.katex && window.marked && window.DOMPurify)) await new Promise((r) => setTimeout(r, 20));
  await data.loadLocal();
  recompute();
  route();
  if (data.canSync() || store.settings().demo) {
    await sync({ quiet: true });
    if (!ui.session && !location.hash.startsWith("#problem/") && !location.hash.startsWith("#note/")) route();
  }
}

init();
