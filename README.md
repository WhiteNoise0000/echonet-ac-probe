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
npm run probe -- --local-address 192.168.1.10 --scan-all --scan-interval 150
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
npm run inspect -- --local-address 192.168.1.10 --target 192.168.1.101 --target 192.168.1.102
```

| オプション | 説明 | デフォルト |
|---|---|---|
| `--local-address <IP>` | 送信元IPv4アドレス | _(必須)_ |
| `--target <IP>` | 対象ACのIP (複数指定可) | _(必須)_ |
| `--timeout <ms>` | 1リクエストあたりのタイムアウト | 2000 |

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

設定は `config.json` または環境変数で行います。
`config.example.json` をコピーして編集してください。
`config.json` は `.gitignore` に含まれているため誤 commit を防げます。
`CONFIG_PATH` 環境変数で設定ファイルのパスを変更できます。

### config.json

```json
{
  "localAddress": "192.168.x.xxx",
  "pollIntervalMs": 30000,
  "requestTimeoutMs": 2000,
  "httpPort": 3000,
  "devices": [
    { "ip": "192.168.1.101", "id": "living-room", "name": "Living Room" },
    { "ip": "192.168.1.102", "id": "study", "name": "Study" }
  ]
}
```

#### devices の各フィールド

| 項目 | 必須 | 説明 |
|---|---|---|
| `ip` | ✅ | エアコンのIPアドレス |
| `id` | | 安定識別子。Prometheusラベルとして使われる。未指定時は `room`→`ip` にfallback |
| `name` | | UI表示名・Prometheus `name` ラベル。未指定時は `room`→`id`→`ip` にfallback |
| `room` | | 後方互換用。`id` 未指定時にfallback。Prometheus `room` ラベルとしても出力継続 |

#### 環境変数による上書き

| 変数名 | 説明 |
|---|---|
| `CONFIG_PATH` | config.json のパス (デフォルト: `./config.json`) |
| `LOCAL_ADDRESS` | 送信元IPv4アドレス |
| `HTTP_PORT` | Webサーバのポート |
| `POLL_INTERVAL_MS` | ポーリング間隔 (ms) |
| `REQUEST_TIMEOUT_MS` | 1リクエストあたりのタイムアウト (ms) (推奨 2000) |
| `DEVICES_JSON` | devices 配列をJSON文字列で直接指定 (config.jsonより優先) |

TrueNAS / Docker Compose での使用例:

```yaml
environment:
  LOCAL_ADDRESS: "192.168.1.10"
  HTTP_PORT: "3000"
  DEVICES_JSON: '[{"ip":"192.168.1.101","id":"living-room","name":"Living Room"},{"ip":"192.168.1.102","id":"study","name":"Study"}]'
```

### API

| エンドポイント | 説明 |
|---|---|
| `GET /` | 状態カードUI |
| `GET /health` | `{ "status": "alive", "uptime": ... }` |
| `GET /api/devices` | 設定済みデバイス一覧 |
| `GET /api/status` | 最新取得値のJSON |
| `GET /metrics` | Prometheus形式メトリクス |

### Prometheus メトリクス

全メトリクスに以下のラベルが付与されます:

| ラベル | 説明 |
|---|---|
| `id` | 安定識別子 (`device.id` → `room` → `ip` の順に決定) |
| `name` | 表示名 (`device.name` → `room` → `id` → `ip`) |
| `room` | 後方互換用 (`device.room` → `id` → `ip`)。`id` と同じ値になる場合あり |
| `ip` | IPアドレス |

| メトリクス名 | 型 | 説明 |
|---|---|---|
| `nocria_ac_up` | gauge | 1=応答あり, 0=ダウン |
| `nocria_ac_stale` | gauge | 1=stale (90秒以上未更新) |
| `nocria_ac_last_success_timestamp_seconds` | gauge | 最終成功取得のUnix時刻 |
| `nocria_ac_operation_status` | gauge | 1=ON, 0=OFF |
| `nocria_ac_error_status` | gauge | 1=異常あり, 0=正常 |
| `nocria_ac_instant_power_w` | gauge | 瞬時消費電力 (W) |
| `nocria_ac_total_energy_kwh` | gauge | 積算消費電力量 (kWh) |
| `nocria_ac_set_temperature_c` | gauge | 設定温度 (°C、自動制御時は出力しない) |
| `nocria_ac_set_temperature_valid` | gauge | 設定温度有効性 (1=有効, 0=自動制御/取得不可) |
| `nocria_ac_room_temperature_c` | gauge | 室内温度 (°C) |
| `nocria_ac_room_humidity_percent` | gauge | 室内湿度 (%) |
| `nocria_ac_outdoor_temperature_c` | gauge | 外気温度 (°C、無効値は出力しない) |
| `nocria_ac_outdoor_temperature_valid` | gauge | 外気温度有効性 (1=有効, 0=取得不可) |

### Docker / TrueNAS Custom App デプロイ

#### ビルド済みイメージ

```console
docker pull ghcr.io/whitenoise0000/echonet-ac-probe:latest
```

GitHub Container Registry で公開されています。認証なしで pull 可能です。

#### compose.yaml 例

`compose.yaml.example` を参照してください:

```yaml
services:
  echonet-ac-probe:
    image: ghcr.io/whitenoise0000/echonet-ac-probe:latest
    network_mode: host
    restart: unless-stopped
    environment:
      - CONFIG_PATH=/config/config.json
      - TZ=Asia/Tokyo
    volumes:
      - ./config.json:/config/config.json:ro
```

#### 環境変数だけで動かす例 (config.json不要)

`LOCAL_ADDRESS` は単一NIC環境では省略可能です。
複数NIC / VLAN / VPN 環境では明示指定を推奨します。

```yaml
services:
  echonet-ac-probe:
    image: ghcr.io/whitenoise0000/echonet-ac-probe:latest
    network_mode: host
    restart: unless-stopped
    environment:
      - LOCAL_ADDRESS=192.168.1.10
      - HTTP_PORT=3000
      - DEVICES_JSON=[{"ip":"192.168.1.101","id":"living-room","name":"Living Room"},{"ip":"192.168.1.102","id":"study","name":"Study"}]
      - TZ=Asia/Tokyo
```

#### ローカルビルド

```console
docker build -t echonet-ac-probe:test .
docker run --rm echonet-ac-probe:test node src/test.js
docker run --rm --network=host -v /path/to/config.json:/config/config.json:ro echonet-ac-probe:test
```

#### TrueNAS 設定の要点

| 項目 | 設定 |
|---|---|
| イメージ | `ghcr.io/whitenoise0000/echonet-ac-probe:latest` |
| ネットワーク | **Host Networking** (UDP/3610 マルチキャストのため) |
| ボリューム | `/mnt/pool/path/config.json` → `/config/config.json` (read-only) |
| 環境変数 | `TZ=Asia/Tokyo`, `CONFIG_PATH=/config/config.json` |
| 特権昇格 | 不要 (通常のUDP送受信のみ) |

`/config/config.json` は read-only でマウントしてください。アプリは設定ファイルに書き込みを行いません。

> **実設定をイメージに含めないでください。**
> Dockerイメージには `config.example.json` のみ含まれています。
> 実際の `config.json` (IPアドレス・MACアドレス・部屋名など) は
> volume mount または環境変数で注入してください。

### IP変動への備え

各エアコンは EPC `0x83` (識別番号) を保持しており、`npm run inspect` で確認できます。
4台の `0x83` が各々一意であることを確認済みです。

将来 IP が変わっても `0x83` をキーに自動再探索できる可能性があります。
現時点では **各エアコンのIPをDHCP固定** にすることを推奨します。

## 読み取り専用

このアプリケーションは **ECHONET Lite GET のみ** を送信します。
SET、SetC、SetI、Write などの制御コマンドは一切実装されていません。
ON/OFF変更、設定温度変更、運転モード変更はできません。

## 仕組み

- **依存ライブラリ最小限**: `probe.js` / `inspect.js` は Node.js 標準 `dgram` のみ。`server.js` は Express のみ追加。
- **プロトコル**: ECHONET Lite (UDP/3610) の GET (ESV 0x62) のみ。SET 系は未実装。
- **ポーリング最適化**: 11 EPC を1リクエストにまとめて送信 (opc=11)。応答は一括で処理。4台でも約2秒で完了。
- **ファイル構成**:
  - `src/echonet.js` — 共通プロトコル関数 (buildGet, parseEL, interpret, parseBitmap など)
  - `src/probe.js` — 機器探索CLI (Node Profile 0x0EF001, EPC 0xD6)
  - `src/inspect.js` — EPC読み取りCLI (Air Conditioner 0x013001)
  - `src/poller.js` — 継続的ポーリングエンジン
  - `src/server.js` — Express Webサーバ (API + UI + Prometheus)
  - `config.json` — デバイス設定 (Git管理外。`config.example.json` をコピーして作成)
