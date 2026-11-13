// dvrip.js — XiongMai / Sofia DVRIP client for Node (live + playback-by-time)
// Protocol faithfully ported from OpenIPC/python-dvr (MIT, Copyright (c) 2017
// Eliot Kent Woodrich; full text in licenses/python-dvr-LICENSE.txt). Used to talk to
// XMeye / Sofia-based NVRs and cameras on TCP 34567: login, query recordings,
// stream playback by time.
//
// Media de-framing reference (reassemble_bin_payload):
//   data_type (big-endian u32 of first 4 payload bytes):
//     0x1FC video I-frame -> 16-byte header: magic(4) media(1) fps(1) w(1) h(1) dt(u32le) len(u32le)
//     0x1FD video P-frame ->  8-byte header: magic(4) len(u32le)
//     0x1FA audio         ->  8-byte header: magic(4) media(1) samp(1) len(u16le)
//     0x1F9 info          ->  8-byte header: magic(4) media(1) n(1)   len(u16le)
//     0x1FE jpeg          -> 16-byte header (like I-frame)
//   media value -> codec: 2=h264, 3=h265

const net = require('net');
const crypto = require('crypto');
const { EventEmitter } = require('events');

const OK_CODES = [100, 150, 515];
const RET_MESSAGES = {
  100: 'OK', 101: 'Unknown error', 102: 'Version not supported', 103: 'Illegal request',
  104: 'User already logged in', 106: 'User/password error',
  202: 'User not logged in', 203: 'Password is incorrect', 204: 'User is invalid',
  205: 'IP locked', 206: 'User is in the blacklist', 207: 'Blacklisted',
  119: 'No file found',
};

function sofiaHash(password = '') {
  const md5 = crypto.createHash('md5').update(Buffer.from(password, 'utf8')).digest();
  const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
  let out = '';
  for (let i = 0; i < 16; i += 2) out += chars[(md5[i] + md5[i + 1]) % 62];
  return out;
}

// Build a 20-byte DVRIP command header + JSON body (version 0 => body + "\n\0")
// Header layout (python-dvr "BB2xII2xHI"):
//   [0]=0xff [1]=version [2..3]=pad [4..7]=session(LE) [8..11]=seq(LE)
//   [12..13]=pad [14..15]=msgid(LE) [16..19]=bodyLen(LE)
function buildPacket(session, seq, msgid, obj) {
  const body = Buffer.from(JSON.stringify(obj), 'utf8');
  const tail = Buffer.from([0x0a, 0x00]);
  const head = Buffer.alloc(20);
  head.writeUInt8(0xff, 0);
  head.writeUInt8(0x00, 1);
  head.writeUInt32LE(session >>> 0, 4);
  head.writeUInt32LE(seq >>> 0, 8);
  head.writeUInt16LE(msgid, 14);
  head.writeUInt32LE(body.length + tail.length, 16);
  return Buffer.concat([head, body, tail]);
}

class DVRIP extends EventEmitter {
  constructor(host, { port = 34567, user = 'admin', password = '' } = {}) {
    super();
    this.host = host; this.port = port; this.user = user; this.password = password;
    this.sock = null; this.session = 0; this.seq = 0;
    this.aliveInterval = 20; this._keepAlive = null;
    this._rx = Buffer.alloc(0);      // raw tcp buffer for JSON command replies
    this._pendingJson = null;        // resolver waiting for a JSON reply
    this._streamMode = false;        // when true, incoming bytes go to media deframer
    this._media = null;              // MediaDeframer
  }

  connect(timeout = 8000) {
    return new Promise((resolve, reject) => {
      this.sock = net.connect({ host: this.host, port: this.port });
      this.sock.setNoDelay(true);
      const to = setTimeout(() => { this.sock.destroy(); reject(new Error('connect timeout')); }, timeout);
      this.sock.once('connect', () => { clearTimeout(to); resolve(); });
      this.sock.on('error', (e) => { clearTimeout(to); this.emit('error', e); if (this._pendingJson) { this._pendingJson.reject(e); this._pendingJson = null; } });
      this.sock.on('close', () => { this.emit('close'); this._stopKeepAlive(); });
      this.sock.on('data', (d) => this._onData(d));
    });
  }

  _onData(chunk) {
    if (this._streamMode) { if (this._media) this._media.push(chunk); return; }
    this._rx = Buffer.concat([this._rx, chunk]);
    // Parse as many 20-byte-header JSON replies as are complete
    while (this._rx.length >= 20) {
      const len = this._rx.readUInt32LE(16);
      if (this._rx.length < 20 + len) break;
      const body = this._rx.slice(20, 20 + len);
      this._rx = this._rx.slice(20 + len);
      let json = null;
      try { json = JSON.parse(body.slice(0, body.length).toString('utf8').replace(/\x00+$/, '').trim()); }
      catch { json = { Ret: 101, _raw: body.toString('latin1') }; }
      if (typeof json.SessionID === 'string') this.session = parseInt(json.SessionID, 16) || this.session;
      if (this._pendingJson) { const p = this._pendingJson; this._pendingJson = null; p.resolve(json); }
      else this.emit('message', json);
    }
  }

  _send(msgid, obj, waitResponse = true, timeout = 8000) {
    const pkt = buildPacket(this.session, this.seq++, msgid, obj);
    return new Promise((resolve, reject) => {
      if (!this.sock || this.sock.destroyed) return reject(new Error('socket closed'));
      if (waitResponse) {
        const to = setTimeout(() => { if (this._pendingJson) { this._pendingJson = null; reject(new Error('reply timeout')); } }, timeout);
        this._pendingJson = { resolve: (v) => { clearTimeout(to); resolve(v); }, reject: (e) => { clearTimeout(to); reject(e); } };
        this.sock.write(pkt);
      } else {
        this.sock.write(pkt, () => resolve(null));
      }
    });
  }

  async login() {
    if (!this.sock) await this.connect();
    const r = await this._send(1000, {
      EncryptType: 'MD5', LoginType: 'DVRIP-Web',
      PassWord: sofiaHash(this.password), UserName: this.user,
    });
    if (!r || !OK_CODES.includes(r.Ret)) {
      const msg = r ? (RET_MESSAGES[r.Ret] || ('Ret ' + r.Ret)) : 'no reply';
      const e = new Error('login failed: ' + msg); e.ret = r && r.Ret; throw e;
    }
    this.session = parseInt(r.SessionID, 16);
    this.aliveInterval = r.AliveInterval || 20;
    this._startKeepAlive();
    return r;
  }

  _startKeepAlive() {
    this._stopKeepAlive();
    this._keepAlive = setInterval(() => {
      if (this._streamMode) return; // don't inject commands mid-stream
      this._send(1006, { Name: 'KeepAlive', SessionID: '0x%08X' }, true, 4000)
        .catch(() => {});
    }, Math.max(5, this.aliveInterval - 5) * 1000);
  }
  _stopKeepAlive() { if (this._keepAlive) clearInterval(this._keepAlive); this._keepAlive = null; }

  // Query recordings for a channel & time window. Times: "YYYY-MM-DD HH:MM:SS"
  async queryFiles(channel, beginTime, endTime, type = 'h264') {
    const mk = (bt) => ({
      Name: 'OPFileQuery',
      OPFileQuery: { BeginTime: bt, Channel: channel, DriverTypeMask: '0x0000FFFF',
        EndTime: endTime, Event: '*', StreamType: '0x00000000', Type: type },
    });
    let data = await this._send(1440, mk(beginTime));
    if (!data || data.Ret !== 100 || !Array.isArray(data.OPFileQuery)) return [];
    let result = data.OPFileQuery.slice();
    // paginate: server returns 64 at a time
    let guard = 0;
    while (Array.isArray(data.OPFileQuery) && data.OPFileQuery.length === 64 && guard++ < 32) {
      const last = data.OPFileQuery[data.OPFileQuery.length - 1].BeginTime;
      data = await this._send(1440, mk(last));
      if (!data || !Array.isArray(data.OPFileQuery)) break;
      // skip duplicate first item
      const more = data.OPFileQuery.filter(f => f.BeginTime !== last);
      result = result.concat(more);
    }
    return result;
  }

  // Start playback-by-time. Emits 'video' (Buffer H264/H265 ES) and 'meta'.
  // Returns {codec}. Call stopPlayback() to end.
  async startPlaybackByTime(channel, startTime, endTime) {
    const param = {
      PlayMode: 'ByTime', FileName: '', StreamType: 0, Value: 0, TransMode: 'TCP',
    };
    const claim = await this._send(1424, {
      Name: 'OPPlayBack',
      OPPlayBack: { Action: 'Claim',
        Parameter: { ...param, Channel: channel }, StartTime: startTime, EndTime: endTime },
    });
    if (!claim || !OK_CODES.includes(claim.Ret)) {
      const e = new Error('playback claim failed: ' + (claim ? (RET_MESSAGES[claim.Ret] || claim.Ret) : 'no reply'));
      e.ret = claim && claim.Ret; throw e;
    }
    // switch to stream mode BEFORE sending Start (no reply expected on data socket)
    this._media = new MediaDeframer();
    this._media.on('video', (buf) => this.emit('video', buf));
    this._media.on('meta', (m) => this.emit('meta', m));
    this._streamMode = true;
    this._playChannel = channel;
    this._playRange = { startTime, endTime };
    await this._send(1420, {
      Name: 'OPPlayBack', SessionID: '0x%08X',
      OPPlayBack: { Action: 'Start',
        Parameter: { ...param, Channel: channel }, StartTime: startTime, EndTime: endTime },
    }, false);
    return { ok: true };
  }

  async stopPlayback() {
    if (!this._streamMode) return;
    const r = this._playRange || {};
    this._streamMode = false;
    this._media = null;
    try {
      await this._send(1420, {
        Name: 'OPPlayBack', SessionID: '0x%08X',
        OPPlayBack: { Action: 'Stop',
          Parameter: { PlayMode: 'ByTime', Channel: this._playChannel, StreamType: 0, TransMode: 'TCP', Value: 0 },
          StartTime: r.startTime, EndTime: r.endTime },
      }, false);
    } catch {}
  }

  close() {
    this._stopKeepAlive();
    try { this.sock && this.sock.destroy(); } catch {}
    this.sock = null;
  }
}

// Two-stage: TCP bytes -> DVRIP media packets (strip 20B hdr) -> frame payloads.
class MediaDeframer extends EventEmitter {
  constructor() {
    super();
    this._buf = Buffer.alloc(0);   // raw tcp, for stage-1 packet extraction
    this._stream = Buffer.alloc(0); // concatenated media-packet payloads, for stage-2
    this._remaining = 0;           // bytes left in current frame payload
    this._emitCurrent = false;     // is the current frame a video frame?
    this.codec = null;
  }

  push(chunk) {
    this._buf = Buffer.concat([this._buf, chunk]);
    // stage 1: extract media packets ([20B hdr][len payload])
    while (this._buf.length >= 20) {
      const len = this._buf.readUInt32LE(16);
      if (this._buf.length < 20 + len) break;
      const payload = this._buf.slice(20, 20 + len);
      this._buf = this._buf.slice(20 + len);
      this._stream = Buffer.concat([this._stream, payload]);
    }
    this._parseFrames();
  }

  _parseFrames() {
    // stage 2: walk the continuous media stream
    for (;;) {
      if (this._remaining > 0) {
        const take = Math.min(this._remaining, this._stream.length);
        if (take === 0) return;
        if (this._emitCurrent) this.emit('video', this._stream.slice(0, take));
        this._stream = this._stream.slice(take);
        this._remaining -= take;
        if (this._remaining > 0) return; // need more bytes
        continue;
      }
      // at a frame boundary: need at least 4 bytes to read data_type
      if (this._stream.length < 4) return;
      const dt = this._stream.readUInt32BE(0);
      let headerLen, length, isVideo = false;
      if (dt === 0x1fc || dt === 0x1fe) {
        if (this._stream.length < 16) return;
        headerLen = 16;
        const media = this._stream.readUInt8(4);
        length = this._stream.readUInt32LE(12);
        isVideo = (dt === 0x1fc);
        if (dt === 0x1fc) this.codec = media === 3 ? 'h265' : 'h264';
        if (dt === 0x1fc) this.emit('meta', { frame: 'I', codec: this.codec,
          width: this._stream.readUInt8(6) * 8, height: this._stream.readUInt8(7) * 8 });
      } else if (dt === 0x1fd) {
        if (this._stream.length < 8) return;
        headerLen = 8; length = this._stream.readUInt32LE(4); isVideo = true;
      } else if (dt === 0x1fa || dt === 0x1f9) {
        if (this._stream.length < 8) return;
        headerLen = 8; length = this._stream.readUInt16LE(6); isVideo = false;
      } else {
        // desync or unknown — try to resync to next 00 00 01 magic
        const idx = this._stream.indexOf(Buffer.from([0x00, 0x00, 0x01]), 1);
        if (idx < 0) { this._stream = this._stream.slice(Math.max(0, this._stream.length - 3)); return; }
        this._stream = this._stream.slice(idx);
        continue;
      }
      this._stream = this._stream.slice(headerLen);
      this._remaining = length;
      this._emitCurrent = isVideo;
      if (length === 0) { this._remaining = 0; this._emitCurrent = false; }
    }
  }
}

module.exports = { DVRIP, sofiaHash, RET_MESSAGES };
