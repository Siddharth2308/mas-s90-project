// Voice loop pieces: Listener (speech -> text), ask() (text -> streamed reply from the brain),
// Sentences (cuts the stream into sentences) and Speaker (sentences -> Piper audio, in order).

// --- push-to-talk speech recognition (Chrome's Web Speech API) ---
export class Listener {
  constructor() {
    this.SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    this.supported = !!this.SR;
    this.rec = null;
    this.on = {}; // interim(text), error(code)
  }

  start() {
    if (!this.supported || this.rec) return;
    const rec = new this.SR();
    rec.lang = 'en-US';
    rec.continuous = true;
    rec.interimResults = true;
    this.final = '';
    this.interim = '';
    rec.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) this.final += r[0].transcript;
        else interim += r[0].transcript;
      }
      this.interim = interim;
      this.on.interim?.((this.final + interim).trim());
    };
    rec.onerror = (e) => this.on.error?.(e.error);
    this.rec = rec;
    rec.start();
  }

  // Resolves with the transcript once the recognizer has flushed its last words.
  stop() {
    const rec = this.rec;
    this.rec = null;
    if (!rec) return Promise.resolve('');
    return new Promise((resolve) => {
      const done = () => resolve((this.final + ' ' + this.interim).trim());
      rec.onend = done;
      setTimeout(done, 1200); // don't hang if 'end' never comes
      rec.stop();
    });
  }
}

// --- the brain: POST /api/ask, read the NDJSON stream ---
export async function ask(text, onDelta, signal) {
  const res = await fetch('/api/ask', { method: 'POST', body: JSON.stringify({ text }), signal });
  if (!res.ok) throw new Error(`brain ${res.status}`);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const m = JSON.parse(buf.slice(0, i));
      buf = buf.slice(i + 1);
      if (m.error) throw new Error(m.error);
      if (m.delta) onDelta(m.delta);
    }
  }
}

export const resetBrain = () => fetch('/api/reset', { method: 'POST' });

// --- split streamed text into sentences so speech can start early ---
export class Sentences {
  constructor() { this.buf = ''; }
  push(delta) {
    this.buf += delta;
    const out = [];
    let m;
    while ((m = this.buf.match(/^(.*?[.!?]+["')\]]*)\s+/s))) {
      out.push(m[1].trim());
      this.buf = this.buf.slice(m[0].length);
    }
    return out;
  }
  flush() {
    const s = this.buf.trim();
    this.buf = '';
    return s ? [s] : [];
  }
}

// --- speech out: Piper (via /api/tts) with the mouth following the audio ---
export class Speaker {
  constructor(mouth) {
    this.mouth = mouth;
    this.ctx = new AudioContext();
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.analyser.connect(this.ctx.destination);
    this.queue = [];      // [{ text, audio: Promise<AudioBuffer|null> }]
    this.cache = new Map();
    this.source = null;
    this.busy = false;
    this.gen = 0;         // bumps on stop() so stale playback loops exit
    this.piper = true;    // falls back to the browser voice if Piper isn't running
    this.on = {};         // start(), idle()
  }

  async fetchAudio(text) {
    if (this.cache.has(text)) return this.cache.get(text);
    if (!this.piper) return null;
    try {
      const res = await fetch('/api/tts', { method: 'POST', body: JSON.stringify({ text }) });
      if (!res.ok) throw new Error();
      return await this.ctx.decodeAudioData(await res.arrayBuffer());
    } catch {
      this.piper = false;
      return null;
    }
  }

  // Synthesize short lines ahead of time so they play instantly.
  async preload(lines) {
    for (const t of lines) {
      const b = await this.fetchAudio(t);
      if (b) this.cache.set(t, b);
    }
  }

  // onStart runs when this line starts playing (e.g. to change his face mid-reply).
  enqueue(text, onStart) {
    this.queue.push({ text, onStart, audio: this.fetchAudio(text) }); // starts synthesizing now
    if (!this.busy) this.play(this.gen);
  }

  async play(gen) {
    this.busy = true;
    this.on.start?.();
    if (this.ctx.state === 'suspended') this.ctx.resume();
    while (this.queue.length && gen === this.gen) {
      const item = this.queue.shift();
      const buffer = await item.audio;
      if (gen !== this.gen) return;
      item.onStart?.();
      if (buffer) await this.playBuffer(buffer);
      else await this.browserSay(item.text);
    }
    if (gen !== this.gen) return;
    this.busy = false;
    this.mouth.unfollow();
    this.on.idle?.();
  }

  playBuffer(buffer) {
    return new Promise((resolve) => {
      const src = this.ctx.createBufferSource();
      src.buffer = buffer;
      src.connect(this.analyser);
      src.onended = resolve;
      this.source = src;
      this.mouth.follow(this.ctx, this.analyser);
      src.start();
    });
  }

  browserSay(text) {
    return new Promise((resolve) => {
      const u = new SpeechSynthesisUtterance(text);
      u.onstart = () => this.mouth.speakText(text);
      u.onboundary = (e) => { if (e.name === 'word') this.mouth.speakText(text.slice(e.charIndex)); };
      u.onend = u.onerror = () => { this.mouth.stopSpeaking(); resolve(); };
      speechSynthesis.speak(u);
      if (speechSynthesis.getVoices().length === 0) { // no voices: move the mouth silently
        this.mouth.speakText(text);
        setTimeout(resolve, text.length * 75);
      }
    });
  }

  stop() {
    this.gen++;
    this.queue = [];
    try { this.source?.stop(); } catch {}
    this.source = null;
    speechSynthesis.cancel();
    this.mouth.stopSpeaking();
    this.mouth.unfollow();
    this.busy = false;
  }
}
