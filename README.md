# ECHONET AC Probe

OP-J03DZ / 家庭用エアコンがLAN内に見えるか確認するための最小 Node.js CLI ツール。

## Requirements

- Node.js 18+
- Windows

## Setup

```console
npm install
```

## Usage

### Multicast mode (default)

```console
npm run probe -- --local-address 192.168.x.x
```

Your `--local-address` must be the **LAN-side IPv4 address** of your PC (run `ipconfig` to find it).

### Unicast mode (when multicast doesn't work)

```console
npm run probe -- --local-address 192.168.x.x --target 192.168.x.y
```

Sends the same ECHONET Lite Get directly to a specific IP. Useful when:
- Wi-Fi AP isolation blocks multicast
- The device IP is already known
- You want to probe likely candidates from `arp -a` output

### Options

| Option | Description | Default |
|---|---|---|
| `--local-address <IP>` | Source IPv4 address for binding | _(required)_ |
| `--target <IP>` | Unicast to specific IP instead of multicast | 224.0.23.0 |
| `--timeout <ms>` | Response wait time | 10000 |

```console
npm run probe -- --local-address 192.168.1.100 --timeout 15000
npm run probe -- --local-address 192.168.1.100 --target 192.168.1.50 --timeout 5000
```

### Scan mode

```console
npm run probe -- --local-address 192.168.x.x --scan
```

Scans the entire /24 subnet sequentially, stopping at the first ECHONET Lite response.
Use `--scan-all` to find all devices without stopping.

| Option | Description | Default |
|---|---|---|
| `--scan` | Scan /24 subnet, stop on first hit | — |
| `--scan-all` | Scan /24 subnet fully | — |
| `--scan-interval <ms>` | Delay between probes | 300 |

```console
npm run probe -- --local-address 192.168.0.144 --scan-all --scan-interval 150
```

---

## Inspect — Read EPCs from discovered AC units

```console
npm run inspect -- --local-address 192.168.x.x --target <AC-IP>
```

For each target IP's EOJ `0x013001` (Home Air Conditioner):
1. Gets the property map (EPC `0x9F`) and lists all readable EPCs.
2. Highlights target EPCs: `0x80`, `0x84`, `0x85`, `0x88`, `0xB0`, `0xB3`, `0xBB`, `0xBE`.
3. GETs `0x84` (積算消費電力量) and `0x85` (瞬時消費電力) and shows interpreted values.

Multiple targets:

```console
npm run inspect -- --local-address 192.168.0.144 --target 192.168.0.101 --target 192.168.0.121
```

| Option | Description | Default |
|---|---|---|
| `--local-address <IP>` | Source IPv4 address | _(required)_ |
| `--target <IP>` | Target AC IP (repeatable) | _(required)_ |
| `--timeout <ms>` | Per-request timeout | 5000 |

### What it does

1. **Multicast mode:** Joins multicast group `224.0.23.0:3610` on the specified interface.
   **Unicast mode:** Sends directly to `--target` IP on port 3610.
2. Sends ECHONET Lite **Get** (ESV 0x62) for **Node Profile (0x0EF001)** property **EPC 0xD6** (Self Instance List S).
3. Listens for responses.
4. Parses and displays every response: source IP, raw hex, SEOJ, DEOJ, ESV, EPC, PDC, EDT.
5. If EPC 0xD6 data is present, decodes the EOJ list and marks `0x0130xx` as **Home Air Conditioner candidate**.

### Example output

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

### No response?

```
No ECHONET Lite responses received.
```

Common causes:

| Cause | Check |
|---|---|---|
| Wrong `--local-address` | Run `ipconfig` and confirm the IP belongs to your active LAN adapter |
| Firewall blocking UDP/3610 | Temporarily disable Windows Firewall, or add a rule (see below) |
| AP isolation (client isolation) | Wi-Fi router setting that blocks device-to-device traffic |
| HEMS / ECHONET Lite mode disabled | Check OP-J03DZ settings |
| Different VLAN / subnet | PC and air conditioner must be on the same Layer-2 network |
| Port 3610 already in use | Close other ECHONET Lite apps (e.g. ECHONET Lite Monitor, etc.) |
| Multicast not forwarded | Try unicast mode with `--target <IP>` |

### Firewall rule (admin PowerShell)

```powershell
netsh advfirewall firewall add rule name="EL-Probe" protocol=UDP dir=in localport=3610 action=allow
```

---

## Web App — 富士通ノクリア 状態モニター

継続的に4台のエアコン状態を取得し、Web UI と Prometheus 形式のメトリクスを提供します。

### 起動

```console
npm install
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
| `GET /` | 4台の状態カードUI |
| `GET /health` | `{ "status": "alive", "uptime": ... }` |
| `GET /api/devices` | 設定済みデバイス一覧 |
| `GET /api/status` | 最新取得値のJSON |
| `GET /metrics` | Prometheus形式メトリクス |

### Prometheus メトリクス

| メトリクス名 | 型 | ラベル | 説明 |
|---|---|---|---|
| `nocria_ac_up` | gauge | `room`, `ip` | 1=応答あり, 0=ダウン |
| `nocria_ac_operation_status` | gauge | `room`, `ip` | 1=ON, 0=OFF |
| `nocria_ac_error_status` | gauge | `room`, `ip` | 1=異常あり, 0=正常 |
| `nocria_ac_instant_power_w` | gauge | `room`, `ip` | 瞬時消費電力 (W) |
| `nocria_ac_total_energy_kwh` | gauge | `room`, `ip` | 積算消費電力量 (kWh) |
| `nocria_ac_set_temperature_c` | gauge | `room`, `ip` | 設定温度 (°C) |
| `nocria_ac_room_temperature_c` | gauge | `room`, `ip` | 室内温度 (°C) |
| `nocria_ac_room_humidity_percent` | gauge | `room`, `ip` | 室内湿度 (%) |
| `nocria_ac_stale` | gauge | `room`, `ip` | 1=stale (90s以上未更新) |
| `nocria_ac_last_success_timestamp_seconds` | gauge | `room`, `ip` | 最終成功取得のUnix時刻 |
| `nocria_ac_outdoor_temperature_c` | gauge | `room`, `ip` | 外気温度 (°C、無効値は出力しない) |
| `nocria_ac_outdoor_temperature_valid` | gauge | `room`, `ip` | 外気温度有効性 (1=有効, 0=取得不可) |

### TrueNAS Custom App デプロイメモ

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

## How it works

- **依存ライブラリ最小限**: `probe.js` / `inspect.js` は Node.js 標準 `dgram` のみ。`server.js` は Express のみ追加。
- **プロトコル**: ECHONET Lite (UDP/3610) の GET (ESV 0x62) のみ。SET 系は未実装。
- **ファイル構成**:
  - `src/echonet.js` — 共通プロトコル関数 (buildGet, parseEL, interpret, parseBitmap など)
  - `src/probe.js` — 機器探索CLI (Node Profile 0x0EF001, EPC 0xD6)
  - `src/inspect.js` — EPC読み取りCLI (Air Conditioner 0x013001)
  - `src/poller.js` — 継続的ポーリングエンジン
  - `src/server.js` — Express Webサーバ (API + UI + Prometheus)
  - `config.json` — デバイス設定
