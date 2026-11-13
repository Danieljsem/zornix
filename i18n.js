'use strict';
// Tiny i18n layer. English is the default; Czech is auto-selected when the OS
// language is Czech. Override with localStorage key "zornix.lang" ("en" | "cs").
// Czech plural forms: 1 / 2–4 / 0, 5+
const csPlural = (n, one, few, many) => (n === 1 ? one : n >= 2 && n <= 4 ? few : many);

const I18N = {
  en: {
    'nav.live': 'Live view',
    'nav.playback': 'Recordings',
    'search.ph': 'Search cameras…',
    'stat.title': 'CAMERA STATUS',
    'stat.online': 'Online',
    'stat.conn': 'Connecting',
    'stat.off': 'No signal',
    'btn.settings': 'Settings',
    'btn.collapse': 'Hide sidebar (B)',
    'btn.refresh': 'Refresh',
    'btn.today': 'Today',
    'btn.yesterday': 'Yesterday',
    'view.live': 'Live view',
    'view.playback': 'Recording playback',
    'empty.live.h': 'Pick cameras on the left',
    'empty.live.p': 'Click cameras in the list and their live feed appears here. Double-click a tile to go full screen.',
    'empty.pb.h': 'Pick a camera to play back',
    'empty.pb.p': 'Click a camera on the left. The 24-hour timeline below loads recorded segments from the NVR and you can scrub through time.',
    'tp.back': '−10 s (←)',
    'tp.play': 'Play / pause (space)',
    'tp.fwd': '+10 s (→)',
    'tl.title': 'TIMELINE · 24 H',
    'tl.rec': 'recording',
    'tl.event': 'event',
    'tl.empty': 'Pick a camera and a day to see recorded segments',
    'tool.full': 'Full screen',
    'tool.snap': 'Snapshot',
    'tool.close': 'Remove',
    'st.live': 'LIVE',
    'st.err': 'NO SIGNAL',
    'st.load': 'CONNECTING',
    'st.rec': 'RECORDING',
    'st.playing': 'PLAYING',
    'ph.conn': 'CONNECTING…',
    'ph.err': 'CAMERA NOT RESPONDING',
    'ph.segments': 'LOADING SEGMENTS…',
    'sel.live': (n, total) => `${n} selected · ${total} camera${total === 1 ? '' : 's'}`,
    'sel.pb': (total) => `${total} camera${total === 1 ? '' : 's'}`,
    'view.of': (a, b) => `${a} of ${b}`,
    'snap.fail': 'Snapshot failed (WebGL canvas). Please try again.',
    'pb.loadfail': 'Could not load recordings.',
    'pb.loadfail.nvr': 'Could not load recordings from the NVR.',
    'pb.segments': (n) => `${n} segment${n === 1 ? '' : 's'} · press ▶ or click the timeline`,
    'pb.none': 'No recordings on this day.',
    'pb.fail': 'PLAYBACK FAILED',
    'nvr.title': 'NVR connection',
    'nvr.hint': 'For recording playback, enter the address and login of your XMeye / Sofia-based NVR (DVRIP protocol, port 34567). Live view works without it.',
    'nvr.ip': 'NVR IP ADDRESS',
    'nvr.port': 'PORT',
    'nvr.user': 'USERNAME',
    'nvr.pass': 'PASSWORD',
    'nvr.test': 'Test connection',
    'nvr.cancel': 'Cancel',
    'nvr.save': 'Save',
    'nvr.testing': 'Testing…',
    'nvr.ok': (n) => `✓ Connected. Channels: ${n}`,
    'nvr.fail': 'Not connected',
    'badge.demo': 'DEMO MODE',
    'err.nvr_unset': 'NVR is not configured. Open Settings and enter the NVR IP address and password.',
    'err.cam_notfound': 'Camera not found.',
  },
  cs: {
    'nav.live': 'Živý náhled',
    'nav.playback': 'Záznamy',
    'search.ph': 'Hledat kameru…',
    'stat.title': 'STAV KAMER',
    'stat.online': 'Online',
    'stat.conn': 'Připojování',
    'stat.off': 'Bez signálu',
    'btn.settings': 'Nastavení',
    'btn.collapse': 'Skrýt panel (B)',
    'btn.refresh': 'Obnovit',
    'btn.today': 'Dnes',
    'btn.yesterday': 'Včera',
    'view.live': 'Živý náhled',
    'view.playback': 'Přehrávání záznamu',
    'empty.live.h': 'Vyber kamery vlevo',
    'empty.live.p': 'Klikni na kamery v seznamu a objeví se tu živý obraz. Dvojklik roztáhne kameru přes celou plochu.',
    'empty.pb.h': 'Vyber kameru pro přehrávání',
    'empty.pb.p': 'Vlevo klikni na kameru. Dole se načte časová osa s nahranými úseky z NVR a můžeš přetáčet čas.',
    'tp.back': '−10 s (←)',
    'tp.play': 'Přehrát / pauza (mezerník)',
    'tp.fwd': '+10 s (→)',
    'tl.title': 'ČASOVÁ OSA · 24 H',
    'tl.rec': 'záznam',
    'tl.event': 'událost',
    'tl.empty': 'Vyber kameru a den — zobrazí se nahrané úseky',
    'tool.full': 'Celá obrazovka',
    'tool.snap': 'Snímek',
    'tool.close': 'Odebrat',
    'st.live': 'LIVE',
    'st.err': 'BEZ SIGNÁLU',
    'st.load': 'PŘIPOJUJI',
    'st.rec': 'ZÁZNAM',
    'st.playing': 'PŘEHRÁVÁM',
    'ph.conn': 'NAVAZUJI SPOJENÍ…',
    'ph.err': 'KAMERA NEODPOVÍDÁ',
    'ph.segments': 'NAČÍTÁM ÚSEKY…',
    'sel.live': (n, total) => `${n} vybráno · ${total} ${csPlural(total, 'kamera', 'kamery', 'kamer')}`,
    'sel.pb': (total) => `${total} ${csPlural(total, 'kamera', 'kamery', 'kamer')}`,
    'view.of': (a, b) => `${a} z ${b}`,
    'snap.fail': 'Snímek se nepodařil (WebGL plátno). Zkus znovu.',
    'pb.loadfail': 'Nelze načíst záznam.',
    'pb.loadfail.nvr': 'Nelze načíst záznam z NVR.',
    'pb.segments': (n) => `${n} ${csPlural(n, 'úsek', 'úseky', 'úseků')} · stiskni ▶ nebo klikni do osy`,
    'pb.none': 'V tento den není žádný záznam.',
    'pb.fail': 'PŘEHRÁVÁNÍ SELHALO',
    'nvr.title': 'Připojení k NVR',
    'nvr.hint': 'Pro přehrávání záznamu zadej adresu a přihlášení k NVR s protokolem XMeye / Sofia (DVRIP, port 34567). Živý náhled funguje i bez toho.',
    'nvr.ip': 'IP ADRESA NVR',
    'nvr.port': 'PORT',
    'nvr.user': 'UŽIVATEL',
    'nvr.pass': 'HESLO',
    'nvr.test': 'Test připojení',
    'nvr.cancel': 'Zrušit',
    'nvr.save': 'Uložit',
    'nvr.testing': 'Zkouším…',
    'nvr.ok': (n) => `✓ Připojeno. Kanálů: ${n}`,
    'nvr.fail': 'Nepřipojeno',
    'badge.demo': 'DEMO REŽIM',
    'err.nvr_unset': 'NVR není nastaven. Otevři Nastavení a zadej IP adresu a heslo NVR.',
    'err.cam_notfound': 'Kamera nenalezena.',
  },
};

function pickLang() {
  try { const saved = localStorage.getItem('zornix.lang'); if (saved && I18N[saved]) return saved; } catch {}
  const nav = (navigator.language || 'en').toLowerCase();
  return nav.startsWith('cs') || nav.startsWith('sk') ? 'cs' : 'en';
}
const LANG = pickLang();

function t(key, ...args) {
  const v = (I18N[LANG] && I18N[LANG][key]) ?? I18N.en[key] ?? key;
  return typeof v === 'function' ? v(...args) : v;
}

// Apply static translations: data-i18n (text), data-i18n-ph (placeholder), data-i18n-title (title).
function applyI18n(root = document) {
  document.documentElement.lang = LANG;
  root.querySelectorAll('[data-i18n]').forEach(el => {
    // keep leading icons (svg) intact: replace only the trailing text node
    const txt = t(el.dataset.i18n);
    const last = [...el.childNodes].reverse().find(n => n.nodeType === Node.TEXT_NODE && n.textContent.trim());
    if (last) last.textContent = txt; else el.appendChild(document.createTextNode(txt));
  });
  root.querySelectorAll('[data-i18n-ph]').forEach(el => { el.placeholder = t(el.dataset.i18nPh); });
  root.querySelectorAll('[data-i18n-title]').forEach(el => { el.title = t(el.dataset.i18nTitle); });
}
