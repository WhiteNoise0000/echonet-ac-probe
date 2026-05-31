# ECHONET AC Probe

富士通ノクリア (OP-J03DZ) 対応 ECHONET Lite エアコン探索・状態監視ツール

## 必要環境

- Node.js 18+
- Windows

## セットアップ

```console
npm install
```

## 使い方 (CLI)

### マルチキャスト探索 (default)

```console
npm run probe -- --local-address 192.168.x.x
```

`--local-address` には PC の LAN 側 IPv4 アドレスを指定します (`ipconfig` で確認)。

### ユニキャスト探索 (マルチキャストが通らない場合)

```console
npm run probe -- --local-address 192.168.x.x --target 192.168.x.y
```

ECHONET Lite Get を特定 IP に直接送信します。以下の場合に有効:
- Wi-Fi AP分離 (クライアント分離) でマルチキャストがブロックされている
- 機器の IP が既知
- `arp -a` の出力から候補を探す

### オプション

| オプション | 説明 | デフォルト |
|---|---|---|
| `--local-address <IP>` | 送信元IPv4アドレス | _(必須)_ |
| `--target <IP>` | ユニキャスト送信先 | 224.0.23.0 |
| `--timeout <ms>` | 応答待機時間 | 10000 |

```console
npm run probe -- --local-address 192.168.1.100 --timeout 15000
npm run probe -- --local-address 192.168.1.100 --target 192.168.1.50 --timeout 5000
```

### スキャンモード

```console
npm run probe -- --local-address 192.168.x.x --scan
```

/24 サブネットを順次スキャンし、最初に応答があった ECHONET Lite 機器で停止します。
`--scan-all` で全台検出:

| オプション | 説明 | デフォルト |
|---|---|---|
| `--scan` | サブネットスキャン (初回応答で停止) | — |
| `--scan-all` | サブネットスキャン (全台) | — |
| `--scan-interval <ms>` | プローブ間隔 | 300 |

```console
npm run probe -- --local-address 192.168.0.144 --scan-all --scan-interval 150
```

---

## Inspect — 発見済みエアコンのEPC読み取り

```console
npm run inspect -- --local-address 192.168.x.x --target <AC-IP>
```

各対象IPの EOJ `0x013001` (Home Air Conditioner) に対して:
1. Getプロパティマップ (EPC `0x9F`) を取得し、読み取り可能なEPC一覧を表示
2. 注目EPC (`0x80`, `0x84`, `0x85`, `0x88`, `0xB0`, `0xB3`, `0xBB`, `0xBE`) をハイライト
3. 各EPCをGETし、解釈値を表示

複数台同時:

```console
npm run inspect -- --local-address 192.168.0.144 --target 192.168.0.101 --target 192.168.0.121
```

| オプション | 説明 | デフォルト |
|---|---|---|
| `--local-address <IP>` | 送信元IPv4アドレス | _(必須)_ |
| `--target <IP>` | 対象ACのIP (複数指定可) | _(必須)_ |
| `--timeout <ms>` | 1リクエストあたりのタイムアウト | 5000 |

### 動作

1. **マルチキャストモード:** `224.0.23.0:3610` にマルチキャスト参加
   **ユニキャストモード:** `--target` IP のポート 3610 に直接送信
2. **Node Profile (0x0EF001)** の **EPC 0xD6** (Self Instance List S) を Get
3. 応答を待受、表示: 送信元IP, raw hex, SEOJ, DEOJ, ESV, EPC, PDC, EDT
4. EPC 0xD6 の応答時は EOJ一覧をパースし、`0x0130xx` に **Home Air Conditioner candidate** マーク

### 出力例

```
ECHONET Lite Probe
  Target:    224.0.23.0:3610
  Source:    192.168.1.100
  Timeout:   10000ms
  Query:     Node Profile (0x0EF001) EPC 0xD6 (Instance List S)

Sent Get(EPC=0xD6) to 224.0.23.0:3610
Response from 192.168.1.50
  Raw Hex:  10 81 00 01 0e f0 01 0e f0 01 72 01 d6 06 01 30 01 05 ff 01
  SEOJ:     0x0ef001
  DEOJ:     0x0ef001
  ESV:      0x72 (Get_Res)
  EPC:      0xd6
  PDC:      6
  EDT:      01 30 01 05 ff 01
  EOJ List (2 objects):
    0x013001  ← Home Air Conditioner candidate
    0x05ff01
```

### 応答がない場合

```
No ECHONET Lite responses received.
```

主な原因:

| 原因 | 確認方法 |
|---|---|---|
| `--local-address` が間違っている | `ipconfig` で正しいLAN側IPを確認 |
| ファイアウォールが UDP/3610 をブロック | 一時的に無効化、または受信許可ルール追加 |
| AP分離 (クライアント分離) | Wi-Fiルーターの設定を確認 |
| HEMS/ECHONET Lite モード未設定 | OP-J03DZ の設定を確認 |
| 別VLAN/サブネット | PCとエアコンを同一L2ネットワークに |
| ポート3610が既に使用中 | 他アプリケーションを終了 |
| マルチキャストが転送されていない | `--target` でユニキャストを試す |

### ファイアウォールルール (管理者PowerShell)

```powershell
netsh advfirewall firewall add rule name="EL-Probe" protocol=UDP dir=in localport=3610 action=allow
```

---

## Web App — 状態モニター

継続的にエアコン状態を取得し、Web UI と Prometheus 形式のメトリクスを提供します。

### 起動

```console
npm start        # or: npm run dev
```

設定は `config.json` で行います。

### 設定 (config.json)

```json
{
  "localAddress": "192.168.0.144",
  "pollIntervalMs": 30000,
  "requestTimeoutMs": 5000,
  "httpPort": 3000,
  "devices": [
    { "ip": "192.168.0.101", "room": "101" },
    { "ip": "192.168.0.121", "room": "121" },
    { "ip": "192.168.0.122", "room": "122" },
    { "ip": "192.168.0.133", "room": "133" }
  ]
}
```

| 項目 | 説明 |
|---|---|
| `localAddress` | 自PCのLAN側IPv4アドレス (必須) |
| `pollIntervalMs` | ポーリング間隔 (デフォルト 30000) |
| `requestTimeoutMs` | 1リクエストあたりのタイムアウト |
| `httpPort` | Webサーバのポート |
| `devices` | 監視対象エアコンの一覧。`ip` と `room` 名を指定 |

### API

| エンドポイント | 説明 |
|---|---|
| `GET /` | 状態カードUI |
| `GET /health` | `{ "status": "alive", "uptime": ... }` |
| `GET /api/devices` | 設定済みデバイス一覧 |
| `GET /api/status` | 最新取得値のJSON |
| `GET /metrics` | Prometheus形式メトリクス |

### Prometheus メトリクス

| メトリクス名 | 型 | ラベル | 説明 |
|---|---|---|---|
| `nocria_ac_up` | gauge | `room`, `ip` | 1=応答あり, 0=ダウン |
| `nocria_ac_stale` | gauge | `room`, `ip` | 1=stale (90秒以上未更新) |
| `nocria_ac_last_success_timestamp_seconds` | gauge | `room`, `ip` | 最終成功取得のUnix時刻 |
| `nocria_ac_operation_status` | gauge | `room`, `ip` | 1=ON, 0=OFF |
| `nocria_ac_error_status` | gauge | `room`, `ip` | 1=異常あり, 0=正常 |
| `nocria_ac_instant_power_w` | gauge | `room`, `ip` | 瞬時消費電力 (W) |
| `nocria_ac_total_energy_kwh` | gauge | `room`, `ip` | 積算消費電力量 (kWh) |
| `nocria_ac_set_temperature_c` | gauge | `room`, `ip` | 設定温度 (°C) |
| `nocria_ac_room_temperature_c` | gauge | `room`, `ip` | 室内温度 (°C) |
| `nocria_ac_room_humidity_percent` | gauge | `room`, `ip` | 室内湿度 (%) |
| `nocria_ac_outdoor_temperature_c` | gauge | `room`, `ip` | 外気温度 (°C、無効値は出力しない) |
| `nocria_ac_outdoor_temperature_valid` | gauge | `room`, `ip` | 外気温度有効性 (1=有効, 0=取得不可) |

### TrueNAS Custom App デプロイ

Dockerfile 例:

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --production
COPY . .
EXPOSE 3000
CMD ["node", "src/server.js"]
```

注意点:
- `--net=host` または `CAP_NET_RAW` / `CAP_NET_ADMIN` が必要な場合あり (UDP/3610 raw socket)
- `config.json` は外部 volume マウント推奨 (`/app/config.json`)
- 環境変数による上書きを検討する場合は `config.json` の値を process.env で読み替え

### 読み取り専用

このWebアプリは **ECHONET Lite GET のみ** を送信します。
SET、SetC、SetI、Write などの制御コマンドは一切実装されていません。
ON/OFF変更、設定温度変更、運転モード変更はできません。

---

## 仕組み

- **依存ライブラリ最小限**: `probe.js` / `inspect.js` は Node.js 標準 `dgram` のみ。`server.js` は Express のみ追加。
- **プロトコル**: ECHONET Lite (UDP/3610) の GET (ESV 0x62) のみ。SET 系は未実装。
- **ファイル構成**:
  - `src/echonet.js` — 共通プロトコル関数 (buildGet, parseEL, interpret, parseBitmap など)
  - `src/probe.js` — 機器探索CLI (Node Profile 0x0EF001, EPC 0xD6)
  - `src/inspect.js` — EPC読み取りCLI (Air Conditioner 0x013001)
  - `src/poller.js` — 継続的ポーリングエンジン
  - `src/server.js` — Express Webサーバ (API + UI + Prometheus)
  - `config.json` — デバイス設定
