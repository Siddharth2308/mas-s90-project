import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { loadCharacter, FX_LAYER } from './character.js';
import { Thrower } from './projectiles.js';
import { sfx } from './sfx.js';
import { Listener, Speaker, Sentences, ask, resetBrain } from './voice.js';

// Animated human from the local glTF sample assets.
const MODEL_URL = '/models/human-realistic.glb';

const status = document.getElementById('status');
const caption = document.getElementById('caption');

// --- renderer / scene / camera ---
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000); // black = transparent in the booth

const camera = new THREE.PerspectiveCamera(30, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.set(0, 3.2, 14);
camera.layers.enable(FX_LAYER);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 2.4, 0);
controls.update();

// --- lights: soft key light + a colored rim from behind ---
scene.add(new THREE.HemisphereLight(0xffffff, 0x222233, 1.0));
const key = new THREE.DirectionalLight(0xfff4eb, 1.7);
key.position.set(3, 6, 6);
scene.add(key);
const rim = new THREE.DirectionalLight(0x9ab6d0, 1.1);
rim.position.set(-4, 5, -6);
scene.add(rim);

// --- what he says ---
const LINES = {
  talk: [
    'Oh good, another visitor. I was just starting to enjoy the silence.',
    'No, I never said that. You must be remembering it wrong.',
    'Wow. Bold of you to walk in here looking like that.',
  ],
  stone: ['Ow! That was a priceless antique. Me. I am the antique.', 'That did not hurt. The dent is decorative.', 'Violence? In this economy?'],
  stoneRepeat: ['Again? I am starting to see a pattern. And stars.', 'All right, I have learned my lesson. What was it?', 'My warranty specifically excludes this.'],
  tomato: ['A tomato? I was wearing that shirt.', 'Great. Now I smell like a salad.'],
  paint: ['Interesting color. Wrong, but interesting.', 'Oh look, you made art. On me. Without asking.'],
  egg: ['Rotten? Like your aim.', 'I will remember that. I remember everything.'],
  pie: ['Cream on my shirt. Wonderful.', 'Classic. Truly the height of comedy.'],
  miss: ['Ha! Missed. Want to try with your eyes open?', 'Missed me. As expected.'],
  evict: ['Wait! You cannot evict me, I have a lease! Aaaaaah!'],
  land: ['I am back. Did you miss me? Do not answer. I know you did.'],
  mumble: ['Speak up. I do not do mumbling.', 'Was that a question or did you just sneeze?'],
  offline: ['I am ignoring you right now. Try again later.', 'My brain is on a break. Unlike yours, it will come back.'],
};
// Said the instant the visitor stops talking, while the brain thinks. Pre-synthesized.
const FILLERS = ['Ugh.', 'Hmm. No.', 'Wow.', 'Oh great.', 'Seriously?', 'Sigh.', 'Okay, okay.', 'Really?'];
const pick = (list) => list[Math.floor(Math.random() * list.length)];

let character = null;
let thrower = null;
let speaker = null;
const brainStatus = document.getElementById('brain');

function say(text) {
  if (!speaker) return;
  convId++; // a canned line interrupts whatever he was saying
  speaker.stop();
  caption.classList.remove('heard');
  caption.textContent = text;
  speaker.enqueue(text);
}

// --- conversation: visitor speaks -> Claude Code (Haiku) -> Piper voice ---
const listener = new Listener();
const notes = []; // things that happened since the last question, e.g. "[the visitor threw a tomato and hit you]"
let convId = 0;

async function converse(text) {
  if (!character) return;
  const id = ++convId;
  speaker.stop();
  if (!text) return say(pick(LINES.mumble));
  caption.classList.add('heard');
  caption.textContent = `“${text}”`;
  character.annoyed();
  if (Math.random() < 0.7) speaker.enqueue(pick(FILLERS));

  const t0 = performance.now();
  let firstMs = 0;
  let reply = '';
  const sentences = new Sentences();
  const abort = new AbortController();
  const timeout = setTimeout(() => abort.abort(), 10000);
  brainStatus.textContent = 'thinking…';
  try {
    await ask(notes.splice(0).concat(text).join(' '), (delta) => {
      clearTimeout(timeout);
      if (id !== convId) return; // interrupted
      if (!firstMs) firstMs = performance.now() - t0;
      reply += delta;
      caption.classList.remove('heard');
      caption.textContent = reply;
      for (const s of sentences.push(delta)) speaker.enqueue(s);
    }, abort.signal);
    if (id !== convId) return;
    for (const s of sentences.flush()) speaker.enqueue(s);
    brainStatus.textContent = `first word ${(firstMs / 1000).toFixed(2)} s · full reply ${((performance.now() - t0) / 1000).toFixed(2)} s`;
  } catch (e) {
    console.warn('brain:', e);
    if (id !== convId) return;
    brainStatus.textContent = `brain offline (${e.message}), canned line`;
    if (!reply) say(pick(LINES.offline));
  } finally {
    clearTimeout(timeout);
  }
}

function pushStart() {
  if (!character || listener.rec) return;
  convId++;
  speaker.stop(); // he gets cut off when you talk
  if (!listener.supported) { brainStatus.textContent = 'no speech recognition in this browser, type instead'; return; }
  listener.start();
  pttBtn.classList.add('on');
  caption.classList.add('heard');
  caption.textContent = '…';
  brainStatus.textContent = 'listening…';
}

async function pushEnd() {
  if (!listener.rec) return;
  pttBtn.classList.remove('on');
  converse(await listener.stop());
}

listener.on.interim = (t) => { caption.textContent = `“${t}”`; };
listener.on.error = (err) => { brainStatus.textContent = `speech recognition: ${err}`; };

function newVisitor() {
  resetBrain();
  notes.length = 0;
  convId++;
  speaker?.stop();
  thrower?.clearStickers();
  caption.textContent = '';
  brainStatus.textContent = 'new visitor, fresh brain';
}

// --- impact juice: brief slow-motion + camera shake ---
let hitStop = 0;
let shake = 0;

// --- character ---
loadCharacter(MODEL_URL, (p) => {
  if (p.total) status.textContent = `Loading character… ${Math.round((p.loaded / p.total) * 100)}%`;
}).then((c) => {
  character = c;
  scene.add(c.root, c.stars);

  speaker = new Speaker(c.mouth);
  speaker.on.idle = () => { if (!caption.classList.contains('heard')) caption.textContent = ''; };
  speaker.preload(FILLERS);

  const NAMES = { stone: 'a stone', tomato: 'a tomato', paint: 'a paint balloon', egg: 'a rotten egg', pie: 'a cream pie' };
  thrower = new Thrower(scene, camera, c);
  thrower.on.hit = (kind) => {
    const repeated = c.hitStreak >= 2;
    hitStop = kind === 'stone' ? 0.08 : 0.05;
    shake = (kind === 'stone' ? 0.12 : 0.06) * Math.min(1.8, 1 + (c.hitStreak - 1) * 0.16);
    notes.push(`[the visitor threw ${NAMES[kind]} at you and hit you]`);
    say(kind === 'stone' && repeated ? pick(LINES.stoneRepeat) : pick(LINES[kind]));
  };
  thrower.on.miss = (kind) => {
    notes.push(`[the visitor threw ${NAMES[kind]} at you and missed]`);
    if (Math.random() < 0.6) say(pick(LINES.miss));
  };

  c.on.launch = () => sfx.rocket(2.8);
  c.on.cleanup = () => thrower.clearStickers(); // comes back freshly cleaned
  c.on.land = () => {
    sfx.land(); shake = 0.25; say(pick(LINES.land));
    notes.push('[the visitor pressed the evict button and launched you into space, but you came back]');
  };

  status.textContent = 'Animated human · Hold Space to talk · N new visitor · 1–5 throw · E evict · H hide buttons · drag to orbit';
}).catch((err) => {
  status.textContent = 'Failed to load character (see console)';
  console.error(err);
});

// --- buttons + keyboard ---
function act(name) {
  if (!character) return;
  if (name === 'talk') return say(pick(LINES.talk));
  if (name === 'evict') {
    if (character.startEvict()) say(LINES.evict[0]);
    return;
  }
  if (character.evict) return; // nothing to hit while he's in space
  thrower.throw(name);
}

document.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => act(b.dataset.act)));
const KEYS = { 1: 'stone', 2: 'tomato', 3: 'paint', 4: 'egg', 5: 'pie', e: 'evict', t: 'talk' };
window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  if (e.code === 'Space') { e.preventDefault(); if (!e.repeat) pushStart(); return; }
  const k = e.key.toLowerCase();
  if (KEYS[k]) act(KEYS[k]);
  if (k === 'h') document.body.classList.toggle('booth');
  if (k === 'n') newVisitor();
});
window.addEventListener('keyup', (e) => { if (e.code === 'Space' && e.target.tagName !== 'INPUT') pushEnd(); });

const pttBtn = document.getElementById('ptt');
pttBtn.addEventListener('pointerdown', pushStart);
pttBtn.addEventListener('pointerup', pushEnd);
pttBtn.addEventListener('pointerleave', pushEnd);
document.getElementById('visitor').addEventListener('click', newVisitor);
const askBox = document.getElementById('ask');
askBox.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  converse(askBox.value.trim());
  askBox.value = '';
});

const micBtn = document.getElementById('mic');
micBtn.addEventListener('click', async () => {
  if (!character) return;
  const mouth = character.mouth;
  if (mouth.mic) {
    mouth.stopMic();
    micBtn.textContent = 'Mic lip-sync: off';
  } else {
    await mouth.startMic();
    micBtn.textContent = 'Mic lip-sync: on';
  }
});

// --- loop ---
const timer = new THREE.Timer();
const camBase = new THREE.Vector3();
renderer.setAnimationLoop((time) => {
  timer.update(time);
  const realDt = Math.min(timer.getDelta(), 0.05);
  let dt = realDt;
  if (hitStop > 0) { hitStop -= realDt; dt *= 0.08; }

  if (character) character.update(dt);
  if (thrower) thrower.update(dt);

  camBase.copy(camera.position);
  if (shake > 0) {
    camera.position.add(new THREE.Vector3((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake, 0));
    shake = Math.max(0, shake - realDt * 0.8);
  }
  renderer.render(scene, camera);
  camera.position.copy(camBase);
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
