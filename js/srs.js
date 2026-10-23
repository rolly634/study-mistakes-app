// 間隔反復：○△× の履歴から次の出題日を決める
//   × → 翌日   △ → 3日後   ○ → 7日 → 14日 → 28日 → 56日（○が続くたびに2倍）
//   ただし、試験までに必ずもう一度出るよう、間隔は「試験までの残り日数の半分」を上限にする

export const EXAMS = { 入試: "2027-03-04", 電験: "2027-03-21" };

export function examFor(subject) {
  return subject === "電験" ? EXAMS.電験 : EXAMS.入試;
}

// ローカル日付（YYYY-MM-DD）
export function ymd(d = new Date()) {
  const z = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
}

function parse(s) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(s, n) {
  const d = parse(s);
  d.setDate(d.getDate() + n);
  return ymd(d);
}

export function daysBetween(a, b) {
  return Math.round((parse(b) - parse(a)) / 86400000);
}

export function cap(subject, today) {
  const left = daysBetween(today, examFor(subject));
  if (left <= 0) return 60; // 試験後は上限60日
  return Math.max(1, Math.floor(left / 2));
}

// 1回の評価を状態に反映
export function apply(state, rating, day, subject) {
  const s = state ? { ...state } : { interval: 0, streak: 0, reps: 0, lapses: 0 };
  let interval;
  if (rating === "x") {
    interval = 1;
    s.lapses += 1;
    s.streak = 0;
  } else if (rating === "d") {
    interval = 3;
    s.streak = 0;
  } else {
    interval = s.streak > 0 ? s.interval * 2 : 7;
    s.streak += 1;
  }
  s.reps += 1;
  s.interval = interval;
  s.last = rating;
  s.lastDay = day;
  s.due = addDays(day, Math.min(interval, cap(subject, day)));
  return s;
}

// 全履歴から各問題の状態を作る（時刻順に再生）
export function buildStates(events, problemsById) {
  const states = {};
  const sorted = [...events].sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : 0));
  for (const e of sorted) {
    const p = problemsById[e.id];
    if (!p) continue;
    states[e.id] = apply(states[e.id], e.r, ymd(new Date(e.t)), p.subject);
  }
  return states;
}

// 今日の出題リスト：期限切れ（古い順）→ 未出題（登録の古い順）
export function todayQueue(problems, states, { today = ymd(), subject = null, limit = 20, doneToday = 0 } = {}) {
  const pool = problems.filter((p) => !subject || p.subject === subject);
  const due = pool
    .filter((p) => states[p.id] && states[p.id].due <= today && states[p.id].lastDay !== today)
    .sort((a, b) => (states[a.id].due < states[b.id].due ? -1 : 1));
  const fresh = pool.filter((p) => !states[p.id]).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id < b.id ? -1 : 1));
  const room = Math.max(0, limit - doneToday);
  return [...due, ...fresh].slice(0, room);
}
