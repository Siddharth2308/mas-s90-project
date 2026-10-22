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

// Models with real lips (the MPFB human) have these viseme shape keys; the mouth then drives them
// from the same [width, height] instead of showing the LED bar.
const LIP_KEYS = { open: 'aa_02', round: 'ow_08', pucker: 'w_uw_07', wide: 'y_iy_ih_ix_06', closed: 'p_b_m_21' };

export class Mouth {
  constructor(head, eyes, morphMeshes = []) {
    this.lips = morphMeshes.filter((m) => LIP_KEYS.open in m.morphTargetDictionary);
    // Place the mouth on the front of the head, low on the face.
    const box = eyes ? new THREE.Box3().setFromObject(head, true) : null;
    const size = box?.getSize(new THREE.Vector3());
    const localToWorld = eyes ? 1 : Math.max(head.getWorldScale(new THREE.Vector3()).x, 0.001);
    const w = eyes ? size.x * 0.32 : 0.11 / localToWorld;
    const h = eyes ? size.y * 0.14 : 0.03 / localToWorld;

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
      eyes
        ? new THREE.MeshBasicMaterial({ color: 0x55e6ff, toneMapped: false })
        : new THREE.MeshStandardMaterial({ color: 0x56383c, roughness: 0.95, transparent: true, opacity: 0.82, side: THREE.DoubleSide }),
    );
    // Find the face surface by casting a ray at the head from the front.
    if (eyes) {
      const eyesBox = new THREE.Box3().setFromObject(eyes, true);
      const x = (eyesBox.min.x + eyesBox.max.x) / 2;
      const y = box.min.y + size.y * 0.24;
      const ray = new THREE.Raycaster(new THREE.Vector3(x, y, box.max.z + size.z), new THREE.Vector3(0, 0, -1));
      const hit = ray.intersectObject(head, true)[0];
      const z = (hit ? hit.point.z : box.max.z) + size.z * 0.035;
      this.mesh.position.set(x, y, z);
      head.parent.attach(this.mesh);
    } else {
      // Place the speech indicator on the human face when no rig landmarks exist.
      this.mesh.position.set(0, 0.1 / localToWorld, 0.26 / localToWorld);
      head.add(this.mesh);
    }
    this.baseScale = this.mesh.scale.clone(); // attach() compensates for the bone's scale
    // A model with a real face (lip or expression shape keys) doesn't need the LED bar.
    const realFace = morphMeshes.some((m) => ['Smile', 'Smirk', 'Angry'].some((k) => k in m.morphTargetDictionary));
    if (this.lips.length || realFace) this.mesh.visible = false;

    this.scale = [...VISEMES.rest];
    this.target = [...VISEMES.rest];
    this.applyScale();

    this.timeline = null; // scripted visemes for text speech
    this.mic = null;      // live analyser for mic lip-sync
    this.voice = null;    // analyser on the robot's own speech
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

  // --- voice-driven: same analysis, on the robot's own speech audio ---
  follow(ctx, analyser) {
    if (this.voice?.analyser === analyser) return;
    this.voice = { ctx, analyser, buf: new Uint8Array(analyser.frequencyBinCount), level: 0 };
  }

  unfollow() { this.voice = null; }

  update(dt) {
    const audio = this.mic ?? (this.timeline ? null : this.voice);
    if (audio) {
      const { analyser, buf, ctx } = audio;
      analyser.getByteFrequencyData(buf);
      const hz = ctx.sampleRate / analyser.fftSize;
      let low = 0, high = 0;
      for (let i = 0; i < buf.length; i++) {
        const f = i * hz;
        if (f > 80 && f < 1000) low += buf[i];
        else if (f >= 1000 && f < 4000) high += buf[i];
      }
      const level = Math.min(1, Math.max(0, (low + high) / 9000 - 0.15));
      audio.level += (level - audio.level) * 0.5;
      const bright = high / (low + high + 1);
      this.target = [0.6 + bright * 0.9, Math.max(0.08, audio.level)];
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
    if (this.lips.length) this.applyLips();
  }

  // [width, height] -> viseme weights: height opens the jaw, width picks wide ("ee") vs round ("oo").
  applyLips() {
    const [w, h] = this.scale;
    const clamp = (x) => Math.min(1, Math.max(0, x));
    const open = clamp((h - 0.12) / 0.88);
    const wide = clamp((w - 0.9) / 0.35);
    const round = clamp((0.8 - w) / 0.35);
    const weights = {
      open: open * (1 - round) * 0.85,
      round: open * round * 0.8,
      pucker: (1 - open) * round * 0.7,
      wide: wide * 0.6,
      closed: clamp((0.1 - h) / 0.08) * 0.8,
    };
    for (const mesh of this.lips) {
      for (const [k, v] of Object.entries(weights)) {
        const i = mesh.morphTargetDictionary[LIP_KEYS[k]];
        if (i !== undefined) mesh.morphTargetInfluences[i] = v;
      }
    }
  }
}
