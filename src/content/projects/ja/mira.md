---
title: Mira — 家計簿アプリ
description: ローカルファースト設計の家計簿PWA。Vue 3 / Quasar のフロントエンドと FastAPI + PostgreSQL のバックエンドで構築。
image: /projects/mira/hero.webp
lang: ja
order: 1
tags: ['Full-stack', 'Vue 3', 'TypeScript', 'FastAPI', 'PostgreSQL', 'PWA']
---

Mira は、設計から実装・デプロイまで一貫して自分で手がけたモバイルファーストの家計簿アプリです。**ローカルファースト**設計により、すべての操作は端末内の IndexedDB に対して即座に行われ、完全オフラインでも動作します。オンラインに戻ると、独自実装の同期エンジンがサーバーと変更を照合します。

<p class="project-cta-row">
  <a class="project-cta" href="https://mira-spending-tracker.vercel.app/" target="_blank" rel="noopener noreferrer">Mira を試してみる&nbsp;↗</a>
</p>

PWA なので、ブラウザからそのままアプリとしてインストールできます。スマホならホーム画面に追加、PCならアドレスバーからインストール可能です。

<video class="project-video" autoplay loop muted playsinline poster="/projects/mira/home.webp">
  <source src="/projects/mira/mira-tour.mp4" type="video/mp4" />
</video>

## 主な機能

- **月間サマリー** — 収入・支出・残額をカテゴリ別ドーナツチャートでひと目で確認
- **すばやい入力** — カテゴリ・サブカテゴリを選んで数秒で記録完了
- **マルチ通貨対応** — 19通貨をサポート。取引ごとに通貨を記録でき、月間サマリーも通貨別に集計されるため、不正確な為替換算がありません
- **定期取引** — 家賃・給料・サブスクなどを繰り返しルールから自動生成(シリーズの停止・再開・削除も可能)
- **レポート** — 3ヶ月 / 6ヶ月 / 1年 / 2年 / 年初来の収支推移とカテゴリ別ランキング
- **カスタムカテゴリ** — アイコン設定、サブカテゴリ、ドラッグ&ドロップでの並び替え
- **インストール可能なPWA** — オフライン対応のService Worker、ホーム画面への追加、ダーク/ライトテーマ、日英対応UI

## 仕組み

フロントエンドは **Vue 3 + Quasar(TypeScript)**。状態管理に Pinia、グラフ描画に Chart.js を使用しています。読み書きはすべて **IndexedDB(Dexie)** に対して行われるため、UIがネットワークを待つことはありません。

バックエンドは **FastAPI + PostgreSQL**。Docker でパッケージ化し、GitHub Actions のパイプラインで Oracle Cloud にデプロイしています。差分**同期プロトコル**が未同期のローカル変更(論理削除のトゥームストーンを含む)をプッシュし、同期トークンでリモートの変更をプルして、競合はダイアログで確認できます。

アカウント登録は**任意**です。データはすべて端末内にあるため、サインアップなしで全機能が使えます。アカウント(メールアドレス+パスワード)は、データのバックアップと複数デバイス間の同期にのみ必要です。

## スクリーンショット

<div class="project-shots">
  <figure><img src="/projects/mira/home.webp" alt="ホーム — ドーナツチャート付き月間サマリー" loading="lazy" /><figcaption>ホーム</figcaption></figure>
  <figure><img src="/projects/mira/report.webp" alt="レポート — 6ヶ月の収支推移" loading="lazy" /><figcaption>レポート</figcaption></figure>
  <figure><img src="/projects/mira/transactions.webp" alt="取引一覧 — 検索と月間サマリー" loading="lazy" /><figcaption>取引一覧</figcaption></figure>
  <figure><img src="/projects/mira/recurring.webp" alt="定期取引の管理" loading="lazy" /><figcaption>定期取引</figcaption></figure>
  <figure><img src="/projects/mira/categories.webp" alt="ドラッグ&ドロップ対応のカテゴリ管理" loading="lazy" /><figcaption>カテゴリ</figcaption></figure>
  <figure><img src="/projects/mira/input.webp" alt="支出入力フォーム" loading="lazy" /><figcaption>入力</figcaption></figure>
</div>

*スクリーンショットはデモデータです。*

<details class="dev-notes">
<summary>技術詳細 — 開発者向けノート</summary>

### ローカルファーストなデータ層

- Dexie(IndexedDB)の4テーブル — `categories`、`subcategories`、`series`、`expenses` — がUIの単一の情報源。読み書きがネットワークを待つことは一切ありません。
- すべての行がクライアント生成ID、`updated_at` タイムスタンプ、論理削除のトゥームストーン(`is_deleted`)、同期管理フラグ(`is_synced`、`is_new`)を持ちます。
- 削除は物理削除ではなくトゥームストーン化されるため、他デバイスにも削除が伝播し、消したはずのデータが復活しません。

### 同期エンジン

- FastAPI バックエンドとの差分同期:未同期の行(トゥームストーン含む)をプッシュし、同期トークンを使ってリモートの変更を増分プル。全件転送は行いません。
- サーバーがプッシュを確認応答するとローカルの `is_synced` が立ち、`is_new` により同期結果ダイアログで「追加」と「変更」を区別できます。
- 競合(例:サーバーが受け取っていない親を参照する行)は、静かに失敗するのではなく確認ダイアログに表示されます。

### 認証

- メールアドレス+パスワードによるサインアップ/ログイン。パスワードはサーバー側で **Argon2**(`pwdlib` 使用)によりハッシュ化され、平文では保存されません。
- **JWTペア**方式:短命なアクセストークン(15分)がAPIリクエストを認証し、長命なリフレッシュトークンが新しいアクセストークンを自動取得するため、再ログインなしでサインイン状態が維持されます。
- アクセストークンは `sessionStorage`、リフレッシュトークンは `localStorage` に保存。axios のインターセプターが Bearer ヘッダーを付与し、401 応答時は**シングルフライトのトークン更新**を実行します(同時に失敗した複数のリクエストは、それぞれが更新を試みるのではなく、キューに入って新トークンで再試行)。更新自体が失敗した場合はトークンを破棄してサインアウトします。
- 認証が保護するのは同期APIのみ。ローカルデータへのアクセスがロックされることはありません。

### 定期取引

- `series` 行が繰り返しルール(間隔・単位・開始/終了日)を保持し、各回の取引は `series_local_id` で紐づく通常の支出行として実体化されます。
- 各回が通常の行なので、レポート・フィルタ・同期のすべてで特別扱いが不要。シリーズの停止は将来の取引を切り詰めるだけです。

### マルチ通貨モデル

- 通貨(19通貨をサポート)はグローバル設定ではなく取引ごとに保存。海外旅行中の現地通貨での記録と、普段の通貨での記録が共存できます。
- 集計は為替換算せず通貨別にグループ化するため、表示されるすべての数字が正確です。

### PWA

- Workbox によるService Worker(プリキャッシュ+ランタイムキャッシュ戦略)、カスタムインストールバナー、フルアイコンセット(Android マスカブルアイコン、iOS ホーム画面アイコン、スプラッシュ画面)。
- 開発/本番の分離:開発時はService Workerなしの通常SPA(ホットリロードを妨げない)、リリースビルドで完全なPWAを出荷。

### 技術スタックとデプロイ

- **フロントエンド:** Vue 3 + TypeScript、Quasar、Pinia、Tailwind、Chart.js、vue-i18n(日英対応)— Vercel にデプロイ。
- **バックエンド:** FastAPI + PostgreSQL。Docker コンテナ化して Oracle Cloud 上で稼働、GitHub Actions で自動デプロイ。同期エンドポイントは pytest でテスト済み。

</details>
