import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Mouth } from './mouth.js';

// Layer 1 = visual effects (mouth, splats, particles...). Rendered, but ignored by hit tests.
export const FX_LAYER = 1;

// Expression shape keys (blender/make_human.py). Models without some of them just skip those.
export const EXPRESSIONS = ['Smug', 'Angry', 'Surprised', 'Sad', 'Happy', 'Bored', 'Pain', 'Wince', 'Disgust', 'Contempt', 'Cold', 'Fear',
  // authored in human-realistic-expressions.blend (its Angry/Sad are renamed Scowl/Frown on export)
  'Smile', 'Smirk', 'Scowl', 'Frown'];
const RESTING = { name: 'Happy', weight: 0.25 }; // a gentle, helpful smile

// Body language, as rotations about world axes (x = his left, y = up, z = toward the visitor).
const X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(0, 0, 1);
export const POSTURES = {
  still: [],
  lean_in: [['Torso', X, 0.1], ['Neck', X, 0.05], ['Head', X, 0.04]],
  lean_back: [['Torso', X, -0.08], ['Head', X, -0.1]],
  shrug: [['Clavicle.L', Z, 0.16], ['Clavicle.R', Z, -0.16], ['LowerArm.L', Z, 0.3], ['LowerArm.R', Z, -0.3], ['Head', Z, 0.07]],
  tilt: [['Head', Z, 0.15], ['Neck', Z, 0.04]],
  turn_away: [['Torso', Y, 0.16], ['Head', Y, 0.32], ['Head', X, -0.04]],
  cower: [['Torso', X, 0.12], ['Torso', Y, -0.2], ['Head', Y, -0.3], ['Head', X, 0.12],
    ['UpperArm.L', X, -0.5], ['UpperArm.R', X, -0.5], ['LowerArm.L', X, -0.9], ['LowerArm.R', X, -0.9]],
  embrace: [['UpperArm.L', X, -0.55], ['UpperArm.R', X, -0.55], ['UpperArm.L', Z, -0.25], ['UpperArm.R', Z, 0.25],
    ['LowerArm.L', X, -0.7], ['LowerArm.R', X, -0.7], ['Torso', X, 0.08], ['Head', Z, 0.12]],
  highfive: [['UpperArm.R', X, -1.75], ['UpperArm.R', Z, -0.2], ['LowerArm.R', X, -0.45], ['Torso', Y, -0.08], ['Head', Z, 0.08]],
  fistbump: [['UpperArm.R', X, -1.05], ['UpperArm.R', Z, -0.1], ['LowerArm.R', X, -0.35], ['Torso', X, 0.05], ['Torso', Y, -0.1]],
  slump: [['Abdomen', X, 0.08], ['Torso', X, 0.28], ['Neck', X, 0.2], ['Head', X, 0.35], ['Head', Z, 0.1],
    ['Clavicle.L', Z, -0.08], ['Clavicle.R', Z, 0.08]],
};
// Face for each kind of hit: [quick flash, mood that follows].
const HIT_FACES = {
  pie: ['Surprised', 'Angry'], stone: ['Pain', 'Angry'], bat: ['Pain', 'Angry'], smash: ['Wince', 'Pain'],
  stab: ['Pain', 'Fear'], headbutt: ['Surprised', 'Disgust'], tomato: ['Surprised', 'Disgust'], egg: ['Surprised', 'Disgust'],
  paint: ['Surprised', 'Frown'],
};

export function loadCharacter(url, onProgress, { applyRelaxPose = true } = {}) {
  return new Promise((resolve, reject) => {
    new GLTFLoader().load(url, (gltf) => resolve(new Character(gltf, { applyRelaxPose })), onProgress, reject);
  });
}

class Character {
  constructor(gltf, { applyRelaxPose = true } = {}) {
    this.root = gltf.scene;
    this.bones = {};
    this.root.traverse((o) => { if (o.isBone) this.bones[o.name] = o; });
    this.root.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(this.root);
    const size = bounds.getSize(new THREE.Vector3());
    const center = bounds.getCenter(new THREE.Vector3());
    const scale = 4.8 / Math.max(size.y, 0.001);
    this.root.scale.setScalar(scale);
    this.root.position.set(-center.x * scale, -bounds.min.y * scale, -center.z * scale);
    this.root.updateMatrixWorld(true);

    // Black disappears behind the glass, so make the eyes/brows glow instead.
    // The eyes are part of the head mesh, so this also finds the head.
    let head = null;
    let eyes = null;
    this.root.traverse((o) => {
      if (o.isMesh && o.material.name === 'Black') {
        o.material.color.set(0x000000);
        o.material.emissive.set(0x55e6ff);
        o.material.emissiveIntensity = 1.5;
        eyes = o;
        head = o.parent?.isBone ? o : o.parent;
      }
    });
    head ??= this.bone('Head') ?? this.bone('Neck') ?? this.root;
    this.head = head;

    // Facial morphs exported from human-realistic-expressions.blend.
    this.faceMeshes = [];
    this.glowMeshes = [];  // cyborg seams: flicker when glitching, go dark when unplugged
    this.meshes = [];
    this.root.traverse((o) => {
      if (!o.isMesh) return;
      this.meshes.push(o);
      if (o.morphTargetDictionary) this.faceMeshes.push(o);
      if (o.name.startsWith('Cyborg')) { o.layers.set(FX_LAYER); this.glowMeshes.push(o); } // not hit targets
      if (o.material.alphaTest > 0) o.material.alphaToCoverage = true; // soft hair/lash edges
    });
    this.height = 4.8;
    this.mouth = new Mouth(head, eyes, this.faceMeshes);
    this.mouth.mesh.layers.set(FX_LAYER);
    // face = what gets written to the shape keys each frame (eased moods + quick flashes + gaze)
    this.face = {};
    this.flashes = {};     // short-lived spikes (Surprised on a hit, brow lifts), decaying to 0
    this.mood = { ...RESTING };
    this.moodHold = Infinity; // seconds until he settles back to the resting smirk
    this.angryTimer = 0;
    this.blinkIn = 2 + Math.random() * 3;
    this.blinkT = -1;

    this.posture = 'still';
    this.postureW = Object.fromEntries(Object.keys(POSTURES).map((k) => [k, 0]));

    // eyes: x > 0 looks to his left, y > 0 looks up; (0, -0.12) is the visitor
    this.gaze = { x: 0, y: -0.12 };
    this.gazeTarget = { x: 0, y: -0.12 };
    this.saccadeIn = 1;
    this.eyeRollT = -1;
    this.listening = false;
    this.speechLevel = 0;
    this.browCooldown = 0;

    // Animation
    this.mixer = new THREE.AnimationMixer(this.root);
    this.actions = {};
    for (const [i, clip] of gltf.animations.entries()) this.actions[clip.name || `Animation${i}`] = this.mixer.clipAction(clip);
    this.idle = Object.entries(this.actions).find(([name]) => name.toLowerCase().includes('idle'))?.[1]
      ?? Object.values(this.actions)[0];
    if (this.idle) this.idle.setEffectiveTimeScale(0.72).play();
    else if (applyRelaxPose && this.inAPose()) this.relaxPose();
    this.oneShot = null;
    this.mixer.addEventListener('finished', (e) => {
      if (e.action !== this.oneShot) return;
      if (this.idle) {
        this.idle.reset().play();
        this.oneShot.crossFadeTo(this.idle, 0.3, false);
      }
      this.oneShot = null;
    });

    this.jolts = [];       // springy hit reactions on bones
    this.lastOffsets = new Map();
    this.elapsed = 0;
    this.hitStreak = 0;
    this.hitAge = Infinity;
    this.dodge = null;
    this.dodgeCooldown = 0;
    this.baseX = this.root.position.x;
    this.evict = null;     // eviction sequence state
    this.glitchT = 0;      // seconds of glitching left
    this.glitchAmp = 0;
    this.off = false;      // unplugged: slumped, eyes shut, seams dark
    this.erase = null;     // delete sequence state
    this.on = {};          // callbacks: launch, land, cleanup, erased, restored

    this.makeRocketFlame();
    this.makeStars();
    this.makeScanRing();
  }

  // three.js drops dots from names and suffixes duplicates ("Torso" -> "Torso_1").
  bone(name) {
    const aliases = {
      Head: ['Head', 'head', 'Skeleton_neck_joint_2', 'Skeleton_neck_joint_1'],
      Neck: ['Neck', 'neck', 'neck_01', 'Skeleton_neck_joint_2', 'Skeleton_neck_joint_1'],
      Torso: ['Torso', 'torso', 'spine_03', 'spine_01', 'Spine2', 'Spine1', 'Spine', 'Skeleton_torso_joint_2', 'Skeleton_torso_joint_1'],
      Abdomen: ['Abdomen', 'pelvis', 'Hips', 'Spine', 'Skeleton_torso_joint_1', 'Skeleton_torso_joint_2'],
      'Clavicle.L': ['Shoulder.L', 'clavicle_l', 'LeftShoulder'],
      'Clavicle.R': ['Shoulder.R', 'clavicle_r', 'RightShoulder'],
      'UpperArm.L': ['UpperArm.L', 'upperarm_l', 'LeftArm', 'Skeleton_arm_joint_L__4_', 'Skeleton_arm_joint_L__3_'],
      'UpperArm.R': ['UpperArm.R', 'upperarm_r', 'RightArm', 'Skeleton_arm_joint_R', 'Skeleton_arm_joint_R__2_'],
      'LowerArm.L': ['LowerArm.L', 'lowerarm_l', 'LeftForeArm', 'Skeleton_arm_joint_L__3_', 'Skeleton_arm_joint_L__2_'],
      'LowerArm.R': ['LowerArm.R', 'lowerarm_r', 'RightForeArm', 'Skeleton_arm_joint_R__2_', 'Skeleton_arm_joint_R__3_'],
      'UpperLeg.L': ['UpperLeg.L', 'thigh_l', 'LeftUpLeg', 'LeftLeg'],
      'UpperLeg.R': ['UpperLeg.R', 'thigh_r', 'RightUpLeg', 'RightLeg'],
    };
    for (const k of aliases[name] ?? [name.replace(/\./g, '')]) if (this.bones[k]) return this.bones[k];
    return Object.values(this.bones)[0];
  }

  // Arms held out from the body (hands well above hip height)? Models already standing arms-down skip relaxPose.
  inAPose() {
    const hand = this.bone('LowerArm.L')?.getWorldPosition(new THREE.Vector3());
    const shoulder = this.bone('UpperArm.L')?.getWorldPosition(new THREE.Vector3());
    if (!hand || !shoulder) return false;
    return Math.abs(hand.x - shoulder.x) > Math.abs(shoulder.y - hand.y) * 0.5; // elbow swung well out sideways
  }

  // No idle animation (e.g. the MPFB human): drop the arms from the A-pose to the sides.
  relaxPose() {
    const forward = new THREE.Vector3(0, 0, 1);
    for (const [name, angle] of [['UpperArm.L', -0.6], ['UpperArm.R', 0.6], ['LowerArm.L', 0.08], ['LowerArm.R', -0.08]]) {
      const bone = this.bone(name);
      if (!bone?.parent) continue;
      // rotate about the world forward axis, expressed in the bone's parent space
      const parentQ = bone.parent.getWorldQuaternion(new THREE.Quaternion());
      const axis = forward.clone().applyQuaternion(parentQ.invert());
      bone.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(axis, angle));
      bone.updateMatrixWorld(true);
    }
  }

  // Center of the meshes attached directly to a bone (e.g. 'Head', 'Torso').
  partCenter(boneName) {
    const bone = this.bone(boneName);
    if (!bone) return new THREE.Box3().setFromObject(this.root).getCenter(new THREE.Vector3());
    const box = new THREE.Box3();
    for (const c of bone.children) if (!c.isBone && c.layers.isEnabled(0)) box.expandByObject(c, true);
    return box.isEmpty() ? bone.getWorldPosition(new THREE.Vector3()) : box.getCenter(new THREE.Vector3());
  }

  nearestBone(point, names = ['Head', 'Torso', 'Abdomen', 'UpperArm.L', 'UpperArm.R', 'LowerArm.L', 'LowerArm.R']) {
    let best = null, bestD = Infinity;
    const p = new THREE.Vector3();
    for (const n of names) {
      const b = this.bone(n);
      if (!b) continue;
      const d = b.getWorldPosition(p).distanceTo(point);
      if (d < bestD) { bestD = d; best = b; }
    }
    return best;
  }

  playOnce(name) {
    const a = this.actions[name];
    if (!a || a === this.idle || this.oneShot || this.evict) return;
    this.oneShot = a;
    a.reset().setLoop(THREE.LoopOnce, 1);
    a.clampWhenFinished = true;
    a.play();
    this.idle?.crossFadeTo(a, 0.2, false);
  }

  // Busy with a sequence (evicted, unplugged, being deleted): nothing else should start.
  get busy() { return !!(this.evict || this.off || this.erase); }

  // A point on his surface, found by casting a ray at a body part from outside.
  // part: 'head' | 'face' | 'torso'; from: 'front' | 'left' (his left, the visitor's right).
  surfacePoint(part, from = 'front') {
    const top = new THREE.Box3().setFromObject(this.root).max.y;
    const y = top - this.height * (part === 'torso' ? 0.3 : part === 'face' ? 0.075 : 0.06);
    const center = this.bone(part === 'torso' ? 'Torso' : 'Head').getWorldPosition(new THREE.Vector3());
    const origin = from === 'left' ? new THREE.Vector3(center.x + 10, y, center.z + 0.05) : new THREE.Vector3(center.x, y, 10);
    const dir = from === 'left' ? new THREE.Vector3(-1, 0, 0) : new THREE.Vector3(0, 0, -1);
    const ray = new THREE.Raycaster(origin, dir); // layer 0 only: body, not seams or splats
    const hit = ray.intersectObject(this.root, true)[0];
    return { point: hit ? hit.point : new THREE.Vector3(center.x, y, center.z), dir: dir.clone() };
  }

  // Kind actions: he softens (or performs softening). The brain decides what he makes of it afterwards.
  receive(kind) {
    if (kind === 'hug') this.express('Happy', 'embrace');
    if (kind === 'flowers') { this.flash('Surprised', 0.6); this.express('Happy', 'tilt'); }
    if (kind === 'highfive' || kind === 'fistbump') this.express('Happy', kind); // raise the hand to meet theirs
    if (kind === 'pat') {
      const head = this.bone('Head');
      this.jolts.push({ bone: head, axis: new THREE.Vector3(1, 0, 0), amp: 0.12, t: 0 }); // a little dip under the hand
      this.express('Happy', 'tilt');
    }
    this.settle(3.5);
  }

  // A hard hit from a harm action: a bigger stagger, a pain face and a glitch.
  strike(point, dir, kind, force = 1.4) {
    this.hit(point, dir, kind, force);
    this.glitch(0.45 + force * 0.2, 0.06 * force);
  }

  // Short burst of digital breakup: jitter, flickering parts and seams.
  glitch(duration = 0.5, amp = 0.06) {
    this.glitchT = Math.max(this.glitchT, duration);
    this.glitchAmp = Math.max(this.glitchAmp, amp);
  }

  // Unplugged: he slumps, eyes close, the seams go dark. powerUp() reboots him.
  powerDown() {
    if (this.busy) return false;
    this.off = true;
    this.express(null, 'slump');
    this.mood = { name: 'Sad', weight: 0.25 };
    this.glitch(0.3, 0.04);
    for (const m of this.glowMeshes) m.visible = false;
    return true;
  }

  powerUp() {
    this.off = false;
    this.glitch(0.8, 0.05);
    for (const m of this.glowMeshes) m.visible = true;
    this.flash('Surprised', 0.8);
    this.express('Cold', 'still');
    this.settle(5);
  }

  // Deleted: a scan line wipes him away from the feet up, then he is rebuilt from a "backup".
  startErase() {
    if (this.busy) return false;
    const box = new THREE.Box3().setFromObject(this.root);
    this.erase = { phase: 'fear', t: 0, bottom: box.min.y - 0.05, top: box.max.y + 0.05 };
    this.plane ??= new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this.flash('Fear', 1);
    this.express('Fear', 'cower');
    return true;
  }

  makeScanRing() {
    const size = new THREE.Box3().setFromObject(this.root).getSize(new THREE.Vector3());
    const r = Math.max(size.x, size.z) * 0.5;
    this.scanRing = new THREE.Mesh(
      new THREE.RingGeometry(r * 0.9, r, 48),
      new THREE.MeshBasicMaterial({ color: 0x55e6ff, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false }),
    );
    this.scanRing.rotation.x = -Math.PI / 2;
    this.scanRing.layers.set(FX_LAYER);
    this.scanRing.visible = false;
  }

  updateGlitch(dt) {
    if (this.glitchT <= 0) return;
    this.glitchT -= dt;
    const done = this.glitchT <= 0;
    const a = this.glitchAmp * (Math.random() < 0.3 ? 1 : 0.25);
    if (!this.dodge && !this.evict) this.root.position.x = done ? this.baseX : this.baseX + (Math.random() - 0.5) * 2 * a;
    const drop = !done && Math.random() < 0.3 ? this.meshes[Math.floor(Math.random() * this.meshes.length)] : null;
    for (const m of this.meshes) m.visible = m !== drop;                       // one part drops out for a frame
    for (const m of this.glowMeshes) m.visible = !this.off && (done || Math.random() > 0.5);
    if (done) this.glitchAmp = 0;
  }

  updateErase(dt) {
    const e = this.erase;
    if (!e) return;
    e.t += dt;
    const setClip = (on) => { for (const m of this.meshes) { m.material.clippingPlanes = on ? [this.plane] : null; m.material.needsUpdate = true; } };
    const ring = this.scanRing;
    const center = this.bone('Torso').getWorldPosition(new THREE.Vector3());
    if (e.phase === 'fear' && e.t > 0.9) {
      e.phase = 'wipe'; e.t = 0;
      setClip(true);
      this.plane.normal.set(0, 1, 0);           // keep what is above the line
      ring.visible = true;
      this.on.eraseStart?.();
    } else if (e.phase === 'wipe') {
      const h = e.bottom + (e.top - e.bottom) * Math.min(1, e.t / 1.8);
      this.plane.constant = -h;
      ring.position.set(center.x, h, center.z);
      this.glitch(0.1, 0.03);
      if (e.t > 1.8) { e.phase = 'gone'; e.t = 0; ring.visible = false; this.root.visible = false; this.on.erased?.(); }
    } else if (e.phase === 'gone' && e.t > 1.6) {
      e.phase = 'rebuild'; e.t = 0;
      this.root.visible = true;
      this.plane.normal.set(0, -1, 0);          // keep what is below the line, line rises
      ring.visible = true;
      this.flash('Fear', 0); this.mood = { name: 'Bored', weight: 0.4 }; this.posture = 'still';
      this.on.rebuildStart?.();
    } else if (e.phase === 'rebuild') {
      const h = e.bottom + (e.top - e.bottom) * Math.min(1, e.t / 1.8);
      this.plane.constant = h;
      ring.position.set(center.x, h, center.z);
      if (e.t > 1.8) {
        setClip(false);
        ring.visible = false;
        this.erase = null;
        this.flash('Surprised', 0.6);
        this.on.restored?.();
      }
    }
  }

  // Called by the projectile system when something lands on him.
  hit(point, dir, kind, force = 1) {
    const bone = this.nearestBone(point, ['Head', 'Torso', 'Abdomen', 'UpperArm.L', 'UpperArm.R']);
    if (!bone) return;
    this.hitStreak = this.hitAge < 1.4 ? this.hitStreak + 1 : 1;
    this.hitAge = 0;
    const pivot = bone.getWorldPosition(new THREE.Vector3());
    const axis = new THREE.Vector3().subVectors(point, pivot).cross(dir);
    if (axis.lengthSq() < 1e-6) axis.set(1, 0, 0);
    axis.normalize();
    const parentQ = bone.parent.getWorldQuaternion(new THREE.Quaternion()).invert();
    axis.applyQuaternion(parentQ);
    force *= Math.min(1.6, 1 + (this.hitStreak - 1) * 0.16);
    this.jolts.push({ bone, axis, amp: (kind === 'pie' ? 0.34 : 0.52) * force, t: 0 });

    // Spread the impulse through the torso and shoulders for a more physical stagger.
    const torso = this.bone('Torso');
    if (torso && torso !== bone) {
      this.jolts.push({ bone: torso, axis: axis.clone().multiplyScalar(-1), amp: 0.13 * force, t: 0 });
    }
    if (['Head', 'Torso', 'Abdomen'].some((n) => this.bone(n) === bone)) {
      // Hands come up toward the body after a hit, with a slight side bias.
      for (const [name, side] of [['UpperArm.L', -1], ['UpperArm.R', 1]]) {
        const arm = this.bone(name);
        if (arm) this.jolts.push({ bone: arm, axis: new THREE.Vector3(side, 0, 1).normalize(), amp: 0.16 * force, t: 0 });
      }
      const leg = this.bone(point.x < pivot.x ? 'UpperLeg.L' : 'UpperLeg.R');
      if (leg) this.jolts.push({ bone: leg, axis: new THREE.Vector3(1, 0, 0), amp: 0.07 * force, t: 0 });
    }

    const [flash, after] = HIT_FACES[kind] ?? HIT_FACES.pie;
    this.flash(flash, 1);
    if (after === 'Angry') {
      this.angryTimer = 1.8 + Math.min(1, (this.hitStreak - 1) * 0.2);
    } else {
      this.express(after, null, 0.8);
      this.settle(3);
    }
    if (this.hitStreak >= 3) this.playOnce('No');
    else if (kind === 'pie' && Math.random() < 0.5) this.playOnce('No');
  }

  tryDodge(side) {
    if (this.busy || this.dodge || this.dodgeCooldown > 0) return false;
    this.dodge = { side: side < 0 ? -1 : 1, t: 0 };
    this.dodgeCooldown = 1.15;
    const torso = this.bone('Torso');
    const head = this.bone('Head');
    const arm = this.bone(side < 0 ? 'UpperArm.L' : 'UpperArm.R');
    const axis = new THREE.Vector3(0, 0, 1);
    if (torso) this.jolts.push({ bone: torso, axis, amp: 0.12, t: 0 });
    if (head) this.jolts.push({ bone: head, axis: axis.clone().negate(), amp: 0.07, t: 0 });
    if (arm) this.jolts.push({ bone: arm, axis: new THREE.Vector3(1, 0, 0), amp: 0.12, t: 0 });
    return true;
  }

  // While he "thinks" about your question: a glance up and to the side.
  thinking() {
    this.gazeTarget = { x: 0.35, y: 0.3 };
    this.saccadeIn = 0.9;
  }

  // Set his expression and/or posture (null keeps the current one). Holds until settle().
  express(name, posture, weight = 1) {
    if (name && EXPRESSIONS.includes(name)) this.mood = { name, weight };
    if (posture && POSTURES[posture]) this.posture = posture;
    this.moodHold = Infinity;
  }

  // Back to the resting smirk and neutral stance after `delay` seconds.
  settle(delay = 2.5) { this.moodHold = Math.min(this.moodHold, delay); }

  flash(name, amount) { this.flashes[name] = Math.max(this.flashes[name] ?? 0, amount); }

  eyeRoll() { this.eyeRollT = 0; }

  setListening(on) {
    this.listening = on;
    this.gazeTarget = { x: 0, y: -0.12 };
  }

  // A throw missed him: a quick smug look.
  missed() {
    if (this.busy) return;
    this.express('Smug', null, 0.9);
    this.settle(1.5);
  }

  startEvict() {
    if (this.busy) return false;
    if (this.oneShot) { this.oneShot.stop(); this.oneShot = null; this.idle?.reset().play(); }
    this.evict = { phase: 'crouch', t: 0, vy: 0, spin: 0 };
    this.flash('Surprised', 0.5);
    this.flash('Fear', 1);
    return true;
  }

  makeRocketFlame() {
    const g = new THREE.ConeGeometry(0.45, 1.8, 20, 1, true);
    g.rotateX(Math.PI);           // point down
    g.translate(0, -0.9, 0);      // apex below the origin
    this.flame = new THREE.Mesh(g, new THREE.MeshBasicMaterial({
      color: 0xffa040, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    this.flame.layers.set(FX_LAYER);
    this.flame.visible = false;
    this.root.add(this.flame);
  }

  makeStars() {
    const n = 500;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 18;
      pos[i * 3 + 1] = Math.random() * 16 - 2;
      pos[i * 3 + 2] = -Math.random() * 12 + 2;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.stars = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.07, transparent: true, opacity: 0 }));
    this.stars.layers.set(FX_LAYER);
    this.stars.visible = false;
  }

  updateEvict(dt) {
    const e = this.evict;
    if (!e) return;
    e.t += dt;
    const r = this.root;
    const stars = this.stars;

    if (e.phase === 'crouch') {            // wind up
      const k = Math.min(1, e.t / 0.4);
      r.scale.set(1 + 0.1 * k, 1 - 0.18 * k, 1 + 0.1 * k);
      if (e.t > 0.4) {
        e.phase = 'launch'; e.t = 0;
        this.flame.visible = true;
        stars.visible = true;
        this.on.launch?.();
      }
    } else if (e.phase === 'launch') {     // blast off, spinning
      r.scale.set(0.92, 1.12, 0.92);
      e.vy += 12 * dt; // slow enough to see the flame
      r.position.y += e.vy * dt;
      e.spin += dt * 8;
      r.rotation.y += e.spin * dt;
      r.rotation.z = Math.sin(e.t * 9) * 0.12;
      this.flame.scale.set(1, 0.8 + Math.random() * 0.5, 1);
      if (e.t > 2.6) { e.phase = 'away'; e.t = 0; r.visible = false; }
    } else if (e.phase === 'away') {       // gone...
      if (e.t > 1.4) {
        e.phase = 'fall'; e.t = 0; e.vy = 0;
        r.visible = true;
        r.position.y = 16;
        r.rotation.set(0, 0, 0);
        r.scale.set(0.95, 1.08, 0.95);
        this.flame.visible = false;
        this.on.cleanup?.();
      }
    } else if (e.phase === 'fall') {       // ...and back
      e.vy -= 40 * dt;
      r.position.y += e.vy * dt;
      if (r.position.y <= 0) {
        r.position.y = 0;
        e.phase = 'land'; e.t = 0;
        this.jolts.push({ bone: this.bone('Torso') ?? this.root, axis: new THREE.Vector3(1, 0, 0), amp: 0.25, t: 0 });
        this.flash('Surprised', 1);
        this.angryTimer = 2;
        this.on.land?.();
      }
    } else if (e.phase === 'land') {       // squash and settle
      const s = 0.22 * Math.exp(-7 * e.t) * Math.cos(18 * e.t);
      r.scale.set(1 + s * 0.5, 1 - s, 1 + s * 0.5);
      if (e.t > 0.8) { r.scale.set(1, 1, 1); this.evict = null; }
    }

    // stars stream downward while he's flying, then fade out
    const flying = e.phase === 'launch' || e.phase === 'away';
    const m = stars.material;
    m.opacity += ((flying ? 1 : 0) - m.opacity) * Math.min(1, dt * 4);
    if (flying) {
      const p = stars.geometry.attributes.position;
      const speed = 6 + e.vy * 0.6;
      for (let i = 0; i < p.count; i++) {
        let y = p.getY(i) - speed * dt;
        if (y < -2) y += 16;
        p.setY(i, y);
      }
      p.needsUpdate = true;
    }
    if (!this.evict && m.opacity < 0.02) stars.visible = false;
  }

  update(dt) {
    this.elapsed += dt;
    this.hitAge += dt;
    this.dodgeCooldown = Math.max(0, this.dodgeCooldown - dt);
    this.updateDodge(dt);
    if (this.hitAge > 1.4) this.hitStreak = 0;
    // undo last frame's jolt offsets (for bones the animation doesn't overwrite)
    for (const [bone, q] of this.lastOffsets) bone.quaternion.premultiply(q.invert());
    this.lastOffsets.clear();

    this.mixer.update(dt);
    this.updateEvict(dt);
    this.updateErase(dt);
    this.updateGlitch(dt);

    // springy jolts: quick kick away from the impact, then wobble back
    const q = new THREE.Quaternion();
    this.jolts = this.jolts.filter((j) => (j.t += dt) < 1.2);
    for (const j of this.jolts) {
      const a = j.amp * Math.exp(-8 * j.t) * Math.cos(11 * j.t) * Math.min(1, j.t / 0.035);
      q.setFromAxisAngle(j.axis, a);
      j.bone.quaternion.premultiply(q);
      const prev = this.lastOffsets.get(j.bone);
      this.lastOffsets.set(j.bone, prev ? q.clone().multiply(prev) : q.clone());
    }

    // Small secondary motion gives the rig weight while the authored idle loops.
    // These offsets are removed before the next animation tick, like impact jolts.
    const breathe = Math.sin(this.elapsed * Math.PI * 0.72);
    const sway = Math.sin(this.elapsed * 0.63 + 0.7);
    const addIdleOffset = (bone, axis, amount) => {
      if (!bone) return;
      q.setFromAxisAngle(axis, amount);
      bone.quaternion.premultiply(q);
      const prev = this.lastOffsets.get(bone);
      this.lastOffsets.set(bone, prev ? q.clone().multiply(prev) : q.clone());
    };
    addIdleOffset(this.bone('Abdomen'), new THREE.Vector3(1, 0, 0), breathe * 0.012);
    addIdleOffset(this.bone('Torso'), new THREE.Vector3(0, 0, 1), sway * 0.008);
    addIdleOffset(this.bone('Head'), new THREE.Vector3(0, 1, 0), sway * 0.018);
    const speaking = this.mouth.scale[1] > 0.16 ? this.mouth.scale[1] - 0.16 : 0;
    addIdleOffset(this.bone('Head'), new THREE.Vector3(1, 0, 0), Math.sin(this.elapsed * 5) * speaking * 0.012);
    addIdleOffset(this.bone('UpperArm.L'), new THREE.Vector3(1, 0, 0), breathe * 0.006);
    addIdleOffset(this.bone('UpperArm.R'), new THREE.Vector3(1, 0, 0), -breathe * 0.006);
    this.updatePosture(dt, addIdleOffset);
    this.updateFace(dt);
    this.mouth.update(dt);
  }

  // Blend toward the current posture; offsets are world-axis rotations converted to each bone's parent space.
  updatePosture(dt, addOffset) {
    const parentQ = new THREE.Quaternion();
    for (const [name, steps] of Object.entries(POSTURES)) {
      const w = this.postureW[name] += ((name === this.posture ? 1 : 0) - this.postureW[name]) * Math.min(1, dt * 3);
      if (w < 0.001) continue;
      for (const [boneName, axis, angle] of steps) {
        const bone = this.bone(boneName);
        if (!bone?.parent) continue;
        bone.parent.getWorldQuaternion(parentQ).invert();
        addOffset(bone, axis.clone().applyQuaternion(parentQ), angle * w);
      }
    }
  }

  updateFace(dt) {
    const ease = (k, rate) => Math.min(1, dt * rate);

    // expression: the chosen mood, overridden by anger for a moment after a hit
    this.moodHold -= dt;
    if (this.moodHold <= 0 && !this.off) { this.mood = { ...RESTING }; this.posture = 'still'; this.moodHold = Infinity; }
    this.angryTimer = Math.max(0, this.angryTimer - dt);
    const angry = this.angryTimer > 0;
    for (const name of EXPRESSIONS) {
      let target = name === this.mood.name ? this.mood.weight * (angry ? 0.25 : 1) : 0;
      if (name === 'Angry' && angry) target = 0.9;
      this.face[name] = (this.face[name] ?? 0) + (target - (this.face[name] ?? 0)) * ease(dt, 4);
    }

    // brow lift when a new word starts (speech level jumps)
    const level = this.mouth.scale[1];
    this.browCooldown -= dt;
    if (level - this.speechLevel > 0.22 && this.browCooldown <= 0 && Math.random() < 0.5) {
      this.flash('browOuterUpLeft', 0.5); this.flash('browOuterUpRight', 0.45); this.flash('browInnerUp', 0.25);
      this.browCooldown = 0.7;
    }
    this.speechLevel += (level - this.speechLevel) * ease(dt, 10);
    for (const b of ['browOuterUpLeft', 'browOuterUpRight', 'browInnerUp']) this.face[b] = 0;
    if (this.listening) this.face.browOuterUpLeft = 0.3; // skeptical while you talk

    // quick spikes on top
    for (const [name, v] of Object.entries(this.flashes)) {
      this.face[name] = Math.min(1, Math.max(this.face[name] ?? 0, v));
      this.flashes[name] = Math.max(0, v - dt * (name.startsWith('brow') ? 1.6 : 2.2));
    }

    this.updateGaze(dt);

    // blink every few seconds (0.16 s close-open)
    this.blinkIn -= dt;
    if (this.blinkIn <= 0) { this.blinkT = 0; this.blinkIn = 2 + Math.random() * 4; }
    this.face.Blink = 0;
    if (this.blinkT >= 0) {
      this.blinkT += dt;
      this.face.Blink = Math.sin(Math.min(1, this.blinkT / 0.16) * Math.PI);
      if (this.blinkT > 0.16) this.blinkT = -1;
    }
    if (this.off) this.face.Blink = 1; // unplugged: eyes shut
    for (const mesh of this.faceMeshes) {
      for (const [name, v] of Object.entries(this.face)) {
        const i = mesh.morphTargetDictionary[name];
        if (i !== undefined) mesh.morphTargetInfluences[i] = v;
      }
    }
  }

  // Eye contact with small darting glances; a slow sweep up and over for an eye-roll.
  updateGaze(dt) {
    const g = this.gaze;
    if (this.eyeRollT >= 0) {
      this.eyeRollT += dt;
      const k = Math.min(1, this.eyeRollT / 0.9);
      const a = Math.PI * (1 - k);                 // sweep from one side, over the top, to the other
      this.gazeTarget = { x: Math.cos(a) * 0.6, y: Math.sin(a) * 0.9 + 0.1 };
      if (k >= 1) { this.eyeRollT = -1; this.gazeTarget = { x: 0, y: -0.12 }; }
    } else if ((this.saccadeIn -= dt) <= 0) {
      const away = !this.listening && this.mouth.scale[1] < 0.2 && Math.random() < 0.25;
      const r = away ? 0.5 : 0.08;                 // mostly eye contact, sometimes a glance away
      this.gazeTarget = { x: (Math.random() - 0.5) * 2 * r, y: -0.12 + (Math.random() - 0.5) * r };
      this.saccadeIn = away ? 0.6 + Math.random() * 0.8 : 0.4 + Math.random() * 1.8;
    }
    const k = Math.min(1, dt * (this.eyeRollT >= 0 ? 8 : 25)); // saccades are fast
    g.x += (this.gazeTarget.x - g.x) * k;
    g.y += (this.gazeTarget.y - g.y) * k;
    const f = this.face, pos = (v) => Math.max(0, v);
    f.eyeLookOutLeft = f.eyeLookInRight = pos(g.x);  // looking to his left
    f.eyeLookInLeft = f.eyeLookOutRight = pos(-g.x);
    f.eyeLookUpLeft = f.eyeLookUpRight = pos(g.y);
    f.eyeLookDownLeft = f.eyeLookDownRight = pos(-g.y);
  }

  updateDodge(dt) {
    if (this.evict) {
      this.root.position.x = this.baseX;
      this.dodge = null;
      return;
    }
    if (!this.dodge) return;
    const d = this.dodge;
    d.t += dt;
    const out = 0.22, hold = 0.16, back = 0.34;
    const distance = 0.48;
    let offset;
    if (d.t < out) {
      const k = d.t / out;
      offset = distance * (k * k * (3 - 2 * k));
    } else if (d.t < out + hold) {
      offset = distance;
    } else if (d.t < out + hold + back) {
      const k = (d.t - out - hold) / back;
      offset = distance * (1 - k * k * (3 - 2 * k));
    } else {
      offset = 0;
      this.dodge = null;
    }
    this.root.position.x = this.baseX + d.side * offset;
  }
}
