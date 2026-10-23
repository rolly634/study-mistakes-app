"""誤答トレーニングの動作テスト（スマホ幅）。

1. 見本モード：出題 → 選択 → 解説 → ○△× → まとめ → 一覧 → 間隔反復の次回日
2. GitHub モード：api.github.com をローカルの study-mistakes（見本を problems に見立てる）で代用し、
   problems.json と図の取得、解答の書き戻し（PUT）、再読み込み後の履歴復元を確認
"""
import base64
import os
import json
import subprocess
import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

APP = Path(__file__).resolve().parent.parent
DATA = Path(os.environ.get("DATA_REPO", APP.parent / "study-mistakes"))
OUT = Path(sys.argv[1] if len(sys.argv) > 1 else "/tmp/claude-0/shots")
OUT.mkdir(parents=True, exist_ok=True)
PORT = 8765

srv = subprocess.Popen([sys.executable, "-m", "http.server", str(PORT), "-d", str(APP)],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
errors = []

# ---- 偽の GitHub ----
probs = []
for f in sorted((DATA / "examples/problems").rglob("*.json")):
    probs.append(json.loads(f.read_text(encoding="utf-8")))
remote = {"index/problems.json": json.dumps({"count": len(probs), "problems": probs}, ensure_ascii=False)}
for f in (DATA / "examples/figures").glob("*.svg"):
    remote[f"examples/figures/{f.name}"] = f.read_text(encoding="utf-8")
shas = {}
puts = []


def gh(route):
    req = route.request
    url = req.url.split("?")[0]
    base = "https://api.github.com/repos/rolly634/study-mistakes"
    if req.headers.get("authorization") != "Bearer test-token":
        return route.fulfill(status=401, json={"message": "Bad credentials"})
    path = url[len(base):].lstrip("/")
    if path == "":
        return route.fulfill(json={"full_name": "rolly634/study-mistakes", "private": True, "permissions": {"push": True}})
    assert path.startswith("contents/")
    from urllib.parse import unquote
    p = unquote(path[len("contents/"):])
    if req.method == "PUT":
        body = json.loads(req.post_data)
        if p in remote and body.get("sha") != shas.get(p):
            return route.fulfill(status=409, json={"message": "sha mismatch"})
        remote[p] = base64.b64decode(body["content"]).decode()
        shas[p] = f"sha{len(puts)}"
        puts.append(p)
        return route.fulfill(status=201, json={"content": {"sha": shas[p]}})
    if p == "reviews":
        items = [{"name": k.split("/")[-1], "path": k, "sha": shas.get(k, "x")} for k in remote if k.startswith("reviews/")]
        return route.fulfill(json=items)
    if p not in remote:
        return route.fulfill(status=404, json={"message": "Not Found"})
    if "raw" in req.headers.get("accept", ""):
        return route.fulfill(body=remote[p])
    return route.fulfill(json={"sha": shas.get(p, "x"), "content": base64.b64encode(remote[p].encode()).decode()})


def check(cond, msg):
    print(("OK  " if cond else "NG  ") + msg)
    if not cond:
        errors.append(msg)


with sync_playwright() as pw:
    b = pw.chromium.launch(executable_path="/opt/pw-browsers/chromium", args=["--no-sandbox"])
    ctx = b.new_context(**pw.devices["Pixel 7"], locale="ja-JP")
    page = ctx.new_page()
    page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
    page.on("console", lambda m: m.type == "error" and errors.append(f"console: {m.text}"))
    page.goto(f"http://localhost:{PORT}/")
    page.wait_for_selector("text=はじめに")
    page.screenshot(path=OUT / "01-first.png")

    # ---- 見本モード ----
    page.click("text=見本で試す")
    page.wait_for_selector("#start")
    check("4" in page.inner_text(".hero .big"), "見本4問が今日の復習に入る")
    page.screenshot(path=OUT / "02-home.png", full_page=True)
    page.click("#start")
    rates = ["x", "d", "o", "o"]
    for i, r in enumerate(rates):
        page.wait_for_selector(".choice")
        if i == 0:
            check(page.locator(".katex").count() > 0, "数式が KaTeX で描かれる")
            page.screenshot(path=OUT / "03-question.png", full_page=True)
        if page.locator(".figs img").count():
            ok = page.evaluate("() => [...document.querySelectorAll('.figs img')].every(i => i.complete && i.naturalWidth > 0)")
            check(ok, f"{i + 1}問目の図が表示される")
        # 間違いの選択肢を選ぶ（1問目）／正解を選ぶ（それ以外）
        target = ".choice:not([data-idx='0'])" if i == 0 else None
        if i == 0:
            page.locator(target).first.click()
        else:
            idx = page.evaluate("() => { const t = document.querySelector('.meta .topic').textContent; return null; }")
            page.locator(".choice").first.click()
        page.wait_for_selector(".rate")
        if i == 0:
            check(page.locator(".choice.ng").count() == 1 and page.locator(".choice.ok").count() == 1, "不正解で赤と緑が付く")
            check(page.locator(".rate .x.hint").count() == 1, "不正解なら×をすすめる")
            page.screenshot(path=OUT / "04-answer.png", full_page=True)
        page.click(f".rate .{r}")
    page.wait_for_selector("text=おつかれさまでした")
    page.screenshot(path=OUT / "05-summary.png", full_page=True)
    check("4" in page.inner_text(".hero .big"), "まとめに4問")

    page.click(".tabs button[data-go=list]")
    page.wait_for_selector(".item")
    marks = page.eval_on_selector_all(".item .mark", "els => els.map(e => e.textContent)")
    check(sorted(marks) == sorted(["×", "△", "○", "○"]), f"一覧に○△×が付く {marks}")
    page.screenshot(path=OUT / "06-list.png", full_page=True)
    page.click(".chips >> nth=0 >> text=週別")
    page.wait_for_selector("h3")
    page.click(".tabs button[data-go=home]")
    page.wait_for_selector(".hero")
    check("0" in page.inner_text(".hero .big"), "今日の分が0問になる")

    # 次回日（間隔反復）
    due = page.evaluate("""async () => {
      const s = await import('./js/srs.js');
      const d = await import('./js/data.js');
      const st = s.buildStates(d.state.events, d.state.byId);
      return Object.fromEntries(Object.entries(st).map(([k, v]) => [k, [v.last, v.interval, v.due]]));
    }""")
    print("    次回:", due)
    check(sorted(v[1] for v in due.values()) == [1, 3, 7, 7], "×=1日、△=3日、○=7日")

    # 間隔の計算（単体）
    r = page.evaluate("""async () => {
      const s = await import('./js/srs.js');
      let st; const out = [];
      for (const [r, d] of [['o','2026-10-24'],['o','2026-10-31'],['o','2026-11-14'],['o','2026-12-12'],['x','2027-01-20'],['o','2027-01-21'],['o','2027-01-28'],['o','2027-02-11']]) {
        st = s.apply(st, r, d, '数学'); out.push([d, r, st.interval, st.due]);
      }
      const dk = s.apply(undefined, 'o', '2027-03-10', '電験');
      return {out, cap: s.cap('数学', '2027-02-11'), dk: dk.due};
    }""")
    for row in r["out"]:
        print("    ", row)
    check([x[2] for x in r["out"]] == [7, 14, 28, 56, 1, 7, 14, 28], "○が続くと間隔が2倍、×で1日に戻る")
    check(r["out"][-1][3] == "2027-02-21", "試験前は残り日数の半分が上限（2/11は残り21日→上限10日→2/21）")
    check(r["dk"] == "2027-03-15", "電験は3/21を基準に上限（3/10→3/15）")

    # ---- GitHub モード ----
    ctx2 = b.new_context(**pw.devices["Pixel 7"], locale="ja-JP")
    ctx2.route("https://api.github.com/**", gh)
    pg = ctx2.new_page()
    pg.on("pageerror", lambda e: errors.append(f"pageerror2: {e}"))
    pg.goto(f"http://localhost:{PORT}/#settings")
    pg.wait_for_selector("#token")
    pg.fill("#token", "wrong")
    pg.click("#save")
    pg.wait_for_selector("#toast:not([hidden])")
    check("トークンが無効" in pg.inner_text("#toast"), "間違ったトークンでエラー表示")
    pg.fill("#token", "test-token")
    pg.click("#save")
    pg.wait_for_function("() => document.querySelector('#toast').textContent.includes('接続しました')")
    pg.screenshot(path=OUT / "07-settings.png", full_page=True)
    pg.click(".tabs button[data-go=home]")
    pg.wait_for_selector("#start")
    check("4" in pg.inner_text(".hero .big"), "GitHub から4問を読み込む")
    pg.click("#start")
    for r in ["x", "o"]:
        pg.wait_for_selector(".choice")
        pg.locator(".choice").first.click()
        pg.click(f".rate .{r}")
    pg.wait_for_timeout(2500)  # 送信を待つ
    check(any(p.startswith("reviews/") for p in puts), f"解答が reviews/ に書き込まれる {puts}")
    rv = [k for k in remote if k.startswith("reviews/")]
    if rv:
        ev = json.loads(remote[rv[0]])["events"]
        check(len(ev) == 2 and {e["r"] for e in ev} == {"x", "o"}, "書き込まれた履歴が2件（×と○）")
        print("    ", rv[0], ev[0])

    # 端末のデータを消しても GitHub から戻る
    pg.evaluate("() => new Promise(r => { const q = indexedDB.deleteDatabase('study-mistakes'); q.onsuccess = q.onerror = q.onblocked = () => r(); })")
    pg.goto(f"http://localhost:{PORT}/#list")
    pg.wait_for_selector(".item .mark")
    pg.wait_for_function("() => [...document.querySelectorAll('.item .mark')].filter(e => e.textContent !== '新').length >= 2", timeout=8000)
    marks = pg.eval_on_selector_all(".item .mark", "els => els.map(e => e.textContent)")
    check(marks.count("新") == 2, f"履歴を GitHub から復元 {marks}")

    # オフラインでも開ける
    pg.wait_for_timeout(500)
    ctx2.set_offline(True)
    pg.reload()
    pg.wait_for_selector(".tabs")
    pg.wait_for_selector(".item, .hero", timeout=8000)
    check(True, "オフラインで再読み込みできる")
    ctx2.set_offline(False)
    b.close()

srv.terminate()
print("\nエラー:", errors if errors else "なし")
sys.exit(1 if errors else 0)
