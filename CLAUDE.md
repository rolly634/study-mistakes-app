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
js/app.js      画面（ホーム・出題・一覧・疑問ノート・仕分け・送ったもの・設定）と遷移（#home, #list, #settings, #review, #sort, #inbox, #problem/<id>, #note/<id>）。Claude に送る欄（⋯で 未分類／修正依頼／質問／メモ）、インストールボタン
js/data.js     問題・ノート（mistake_content、hash で差分取得）・図と写真（storage の mistakes バケット）と、記録・ブックマーク・ノートの仕分け・写真待ち・受信箱の取得と送信。すべて Supabase。送信は ops に積んで順に送る
js/github.js   GitHub Contents API（旧方式。ログインしていないときだけ使う）
js/supa.js     Supabase の最小クライアント（fetch のみ。メール＋パスワードでログイン、REST）
js/tracker.js  復習時間の自動記録（5分で区切る、1分未満は捨てる）
js/srs.js      間隔反復（解けなかった 1日、解けた 7→14→28→56日、上限は試験までの残り日数の半分）。定着／要注意の判定。1日の出題数の上限はない。今日の並びは 期限の誤答→期限の調べもの→未出題の誤答→未出題の調べもの
js/render.js   Markdown＋LaTeX → HTML（KaTeX、DOMPurify）
js/store.js    IndexedDB（データ）と localStorage（設定・端末ID）
demo/          見本モードのデータ
tests/         Playwright の動作テスト
```

## データの約束

- 問題データの正本は非公開の `rolly634/study-mistakes`。push のたびに GitHub Actions が Supabase に写す（Edge Function `sync-mistakes`）。アプリは GitHub を読まない（旧方式のトークンは任意）
- Supabase（読むだけ）：`mistake_content`（problem／note。`data` が問題・ノートの JSON、`hash` で差分）、storage の `mistakes` バケット（`figures/*.svg`、`originals/*.jpg`。写真はボタンを押したときだけ）
- Supabase（本人の行だけ読み書き）
  - 書く：`attempts`（problem_id, solved, chosen, parts, at, device。id は端末で作る uuid）、`inbox`（Claude に送る。id, kind, body, target_type, target_id, part, sent_at。未対応のものは取り消し＝DELETE できる）、`sessions`（subject=review, source=mistakes, id=`mistakes-<uuid>`）、`bookmarks`、`note_status`（teichaku／fukushu）、`photo_dismissed`（mark_id）
  - 読む：上の表（inbox は status・reply も）と、ビュー `photo_waiting`
- 問題の `kind` が `inquiry` なら調べもの（`point` と `note` を表示に使う）。省略時は誤答
- 状態（次回日・定着・要注意）は保存せず、毎回 attempts を時刻順に再生して計算する（DB 側のビュー `problem_status` と同じ規則）

## 変更したら

1. `sw.js` の `VERSION` と `js/app.js` の `VERSION` を同じ値で上げる
2. `python3 tests/test_app.py` が「エラー: なし」になることを確認
3. コミットして push（GitHub Pages に自動で反映）
