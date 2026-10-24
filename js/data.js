// 問題・図・解答履歴の読み込みと GitHub との同期

import * as store from "./store.js";
import { Repo } from "./github.js";
import { ymd } from "./srs.js";

export const state = {
  problems: [],
  byId: {},
  notes: [],     // 疑問ノート（調べもの）
  notesById: {},
  events: [],    // 全解答履歴 {id, r, t, chosen, correct, dev}
  pending: [],   // まだ GitHub に書いていない履歴
  lastSync: null,
};

const key = (e) => `${e.id}|${e.t}|${e.dev}`;

function demo() {
  return store.settings().demo;
}

function repo() {
  const s = store.settings();
  return new Repo(s);
}

export function canSync() {
  const s = store.settings();
  return !s.demo && !!s.token && !!s.owner && !!s.repo;
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
  const ns = demo() ? "demo:" : "";
  setProblems(await store.get(ns + "problems", []), await store.get(ns + "notes", []));
  state.events = await store.get(ns + "events", []);
  state.pending = await store.get(ns + "pending", []);
  state.lastSync = await store.get(ns + "lastSync", null);
}

async function save() {
  const ns = demo() ? "demo:" : "";
  await store.set(ns + "events", state.events);
  await store.set(ns + "pending", state.pending);
}

function mergeEvents(list) {
  const seen = new Set(state.events.map(key));
  let added = 0;
  for (const e of list) {
    if (!seen.has(key(e))) {
      state.events.push(e);
      seen.add(key(e));
      added += 1;
    }
  }
  return added;
}

// ---- 取得 ----
export async function pull(onStep = () => {}) {
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
    state.lastSync = new Date().toISOString();
    await store.set("demo:lastSync", state.lastSync);
    return { problems: j.problems.length, events: 0 };
  }
  if (!canSync()) throw new Error("設定でトークンを入力してください");
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

  onStep("解答履歴を取得中");
  const shas = await store.get("reviewShas", {});
  let added = 0;
  for (const f of await r.list("reviews")) {
    if (!f.name.endsWith(".json") || shas[f.path] === f.sha) continue;
    try {
      const data = JSON.parse(await r.text(f.path));
      added += mergeEvents(data.events || []);
      shas[f.path] = f.sha;
    } catch { /* 壊れたファイルは飛ばす */ }
  }
  await store.set("reviewShas", shas);
  await save();
  await push(onStep);
  state.lastSync = new Date().toISOString();
  await store.set("lastSync", state.lastSync);
  return { problems: j.problems.length, events: added };
}

// ---- 書き込み ----
let pushing = null;

export async function push(onStep = () => {}) {
  if (!canSync() || state.pending.length === 0) return 0;
  if (pushing) return pushing;
  pushing = (async () => {
    const r = repo();
    const dev = store.deviceId();
    const groups = {};
    for (const e of state.pending) {
      const path = `reviews/${ymd(new Date(e.t))}-${dev}.json`;
      (groups[path] ||= []).push(e);
    }
    const shas = await store.get("reviewShas", {});
    let written = 0;
    for (const [path, evs] of Object.entries(groups)) {
      onStep("解答を保存中");
      for (let attempt = 0; attempt < 2; attempt++) {
        const cur = await r.getFile(path);
        const base = cur ? JSON.parse(cur.text) : { device: dev, date: path.slice(8, 18), events: [] };
        const have = new Set(base.events.map(key));
        for (const e of evs) if (!have.has(key(e))) base.events.push(e);
        base.events.sort((a, b) => (a.t < b.t ? -1 : 1));
        try {
          const sha = await r.putFile(path, JSON.stringify(base, null, 1) + "\n",
            `review: ${base.date} ${dev} ${base.events.length}件`, cur?.sha);
          shas[path] = sha;
          const done = new Set(evs.map(key));
          state.pending = state.pending.filter((e) => !done.has(key(e)));
          written += evs.length;
          break;
        } catch (e) {
          if (!(e.status === 409 || e.status === 422) || attempt === 1) throw e;
        }
      }
    }
    await store.set("reviewShas", shas);
    await save();
    return written;
  })();
  try {
    return await pushing;
  } finally {
    pushing = null;
  }
}

export async function record(id, r, chosen, correct) {
  const e = { id, r, t: new Date().toISOString(), chosen, correct, dev: store.deviceId() };
  state.events.push(e);
  state.pending.push(e);
  await save();
  return e;
}

// ---- 図と写真 ----
export async function figureURL(file) {
  const k = demo() ? "fig:demo/" + file : "fig:" + file;
  let svg = await store.get(k);
  if (!svg && !demo() && canSync()) {
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
  state.problems = []; state.byId = {}; state.notes = []; state.notesById = {}; state.events = []; state.pending = []; state.lastSync = null;
}
