import * as THREE from 'three';
import { FX_LAYER } from './character.js';
import { sfx } from './sfx.js';

const GRAVITY = -14;
const THROWABLE_CAPACITY = 3;
const THROW_COOLDOWN = 1.4;
const RECHARGE_TIME = 4;
const PAINT_COLORS = ['#ff3da5', '#3dff7a', '#ffe23d', '#3da0ff', '#b03dff', '#ff7a1a'];

// What each throwable looks like, what it leaves behind, and how big the mark is.
const KINDS = {
  stone:  { soft: false, mark: () => bruiseTexture(),          size: 0.62, target: 'abdomen' },
  tomato: { soft: true,  mark: () => splatTexture('#d4180f'), size: 0.95, target: 'abdomen' },
  paint:  { soft: true,  mark: (c) => splatTexture(c),        size: 1.2,  target: 'abdomen' },
  egg:    { soft: true,  mark: () => splatTexture('#c9c23a', '#fff6c8'), size: 0.9, target: 'abdomen' },
  pie:    { soft: true,  mark: () => creamSplatTexture(), size: 1.0, target: 'abdomen' },
};

export class Thrower {
  constructor(scene, camera, character) {
    this.scene = scene;
    this.camera = camera;
    this.character = character;
    this.flying = [];
    this.particles = [];
    this.stickers = [];
    this.raycaster = new THREE.Raycaster(); // only sees layer 0 = the character's body
    this.ammo = Object.fromEntries(Object.keys(KINDS).map((kind) => [kind, {
      charges: THROWABLE_CAPACITY, cooldown: 0, recharge: 0, lastState: '',
    }]));
    this.on = {}; // callbacks: hit(kind, point), miss(kind)
  }

  throw(kind) {
    if (!KINDS[kind]) return false;
    const ammo = this.ammo[kind];
    if (ammo.cooldown > 0 || ammo.charges < 1) return false;
    ammo.charges--;
    ammo.cooldown = THROW_COOLDOWN;
    if (ammo.charges < THROWABLE_CAPACITY && ammo.recharge <= 0) ammo.recharge = RECHARGE_TIME;
    this.notifyAmmo(kind);
    const spec = KINDS[kind];
    const color = kind === 'paint' ? PAINT_COLORS[Math.floor(Math.random() * PAINT_COLORS.length)] : null;
    const mesh = makeProjectile(kind, color);
    mesh.traverse((o) => o.layers.set(FX_LAYER));

    // Launch toward the lower torso, well below the face.
    const start = this.camera.position.clone().add(new THREE.Vector3((Math.random() - 0.5) * 3, -2.5, -2));
    const part = spec.target === 'abdomen' ? 'Abdomen' : 'Torso';
    const spread = [0.7, 0.55];
    const target = this.character.partCenter(part).add(
      new THREE.Vector3((Math.random() - 0.5) * spread[0], (Math.random() - 0.5) * spread[1], 0));
    const aimX = target.x;
    const willMiss = Math.random() < 0.12;
    if (willMiss) target.x += (Math.random() < 0.5 ? -1 : 1) * 2.4;

    const T = 0.55; // flight time
    const vel = target.clone().sub(start).divideScalar(T);
    vel.y -= 0.5 * GRAVITY * T;

    mesh.position.copy(start);
    this.scene.add(mesh);
    this.flying.push({
      kind, color, mesh, vel, age: 0, hit: false,
      dodgeAt: !willMiss && Math.random() < 0.38 ? 0.16 + Math.random() * 0.1 : Infinity,
      dodgeSide: aimX < this.character.partCenter('Torso').x ? 1 : -1,
      dodgeAttempted: false,
      spin: new THREE.Vector3(Math.random() * 10, Math.random() * 10, Math.random() * 10),
    });
    sfx.whoosh();
    return true;
  }

  resetAmmo() {
    for (const ammo of Object.values(this.ammo)) {
      ammo.charges = THROWABLE_CAPACITY;
      ammo.cooldown = 0;
      ammo.recharge = 0;
    }
    this.refreshAmmo();
  }

  refreshAmmo() {
    for (const kind of Object.keys(this.ammo)) this.notifyAmmo(kind, true);
  }

  notifyAmmo(kind, force = false) {
    const ammo = this.ammo[kind];
    const state = `${ammo.charges}:${Math.ceil(ammo.cooldown)}:${Math.ceil(ammo.recharge)}`;
    if (!force && state === ammo.lastState) return;
    ammo.lastState = state;
    this.on.ammo?.(kind, ammo.charges, THROWABLE_CAPACITY, ammo.cooldown, ammo.recharge);
  }

  update(dt) {
    for (const [kind, ammo] of Object.entries(this.ammo)) {
      ammo.cooldown = Math.max(0, ammo.cooldown - dt);
      if (ammo.charges < THROWABLE_CAPACITY) {
        ammo.recharge -= dt;
        if (ammo.recharge <= 0) {
          ammo.charges++;
          ammo.recharge = ammo.charges < THROWABLE_CAPACITY ? RECHARGE_TIME : 0;
        }
      }
      this.notifyAmmo(kind);
    }

    const prev = new THREE.Vector3();
    const dir = new THREE.Vector3();

    for (const p of this.flying) {
      p.age += dt;
      if (!p.dodgeAttempted && p.age >= p.dodgeAt) {
        p.dodgeAttempted = true;
        this.character.tryDodge(p.dodgeSide);
      }
      prev.copy(p.mesh.position);
      p.vel.y += GRAVITY * dt;
      p.mesh.position.addScaledVector(p.vel, dt);
      if (p.kind !== 'pie') {
        p.mesh.rotation.x += p.spin.x * dt;
        p.mesh.rotation.y += p.spin.y * dt;
      }

      if (!p.hit) {
        // did this frame's movement pass through the character?
        dir.subVectors(p.mesh.position, prev);
        const len = dir.length();
        this.raycaster.set(prev, dir.normalize());
        this.raycaster.far = len + 0.15;
        const hit = this.raycaster.intersectObject(this.character.root, true)[0];
        if (hit) this.onImpact(p, hit, dir.clone());
      }
      if (p.age > 2.5 || p.mesh.position.y < -3) {
        p.dead = true;
        if (!p.hit) this.on.miss?.(p.kind);
      }
    }
    this.flying = this.flying.filter((p) => {
      if (p.dead) this.scene.remove(p.mesh);
      return !p.dead;
    });

    // splash particles
    for (const q of this.particles) {
      q.age += dt;
      q.vel.y += GRAVITY * dt;
      q.mesh.position.addScaledVector(q.vel, dt);
      q.mesh.material.opacity = Math.max(0, 1 - q.age / q.life);
    }
    this.particles = this.particles.filter((q) => {
      if (q.age < q.life) return true;
      this.scene.remove(q.mesh);
      return false;
    });

    // Let stone discoloration fade naturally; other splats remain until cleanup.
    const now = performance.now();
    this.stickers = this.stickers.filter((s) => {
      if (s.userData.fadeStart === undefined) return true;
      const t = (now - s.userData.fadeStart) / s.userData.fadeDuration;
      if (t >= 1) {
        s.removeFromParent();
        return false;
      }
      if (t > 0) s.material.opacity = s.userData.baseOpacity * (1 - t);
      return true;
    });
  }

  onImpact(p, hit, dir) {
    const spec = KINDS[p.kind];
    p.hit = true;

    // surface normal in world space, facing the thrower
    const normal = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
    if (normal.dot(dir) > 0) normal.negate();

    this.addSticker(spec, p, hit, normal);
    this.burst(hit.point, normal, p.kind === 'stone' ? '#9a8f86' : (p.color || stickerColor(p.kind)), p.kind === 'stone' ? 6 : 14);
    this.character.hit(hit.point, dir, p.kind);

    if (spec.soft) {
      p.dead = true;
      sfx.splat();
    } else {
      // stones bounce off
      p.vel.reflect(normal).multiplyScalar(0.35);
      p.mesh.position.copy(hit.point).addScaledVector(normal, 0.2);
      sfx.thunk();
      sfx.clang();
    }
    this.on.hit?.(p.kind, hit.point);
  }

  addSticker(spec, p, hit, normal) {
    const tex = spec.mark(p.color);
    const mat = new THREE.MeshStandardMaterial({
      map: tex, transparent: true, depthWrite: false, roughness: 0.3,
      emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0,
      polygonOffset: true, polygonOffsetFactor: -4,
    });
    const s = spec.size * (0.85 + Math.random() * 0.3);
    const sticker = new THREE.Mesh(new THREE.PlaneGeometry(s, s), mat);
    sticker.layers.set(FX_LAYER);
    sticker.position.copy(hit.point).addScaledVector(normal, 0.03);
    sticker.lookAt(hit.point.clone().add(normal)); // keeps drips pointing roughly down
    if (!spec.soft) sticker.rotateZ(Math.random() * Math.PI * 2);

    // stick to the body part so it moves with the animation
    const anchor = hit.object.isSkinnedMesh ? this.character.nearestBone(hit.point) : hit.object;
    anchor.attach(sticker);
    if (p.kind === 'stone') {
      sticker.material.opacity = 0.72;
      sticker.userData.baseOpacity = 0.72;
      sticker.userData.fadeStart = performance.now() + 3500;
      sticker.userData.fadeDuration = 10000;
    } else if (p.kind === 'pie') {
      sticker.userData.baseOpacity = 1;
      sticker.userData.fadeStart = performance.now() + 5000;
      sticker.userData.fadeDuration = 3500;
    }
    this.stickers.push(sticker);
  }

  burst(point, normal, color, count) {
    for (let i = 0; i < count; i++) {
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.04 + Math.random() * 0.05, 6, 6),
        new THREE.MeshBasicMaterial({ color, transparent: true }),
      );
      mesh.layers.set(FX_LAYER);
      mesh.position.copy(point);
      const vel = normal.clone().multiplyScalar(2 + Math.random() * 3)
        .add(new THREE.Vector3((Math.random() - 0.5) * 4, Math.random() * 3, (Math.random() - 0.5) * 4));
      this.scene.add(mesh);
      this.particles.push({ mesh, vel, age: 0, life: 0.5 + Math.random() * 0.4 });
    }
  }

  clearStickers() {
    for (const s of this.stickers) s.removeFromParent();
    this.stickers = [];
  }
}

function stickerColor(kind) {
  return { tomato: '#d4180f', egg: '#c9c23a', pie: '#fffaf0' }[kind] || '#fff';
}

// ---------- projectile models ----------
function makeProjectile(kind, color) {
  if (kind === 'stone') {
    const g = new THREE.IcosahedronGeometry(0.22, 1);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const k = 0.8 + Math.random() * 0.4;
      p.setXYZ(i, p.getX(i) * k, p.getY(i) * k * 0.8, p.getZ(i) * k);
    }
    g.computeVertexNormals();
    return new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0xb5aba2, flatShading: true, roughness: 0.9 }));
  }
  if (kind === 'tomato') {
    const grp = new THREE.Group();
    grp.add(new THREE.Mesh(new THREE.SphereGeometry(0.22, 16, 12), new THREE.MeshStandardMaterial({ color: 0xd4180f, roughness: 0.35 })));
    const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.08, 5), new THREE.MeshStandardMaterial({ color: 0x2f8a2f }));
    leaf.position.y = 0.22;
    grp.add(leaf);
    return grp;
  }
  if (kind === 'paint') {
    return new THREE.Mesh(new THREE.SphereGeometry(0.22, 16, 12),
      new THREE.MeshStandardMaterial({ color, roughness: 0.25, emissive: color, emissiveIntensity: 0.2 }));
  }
  if (kind === 'egg') {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.17, 16, 12), new THREE.MeshStandardMaterial({ color: 0xe9dfc4, roughness: 0.6 }));
    m.scale.set(1, 1.3, 1);
    return m;
  }
  // pie: flies flat-face first
  const grp = new THREE.Group();
  const tin = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.28, 0.1, 24), new THREE.MeshStandardMaterial({ color: 0xc8c8c8, metalness: 0.6, roughness: 0.4 }));
  const cream = new THREE.Mesh(new THREE.SphereGeometry(0.32, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xfffaf0, roughness: 0.8 }));
  cream.scale.y = 0.45;
  cream.position.y = 0.05;
  grp.add(tin, cream);
  grp.rotation.x = -Math.PI / 2; // cream side toward the robot
  return grp;
}

// ---------- mark textures (drawn on a canvas) ----------
function canvasTexture(draw) {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  draw(c.getContext('2d'));
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function splatTexture(color, highlight = '#ffffff') {
  return canvasTexture((ctx) => {
    ctx.fillStyle = color;
    const blob = (x, y, r) => { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); };
    blob(128, 118, 52);
    for (let i = 0; i < 14; i++) {                // lumpy edge
      const a = Math.random() * Math.PI * 2, d = 30 + Math.random() * 35;
      blob(128 + Math.cos(a) * d, 118 + Math.sin(a) * d, 12 + Math.random() * 22);
    }
    for (let i = 0; i < 12; i++) {                // flung droplets
      const a = Math.random() * Math.PI * 2, d = 80 + Math.random() * 40;
      blob(128 + Math.cos(a) * d, 118 + Math.sin(a) * d, 3 + Math.random() * 7);
    }
    for (let i = 0; i < 4; i++) {                 // drips running down
      const x = 95 + Math.random() * 66, len = 40 + Math.random() * 70;
      ctx.fillRect(x - 5, 140, 10, len);
      blob(x, 140 + len, 7);
    }
    ctx.globalAlpha = 0.5;                        // wet highlight
    ctx.fillStyle = highlight;
    blob(110, 100, 12);
  });
}

function creamSplatTexture() {
  return canvasTexture((ctx) => {
    const blob = (x, y, r) => { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); };
    const cream = ctx.createRadialGradient(112, 88, 12, 128, 128, 115);
    cream.addColorStop(0, '#fffdf5');
    cream.addColorStop(0.58, '#fff8e5');
    cream.addColorStop(0.86, '#f2dfb7');
    cream.addColorStop(1, 'rgba(206,177,132,0)');
    ctx.fillStyle = cream;

    // Uneven lobes make the cream edge look soft and freshly smashed.
    ctx.beginPath();
    for (let i = 0; i <= 40; i++) {
      const a = i / 40 * Math.PI * 2;
      const r = 65 + Math.sin(a * 5 + 0.4) * 9 + Math.sin(a * 9) * 5;
      const x = 128 + Math.cos(a) * r;
      const y = 112 + Math.sin(a) * r * 0.72;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();

    // Cream folds and soft highlights add depth without a glowing look.
    ctx.globalAlpha = 0.3;
    ctx.fillStyle = '#e9d4a8';
    for (let i = 0; i < 7; i++) {
      const a = Math.random() * Math.PI * 2;
      blob(128 + Math.cos(a) * (35 + Math.random() * 37), 112 + Math.sin(a) * (24 + Math.random() * 29), 7 + Math.random() * 13);
    }
    ctx.globalAlpha = 0.62;
    ctx.fillStyle = '#ffffff';
    blob(105, 83, 17);
    blob(145, 101, 9);

    // Gravity pulls cream drips and droplets down from the impact.
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = '#fff8e8';
    for (let i = 0; i < 4; i++) {
      const x = 86 + i * 27 + (Math.random() - 0.5) * 12;
      const y = 151 + Math.random() * 13;
      const length = 24 + Math.random() * 46;
      const width = 7 + Math.random() * 7;
      ctx.beginPath();
      ctx.moveTo(x - width / 2, y);
      ctx.quadraticCurveTo(x - width / 2, y + length * 0.72, x, y + length);
      ctx.quadraticCurveTo(x + width / 2, y + length * 0.72, x + width / 2, y);
      ctx.closePath();
      ctx.fill();
      blob(x, y + length, width * 0.53);
    }
    ctx.globalAlpha = 0.75;
    for (let i = 0; i < 13; i++) {
      const a = Math.random() * Math.PI * 2;
      const d = 78 + Math.random() * 39;
      blob(128 + Math.cos(a) * d, 112 + Math.sin(a) * d * 0.72, 2 + Math.random() * 4);
    }
    ctx.globalAlpha = 1;
  });
}

function bruiseTexture() {
  return canvasTexture((ctx) => {
    // Layered, soft-edged discoloration reads as a bruise on the robot's pale shell.
    const g = ctx.createRadialGradient(128, 128, 5, 128, 128, 105);
    g.addColorStop(0, 'rgba(111,70,126,0.5)');
    g.addColorStop(0.34, 'rgba(145,86,132,0.39)');
    g.addColorStop(0.68, 'rgba(177,111,119,0.22)');
    g.addColorStop(1, 'rgba(177,111,119,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 256, 256);
    // Uneven impact flecks keep it from looking like a flat purple sticker.
    for (let i = 0; i < 24; i++) {
      const a = Math.random() * Math.PI * 2, d = 18 + Math.random() * 73;
      ctx.fillStyle = `rgba(${108 + Math.floor(Math.random() * 48)},${61 + Math.floor(Math.random() * 40)},${126 + Math.floor(Math.random() * 48)},${0.04 + Math.random() * 0.1})`;
      ctx.beginPath();
      ctx.ellipse(128 + Math.cos(a) * d, 128 + Math.sin(a) * d, 5 + Math.random() * 15, 4 + Math.random() * 11, a, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.strokeStyle = 'rgba(225,213,225,0.42)';
    ctx.lineWidth = 1.5;
    for (let i = 0; i < 4; i++) {
      let a = Math.random() * Math.PI * 2, x = 128, y = 128;
      ctx.beginPath();
      ctx.moveTo(x, y);
      for (let s = 0; s < 3; s++) {
        a += (Math.random() - 0.5) * 0.7;
        x += Math.cos(a) * (8 + Math.random() * 12);
        y += Math.sin(a) * (8 + Math.random() * 12);
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  });
}
