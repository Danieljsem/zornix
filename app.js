'use strict';
// ---------- state ----------
let cameras = [];
let mode = 'live';                 // 'live' | 'playback'
let search = '';
// live
let selected = [];                 // ordered list of selected ips
let layout = 9;
let page = 0;
let players = [];                  // {ip, player}
let fullIp = null;
// playback
const PB_ID = 'pb-main';
let pbCamera = null;               // ip
let pbDate = todayStr();
let pbSegments = [];
let pbPlayer = null;
let pbCursor = 0;                  // ms of day
let pbPlaying = false;
let pbSpeed = 1;
let pbWallStart = 0, pbCursorBase = 0;
let pbTicker = null;
let pbSeekTimer = null;

const DAY = 24 * 3600 * 1000;
const $ = (id) => document.getElementById(id);
const grid = $('grid'), empty = $('empty');

// ---------- helpers ----------
function todayStr(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function errText(r, fallbackKey){ return (r&&r.code&&t(r.code)!==r.code) ? t(r.code) : ((r&&r.error)||t(fallbackKey)); }
function pad(n){return String(n).padStart(2,'0')}
function msToClock(ms){ms=Math.max(0,Math.min(DAY-1,ms));const s=Math.floor(ms/1000);return `${pad(Math.floor(s/3600))}:${pad(Math.floor(s/60)%60)}:${pad(s%60)}`}
function dvrTimeMsOfDay(t){ // "YYYY-MM-DD HH:MM:SS" -> ms of day
  const m=/(\d{2}):(\d{2}):(\d{2})/.exec(t||''); if(!m)return 0;
  return (+m[1]*3600+ +m[2]*60+ +m[3])*1000;
}
function msOfDayToDVR(date, ms){
  return `${date} ${msToClock(ms)}`;
}

// ---------- camera list ----------
function renderCamList(){
  const list = $('camlist'); list.innerHTML='';
  const q = search.trim().toLowerCase();
  cameras.filter(c => !q || c.label.toLowerCase().includes(q) || c.ip.includes(q)).forEach(c => {
    const row=document.createElement('div'); row.className='camrow';
    const isSel = mode==='live' ? selected.includes(c.ip) : pbCamera===c.ip;
    if(isSel) row.classList.add('sel');
    const pos = mode==='live' && selected.includes(c.ip) ? `<span class="pos">${selected.indexOf(c.ip)+1}</span>` : '';
    row.innerHTML = `<span class="dot"></span><div class="nm"><b>${esc(c.label)}</b><span>${esc(c.ip)}</span></div>${pos}`;
    row.onclick=()=>toggleCamera(c.ip);
    list.appendChild(row);
  });
  const n = mode==='live' ? selected.length : (pbCamera?1:0);
  $('selcount').textContent = mode==='live'
    ? t('sel.live', selected.length, cameras.length)
    : t('sel.pb', cameras.length);
}

function toggleCamera(ip){
  if(mode==='live'){
    const i=selected.indexOf(ip);
    if(i>=0) selected.splice(i,1);
    else { if(selected.length>=50) return; selected.push(ip); }
    // jump to page containing newly added cam
    page = Math.floor(Math.max(0,selected.length-1)/layout);
    renderCamList(); renderLive();
  } else {
    pbCamera = (pbCamera===ip)? null : ip;
    renderCamList(); loadPlaybackDay();
  }
}

// ---------- LIVE ----------
function qualityFor(count){ return count<=1?'fullscreen' : count<=4?'medium':'grid'; }

let renderGen = 0; // guards against overlapping async renders (rapid clicks)
async function renderLive(){
  const gen = ++renderGen;
  stopPlayers();
  if(fullIp){ fullIp=null; }
  if(selected.length===0){ grid.innerHTML=''; empty.style.display='flex';
    $('empty-h').textContent=t('empty.live.h');
    $('empty-p').textContent=t('empty.live.p');
    $('pager').style.display='none'; $('viewsub').textContent='';
    $('cnt-live').textContent='0'; $('cnt-conn').textContent='0'; $('cnt-off').textContent='0'; return; }
  empty.style.display='none';

  const cols=Math.ceil(Math.sqrt(layout)), rows=Math.ceil(layout/cols);
  grid.style.gridTemplateColumns=`repeat(${cols},1fr)`;
  grid.style.gridTemplateRows=`repeat(${rows},1fr)`;

  const totalPages=Math.ceil(selected.length/layout);
  if(page>=totalPages) page=totalPages-1; if(page<0)page=0;
  if(totalPages>1){ $('pager').style.display='flex'; $('pg-info').textContent=`${page+1}/${totalPages}`; }
  else $('pager').style.display='none';

  const pageIps=selected.slice(page*layout, page*layout+layout);
  const cams=pageIps.map(ip=>cameras.find(c=>c.ip===ip)).filter(Boolean);
  $('viewsub').textContent=t('view.of', cams.length, selected.length);

  const quality=qualityFor(layout);
  const info=await window.api.showCameras(pageIps, quality);
  if(gen!==renderGen || mode!=='live') return; // a newer render superseded this one
  grid.innerHTML='';
  const portMap={}; info.forEach(s=>portMap[s.ip]=s.wsPort);

  cams.forEach(cam=>{
    const cell=makeCell(cam);
    grid.appendChild(cell);
    connectPlayer(cam.ip, portMap[cam.ip], players);
  });
}

function camNum(cam){ const m=/(\d+)/.exec(cam.label||''); return m?m[1]:String(cam.index+1); }
const toolsHTML=()=>`
    <div class="tools">
      <button title="${t('tool.full')}" data-a="full"><svg viewBox="0 0 24 24" fill="none"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg></button>
      <button title="${t('tool.snap')}" data-a="snap"><svg viewBox="0 0 24 24" fill="none"><path d="M3 8h4l2-3h6l2 3h4v11H3z"/><circle cx="12" cy="13" r="3.5"/></svg></button>
      <button title="${t('tool.close')}" data-a="close"><svg viewBox="0 0 24 24" fill="none"><path d="M18 6L6 18M6 6l12 12"/></svg></button>
    </div>`;
function cornersHTML(){ return '<span class="cx tl"></span><span class="cx tr"></span><span class="cx bl"></span><span class="cx br"></span>'; }

function makeCell(cam){
  const cell=document.createElement('div'); cell.className='cell s-conn'; cell.dataset.ip=cam.ip;
  cell.innerHTML=`
    <canvas id="cv-${esc(cam.ip)}"></canvas>
    ${cornersHTML()}
    <div class="tag"><b>CAM ${esc(camNum(cam))}</b></div>
    <div class="badge load" id="st-${esc(cam.ip)}"><span class="d"></span>${t('st.load')}</div>
    <div class="ph" id="ph-${esc(cam.ip)}"><svg viewBox="0 0 24 24" fill="none" stroke-width="2"><path d="M12 3a9 9 0 1 0 9 9" stroke-linecap="round"/></svg>${t('ph.conn')}</div>
    <div class="ip">${esc(cam.ip)}</div>${toolsHTML()}`;
  cell.ondblclick=()=>toggleFull(cam.ip);
  cell.querySelector('[data-a="full"]').onclick=(e)=>{e.stopPropagation();toggleFull(cam.ip);};
  cell.querySelector('[data-a="snap"]').onclick=(e)=>{e.stopPropagation();snapshot(cam);};
  cell.querySelector('[data-a="close"]').onclick=(e)=>{e.stopPropagation();toggleCamera(cam.ip);};
  return cell;
}

function setCellStatus(ip, state){ // 'live' | 'load' | 'err'
  const cell=[...document.querySelectorAll('.cell')].find(c=>c.dataset.ip===ip);
  const st=$(`st-${ip}`), ph=$(`ph-${ip}`);
  if(cell){ cell.classList.toggle('s-conn', state==='load'); cell.classList.toggle('s-off', state==='err'); }
  if(st){ st.className='badge '+state;
    st.innerHTML='<span class="d"></span>'+t(state==='live'?'st.live':state==='err'?'st.err':'st.load'); }
  if(ph){ if(state==='live') ph.style.display='none';
    else { ph.style.display='flex'; ph.lastChild && (ph.childNodes[ph.childNodes.length-1].textContent = t(state==='err'?'ph.err':'ph.conn')); } }
  updateStatusCard();
}

function connectPlayer(ip, wsPort, bucket){
  const canvas=$(`cv-${ip}`);
  if(!canvas||!wsPort){ setCellStatus(ip,'err'); return; }
  try{
    const player=new JSMpeg.Player(`ws://127.0.0.1:${wsPort}`,{
      canvas, autoplay:true, audio:false, disableGl:false, preserveDrawingBuffer:true, videoBufferSize:1024*1024,
      onSourceEstablished:()=>setCellStatus(ip,'live'),
      onSourceCompleted:()=>setCellStatus(ip,'err'),
    });
    bucket.push({ip,player});
    setTimeout(()=>{ const st=$(`st-${ip}`); if(st&&st.classList.contains('load')) setCellStatus(ip,'err'); },24000);
  }catch(e){ setCellStatus(ip,'err'); }
}

function updateStatusCard(){
  const cells=[...grid.querySelectorAll('.cell')];
  let live=0,conn=0,off=0;
  cells.forEach(c=>{ const b=c.querySelector('.badge');
    if(b&&b.classList.contains('live'))live++; else if(b&&b.classList.contains('err'))off++; else conn++; });
  $('cnt-live').textContent=live; $('cnt-conn').textContent=conn; $('cnt-off').textContent=off;
}

function stopPlayers(){ players.forEach(p=>{try{p.player.destroy()}catch{}}); players=[]; }

async function toggleFull(ip){
  const cell=[...grid.children].find(c=>c.dataset.ip===ip);
  if(!cell) return;
  if(cell.classList.contains('full')){ cell.classList.remove('full'); renderLive(); return; }
  // high quality single
  const gen=++renderGen;
  stopPlayers();
  const info=await window.api.fullscreenCamera(ip);
  if(gen!==renderGen || mode!=='live') return;
  grid.innerHTML=''; const cam=cameras.find(c=>c.ip===ip);
  const fc=makeCell(cam); fc.classList.add('full','big'); grid.appendChild(fc);
  fullIp=ip;
  connectPlayer(ip, info&&info.wsPort, players);
}

function snapshot(cam){
  const cv=$(`cv-${cam.ip}`); if(!cv) return;
  try{
    const data=cv.toDataURL('image/png');
    const name=`${cam.label.replace(/\s+/g,'_')}_${todayStr()}_${pad(new Date().getHours())}${pad(new Date().getMinutes())}${pad(new Date().getSeconds())}.png`;
    window.api.saveSnapshot(data, name);
  }catch(e){ alert(t('snap.fail')); }
}

// ---------- PLAYBACK ----------
let pbDayGen = 0;
async function loadPlaybackDay(){
  const gen = ++pbDayGen;
  stopPbPlayer(); pbPlaying=false; setPlayIcon();
  pbSegments=[]; renderTimeline();
  if(!pbCamera){
    empty.style.display='flex';
    $('empty-h').textContent=t('empty.pb.h');
    $('empty-p').textContent=t('empty.pb.p');
    grid.innerHTML=''; $('viewsub').textContent=''; return;
  }
  const cam=cameras.find(c=>c.ip===pbCamera);
  $('viewsub').textContent=`${cam.label} · ${pbDate}`;
  empty.style.display='none';
  grid.style.gridTemplateColumns='1fr'; grid.style.gridTemplateRows='1fr';
  grid.innerHTML=`<div class="cell big s-conn" data-ip="${esc(cam.ip)}">
    <canvas id="cv-${esc(cam.ip)}"></canvas>
    ${cornersHTML()}
    <div class="tag"><b>CAM ${esc(camNum(cam))}</b><span>${esc(cam.label)}</span></div>
    <div class="badge load" id="st-${esc(cam.ip)}"><span class="d"></span>${t('st.rec')}</div>
    <div class="ph" id="ph-${esc(cam.ip)}"><svg viewBox="0 0 24 24" fill="none" stroke-width="2"><path d="M3 12a9 9 0 1 0 2-5.6" stroke-linecap="round"/><path d="M4 3v4h4"/></svg><span id="pbhint" style="letter-spacing:.12em">${t('ph.segments')}</span></div>
    <div class="ip">${esc(cam.ip)}</div></div>`;

  updateStatusCard();
  const res=await window.api.playbackQuery(pbCamera, pbDate);
  if(gen!==pbDayGen || mode!=='playback' || !$('pbhint')) return; // superseded (other camera/day/mode)
  if(!res.ok){ $('pbhint').textContent=errText(res,'pb.loadfail'); $('tl-empty').textContent=errText(res,'pb.loadfail.nvr'); $('tl-empty').style.display='grid'; return; }
  pbSegments=res.segments.map(s=>({
    b:dvrTimeMsOfDay(s.begin), e:dvrTimeMsOfDay(s.end),
    event:/alarm|motion|event|detect/i.test(s.event||''), raw:s
  })).filter(s=>s.e>s.b).sort((a,b)=>a.b-b.b);
  renderTimeline();
  if(pbSegments.length){
    pbCursor=pbSegments[0].b; updateClock();
    $('pbhint').textContent=t('pb.segments', pbSegments.length);
  } else {
    $('pbhint').textContent=t('pb.none');
  }
}

function renderTimeline(){
  const tl=$('timeline');
  // hours
  const hrs=$('tl-hours'); if(!hrs.dataset.built){ let h=''; for(let i=0;i<=24;i+=2){ h+=`<div class="tl-hour" style="left:${i/24*100}%"><span>${pad(i%24)}</span></div>`; } hrs.innerHTML=h; hrs.dataset.built='1'; }
  // clear old segs
  [...tl.querySelectorAll('.tl-seg')].forEach(e=>e.remove());
  $('tl-empty').style.display = pbSegments.length? 'none':'grid';
  if(pbSegments.length) $('tl-empty').style.display='none';
  pbSegments.forEach(s=>{
    const d=document.createElement('div'); d.className='tl-seg'+(s.event?' event':'');
    d.style.left=(s.b/DAY*100)+'%'; d.style.width=Math.max(0.15,(s.e-s.b)/DAY*100)+'%';
    d.title=`${msToClock(s.b)} – ${msToClock(s.e)}`;
    tl.appendChild(d);
  });
  updatePlayhead();
}

function updatePlayhead(){
  const ph=$('tl-play');
  if(!pbCamera || !pbSegments.length){ ph.style.display='none'; return; }
  ph.style.display='block'; ph.style.left=(pbCursor/DAY*100)+'%';
}
function updateClock(){ $('tp-time').textContent=msToClock(pbCursor); $('tp-date').textContent=pbDate; updatePlayhead(); }

function segmentAt(ms){ return pbSegments.find(s=>ms>=s.b && ms<s.e); }
function nextSegment(ms){ return pbSegments.find(s=>s.b>ms); }

function stopPbPlayer(){ if(pbPlayer){try{pbPlayer.destroy()}catch{} pbPlayer=null;} }

async function pbPlay(){
  if(!pbCamera||!pbSegments.length) return;
  // if cursor is in a gap, jump to next segment
  if(!segmentAt(pbCursor)){ const n=nextSegment(pbCursor); if(n) pbCursor=n.b; else { pbCursor=pbSegments[0].b; } }
  pbPlaying=true; setPlayIcon();
  await startPbStream();
  startTicker();
}
function pbPause(){ pbStreamGen++; pbPlaying=false; setPlayIcon(); stopTicker(); stopPbPlayer(); window.api.playbackStop(PB_ID); }
function setPlayIcon(){ $('tp-play-ic').innerHTML = pbPlaying ? '<path d="M6 5h4v14H6zM14 5h4v14h-4z"/>' : '<path d="M7 5v14l12-7z"/>'; }

let pbStreamGen = 0;
async function startPbStream(){
  const gen = ++pbStreamGen;
  stopPbPlayer(); window.api.playbackStop(PB_ID);
  const start=msOfDayToDVR(pbDate, pbCursor);
  const end=msOfDayToDVR(pbDate, DAY-1000);
  pbCursorBase=pbCursor; pbWallStart=Date.now();
  const res=await window.api.playbackStart(PB_ID, pbCamera, start, end, pbSpeed);
  if(gen!==pbStreamGen || mode!=='playback') return; // a newer seek/speed change took over
  if(res.superseded) return;
  const st=$(`st-${pbCamera}`), ph=$(`ph-${pbCamera}`), cell=[...grid.querySelectorAll('.cell')][0];
  if(!res.ok){ const hint=$('pbhint'); if(hint)hint.textContent=errText(res,'pb.fail'); pbPlaying=false; setPlayIcon(); stopTicker(); return; }
  const cv=$(`cv-${pbCamera}`);
  if(cv){
    pbPlayer=new JSMpeg.Player(`ws://127.0.0.1:${res.wsPort}`,{
      canvas:cv, autoplay:true, audio:false, disableGl:false, preserveDrawingBuffer:true, videoBufferSize:2*1024*1024,
      onSourceEstablished:()=>{ if(cell){cell.classList.remove('s-conn','s-off');} if(st){st.className='badge live';st.innerHTML='<span class="d"></span>'+t('st.playing');} if(ph)ph.style.display='none'; updateStatusCard(); },
    });
  }
}

function startTicker(){ stopTicker(); pbTicker=setInterval(()=>{
  if(!pbPlaying) return;
  pbCursor = pbCursorBase + (Date.now()-pbWallStart)*pbSpeed;
  const seg=segmentAt(pbCursor);
  if(!seg){
    const n=nextSegment(pbCursor);
    if(n){ pbCursor=n.b; seekTo(pbCursor,true); } // jump over gap
    else { pbCursor=pbSegments[pbSegments.length-1].e; pbPause(); updateClock(); return; }
  }
  if(pbCursor>=DAY-1000){ pbPause(); }
  updateClock();
},250); }
function stopTicker(){ if(pbTicker){clearInterval(pbTicker);pbTicker=null;} }

function seekTo(ms, keepPlaying){
  pbCursor=Math.max(0,Math.min(DAY-1000,ms)); updateClock();
  if(pbSeekTimer) clearTimeout(pbSeekTimer);
  if(pbPlaying || keepPlaying){
    pbSeekTimer=setTimeout(()=>{ startPbStream(); },180); // debounce scrubbing
  }
}

// ---------- mode switch ----------
function setMode(m){
  if(m===mode) return;
  mode=m;
  document.body.classList.toggle('mode-playback', m==='playback');
  document.body.classList.toggle('mode-live', m==='live');
  [...$('modeswitch').children].forEach(b=>b.classList.toggle('active',b.dataset.mode===m));
  $('live-ctrls').style.display = m==='live'?'flex':'none';
  $('pb-ctrls').style.display = m==='playback'?'flex':'none';
  $('viewtitle').firstChild.textContent = t(m==='live'?'view.live':'view.playback');
  if(m==='playback'){ stopPlayers(); window.api.showCameras([], 'grid'); renderCamList(); loadPlaybackDay(); }
  else { pbPause(); stopPbPlayer(); renderCamList(); renderLive(); }
}

// ---------- settings ----------
async function openSettings(){
  const cfg=await window.api.getNvrConfig();
  $('nvr-ip').value=cfg.ip||''; $('nvr-port').value=cfg.port||34567;
  $('nvr-user').value=cfg.user||'admin'; $('nvr-pass').value=cfg.password||'';
  $('testmsg').className='testmsg'; $('modal').classList.add('show');
}
function closeSettings(){ $('modal').classList.remove('show'); }
async function saveSettings(){
  await window.api.saveNvrConfig({ ip:$('nvr-ip').value.trim(), port:$('nvr-port').value.trim(),
    user:$('nvr-user').value.trim(), password:$('nvr-pass').value });
  closeSettings();
  if(mode==='playback') loadPlaybackDay();
}
async function testNvr(){
  const tm=$('testmsg'); tm.className='testmsg'; tm.textContent=t('nvr.testing'); tm.classList.add('ok');
  await window.api.saveNvrConfig({ ip:$('nvr-ip').value.trim(), port:$('nvr-port').value.trim(),
    user:$('nvr-user').value.trim(), password:$('nvr-pass').value });
  const r=await window.api.testNvr();
  if(r.ok){ tm.className='testmsg ok'; tm.textContent=t('nvr.ok', r.channels&&r.channels.length?r.channels.length:'—'); }
  else { tm.className='testmsg bad'; tm.textContent='✗ '+errText(r,'nvr.fail')+(r.ret?` (Ret ${r.ret})`:''); }
}

// ---------- events ----------
$('modeswitch').onclick=(e)=>{const b=e.target.closest('button'); if(b)setMode(b.dataset.mode);};
$('search').oninput=(e)=>{search=e.target.value; renderCamList();};
$('btn-collapse').onclick=()=>document.body.classList.toggle('collapsed');
$('btn-settings').onclick=openSettings;
$('btn-cancel').onclick=closeSettings; $('btn-save').onclick=saveSettings; $('btn-test').onclick=testNvr;
$('modal').onclick=(e)=>{ if(e.target===$('modal')) closeSettings(); };
$('btn-refresh').onclick=()=>mode==='live'?renderLive():loadPlaybackDay();

$('layoutseg').onclick=(e)=>{const b=e.target.closest('button'); if(!b)return;
  [...$('layoutseg').children].forEach(x=>x.classList.toggle('active',x===b));
  layout=+b.dataset.n; page=0; renderLive();};
$('pg-prev').onclick=()=>{if(page>0){page--;renderLive();}};
$('pg-next').onclick=()=>{const tp=Math.ceil(selected.length/layout); if(page<tp-1){page++;renderLive();}};

$('pb-date').onchange=(e)=>{pbDate=e.target.value; loadPlaybackDay();};
$('pb-today').onclick=()=>{pbDate=todayStr(); $('pb-date').value=pbDate; loadPlaybackDay();};
$('pb-yest').onclick=()=>{const d=new Date();d.setDate(d.getDate()-1);pbDate=todayStr(d);$('pb-date').value=pbDate;loadPlaybackDay();};

$('tp-play').onclick=()=>pbPlaying?pbPause():pbPlay();
$('tp-back').onclick=()=>seekTo(pbCursor-10000,false);
$('tp-fwd').onclick=()=>seekTo(pbCursor+10000,false);
$('speedsel').onclick=(e)=>{const b=e.target.closest('button'); if(!b)return;
  [...$('speedsel').children].forEach(x=>x.classList.toggle('active',x===b));
  pbSpeed=+b.dataset.s; if(pbPlaying){ pbCursorBase=pbCursor; pbWallStart=Date.now(); startPbStream(); }};

// timeline interactions
const tl=$('timeline');
tl.onclick=(e)=>{ if(!pbSegments.length)return; const r=tl.getBoundingClientRect();
  const frac=Math.max(0,Math.min(1,(e.clientX-r.left)/r.width)); seekTo(frac*DAY, false); };
tl.onmousemove=(e)=>{ const r=tl.getBoundingClientRect(); const frac=(e.clientX-r.left)/r.width;
  const tip=$('tl-tip'); tip.style.display='block'; tip.style.left=(frac*100)+'%'; tip.textContent=msToClock(frac*DAY); };
tl.onmouseleave=()=>{ $('tl-tip').style.display='none'; };

// keyboard
document.addEventListener('keydown',(e)=>{
  if(e.target.tagName==='INPUT') return;
  if(e.key==='Escape'){ if($('modal').classList.contains('show'))closeSettings();
    else if(fullIp){ const c=[...grid.children].find(x=>x.classList.contains('full')); if(c){c.classList.remove('full');renderLive();} } return; }
  if(e.key==='b'||e.key==='B'){ document.body.classList.toggle('collapsed'); return; }
  if(mode==='live'){
    if(['1','2','3','4','5'].includes(e.key)){ const map={'1':1,'2':4,'3':9,'4':16,'5':25}; layout=map[e.key];page=0;
      [...$('layoutseg').children].forEach(x=>x.classList.toggle('active',+x.dataset.n===layout)); renderLive(); }
  } else {
    if(e.code==='Space'){ e.preventDefault(); pbPlaying?pbPause():pbPlay(); }
    else if(e.key==='ArrowLeft'){ seekTo(pbCursor-(e.shiftKey?60000:10000),false); }
    else if(e.key==='ArrowRight'){ seekTo(pbCursor+(e.shiftKey?60000:10000),false); }
  }
});

// ---------- init ----------
applyI18n();
$('viewtitle').firstChild.textContent=t('view.live');
$('pb-date').value=pbDate;
window.api.getInfo().then(info=>{ if(info&&info.demo){ const b=$('netbadge'); b.textContent=t('badge.demo'); b.style.display=''; } });
window.api.getCameras().then(cs=>{ cameras=cs; renderCamList(); renderLive(); });
