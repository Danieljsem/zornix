# Third-party notices

| Component | Use in Zornix | License |
|---|---|---|
| [JSMpeg](https://github.com/phoboslab/jsmpeg) (`jsmpeg.min.js`, vendored) | MPEG-1 decoding + WebGL rendering in the renderer | MIT © 2017 Dominic Szablewski — [full text](licenses/jsmpeg-LICENSE.txt) |
| [OpenIPC/python-dvr](https://github.com/OpenIPC/python-dvr) | Reference for the DVRIP protocol; `dvrip.js` is an independent JavaScript port of its login / file query / playback / media de-framing logic | MIT © 2017 Eliot Kent Woodrich — [full text](licenses/python-dvr-LICENSE.txt) |
| [Electron](https://www.electronjs.org/) | Desktop shell | MIT |
| [ws](https://github.com/websockets/ws) | Local WebSocket server feeding the video canvases | MIT |
| [ffmpeg-static](https://github.com/eugeneware/ffmpeg-static) | Downloads a prebuilt FFmpeg binary at `npm install` | GPL-3.0-or-later (package); the FFmpeg binaries it fetches are GPL builds |
| [FFmpeg](https://ffmpeg.org/) | Runs as a separate process (RTSP ingest, transcoding) — not linked into Zornix | LGPL / GPL depending on build |
| Fonts: Space Grotesk, Inter, JetBrains Mono | Loaded from Google Fonts | SIL Open Font License 1.1 |

FFmpeg is executed as an external program and is not part of Zornix's source code. `ffmpeg-static`
is an *optional* dependency: you can skip it and point `FFMPEG_PATH` at any FFmpeg build instead.

If you distribute packaged Zornix builds that include the GPL FFmpeg binary fetched by `ffmpeg-static`,
that binary must be distributed under the GPL — including making the corresponding FFmpeg source
available to recipients. Alternatively, bundle an LGPL FFmpeg build or none at all.
