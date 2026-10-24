// 復習時間の自動記録
//   問題を解く・疑問ノートを読む／仕分ける画面での操作を「活動」とみなす
//   最後の操作から5分何もしなければそこで区切る。アプリを閉じる・切り替えたら止める。1分未満は記録しない
//   区切った時間は進捗管理アプリの sessions（科目 review、記録元 mistakes）に送る

const IDLE = 5 * 60 * 1000;
const MIN = 60 * 1000;
const KEY = "review-tracking";

let cur = null; // { start, last }
let onClose = () => {};

function persist() {
  try {
    if (cur) localStorage.setItem(KEY, JSON.stringify(cur));
    else localStorage.removeItem(KEY);
  } catch { /* 保存できない環境 */ }
}

function close(end) {
  if (!cur) return;
  const s = cur;
  cur = null;
  persist();
  const e = Math.max(s.start, Math.min(end, s.last + IDLE));
  if (e - s.start >= MIN) onClose(s.start, e);
}

// 前回アプリが途中で終わっていたら、最後の操作の時刻で区切る
export function init(callback) {
  onClose = callback;
  try {
    const old = JSON.parse(localStorage.getItem(KEY) || "null");
    if (old) {
      cur = old;
      close(old.last);
    }
  } catch { /* 読めなければ捨てる */ }
  setInterval(() => {
    if (cur && Date.now() - cur.last > IDLE) close(cur.last);
  }, 30 * 1000);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") close(Date.now());
  });
  window.addEventListener("pagehide", () => close(Date.now()));
}

// 活動中の画面での操作ごとに呼ぶ
export function touch(now = Date.now()) {
  if (cur && now - cur.last <= IDLE) {
    cur.last = Math.max(cur.last, now);
  } else {
    if (cur) close(cur.last);
    cur = { start: now, last: now };
  }
  persist();
}

// 活動しない画面（ホーム・設定など）に移ったら区切る
export function stop() {
  if (cur) close(Date.now());
}

export function active() {
  return !!cur;
}
