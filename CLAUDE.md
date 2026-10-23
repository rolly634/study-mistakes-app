# study-mistakes-app

誤答問題を間隔反復で出題する PWA。**公開リポジトリ**（GitHub Pages で配信）。

## 守ること

- このリポジトリに問題データ・写真・図を置かない。データは非公開の `rolly634/study-mistakes` だけにある。`demo/` の4問は自作の見本なので例外。
- トークンやユーザーの解答履歴をコードやログに入れない。
- ビルド工程はない。外部 CDN も使わない（オフラインで動かすため、ライブラリは `vendor/` に同梱）。

## 構成

```
index.html, manifest.webmanifest, sw.js   PWA 本体（sw.js がアプリ本体をキャッシュ）
css/app.css                               スマホ幅前提、ダークモード対応
js/app.js      画面（ホーム・出題・一覧・設定）と遷移（#home, #list, #settings, #review, #problem/<id>）
js/data.js     problems.json・図・解答履歴の取得と、reviews/ への書き戻し
js/github.js   GitHub Contents API（raw 取得、PUT）
js/srs.js      間隔反復（× 1日、△ 3日、○ 7→14→28→56日、上限は試験までの残り日数の半分）
js/render.js   Markdown＋LaTeX → HTML（KaTeX、DOMPurify）
js/store.js    IndexedDB（データ）と localStorage（設定・端末ID）
demo/          見本モードのデータ
tests/         Playwright の動作テスト
```

## データの約束（study-mistakes 側の CLAUDE.md と対応）

- 読む：`index/problems.json`、`figures/*.svg`、`originals/*.jpg`（ボタンを押したときだけ）
- 書く：`reviews/<YYYY-MM-DD>-<端末ID>.json` = `{"device", "date", "events": [{"id", "r": "o|d|x", "t": ISO時刻, "chosen", "correct", "dev"}]}`
- 状態（次回日など）は保存せず、毎回 events を時刻順に再生して計算する。

## 変更したら

1. `sw.js` の `VERSION` と `js/app.js` の `VERSION` を同じ値で上げる
2. `python3 tests/test_app.py` が「エラー: なし」になることを確認
3. コミットして push（GitHub Pages に自動で反映）
