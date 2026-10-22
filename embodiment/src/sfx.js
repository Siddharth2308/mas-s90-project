// Tiny synthesized sound effects (no audio files needed).
let ctx = null;
let noiseBuf = null;

function audio() {
  if (!ctx) {
    ctx = new AudioContext();
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function envelope(c, gain, dur, attack = 0.005) {
  const g = c.createGain();
  const t = c.currentTime;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(gain, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  g.connect(c.destination);
  return g;
}

function noise(dur, { type = 'lowpass', f0 = 1000, f1 = f0, q = 1, gain = 0.5, attack } = {}) {
  const c = audio();
  const src = c.createBufferSource();
  src.buffer = noiseBuf;
  src.loop = true;
  const filter = c.createBiquadFilter();
  filter.type = type;
  filter.Q.value = q;
  filter.frequency.setValueAtTime(f0, c.currentTime);
  filter.frequency.exponentialRampToValueAtTime(f1, c.currentTime + dur);
  src.connect(filter).connect(envelope(c, gain, dur, attack));
  src.start();
  src.stop(c.currentTime + dur);
}

function tone(f0, f1, dur, gain, type = 'sine') {
  const c = audio();
  const osc = c.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(f0, c.currentTime);
  osc.frequency.exponentialRampToValueAtTime(f1, c.currentTime + dur);
  osc.connect(envelope(c, gain, dur));
  osc.start();
  osc.stop(c.currentTime + dur);
}

export const sfx = {
  whoosh: () => noise(0.3, { type: 'bandpass', f0: 400, f1: 2500, q: 1.2, gain: 0.25 }),
  thunk: () => { tone(160, 45, 0.2, 0.9); noise(0.05, { type: 'highpass', f0: 2500, gain: 0.35 }); },
  clang: () => { tone(900, 700, 0.35, 0.25, 'triangle'); tone(1350, 1100, 0.25, 0.15, 'square'); },
  splat: () => { noise(0.3, { type: 'lowpass', f0: 2500, f1: 250, gain: 0.8 }); tone(220, 80, 0.12, 0.3, 'triangle'); },
  rocket: (dur) => { noise(dur, { type: 'lowpass', f0: 250, f1: 1800, gain: 0.7, attack: 0.25 }); tone(60, 220, dur, 0.25, 'sawtooth'); },
  land: () => { tone(110, 30, 0.45, 1.0); noise(0.35, { type: 'lowpass', f0: 1500, f1: 150, gain: 0.7 }); },
  swing: () => noise(0.25, { type: 'bandpass', f0: 300, f1: 1400, q: 2, gain: 0.35 }),
  bat: () => { tone(220, 70, 0.18, 0.9, 'triangle'); noise(0.08, { type: 'highpass', f0: 1800, gain: 0.6 }); sfx.zap(); },
  smash: () => { noise(0.5, { type: 'highpass', f0: 3000, f1: 1200, gain: 0.6 }); tone(140, 40, 0.3, 0.8); sfx.zap(); },
  stab: () => { tone(1200, 900, 0.12, 0.25, 'square'); noise(0.1, { type: 'bandpass', f0: 2500, q: 4, gain: 0.4 }); sfx.zap(); },
  headbutt: () => { tone(90, 35, 0.35, 1.0); noise(0.15, { type: 'lowpass', f0: 900, f1: 200, gain: 0.8 }); },
  zap: () => { for (let i = 0; i < 4; i++) setTimeout(() => tone(800 + Math.random() * 1600, 300, 0.05, 0.12, 'sawtooth'), i * 45); },
  powerDown: () => { tone(420, 30, 1.4, 0.6, 'sawtooth'); noise(0.6, { type: 'lowpass', f0: 800, f1: 60, gain: 0.3 }); },
  powerUp: () => { tone(50, 480, 0.9, 0.35, 'sawtooth'); setTimeout(() => tone(900, 900, 0.06, 0.2, 'square'), 900); },
  wipe: (dur = 1.8) => { noise(dur, { type: 'bandpass', f0: 200, f1: 6000, q: 3, gain: 0.35 }); tone(80, 1200, dur, 0.15, 'sawtooth'); },
  rebuild: (dur = 1.8) => { noise(dur, { type: 'bandpass', f0: 6000, f1: 300, q: 3, gain: 0.25 }); tone(1200, 200, dur, 0.1, 'triangle'); },
  warm: () => { for (const [f, d] of [[392, 0], [494, 90], [587, 180]]) setTimeout(() => tone(f, f, 0.9, 0.12, 'sine'), d); },
  sparkle: () => { for (let i = 0; i < 6; i++) setTimeout(() => tone(1500 + Math.random() * 1500, 1200, 0.12, 0.06, 'sine'), i * 60); },
  clap: () => { noise(0.12, { type: 'bandpass', f0: 1800, q: 1.5, gain: 0.9, attack: 0.002 }); noise(0.25, { type: 'highpass', f0: 4000, gain: 0.15 }); },
  bump: () => { tone(180, 90, 0.15, 0.6, 'sine'); noise(0.06, { type: 'lowpass', f0: 1200, gain: 0.4, attack: 0.002 }); },
  repair: () => { tone(660, 660, 0.15, 0.3); setTimeout(() => tone(990, 990, 0.25, 0.3), 140); },
};
