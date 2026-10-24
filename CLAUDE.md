# study-mistakes-app

誤答問題と調べもの問題を間隔反復で出題する PWA。**公開リポジトリ**（GitHub Pages で配信）。
進捗管理アプリ（rolly634/study-planner）と Supabase で記録を共有する。仕様はプロジェクト文書「アプリ連携の仕様」と study-planner の `supabase/mistakes.sql`。

## 守ること

- このリポジトリに問題データ・写真・図を置かない。データは非公開の `rolly634/study-mistakes` だけにある。`demo/` は自作の見本なので例外。
- トークン・パスワード・ユーザーの記録をコードやログに入れない。Supabase は公開キー（publishable）だけを使う。
- ビルド工程はない。外部 CDN も使わない（オフラインで動かすため、ライブラリは `vendor/` に同梱）。

## 構成

```
index.html, manifest.webmanifest, sw.js   PWA 本体（sw.js がアプリ本体をキャッシュ）
css/app.css                               スマホ幅前提、ダークモード対応
js/app.js      画面（ホーム・出題・一覧・疑問ノート・仕分け・設定）と遷移（#home, #list, #settings, #review, #sort, #problem/<id>, #note/<id>）
js/data.js     問題・図（GitHub）と、記録・ブックマーク・ノートの仕分け・写真待ち（Supabase）の取得と送信。送信は ops に積んで順に送る
js/github.js   GitHub Contents API（raw 取得）
js/supa.js     Supabase の最小クライアント（fetch のみ。メール＋パスワードでログイン、REST）
js/tracker.js  復習時間の自動記録（5分で区切る、1分未満は捨てる）
js/srs.js      間隔反復（解けなかった 1日、解けた 7→14→28→56日、上限は試験までの残り日数の半分）。定着／要注意の判定
js/render.js   Markdown＋LaTeX → HTML（KaTeX、DOMPurify）
js/store.js    IndexedDB（データ）と localStorage（設定・端末ID）
demo/          見本モードのデータ
tests/         Playwright の動作テスト
```

## データの約束

- GitHub（読むだけ）：`index/problems.json`（`problems` と `notes`）、`figures/*.svg`、`originals/*.jpg`（ボタンを押したときだけ）
- Supabase（本人の行だけ読み書き）
  - 書く：`attempts`（problem_id, solved, chosen, at, device。id は端末で作る uuid）、`sessions`（subject=review, source=mistakes, id=`mistakes-<uuid>`）、`bookmarks`、`note_status`（teichaku／fukushu）、`photo_dismissed`（mark_id）
  - 読む：上の表と、ビュー `photo_waiting`
- 問題の `kind` が `inquiry` なら調べもの（`point` と `note` を表示に使う）。省略時は誤答
- 状態（次回日・定着・要注意）は保存せず、毎回 attempts を時刻順に再生して計算する（DB 側のビュー `problem_status` と同じ規則）

## 変更したら

1. `sw.js` の `VERSION` と `js/app.js` の `VERSION` を同じ値で上げる
2. `python3 tests/test_app.py` が「エラー: なし」になることを確認
3. コミットして push（GitHub Pages に自動で反映）
