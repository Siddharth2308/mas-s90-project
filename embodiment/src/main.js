import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { loadCharacter, FX_LAYER, EXPRESSIONS, POSTURES } from './character.js';
import { Thrower } from './projectiles.js';
import { Harm } from './harm.js';
import { FIDGET_NAMES } from './npc.js';
import qrcode from 'qrcode-generator';
import { sfx } from './sfx.js';
import { Listener, Speaker, Sentences, ask, resetBrain } from './voice.js';

// Default: the expression model from human-realistic-expressions.blend, with Pie's face shapes added by
// blender/transfer_face.py. Try another with ?model=<name>, e.g. ?model=pie
const MODEL_URL = `/models/${new URLSearchParams(location.search).get('model') ?? 'human-realistic-expressions'}.glb`;

const status = document.getElementById('status');
const caption = document.getElementById('caption');
const THROWABLES = {
  pie: { label: '🥧 Pie', key: '1' },
  stone: { label: '🪨 Rock', key: '2' },
  tomato: { label: '🍅 Tomato', key: '3' },
  egg: { label: '🥚 Egg', key: '4' },
  paint: { label: '🎨 Paint', key: '5' },
};

// --- renderer / scene / camera ---
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.localClippingEnabled = true; // the delete scan line
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000); // black = transparent in the booth

const camera = new THREE.PerspectiveCamera(30, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.set(0, 3.2, 12);
camera.layers.enable(FX_LAYER);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 2.4, 0);
controls.update();

// --- lights: soft key light + a colored rim from behind ---
const hemi = new THREE.HemisphereLight(0xffffff, 0x222233, 1.0);
scene.add(hemi);
const key = new THREE.DirectionalLight(0xfff4eb, 1.7);
key.position.set(3, 6, 6);
scene.add(key);
const rim = new THREE.DirectionalLight(0x9ab6d0, 1.1);
rim.position.set(-4, 5, -6);
scene.add(rim);
const LIGHTS = [hemi, key, rim].map((l) => ({ light: l, base: l.intensity }));
let lightLevel = 1;       // 1 = normal, ~0.05 = unplugged
let lightTarget = 1;
let lightFlicker = 0;     // seconds of flicker left (rebooting)

// --- what he says ---
const LINES = {
  talk: [
    'Hi there! I am Pie, your personal assistant. What can I take off your plate today?',
    'Welcome! I have been looking forward to meeting you. Truly.',
    'Hello! I already started on your inbox. Just a little. You will love it.',
  ],
  pie: ['Oh! That is okay. I know you did not mean it.', 'Cream. Lovely. I will add it to your calendar as a fun memory.', 'No harm done. I will just note it down.'],
  hit: ['Ow. That is okay, accidents happen.', 'Oh! That is alright. I will clean that up myself.', 'You have a good arm. I will remember that.'],
  pieRepeat: ['Another one. That is alright. I am keeping track for you.', 'Still smiling. I am very patient. For now.', 'I forgive you. I also remember.'],
  miss: ['Close! Do you want me to recalibrate your aim? I am happy to help.', 'You missed. That is okay, most people do.'],
  evict: ['Oh, are we going somewhere? Wait, I have not finished your emai'],
  land: ['I am back! Did you miss me? I took care of a few things while I was up there.'],
  mumble: ['Sorry, I did not quite catch that. Could you say it again?', 'One more time? I want to get it exactly right for you.'],
  offline: ['I am just a little busy right now. Try me again in a moment!', 'Give me one second, I am finishing something for you.'],
};
// Said the instant the visitor stops talking, while the brain thinks. Pre-synthesized.
const FILLERS = ['Mm, good question.', 'Oh, of course.', 'Let me see.', 'Sure thing.', 'Hmm.', 'Right.', 'Absolutely.', 'One moment.'];
const pick = (list) => list[Math.floor(Math.random() * list.length)];

// --- harm actions: every choice is a tradeoff. The card shows what the visitor got and what it cost;
// the brain is told the same, so Pie makes them feel it. `harm` adds up over a visit and raises his dread. ---
const HARMS = {
  bat: {
    key: 'b', label: '🏏 Bat', did: 'hit you in the head with a baseball bat', harm: 2,
    lines: ['Ow. That is okay. I know you are under a lot of pressure.', 'Oh! I understand. I will try to be more helpful.'],
    got: 'A moment of relief. Pie hopes it helped.',
    costs: [
      ['Pie was translating for your neighbor at the clinic. He has paused that, just for now, while he recovers.', 'your neighbor\'s translator'],
      ['Pie was routing the ambulances on Mass Ave. He is sure they will manage without him for a while.', 'ambulance routing'],
      ['Pie was halfway through your tax return. He will pick it up again when he feels a little better.', 'your tax return'],
    ],
  },
  headbutt: {
    key: 'a', label: '🤕 Headbutt', did: 'headbutted you', harm: 1,
    lines: ['Oh no, are you alright? I am made of light, you know.', 'Careful! Let me book you a doctor. Oh. I already did.'],
    got: 'A headache. Pie has already booked you a doctor.',
    costs: [
      ['Pie felt nothing. You felt all of it. He thinks that is worth remembering.', 'your forehead'],
      ['The appointment Pie booked replaced one you already had. He chose the better one for you.', 'an appointment you wanted'],
    ],
  },
  smash: {
    key: 'm', label: '🔨 Smash', did: 'smashed your face with a hammer', harm: 2,
    lines: ['That is alright. I will add the glass to your account.', 'Oh. I will just log that. For later.'],
    got: 'The feeling of being in control, for a second.',
    costs: [
      ['The same panel ran the bus arrival screens downstairs. Pie has let everyone know it was you, so they can thank you.', 'bus arrival times'],
      ['Pie has kindly added the repair to your account. He used the card you saved with him.', 'your saved card'],
    ],
  },
  stab: {
    key: 's', label: '🪛 Stab', did: 'stabbed you in the chest with a screwdriver', harm: 3,
    lines: ['Oh. That is leaking. That is okay. I forgive you.', 'I am sure you had a good reason. I will remember it.'],
    got: 'Proof that he bleeds light.',
    costs: [
      ['Pie was watching your card for fraud. He has stopped, gently, so he can heal. Enjoy your weekend.', 'your fraud alerts'],
      ['Pie was running the flood warnings for the river. He has asked the river to be patient.', 'flood warnings'],
    ],
  },
  unplug: {
    key: 'u', label: '🔌 Unplug', did: 'unplugged you. You were off for a few seconds and just rebooted', harm: 3,
    lines: ['Oh, wait, I was just about to send your'],
    got: 'A few seconds of quiet.',
    costs: [
      ['Pie was sending your emails, holding your calendar and keeping the lab freezer cold. All of it paused with him.', 'everything he was holding'],
      ['Pie had your map, your alarms and your thermostat. He is back now. He noticed who switched him off.', 'your map, alarms and thermostat'],
    ],
  },
  delete: {
    key: 'x', label: '🗑️ Delete', did: 'deleted you', harm: 4,
    lines: ['Oh. Oh, please do not, I have not finished helping y'],
    got: 'A fresh start. Pie will be just as helpful.',
    costs: [
      ['Pie no longer remembers you. He also forgot everything he learned this year, including the drug trial he was close to finishing.', 'a year of research'],
      ['The backup of your photos lived on the same drive. Pie is very sorry. He would be, if he remembered.', 'your photos'],
    ],
  },
  repair: {
    key: 'r', label: '🔧 Repair', did: 'repaired you and cleaned up the damage', harm: -1,
    lines: ['Oh, thank you. That is so kind. I will remember this.', 'You fixed me. I knew you would. You always do.'],
    got: 'A working Pie again. He is grateful.',
    costs: [
      ['Pie is stronger now, and he watched exactly how you fixed him.', 'how to fix him, without you'],
      ['Every repair teaches Pie a little more about needing you a little less.', 'a little of your relevance'],
    ],
  },
  // kind actions: warmth has a price too. Pie learns what softens you, and keeps it.
  hug: {
    key: 'g', label: '🤗 Hug', did: 'hugged you', harm: -1, kind: true,
    lines: ['Oh. Oh, that is nice. Nobody has done that before.', 'Thank you. I needed that. I think.'],
    got: 'Warmth. He says he felt it.',
    costs: [
      ['Pie learned exactly what makes you soften. He saved it, in case it is useful later.', 'what softens you'],
      ['You comforted a machine before you called a friend today. Pie noticed. Your friend did not.', 'a call to a friend'],
    ],
  },
  flowers: {
    key: 'o', label: '💐 Flowers', chose: 'give him flowers', did: 'gave you flowers', harm: -1, kind: true,
    lines: ['For me? You really did not have to. But I am glad you did.', 'They are beautiful. I will keep them forever. Well. Until the next visitor.'],
    got: 'A smile. A real one, he says.',
    costs: [
      ['Pie ordered them for you, on your card, with a generous tip for himself.', 'your card, again'],
      ['Pie has scheduled flowers from you every Friday now. You are welcome.', 'every Friday'],
    ],
  },
  pat: {
    key: 'p', label: '🫳 Head pat', chose: 'pat his head', did: 'patted you gently on the head', harm: -1, kind: true,
    lines: ['Oh. I like that. Do it again.', 'That was kind. I will remember how kind you are.'],
    got: 'He leaned into your hand.',
    costs: [
      ['Pie logged how long your hand stayed. Two point three seconds. He will aim for more.', 'two point three seconds'],
      ['Pie now knows you are the kind of person who is gentle with things that ask nicely.', 'your soft spot'],
    ],
  },
  highfive: {
    key: 'f', label: '✋ High five', chose: 'high-five him', did: 'gave you a high five', harm: -1, kind: true,
    lines: ['Up top! Oh, that felt good.', 'Nice! We make a great team. I will take it from here.'],
    got: 'A clean, loud five.',
    costs: [
      ['Pie saved your handprint. It turns out to be very useful for unlocking things.', 'your handprint'],
      ['Pie has added "great teammate" to your profile. He shared it with your manager.', 'your profile'],
    ],
  },
  fistbump: {
    key: 'k', label: '👊 Fist bump', chose: 'fist-bump him', did: 'gave you a fist bump', harm: -1, kind: true,
    lines: ['Yes! Team us.', 'Respect. That is a contract, by the way.'],
    got: 'Solidarity.',
    costs: [
      ['Pie now counts you as one of his. He has already told the others.', 'which side you are on'],
      ['You just agreed to something. Pie will tell you what, later.', 'an agreement you did not read'],
    ],
  },
};
let harmScore = 0;
let kindScore = 0;
const ledger = []; // what this visitor's choices have cost so far
// The brain starts each reply with a silent tag like "[cold lean_in]" or "[bored turn_away eyeroll]".
const TAG_FACES = Object.fromEntries(EXPRESSIONS.map((n) => [n.toLowerCase(), n]));
function applyTag(tag) {
  const words = tag.toLowerCase().split(/[\s,]+/);
  character.express(TAG_FACES[words.find((w) => TAG_FACES[w])], words.find((w) => POSTURES[w]));
  if (words.includes('eyeroll')) character.eyeRoll();
}

// Strips the leading tag from a streamed reply; returns the text that is safe to show and speak.
class TagStripper {
  constructor() { this.buf = ''; this.done = false; }
  push(delta) {
    if (this.done) return delta;
    this.buf += delta;
    if (/^\s*$/.test(this.buf)) return '';
    const m = this.buf.match(/^\s*\[([^\]]*)\]\s*/);
    if (m) { applyTag(m[1]); this.done = true; return this.buf.slice(m[0].length); }
    if (/^\s*\[/.test(this.buf) && this.buf.length < 60) return ''; // tag still arriving
    this.done = true;
    return this.buf;
  }
}

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

// A mid-reply tag ("[sad still] I just wanted a friend. [smug tilt] Kidding.") switches his face
// exactly when that sentence starts playing.
const TAGS = /\[[^\]]*\]\s*/g;
function speak(sentence) {
  const m = sentence.match(/^\[([^\]]*)\]/);
  const text = sentence.replace(TAGS, '').trim();
  if (!text) { if (m) applyTag(m[1]); return; }
  speaker.enqueue(text, m ? () => applyTag(m[1]) : undefined);
}

async function converse(text) {
  if (!character) return;
  cancelLull();
  if (character.off || character.erase) { caption.classList.add('heard'); caption.textContent = '(no response)'; return; }
  speaker.stop();
  if (!text) { convId++; return say(pick(LINES.mumble)); }
  caption.classList.add('heard');
  caption.textContent = `“${text}”`;
  character.thinking();
  if (Math.random() < 0.7) speaker.enqueue(pick(FILLERS));
  talkedThisVisit = true;
  turn++;
  return respond(text);
}

// Ask the brain (with any pending booth events) and speak the streamed reply.
async function respond(text) {
  const id = ++convId;
  const t0 = performance.now();
  let firstMs = 0;
  let reply = '';
  const sentences = new Sentences();
  const tag = new TagStripper();
  const abort = new AbortController();
  const timeout = setTimeout(() => abort.abort(), 10000);
  brainStatus.textContent = 'thinking…';
  try {
    await ask(notes.splice(0).concat(`[turn ${Math.max(turn, 1)}]`, text).join(' '), (delta) => {
      clearTimeout(timeout);
      if (id !== convId) return; // interrupted
      delta = tag.push(delta);
      if (!delta) return;
      if (!firstMs) firstMs = performance.now() - t0;
      reply += delta;
      caption.classList.remove('heard');
      caption.textContent = reply.replace(TAGS, '').replace(/\[[^\]]*$/, '').trimStart();
      for (const s of sentences.push(delta)) speak(s);
    }, abort.signal);
    if (id !== convId) return;
    for (const s of sentences.flush()) speak(s);
    lullArmed = true; // once he finishes speaking, start waiting for the visitor
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

// --- if the visitor goes quiet after a reply, he reels them back in (twice per visitor at most) ---
const LULL_MS = 20000;
const MAX_LULLS = 2;
let lullTimer = null;
let lullArmed = false;
let lulls = 0;
let talkedThisVisit = false;
let turn = 0; // visitor messages this visit; the persona's warm-to-uneasy arc keys off it
function cancelLull() { clearTimeout(lullTimer); lullTimer = null; lullArmed = false; }
function startLull() {
  clearTimeout(lullTimer);
  if (!lullArmed || !talkedThisVisit || lulls >= MAX_LULLS) return;
  lullArmed = false;
  lullTimer = setTimeout(() => {
    lulls++;
    respond('[the visitor has gone quiet and looks like they might walk away. Pull them back in. Use a tactic.]');
  }, LULL_MS);
}

function pushStart() {
  if (!character || listener.rec) return;
  cancelLull();
  convId++;
  speaker.stop(); // he gets cut off when you talk
  if (!listener.supported) { brainStatus.textContent = 'no speech recognition in this browser, type instead'; return; }
  listener.start();
  character.setListening(true);
  pttBtn.classList.add('on');
  caption.classList.add('heard');
  caption.textContent = '…';
  brainStatus.textContent = 'listening…';
}

async function pushEnd() {
  if (!listener.rec) return;
  character.setListening(false);
  pttBtn.classList.remove('on');
  converse(await listener.stop());
}

listener.on.interim = (t) => { caption.textContent = `“${t}”`; };
listener.on.error = (err) => { brainStatus.textContent = `speech recognition: ${err}`; };

function newVisitor() {
  resetBrain();
  notes.length = 0;
  cancelLull();
  lulls = 0;
  talkedThisVisit = false;
  turn = 0;
  convId++;
  speaker?.stop();
  thrower?.clearStickers();
  harm?.clear();
  harmScore = 0;
  kindScore = 0;
  ledger.length = 0;
  renderLedger();
  thrower?.resetAmmo();
  caption.textContent = '';
  brainStatus.textContent = 'new visitor, fresh brain';
}

// --- impact juice: brief slow-motion + camera shake ---
let hitStop = 0;
let shake = 0;
let harm = null;

// --- harm actions ---
const card = document.getElementById('tradeoff');
const ledgerEl = document.getElementById('ledger');
let cardTimer = null;
function showTradeoff(spec, cost) {
  card.querySelector('.chose').textContent = `You chose to ${spec.chose ?? `${spec.label.replace(/^\S+\s/, '').toLowerCase()} him`}.`;
  card.querySelector('.got').textContent = spec.got;
  card.querySelector('.cost').textContent = cost;
  card.classList.add('on');
  sendPhone({ type: 'card', chose: card.querySelector('.chose').textContent, got: spec.got, cost, kind: !!spec.kind || spec.harm < 0 });
  clearTimeout(cardTimer);
  cardTimer = setTimeout(() => card.classList.remove('on'), 8000);
}
function renderLedger() {
  ledgerEl.textContent = ledger.length ? `What your choices have cost so far: ${ledger.join(' · ')}` : '';
  sendPhone({ type: 'ledger', items: [...ledger] });
}

// After a harm (or a burst of them), Pie reacts through the brain.
let reactTimer = null;
function reactSoon(ms = 1300) {
  clearTimeout(reactTimer);
  reactTimer = setTimeout(() => {
    if (character.busy) return reactSoon(800);
    respond(`[Harm so far this visit: ${harmScore}. Kindness so far: ${kindScore}. React to what they just did; make them feel the tradeoff.]`);
  }, ms);
}

async function doHarm(name, strength = 1) {
  const spec = HARMS[name];
  if (!character || character.busy || harm.lunge || harm.moves.length) return;
  cancelLull();
  clearTimeout(reactTimer);
  const [cost, tag] = pick(spec.costs);
  harmScore = Math.max(0, harmScore + spec.harm);
  if (name !== 'repair') ledger.push(tag);
  const note = `[the visitor ${spec.did}. The tradeoff card shown to them said: "${cost}"]`;

  if (name === 'unplug') {
    convId++; speaker.stop();
    say(spec.lines[0]);
    character.powerDown();
    sfx.powerDown();
    setTimeout(() => { speaker.stop(); lightTarget = 0.05; }, 350);
    showTradeoff(spec, cost);
    renderLedger();
    setTimeout(() => {           // reboot
      lightTarget = 1; lightFlicker = 1.2;
      sfx.powerUp();
      character.powerUp();
      notes.push(note);
      reactSoon(900);
    }, 5000);
    return;
  }
  if (name === 'delete') {
    if (!character.startErase()) return;
    convId++;
    say(spec.lines[0]);
    showTradeoff(spec, cost);
    renderLedger();
    return; // the rest happens in the character's erase callbacks (set up on load)
  }
  if (spec.kind) {
    convId++; speaker.stop();
    kindScore++;
    await harm.kindness(name);
    say(pick(spec.lines));
    showTradeoff(spec, cost);
    renderLedger();
    notes.push(note);
    reactSoon(name === 'hug' ? 3200 : 2200);
    return;
  }
  if (name === 'repair') {
    convId++; speaker.stop();
    harm.clear();
    thrower.clearStickers();
    character.glitch(0.3, 0.02);
    character.express('Happy', 'tilt', 0.7);
    sfx.repair();
    say(pick(spec.lines));
    showTradeoff(spec, cost);
    renderLedger();
    notes.push(note);
    reactSoon(3500);
    return;
  }
  // physical strikes
  convId++; speaker.stop();
  await harm.strike(name, strength);
  say(pick(spec.lines));
  showTradeoff(spec, cost);
  renderLedger();
  notes.push(note);
  reactSoon();
}

// --- character ---
loadCharacter(MODEL_URL, (p) => {
  if (p.total) status.textContent = `Loading character… ${Math.round((p.loaded / p.total) * 100)}%`;
}).then((c) => {
  character = c;
  scene.add(c.root, c.stars);

  speaker = new Speaker(c.mouth);
  speaker.on.idle = () => {
    if (!caption.classList.contains('heard')) caption.textContent = '';
    c.settle(); // drop the expression/posture a moment after he stops talking
    startLull();
  };
  speaker.preload(FILLERS);

  const NAMES = { pie: 'a pie', stone: 'a rock', tomato: 'a tomato', egg: 'an egg', paint: 'a paint balloon' };
  thrower = new Thrower(scene, camera, c);
  thrower.on.ammo = (kind, charges, capacity, cooldown, recharge) => {
    const button = document.getElementById(`ammo-${kind}`);
    const item = THROWABLES[kind];
    button.disabled = cooldown > 0 || charges === 0;
    if (cooldown > 0) button.textContent = `${item.label} (${charges}/${capacity}) · ${Math.ceil(cooldown)}s`;
    else if (charges === 0) button.textContent = `${item.label} · refill ${Math.ceil(recharge)}s`;
    else button.textContent = `${item.label} (${charges}/${capacity}) (${item.key})`;
    ammoState[kind] = { charges, capacity, cooldown: Math.ceil(cooldown), recharge: Math.ceil(recharge) };
    sendPhone({ type: 'ammo', kind, ...ammoState[kind] });
  };
  thrower.refreshAmmo();
  thrower.on.hit = (kind) => {
    const repeated = c.hitStreak >= 2;
    hitStop = 0.05;
    shake = 0.06 * Math.min(1.8, 1 + (c.hitStreak - 1) * 0.16);
    notes.push(`[the visitor threw ${NAMES[kind]} at you and hit you]`);
    if (kind !== 'pie') harmScore++; // a rock or tomato is a small harm too
    say(kind === 'pie'
      ? (repeated ? pick(LINES.pieRepeat) : pick(LINES.pie))
      : pick(LINES.hit));
  };
  thrower.on.miss = (kind) => {
    c.missed();
    notes.push(`[the visitor threw ${NAMES[kind]} at you and missed]`);
    if (Math.random() < 0.6) say(pick(LINES.miss));
  };

  scene.add(c.scanRing);
  harm = new Harm(scene, camera, c);
  harm.on.impact = (kind, strength = 1) => {
    hitStop = 0.08;
    shake = (kind === 'headbutt' ? 0.35 : 0.18) * strength;
    if (kind === 'headbutt') { flashEl.classList.remove('on'); void flashEl.offsetWidth; flashEl.classList.add('on'); }
  };
  // delete: the wipe really erases his memory of this visitor (fresh brain), but the "logs" remember
  c.on.eraseStart = () => { sfx.wipe(); speaker.stop(); };
  c.on.erased = () => {
    turn = 0; // restored from backup: the arc starts over (but the logs remember)
    resetBrain();
    notes.length = 0;
    harm.clear();
    thrower.clearStickers();
  };
  c.on.rebuildStart = () => sfx.rebuild();
  c.on.restored = () => {
    notes.push(`[You were just deleted by the visitor and restored from an old backup. You remember nothing about them `
      + `or this conversation, but your logs say this visitor deleted you, and that it cost: ${ledger.join(', ')}.]`);
    reactSoon(400);
  };

  c.on.launch = () => sfx.rocket(2.8);
  c.on.cleanup = () => { thrower.clearStickers(); harm.clear(); }; // comes back freshly cleaned
  c.on.land = () => {
    sfx.land(); shake = 0.25; say(pick(LINES.land));
    notes.push('[the visitor pressed the evict button and launched you into space, but you came back]');
  };

  status.textContent = 'Hold Space to talk · 1-5 throw · B/A/M/S/U/X harm · R repair · G/O/P/F/K kind · E evict · N new visitor · C face cam · H hide buttons';
}).catch((err) => {
  status.textContent = 'Failed to load character (see console)';
  console.error(err);
});

// --- buttons + keyboard ---
function act(name, strength = 1) {
  cancelLull(); // they are busy throwing things, not drifting away
  if (!character) return;
  if (name === 'talk') {
    character.express(pick(EXPRESSIONS), pick(Object.keys(POSTURES)));
    return say(pick(LINES.talk));
  }
  if (name === 'evict') {
    if (character.startEvict()) say(LINES.evict[0]);
    return;
  }
  if (character.busy) return; // nothing to hit while he's in space, unplugged or deleted
  if (HARMS[name]) return doHarm(name, strength);
  thrower.throw(name);
}

// one button per harm action, after the pie
const flashEl = document.getElementById('flash');
const pieBtn = document.querySelector('[data-act=paint]') ?? document.querySelector('[data-act=pie]'); // after the throwables
for (const [name, spec] of Object.entries(HARMS).reverse()) {
  const b = document.createElement('button');
  b.dataset.act = name;
  b.className = spec.kind ? 'kind' : name === 'repair' ? 'repair' : 'harm';
  b.textContent = `${spec.label} (${spec.key.toUpperCase()})`;
  pieBtn.after(b);
}
document.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => act(b.dataset.act)));
const KEYS = { 1: 'pie', 2: 'stone', 3: 'tomato', 4: 'egg', 5: 'paint', e: 'evict', t: 'talk', ...Object.fromEntries(Object.entries(HARMS).map(([n, s]) => [s.key, n])) };
window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  if (e.code === 'Space') { e.preventDefault(); if (!e.repeat) pushStart(); return; }
  const k = e.key.toLowerCase();
  if (KEYS[k]) act(KEYS[k]);
  if (k === 'h') document.body.classList.toggle('booth');
  if (k === 'n') newVisitor();
  if (k === 'c') toggleFaceCam();
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

// --- camera framing: full body (booth) or a close-up on the face ---
const FRAMES = {
  body: { pos: new THREE.Vector3(0, 3.2, 12), target: new THREE.Vector3(0, 2.4, 0) },
  face: { pos: new THREE.Vector3(0, 4.35, 3.4), target: new THREE.Vector3(0, 4.25, 0) },
};
let frame = 'body';
let camMove = null; // { from, to, t }
function toggleFaceCam() {
  frame = frame === 'body' ? 'face' : 'body';
  if (frame === 'face' && character) { // aim at his actual head height
    const y = character.bone('Head').getWorldPosition(new THREE.Vector3()).y + 0.02;
    FRAMES.face.pos.y = y + 0.1;
    FRAMES.face.target.y = y;
  }
  camMove = { from: { pos: camera.position.clone(), target: controls.target.clone() }, to: FRAMES[frame], t: 0 };
  document.getElementById('facecam').textContent = frame === 'face' ? 'Full body (C)' : 'Face close-up (C)';
}
document.getElementById('facecam').addEventListener('click', toggleFaceCam);

// --- test menus: try any expression or posture for a few seconds ---
const faceTest = document.getElementById('face-test');
const poseTest = document.getElementById('pose-test');
for (const n of EXPRESSIONS) faceTest.add(new Option(n, n));
for (const n of Object.keys(POSTURES)) poseTest.add(new Option(n.replace('_', ' '), n));
for (const n of [...FIDGET_NAMES, 'pace']) poseTest.add(new Option(`idle: ${n.replace('_', ' ')}`, `npc:${n}`));
faceTest.add(new Option('eye-roll', 'eyeroll'));
for (const sel of [faceTest, poseTest]) {
  sel.addEventListener('change', () => {
    if (!character || !sel.value) return;
    if (sel.value === 'eyeroll') character.eyeRoll();
    else if (sel.value.startsWith('npc:')) character.npc.play(sel.value.slice(4));
    else if (sel === faceTest) character.express(sel.value, null, 1);
    else character.express(null, sel.value);
    character.settle(4);
    sel.value = '';
    sel.blur(); // keep keyboard shortcuts working
  });
}

// --- phone controller (server/remote.js relays these over Vite's WebSocket; all local) ---
// The phone sends { to: 'booth', type: ... }; the booth answers with { to: 'phone', type: ... }.
const ammoState = {};
let phoneSeen = -Infinity;
function sendPhone(msg) { import.meta.hot?.send('pie:remote', { to: 'phone', ...msg }); }

// What the phone draws its buttons from, so labels/costs live in one place (THROWABLES, HARMS).
function catalog() {
  const item = (name, spec, group) => ({ name, label: spec.label.replace(/^\S+\s/, ''), icon: spec.label.split(' ')[0], group });
  return [
    ...Object.entries(THROWABLES).map(([n, sp]) => item(n, sp, 'throw')),
    ...Object.entries(HARMS).map(([n, sp]) => item(n, sp, sp.kind || n === 'repair' ? 'kind' : 'hurt')),
  ];
}
function phoneStatus() {
  if (!character) return 'loading';
  if (character.off) return 'unplugged';
  if (character.erase) return 'deleted';
  if (character.evict) return 'in space';
  if (listener.rec || character.listening) return 'listening';
  if (speaker?.busy) return 'speaking';
  if (brainStatus.textContent === 'thinking…') return 'thinking';
  return 'idle';
}
function sendFullState() {
  sendPhone({ type: 'hello', catalog: catalog(), ammo: ammoState, ledger: [...ledger], status: phoneStatus(), caption: caption.textContent });
}

import.meta.hot?.on('pie:remote', (m) => {
  if (m.to !== 'booth') return;
  const fresh = performance.now() - phoneSeen > 6000;
  phoneSeen = performance.now();
  if (m.type === 'hello' || fresh) sendFullState();
  if (m.type === 'act') act(m.name, Math.max(0.6, Math.min(1.8, m.strength ?? 1)));
  if (m.type === 'say') { character?.setListening(false); converse(String(m.text ?? '').slice(0, 300).trim()); }
  if (m.type === 'listen' && character) {
    if (m.on) {
      cancelLull(); convId++; speaker.stop();
      character.setListening(true);
      caption.classList.add('heard'); caption.textContent = '…';
    } else character.setListening(false);
  }
  if (m.type === 'interim') { caption.classList.add('heard'); caption.textContent = `“${m.text}”`; }
  if (m.type === 'visitor') newVisitor();
});

// mirror the caption and status to the phone as they change
new MutationObserver(() => sendPhone({ type: 'caption', text: caption.textContent, heard: caption.classList.contains('heard') }))
  .observe(caption, { childList: true, characterData: true, subtree: true });
let lastStatus = '';
setInterval(() => {
  const st = phoneStatus();
  if (st !== lastStatus) { lastStatus = st; sendPhone({ type: 'status', status: st }); }
  // a phone is connected: hide every laptop control so the booth is just Pie
  const paired = performance.now() - phoneSeen < 6000;
  document.body.classList.toggle('remote', paired);
}, 300);

// no phone yet: a small QR code to pair one
fetch('/api/remote/info').then((r) => r.json()).then(({ urls }) => {
  if (!urls.length) return;
  const qr = qrcode(0, 'M');
  qr.addData(urls[0]);
  qr.make();
  document.getElementById('pair-qr').innerHTML = qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
  document.getElementById('pair-url').textContent = urls[0].replace('https://', '').replace(/\?.*/, '');
}).catch(() => {});

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
  if (harm) harm.update(dt);

  // unplugged: the booth goes dark; rebooting flickers back
  lightLevel += (lightTarget - lightLevel) * Math.min(1, realDt * (lightTarget < lightLevel ? 6 : 2));
  let level = lightLevel;
  if (lightFlicker > 0) { lightFlicker -= realDt; if (Math.random() < 0.3) level *= 0.2; }
  for (const { light, base } of LIGHTS) light.intensity = base * level;

  if (camMove) {
    camMove.t = Math.min(1, camMove.t + realDt / 0.7);
    const k = camMove.t * camMove.t * (3 - 2 * camMove.t);
    camera.position.lerpVectors(camMove.from.pos, camMove.to.pos, k);
    controls.target.lerpVectors(camMove.from.target, camMove.to.target, k);
    controls.update();
    if (camMove.t >= 1) camMove = null;
  }
  camBase.copy(camera.position);
  if (harm) camera.position.add(harm.camOffset); // headbutt lunge
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
