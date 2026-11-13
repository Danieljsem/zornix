<div align="center">

<img src="assets/logo.svg" alt="Zornix" width="96">

# Zornix

**A fast, good-looking desktop viewer for your IP cameras and NVR.**
Live RTSP grid up to 5×5, one-click full screen, and recording playback with a scrubbable 24-hour timeline.
No cloud, no account, no browser plugin. Your video never leaves your network.

[![License: MIT](https://img.shields.io/badge/license-MIT-35E0D0.svg)](LICENSE)
![Electron](https://img.shields.io/badge/Electron-33-35E0D0.svg)
![Platform](https://img.shields.io/badge/tested%20on-Windows-35E0D0.svg)
![Cloud](https://img.shields.io/badge/cloud-none-35E0D0.svg)

<img src="docs/live-grid.png" alt="Zornix live view: 3×3 camera grid (demo mode)" width="900">

<sub>Screenshot taken in built-in demo mode. Those test patterns stand in for your cameras.</sub>

</div>

---

## Why Zornix?

Most cheap NVR/IP camera systems ship with clunky viewer software: Windows-only CMS tools from 2012,
web UIs that need Internet Explorer, or phone apps that send everything through someone else's cloud.

Zornix is the viewer I wanted for a real site with **30+ cameras**:

- **Opens straight to your cameras.** Click cameras in the sidebar and they stream. Nothing else to set up.
- **Stays smooth with lots of streams.** Every stream gets its own ffmpeg worker, plus a watchdog and auto-reconnect.
  A camera that drops off reconnects by itself. You never have to refresh.
- **Works locally.** Video goes from the camera to your PC over your LAN or VPN and nowhere else.
- **Lets you rewind.** Recording playback talks directly to XMeye / Sofia-based NVRs over their native DVRIP protocol.
  That's the protocol behind a huge share of budget NVRs and cameras.
- **Is easy to work with.** About 1,600 lines of plain JavaScript. No framework and no build step.

## Features

| | |
|---|---|
| 🟦 **Live grid** | 1 / 2×2 / 3×3 / 4×4 / 5×5 layouts, paging across up to 50 selected cameras, stream quality picked automatically from tile size |
| 🔍 **Full screen** | Double-click any tile → switches to a high-bitrate 720p stream |
| ⏪ **Playback** | 24-hour timeline with recorded segments and motion events, click to seek, 0.5×–8× speed, ±10 s / ±60 s stepping |
| 📸 **Snapshots** | Save the current frame of any camera as PNG |
| 🩺 **Health at a glance** | Online / connecting / no-signal counters with per-tile status badges |
| ♻️ **Self-healing streams** | Watchdog restarts dead streams on the same port, so the UI never needs a reload |
| ⌨️ **Keyboard-first** | `1`–`5` layouts · `B` sidebar · `Space` play/pause · `←/→` seek (`Shift` = 1 min) · `Esc` exit |
| 🌍 **English + Czech UI** | Picked automatically from your OS language |
| 🧪 **Demo mode** | Try it with no cameras at all (synthetic feeds + a fake day of recordings) |

<p align="center">
  <img src="docs/playback.png" alt="Recording playback with 24-hour timeline" width="49%">
  <img src="docs/live-2x2.png" alt="2×2 layout with paging" width="49%">
</p>

## Quick start

Requires **Node.js 18+**. Developed and tested on Windows 10/11. Electron and ffmpeg-static also support macOS and Linux, but those platforms haven't been tested yet, so reports are welcome.

```bash
git clone https://github.com/Danieljsem/zornix.git
cd zornix
npm install        # also downloads a matching ffmpeg binary (ffmpeg-static)
npm run demo       # try it without cameras
```

When you're ready to connect real cameras:

```bash
cp cameras.example.json cameras.json   # then edit it (see below)
npm start
```

> No `cameras.json`? Zornix starts in demo mode automatically. A **DEMO MODE** badge in the top bar tells you.

## Adding your cameras

`cameras.json` is a plain list of cameras:

```json
[
  { "ip": "192.168.1.101", "label": "Cam 01 Front door", "rtsp": "rtsp://admin:PASSWORD@192.168.1.101:554/..." },
  { "ip": "192.168.1.102", "label": "Cam 02 Driveway",   "rtsp": "rtsp://...", "channel": 1 }
]
```

| Field | Meaning |
|---|---|
| `ip` | Unique ID of the camera (shown under the label) |
| `label` | Display name. The first number in it becomes the tile's **CAM nn** tag |
| `rtsp` | Any RTSP URL ffmpeg can open. Use the camera's **sub-stream** for grids |
| `channel` | *(optional)* NVR channel for playback, 0-based. Defaults to the camera's position in the list |

**Common RTSP URL formats** (sub-stream):

| Brand / firmware | URL |
|---|---|
| XMeye / XiongMai / Sofia (many budget brands) | `rtsp://IP:554/user=USER_password=PASS_channel=0_stream=1.sdp?real_stream` |
| Hikvision & OEMs | `rtsp://USER:PASS@IP:554/Streaming/Channels/102` |
| Dahua & OEMs | `rtsp://USER:PASS@IP:554/cam/realmonitor?channel=1&subtype=1` |
| Reolink | `rtsp://USER:PASS@IP:554/h264Preview_01_sub` |
| Generic ONVIF | Get the URL with [ONVIF Device Manager](https://sourceforge.net/projects/onvifdm/) |

Quick check before adding a camera: `ffplay "rtsp://..."` should show video.

## Recording playback (NVR)

Switch to **Recordings**, open **Settings** (bottom of the sidebar), then enter your NVR's IP, port (default `34567`), username and password, and click **Test connection**.
Pick a camera and a day. The timeline fills with recorded segments (motion events highlighted), and you click anywhere to play from that moment.

Playback speaks **DVRIP** (also called the Sofia / XMeye protocol, TCP 34567). `dvrip.js` is a dependency-free Node client for it:
login with Sofia hash, keep-alive, `OPFileQuery`, `OPPlayBack` by time, and media de-framing of H.264 / H.265.
You can use it on its own in other projects:

```js
const { DVRIP } = require('./dvrip');
const nvr = new DVRIP('192.168.1.50', { user: 'admin', password: '...' });
await nvr.login();
const files = await nvr.queryFiles(0, '2026-01-31 00:00:00', '2026-01-31 23:59:59');
nvr.close();
```

> **Status: beta.** The DVRIP login, hashing and framing are verified against real XiongMai hardware.
> End-to-end playback behaviour differs between NVR firmwares, so please [open an issue](../../issues) with your NVR model if something doesn't work.
> Live view (RTSP) works with any camera brand.

## How it works

```mermaid
flowchart LR
  subgraph LAN
    C[IP cameras] -- RTSP --> F1
    N[NVR] -- DVRIP :34567 --> D[dvrip.js]
  end
  subgraph Zornix main process
    F1[ffmpeg per camera] -- MPEG-1 TS --> W1[WebSocket 127.0.0.1]
    D -- raw H.264/H.265 --> F2[ffmpeg] -- MPEG-1 TS --> W2[WebSocket 127.0.0.1]
  end
  W1 --> J[JSMpeg → WebGL canvas]
  W2 --> J
```

- Each camera is transcoded by ffmpeg to low-latency **MPEG-1** and pushed over a local WebSocket (OS-assigned port, bound to `127.0.0.1`)
  to [JSMpeg](https://github.com/phoboslab/jsmpeg), which decodes it in WebGL. That gives sub-second latency and needs no codec support in Chromium.
- The renderer is sandboxed (`contextIsolation`, no `nodeIntegration`). It only reaches the main process through a small `window.api` bridge in `preload.js`.
- Bitrate and resolution scale with layout: 480×270 in big grids, 640×360 in 2×2, 1280×720 in full screen.

```
main.js      Electron main: stream manager, watchdog, IPC, NVR sessions
dvrip.js     DVRIP / Sofia protocol client (Node, zero dependencies)
preload.js   Secure renderer bridge
index.html   UI layout + design tokens (CSS variables)
app.js       UI logic: grid, paging, playback timeline, shortcuts
i18n.js      English / Czech strings
```

## Configuration

| Environment variable | Purpose |
|---|---|
| `FFMPEG_PATH` | Use a specific ffmpeg binary (otherwise: `ffmpeg-static` → `./ffmpeg(.exe)` → `PATH`) |
| `ZORNIX_CONFIG_DIR` | Folder holding `cameras.json` / `nvr.json` (default: app folder) |
| `ZORNIX_DEMO=1` | Force demo mode (same as `npm run demo`) |

To force the UI language, run `localStorage.setItem('zornix.lang', 'cs')` (or `'en'`) in DevTools (`Ctrl+Shift+I`) and press `Ctrl+R`.

## Security notes

- `cameras.json` and `nvr.json` hold credentials in **plain text** and are git-ignored. Keep them out of shared folders.
- Video never leaves your machine. The WebSocket servers listen on `127.0.0.1` only.
- The only outbound request is loading the UI fonts from Google Fonts. Offline, Zornix falls back to system fonts.
- Many budget cameras ship with default passwords and an open DVRIP port (34567). Change the passwords,
  put cameras on their own VLAN, and never forward camera ports to the Internet. Use a VPN (e.g. WireGuard) for remote viewing.

## Roadmap

- [ ] Add / edit cameras from the UI (instead of editing JSON)
- [ ] ONVIF discovery
- [ ] Export a recorded clip to MP4
- [ ] Audio in playback (G.711)
- [ ] Synchronized multi-camera playback
- [ ] Remember last layout and selection
- [ ] Packaged installers (Windows / macOS / Linux)
- [ ] Bundle UI fonts locally

Contributions are welcome. Small, focused PRs are easiest to review.
If you have an NVR model we haven't tested yet, an issue with a short capture of its DVRIP replies helps a lot.

## License

[MIT](LICENSE) © Danieljsem. Third-party components are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

Zornix is not affiliated with any camera or NVR manufacturer. Brand names are used only to describe compatibility.
