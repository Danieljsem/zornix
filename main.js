const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const { WebSocketServer } = require('ws');
const fs = require('fs');
const { DVRIP, RET_MESSAGES } = require('./dvrip');

// ---------- ffmpeg discovery ----------
// Order: $FFMPEG_PATH → bundled ffmpeg-static (npm) → ./ffmpeg(.exe) next to the app → system PATH.
function findFfmpeg() {
  const candidates = [];
  if (process.env.FFMPEG_PATH) candidates.push(process.env.FFMPEG_PATH);
  try {
    const p = require('ffmpeg-static');
    // inside a packaged app the binary lives outside app.asar
    if (p) candidates.push(p.replace('app.asar', 'app.asar.unpacked'));
  } catch {}
  candidates.push(path.join(__dirname, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'));
  for (const c of candidates) { try { if (fs.existsSync(c)) return c; } catch {} }
  return 'ffmpeg'; // rely on PATH
}
const FFMPEG = findFfmpeg();
console.log('Using ffmpeg:', FFMPEG);

// ---------- config ----------
// Config lives next to the app (handy for portable installs) unless ZORNIX_CONFIG_DIR is set.
const CONFIG_DIR = process.env.ZORNIX_CONFIG_DIR || __dirname;
const CAMERAS_FILE = path.join(CONFIG_DIR, 'cameras.json');
const NVR_FILE = path.join(CONFIG_DIR, 'nvr.json');

// Demo mode: synthetic ffmpeg test patterns instead of real cameras.
// Enabled with `npm run demo`, ZORNIX_DEMO=1, or automatically when no cameras.json exists.
const DEMO = process.argv.includes('--demo') || process.env.ZORNIX_DEMO === '1' || !fs.existsSync(CAMERAS_FILE);
const DEMO_SOURCES = [
  'testsrc2=size=1280x720:rate=25',
  'smptehdbars=size=1280x720:rate=25',
  'life=size=320x180:rate=25:mold=10:ratio=0.1:death_color=#0A0E13:life_color=#35E0D0,scale=1280x720:flags=neighbor',
  'mandelbrot=size=640x360:rate=25',
  'cellauto=size=320x180:rate=25:rule=110,scale=1280x720:flags=neighbor',
  'rgbtestsrc=size=1280x720:rate=25',
  'testsrc=size=1280x720:rate=25',
  'gradients=size=1280x720:rate=25:speed=0.02',
  'life=size=320x180:rate=25:ratio=0.3:life_color=#FFB547:death_color=#06080B,scale=1280x720:flags=neighbor',
];
function demoCameras() {
  const names = ['Main gate', 'Parking lot', 'Loading dock', 'Warehouse A', 'Warehouse B',
    'Reception', 'Server room', 'Back yard', 'Workshop'];
  return names.map((label, i) => ({ ip: `demo-${i + 1}`, label: `Cam ${String(i + 1).padStart(2, '0')} ${label}`,
    rtsp: `demo:${DEMO_SOURCES[i % DEMO_SOURCES.length]}` }));
}

function loadCameras() {
  const arr = DEMO ? demoCameras() : JSON.parse(fs.readFileSync(CAMERAS_FILE, 'utf8'));
  // assign a default NVR channel by order if not specified (channel index is 0-based)
  return arr.map((cam, i) => ({ channel: i, ...cam, index: i }));
}
function loadNvr() {
  try { return JSON.parse(fs.readFileSync(NVR_FILE, 'utf8')); }
  catch { return { ip: '', port: 34567, user: 'admin', password: '' }; }
}
function saveNvr(cfg) { fs.writeFileSync(NVR_FILE, JSON.stringify(cfg, null, 2)); }

// ffmpeg input args for a camera: RTSP, or a lavfi test pattern in demo mode.
function inputArgs(src) {
  if (src.startsWith('demo:')) return ['-re', '-f', 'lavfi', '-i', src.slice(5)];
  return ['-rtsp_transport', 'tcp', '-max_delay', '500000', '-fflags', 'nobuffer', '-flags', 'low_delay', '-i', src];
}

// Shown once if the ffmpeg binary cannot be started (ENOENT etc.).
let ffmpegWarned = false;
let ffmpegBroken = false; // stop auto-restart loops when the binary cannot be started
function ffmpegMissing(err) {
  console.error('[ffmpeg]', err.message);
  if (err.code === 'ENOENT') ffmpegBroken = true;
  if (ffmpegWarned || err.code !== 'ENOENT') return;
  ffmpegWarned = true;
  dialog.showErrorBox('ffmpeg not found',
    'Zornix needs ffmpeg to decode video.\n\nRun "npm install" (installs a bundled ffmpeg), install ffmpeg on your PATH, ' +
    'or set the FFMPEG_PATH environment variable.\n\nTried: ' + FFMPEG);
}

let allCameras = loadCameras();
let nvrCfg = loadNvr();

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const activeStreams = new Map();   // ip -> live stream record
const playbackSessions = new Map(); // id -> { dvr, ffmpeg, wss, wsPort }

let mainWindow;
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1680, height: 1000, title: 'Zornix',
    icon: path.join(__dirname, 'assets', 'icon.ico'),
    backgroundColor: '#0b0d12',
    webPreferences: { nodeIntegration: false, contextIsolation: true, preload: path.join(__dirname, 'preload.js') },
  });
  mainWindow.loadFile('index.html');
  mainWindow.setMenuBarVisibility(false);
  mainWindow.maximize();
}

// ---------- LIVE streaming (RTSP -> MPEG1 -> ws -> jsmpeg) ----------
const QUALITY = {
  grid:       { bitrate: '400k',  fps: '25', res: '480x270' },
  medium:     { bitrate: '600k',  fps: '25', res: '640x360' },
  fullscreen: { bitrate: '1500k', fps: '25', res: '1280x720' },
};

// OS-assigned free port (port 0) — never collides with a leftover instance.
function newWss() {
  return new Promise((resolve, reject) => {
    const wss = new WebSocketServer({ port: 0, host: '127.0.0.1' });
    const onErr = (e) => reject(e);
    wss.once('error', onErr);
    wss.once('listening', () => {
      wss.off('error', onErr);
      wss.on('error', (e) => console.error('[wss]', e.message)); // keep alive, never crash
      resolve({ wss, wsPort: wss.address().port });
    });
  });
}

async function startStream(camera, quality = 'grid') {
  stopStream(camera.ip);
  const { wss, wsPort } = await newWss(); // created ONCE; kept across ffmpeg restarts
  const rec = { camera, quality, wss, wsPort, ffmpeg: null, restartTimer: null, watchdog: null, gotData: false, stopped: false };
  activeStreams.set(camera.ip, rec);
  spawnFor(rec);
  return wsPort;
}

// (Re)spawn ffmpeg for a stream, reusing the same WebSocket server/port so the
// renderer keeps receiving video after an auto-restart (no manual refresh needed).
function spawnFor(rec) {
  const q = QUALITY[rec.quality] || QUALITY.grid;
  // Software decode — reliable with many concurrent streams (shared iGPU d3d11 fails under load).
  const args = [
    '-hide_banner', '-loglevel', 'error',
    ...inputArgs(rec.camera.rtsp),
    '-f', 'mpegts', '-codec:v', 'mpeg1video', '-b:v', q.bitrate,
    '-r', q.fps, '-s', q.res, '-bf', '0', '-an', '-',
  ];
  const ffmpeg = spawn(FFMPEG, args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  rec.ffmpeg = ffmpeg; rec.gotData = false;

  // Watchdog: cameras can take ~10-12s to send the first keyframe (GOP). Only treat
  // a stream as failed after 20s with no video, then kill → auto-restart.
  rec.watchdog = setTimeout(() => {
    if (activeStreams.get(rec.camera.ip) === rec && !rec.gotData && !rec.stopped && !app.isQuitting) {
      try { ffmpeg.kill('SIGKILL'); } catch {}
    }
  }, 20000);

  ffmpeg.stdout.on('data', (data) => {
    if (!rec.gotData) { rec.gotData = true; clearTimeout(rec.watchdog); }
    rec.wss.clients.forEach(c => { if (c.readyState === 1) c.send(data, { binary: true }); });
  });
  ffmpeg.stderr.on('data', (d) => { const m = d.toString().trim(); if (m) console.error(`[${rec.camera.label}] ${m}`); });
  ffmpeg.on('error', ffmpegMissing);

  ffmpeg.on('close', () => {
    clearTimeout(rec.watchdog);
    if (rec.stopped || app.isQuitting || ffmpegBroken) return;
    if (activeStreams.get(rec.camera.ip) !== rec) return;
    const delay = rec.gotData ? 3000 : 1200; // fast retry if it never produced video
    rec.restartTimer = setTimeout(() => {
      if (activeStreams.get(rec.camera.ip) === rec && !rec.stopped && !app.isQuitting) spawnFor(rec);
    }, delay);
  });
}

function stopStream(ip) {
  const s = activeStreams.get(ip);
  if (!s) return;
  s.stopped = true;
  if (s.restartTimer) clearTimeout(s.restartTimer);
  if (s.watchdog) clearTimeout(s.watchdog);
  try { s.ffmpeg && s.ffmpeg.kill('SIGTERM'); } catch {}
  setTimeout(() => { try { s.wss.close(); } catch {} }, 500);
  activeStreams.delete(ip);
}

function stopAllStreams() {
  app.isQuitting = true;
  activeStreams.forEach((s) => { s.stopped = true; if (s.restartTimer) clearTimeout(s.restartTimer); if (s.watchdog) clearTimeout(s.watchdog); try { s.ffmpeg && s.ffmpeg.kill('SIGTERM'); } catch {} try { s.wss.close(); } catch {} });
  activeStreams.clear();
  playbackSessions.forEach((_, id) => stopPlayback(id));
}

// ---------- PLAYBACK (NVR DVRIP -> raw H264/H265 -> MPEG1 -> ws) ----------
function spawnPlaybackFfmpeg(codec, wss, speed = 1) {
  const inFmt = codec === 'h265' ? 'hevc' : 'h264';
  const vf = (speed && speed !== 1) ? ['-filter:v', `setpts=PTS/${speed}`] : [];
  const args = [
    '-hide_banner', '-loglevel', 'error',
    '-fflags', '+genpts', '-f', inFmt, '-i', 'pipe:0',
    ...vf,
    '-f', 'mpegts', '-codec:v', 'mpeg1video', '-b:v', '1200k',
    '-r', '25', '-s', '1280x720', '-bf', '0', '-an', '-',
  ];
  const ffmpeg = spawn(FFMPEG, args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  ffmpeg.stdout.on('data', (data) => wss.clients.forEach(c => { if (c.readyState === 1) c.send(data, { binary: true }); }));
  ffmpeg.stderr.on('data', (d) => { const m = d.toString().trim(); if (m) console.error('[playback ffmpeg]', m); });
  ffmpeg.stdin.on('error', () => {});
  ffmpeg.on('error', ffmpegMissing);
  return ffmpeg;
}

async function stopPlayback(id) {
  const s = playbackSessions.get(id);
  if (!s) return;
  playbackSessions.delete(id);
  try { await s.dvr.stopPlayback(); } catch {}
  try { s.dvr.close(); } catch {}
  try { s.ffmpeg && s.ffmpeg.kill('SIGTERM'); } catch {}
  setTimeout(() => { try { s.wss.close(); } catch {} }, 400);
}

// Per-session generation counter: a newer playback-start for the same id wins, an
// older one that is still awaiting cleans up after itself instead of leaking ffmpeg/DVRIP.
const pbGen = new Map();

// ---------- DEMO playback (no NVR needed) ----------
// Generates a plausible day of recordings and streams a test pattern for "playback".
function demoQuery(ip, date) {
  const seed = [...(ip + date)].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
  let r = seed; const rnd = () => ((r = (r * 1103515245 + 12345) >>> 0) / 2 ** 32);
  const segments = []; let t = Math.floor(rnd() * 3600);
  const fmt = (sec) => `${date} ${[sec / 3600, (sec / 60) % 60, sec % 60].map(v => String(Math.floor(v)).padStart(2, '0')).join(':')}`;
  while (t < 86000) {
    const len = 600 + Math.floor(rnd() * 5400);
    const end = Math.min(86399, t + len);
    segments.push({ begin: fmt(t), end: fmt(end), name: `demo_${t}.h264`, length: len, event: rnd() < 0.25 ? 'Motion' : '' });
    t = end + 120 + Math.floor(rnd() * 2400);
  }
  return { ok: true, channel: 0, segments };
}
async function demoPlayback(id, ip, speed, gen) {
  await stopPlayback(id);
  const cam = allCameras.find(c => c.ip === ip);
  const { wss, wsPort } = await newWss();
  if (pbGen.get(id) !== gen) { try { wss.close(); } catch {} return { ok: false, superseded: true }; }
  const src = (cam && cam.rtsp.startsWith('demo:')) ? cam.rtsp.slice(5) : DEMO_SOURCES[0];
  // -readrate makes ffmpeg consume the test source `speed`× faster than real time, so 8× really looks like 8×.
  const ffmpeg = spawn(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-readrate', String(speed || 1), '-f', 'lavfi', '-i', src,
    ...((speed && speed !== 1) ? ['-filter:v', `setpts=PTS/${speed}`] : []),
    '-f', 'mpegts', '-codec:v', 'mpeg1video', '-b:v', '1200k', '-r', '25', '-s', '1280x720', '-bf', '0', '-an', '-'],
    { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  ffmpeg.stdout.on('data', (data) => wss.clients.forEach(c => { if (c.readyState === 1) c.send(data, { binary: true }); }));
  ffmpeg.on('error', ffmpegMissing);
  playbackSessions.set(id, { dvr: { stopPlayback: async () => {}, close: () => {} }, ffmpeg, wss, wsPort });
  return { ok: true, wsPort };
}

// ---------- app ----------
// Prevent a second instance from colliding (the EADDRINUSE crash).
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) { app.quit(); }
else app.on('second-instance', () => {
  if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus(); }
});

app.whenReady().then(() => {
  if (!gotLock) return;
  try { app.setAppUserModelId('io.github.zornix'); } catch {}
  createWindow();

  ipcMain.handle('get-info', () => ({ demo: DEMO, version: app.getVersion() }));
  ipcMain.handle('get-cameras', () => allCameras.map(c => ({ ip: c.ip, label: c.label, index: c.index, channel: c.channel })));
  ipcMain.handle('get-nvr-config', () => ({ ...nvrCfg, password: nvrCfg.password ? '••••••••' : '' }));

  ipcMain.handle('save-nvr-config', (e, cfg) => {
    nvrCfg = { ip: cfg.ip || '', port: parseInt(cfg.port) || 34567, user: cfg.user || 'admin',
      password: (cfg.password && cfg.password !== '••••••••') ? cfg.password : nvrCfg.password };
    saveNvr(nvrCfg);
    return { ok: true };
  });

  // Test NVR connection: login + channel statuses
  ipcMain.handle('test-nvr', async () => {
    if (!nvrCfg.ip) return { ok: false, code: 'err.nvr_unset', error: 'NVR IP address is not set.' };
    const dvr = new DVRIP(nvrCfg.ip, nvrCfg);
    try {
      await dvr.login();
      let channels = [];
      try {
        const st = await dvr._send(1042, { Name: 'NetWork.ChnStatus' });
        if (st && st['NetWork.ChnStatus']) channels = st['NetWork.ChnStatus'];
      } catch {}
      dvr.close();
      return { ok: true, channels };
    } catch (err) { dvr.close(); return { ok: false, error: err.message, ret: err.ret }; }
  });

  // existing live controls
  ipcMain.handle('show-cameras', async (e, { ips, quality }) => {
    for (const [ip] of activeStreams) if (!ips.includes(ip)) stopStream(ip);
    const result = [];
    for (const ip of ips) {
      const cam = allCameras.find(c => c.ip === ip); if (!cam) continue;
      const existing = activeStreams.get(ip);
      if (existing && existing.quality === quality) { result.push({ ip, wsPort: existing.wsPort }); continue; }
      try { result.push({ ip, wsPort: await startStream(cam, quality) }); }
      catch (err) { console.error('[show-cameras]', ip, err.message); }
      await sleep(220); // stagger starts: less CPU contention = faster first frame
    }
    return result;
  });

  ipcMain.handle('fullscreen-camera', async (e, { ip }) => {
    const cam = allCameras.find(c => c.ip === ip); if (!cam) return null;
    for (const [activeIp] of activeStreams) if (activeIp !== ip) stopStream(activeIp);
    const existing = activeStreams.get(ip);
    if (existing && existing.quality === 'fullscreen') return { ip, wsPort: existing.wsPort };
    try { return { ip, wsPort: await startStream(cam, 'fullscreen') }; }
    catch (err) { console.error('[fullscreen]', err.message); return null; }
  });

  // playback: query recordings for a camera on a given day (local date "YYYY-MM-DD")
  ipcMain.handle('playback-query', async (e, { ip, date }) => {
    if (DEMO) return demoQuery(ip, date);
    if (!nvrCfg.ip) return { ok: false, code: 'err.nvr_unset', error: 'NVR is not configured. Open Settings and enter the NVR IP address and password.' };
    const cam = allCameras.find(c => c.ip === ip);
    if (!cam) return { ok: false, code: 'err.cam_notfound', error: 'Camera not found.' };
    const dvr = new DVRIP(nvrCfg.ip, nvrCfg);
    try {
      await dvr.login();
      const begin = `${date} 00:00:00`;
      const end = `${date} 23:59:59`;
      let files = await dvr.queryFiles(cam.channel, begin, end, 'h264');
      dvr.close();
      // normalize to segments {begin,end,name,length}
      const segments = files.map(f => ({
        begin: f.BeginTime, end: f.EndTime, name: f.FileName,
        length: f.FileLength, event: f.FileType || f.Event || '',
      }));
      return { ok: true, channel: cam.channel, segments };
    } catch (err) { dvr.close(); return { ok: false, error: err.message, ret: err.ret }; }
  });

  // playback: start streaming from a time. startTime/endTime "YYYY-MM-DD HH:MM:SS"
  ipcMain.handle('playback-start', async (e, { id, ip, startTime, endTime, speed }) => {
    const gen = (pbGen.get(id) || 0) + 1; pbGen.set(id, gen);
    if (DEMO) return demoPlayback(id, ip, speed, gen);
    if (!nvrCfg.ip) return { ok: false, code: 'err.nvr_unset', error: 'NVR is not configured.' };
    const cam = allCameras.find(c => c.ip === ip);
    if (!cam) return { ok: false, code: 'err.cam_notfound', error: 'Camera not found.' };
    await stopPlayback(id);
    speed = speed || 1;
    const { wss, wsPort } = await newWss();
    if (pbGen.get(id) !== gen) { try { wss.close(); } catch {} return { ok: false, superseded: true }; }
    const dvr = new DVRIP(nvrCfg.ip, nvrCfg);
    const session = { dvr, ffmpeg: null, wss, wsPort, started: false };
    playbackSessions.set(id, session);
    let earlyBuf = [];
    dvr.on('meta', (m) => {
      if (!session.started && (m.codec)) {
        session.started = true;
        session.ffmpeg = spawnPlaybackFfmpeg(m.codec || 'h264', wss, speed);
        for (const b of earlyBuf) { try { session.ffmpeg.stdin.write(b); } catch {} }
        earlyBuf = [];
      }
    });
    dvr.on('video', (buf) => {
      if (session.ffmpeg && session.started) { try { session.ffmpeg.stdin.write(buf); } catch {} }
      else { earlyBuf.push(buf); if (earlyBuf.length > 400) earlyBuf.shift(); }
    });
    dvr.on('error', (err) => console.error('[playback dvr]', err.message));
    try {
      await dvr.login();
      // fallback: if no meta arrives in 2.5s, start ffmpeg as h264
      setTimeout(() => {
        if (!session.started && playbackSessions.get(id) === session) {
          session.started = true;
          session.ffmpeg = spawnPlaybackFfmpeg('h264', wss, speed);
          for (const b of earlyBuf) { try { session.ffmpeg.stdin.write(b); } catch {} }
          earlyBuf = [];
        }
      }, 2500);
      await dvr.startPlaybackByTime(cam.channel, startTime, endTime);
      return { ok: true, wsPort };
    } catch (err) {
      if (playbackSessions.get(id) === session) await stopPlayback(id);
      else { try { dvr.close(); } catch {} } // superseded by a newer start: don't kill that one
      return { ok: false, error: err.message, ret: err.ret };
    }
  });

  ipcMain.handle('playback-stop', async (e, { id }) => { pbGen.set(id, (pbGen.get(id) || 0) + 1); await stopPlayback(id); return { ok: true }; });

  // snapshot: save a dataURL (png) to disk
  ipcMain.handle('save-snapshot', async (e, { dataUrl, suggestedName }) => {
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      defaultPath: suggestedName || `snapshot_${Date.now()}.png`,
      filters: [{ name: 'PNG', extensions: ['png'] }],
    });
    if (canceled || !filePath) return { ok: false };
    const b64 = dataUrl.replace(/^data:image\/png;base64,/, '');
    fs.writeFileSync(filePath, Buffer.from(b64, 'base64'));
    return { ok: true, filePath };
  });
});

app.on('window-all-closed', () => { stopAllStreams(); app.quit(); });
app.on('before-quit', stopAllStreams);
