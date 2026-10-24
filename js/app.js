import * as store from "./store.js";
import * as data from "./data.js";
import * as supa from "./supa.js";
import * as tracker from "./tracker.js";
import { buildStates, todayQueue, ymd, daysBetween, EXAMS } from "./srs.js";
import { rich, inline, escapeHTML as esc } from "./render.js";

export const VERSION = "0.4.0";
const SUBJECTS = ["数学", "物理", "英語", "電験"];
const LAB = "ABCDE";
const STATUS = {
  teichaku: ["定着", "st-ok"],
  caution: ["要注意", "st-ng"],
  learning: ["学習中", "st-mid"],
};
const KIND_LABEL = { mistake: "誤答", inquiry: "調べもの" };
const NOTE_STATUS = { teichaku: "定着", fukushu: "復習中" };
const kindOf = (p) => p.kind || "mistake";

const $ = (s, el = document) => el.querySelector(s);
const view = $("#view");
const ui = { subject: null, kind: null, listMode: "subject", noteFilter: null, session: null, deck: null };
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
  states = buildStates(data.state.attempts, data.state.byId);
}

function doneToday() {
  const today = ymd();
  return new Set(data.state.attempts.filter((a) => ymd(new Date(a.at)) === today).map((a) => a.problem_id)).size;
}

function md(s) { // "2026-10-28" → "10/28"
  const [, m, d] = s.split("-");
  return `${Number(m)}/${Number(d)}`;
}

function setSync(text) { $("#sync").textContent = text; }

function syncLabel() {
  const s = store.settings();
  if (s.demo) return "見本モード";
  if (!s.token && !supa.user()) return "未設定";
  if (!supa.user()) return "未ログイン";
  if (data.state.ops.length) return `未送信 ${data.state.ops.length}`;
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

function srcText(p) {
  const s = p.source || {};
  return [s.book, s.number, s.page ? `p${s.page}` : "", s.detail].filter(Boolean).join(" ");
}

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

function statusPill(id) {
  const st = states[id];
  if (!st) return '<span class="pill st-new">新</span>';
  const [label, cls] = STATUS[st.status];
  return `<span class="pill ${cls}">${label}</span>`;
}

function star(type, id) {
  const on = data.isBookmarked(type, id);
  return `<button class="star ${on ? "on" : ""}" data-bm="${type}:${esc(id)}" aria-label="ブックマーク">${on ? "★" : "☆"}</button>`;
}

function wireStars(root) {
  root.querySelectorAll("[data-bm]").forEach((b) => {
    b.onclick = async (ev) => {
      ev.stopPropagation();
      const [type, ...rest] = b.dataset.bm.split(":");
      const on = await data.toggleBookmark(type, rest.join(":"));
      b.classList.toggle("on", on);
      b.textContent = on ? "★" : "☆";
      toast(on ? "ブックマークしました" : "ブックマークを外しました", 1500);
      schedulePush();
    };
  });
}

// ---------- 同期 ----------
let pushTimer;
function schedulePush() {
  setSync(syncLabel());
  clearTimeout(pushTimer);
  pushTimer = setTimeout(async () => {
    try {
      await data.flush();
    } catch (e) {
      console.warn(e);
    }
    setSync(syncLabel());
  }, 1200);
}

async function sync({ quiet = false } = {}) {
  try {
    setSync("同期中…");
    const r = await data.pull((s) => setSync(s));
    recompute();
    if (!quiet) toast(`${r.problems}問を読み込みました`);
  } catch (e) {
    if (!quiet) toast(errText(e), 4000);
    console.warn(e);
  }
  setSync(syncLabel());
}

function errText(e) {
  if (e.status === 401) return "認証が切れました。設定でトークン・ログインを確認してください";
  if (e.status === 403) return "権限がありません（トークンの権限を確認）";
  if (e.status === 404) return "リポジトリまたはファイルが見つかりません";
  if (!navigator.onLine) return "オフラインです。端末内のデータで続けます";
  return e.message || String(e);
}

// ---------- ホーム ----------
function waitingCard() {
  const w = data.state.waiting;
  if (!w.length) return null;
  const card = document.createElement("div");
  card.className = "card waiting";
  card.innerHTML = `
    <div class="wait-head"><b>📷 写真待ち ${w.length}件</b><button class="chip" id="dismissAll">まとめて確認</button></div>
    <p class="note" style="margin:2px 0 6px">×をつけた問題の写真を、チャットに送ってください。</p>
    <div class="wait-list">${w.map((x) => `
      <div class="wait-item"><span><b>${esc(x.label)}</b><small>${md(x.marked_on)}</small></span>
      <button class="chip" data-dismiss="${esc(x.mark_id)}">確認した</button></div>`).join("")}</div>`;
  card.querySelectorAll("[data-dismiss]").forEach((b) => {
    b.onclick = async () => { await data.dismissWaiting([b.dataset.dismiss]); schedulePush(); home(); };
  });
  $("#dismissAll", card).onclick = async () => {
    await data.dismissWaiting(w.map((x) => x.mark_id));
    schedulePush();
    toast(`${w.length}件を確認しました`);
    home();
  };
  return card;
}

function home() {
  tracker.stop();
  ui.session = null;
  header("誤答トレーニング");
  tab("home");
  const s = store.settings();
  const ps = data.state.problems;
  view.innerHTML = "";

  if (!ps.length) {
    const ready = s.demo || (s.token && supa.user());
    view.innerHTML = `
      <div class="card">
        <h3 style="margin-top:0">はじめに</h3>
        <p class="note">${ready ? "まだ問題がありません。右上が「同期」になってから、もう一度開いてください。"
          : "設定で GitHub のトークンを入力し、進捗管理アプリと同じアカウントでログインしてください。先に見本で操作を試すこともできます。"}</p>
        ${ready ? '<button class="btn" id="pull">今すぐ同期</button>' : '<button class="btn" id="toSettings">設定を開く</button><button class="btn ghost" id="demo">見本で試す</button>'}
      </div>`;
    $("#pull")?.addEventListener("click", async () => { await sync(); home(); });
    $("#toSettings")?.addEventListener("click", () => go("settings"));
    $("#demo")?.addEventListener("click", async () => { store.saveSettings({ demo: true }); await data.loadLocal(); await sync(); home(); });
    return;
  }

  const wc = waitingCard();
  if (wc) view.append(wc);
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
    const caution = list.filter((p) => states[p.id]?.status === "caution").length;
    const ok = list.filter((p) => states[p.id]?.status === "teichaku").length;
    const c = document.createElement("button");
    c.className = `card c-${sub}`;
    c.style.textAlign = "left";
    c.innerHTML = `<b>${sub}</b><span class="n">${list.length}問　今日 ${due}問<br>定着 ${ok}　要注意 ${caution}</span>`;
    c.onclick = () => { ui.subject = sub; ui.listMode = "subject"; go("list"); };
    grid.append(c);
  }
  view.append(grid);

  const bms = pool().filter((p) => data.isBookmarked("problem", p.id));
  const missed = pool().filter((p) => states[p.id]?.last === false);
  const foot = document.createElement("div");
  foot.className = "card";
  foot.style.marginTop = "12px";
  foot.innerHTML = `<div class="row"><button class="btn ghost" id="bm" style="margin:0">★ ブックマーク（${bms.length}）</button><button class="btn ghost" id="weak" style="margin:0">前回解けなかった（${missed.length}）</button></div>
    <div class="row" style="margin-top:8px"><button class="btn ghost" id="sort" style="margin:0">疑問ノートを仕分ける</button><button class="btn ghost" id="sync2" style="margin:0">同期</button></div>
    <p class="note" style="margin:8px 0 0">${s.demo ? "見本モードです。設定で解除できます。" : data.state.lastSync ? `最終同期 ${new Date(data.state.lastSync).toLocaleString("ja-JP")}` : ""}</p>`;
  view.append(foot);
  $("#bm").onclick = () => (bms.length ? startSession(bms, "ブックマーク") : toast("ブックマークした問題はありません"));
  $("#weak").onclick = () => (missed.length ? startSession(missed, "前回解けなかった問題") : toast("前回解けなかった問題はありません"));
  $("#sort").onclick = () => startDeck();
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

async function figuresHTML(x) {
  const out = [];
  for (const f of x.figures || []) {
    const url = await data.figureURL(f.file).catch(() => "");
    out.push(url ? `<div class="figs"><img src="${url}" alt="${esc(f.caption || "図")}"><div class="cap">${esc(f.caption || "")}</div></div>`
      : `<div class="figs note">図を読み込めませんでした（${esc(f.file)}）</div>`);
  }
  return out.join("");
}

function noteHTML(n) {
  if (!n) return '<p class="note">ノートが見つかりません（同期してください）</p>';
  const pts = (n.points || []).map((x) => `<li>${inline(x)}</li>`).join("");
  const srcs = (n.sources || []).map((x) => `<li>${x.url ? `<a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.title)}</a>` : esc(x.title)}</li>`).join("");
  const ups = (n.updates || []).map((u) => `<div class="exp" style="margin-top:8px"><h4>追記 ${md(u.date)}：${esc(u.asked)}</h4>${rich(u.explanation)}</div>`).join("");
  return `<div class="asked">Q. ${esc(n.asked)}</div>
    <div class="q">${rich(n.explanation)}</div>
    <div class="nfigs"></div>
    ${pts ? `<div class="pt"><h4>要点</h4><ul>${pts}</ul></div>` : ""}
    ${ups}
    ${srcs ? `<div class="srcs"><h4>出典</h4><ul>${srcs}</ul></div>` : ""}`;
}

async function fillNoteFigures(el, n) {
  const box = el.querySelector(".nfigs");
  if (box && n?.figures?.length) box.innerHTML = await figuresHTML(n);
}

async function showPhotos(btn, box, paths) {
  btn.disabled = true;
  try {
    for (const o of paths) {
      const img = document.createElement("img");
      img.src = await data.originalURL(o);
      box.append(img);
    }
  } catch (e) { toast(errText(e)); }
}

async function card(p, { onNext, progress, nextLabel = "次へ" }) {
  view.innerHTML = "";
  const box = document.createElement("div");
  const inquiry = kindOf(p) === "inquiry";
  box.innerHTML = `
    ${progress != null ? `<div class="progress"><i style="width:${progress}%"></i></div>` : ""}
    <div class="card c-${p.subject}">
      <div class="meta">${inquiry ? '<span class="badge">調べもの</span>' : ""}<b>${p.subject}</b><span>${p.week}</span><span>${esc(srcText(p))}</span><span class="topic">${esc(p.topic)}</span>${statusPill(p.id)}${star("problem", p.id)}</div>
      <div class="q">${rich(p.question)}</div>
      <div id="figs"></div>
      <div class="choices" id="choices"></div>
      <p style="text-align:center;margin:10px 0 0"><button class="chip" id="reveal">わからない（答えを見る）</button></p>
      <div id="answer"></div>
    </div>`;
  view.append(box);
  wireStars(box);
  window.scrollTo(0, 0);
  $("#figs", box).innerHTML = await figuresHTML(p);

  // 電験は本番と同じく (1)〜(5) の元の順。ほかの科目は毎回並べ替える
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

  // 選んだ時点で自動で「解けた／解けなかった」を記録する
  async function answer(chosen) {
    tracker.touch();
    const solved = chosen === p.answer;
    wrap.querySelectorAll(".choice").forEach((b) => {
      const i = Number(b.dataset.idx);
      b.disabled = true;
      if (i === p.answer) b.classList.add("ok");
      if (i === chosen && !solved) b.classList.add("ng");
      if (i === p.my_answer && i !== p.answer) b.classList.add("mine");
    });
    $("#reveal", box).parentElement.remove();
    await data.recordAttempt(p.id, solved, chosen);
    recompute();
    schedulePush();
    const st = states[p.id];
    const m = p.mistake || {};
    const note = inquiry ? data.state.notesById[p.note] : null;
    const tail = inquiry
      ? `<div class="pt"><div><b>覚えておくこと</b>　${inline(p.point || "")}</div></div>
         <div class="photo"><button class="chip" id="noteBtn">元の疑問と解説を読む${note ? `：${esc(note.title)}` : ""}</button><div id="noteBox" class="notebox" hidden></div></div>`
      : `<div class="mis"><div><b>${esc(m.type || "")} 前回の間違い</b>　${inline(m.what || "")}</div><div><b>防ぐには</b>　${inline(m.prevent || "")}</div></div>`;
    const nextDays = st ? daysBetween(ymd(), st.due) : 0;
    const a = $("#answer", box);
    a.className = "answer";
    a.innerHTML = `
      <div class="verdict ${solved ? "ok" : "ng"}">${solved ? "解けた" : "解けなかった"}
        <small>${st?.status === "teichaku" ? "定着（2回続けて解けた）　" : st?.status === "caution" ? "要注意（2回続けて解けなかった）　" : ""}次は${nextDays <= 1 ? "明日" : `${nextDays}日後`}</small></div>
      <div class="exp"><h4>解説</h4>${rich(p.explanation)}</div>
      ${tail}
      ${p.originals?.length && data.canGitHub() ? '<div class="photo"><button class="chip" id="photo">元の写真を見る</button><div id="photos"></div></div>' : ""}
      <div class="next"><button class="btn" id="next">${nextLabel}</button></div>`;
    $("#noteBtn", a)?.addEventListener("click", async () => {
      const nb = $("#noteBox", a);
      nb.hidden = !nb.hidden;
      if (!nb.hidden && !nb.dataset.done) {
        nb.innerHTML = noteHTML(note);
        nb.dataset.done = "1";
        await fillNoteFigures(nb, note);
      }
    });
    $("#photo", a)?.addEventListener("click", (ev) => showPhotos(ev.target, $("#photos", a), p.originals));
    $("#next", a).onclick = () => onNext(solved);
    a.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

function review() {
  const s = ui.session;
  if (!s) return go("home");
  tab("home");
  if (s.i >= s.list.length) return summary();
  header(`${s.title}　${s.i + 1}/${s.list.length}`, true);
  tracker.touch();
  const p = s.list[s.i];
  card(p, {
    progress: (s.i / s.list.length) * 100,
    nextLabel: s.i + 1 >= s.list.length ? "おわり" : "次へ",
    onNext: (solved) => {
      s.results.push({ id: p.id, solved });
      s.i += 1;
      review();
    },
  });
}

function summary() {
  const s = ui.session;
  tracker.stop();
  header(s.title, false);
  const ok = s.results.filter((x) => x.solved).length;
  const ng = s.results.length - ok;
  view.innerHTML = `
    <div class="card hero">
      <div class="lbl">おつかれさまでした</div>
      <div class="big">${s.results.length}<small style="font-size:18px">問</small></div>
      <div class="stat" style="margin-top:12px"><div><b style="color:var(--ok)">${ok}</b><span>解けた</span></div><div><b style="color:var(--ng)">${ng}</b><span>解けなかった</span></div><div><b>${data.state.ops.length}</b><span>未送信</span></div></div>
      <p class="note">解けなかった問題は明日、解けた問題は1週間後（続けて解けるたびに倍）にまた出ます。</p>
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
  tracker.touch();
  card(p, { nextLabel: "一覧に戻る", onNext: () => history.back() });
}

// ---------- 一覧 ----------
function list() {
  tracker.stop();
  header("一覧");
  tab("list");
  view.innerHTML = "";
  view.append(chips([["subject", "科目別"], ["week", "週別"], ["bookmark", "★"], ["notes", "疑問ノート"]], ui.listMode, (v) => { ui.listMode = v; list(); }));
  if (ui.listMode === "notes") return noteList();
  view.append(filterChips(list));
  let ps = pool();
  if (ui.listMode === "bookmark") ps = ps.filter((p) => data.isBookmarked("problem", p.id));
  if (!ps.length) {
    view.insertAdjacentHTML("beforeend", `<div class="empty">${ui.listMode === "bookmark" ? "ブックマークした問題はありません。<br>問題の ☆ を押すと追加できます。" : "問題がありません"}</div>`);
    return;
  }
  const groups = new Map();
  const wkNum = (w) => Number(w.slice(1));
  const sorted = [...ps].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.id < b.id ? -1 : 1));
  const byWeek = ui.listMode === "week";
  for (const p of sorted) {
    const k = byWeek ? `${p.week}｜${p.subject}` : `${p.subject}｜${p.week}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(p);
  }
  const keys = [...groups.keys()].sort((a, b) => {
    const [a1, a2] = a.split("｜"); const [b1, b2] = b.split("｜");
    if (!byWeek) return SUBJECTS.indexOf(a1) - SUBJECTS.indexOf(b1) || wkNum(b2) - wkNum(a2);
    return wkNum(b1) - wkNum(a1) || SUBJECTS.indexOf(a2) - SUBJECTS.indexOf(b2);
  });
  const wrap = document.createElement("div");
  wrap.className = "list";
  for (const k of keys) {
    const [a, b] = k.split("｜");
    wrap.insertAdjacentHTML("beforeend", `<h3>${a}　${b}（${groups.get(k).length}問）</h3>`);
    for (const p of groups.get(k)) {
      const st = states[p.id];
      const it = document.createElement("div");
      it.className = `item c-${p.subject}`;
      it.innerHTML = `${statusPill(p.id)}
        <span class="t"><b>${kindOf(p) === "inquiry" ? '<span class="badge">調</span>' : ""}${esc(p.topic)}</b><span>${esc(srcText(p))}　${md(p.date)}${st ? `　次回 ${md(st.due)}` : ""}</span></span>${star("problem", p.id)}`;
      it.onclick = () => go("problem/" + p.id);
      wrap.append(it);
    }
  }
  view.append(wrap);
  wireStars(wrap);
}

function noteList() {
  view.append(chips([[null, "すべて"], ["fukushu", "復習中"], ["teichaku", "定着"], ["bookmark", "★"]], ui.noteFilter, (v) => { ui.noteFilter = v; list(); }));
  view.append(chips([[null, "全科目"], ...SUBJECTS.map((x) => [x, x])], ui.subject, (v) => { ui.subject = v; list(); }));
  const f = ui.noteFilter;
  const ns = data.state.notes
    .filter((n) => !ui.subject || n.subject === ui.subject)
    .filter((n) => !f || (f === "bookmark" ? data.isBookmarked("note", n.id) : f === "teichaku" ? data.state.noteStatus[n.id] === "teichaku" : data.state.noteStatus[n.id] !== "teichaku"))
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.id < b.id ? 1 : -1));
  const toSort = deckNotes().length;
  view.insertAdjacentHTML("beforeend", `<button class="btn" id="sortBtn" ${toSort ? "" : "disabled"} style="margin:0 0 12px">${toSort ? `仕分ける（${toSort}枚）` : "仕分けるノートはありません"}</button>`);
  $("#sortBtn").onclick = () => startDeck();
  if (!ns.length) {
    view.insertAdjacentHTML("beforeend", '<div class="empty">疑問ノートはありません。<br>チャットで質問すると、ここに増えていきます。</div>');
    return;
  }
  const wrap = document.createElement("div");
  wrap.className = "list";
  for (const n of ns) {
    const st = data.state.noteStatus[n.id];
    const it = document.createElement("div");
    it.className = `item c-${n.subject}`;
    it.innerHTML = `<span class="pill ${st === "teichaku" ? "st-ok" : st ? "st-mid" : "st-new"}">${st ? NOTE_STATUS[st] : "未"}</span><span class="t"><b>${esc(n.title)}</b><span>${n.subject}　${md(n.date)}　問題 ${n.problems.length}問</span></span>${star("note", n.id)}`;
    it.onclick = () => go("note/" + n.id);
    wrap.append(it);
  }
  view.append(wrap);
  wireStars(wrap);
}

async function noteView(id) {
  const n = data.state.notesById[id];
  if (!n) return go("list");
  header(n.title, true);
  tab("list");
  tracker.touch();
  const st = data.state.noteStatus[n.id];
  view.innerHTML = `<div class="card c-${n.subject}">
      <div class="meta"><span class="badge">疑問</span><b>${n.subject}</b><span>${n.week}</span><span>${md(n.date)}</span>${star("note", n.id)}</div>
      ${noteHTML(n)}
      ${n.originals?.length && data.canGitHub() ? '<div class="photo"><button class="chip" id="photo">質問の画像を見る</button><div id="photos"></div></div>' : ""}
      <div class="row" style="margin-top:12px"><button class="btn ${st === "fukushu" ? "" : "ghost"}" id="toF" style="margin:0">復習中</button><button class="btn ${st === "teichaku" ? "" : "ghost"}" id="toT" style="margin:0">定着</button></div>
    </div>
    <div class="list"><h3>このノートの問題（${n.problems.length}問）</h3></div>`;
  wireStars(view);
  await fillNoteFigures(view, n);
  $("#photo")?.addEventListener("click", (ev) => showPhotos(ev.target, $("#photos"), n.originals));
  const setSt = async (s) => { await data.setNoteStatus(n.id, s); schedulePush(); noteView(id); };
  $("#toF").onclick = () => setSt("fukushu");
  $("#toT").onclick = () => setSt("teichaku");
  const wrap = $(".list", view);
  for (const pid of n.problems) {
    const p = data.state.byId[pid];
    if (!p) continue;
    const s = states[p.id];
    const it = document.createElement("div");
    it.className = `item c-${p.subject}`;
    it.innerHTML = `${statusPill(p.id)}<span class="t"><b>${esc(p.topic)}</b><span>${s ? `次回 ${md(s.due)}` : "まだ解いていません"}</span></span>${star("problem", p.id)}`;
    it.onclick = () => go("problem/" + p.id);
    wrap.append(it);
  }
  wireStars(wrap);
}

// ---------- 疑問ノートの仕分け（右スワイプ＝定着、左スワイプ＝復習中） ----------
function deckNotes() {
  return data.state.notes
    .filter((n) => !ui.subject || n.subject === ui.subject)
    .filter((n) => data.state.noteStatus[n.id] !== "teichaku")
    .sort((a, b) => (a.date < b.date ? -1 : 1));
}

function startDeck() {
  const list = deckNotes();
  if (!list.length) return toast("仕分けるノートはありません");
  ui.deck = { list, i: 0, ok: 0, keep: 0 };
  go("sort");
}

async function deck() {
  const d = ui.deck;
  if (!d) return go("list");
  tab("list");
  if (d.i >= d.list.length) {
    header("仕分け", false);
    tracker.stop();
    view.innerHTML = `<div class="card hero"><div class="lbl">仕分けが終わりました</div>
      <div class="stat" style="margin-top:12px"><div><b style="color:var(--ok)">${d.ok}</b><span>定着</span></div><div><b style="color:var(--mid)">${d.keep}</b><span>復習中</span></div></div>
      <p class="note">復習中のノートは、次の仕分けにもまた出ます。</p><button class="btn" id="home">ホームへ</button></div>`;
    $("#home").onclick = () => { ui.deck = null; go("home"); };
    return;
  }
  tracker.touch();
  header(`仕分け　${d.i + 1}/${d.list.length}`, true);
  const n = d.list[d.i];
  view.innerHTML = `
    <p class="swipe-hint"><span>← 復習中</span><span>定着 →</span></p>
    <div class="swipe-card card c-${n.subject}" id="sw">
      <div class="meta"><span class="badge">疑問</span><b>${n.subject}</b><span>${md(n.date)}</span><span class="topic">${esc(n.title)}</span>${star("note", n.id)}</div>
      ${noteHTML(n)}
      <div class="stamp stamp-ok">定着</div><div class="stamp stamp-keep">復習中</div>
    </div>
    <div class="row swipe-btns"><button class="btn ghost" id="keep">← 復習中</button><button class="btn" id="ok">定着 →</button></div>`;
  wireStars(view);
  await fillNoteFigures(view, n);
  const el = $("#sw");
  let decided = false;
  const decide = async (status) => {
    if (decided) return;
    decided = true;
    el.classList.add(status === "teichaku" ? "fly-right" : "fly-left");
    await data.setNoteStatus(n.id, status);
    schedulePush();
    if (status === "teichaku") d.ok += 1; else d.keep += 1;
    d.i += 1;
    setTimeout(deck, 220);
  };
  $("#ok").onclick = () => decide("teichaku");
  $("#keep").onclick = () => decide("fukushu");

  // スワイプ（横に 90px 以上動かしたら決定）
  let x0 = null, y0 = null, dx = 0, dragging = false;
  el.addEventListener("pointerdown", (e) => { if (e.target.closest("button,a")) return; x0 = e.clientX; y0 = e.clientY; dx = 0; dragging = false; });
  el.addEventListener("pointermove", (e) => {
    if (x0 === null) return;
    dx = e.clientX - x0;
    const dy = e.clientY - y0;
    if (!dragging && Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy)) { dragging = true; el.setPointerCapture?.(e.pointerId); }
    if (dragging) {
      el.style.transform = `translateX(${dx}px) rotate(${dx / 30}deg)`;
      el.classList.toggle("lean-right", dx > 40);
      el.classList.toggle("lean-left", dx < -40);
    }
  });
  const end = () => {
    if (x0 === null) return;
    x0 = null;
    if (dragging && Math.abs(dx) >= 90) decide(dx > 0 ? "teichaku" : "fukushu");
    else { el.style.transform = ""; el.classList.remove("lean-right", "lean-left"); }
    dragging = false;
  };
  el.addEventListener("pointerup", end);
  el.addEventListener("pointercancel", end);
}

// ---------- 設定 ----------
function settingsView() {
  tracker.stop();
  header("設定");
  tab("settings");
  const s = store.settings();
  const u = supa.user();
  view.innerHTML = `
    <div class="card">
      <h3 style="margin-top:0">進捗管理アプリと連携（ログイン）</h3>
      ${u ? `<p>ログイン中：<b>${esc(u.email || "")}</b></p>
        <p class="note">解いた記録・ブックマーク・ノートの仕分け・写真待ち・復習時間を、進捗管理アプリと共有しています。</p>
        <button class="btn ghost" id="logout">ログアウト</button>`
      : `<p class="note">進捗管理アプリと同じメールアドレスとパスワードでログインします（最初の1回だけ）。</p>
        <label class="f">メールアドレス</label><input class="f" id="email" type="email" autocomplete="username" autocapitalize="off">
        <label class="f">パスワード</label><input class="f" id="pw" type="password" autocomplete="current-password">
        <button class="btn" id="login">ログイン</button>`}
    </div>
    <div class="card">
      <h3 style="margin-top:0">問題の読み込み（GitHub）</h3>
      <label class="f">リポジトリ（所有者 / 名前）</label>
      <div class="row"><input class="f" id="owner" value="${esc(s.owner)}" autocapitalize="off"><input class="f" id="repo" value="${esc(s.repo)}" autocapitalize="off"></div>
      <label class="f">トークン（fine-grained、Contents の読み取り）</label>
      <input class="f" id="token" type="password" value="${esc(s.token)}" placeholder="github_pat_..." autocomplete="off">
      <p class="note">トークンはこの端末の中だけに保存します。</p>
      <label class="f">1日の上限（問）</label>
      <input class="f" id="limit" type="number" min="5" max="100" value="${esc(s.dailyLimit)}">
      <button class="btn" id="save">保存して接続を確認</button>
    </div>
    <div class="card">
      <h3 style="margin-top:0">データ</h3>
      <div class="stat five"><div><b>${data.state.problems.length}</b><span>問題</span></div><div><b>${data.state.notes.length}</b><span>ノート</span></div><div><b>${data.state.attempts.length}</b><span>記録</span></div><div><b>${data.state.ops.length}</b><span>未送信</span></div><div><b>${store.deviceId()}</b><span>端末ID</span></div></div>
      <button class="btn ghost" id="pull">今すぐ同期</button>
      <button class="btn ghost" id="demo">${s.demo ? "見本モードを終える" : "見本モードで試す"}</button>
      <button class="btn ghost" id="reset" style="color:var(--ng);border-color:var(--ng)">端末内のデータを消す</button>
      <p class="note">消しても、送信済みの記録は次の同期で戻ります（未送信の分は消えます）。</p>
    </div>
    <p class="note" style="text-align:center">誤答トレーニング v${VERSION}</p>`;
  $("#login")?.addEventListener("click", async () => {
    try {
      await supa.signIn($("#email").value.trim(), $("#pw").value);
      toast("ログインしました");
      await sync({ quiet: true });
      settingsView();
    } catch (e) {
      toast(e.status === 400 ? "メールアドレスかパスワードが違います" : errText(e), 4000);
    }
  });
  $("#logout")?.addEventListener("click", async () => {
    if (data.state.ops.length && !window.confirm(`未送信の記録が ${data.state.ops.length}件あります。ログアウトすると送れなくなります。よろしいですか？`)) return;
    await supa.signOut();
    toast("ログアウトしました");
    settingsView();
  });
  $("#save").onclick = async () => {
    const n = store.saveSettings({
      owner: $("#owner").value.trim(), repo: $("#repo").value.trim(), token: $("#token").value.trim(),
      dailyLimit: Math.max(5, Math.min(100, Number($("#limit").value) || 20)),
    });
    if (!n.token) return toast("保存しました");
    try {
      const { Repo } = await import("./github.js");
      const info = await new Repo(n).check();
      toast(`${info.name} に接続しました`);
      if (!n.demo) await sync({ quiet: true });
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
    if (!window.confirm("端末内の問題・図・記録を消します。よろしいですか？")) return;
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
  else if (h === "sort") deck();
  else if (h.startsWith("problem/")) single(h.slice(8));
  else if (h.startsWith("note/")) noteView(h.slice(5));
  else home();
}

const ACTIVE = /^#(review|sort|problem\/|note\/)/;
document.querySelectorAll(".tabs button").forEach((b) => { b.onclick = () => { ui.session = null; ui.deck = null; go(b.dataset.go); }; });
$("#back").onclick = () => {
  if (ui.session && !window.confirm("復習を中断しますか？（答えた分は保存済み）")) return;
  ui.session = null;
  if (/^#(problem|note)\//.test(location.hash)) history.back();
  else { ui.deck = null; go(location.hash === "#sort" ? "list" : "home"); }
};
window.addEventListener("hashchange", route);
window.addEventListener("online", () => schedulePush());
// 活動中の画面（出題・ノート・仕分け）での操作を復習時間として数える
for (const ev of ["pointerdown", "keydown"]) {
  document.addEventListener(ev, () => { if (ACTIVE.test(location.hash)) tracker.touch(); }, { passive: true });
}
let scrollT = 0;
window.addEventListener("scroll", () => {
  const now = Date.now();
  if (now - scrollT > 15000 && ACTIVE.test(location.hash)) { scrollT = now; tracker.touch(); }
}, { passive: true });

async function init() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
  while (!(window.katex && window.marked && window.DOMPurify)) await new Promise((r) => setTimeout(r, 20));
  await data.loadLocal();
  tracker.init(async (start, end) => {
    if (store.settings().demo) return;
    await data.recordSession(start, end);
    schedulePush();
  });
  recompute();
  route();
  const s = store.settings();
  if (s.demo || data.canGitHub() || supa.user()) {
    await sync({ quiet: true });
    if (!ui.session && !ui.deck && !/^#(problem|note)\//.test(location.hash)) route();
  }
}

init();
