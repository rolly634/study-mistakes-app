// 間隔反復：「解けた／解けなかった」の履歴から次の出題日を決める
//   解けなかった → 翌日
//   解けた       → 7日 → 14日 → 28日 → 56日（続けて解けるたびに2倍）
//   ただし、試験までに必ずもう一度出るよう、間隔は「試験までの残り日数の半分」を上限にする
// 状態：定着＝2回続けて解けた、要注意＝2回続けて解けなかった

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

// 1回の結果を状態に反映
export function apply(state, solved, day, subject) {
  const s = state ? { ...state } : { interval: 0, streak: 0, misses: 0, reps: 0 };
  let interval;
  if (solved) {
    interval = s.streak > 0 ? s.interval * 2 : 7;
    s.streak += 1;
    s.misses = 0;
  } else {
    interval = 1;
    s.streak = 0;
    s.misses += 1;
  }
  s.reps += 1;
  s.interval = interval;
  s.last = solved;
  s.lastDay = day;
  s.due = addDays(day, Math.min(interval, cap(subject, day)));
  s.status = s.streak >= 2 ? "teichaku" : s.misses >= 2 ? "caution" : "learning";
  return s;
}

// 全記録から各問題の状態を作る（時刻順に再生）
export function buildStates(attempts, problemsById) {
  const states = {};
  const sorted = [...attempts].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  for (const a of sorted) {
    const p = problemsById[a.problem_id];
    if (!p) continue;
    states[a.problem_id] = apply(states[a.problem_id], a.solved, ymd(new Date(a.at)), p.subject);
  }
  return states;
}

// 今日の出題リスト：期限切れ（古い順）→ 未出題（登録の古い順）
export function todayQueue(problems, states, { today = ymd(), limit = 20, doneToday = 0 } = {}) {
  const due = problems
    .filter((p) => states[p.id] && states[p.id].due <= today && states[p.id].lastDay !== today)
    .sort((a, b) => (states[a.id].due < states[b.id].due ? -1 : 1));
  const fresh = problems.filter((p) => !states[p.id])
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id < b.id ? -1 : 1));
  const room = Math.max(0, limit - doneToday);
  return [...due, ...fresh].slice(0, room);
}
