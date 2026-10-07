// The Colosseum: sky, sun, arena, stands, crowd, imperial box, dressing and particle effects.
import * as THREE from 'three';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { RX, RZ } from './sim.js';

export const PH = 3.4;                    // podium wall height
const ROWS = 20, TREAD = 0.9, RISE = 0.55, TIER0 = 2.5;
const TOP = PH + ROWS * RISE;             // top of the seating
export const BOX_Y = 6.2;                 // imperial box floor
export const THRONE = new THREE.Vector3(0, BOX_Y + 0.2, -RZ - 4.4);
export const GATE = new THREE.Vector3(0, 0, -RZ + 0.9);
const TILE = 3;                           // metres per texture repeat

const E = 'assets/env/';

// point on the ellipse offset d metres outward, and the angle step for even spacing
const at = (th, d, y, out = new THREE.Vector3()) => out.set((RX + d) * Math.cos(th), y, (RZ + d) * Math.sin(th));
const speed = (th, d) => Math.hypot((RX + d) * Math.sin(th), (RZ + d) * Math.cos(th));

function softTexture(stops) {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const x = c.getContext('2d'), g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  stops.forEach(([o, col]) => g.addColorStop(o, col));
  x.fillStyle = g; x.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export async function createWorld(manager, renderer) {
  const scene = new THREE.Scene();
  const tl = new THREE.TextureLoader(manager);
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const tex = (file, srgb, rx = 1, rz = rx) => {
    const t = tl.load(E + file);
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rx, rz); t.anisotropy = aniso;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  const pbr = (name, rx = 1, rz = rx, o = {}) => new THREE.MeshStandardMaterial({
    map: tex(name + '_diff.jpg', true, rx, rz), normalMap: tex(name + '_nor.jpg', false, rx, rz),
    roughnessMap: tex(name + '_rough.jpg', false, rx, rz), roughness: 1, ...o,
  });

  // ---- sky and sun: light direction is read from the brightest pixel of the HDRI ----
  const hdr = await new RGBELoader(manager).setDataType(THREE.FloatType).loadAsync(E + 'sky_2k.hdr');
  hdr.mapping = THREE.EquirectangularReflectionMapping;
  const { data, width: W, height: H } = hdr.image;
  let best = 0, bi = 0;
  for (let i = 0; i < W * H; i += 3) { const l = data[i * 4] + data[i * 4 + 1] + data[i * 4 + 2]; if (l > best) { best = l; bi = i; } }
  const az = ((bi % W + 0.5) / W - 0.5) * Math.PI * 2, lat = (0.5 - (Math.floor(bi / W) + 0.5) / H) * Math.PI;
  const WANT_AZ = 1.05;                   // sun sits toward +x/+z so it front-lights the imperial box
  const rot = az - WANT_AZ;
  scene.background = scene.environment = hdr;
  scene.backgroundRotation.y = scene.environmentRotation.y = rot;
  scene.environmentIntensity = 0.85;
  const el = Math.max(lat, 0.62);         // keep the sun high enough to reach the sand over the wall
  const sunDir = new THREE.Vector3(Math.cos(el) * Math.cos(WANT_AZ), Math.sin(el), Math.cos(el) * Math.sin(WANT_AZ)).normalize();
  scene.fog = new THREE.FogExp2(0xd8b68c, 0.0022);

  const sun = new THREE.DirectionalLight(0xffdcae, 3.4);
  sun.position.copy(sunDir).multiplyScalar(140);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  Object.assign(sun.shadow.camera, { left: -66, right: 66, top: 66, bottom: -66, near: 10, far: 320 });
  sun.shadow.bias = -0.0003; sun.shadow.normalBias = 0.06;
  scene.add(sun, sun.target);

  // ---- materials ----
  const sand = pbr('sand_01', (RX * 2) / 5, (RZ * 2) / 5, { color: 0xfff4e2, normalScale: new THREE.Vector2(0.7, 0.7) });
  const stone = pbr('large_sandstone_blocks_01', 1, 1, { side: THREE.DoubleSide });
  const marble = pbr('marble_01', 1, 1, { color: 0xf2ead8 });
  const marbleBig = pbr('marble_01', 3, 2, { color: 0xf2ead8 });
  const gold = new THREE.MeshStandardMaterial({ color: 0xe6c378, metalness: 1, roughness: 0.25 });
  const bronze = new THREE.MeshStandardMaterial({ color: 0xa8742f, metalness: 1, roughness: 0.4 });
  const dark = new THREE.MeshBasicMaterial({ color: 0x050403 });
  const uTime = { value: 0 }, uExcite = { value: 0 };

  const add = (geo, m, p = [0, 0, 0], cast = true) => {
    const o = new THREE.Mesh(geo, m); o.position.set(...p); o.castShadow = cast; o.receiveShadow = true; scene.add(o); return o;
  };

  // ---- arena floor ----
  const floor = add(new THREE.CircleGeometry(1, 96), sand, [0, 0, 0], false);
  floor.rotation.x = -Math.PI / 2; floor.scale.set(RX + 0.6, RZ + 0.6, 1);
  const outside = add(new THREE.CircleGeometry(700, 48), new THREE.MeshStandardMaterial({ color: 0xa88a62, roughness: 1 }), [0, -0.6, 0], false);
  outside.rotation.x = -Math.PI / 2;

  // ---- stands: a 2D profile [distance outward, height] swept around the ellipse ----
  function ring(profile, m, segs = 180) {
    const pos = [], uv = [], idx = [], n = profile.length, v = new THREE.Vector3();
    const plen = [0];
    for (let j = 1; j < n; j++) plen.push(plen[j - 1] + Math.hypot(profile[j][0] - profile[j - 1][0], profile[j][1] - profile[j - 1][1]));
    let arc = 0;
    for (let i = 0; i <= segs; i++) {
      const th = (i / segs) * Math.PI * 2;
      if (i) arc += speed(th, 12) * (Math.PI * 2 / segs);
      for (let j = 0; j < n; j++) { at(th, profile[j][0], profile[j][1], v); pos.push(v.x, v.y, v.z); uv.push(arc / TILE, plen[j] / TILE); }
    }
    for (let i = 0; i < segs; i++) for (let j = 0; j < n - 1; j++) {
      const a = i * n + j, b = a + n;
      idx.push(a, a + 1, b, b, a + 1, b + 1);
    }
    let g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g = g.toNonIndexed(); g.computeVertexNormals();
    return add(g, m);
  }
  const P = [[0, -0.3], [0, PH + 1], [0.45, PH + 1], [0.45, PH], [TIER0, PH]];
  for (let k = 0; k < ROWS; k++) P.push([TIER0 + k * TREAD, PH + (k + 1) * RISE], [TIER0 + (k + 1) * TREAD, PH + (k + 1) * RISE]);
  P.push([24.5, TOP], [24.5, TOP + 6.3]);
  ring(P, stone);
  ring([[24.5, TOP + 5.4], [20.3, TOP + 5.4], [20.3, TOP + 6.3], [26.6, TOP + 6.3], [26.6, -0.6]], stone);
  ring([[26.7, TOP + 2], [27.1, TOP + 2.3], [26.7, TOP + 2.6]], marble, 120);
  ring([[26.7, 6], [27.1, 6.3], [26.7, 6.6]], marble, 120);

  // colonnade along the top gallery
  {
    const N = 96, col = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.33, 0.4, 5.4, 14), marble, N);
    const cap = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.28, 1), marble, N * 2);
    const m = new THREE.Matrix4(), v = new THREE.Vector3();
    for (let i = 0; i < N; i++) {
      const th = (i / N) * Math.PI * 2;
      at(th, 21, TOP + 2.7, v); m.makeTranslation(v.x, v.y, v.z); col.setMatrixAt(i, m);
      m.makeRotationY(-th).setPosition(v.x, TOP + 5.3, v.z); cap.setMatrixAt(i * 2, m);
      m.setPosition(v.x, TOP + 0.14, v.z); cap.setMatrixAt(i * 2 + 1, m);
    }
    col.castShadow = cap.castShadow = col.receiveShadow = true;
    scene.add(col, cap);
  }

  // ---- imperial box with throne, and the gate the king walks out of ----
  {
    const z0 = -RZ + 0.15;
    add(new THREE.BoxGeometry(10, BOX_Y + 0.3, 7.2), marbleBig, [0, (BOX_Y - 0.3) / 2, z0 - 3.6]);
    add(new THREE.BoxGeometry(10.3, 0.25, 0.5), marble, [0, BOX_Y + 0.62, z0 - 0.15]);
    for (let x = -4.8; x <= 4.81; x += 0.6) add(new THREE.CylinderGeometry(0.07, 0.1, 0.5, 8), marble, [x, BOX_Y + 0.25, z0 - 0.15]);
    for (const x of [-4.6, 4.6]) for (const z of [z0 - 0.5, z0 - 6.7]) {
      add(new THREE.CylinderGeometry(0.3, 0.36, 4.6, 16), marble, [x, BOX_Y + 2.3, z]);
      add(new THREE.BoxGeometry(0.9, 0.25, 0.9), gold, [x, BOX_Y + 4.7, z]);
    }
    add(new THREE.BoxGeometry(10.8, 0.4, 8), marbleBig, [0, BOX_Y + 5, z0 - 3.6]);
    const purple = new THREE.MeshStandardMaterial({ color: 0x4a1d6b, roughness: 0.85, side: THREE.DoubleSide });
    add(new THREE.PlaneGeometry(9.6, 4.6), purple, [0, BOX_Y + 2.4, z0 - 6.9]);
    add(new THREE.BoxGeometry(10.8, 0.9, 0.15), new THREE.MeshStandardMaterial({ color: 0x8c1616, roughness: 0.8 }), [0, BOX_Y + 4.4, z0 - 0.1]);
    // throne on a dais
    add(new THREE.BoxGeometry(3.2, 0.2, 2.6), marble, [0, BOX_Y + 0.1, THRONE.z - 0.2]);
    add(new THREE.BoxGeometry(1.15, 0.5, 0.95), gold, [0, BOX_Y + 0.45, THRONE.z - 0.35]);
    add(new THREE.BoxGeometry(1.15, 2.1, 0.18), gold, [0, BOX_Y + 1.25, THRONE.z - 0.82]);
    add(new THREE.BoxGeometry(0.95, 1.5, 0.05), purple, [0, BOX_Y + 1.35, THRONE.z - 0.72]);
    for (const x of [-0.62, 0.62]) add(new THREE.BoxGeometry(0.14, 0.85, 0.95), gold, [x, BOX_Y + 0.62, THRONE.z - 0.35]);
    add(new THREE.SphereGeometry(0.16, 16, 12), gold, [0, BOX_Y + 2.42, THRONE.z - 0.82]);
  }
  function gate(x, z, ry) {
    const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = ry; scene.add(g);
    const part = (geo, m, p) => { const o = new THREE.Mesh(geo, m); o.position.set(...p); o.castShadow = true; g.add(o); };
    part(new THREE.BoxGeometry(3, 3.2, 0.3), dark, [0, 1.6, 0]);
    for (const s of [-1.75, 1.75]) part(new THREE.BoxGeometry(0.5, 3.4, 0.5), marble, [s, 1.7, 0.1]);
    part(new THREE.BoxGeometry(4.4, 0.5, 0.6), marble, [0, 3.55, 0.1]);
  }
  gate(0, -RZ + 0.25, 0); gate(0, RZ - 0.1, Math.PI); gate(RX - 0.1, 0, -Math.PI / 2); gate(-RX + 0.1, 0, Math.PI / 2);

  // ---- banners (vertex-shader sway) ----
  {
    const c = document.createElement('canvas'); c.width = 256; c.height = 448;
    const x = c.getContext('2d');
    x.fillStyle = '#8e1414'; x.fillRect(0, 0, 256, 448);
    x.strokeStyle = '#e3b648'; x.lineWidth = 12; x.strokeRect(14, 14, 228, 420);
    x.fillStyle = '#e3b648'; x.font = '900 64px Georgia'; x.textAlign = 'center';
    x.fillText('SPQR', 128, 130);
    x.beginPath(); x.arc(128, 270, 62, 0, 7); x.lineWidth = 14; x.stroke();
    x.font = '900 70px Georgia'; x.fillText('⚔', 128, 295);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = aniso;
    const cloth = new THREE.MeshStandardMaterial({ map: t, roughness: 0.85, side: THREE.DoubleSide });
    cloth.onBeforeCompile = s => {
      s.uniforms.uTime = uTime;
      s.vertexShader = 'uniform float uTime;\n' + s.vertexShader.replace('#include <begin_vertex>',
        '#include <begin_vertex>\n transformed.z += sin(uTime * 2.2 + position.y * 2.5 + modelMatrix[3].x) * 0.07 * (1.0 - uv.y);');
    };
    const geo = new THREE.PlaneGeometry(1.5, 2.6, 4, 10);
    for (let i = 0; i < 16; i++) {
      const th = ((i + 0.5) / 16) * Math.PI * 2;
      const b = add(geo, cloth, [0, 0, 0]);
      at(th, -0.08, PH - 0.5, b.position);
      b.rotation.y = Math.atan2(-b.position.x / (RX * RX), -b.position.z / (RZ * RZ));
    }
    for (const sx of [-3.4, 3.4]) { const b = add(geo, cloth, [sx, 3.9, -RZ + 0.22]); b.scale.set(1.2, 1.5, 1); }
  }

  // ---- braziers ----
  const fires = [];
  {
    const fireTex = softTexture([[0, 'rgba(255,240,190,1)'], [0.3, 'rgba(255,150,40,.8)'], [1, 'rgba(255,60,0,0)']]);
    const bowl = new THREE.SphereGeometry(0.4, 14, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), stand = new THREE.CylinderGeometry(0.06, 0.16, 0.7, 8);
    for (let i = 0; i < 12; i++) {
      const th = (i / 12) * Math.PI * 2 + 0.26, p = at(th, 0.22, PH + 1);
      add(stand, bronze, [p.x, p.y + 0.35, p.z]);
      add(bowl, bronze, [p.x, p.y + 1.05, p.z]);
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: fireTex, blending: THREE.AdditiveBlending, depthWrite: false }));
      s.position.set(p.x, p.y + 1.35, p.z); s.layers.set(1); scene.add(s);
      const f = { s, ph: i * 1.7, l: null };
      if (i % 2 === 0) { f.l = new THREE.PointLight(0xff7b2e, 30, 18, 2); f.l.position.copy(s.position); scene.add(f.l); }
      fires.push(f);
    }
  }

  // ---- crowd: one painted strip of spectators standing on each tier. A few thousand triangles in one draw call,
  // instead of a million for individually modelled figures. They sway, and surge when the crowd is excited.
  {
    const c = document.createElement('canvas'); c.width = 2048; c.height = 256;
    const x = c.getContext('2d'), N = 22, w = c.width / N;
    const robes = ['#f1e9d6', '#e8dcc0', '#d9c7a0', '#f6f1e6', '#a33a2a', '#c98f3a', '#6f7f9a', '#8b6b4a', '#b9a27c', '#7a4a6a', '#efe6cf', '#ddd0b0'];
    const skins = ['#e9c4a0', '#d9a77c', '#b98258', '#8f5f3d', '#f2d4b5'], hairs = ['#2a1d14', '#4a3320', '#7a5a35', '#c9a56a', '#1b1410', '#8d8d8d'];
    const rnd = (() => { let s = 7; return () => (s = (s * 16807) % 2147483647) / 2147483647; })();
    for (let i = 0; i < N; i++) {
      if (rnd() < 0.07) continue;                                        // an empty seat now and then
      const cx = (i + 0.5) * w + (rnd() - 0.5) * 8, robe = robes[Math.floor(rnd() * rnd() * robes.length)], skin = skins[Math.floor(rnd() * skins.length)], top = 62 + rnd() * 22;
      x.fillStyle = robe;                                                // torso and shoulders
      x.beginPath(); x.moveTo(cx - 34, 256); x.lineTo(cx - 36, top + 78); x.quadraticCurveTo(cx - 34, top + 46, cx - 12, top + 42); x.lineTo(cx + 12, top + 42); x.quadraticCurveTo(cx + 34, top + 46, cx + 36, top + 78); x.lineTo(cx + 34, 256); x.fill();
      x.fillStyle = 'rgba(0,0,0,0.14)'; x.fillRect(cx - 4, top + 60, 8, 196); // a fold in the cloth
      if (rnd() < 0.3) { x.strokeStyle = skin; x.lineWidth = 12; x.lineCap = 'round'; const s = rnd() < 0.5 ? 1 : -1; x.beginPath(); x.moveTo(cx + s * 30, top + 60); x.lineTo(cx + s * 40, top + 6); x.stroke(); }   // an arm in the air
      x.fillStyle = skin; x.fillRect(cx - 7, top + 30, 14, 16);          // neck
      x.beginPath(); x.ellipse(cx, top + 14, 19, 23, 0, 0, 7); x.fill();
      x.fillStyle = hairs[Math.floor(rnd() * hairs.length)];
      x.beginPath(); x.ellipse(cx, top + 5, 20, 17, 0, Math.PI, 0); x.fill();
      x.fillStyle = 'rgba(0,0,0,0.25)'; x.fillRect(cx - 10, top + 14, 6, 3); x.fillRect(cx + 4, top + 14, 6, 3);
    }
    const map = new THREE.CanvasTexture(c); map.colorSpace = THREE.SRGBColorSpace; map.wrapS = THREE.RepeatWrapping; map.anisotropy = aniso;
    const HEIGHT = 1.25, SPAN = HEIGHT * c.width / c.height, SEG = 240;
    const pos = [], uv = [], nor = [], col = [], idx = [], v = new THREE.Vector3();
    for (let k = 0; k < ROWS; k++) {
      const d = TIER0 + k * TREAD + 0.5, y = PH + (k + 1) * RISE, shade = 0.82 + Math.random() * 0.18, base = pos.length / 3;
      let arc = Math.random() * SPAN;
      for (let i = 0; i <= SEG; i++) {
        const th = i / SEG * Math.PI * 2;
        if (i) arc += speed(th, d) * (Math.PI * 2 / SEG);
        at(th, d, y, v);
        const nx = -Math.cos(th), nz = -Math.sin(th);
        pos.push(v.x, y, v.z, v.x, y + HEIGHT, v.z); uv.push(arc / SPAN, 0, arc / SPAN, 1);
        const lit = (0.5 + 0.75 * Math.max(0, nx * 0.8 * sunDir.x + 0.6 * sunDir.y + nz * 0.8 * sunDir.z)) * shade;   // lighting baked in: the sunny side of the stands is brighter
        nor.push(nx * 0.8, 0.6, nz * 0.8, nx * 0.8, 0.6, nz * 0.8); col.push(lit, lit * 0.94, lit * 0.84, lit, lit * 0.94, lit * 0.84);
        const inBox = v.z < 0 && Math.abs(v.x) < 6.3 && d < 9;
        if (i < SEG && !inBox) { const a = base + i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setIndex(idx);
    // unlit on purpose: these strips overlap many layers deep, so per-pixel lighting on them cost more than the old 3D crowd
    const m = new THREE.MeshBasicMaterial({ map, alphaTest: 0.5, side: THREE.DoubleSide, vertexColors: true });
    m.onBeforeCompile = s => {
      s.uniforms.uTime = uTime; s.uniforms.uExcite = uExcite;
      s.vertexShader = 'uniform float uTime; uniform float uExcite;\n' + s.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
        float ph = position.x * 0.9 + position.z * 1.3 + position.y * 2.0;
        transformed.y += uv.y * (0.015 + uExcite * 0.16) * max(0.0, sin(uTime * (5.0 + uExcite * 3.0) + ph));
        transformed.x += uv.y * 0.02 * sin(uTime * 1.3 + ph * 0.7);`);
    };
    const crowd = new THREE.Mesh(geo, m);
    crowd.receiveShadow = true; crowd.frustumCulled = false;
    scene.add(crowd);
  }

  // ---- atmosphere: dust motes and light shafts ----
  const soft = softTexture([[0, 'rgba(255,255,255,1)'], [1, 'rgba(255,255,255,0)']]);
  const motes = (() => {
    const n = 900, a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { const r = Math.sqrt(Math.random()), th = Math.random() * 7; a.set([r * RX * Math.cos(th), 0.3 + Math.random() * 16, r * RZ * Math.sin(th)], i * 3); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(a, 3));
    const p = new THREE.Points(g, new THREE.PointsMaterial({ map: soft, size: 0.12, color: 0xffe2b0, transparent: true, opacity: 0.45, depthWrite: false, blending: THREE.AdditiveBlending }));
    p.layers.set(1); scene.add(p); return p;
  })();
  {
    const c = document.createElement('canvas'); c.width = 64; c.height = 4;
    const x = c.getContext('2d'), g = x.createLinearGradient(0, 0, 64, 0);
    g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.5, 'rgba(255,255,255,1)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g; x.fillRect(0, 0, 64, 4);
    const m = new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), color: 0xffd9a0, transparent: true, opacity: 0.028, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
    const side = new THREE.Vector3().crossVectors(sunDir, new THREE.Vector3(0, 1, 0)).normalize(), q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), sunDir);
    for (let i = 0; i < 7; i++) for (const r of [0, 1.2]) {
      const s = new THREE.Mesh(new THREE.PlaneGeometry(5 + (i % 3) * 3, 90), m);
      s.quaternion.copy(q).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), r + i));
      s.position.copy(sunDir).multiplyScalar(30).addScaledVector(side, (i - 3) * 8.5); s.layers.set(1);
      scene.add(s);
    }
  }

  // ---- pooled particles ----
  const parts = [];
  function particle(kind) {
    let p = parts.find(o => o.life <= 0 && o.kind === kind);
    if (!p) {
      if (parts.length > 260) return null;
      const m = new THREE.SpriteMaterial({ map: soft, depthWrite: false, transparent: true });
      if (kind === 'spark') { m.blending = THREE.AdditiveBlending; m.color.set(0xffc866); } else m.color.set(kind === 'blood' ? 0x6a0a07 : 0xc9ad84);
      p = { s: new THREE.Sprite(m), kind, life: 0, v: new THREE.Vector3() };
      p.s.layers.set(1); scene.add(p.s); parts.push(p);
    }
    p.s.visible = true;
    return p;
  }
  function puff(pos, n = 6, size = 0.5, y = 0.15) {
    for (let i = 0; i < n; i++) {
      const p = particle('dust'); if (!p) return;
      p.s.position.set(pos.x + (Math.random() - 0.5) * 0.4, y + Math.random() * 0.2, pos.z + (Math.random() - 0.5) * 0.4);
      p.v.set((Math.random() - 0.5) * 1.6, 0.4 + Math.random() * 0.9, (Math.random() - 0.5) * 1.6);
      p.max = p.life = 0.7 + Math.random() * 0.6; p.size = size * (0.6 + Math.random() * 0.8); p.grav = -0.4;
    }
  }
  // a single bright burst at a point of impact: there for a blink, swelling as it fades
  function flash(pos, size = 0.55) {
    const p = particle('spark'); if (!p) return;
    p.s.position.set(pos.x, pos.y, pos.z); p.v.set(0, 0, 0);
    p.max = p.life = 0.11; p.size = size; p.grav = 0; p.burst = true;
  }
  // blood thrown along the line of the blow; the drops fall and lie on the sand until they fade
  function blood(pos, dx, dz, n = 5) {
    for (let i = 0; i < n; i++) {
      const p = particle('blood'); if (!p) return;
      p.s.position.set(pos.x, pos.y, pos.z);
      p.v.set(dx * (1 + Math.random() * 2.5) + (Math.random() - 0.5) * 1.6, 0.4 + Math.random() * 2, dz * (1 + Math.random() * 2.5) + (Math.random() - 0.5) * 1.6);
      p.max = p.life = 1.2 + Math.random() * 0.8; p.size = 0.05 + Math.random() * 0.06; p.grav = -9; p.burst = false;
    }
  }
  function spark(pos, n = 8) {
    for (let i = 0; i < n; i++) {
      const p = particle('spark'); if (!p) return;
      p.s.position.set(pos.x, pos.y, pos.z);
      p.v.set((Math.random() - 0.5) * 6, Math.random() * 4, (Math.random() - 0.5) * 6);
      p.max = p.life = 0.25 + Math.random() * 0.3; p.size = 0.09; p.grav = -9; p.burst = false;
    }
  }

  // floating comic text ("BONK!", "BANNED")
  const texts = [];
  function text(str, pos, color = '#ffe08a') {
    // one call-out at a time per spot: a second word on top of a fresh one is just noise
    if (texts.some(o => o.life > 0.55 && Math.abs(o.s.position.x - pos.x) + Math.abs(o.s.position.z - pos.z) < 2.2)) return;
    let t = texts.find(o => o.life <= 0);
    if (!t) {
      if (texts.length >= 6) return;
      const c = document.createElement('canvas'); c.width = 512; c.height = 128;
      const tx = new THREE.CanvasTexture(c); tx.colorSpace = THREE.SRGBColorSpace;
      t = { c, tx, s: new THREE.Sprite(new THREE.SpriteMaterial({ map: tx, depthTest: false, transparent: true })), life: 0 };
      t.s.renderOrder = 10; t.s.layers.set(1); scene.add(t.s); texts.push(t);
    }
    const x = t.c.getContext('2d');
    x.clearRect(0, 0, 512, 128);
    x.font = '900 84px Impact, Arial Black, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.lineWidth = 12; x.strokeStyle = '#1a0f05'; x.strokeText(str, 256, 66, 490);
    x.fillStyle = color; x.fillText(str, 256, 66, 490);
    t.tx.needsUpdate = true;
    t.s.position.set(pos.x, 2.3, pos.z); t.s.visible = true; t.life = 1.1;
  }

  // confetti
  const CN = 900, conf = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.13, 0.08), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }), CN);
  const cp = new Float32Array(CN * 7); let confOn = false;
  conf.visible = false; conf.frustumCulled = false; scene.add(conf);
  function confetti(pos) {
    const c = new THREE.Color(), cols = [0xffd54d, 0xff4d6d, 0x5865f2, 0x4dd6a8, 0xffffff, 0xff9f43];
    for (let i = 0; i < CN; i++) {
      cp.set([pos.x + (Math.random() - 0.5) * 16, 6 + Math.random() * 12, pos.z + (Math.random() - 0.5) * 16, Math.random() * 6, Math.random() * 6, 1 + Math.random() * 1.5, Math.random() * 6], i * 7);
      conf.setColorAt(i, c.setHex(cols[i % cols.length]));
    }
    conf.instanceColor.needsUpdate = true; conf.visible = confOn = true;
  }

  const m4 = new THREE.Matrix4(), eu = new THREE.Euler(), qq = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1), vv = new THREE.Vector3();
  function update(dt, t) {
    uTime.value = t;
    uExcite.value += (0 - uExcite.value) * Math.min(1, dt * 0.7);
    motes.rotation.y = t * 0.012; motes.position.y = Math.sin(t * 0.2) * 0.4;
    for (const f of fires) {
      const k = 0.8 + 0.2 * Math.sin(t * 13 + f.ph) + 0.15 * Math.sin(t * 7.3 + f.ph * 2);
      f.s.scale.set(1.1 * k, 1.5 * k, 1);
      if (f.l) f.l.intensity = 30 * k;
    }
    for (const p of parts) {
      if (p.life <= 0) continue;
      p.life -= dt;
      if (p.life <= 0) { p.s.visible = false; continue; }
      const a = p.life / p.max;
      p.v.y += p.grav * dt; p.s.position.addScaledVector(p.v, dt);
      if (p.kind === 'blood' && p.s.position.y < 0.03) { p.s.position.y = 0.03; p.v.set(0, 0, 0); p.grav = 0; }
      if (p.kind === 'dust') { p.s.material.opacity = a * 0.45; p.s.scale.setScalar(p.size * (2 - a)); }
      else { p.s.material.opacity = a; p.s.scale.setScalar(p.burst ? p.size * (1.6 - 0.6 * a) : p.size); }
    }
    for (const x of texts) {
      if (x.life <= 0) continue;
      x.life -= dt; x.s.position.y += dt * 0.9;
      x.s.material.opacity = Math.min(1, x.life * 2.5);
      const s = 0.6 * (1 + Math.max(0, x.life - 0.95) * 4); x.s.scale.set(s * 2, s * 0.5, 1);
      if (x.life <= 0) x.s.visible = false;
    }
    if (confOn) {
      for (let i = 0; i < CN; i++) {
        const o = i * 7;
        cp[o + 1] -= cp[o + 5] * dt; if (cp[o + 1] < 0.03) { cp[o + 1] = 0.03; } else { cp[o + 3] += dt * 5; cp[o + 4] += dt * 3; cp[o] += Math.sin(t * 2 + cp[o + 6]) * dt * 0.6; }
        m4.compose(vv.set(cp[o], cp[o + 1], cp[o + 2]), qq.setFromEuler(eu.set(cp[o + 3], cp[o + 4], 0)), one);
        conf.setMatrixAt(i, m4);
      }
      conf.instanceMatrix.needsUpdate = true;
    }
  }

  return { scene, sun, sunDir, update, puff, spark, blood, flash, text, confetti, excite: v => { uExcite.value = Math.max(uExcite.value, v); } };
}
