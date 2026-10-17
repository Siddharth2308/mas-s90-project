import * as THREE from 'three';

// Glowing LED mouth. Each mouth shape ("viseme") is a target width/height scale;
// the mouth eases toward the current target every frame.
const VISEMES = {
  rest: [0.8, 0.12],
  aa: [1.0, 1.0],   // "ah"
  ee: [1.15, 0.4],  // "ee", "ih"
  oh: [0.6, 0.9],   // "oh"
  ou: [0.45, 0.6],  // "oo", "w"
  mbp: [0.9, 0.05], // lips closed
};

const LETTER_TO_VISEME = {
  a: 'aa', e: 'ee', i: 'ee', y: 'ee', o: 'oh', u: 'ou', w: 'ou',
  m: 'mbp', b: 'mbp', p: 'mbp', f: 'ee', v: 'ee',
};

export class Mouth {
  constructor(head, eyes) {
    // Place the mouth on the front of the head, low on the face.
    const box = new THREE.Box3().setFromObject(head, true);
    const size = box.getSize(new THREE.Vector3());
    const w = size.x * 0.32;
    const h = size.y * 0.14;

    const shape = new THREE.Shape();
    const r = h * 0.45;
    shape.moveTo(-w / 2 + r, -h / 2);
    shape.lineTo(w / 2 - r, -h / 2);
    shape.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + r);
    shape.lineTo(w / 2, h / 2 - r);
    shape.quadraticCurveTo(w / 2, h / 2, w / 2 - r, h / 2);
    shape.lineTo(-w / 2 + r, h / 2);
    shape.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - r);
    shape.lineTo(-w / 2, -h / 2 + r);
    shape.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + r, -h / 2);

    this.mesh = new THREE.Mesh(
      new THREE.ShapeGeometry(shape),
      new THREE.MeshBasicMaterial({ color: 0x55e6ff, toneMapped: false }),
    );
    // Find the face surface by casting a ray at the head from the front.
    const eyesBox = new THREE.Box3().setFromObject(eyes, true);
    const x = (eyesBox.min.x + eyesBox.max.x) / 2; // centered between the eyes
    const y = box.min.y + size.y * 0.24;
    const ray = new THREE.Raycaster(new THREE.Vector3(x, y, box.max.z + size.z), new THREE.Vector3(0, 0, -1));
    const hit = ray.intersectObject(head, true)[0];
    const z = (hit ? hit.point.z : box.max.z) + size.z * 0.035; // just in front of the bolts
    this.mesh.position.set(x, y, z);
    head.parent.attach(this.mesh); // follow the head bone
    this.baseScale = this.mesh.scale.clone(); // attach() compensates for the bone's scale

    this.scale = [...VISEMES.rest];
    this.target = [...VISEMES.rest];
    this.applyScale();

    this.timeline = null; // scripted visemes for text speech
    this.mic = null;      // live analyser for mic lip-sync
  }

  // --- text-driven: approximate visemes from the letters, ~75 ms per letter ---
  speakText(text, msPerChar = 75) {
    const now = performance.now();
    this.timeline = [...text.toLowerCase()].map((c, i) => ({
      t: now + i * msPerChar,
      v: LETTER_TO_VISEME[c] ?? (/[a-z]/.test(c) ? 'aa' : 'rest'),
    }));
    this.timelineEnd = now + text.length * msPerChar;
  }

  stopSpeaking() { this.timeline = null; }

  // --- mic-driven: loudness opens the mouth, brighter sounds widen it ---
  async startMic() {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const ctx = new AudioContext();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    ctx.createMediaStreamSource(stream).connect(analyser);
    this.mic = { ctx, analyser, stream, buf: new Uint8Array(analyser.frequencyBinCount), level: 0 };
  }

  stopMic() {
    if (!this.mic) return;
    this.mic.stream.getTracks().forEach((t) => t.stop());
    this.mic.ctx.close();
    this.mic = null;
  }

  update(dt) {
    if (this.mic) {
      const { analyser, buf, ctx } = this.mic;
      analyser.getByteFrequencyData(buf);
      const hz = ctx.sampleRate / analyser.fftSize;
      let low = 0, high = 0;
      for (let i = 0; i < buf.length; i++) {
        const f = i * hz;
        if (f > 80 && f < 1000) low += buf[i];
        else if (f >= 1000 && f < 4000) high += buf[i];
      }
      const level = Math.min(1, Math.max(0, (low + high) / 9000 - 0.15));
      this.mic.level += (level - this.mic.level) * 0.5;
      const bright = high / (low + high + 1);
      this.target = [0.6 + bright * 0.9, Math.max(0.08, this.mic.level)];
    } else if (this.timeline) {
      const now = performance.now();
      if (now > this.timelineEnd) {
        this.timeline = null;
        this.target = [...VISEMES.rest];
      } else {
        let cur = this.timeline[0];
        for (const k of this.timeline) { if (k.t <= now) cur = k; else break; }
        this.target = [...VISEMES[cur.v]];
      }
    } else {
      this.target = [...VISEMES.rest];
    }

    const k = 1 - Math.exp(-dt * 25); // fast but smooth
    this.scale[0] += (this.target[0] - this.scale[0]) * k;
    this.scale[1] += (this.target[1] - this.scale[1]) * k;
    this.applyScale();
  }

  applyScale() {
    const b = this.baseScale;
    this.mesh.scale.set(b.x * this.scale[0], b.y * this.scale[1], b.z);
  }
}
