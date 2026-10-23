import * as THREE from 'three';
import { FX_LAYER } from './character.js';
import { sfx } from './sfx.js';

// Physical harm actions: a tool flies in along a curve, hits a point found on his body,
// and leaves sparks and a glowing wound. Janson is synthetic: he leaks light, never blood.
// Targets come from character.surfacePoint(), so any model with Head/Torso bones works.
const GRAVITY = -14;
const GLOW = 0x55e6ff;

const TOOLS = {
  bat: { part: 'head', from: 'left', dur: 0.3, force: 1.6, wound: 'crack', stays: false },
  smash: { part: 'face', from: 'front', dur: 0.32, force: 1.5, wound: 'crack', stays: false },
  stab: { part: 'torso', from: 'front', dur: 0.16, force: 1.2, wound: 'puncture', stays: true },
  headbutt: { part: 'face', from: 'front', dur: 0.26, force: 1.3, wound: null, stays: false },
};

export class Harm {
  constructor(scene, camera, character) {
    this.scene = scene;
    this.camera = camera;
    this.character = character;
    this.moves = [];      // tools in flight
    this.particles = [];
    this.leaks = [];      // wounds dripping light for a while
    this.wounds = [];     // decals and stuck tools, cleared by clear()
    this.camOffset = new THREE.Vector3(); // headbutt lunge, added to the camera by main.js
    this.lunge = null;
    this.on = {};         // impact(kind)
  }

  // Run one strike; resolves after the impact. strength scales the force (a hard phone swing hits harder).
  strike(kind, strength = 1) {
    const spec = TOOLS[kind];
    const { point, dir } = this.character.surfacePoint(spec.part, spec.from);
    if (kind === 'headbutt') return this.headbutt(point, dir, strength);
    const mesh = makeTool(kind);
    mesh.traverse((o) => o.layers.set(FX_LAYER));
    this.scene.add(mesh);

    // a curved approach: from off to the side/above toward the point
    const start = point.clone(), ctrl = point.clone();
    if (kind === 'bat') { start.add(new THREE.Vector3(3.2, 0.6, 1.2)); ctrl.add(new THREE.Vector3(1.6, 0.9, 1.8)); }
    if (kind === 'smash') { start.add(new THREE.Vector3(0.6, 3, 1.5)); ctrl.add(new THREE.Vector3(0.3, 1.8, 2)); }
    if (kind === 'stab') { start.add(new THREE.Vector3(0.4, -0.6, 3)); ctrl.lerpVectors(start, point, 0.5); }
    const end = kind === 'stab' ? point.clone().addScaledVector(dir, 0.12) : point.clone();
    sfx.swing();
    return new Promise((resolve) => {
      this.moves.push({
        kind, spec, mesh, curve: new THREE.QuadraticBezierCurve3(start, ctrl, end), t: 0, point, dir, strength,
        onImpact: resolve,
      });
    });
  }

  // Move the camera toward a point (stopping `gap` short), hold, and come back. onPeak runs on arrival.
  moveCamera(point, gap, inT, hold, outT, onPeak) {
    const to = point.clone().sub(this.camera.position);
    const dist = Math.max(0, to.length() - gap);
    this.lunge = { t: 0, vec: to.normalize().multiplyScalar(dist), inT, hold, outT, onPeak, peaked: false };
  }

  headbutt(point, dir, strength = 1) {
    // camera rushes at his face and snaps back
    return new Promise((resolve) => this.moveCamera(point, 1.1, 0.26, 0, 0.45, () => {
      this.character.strike(point, dir.clone().negate(), 'headbutt', TOOLS.headbutt.force * strength);
      this.burst(point, dir.clone().negate(), 10);
      sfx.headbutt();
      this.on.impact?.('headbutt', strength);
      resolve();
    }));
  }

  // Kind actions: camera hug, carried flowers, visible hand contact, and a head pat.
  kindness(kind) {
    const c = this.character;
    if (kind === 'hug') {
      const { point } = c.surfacePoint('torso');
      return new Promise((resolve) => this.moveCamera(point.add(new THREE.Vector3(0, 0.9, 0)), 3.2, 0.7, 1.6, 0.8, () => {
        c.receive('hug');
        sfx.warm();
        this.motes(point, 18, 0.9);
        resolve();
      }));
    }
    if (kind === 'flowers') {
      const { point, dir } = c.surfacePoint('torso');
      const end = point.clone().addScaledVector(dir, -0.35).add(new THREE.Vector3(0, -0.15, 0));
      const mesh = makeBouquet();
      mesh.traverse((o) => o.layers.set(FX_LAYER));
      this.scene.add(mesh);
      const start = end.clone().add(new THREE.Vector3(0.5, -1.2, 3));
      sfx.swing();
      return new Promise((resolve) => this.moves.push({
        kind, spec: { dur: 0.7, stays: true, gentle: true }, mesh, point: end, dir,
        curve: new THREE.QuadraticBezierCurve3(start, end.clone().add(new THREE.Vector3(0.2, 0.8, 1.2)), end), t: 0,
        onImpact: resolve,
      }));
    }
    if (kind === 'highfive' || kind === 'fistbump') {
      // their hand comes up from below the camera to meet his raised right hand (his right is -x)
      const { point, dir } = c.surfacePoint('torso');
      const five = kind === 'highfive';
      const meet = point.clone().add(new THREE.Vector3(-0.55, five ? 1.05 : 0.3, five ? 0.45 : 0.75));
      const start = meet.clone().add(new THREE.Vector3(0.7, -1.4, 3.6));
      const mesh = five ? makeOpenHand() : makeFist();
      mesh.traverse((o) => o.layers.set(FX_LAYER));
      this.scene.add(mesh);
      c.receive(kind); // he starts raising his hand right away
      return new Promise((resolve) => this.moves.push({
        kind, spec: { dur: 0.72, stays: false, touch: true }, mesh, point: meet, dir,
        curve: new THREE.QuadraticBezierCurve3(start, meet.clone().add(new THREE.Vector3(0.15, -0.25, 1.25)), meet), t: 0,
        onImpact: resolve,
      }));
    }
    // A relaxed open hand reaches over the head, gives two light pats, then withdraws.
    const top = new THREE.Box3().setFromObject(c.root).max;
    const head = c.bone('Head').getWorldPosition(new THREE.Vector3());
    const point = new THREE.Vector3(head.x, Math.min(top.y + 0.08, head.y + 0.24), head.z + 0.05);
    const start = point.clone().add(new THREE.Vector3(0.18, 0.9, 1.45));
    const hand = makeOpenHand();
    hand.rotation.x = Math.PI / 2; // palm faces down toward the head
    hand.traverse((o) => o.layers.set(FX_LAYER));
    hand.position.copy(start);
    this.scene.add(hand);
    c.receive('pat');
    sfx.swing();
    return new Promise((resolve) => this.moves.push({
      kind: 'pat', spec: { dur: 0.62, stays: false, touch: true, pat: true }, mesh: hand, point, dir: new THREE.Vector3(0, -1, 0),
      curve: new THREE.QuadraticBezierCurve3(start, point.clone().add(new THREE.Vector3(0, 0.45, 0.7)), point), t: 0,
      onImpact: resolve,
    }));
  }

  // Warm floating specks (pink and gold) that drift up and fade.
  motes(center, count, spread = 1.2) {
    for (let i = 0; i < count; i++) {
      const p = center.clone().add(new THREE.Vector3((Math.random() - 0.5) * spread, (Math.random() - 0.3) * spread, (Math.random() - 0.2) * spread * 0.6));
      const color = [0xff9ec7, 0xffd27a, 0xffffff][Math.floor(Math.random() * 3)];
      this.particle(p, new THREE.Vector3((Math.random() - 0.5) * 0.3, 0.4 + Math.random() * 0.5, 0), color, 0.025 + Math.random() * 0.02, 1.4 + Math.random(), -0.02);
    }
  }

  update(dt) {
    for (const m of this.moves) {
      m.t += dt;
      if (!m.hit) {
        const k = Math.min(1, m.t / m.spec.dur);
        const e = k * k * (3 - 2 * k); // ease into contact instead of snapping to the target
        m.mesh.position.copy(m.curve.getPoint(m.spec.gentle ? k * (2 - k) : e));
        if (!m.spec.gentle && !m.spec.touch) {
          m.mesh.lookAt(m.mesh.position.clone().add(m.curve.getTangent(e)));
          if (m.kind !== 'stab') m.mesh.rotateZ((1 - k) * 0.8);
        }
        if (k >= 1) (m.spec.gentle ? this.place(m) : m.spec.touch ? this.touch(m) : this.impact(m));
      } else if (m.spec.pat) {
        m.after += dt;
        // Two small, damped taps, followed by a gentle lift away from the head.
        const tap = m.after < 0.42 ? Math.abs(Math.sin(m.after * 2 * Math.PI / 0.28)) * Math.exp(-m.after * 1.7) : 0;
        m.mesh.position.copy(m.point).add(new THREE.Vector3(0, tap * 0.12 + Math.max(0, m.after - 0.42) * 1.8, 0));
        m.mesh.traverse((o) => { if (o.material) { o.material.transparent = true; o.material.opacity = Math.max(0, 1 - Math.max(0, m.after - 0.42) / 0.28); } });
        if (m.after > 0.72) m.done = true;
      } else if (!m.spec.stays) {
        // recoil and fade
        m.after += dt;
        m.mesh.position.addScaledVector(m.back, dt * 3);
        m.mesh.traverse((o) => { if (o.material) { o.material.transparent = true; o.material.opacity = Math.max(0, 1 - m.after / 0.4); } });
        if (m.after > 0.4) m.done = true;
      } else {
        m.done = true; // stuck in him; now owned by the wound list
      }
    }
    this.moves = this.moves.filter((m) => {
      if (m.done && !m.spec.stays) this.scene.remove(m.mesh);
      return !m.done;
    });

    if (this.lunge) {
      const L = this.lunge;
      L.t += dt;
      const back = L.t - L.inT - L.hold;
      const k = L.t < L.inT ? (L.t / L.inT) ** 2 : back < 0 ? 1 : Math.max(0, 1 - back / L.outT);
      this.camOffset.copy(L.vec).multiplyScalar(L.hold ? k * k * (3 - 2 * k) : k); // gentle ease for a hug
      if (!L.peaked && L.t >= L.inT) { L.peaked = true; L.onPeak(); }
      if (back > L.outT) { this.lunge = null; this.camOffset.set(0, 0, 0); }
    }

    for (const q of this.particles) {
      q.age += dt;
      q.vel.y += GRAVITY * q.gravity * dt;
      q.mesh.position.addScaledVector(q.vel, dt);
      q.mesh.material.opacity = Math.max(0, 1 - q.age / q.life);
    }
    this.particles = this.particles.filter((q) => {
      if (q.age < q.life) return true;
      this.scene.remove(q.mesh);
      return false;
    });

    // wounds drip light for a few seconds
    for (const l of this.leaks) {
      l.t += dt;
      if (Math.random() < dt * 14) {
        const p = l.anchor.localToWorld(l.local.clone());
        this.particle(p, new THREE.Vector3((Math.random() - 0.5) * 0.2, -0.2, 0.15), GLOW, 0.025, 1.2, 0.15);
      }
    }
    this.leaks = this.leaks.filter((l) => l.t < l.life);
  }

  impact(m) {
    m.hit = true;
    m.after = 0;
    const into = m.point.clone().sub(m.curve.v0).normalize();
    m.back = into.clone().negate().add(new THREE.Vector3(0, 0.3, 0));
    this.character.strike(m.point, into, m.kind, m.spec.force * (m.strength ?? 1));
    this.burst(m.point, m.dir.clone().negate(), m.kind === 'stab' ? 12 : 22);
    const anchor = this.character.nearestBone(m.point);
    if (m.spec.wound) this.addWound(m.spec.wound, m.point, m.dir.clone().negate(), anchor);
    if (m.spec.stays) { anchor.attach(m.mesh); this.wounds.push(m.mesh); }
    if (m.kind === 'stab' || m.kind === 'smash') {
      this.leaks.push({ anchor, local: anchor.worldToLocal(m.point.clone()), t: 0, life: m.kind === 'stab' ? 6 : 3 });
    }
    sfx[m.kind]?.();
    this.on.impact?.(m.kind, m.strength ?? 1);
    m.onImpact();
  }

  // A gift arrives: he holds it against his chest (it moves with him until cleared).
  place(m) {
    m.hit = true;
    this.character.bone('Torso').attach(m.mesh);
    this.wounds.push(m.mesh);
    this.character.receive(m.kind);
    sfx.warm();
    this.motes(m.point, 16, 0.8);
    m.onImpact();
  }

  // Hands meet: a flash of gold, a clap or a bump, then their hand pulls back.
  touch(m) {
    m.hit = true;
    m.after = 0;
    m.back = new THREE.Vector3(0.3, -0.4, 1.2);
    const c = this.character;
    if (m.spec.pat) {
      c.flash('Happy', 0.45);
      c.settle(2.5);
      sfx.sparkle();
      this.motes(m.point, 8, 0.22);
      m.onImpact();
      return;
    }
    c.flash('Happy', 1);
    c.flash('Surprised', 0.25);
    c.settle(2.5);
    this.motes(m.point, 16, 0.4);
    for (let i = 0; i < 14; i++) {
      const v = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.3, Math.random() - 0.5).normalize().multiplyScalar(1.5 + Math.random() * 1.5);
      this.particle(m.point, v, 0xffd27a, 0.02, 0.35, 0);
    }
    (m.kind === 'highfive' ? sfx.clap : sfx.bump)();
    m.onImpact();
  }

  // Glowing cracks or a puncture ring, stuck to the nearest bone so it moves with him.
  addWound(type, point, normal, anchor) {
    const tex = type === 'crack' ? crackTexture() : punctureTexture();
    const size = type === 'crack' ? 0.9 + Math.random() * 0.3 : 0.45;
    const mat = new THREE.MeshBasicMaterial({
      map: tex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      polygonOffset: true, polygonOffsetFactor: -4,
    });
    const decal = new THREE.Mesh(new THREE.PlaneGeometry(size, size), mat);
    decal.layers.set(FX_LAYER);
    decal.position.copy(point).addScaledVector(normal, 0.03);
    decal.lookAt(point.clone().add(normal));
    decal.rotateZ(Math.random() * Math.PI * 2);
    anchor.attach(decal);
    this.wounds.push(decal);
  }

  burst(point, normal, count) {
    for (let i = 0; i < count; i++) {
      const color = [GLOW, 0xffffff, 0xffb347][Math.floor(Math.random() * 3)];
      const vel = normal.clone().multiplyScalar(2 + Math.random() * 3)
        .add(new THREE.Vector3((Math.random() - 0.5) * 5, Math.random() * 4, (Math.random() - 0.5) * 5));
      this.particle(point, vel, color, 0.02 + Math.random() * 0.03, 0.4 + Math.random() * 0.4, 1);
    }
  }

  particle(pos, vel, color, size, life, gravity) {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(size, 5, 4),
      new THREE.MeshBasicMaterial({ color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    mesh.layers.set(FX_LAYER);
    mesh.position.copy(pos);
    this.scene.add(mesh);
    this.particles.push({ mesh, vel, age: 0, life, gravity });
  }

  // Remove every wound and stuck tool (new visitor, repair, restored from backup).
  clear() {
    for (const w of this.wounds) w.removeFromParent();
    this.wounds = [];
    this.leaks = [];
  }
}

// ---------- tools, built pointing along +Z (the direction of travel) ----------
function makeTool(kind) {
  const g = new THREE.Group();
  const mat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.6, ...extra });
  if (kind === 'bat') {
    const bat = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.035, 2.0, 16), mat(0xc49a6c));
    bat.position.y = -0.7; // swing with the fat end leading
    g.add(bat);
  } else if (kind === 'smash') {
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 1.1, 10), mat(0x6b4a2b));
    handle.position.y = -0.55;
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.18, 0.18), mat(0x8a8f96, { metalness: 0.8, roughness: 0.3 }));
    g.add(handle, head);
  } else {
    // screwdriver: tip at the origin, handle behind it
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.012, 0.55, 8), mat(0xc9ced6, { metalness: 0.9, roughness: 0.25 }));
    shaft.rotation.x = Math.PI / 2;
    shaft.position.z = -0.275;
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.05, 0.3, 12), mat(0xd23c2f));
    handle.rotation.x = Math.PI / 2;
    handle.position.z = -0.7;
    g.add(shaft, handle);
  }
  return g;
}

// The visitor's hand, palm toward him (he is at -z from it).
function makeOpenHand() {
  const g = new THREE.Group();
  const skin = new THREE.MeshStandardMaterial({ color: 0xc8a48a, roughness: 0.7 });
  const palm = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.32, 0.08), skin);
  g.add(palm);
  for (let i = 0; i < 4; i++) {
    const f = new THREE.Mesh(new THREE.CapsuleGeometry(0.032, 0.16 + (i === 1 || i === 2 ? 0.04 : 0), 4, 8), skin);
    f.position.set(-0.11 + i * 0.073, 0.27 + (i === 1 || i === 2 ? 0.02 : 0), 0);
    g.add(f);
  }
  const thumb = new THREE.Mesh(new THREE.CapsuleGeometry(0.035, 0.12, 4, 8), skin);
  thumb.position.set(0.19, 0.02, 0.02);
  thumb.rotation.z = -0.9;
  g.add(thumb);
  const wrist = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.11, 0.5, 12), skin);
  wrist.position.y = -0.38;
  g.add(wrist);
  return g;
}

function makeFist() {
  const g = new THREE.Group();
  const skin = new THREE.MeshStandardMaterial({ color: 0xc8a48a, roughness: 0.7 });
  const fist = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.24, 0.22), skin);
  g.add(fist);
  for (let i = 0; i < 4; i++) {
    const k = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 8), skin);
    k.position.set(-0.1 + i * 0.067, 0.04, -0.11); // knuckles lead, toward him
    g.add(k);
  }
  const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.11, 0.6, 12), skin);
  arm.rotation.x = Math.PI / 2;
  arm.position.z = 0.4;
  g.add(arm);
  return g;
}

function makeBouquet() {
  const g = new THREE.Group();
  const stem = new THREE.MeshStandardMaterial({ color: 0x3d8a3d, roughness: 0.8 });
  const colors = [0xff6b8a, 0xffd166, 0xffffff, 0xc77dff, 0xff8fab];
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2, r = i ? 0.09 : 0;
    const s = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.6, 5), stem);
    s.position.set(Math.cos(a) * r * 0.4, 0, Math.sin(a) * r * 0.4);
    s.rotation.set(Math.sin(a) * 0.2, 0, Math.cos(a) * 0.2);
    const bloom = new THREE.Mesh(new THREE.IcosahedronGeometry(0.07, 1),
      new THREE.MeshStandardMaterial({ color: colors[i % colors.length], roughness: 0.5, emissive: colors[i % colors.length], emissiveIntensity: 0.15 }));
    bloom.position.set(Math.cos(a) * r, 0.32, Math.sin(a) * r);
    g.add(s, bloom);
  }
  const wrap = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.38, 12, 1, true), new THREE.MeshStandardMaterial({ color: 0xf3e9dc, side: THREE.DoubleSide, roughness: 0.9 }));
  wrap.rotation.x = Math.PI;
  wrap.position.y = -0.05;
  g.add(wrap);
  return g;
}

// ---------- wound textures ----------
function canvasTexture(draw) {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  draw(c.getContext('2d'));
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Branching lines of light, like a cracked screen with circuitry underneath.
function crackTexture() {
  return canvasTexture((ctx) => {
    ctx.lineCap = 'round';
    const branch = (x, y, a, len, w) => {
      if (len < 8 || w < 0.4) return;
      const x2 = x + Math.cos(a) * len, y2 = y + Math.sin(a) * len;
      ctx.strokeStyle = 'rgba(85,230,255,0.35)'; ctx.lineWidth = w * 4; // glow
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x2, y2); ctx.stroke();
      ctx.strokeStyle = 'rgba(220,250,255,0.95)'; ctx.lineWidth = w;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x2, y2); ctx.stroke();
      branch(x2, y2, a + (Math.random() - 0.5) * 0.9, len * 0.7, w * 0.75);
      if (Math.random() < 0.45) branch(x2, y2, a + (Math.random() < 0.5 ? -1 : 1) * (0.5 + Math.random() * 0.6), len * 0.55, w * 0.6);
    };
    const n = 6 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) branch(128, 128, (i / n) * Math.PI * 2 + Math.random() * 0.5, 28 + Math.random() * 20, 3);
    const g = ctx.createRadialGradient(128, 128, 0, 128, 128, 30);
    g.addColorStop(0, 'rgba(200,250,255,0.9)'); g.addColorStop(1, 'rgba(85,230,255,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 256, 256);
  });
}

function punctureTexture() {
  return canvasTexture((ctx) => {
    const g = ctx.createRadialGradient(128, 128, 4, 128, 128, 110);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.15, 'rgba(85,230,255,0.9)');
    g.addColorStop(0.5, 'rgba(85,230,255,0.25)');
    g.addColorStop(1, 'rgba(85,230,255,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 256, 256);
  });
}
