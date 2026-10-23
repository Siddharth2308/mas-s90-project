// Phone controller for the booth. Talks to the booth page through Vite's WebSocket ('pie:remote' events,
// relayed by server/remote.js): phone -> { to: 'booth', ... }, booth -> { to: 'phone', ... }. All local.
import { Listener } from './voice.js';

const $ = (id) => document.getElementById(id);
const send = (msg) => import.meta.hot?.send('pie:remote', { to: 'booth', ...msg });
const buzz = (p) => navigator.vibrate?.(p);

const SUBS = {
  pie: 'Classic', stone: 'Heavy', tomato: 'Messy', egg: 'Sticky', paint: 'Colorful',
  bat: 'A satisfying crack', headbutt: 'It hurts you more', smash: 'Glass everywhere', stab: 'He leaks light',
  unplug: 'Lights out', delete: 'Wipes his memory', repair: 'Patch him up', hug: 'Hold on', flowers: 'He keeps them',
  pat: 'Gently', highfive: 'Up top', fistbump: 'Respect',
};
const CHIPS = ['Who are you?', 'What can you do for me?', 'What did you do?', 'Undo that.', 'Are you doing this on purpose?', 'I think I should go.'];
const TOOLS = [
  { name: 'bat', icon: '🏏', label: 'Bat', hint: 'Swing your phone sideways like a bat', threshold: 16 },
  { name: 'smash', icon: '🔨', label: 'Hammer', hint: 'Chop down hard', threshold: 16 },
  { name: 'stab', icon: '🪛', label: 'Stab', hint: 'Thrust your phone forward', threshold: 15 },
  { name: 'pie', icon: '🥧', label: 'Pie', hint: 'Flick your wrist to throw', threshold: 13 },
  { name: 'highfive', icon: '✋', label: 'High five', hint: 'Push forward for a five', threshold: 9 },
  { name: 'fistbump', icon: '👊', label: 'Fist bump', hint: 'Punch gently forward', threshold: 9 },
];

// ---------- connection + booth state ----------
let lastHeard = 0;
let catalog = [];
const ammo = {};
const dot = $('dot'), statusEl = $('status'), captionEl = $('caption');

import.meta.hot?.on('pie:remote', (m) => {
  if (m.to !== 'phone') return;
  lastHeard = performance.now();
  if (m.type === 'hello') {
    catalog = m.catalog;
    Object.assign(ammo, m.ammo);
    buildTiles();
    setStatus(m.status);
    setCaption(m.caption);
    renderLedger(m.ledger);
  }
  if (m.type === 'status') setStatus(m.status);
  if (m.type === 'caption') setCaption(m.text, m.heard);
  if (m.type === 'ammo') { ammo[m.kind] = m; renderAmmo(m.kind); }
  if (m.type === 'card') showCard(m);
  if (m.type === 'ledger') renderLedger(m.items);
});
send({ type: 'hello' });
setInterval(() => {
  send({ type: 'ping' });
  if (performance.now() - lastHeard > 5000) { statusEl.textContent = 'Looking for the booth…'; dot.className = 'dot'; }
}, 2000);

const STATUS = { idle: ['Online', 'live'], speaking: ['Speaking', 'speaking'], listening: ['Listening', 'listening'],
  thinking: ['Thinking', 'live'], unplugged: ['Unplugged', 'down'], deleted: ['Deleted', 'down'], 'in space': ['In space', 'down'],
  loading: ['Waking up', ''] };
function setStatus(s) {
  const [text, cls] = STATUS[s] ?? [s, 'live'];
  statusEl.textContent = text;
  dot.className = `dot ${cls}`;
}
function setCaption(text, heard) {
  if (!text) return;
  captionEl.textContent = text;
  captionEl.classList.toggle('heard', !!heard || /^[“"]/.test(text));
  captionEl.classList.toggle('pie', !heard && !/^[“"]/.test(text));
}

// ---------- tabs ----------
for (const b of document.querySelectorAll('#tabs button')) {
  b.addEventListener('click', () => {
    for (const x of document.querySelectorAll('#tabs button')) x.classList.toggle('on', x === b);
    for (const p of document.querySelectorAll('.panel')) p.classList.toggle('on', p.dataset.panel === b.dataset.tab);
    buzz(8);
  });
}

// ---------- action tiles ----------
function buildTiles() {
  for (const g of ['throw', 'hurt', 'kind']) $(`grid-${g}`).innerHTML = '';
  for (const a of catalog) {
    const t = document.createElement('button');
    t.className = 'tile';
    t.dataset.group = a.group;
    t.dataset.name = a.name;
    t.innerHTML = `<span class="icon">${a.icon}</span><span><div class="name">${a.label}</div><div class="sub">${SUBS[a.name] ?? ''}</div></span>`
      + (a.group === 'throw' ? '<div class="ammo"></div>' : '');
    t.addEventListener('pointerdown', (e) => {
      const r = t.getBoundingClientRect();
      t.style.setProperty('--x', `${e.clientX - r.left}px`);
      t.style.setProperty('--y', `${e.clientY - r.top}px`);
    });
    t.addEventListener('click', () => {
      send({ type: 'act', name: a.name });
      buzz(a.group === 'hurt' ? [20, 30, 40] : 15);
      t.classList.remove('pop'); void t.offsetWidth; t.classList.add('pop');
      setTimeout(() => t.classList.remove('pop'), 60);
    });
    $(`grid-${a.group}`).append(t);
    if (a.group === 'throw') renderAmmo(a.name);
  }
}
function renderAmmo(kind) {
  const t = document.querySelector(`.tile[data-name="${kind}"]`), a = ammo[kind];
  if (!t || !a) return;
  t.querySelector('.ammo').innerHTML = Array.from({ length: a.capacity }, (_, i) => `<i class="${i < a.charges ? '' : 'empty'}"></i>`).join('');
  t.disabled = a.charges < 1 || a.cooldown > 0;
  t.querySelector('.sub').textContent = a.charges < 1 ? `Refills in ${a.recharge}s` : SUBS[kind];
}
for (const b of document.querySelectorAll('[data-act]')) b.addEventListener('click', () => { send({ type: 'act', name: b.dataset.act }); buzz(20); });
for (const b of document.querySelectorAll('[data-booth]')) b.addEventListener('click', () => { send({ type: b.dataset.booth }); buzz(10); });

// ---------- tradeoff sheet ----------
const sheet = $('sheet');
let sheetTimer = null;
function showCard(c) {
  $('sheet-chose').textContent = c.chose;
  $('sheet-got').textContent = c.got;
  $('sheet-cost').textContent = c.cost;
  sheet.classList.toggle('kind', !!c.kind);
  sheet.classList.add('on');
  clearTimeout(sheetTimer);
  sheetTimer = setTimeout(() => sheet.classList.remove('on'), 7500);
}
sheet.addEventListener('click', () => sheet.classList.remove('on'));
function renderLedger(items = []) {
  $('ledger').innerHTML = items.map((i) => `<span>${i}</span>`).join('');
}

// ---------- talk: hold to talk (the phone's own speech recognition), or type ----------
const listener = new Listener();
const mic = $('mic');
listener.on.interim = (t) => { send({ type: 'interim', text: t }); setCaption(`“${t}”`, true); };
async function micDown(e) {
  e.preventDefault();
  if (!listener.supported) { mic.querySelector('.mic-label').textContent = 'Type instead'; $('text').focus(); return; }
  if (listener.rec) return;
  mic.classList.add('on');
  buzz(12);
  send({ type: 'listen', on: true });
  listener.start();
}
async function micUp() {
  if (!listener.rec) return;
  mic.classList.remove('on');
  const text = await listener.stop();
  send({ type: 'say', text });
}
mic.addEventListener('pointerdown', micDown);
mic.addEventListener('pointerup', micUp);
mic.addEventListener('pointercancel', micUp);
mic.addEventListener('contextmenu', (e) => e.preventDefault());
$('type').addEventListener('submit', (e) => {
  e.preventDefault();
  const text = $('text').value.trim();
  if (!text) return;
  send({ type: 'say', text });
  $('text').value = '';
  $('text').blur();
});
$('chips').innerHTML = CHIPS.map((c) => `<button>${c}</button>`).join('');
for (const b of $('chips').children) b.addEventListener('click', () => { send({ type: 'say', text: b.textContent }); buzz(10); });

// ---------- motion: swing the phone ----------
let tool = TOOLS[0];
let motionOn = false;
let gravity = null;          // low-passed gravity, for phones that only report acceleration including gravity
let peak = 0, peakUntil = 0, cooldownUntil = 0;
const level = $('level'), mark = $('mark'), meter = $('meter');
const RANGE = 30;            // m/s² for a full ring
$('tools').innerHTML = TOOLS.map((t, i) => `<button class="${i ? '' : 'on'}" data-i="${i}"><span>${t.icon}</span>${t.label}</button>`).join('');
for (const b of $('tools').children) {
  b.addEventListener('click', () => {
    tool = TOOLS[+b.dataset.i];
    for (const x of $('tools').children) x.classList.toggle('on', x === b);
    $('tool-icon').textContent = tool.icon;
    $('tool-hint').textContent = tool.hint;
    setMark();
    buzz(8);
  });
}
function setMark() { mark.style.strokeDashoffset = `${-(tool.threshold / RANGE) * 327}`; }
setMark();

$('enable-motion').addEventListener('click', async () => {
  if (motionOn) { motionOn = false; $('enable-motion').textContent = 'Enable motion'; $('enable-motion').classList.remove('armed'); return; }
  try {
    if (typeof DeviceMotionEvent?.requestPermission === 'function') {            // iOS asks first
      if (await DeviceMotionEvent.requestPermission() !== 'granted') throw new Error('denied');
    }
    if (!('DeviceMotionEvent' in window)) throw new Error('no sensor');
    motionOn = true;
    $('enable-motion').textContent = `Armed · ${tool.label}  (tap to disarm)`;
    $('enable-motion').classList.add('armed');
    $('motion-note').textContent = 'Swing harder to hit harder. Keep a good grip.';
    buzz([10, 40, 10]);
  } catch (err) {
    $('motion-note').textContent = `Motion unavailable here (${err.message}). Open this page over https.`;
  }
});

window.addEventListener('devicemotion', (e) => {
  if (!motionOn) return;
  let a = e.acceleration;
  if (!a || a.x == null) {                       // fall back to removing a low-passed gravity estimate
    const g = e.accelerationIncludingGravity;
    if (!g) return;
    gravity = gravity ? { x: gravity.x * 0.9 + g.x * 0.1, y: gravity.y * 0.9 + g.y * 0.1, z: gravity.z * 0.9 + g.z * 0.1 } : { ...g };
    a = { x: g.x - gravity.x, y: g.y - gravity.y, z: g.z - gravity.z };
  }
  const mag = Math.hypot(a.x, a.y, a.z);
  level.style.strokeDashoffset = `${327 - Math.min(1, mag / RANGE) * 327}`;
  const now = performance.now();
  if (now < cooldownUntil) return;
  if (mag > tool.threshold && !peakUntil) { peakUntil = now + 140; peak = mag; }   // collect the peak of this swing
  if (peakUntil) {
    peak = Math.max(peak, mag);
    if (now >= peakUntil) {
      const strength = Math.max(0.6, Math.min(1.8, 0.6 + (peak - tool.threshold) / 18));
      send({ type: 'act', name: tool.name, strength });
      buzz(tool.threshold > 10 ? [40, 30, 80] : [20]);
      meter.classList.add('hit');
      setTimeout(() => meter.classList.remove('hit'), 220);
      peakUntil = 0;
      cooldownUntil = now + 1300;
    }
  }
});
