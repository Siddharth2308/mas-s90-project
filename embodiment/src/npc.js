import * as THREE from 'three';

// NPC idle behavior: when nobody is engaging him, he shifts his weight, fidgets and paces like a game
// character waiting for the player. Anything that engages him (talk, replies, any action) cuts it off and
// turns him back to the visitor. Everything is bone offsets, so any rig with the usual bones works.

// Poses use world axes: x = his left, y = up, z = toward the visitor.
//   arm forward = -x · left arm out = +z, right arm out = -z · head to his left = +y · head down = +x
const FIDGETS = {
  ponder: [
    [0.7, [['UpperArm.L', 'x', -0.75], ['UpperArm.L', 'z', -0.35], ['LowerArm.L', 'x', -1.5], ['Head', 'x', 0.35], ['Head', 'y', 0.25], ['Torso', 'y', 0.08]]],
    [2.4, [['UpperArm.L', 'x', -0.75], ['UpperArm.L', 'z', -0.35], ['LowerArm.L', 'x', -1.5], ['Head', 'x', 0.35], ['Head', 'y', 0.25], ['Torso', 'y', 0.08]]],
    [3.2, []],
  ],
  check_watch: [
    [0.7, [['UpperArm.L', 'x', -0.5], ['UpperArm.L', 'z', -0.1], ['LowerArm.L', 'z', -1.15], ['LowerArm.L', 'x', -0.55], ['Head', 'x', 0.42], ['Head', 'y', -0.12], ['Torso', 'y', -0.05]]],
    [2.2, [['UpperArm.L', 'x', -0.5], ['UpperArm.L', 'z', -0.1], ['LowerArm.L', 'z', -1.15], ['LowerArm.L', 'x', -0.55], ['Head', 'x', 0.42], ['Head', 'y', -0.12], ['Torso', 'y', -0.05]]],
    [3.0, []],
  ],
  look_around: [
    [0.7, [['Head', 'y', 0.55], ['Neck', 'y', 0.15], ['Torso', 'y', 0.12]]],
    [1.6, [['Head', 'y', 0.55], ['Neck', 'y', 0.15], ['Torso', 'y', 0.12]]],
    [2.5, [['Head', 'y', -0.55], ['Neck', 'y', -0.15], ['Torso', 'y', -0.12]]],
    [3.3, [['Head', 'y', -0.55], ['Neck', 'y', -0.15], ['Torso', 'y', -0.12]]],
    [4.0, []],
  ],
  neck_stretch: [
    [0.8, [['Head', 'z', 0.32], ['Neck', 'z', 0.1]]],
    [1.5, [['Head', 'z', 0.32], ['Neck', 'z', 0.1]]],
    [2.3, [['Head', 'z', -0.32], ['Neck', 'z', -0.1]]],
    [2.9, [['Head', 'z', -0.32], ['Neck', 'z', -0.1]]],
    [3.6, []],
  ],
  yawn: [
    [0.8, [['Head', 'x', -0.3], ['Neck', 'x', -0.1], ['Torso', 'x', -0.05], ['Clavicle.L', 'z', 0.1], ['Clavicle.R', 'z', -0.1]]],
    [2.0, [['Head', 'x', -0.3], ['Neck', 'x', -0.1], ['Torso', 'x', -0.05], ['Clavicle.L', 'z', 0.1], ['Clavicle.R', 'z', -0.1]]],
    [3.0, []],
  ],
  cross_arms: [
    [0.9, [['UpperArm.L', 'x', -0.5], ['UpperArm.L', 'z', -0.12], ['LowerArm.L', 'z', -1.45], ['LowerArm.L', 'x', -0.35],
      ['UpperArm.R', 'x', -0.4], ['UpperArm.R', 'z', 0.12], ['LowerArm.R', 'z', 1.45], ['LowerArm.R', 'x', -0.3], ['Head', 'z', 0.06]]],
    [4.2, [['UpperArm.L', 'x', -0.5], ['UpperArm.L', 'z', -0.12], ['LowerArm.L', 'z', -1.45], ['LowerArm.L', 'x', -0.35],
      ['UpperArm.R', 'x', -0.4], ['UpperArm.R', 'z', 0.12], ['LowerArm.R', 'z', 1.45], ['LowerArm.R', 'x', -0.3], ['Head', 'z', 0.06]]],
    [5.0, []],
  ],
  scratch_head: [
    [0.8, [['UpperArm.R', 'x', -2.3], ['UpperArm.R', 'z', -0.5], ['LowerArm.R', 'x', -1.8], ['Head', 'z', 0.15], ['Head', 'x', 0.1]]],
    [1.1, [['UpperArm.R', 'x', -2.3], ['UpperArm.R', 'z', -0.5], ['LowerArm.R', 'x', -2.05], ['Head', 'z', 0.15], ['Head', 'x', 0.1]]],
    [1.4, [['UpperArm.R', 'x', -2.3], ['UpperArm.R', 'z', -0.5], ['LowerArm.R', 'x', -1.8], ['Head', 'z', 0.15], ['Head', 'x', 0.1]]],
    [1.7, [['UpperArm.R', 'x', -2.3], ['UpperArm.R', 'z', -0.5], ['LowerArm.R', 'x', -2.05], ['Head', 'z', 0.15], ['Head', 'x', 0.1]]],
    [2.0, [['UpperArm.R', 'x', -2.3], ['UpperArm.R', 'z', -0.5], ['LowerArm.R', 'x', -1.8], ['Head', 'z', 0.15], ['Head', 'x', 0.1]]],
    [2.9, []],
  ],
  rock_heels: [
    [0.5, [['Abdomen', 'x', 0.06], ['Head', 'x', -0.03]]],
    [1.0, [['Abdomen', 'x', -0.05], ['Head', 'x', 0.03]]],
    [1.5, [['Abdomen', 'x', 0.06], ['Head', 'x', -0.03]]],
    [2.0, [['Abdomen', 'x', -0.05], ['Head', 'x', 0.03]]],
    [2.6, []],
  ],
};
export const FIDGET_NAMES = Object.keys(FIDGETS);
const AXES = { x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 1, 0), z: new THREE.Vector3(0, 0, 1) };
const smooth = (k) => k * k * (3 - 2 * k);

export class Npc {
  constructor(character) {
    this.c = character;
    this.home = character.baseX;
    this.idleW = 0;          // 0 = attentive, 1 = fully idle (weight shift on)
    this.next = 4 + Math.random() * 4; // seconds of idling before the next fidget or pace
    this.fidget = null;      // { name, frames, t, w }
    this.pace = null;        // { from, to, t, dur, dir }
    this.last = null;
  }

  get idle() {
    const c = this.c;
    return !c.busy && !c.listening && !c.dodge && c.hitAge > 3 && c.elapsed - c.lastEngaged > 3;
  }

  update(dt, apply) {
    const c = this.c;
    const idle = this.idle;
    this.idleW += ((idle ? 1 : 0) - this.idleW) * Math.min(1, dt * (idle ? 0.8 : 4));

    // slow weight shift from foot to foot
    const shift = Math.sin(c.elapsed * 0.35) * this.idleW;
    apply('Abdomen', AXES.z, shift * 0.035);
    apply('Torso', AXES.z, -shift * 0.03);
    apply('Head', AXES.z, shift * 0.015);

    // engaged: drop whatever he was doing and come back to the middle
    if (!idle) {
      this.next = Math.max(this.next, 5 + Math.random() * 5);
      if (this.fidget) this.fidget.fading = true;
      if (!this.pace && Math.abs(c.baseX - this.home) > 0.05 && !c.busy) this.startPace(this.home, 0.9);
    } else if (!this.fidget && !this.pace && (this.next -= dt) <= 0) {
      if (Math.random() < 0.3) {
        const away = Math.abs(c.baseX - this.home) > 0.1;
        const side = Math.random() < 0.5 ? -1 : 1;
        this.startPace(away ? this.home : this.home + side * (0.35 + Math.random() * 0.3), 1.8);
      } else {
        let name;
        do name = FIDGET_NAMES[Math.floor(Math.random() * FIDGET_NAMES.length)]; while (name === this.last);
        this.last = name;
        this.fidget = { name, frames: FIDGETS[name], t: 0, w: 1, fading: false };
      }
      this.next = 6 + Math.random() * 8;
    }

    this.updateFidget(dt, apply);
    this.updatePace(dt, apply);
  }

  updateFidget(dt, apply) {
    const f = this.fidget;
    if (!f) return;
    f.t += dt;
    if (f.fading) f.w = Math.max(0, f.w - dt / 0.3);
    const end = f.frames.at(-1)[0];
    if (f.t >= end || f.w <= 0) { this.fidget = null; this.c.eyesShut = false; return; }

    // interpolate between the surrounding keyframes (an implicit rest pose at t = 0)
    const frames = [[0, []], ...f.frames];
    let i = 0;
    while (i < frames.length - 2 && frames[i + 1][0] <= f.t) i++;
    const [t0, a] = frames[i], [t1, b] = frames[i + 1];
    const k = smooth(Math.min(1, (f.t - t0) / (t1 - t0)));
    const angles = new Map();
    for (const [bone, ax, ang] of a) angles.set(`${bone}|${ax}`, ang * (1 - k));
    for (const [bone, ax, ang] of b) angles.set(`${bone}|${ax}`, (angles.get(`${bone}|${ax}`) ?? 0) + ang * k);
    for (const [key, ang] of angles) {
      const [bone, ax] = key.split('|');
      apply(bone, AXES[ax], ang * f.w);
    }

    // the face and eyes join in
    const c = this.c;
    const mid = f.t > 0.6 && f.t < end - 0.8;
    if (f.name === 'yawn') {
      if (mid) c.flash('MouthOpen', 0.85 * f.w);
      c.eyesShut = mid && f.w > 0.5;
    }
    if (f.name === 'look_around') {
      const yaw = angles.get('Head|y') ?? 0;
      c.gazeTarget = { x: yaw * 1.2, y: -0.05 };
      c.saccadeIn = 0.5;
    }
    if (f.name === 'check_watch' && mid) { c.gazeTarget = { x: -0.15, y: -0.6 }; c.saccadeIn = 0.5; }
    if (f.name === 'ponder' && mid) { c.gazeTarget = { x: 0.3, y: 0.25 }; c.saccadeIn = 0.5; }
  }

  // Play one now (test menu): a fidget by name, or 'pace'.
  play(name) {
    if (name === 'pace') return this.startPace(Math.abs(this.c.baseX - this.home) > 0.1 ? this.home : this.home + 0.5, 1.8);
    if (FIDGETS[name]) this.fidget = { name, frames: FIDGETS[name], t: 0, w: 1, fading: false };
  }

  // A few steps to the side: turn toward where he's going, legs swing, a little bob, then face front again.
  startPace(to, dur) {
    const from = this.c.baseX;
    if (Math.abs(to - from) < 0.02) return;
    this.pace = { from, to, t: 0, dur, dir: Math.sign(to - from) };
  }

  updatePace(dt, apply) {
    const p = this.pace;
    if (!p) return;
    const c = this.c;
    if (c.busy) { this.pace = null; c.root.rotation.y = 0; return; }
    p.t += dt;
    const k = Math.min(1, p.t / p.dur);
    c.baseX = p.from + (p.to - p.from) * smooth(k);
    if (!c.dodge) c.root.position.x = c.baseX;
    const turn = Math.min(1, k / 0.2, (1 - k) / 0.2);   // turn in, walk, turn back
    c.root.rotation.y = p.dir * 1.1 * smooth(Math.max(0, turn));
    const steps = Math.sin(p.t * Math.PI * 3.2) * Math.max(0, turn);
    const pitch = AXES.x.clone().applyAxisAngle(AXES.y, c.root.rotation.y); // his own side-to-side axis
    apply('UpperLeg.L', pitch, -steps * 0.35);
    apply('UpperLeg.R', pitch, steps * 0.35);
    apply('UpperArm.L', pitch, steps * 0.15);
    apply('UpperArm.R', pitch, -steps * 0.15);
    c.root.position.y = c.baseY + Math.abs(steps) * 0.03;
    if (k >= 1) { this.pace = null; c.root.rotation.y = 0; c.root.position.y = c.baseY; }
  }
}
