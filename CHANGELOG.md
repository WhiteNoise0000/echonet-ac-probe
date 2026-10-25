# Changelog

## 1.0.0 - 2026-10-25

初回安定版リリース。

### 機能

- ECHONET Lite対応エアコンの探索、EPC読み取り、定期ポーリング。
- 状態確認用Web UI、JSON API、Prometheusメトリクス。
- Docker / TrueNAS向けコンテナとビルド情報API。
- トランザクションIDの循環処理と一時的なGET失敗時のリトライ。

### セキュリティ

- Dockerのビルド・実行環境とCIをBun 1.4.4へ更新。
  同梱Brotliの範囲外書き込み脆弱性
  [CVE-2026-111497 / GHSA-663w-cv8g-jj2p](https://github.com/oven-sh/bun/security/advisories/GHSA-663w-cv8g-jj2p)
  の修正を含む。
- body-parser 1.20.8への更新を含む。

### 更新時の注意

- ローカル環境は `bun upgrade` でBun 1.4.4以降に更新する。
- コンテナは修正版Bunを含むイメージへ更新して再作成する。
- タグのpushでGHCRイメージの公開ワークフローが実行される。
