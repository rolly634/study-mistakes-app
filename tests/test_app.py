"""誤答トレーニング v0.5.0 の動作テスト（スマホ幅）。

1. 見本モード：選んだ答えで自動判定 → 解説 → 次へ、小問つき問題（小問ごとに解説→次の小問、全問正解で解けた）、
   ブックマーク、疑問ノートのスワイプ仕分け、間隔反復
2. 連携モード：GitHub（問題）と Supabase（記録）を偽のサーバーで代用し、ログイン、写真待ちの確認、
   解いた記録・ブックマーク・ノートの仕分け・復習時間の送信、端末データを消したあとの復元、オフラインを確認

    python3 tests/test_app.py [スクリーンショットの出力先]
    （DATA_REPO で study-mistakes の場所を指定。既定は隣のフォルダ）
"""
import base64
import json
import os
import subprocess
import sys
import time
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

from playwright.sync_api import sync_playwright

APP = Path(__file__).resolve().parent.parent
DATA = Path(os.environ.get("DATA_REPO", APP.parent / "study-mistakes"))
OUT = Path(sys.argv[1] if len(sys.argv) > 1 else "/tmp/claude-0/shots")
OUT.mkdir(parents=True, exist_ok=True)
PORT = 8765
errors = []


def check(cond, msg):
    print(("OK  " if cond else "NG  ") + msg)
    if not cond:
        errors.append(msg)


srv = subprocess.Popen([sys.executable, "-m", "http.server", str(PORT), "-d", str(APP)],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)

demo = json.loads((APP / "demo/problems.json").read_text(encoding="utf-8"))
BYID = {p["id"]: p for p in demo["problems"]}


def solve(page, p, want):
    """1問解く。小問つきは小問を順に。want=False なら最初の小問だけ間違え、残りは正解する。"""
    if not p.get("parts"):
        page.wait_for_selector(".choice:not([disabled])")
        if want:
            page.click(f".choice[data-idx='{p['answer']}']")
        else:
            page.locator(f".choice:not([data-idx='{p['answer']}'])").first.click()
        return
    for k, x in enumerate(p["parts"]):
        sel = f".part[data-part='{k}']"
        page.wait_for_selector(f"{sel} .choice:not([disabled])")
        if want or k > 0:
            page.click(f"{sel} .choice[data-idx='{x['answer']}']")
        else:
            page.locator(f"{sel} .choice:not([data-idx='{x['answer']}'])").first.click()
        page.wait_for_selector(f"{sel} .pverdict")
        if k + 1 < len(p["parts"]):
            check(page.locator(".verdict").count() == 0, f"小問{x['label']}のあと、まだ全体の判定は出ない")
            page.click(f"{sel} .pnext")

# ---- 偽の GitHub ----
probs = [json.loads(f.read_text(encoding="utf-8")) for f in sorted((DATA / "examples/problems").rglob("*.json"))]
notes = [json.loads(f.read_text(encoding="utf-8")) for f in sorted((DATA / "examples/notes").rglob("*.json"))]
remote = {"index/problems.json": json.dumps({"count": len(probs), "problems": probs, "notes": notes}, ensure_ascii=False)}
for f in (DATA / "examples/figures").glob("*.svg"):
    remote[f"examples/figures/{f.name}"] = f.read_text(encoding="utf-8")


def gh(route):
    req = route.request
    if req.headers.get("authorization") != "Bearer test-token":
        return route.fulfill(status=401, json={"message": "Bad credentials"})
    base = "https://api.github.com/repos/rolly634/study-mistakes"
    path = req.url.split("?")[0][len(base):].lstrip("/")
    if path == "":
        return route.fulfill(json={"full_name": "rolly634/study-mistakes", "private": True, "permissions": {"push": True}})
    p = unquote(path[len("contents/"):])
    if p not in remote:
        return route.fulfill(status=404, json={"message": "Not Found"})
    return route.fulfill(body=remote[p])


# ---- 偽の Supabase ----
db = {"attempts": [], "sessions": [], "bookmarks": [], "note_status": [], "photo_dismissed": [],
      "waiting": [{"mark_id": "m-1", "item_id": "GO1-43", "label": "合格るIAIIB 43", "subject": "math", "marked_on": "2026-10-24"}]}


def sb(route):
    req = route.request
    u = urlparse(req.url)
    q = parse_qs(u.query)
    if u.path == "/auth/v1/token":
        body = json.loads(req.post_data or "{}")
        if q["grant_type"][0] == "password" and not (body.get("email") == "me@example.com" and body.get("password") == "pw"):
            return route.fulfill(status=400, json={"error_description": "Invalid login credentials"})
        return route.fulfill(json={"access_token": "at1", "refresh_token": "rt1", "expires_in": 3600,
                                   "expires_at": int(time.time()) + 3600, "user": {"id": "u1", "email": "me@example.com"}})
    if u.path == "/auth/v1/logout":
        return route.fulfill(status=204, body="")
    if req.headers.get("authorization") != "Bearer at1":
        return route.fulfill(status=401, json={"message": "JWT"})
    table = u.path.split("/")[-1]
    body = json.loads(req.post_data) if req.post_data else None
    if table == "photo_waiting":
        gone = {d["mark_id"] for d in db["photo_dismissed"]}
        return route.fulfill(json=[w for w in db["waiting"] if w["mark_id"] not in gone])
    rows = db[table]
    if req.method == "GET":
        return route.fulfill(json=rows)
    if req.method == "POST":
        for r in body:
            if table == "note_status":
                rows[:] = [x for x in rows if x["note_id"] != r["note_id"]]
            if table in ("attempts", "sessions") and any(x["id"] == r["id"] for x in rows):
                continue
            if table == "bookmarks" and any(x["target_type"] == r["target_type"] and x["target_id"] == r["target_id"] for x in rows):
                continue
            rows.append(r)
        return route.fulfill(status=201, body="")
    if req.method == "DELETE":
        t = q["target_type"][0].removeprefix("eq.")
        i = q["target_id"][0].removeprefix("eq.")
        rows[:] = [x for x in rows if not (x["target_type"] == t and x["target_id"] == i)]
        return route.fulfill(status=204, body="")
    return route.fulfill(status=400, json={"message": "?"})


def choose(page, correct):
    pid = page.evaluate("() => location.hash")  # 使わない（出題中の問題 id は meta から取れないので data 属性で判定）
    ids = page.evaluate("async () => { const d = await import('./js/data.js'); return null; }")
    return pid, ids


with sync_playwright() as pw:
    b = pw.chromium.launch(executable_path="/opt/pw-browsers/chromium", args=["--no-sandbox"])

    # ================= 見本モード =================
    ctx = b.new_context(**pw.devices["Pixel 7"], locale="ja-JP")
    page = ctx.new_page()
    page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
    page.on("console", lambda m: m.type == "error" and errors.append(f"console: {m.text}"))
    page.goto(f"http://localhost:{PORT}/")
    page.wait_for_selector("text=はじめに")
    page.click("text=見本で試す")
    page.wait_for_selector("#start")
    check(page.inner_text(".hero .big").startswith("7"), "見本7問が今日の復習に入る")
    page.screenshot(path=OUT / "02-home.png", full_page=True)
    page.click("#start")
    plan = [False, True, True, False, True, False, True]  # 解けた／解けなかったの選び方（6問目が小問つき）
    for i, want in enumerate(plan):
        page.wait_for_selector(".choice:not([disabled])")
        pid = page.get_attribute(".card[data-pid]", "data-pid")
        p = BYID[pid]
        topic = p["topic"]
        if "電験" in page.inner_text(".meta"):
            labs = page.eval_on_selector_all(".choice .lab", "els => els.map(e => e.textContent)")
            check(labs == ["(1)", "(2)", "(3)", "(4)", "(5)"], f"電験は (1)〜(5) の5択（{topic}）")
        solve(page, p, want)
        page.wait_for_selector(".verdict")
        if p.get("parts"):
            n = len(p["parts"])
            check(page.locator(".pverdict").count() == n and page.locator(".presum span").count() == n, f"小問{n}つそれぞれに正誤と解説、最後にまとめ")
            check(page.locator(".pverdict.ng").count() == 1 and page.locator(".pverdict.ok").count() == n - 1, "(1) を間違えても (2)(3) に進める")
            check(page.locator(".mis").count() >= 1, "間違えた小問の「前回の間違い」が出る")
            page.screenshot(path=OUT / "03b-parts.png", full_page=True)
        v = page.inner_text(".verdict")
        check(("解けた" in v and "なかった" not in v) if want else ("解けなかった" in v), f"{i + 1}問目：自動で「{'解けた' if want else '解けなかった'}」")
        check(page.locator(".rate").count() == 0, f"{i + 1}問目：○△×のボタンがない")
        if i == 0:
            page.click(".meta .star")
            page.wait_for_selector(".meta .star.on")
            check(True, "出題中にブックマークできる")
            page.screenshot(path=OUT / "03-answer.png", full_page=True)
        if page.locator(".meta .badge").count():
            check(page.locator(".pt").count() == 1, f"{i + 1}問目（調べもの）に「覚えておくこと」")
        page.click("#next")
        nxt = f"{i + 2}/{len(plan)}"
        page.wait_for_function(f"() => document.querySelector('#title').textContent.includes('{nxt}') || document.body.textContent.includes('おつかれさまでした')")
    page.wait_for_selector("text=おつかれさまでした")
    stat = page.eval_on_selector_all(".stat b", "els => els.map(e => e.textContent)")
    check(stat[:2] == ["4", "3"], f"まとめ：解けた4・解けなかった3 {stat}")
    rec = page.evaluate("async () => (await import('./js/data.js')).state.attempts.find(a => a.problem_id === '20261023-math-02')")
    check(rec and rec["solved"] is False and rec["chosen"] is None and len(rec["parts"]) == 3 and rec["parts"][1:] == [1, 2],
          f"小問つきの記録：solved=false、parts に小問ごとの答え {rec and rec.get('parts')}")

    due = page.evaluate("""async () => {
      const s = await import('./js/srs.js'); const d = await import('./js/data.js');
      const st = s.buildStates(d.state.attempts, d.state.byId);
      return Object.values(st).map(v => v.interval).sort((a, b) => a - b);
    }""")
    check(due == [1, 1, 1, 7, 7, 7, 7], f"解けなかった→翌日、解けた→7日 {due}")

    r = page.evaluate("""async () => {
      const s = await import('./js/srs.js'); let st; const out = [];
      for (const [ok, d] of [[true,'2026-10-24'],[true,'2026-10-31'],[false,'2026-11-14'],[false,'2026-11-15'],[true,'2026-11-16'],[true,'2026-11-23'],[true,'2027-02-11']]) {
        st = s.apply(st, ok, d, '数学'); out.push([st.interval, st.status, st.due]);
      }
      return out;
    }""")
    for row in r:
        print("    ", row)
    check([x[0] for x in r] == [7, 14, 1, 1, 7, 14, 28], "間隔：7→14、解けないと1日、また7→14→28")
    check([x[1] for x in r] == ["learning", "teichaku", "learning", "caution", "learning", "teichaku", "teichaku"], "状態：2回続けて解けた＝定着、2回続けて解けない＝要注意")
    check(r[-1][2] == "2027-02-21", "試験前は残り日数の半分が上限（2/11→2/21）")

    page.click("#home")
    page.wait_for_selector("#bm")
    check("（1）" in page.inner_text("#bm"), "ホームのブックマークが1問")
    page.click(".tabs button[data-go=list]")
    page.wait_for_selector(".item .pill")
    pills = page.eval_on_selector_all(".item .pill", "els => els.map(e => e.textContent)")
    check(sorted(pills) == sorted(["学習中"] * 7), f"一覧に状態が出る {pills}")
    page.click(".chips >> nth=0 >> text=★")
    page.wait_for_selector(".item")
    check(page.locator(".item").count() == 1, "★の一覧にブックマークした1問")
    page.screenshot(path=OUT / "04-list.png", full_page=True)

    # 疑問ノートの仕分け（スワイプ）
    page.click(".chips >> nth=0 >> text=疑問ノート")
    page.wait_for_selector("#sortBtn")
    page.click("#sortBtn")
    page.wait_for_selector("#sw .asked")
    page.screenshot(path=OUT / "05-swipe.png", full_page=True)
    box = page.locator("#sw").bounding_box()
    x, y = box["x"] + box["width"] / 2, box["y"] + 120
    page.mouse.move(x, y)
    page.mouse.down()
    for k in range(1, 11):
        page.mouse.move(x + k * 18, y + 2)
    page.mouse.up()
    page.wait_for_selector("text=仕分けが終わりました")
    check("1" in page.eval_on_selector_all(".stat b", "els => els.map(e => e.textContent)")[0], "右スワイプで「定着」")
    st = page.evaluate("async () => (await import('./js/data.js')).state.noteStatus")
    check(list(st.values()) == ["teichaku"], f"ノートの状態が定着 {st}")
    ctx.close()

    # ================= 連携モード（GitHub＋Supabase） =================
    ctx2 = b.new_context(**pw.devices["Pixel 7"], locale="ja-JP")
    ctx2.route("https://api.github.com/**", gh)
    ctx2.route("https://yxqsdfskxwjimgypdudk.supabase.co/**", sb)
    pg = ctx2.new_page()
    pg.on("pageerror", lambda e: errors.append(f"pageerror2: {e}"))
    pg.on("console", lambda m: m.type in ("error", "warning") and print("    console:", m.text[:200]))
    pg.on("dialog", lambda d: d.accept())
    pg.goto(f"http://localhost:{PORT}/#settings")
    pg.wait_for_selector("#token")
    pg.fill("#token", "test-token")
    pg.click("#save")
    pg.wait_for_function("() => document.querySelector('#toast').textContent.includes('接続しました')")
    pg.fill("#email", "me@example.com")
    pg.fill("#pw", "wrong")
    pg.click("#login")
    pg.wait_for_function("() => document.querySelector('#toast').textContent.includes('違います')")
    check(True, "パスワード違いでエラー表示")
    pg.fill("#pw", "pw")
    pg.click("#login")
    pg.wait_for_selector("#logout")
    check("me@example.com" in pg.inner_text("#view"), "ログインできる")
    pg.screenshot(path=OUT / "06-settings.png", full_page=True)

    pg.click(".tabs button[data-go=home]")
    pg.wait_for_selector(".waiting")
    check("写真待ち 1件" in pg.inner_text(".waiting"), "ホームに写真待ち1件")
    pg.screenshot(path=OUT / "07-waiting.png", full_page=True)
    pg.click("[data-dismiss]")
    pg.wait_for_function("() => !document.querySelector('.waiting')")
    pg.wait_for_timeout(2000)
    check(db["photo_dismissed"] == [{"mark_id": "m-1"}], f"「確認した」が送られる {db['photo_dismissed']}")

    pg.click("#start")
    for want in [False, True]:
        pg.wait_for_selector(".choice:not([disabled])")
        pid = pg.get_attribute(".card[data-pid]", "data-pid")
        solve(pg, next(p for p in probs if p["id"] == pid), want)
        pg.wait_for_selector(".verdict")
        if not want:
            pg.click(".meta .star")
        pg.click("#next")
        pg.wait_for_timeout(300)
    pg.wait_for_timeout(2000)
    check(len(db["attempts"]) == 2 and [a["solved"] for a in db["attempts"]] == [False, True], f"解いた記録が2件送られる {[a.get('solved') for a in db['attempts']]}")
    check(len(db["bookmarks"]) == 1 and db["bookmarks"][0]["target_type"] == "problem", f"ブックマークが送られる {db['bookmarks']}")

    # 復習時間（6分前から活動していたことにして、ホームに戻る）
    pg.evaluate("""async () => {
      const t = await import('./js/tracker.js');
      t.stop();
      t.touch(Date.now() - 6 * 60000); t.touch(Date.now() - 4 * 60000); t.touch(Date.now() - 1 * 60000);
    }""")
    pg.click("#back")
    pg.wait_for_timeout(2500)
    ss = db["sessions"]
    check(len(ss) >= 1 and ss[-1]["subject"] == "review" and ss[-1]["source"] == "mistakes", f"復習時間が sessions に送られる {ss[-1] if ss else None}")
    if ss:
        from datetime import datetime
        dur = (datetime.fromisoformat(ss[-1]["ended_at"].replace("Z", "+00:00")) - datetime.fromisoformat(ss[-1]["started_at"].replace("Z", "+00:00"))).total_seconds() / 60
        check(5.5 <= dur <= 7, f"復習時間の長さ（約6分）：{dur:.1f}分")

    # 疑問ノートの仕分けをボタンで（左＝復習中）
    pg.goto(f"http://localhost:{PORT}/#list")
    pg.wait_for_selector(".chips")
    pg.click(".chips >> nth=0 >> text=疑問ノート")
    pg.click("#sortBtn")
    pg.wait_for_selector("#keep")
    pg.click("#keep")
    pg.wait_for_selector("text=仕分けが終わりました")
    pg.wait_for_timeout(2000)
    check(db["note_status"] and db["note_status"][0]["status"] == "fukushu", f"ノートの仕分けが送られる {db['note_status']}")

    # 端末のデータを消しても戻る
    pg.evaluate("() => new Promise(r => { const q = indexedDB.deleteDatabase('study-mistakes'); q.onsuccess = q.onerror = q.onblocked = () => r(); })")
    pg.goto(f"http://localhost:{PORT}/?fresh=1#list")
    try:
        pg.wait_for_function("() => [...document.querySelectorAll('.item .pill')].filter(e => e.textContent !== '新').length >= 2", timeout=8000)
    except Exception:
        print("    DEBUG", pg.evaluate("""async () => { const d = await import('./js/data.js'); return {p: d.state.problems.length, a: d.state.attempts.length, ops: d.state.ops.length, hash: location.hash, pills: [...document.querySelectorAll('.item .pill')].map(e => e.textContent), sync: document.querySelector('#sync').textContent}; }"""))
        raise
    check(pg.locator(".star.on").count() == 1, "ブックマークも戻る")
    check(True, "記録を Supabase から復元")

    ctx2.set_offline(True)
    pg.reload()
    pg.wait_for_selector(".item, .hero", timeout=8000)
    check(True, "オフラインで再読み込みできる")
    ctx2.set_offline(False)
    b.close()

srv.terminate()
print("\nエラー:", errors if errors else "なし")
sys.exit(1 if errors else 0)
