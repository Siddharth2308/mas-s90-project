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
};
