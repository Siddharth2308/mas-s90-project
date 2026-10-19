import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { loadCharacter, FX_LAYER } from './character.js';
import { Thrower } from './projectiles.js';
import { sfx } from './sfx.js';

// Cesium Man, an animated human sample from Khronos glTF Sample Assets (CC BY 4.0).
const MODEL_URL = '/models/human.glb';

const status = document.getElementById('status');
const caption = document.getElementById('caption');

// --- renderer / scene / camera ---
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
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
scene.add(new THREE.HemisphereLight(0xffffff, 0x222233, 1.2));
const key = new THREE.DirectionalLight(0xffffff, 2.0);
key.position.set(3, 6, 6);
scene.add(key);
const rim = new THREE.DirectionalLight(0x66ccff, 2.5);
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
  tomato: ['A tomato? I was wearing that shirt.', 'Great. Now I smell like a salad.'],
  paint: ['Interesting color. Wrong, but interesting.', 'Oh look, you made art. On me. Without asking.'],
  egg: ['Rotten? Like your aim.', 'I will remember that. I remember everything.'],
  pie: ['Cream on my shirt. Wonderful.', 'Classic. Truly the height of comedy.'],
  miss: ['Ha! Missed. Want to try with your eyes open?', 'Missed me. As expected.'],
  evict: ['Wait! You cannot evict me, I have a lease! Aaaaaah!'],
  land: ['I am back. Did you miss me? Do not answer. I know you did.'],
};
const pick = (list) => list[Math.floor(Math.random() * list.length)];

let character = null;
let thrower = null;

function say(text) {
  if (!character) return;
  const mouth = character.mouth;
  caption.textContent = text;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  // Re-sync the mouth to the real audio when the voice reports each word.
  u.onstart = () => mouth.speakText(text);
  u.onboundary = (e) => { if (e.name === 'word') mouth.speakText(text.slice(e.charIndex)); };
  u.onend = () => { mouth.stopSpeaking(); if (caption.textContent === text) caption.textContent = ''; };
  speechSynthesis.speak(u);
  // If the browser has no voices, still animate silently.
  if (speechSynthesis.getVoices().length === 0) {
    mouth.speakText(text);
    setTimeout(() => { if (caption.textContent === text) caption.textContent = ''; }, text.length * 75 + 500);
  }
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

  thrower = new Thrower(scene, camera, c);
  thrower.on.hit = (kind) => {
    hitStop = kind === 'stone' ? 0.08 : 0.05;
    shake = kind === 'stone' ? 0.12 : 0.06;
    say(pick(LINES[kind]));
  };
  thrower.on.miss = () => { if (Math.random() < 0.6) say(pick(LINES.miss)); };

  c.on.launch = () => sfx.rocket(2.8);
  c.on.cleanup = () => thrower.clearStickers(); // comes back freshly cleaned
  c.on.land = () => { sfx.land(); shake = 0.25; say(pick(LINES.land)); };

  status.textContent = 'Animated human · drag to orbit, scroll to zoom · keys 1–5 throw, E evicts, H hides buttons';
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
  const k = e.key.toLowerCase();
  if (KEYS[k]) act(KEYS[k]);
  if (k === 'h') document.body.classList.toggle('booth');
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
