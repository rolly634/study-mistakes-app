// 問題・図は GitHub（study-mistakes）から、解いた記録・ブックマーク・ノートの仕分け・写真待ちは
// Supabase（進捗管理アプリと共有）でやりとりする。どちらも端末内（IndexedDB）に保存し、オフラインでも動く。
// 変更は「操作」として ops に積み、ログイン中・オンラインのときに Supabase へ送る。

import * as store from "./store.js";
import * as supa from "./supa.js";
import { Repo } from "./github.js";

export const state = {
  problems: [],
  byId: {},
  notes: [],        // 疑問ノート
  notesById: {},
  attempts: [],     // 解いた記録 {id, problem_id, solved, chosen, parts, at, device}
  bookmarks: {},    // { "problem:<id>" / "note:<id>": true }
  noteStatus: {},   // { note_id: "teichaku" | "fukushu" }
  waiting: [],      // 写真待ち {mark_id, item_id, label, subject, marked_on}
  ops: [],          // まだ送っていない操作
  lastSync: null,
};

const demo = () => store.settings().demo;
const ns = () => (demo() ? "demo:" : "");

function repo() {
  return new Repo(store.settings());
}

export function canGitHub() {
  const s = store.settings();
  return !s.demo && !!s.token && !!s.owner && !!s.repo;
}

export function canSupa() {
  return !demo() && !!supa.user();
}

export function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) =>
    (c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16));
}

function setProblems(list, notes = []) {
  state.problems = list;
  state.byId = Object.fromEntries(list.map((p) => [p.id, p]));
  state.notes = notes;
  state.notesById = Object.fromEntries(notes.map((n) => [n.id, n]));
}

function allFigures(j) {
  return [...j.problems, ...(j.notes || [])].flatMap((x) => x.figures || []);
}

export async function loadLocal() {
  const n = ns();
  setProblems(await store.get(n + "problems", []), await store.get(n + "notes", []));
  state.attempts = await store.get(n + "attempts", []);
  state.bookmarks = await store.get(n + "bookmarks", {});
  state.noteStatus = await store.get(n + "noteStatus", {});
  state.waiting = await store.get(n + "waiting", []);
  state.ops = await store.get(n + "ops", []);
  state.lastSync = await store.get(n + "lastSync", null);
}

async function save() {
  const n = ns();
  await store.set(n + "attempts", state.attempts);
  await store.set(n + "bookmarks", state.bookmarks);
  await store.set(n + "noteStatus", state.noteStatus);
  await store.set(n + "waiting", state.waiting);
  await store.set(n + "ops", state.ops);
}

// ---------- 取得 ----------
async function pullProblems(onStep) {
  if (demo()) {
    onStep("見本を読み込み中");
    const j = await (await fetch("demo/problems.json", { cache: "no-store" })).json();
    for (const f of allFigures(j)) {
      if (!(await store.get("fig:demo/" + f.file))) {
        await store.set("fig:demo/" + f.file, await (await fetch("demo/" + f.file)).text());
      }
    }
    setProblems(j.problems, j.notes || []);
    await store.set("demo:problems", j.problems);
    await store.set("demo:notes", j.notes || []);
    return j.problems.length;
  }
  if (!canGitHub()) return null;
  const r = repo();
  onStep("問題を取得中");
  const j = JSON.parse(await r.text("index/problems.json"));
  let figs = 0;
  for (const f of allFigures(j)) {
    if (!(await store.get("fig:" + f.file))) {
      onStep(`図を取得中（${++figs}）`);
      await store.set("fig:" + f.file, await r.text(f.file));
    }
  }
  setProblems(j.problems, j.notes || []);
  await store.set("problems", j.problems);
  await store.set("notes", j.notes || []);
  return j.problems.length;
}

async function pullSupa(onStep) {
  if (!canSupa()) return false;
  await flush(onStep);
  onStep("記録を取得中");
  const [att, bm, nst, wait] = await Promise.all([
    supa.rest("attempts?select=id,problem_id,solved,chosen,parts,at,device&order=at"),
    supa.rest("bookmarks?select=target_type,target_id"),
    supa.rest("note_status?select=note_id,status"),
    supa.rest("photo_waiting?select=mark_id,item_id,label,subject,marked_on&order=marked_on"),
  ]);
  if (state.ops.length) return true; // 取得中に新しい操作があれば次の同期で取り込む
  state.attempts = att;
  state.bookmarks = Object.fromEntries(bm.map((b) => [`${b.target_type}:${b.target_id}`, true]));
  state.noteStatus = Object.fromEntries(nst.map((x) => [x.note_id, x.status]));
  state.waiting = wait;
  await save();
  return true;
}

export async function pull(onStep = () => {}) {
  const problems = await pullProblems(onStep);
  const supaOk = await pullSupa(onStep);
  if (problems === null && !supaOk && !demo()) throw new Error("設定で GitHub のトークンを入力し、ログインしてください");
  state.lastSync = new Date().toISOString();
  await store.set(ns() + "lastSync", state.lastSync);
  return { problems: problems ?? state.problems.length };
}

// ---------- 送信 ----------
let flushing = null;

async function sendOp(op) {
  switch (op.k) {
    case "attempt":
      return supa.rest("attempts?on_conflict=id", { method: "POST", body: [op.row], prefer: "resolution=ignore-duplicates,return=minimal" });
    case "session":
      return supa.rest("sessions?on_conflict=id", { method: "POST", body: [op.row], prefer: "resolution=ignore-duplicates,return=minimal" });
    case "bm_add":
      return supa.rest("bookmarks?on_conflict=user_id,target_type,target_id", { method: "POST", body: [{ target_type: op.type, target_id: op.id }], prefer: "resolution=ignore-duplicates,return=minimal" });
    case "bm_del":
      return supa.rest(`bookmarks?target_type=eq.${encodeURIComponent(op.type)}&target_id=eq.${encodeURIComponent(op.id)}`, { method: "DELETE" });
    case "note":
      return supa.rest("note_status?on_conflict=user_id,note_id", { method: "POST", body: [{ note_id: op.id, status: op.status, updated_at: op.at }], prefer: "resolution=merge-duplicates,return=minimal" });
    case "dismiss":
      return supa.rest("photo_dismissed?on_conflict=user_id,mark_id", { method: "POST", body: [{ mark_id: op.id }], prefer: "resolution=ignore-duplicates,return=minimal" });
    default:
      return null;
  }
}

export async function flush(onStep = () => {}) {
  if (!canSupa() || !state.ops.length) return 0;
  if (flushing) return flushing;
  flushing = (async () => {
    let n = 0;
    onStep("記録を送信中");
    while (state.ops.length) {
      await sendOp(state.ops[0]);
      state.ops.shift();
      n += 1;
      await store.set(ns() + "ops", state.ops);
    }
    return n;
  })();
  try {
    return await flushing;
  } finally {
    flushing = null;
  }
}

async function queue(op) {
  if (!demo()) state.ops.push(op);
  await save();
}

// ---------- 記録する操作 ----------
// 小問つき問題は chosen を null にし、parts に小問ごとの選んだ番号（わからない＝null）を入れる。solved は全小問正解
export async function recordAttempt(problemId, solved, chosen, parts = null) {
  const row = { id: uuid(), problem_id: problemId, solved, chosen, parts, at: new Date().toISOString(), device: store.deviceId() };
  state.attempts.push(row);
  await queue({ k: "attempt", row });
  return row;
}

export async function recordSession(start, end) {
  const row = { id: "mistakes-" + uuid(), subject: "review", started_at: new Date(start).toISOString(),
    ended_at: new Date(end).toISOString(), manual: false, source: "mistakes" };
  await queue({ k: "session", row });
}

export const bmKey = (type, id) => `${type}:${id}`;
export function isBookmarked(type, id) {
  return !!state.bookmarks[bmKey(type, id)];
}
export async function toggleBookmark(type, id) {
  const k = bmKey(type, id);
  if (state.bookmarks[k]) {
    delete state.bookmarks[k];
    await queue({ k: "bm_del", type, id });
    return false;
  }
  state.bookmarks[k] = true;
  await queue({ k: "bm_add", type, id });
  return true;
}

export async function setNoteStatus(noteId, status) {
  state.noteStatus[noteId] = status;
  await queue({ k: "note", id: noteId, status, at: new Date().toISOString() });
}

export async function dismissWaiting(markIds) {
  const set = new Set(markIds);
  state.waiting = state.waiting.filter((w) => !set.has(w.mark_id));
  for (const id of markIds) state.ops.push({ k: "dismiss", id });
  await save();
}

// ---------- 図と写真 ----------
export async function figureURL(file) {
  const k = demo() ? "fig:demo/" + file : "fig:" + file;
  let svg = await store.get(k);
  if (!svg && !demo() && canGitHub()) {
    svg = await repo().text(file);
    await store.set(k, svg);
  }
  return svg ? "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg) : "";
}

export async function originalURL(path) {
  let b = await store.get("orig:" + path);
  if (!b) {
    b = await repo().blob(path);
    await store.set("orig:" + path, b);
  }
  return URL.createObjectURL(b);
}

export async function resetLocal() {
  await store.clearAll();
  Object.assign(state, { problems: [], byId: {}, notes: [], notesById: {}, attempts: [], bookmarks: {}, noteStatus: {}, waiting: [], ops: [], lastSync: null });
}
