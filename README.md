# 誤答トレーニング

間違えた問題（誤答）と、チャットで調べた事柄から作った問題（調べもの）を、○△× の間隔反復で復習する Android 向けの Web アプリ（PWA）。
問題データは非公開リポジトリ `study-mistakes` にあり、このリポジトリにはアプリ本体と自作の見本（誤答4問・調べもの2問）だけを置く。

公開先：https://rolly634.github.io/study-mistakes-app/

## はじめての設定

### 1. GitHub Pages を有効にする（最初の1回だけ）

このリポジトリの **Settings → Pages** で、Source を「Deploy from a branch」、Branch を `main` と `/ (root)` にして Save。数分で上の公開先が開けるようになる。

### 2. トークンを作る

アプリが非公開リポジトリを読み書きするための鍵。`study-mistakes` だけに権限を絞る。

1. GitHub 右上のアイコン → **Settings** → 左下の **Developer settings** → **Personal access tokens** → **Fine-grained tokens** → **Generate new token**
2. Token name：`誤答トレーニング`、Expiration：試験の後（例：2027年4月30日）
3. Repository access：**Only select repositories** → `rolly634/study-mistakes`
4. Permissions → Repository permissions → **Contents：Read and write**（Metadata は自動で Read-only）
5. **Generate token** を押し、表示された `github_pat_...` をコピー（この画面でしか表示されない）

### 3. スマホに入れる

1. Android の Chrome で公開先を開く
2. 右上の ⋮ → **アプリをインストール**（または「ホーム画面に追加」）
3. アプリの **設定** にトークンを貼り付け → **保存して接続を確認**

トークンを入れる前に、設定の「見本モードで試す」で操作を確かめられる。

## 使い方

- **ホーム**：今日の復習の問題数。「誤答／調べもの」と科目で絞り込める。「始める」で出題。
- **出題**：選択肢をタップ（わからなければ「答えを見る」）→ 解説と、誤答なら「前回の間違い／防ぐには」、調べものなら「覚えておくこと」と「元の疑問と解説」→ 理解度で ○△× を押す。電験は本番と同じ (1)〜(5) の5択。
- **間隔反復**：× は翌日、△ は3日後、○ は 7日 → 14日 → 28日 → 56日 と延びる。試験までに必ずもう一度出るよう、間隔は試験（数学・物理・英語は3/4、電験は3/21）までの残り日数の半分が上限。
- **一覧**：科目別・週別に全問題。タップで1問だけ解ける。「疑問ノート」では調べた事柄の解説と、そこから作った問題を見られる。
- **同期**：解答は端末に保存し、オンラインになると `study-mistakes/reviews/` に書き戻す。端末を替えても履歴は戻る。

## 開発メモ

- ビルドなし（HTML/CSS/JS の ES モジュール）。KaTeX・marked・DOMPurify は `vendor/` に同梱（ライセンスは `vendor/licenses/`）。
- 変更したら `sw.js` の `VERSION` と `js/app.js` の `VERSION` を上げる（端末のキャッシュを更新するため）。
- テスト：`python3 tests/test_app.py`（Playwright。`DATA_REPO` で study-mistakes の場所を指定）。
