import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Mouth } from './mouth.js';

// Layer 1 = visual effects (mouth, splats, particles...). Rendered, but ignored by hit tests.
export const FX_LAYER = 1;

export function loadCharacter(url, onProgress) {
  return new Promise((resolve, reject) => {
    new GLTFLoader().load(url, (gltf) => resolve(new Character(gltf)), onProgress, reject);
  });
}

class Character {
  constructor(gltf) {
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
    this.mouth = new Mouth(head, eyes);
    this.mouth.mesh.layers.set(FX_LAYER);

    // Face morphs: Angry / Surprised / Sad
    this.faceMeshes = [];
    head.traverse?.((o) => { if (o.isMesh && o.morphTargetDictionary) this.faceMeshes.push(o); });
    this.face = { Angry: 0, Surprised: 0, Sad: 0 };
    this.faceTarget = { Angry: 0, Surprised: 0, Sad: 0 };
    this.angryTimer = 0;

    // Animation
    this.mixer = new THREE.AnimationMixer(this.root);
    this.actions = {};
    for (const [i, clip] of gltf.animations.entries()) this.actions[clip.name || `Animation${i}`] = this.mixer.clipAction(clip);
    this.idle = Object.entries(this.actions).find(([name]) => name.toLowerCase().includes('idle'))?.[1]
      ?? Object.values(this.actions)[0];
    if (this.idle) this.idle.setEffectiveTimeScale(0.72).play();
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
    this.evict = null;     // eviction sequence state
    this.on = {};          // callbacks: launch, land

    this.makeRocketFlame();
    this.makeStars();
  }

  // three.js drops dots from names and suffixes duplicates ("Torso" -> "Torso_1").
  bone(name) {
    const aliases = {
      Head: ['Head', 'head', 'Skeleton_neck_joint_2', 'Skeleton_neck_joint_1'],
      Neck: ['Neck', 'neck', 'Skeleton_neck_joint_2', 'Skeleton_neck_joint_1'],
      Torso: ['Torso', 'torso', 'Spine2', 'Spine1', 'Spine', 'Skeleton_torso_joint_2', 'Skeleton_torso_joint_1'],
      Abdomen: ['Abdomen', 'Hips', 'Spine', 'Skeleton_torso_joint_1', 'Skeleton_torso_joint_2'],
      'UpperArm.L': ['UpperArm.L', 'LeftArm', 'Skeleton_arm_joint_L__4_', 'Skeleton_arm_joint_L__3_'],
      'UpperArm.R': ['UpperArm.R', 'RightArm', 'Skeleton_arm_joint_R', 'Skeleton_arm_joint_R__2_'],
      'LowerArm.L': ['LowerArm.L', 'LeftForeArm', 'Skeleton_arm_joint_L__3_', 'Skeleton_arm_joint_L__2_'],
      'LowerArm.R': ['LowerArm.R', 'RightForeArm', 'Skeleton_arm_joint_R__2_', 'Skeleton_arm_joint_R__3_'],
      'UpperLeg.L': ['UpperLeg.L', 'LeftUpLeg', 'LeftLeg'],
      'UpperLeg.R': ['UpperLeg.R', 'RightUpLeg', 'RightLeg'],
    };
    for (const k of aliases[name] ?? [name.replace(/\./g, '')]) if (this.bones[k]) return this.bones[k];
    return Object.values(this.bones)[0];
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

  // Called by the projectile system when something lands on him.
  hit(point, dir, kind) {
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
    const force = Math.min(1.6, 1 + (this.hitStreak - 1) * 0.16);
    this.jolts.push({ bone, axis, amp: (kind === 'stone' ? 0.52 : 0.34) * force, t: 0 });

    // Spread the impulse through the torso and shoulders for a more physical stagger.
    const torso = this.bone('Torso');
    if (torso && torso !== bone) {
      this.jolts.push({ bone: torso, axis: axis.clone().multiplyScalar(-1), amp: 0.13 * force, t: 0 });
    }
    if (bone.name === 'Head' || bone.name === 'Torso' || bone.name === 'Abdomen') {
      // Hands come up toward the body after a hit, with a slight side bias.
      for (const [name, side] of [['UpperArm.L', -1], ['UpperArm.R', 1]]) {
        const arm = this.bone(name);
        if (arm) this.jolts.push({ bone: arm, axis: new THREE.Vector3(side, 0, 1).normalize(), amp: 0.16 * force, t: 0 });
      }
      const leg = this.bone(point.x < pivot.x ? 'UpperLeg.L' : 'UpperLeg.R');
      if (leg) this.jolts.push({ bone: leg, axis: new THREE.Vector3(1, 0, 0), amp: 0.07 * force, t: 0 });
    }

    this.face.Surprised = 1;
    this.angryTimer = 1.8 + Math.min(1, (this.hitStreak - 1) * 0.2);
    if (this.hitStreak >= 3) this.playOnce('No');
    else if (kind !== 'stone' && Math.random() < 0.5) this.playOnce('No');
  }

  // Eye-roll while he "thinks" about your question.
  annoyed(t = 1.5) {
    this.angryTimer = Math.max(this.angryTimer, t);
  }

  startEvict() {
    if (this.evict) return false;
    if (this.oneShot) { this.oneShot.stop(); this.oneShot = null; this.idle?.reset().play(); }
    this.evict = { phase: 'crouch', t: 0, vy: 0, spin: 0 };
    this.face.Surprised = 1;
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
        this.face.Surprised = 1;
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
    if (this.hitAge > 1.4) this.hitStreak = 0;
    // undo last frame's jolt offsets (for bones the animation doesn't overwrite)
    for (const [bone, q] of this.lastOffsets) bone.quaternion.premultiply(q.invert());
    this.lastOffsets.clear();

    this.mixer.update(dt);
    this.updateEvict(dt);

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
    addIdleOffset(this.bone('UpperArm.L'), new THREE.Vector3(1, 0, 0), breathe * 0.006);
    addIdleOffset(this.bone('UpperArm.R'), new THREE.Vector3(1, 0, 0), -breathe * 0.006);

    // face: surprised on impact, then angry for a bit
    this.angryTimer = Math.max(0, this.angryTimer - dt);
    this.faceTarget.Angry = this.angryTimer > 0 ? 0.9 : 0;
    this.face.Surprised = Math.max(0, this.face.Surprised - dt * 2.5);
    this.face.Angry += (this.faceTarget.Angry - this.face.Angry) * Math.min(1, dt * 6);
    for (const mesh of this.faceMeshes) {
      for (const [name, v] of Object.entries(this.face)) {
        const i = mesh.morphTargetDictionary[name];
        if (i !== undefined) mesh.morphTargetInfluences[i] = v;
      }
    }

    this.mouth.update(dt);
  }
}
