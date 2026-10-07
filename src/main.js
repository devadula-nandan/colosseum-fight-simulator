// Entry point: admin screen / link handling, clock sync, render loop, cameras, HUD, ceremony.
import * as THREE from 'three';
import RAPIER from 'rapier';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { BokehPass } from 'three/addons/postprocessing/BokehPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { createSim, DT, RX, RZ } from './sim.js';
import { WEAPON_BY_ID } from './weapons.js';
import { createWorld, THRONE, GATE, BOX_Y } from './world.js';
import { loadCharacters } from './fighters.js';
import { makeWeapon, makeChest, makeArrow, WEAPON_BOX, WEAPON_LEN, WEAPON_OFFHAND, WEAPON_CARRY } from './props.js';
import { createAudio } from './audio.js';

const $ = id => document.getElementById(id);
const MAX_PLAYERS = 150, MAX_NAME = 24;

// ---------------------------------------------------------------- link format
const b64 = {
  enc: o => btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(o)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
  dec: s => JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0)))),
};
function readLink() {
  const h = new URLSearchParams(location.hash.slice(1));
  if (!h.get('g')) return null;
  try {
    const c = b64.dec(h.get('g'));
    const names = [...new Set(c.n.map(s => String(s).trim().slice(0, MAX_NAME)).filter(Boolean))].slice(0, MAX_PLAYERS);
    if (names.length < 2 || !Number.isFinite(c.s) || !Number.isFinite(c.t)) return null;
    return {
      players: names.map((name, i) => ({ name, g: 'mfr'.includes(c.x?.[i]) ? c.x[i] : 'r' })),
      seed: c.s >>> 0, start: c.t, prize: String(c.p ?? '').slice(0, 60),
      me: (h.get('me') || '').trim().toLowerCase(), q: h.get('q'),
    };
  } catch { return null; }
}

// ---------------------------------------------------------------- admin screen
function admin() {
  $('admin').hidden = false;
  const gender = new Map();
  let list = [];
  const parse = () => {
    const seen = new Set(); list = [];
    for (const line of $('names').value.split('\n')) {
      const m = line.match(/^(.*?)(?:\s*,\s*([mfMF]))?\s*$/);
      const name = m[1].trim().slice(0, MAX_NAME), key = name.toLowerCase();
      if (!name || seen.has(key) || list.length >= MAX_PLAYERS) continue;
      seen.add(key);
      if (m[2]) gender.set(key, m[2].toLowerCase());
      list.push(name);
    }
    const roster = $('roster'); roster.replaceChildren();
    for (const name of list) {
      const row = document.createElement('div'), label = document.createElement('span');
      row.className = 'p'; label.textContent = name; row.append(label);
      for (const [g, t] of [['m', 'Male'], ['f', 'Female'], ['r', 'Random']]) {
        const b = document.createElement('button');
        b.textContent = t; b.type = 'button';
        b.setAttribute('aria-pressed', (gender.get(name.toLowerCase()) || 'r') === g);
        b.onclick = () => { gender.set(name.toLowerCase(), g); parse(); };
        row.append(b);
      }
      roster.append(row);
    }
    $('create').disabled = list.length < 2;
    $('create').textContent = list.length < 2 ? 'Add at least 2 participants' : `Create giveaway link (${list.length} fighters)`;
  };
  $('names').oninput = parse; parse();
  $('create').onclick = () => {
    const cfg = { v: 1, n: list, x: list.map(n => gender.get(n.toLowerCase()) || 'r').join(''), p: $('prize').value.trim(),
      s: crypto.getRandomValues(new Uint32Array(1))[0], t: Date.now() + $('delay').value * 1000 };
    const url = location.origin + location.pathname + '#g=' + b64.enc(cfg);
    $('link').value = url; $('open').href = url; $('linkbox').hidden = false;
    $('linkbox').scrollIntoView({ behavior: 'smooth' });
  };
  $('copy').onclick = async () => {
    try { await navigator.clipboard.writeText($('link').value); } catch { $('link').select(); document.execCommand('copy'); }
    $('copy').textContent = 'Copied';
  };
}
addEventListener('hashchange', () => location.reload());

// ---------------------------------------------------------------- the show
// Swings by target height: [low (legs), mid (body), high (head and shoulders)]
// Which clip is played for a swing of each style at each height [low, mid, high], and the torso pitch added on top.
// Chosen by measuring every clip: where its weapon tip reaches furthest forward (CONTACT, as a fraction of the clip)
// and how high the tip is at that moment. Sword_Dash is a low lunge (tip at 0.7 m), Sword_Regular_A a body-height
// one (0.92 m), Sword_Attack comes down from head height (1.32 m), Sword_Dash is a low lunge, Melee_Hook lands on the
// body and Punch_Cross on the head. The lean then moves the tip the rest of the way to legs / body / head.
const SWING = {
  blade: ['Sword_Dash', 'Sword_Regular_A', 'Sword_Attack'],
  sweep: ['Sword_Dash', 'Sword_Regular_A', 'Sword_Attack'],
  light: ['Sword_Dash', 'Sword_Regular_A', 'Sword_Attack'],
  heavy: ['Sword_Dash', 'Sword_Regular_A', 'Sword_Attack'],
  thrust: ['Sword_Dash', 'Sword_Dash', 'Sword_Attack'],
  fists: ['Punch_Cross', 'Punch_Cross', 'Punch_Cross'],      // one straight punch, aimed by the torso: gut, chest or head
  thrown: ['OverhandThrow', 'OverhandThrow', 'OverhandThrow'],
};
const CONTACT = { Sword_Regular_A: 0.575, Sword_Regular_B: 0.475, Sword_Attack: 0.275, Sword_Dash: 0.2, Melee_Hook: 0.55, Punch_Cross: 0.275, OverhandThrow: 0.3 };
const LEANS = {
  blade: [0.2, -0.15, 0], sweep: [0.2, -0.15, 0], light: [0.2, -0.15, 0], heavy: [0.2, -0.15, 0],
  thrust: [0.2, -0.3, 0], fists: [0.65, 0.25, -0.1], thrown: [0, 0, 0],
};
const HIT_Y = [0.45, 1.15, 1.62];
const HIT_SOUND = { fists: 'punch', dagger: 'metal', sword: 'metal', longsword: 'metalHeavy', mace: 'metalHeavy', axe: 'metalHeavy', hammer: 'metalHeavy', spear: 'metal', trident: 'metal', javelin: 'wood', bow: 'wood', crossbow: 'wood' };
const SPARKY = new Set(['dagger', 'sword', 'longsword', 'mace', 'axe', 'hammer', 'spear', 'trident']);
const pick = a => a[Math.floor(Math.random() * a.length)];
const lerpAngle = (a, b, t) => a + (((b - a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI) * t;
const damp = (k, dt) => 1 - Math.exp(-k * dt);

async function show(cfg) {
  $('loading').hidden = false;
  const manager = new THREE.LoadingManager();
  manager.onProgress = (url, done, total) => { $('loadbar').style.width = (done / total * 100) + '%'; $('loadmsg').textContent = `Loading ${done} / ${total}`; };

  const canvas = $('view');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 0.95;
  const camera = new THREE.PerspectiveCamera(48, 1, 0.15, 1200);

  await RAPIER.init();
  const physics = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  physics.createCollider(RAPIER.ColliderDesc.cuboid(200, 0.5, 200).setTranslation(0, -0.5, 0).setFriction(1));
  for (let i = 0; i < 48; i++) {                        // podium wall, so bodies and weapons bounce off it
    const th = i / 48 * Math.PI * 2, c = Math.cos(th), s = Math.sin(th);
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(c / RX, s / RZ));
    physics.createCollider(RAPIER.ColliderDesc.cuboid(2.6, 4, 0.7).setTranslation((RX + 0.7) * c, 2, (RZ + 0.7) * s).setRotation(q));
  }

  const audio = createAudio();
  const [world, { Char, STYLES }] = await Promise.all([createWorld(manager, renderer), loadCharacters(manager, RAPIER, physics), audio.load]);
  const { scene } = world;

  // ---- post-processing with three quality tiers ----
  const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 }));
  const gtao = new GTAOPass(scene, camera, 1, 1);
  gtao.updateGtaoMaterial({ radius: 0.5, distanceExponent: 1.2, thickness: 1, scale: 1.1, samples: 12 });
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.22, 0.6, 0.95);
  const bokeh = new BokehPass(scene, camera, { focus: 6, aperture: 0.00009, maxblur: 0.005 });
  const grade = new ShaderPass({
    uniforms: { tDiffuse: { value: null }, uTime: { value: 0 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform sampler2D tDiffuse; uniform float uTime; varying vec2 vUv;
      void main(){
        vec4 c = texture2D(tDiffuse, vUv);
        float l = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
        c.rgb = mix(vec3(l), c.rgb, 1.1);
        c.rgb *= mix(vec3(0.93, 0.98, 1.07), vec3(1.07, 1.0, 0.92), smoothstep(0.0, 0.9, l));
        vec2 d = vUv - 0.5; c.rgb *= 1.0 - dot(d, d) * 0.85;
        float n = fract(sin(dot(vUv * vec2(1920.0, 1080.0) + uTime * 61.0, vec2(12.9898, 78.233))) * 43758.5453);
        c.rgb += (n - 0.5) * 0.035 * (l + 0.04);
        gl_FragColor = c;
      }`,
  });
  composer.addPass(new RenderPass(scene, camera));
  for (const p of [gtao, bloom, bokeh, grade, new OutputPass()]) composer.addPass(p);
  // sprites and other see-through things must not land in the depth/normal pre-passes
  // (they all live on layer 1)
  camera.layers.enable(1);
  for (const pass of [gtao, bokeh]) {
    const render = pass.render.bind(pass);
    pass.render = (...a) => { camera.layers.disable(1); render(...a); camera.layers.enable(1); };
  }
  // integrated and mobile GPUs can't afford ambient occlusion + depth of field; start them a tier down
  const gl = renderer.getContext(), dbg = gl.getExtension('WEBGL_debug_renderer_info');
  const weak = /Intel|Iris|UHD|Mali|Adreno|PowerVR|SwiftShader|llvmpipe/i.test(dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : '') || matchMedia('(pointer: coarse)').matches;
  let quality = cfg.q != null ? +cfg.q : weak ? 1 : 2;
  function applyQuality() {
    gtao.enabled = bokeh.enabled = quality >= 2;
    bloom.enabled = quality >= 1;
    const sm = quality >= 2 ? 4096 : 2048;
    if (world.sun.shadow.mapSize.x !== sm) { world.sun.shadow.mapSize.set(sm, sm); world.sun.shadow.map?.dispose(); world.sun.shadow.map = null; }
    renderer.setPixelRatio(Math.min(devicePixelRatio, quality >= 2 ? 1.5 : quality === 1 ? 1.25 : 1));
    resize();
  }
  function resize() {
    const w = innerWidth, h = innerHeight;
    renderer.setSize(w, h, false); composer.setSize(w, h);
    camera.aspect = w / h; camera.fov = w < h ? 62 : 48; camera.updateProjectionMatrix();
  }
  addEventListener('resize', resize); applyQuality();

  // ---- simulation + its visuals ----
  let S = createSim(cfg.players, cfg.seed);
  const N = S.fighters.length;
  const probe = createSim(cfg.players, cfg.seed);
  while (!probe.winner && probe.t < 1800) { probe.step(); probe.events.length = 0; }
  const isReplay = Date.now() > cfg.start + probe.t * 1000 + 60000;   // long finished: play it back from the top
  let t0 = isReplay ? Date.now() + 6000 : cfg.start;

  const chars = S.fighters.map((f, i) => {
    const color = new THREE.Color().setHSL((i * 0.618034) % 1, 0.72, 0.42);
    const c = new Char({ g: f.g, name: f.name, color, seed: (i * 0.3719 + cfg.seed / 4294967296) % 1 });
    c.root.position.set(f.x, 0, f.z); c.yaw = c.root.rotation.y = Math.atan2(f.fx, f.fz);
    c.setBase('Idle_Loop'); c.hp = 100; c.stepT = 0;
    c.mixer.update(Math.random() * 2);
    scene.add(c.root);
    // a moving capsule in the physics world, so falling bodies and dropped weapons bounce off the living
    c.col = physics.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(f.x, 0, f.z));
    physics.createCollider(RAPIER.ColliderDesc.capsule(0.55, 0.32).setTranslation(0, 0.9, 0).setCollisionGroups(0x00080006), c.col);
    return c;
  });
  // A weapon lying on the sand glows all over: its materials are swapped for emissive twins that pulse together
  // (bloom turns that into a halo), and swapped back the moment someone picks it up.
  const glowTwins = new Map();
  const twin = m => { if (!glowTwins.has(m)) { const g = m.clone(); g.emissive = new THREE.Color(0xffb23a); g.emissiveIntensity = 1; glowTwins.set(m, g); } return glowTwins.get(m); };
  function setGlow(v, on) {
    if (v.glow === on) return;
    v.glow = on;
    v.mesh.traverse(o => { if (!o.isMesh) return; o.userData.plain ??= o.material; o.material = on ? twin(o.userData.plain) : o.userData.plain; });
  }
  const items = S.items.map(it => {
    const v = { mesh: makeWeapon(it.wid), glow: false, body: null, fly: null, held: null, t: 0 };
    return v;
  });
  function itemGround(i, x, z, keepPose) {
    const v = items[i];
    if (v.body) { physics.removeRigidBody(v.body); v.body = null; }
    scene.attach(v.mesh); v.held = null;
    if (!keepPose) { v.mesh.position.set(x, 0.07, z); v.mesh.rotation.set(0, i * 2.4, Math.PI / 2); }
    setGlow(v, true);
  }
  function itemHold(i, c) {
    const v = items[i];
    if (v.body) { physics.removeRigidBody(v.body); v.body = null; }
    v.air = false; v.held = c; setGlow(v, false);
    c.grip.add(v.mesh); v.mesh.position.set(0, 0, 0); v.mesh.rotation.set(0, 0, 0);
  }
  function itemTumble(i) {                               // falls out of a dead hand as a physics object
    const v = items[i], it = S.items[i], b = WEAPON_BOX[it.wid];
    scene.attach(v.mesh); v.held = null;
    const p = v.mesh.position, q = v.mesh.quaternion;
    v.body = physics.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(p.x, Math.max(p.y, 0.3), p.z).setRotation(q)
      .setLinvel((Math.random() - 0.5) * 3, 2.5, (Math.random() - 0.5) * 3).setAngvel({ x: Math.random() * 8 - 4, y: Math.random() * 8 - 4, z: Math.random() * 8 - 4 }).setAngularDamping(0.8));
    physics.createCollider(RAPIER.ColliderDesc.cuboid(b[0], b[1], b[2]).setTranslation(0, b[1] * 0.8, 0).setCollisionGroups(0x00040009).setFriction(0.9).setRestitution(0.25), v.body);
    v.t = 0;
  }
  const TRAIL_N = 9, trails = [];
  const trailMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { uFade: { value: 1 } },
    vertexShader: 'attribute float age; varying float vAge; varying float vEdge; void main(){ vAge = age; vEdge = uv.y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'varying float vAge; varying float vEdge; void main(){ float a = (1.0 - vAge) * (1.0 - vAge) * smoothstep(0.0, 0.35, vEdge); gl_FragColor = vec4(vec3(1.0, 0.93, 0.8) * a * 0.55, a * 0.55); }',
  });
  function trailFor(c) {                                   // one ribbon per fighter, made the first time they swing a weapon
    if (c.trail) return c.trail;
    if (trails.length >= 40) return null;
    const geo = new THREE.BufferGeometry(), n = TRAIL_N * 2;
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    geo.setAttribute('age', new THREE.BufferAttribute(new Float32Array(n), 1));
    geo.setAttribute('uv', new THREE.BufferAttribute(Float32Array.from({ length: n * 2 }, (_, i) => i % 2 ? (Math.floor(i / 2) % 2) : 0), 2));
    const idx = []; for (let i = 0; i < TRAIL_N - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    geo.setIndex(idx);
    const mesh = new THREE.Mesh(geo, trailMat); mesh.frustumCulled = false; mesh.layers.set(1); mesh.visible = false; scene.add(mesh);
    c.trail = { mesh, pts: [], live: 0 }; trails.push(c.trail);
    return c.trail;
  }
  const tipP = new THREE.Vector3(), midP = new THREE.Vector3(), tipD = new THREE.Vector3();
  const aimP = new THREE.Vector3(), aimD = new THREE.Vector3(), aimUp = new THREE.Vector3(0, 1, 0), aimFwd = new THREE.Vector3(1, 0, 0), aimQ = new THREE.Quaternion(), aimQ2 = new THREE.Quaternion();
  const arrows = new Map(), spent = [];                 // arrows in flight (by shot id) and ones stuck in the sand
  // rebuild every visual straight from sim state (start, and after a silent fast-forward)
  function syncAll() {
    S.fighters.forEach((f, i) => {
      const c = chars[i];
      c.root.position.set(f.x, 0, f.z);
      if (!f.alive && !c.dead) { c.root.rotation.y = c.yaw; c.pose('Death01'); }
      if (!f.alive && c.col) { physics.removeRigidBody(c.col); c.col = null; }
      if (c.hp !== Math.ceil(f.hp)) { c.hp = Math.ceil(f.hp); c.tag.draw(c.hp); }
    });
    S.items.forEach((it, i) => {
      items[i].mesh.scale.y = it.broken ? 0.55 : 1;
      if (it.holder) itemHold(i, chars[it.holder.id]); else itemGround(i, it.x, it.z);
      items[i].air = it.air;
    });
  }
  syncAll();

  // ---- king, throne-side prize ----
  const king = new Char({ g: 'm', color: 0x5b2a86, king: true, seed: 0.31 });
  king.root.scale.setScalar(1.15); king.root.position.set(THRONE.x, THRONE.y, THRONE.z - 0.25);
  king.setBase('Sitting_Idle_Loop'); scene.add(king.root);
  const chest = makeChest();
  chest.position.set(1.45, BOX_Y + 0.2, THRONE.z - 0.2); chest.scale.setScalar(1.25); scene.add(chest);

  // ---- HUD ----
  $('loading').hidden = true; $('hud').hidden = false;
  $('hprize').textContent = cfg.prize ? '🏆 ' + cfg.prize : '🏆 Giveaway';
  $('credit').textContent = 'Music: “Battle Theme A” by cynicmusic (CC0) · Models: Quaternius (CC0) · Textures: Poly Haven (CC0)';
  const setText = (el, s) => { if (el.textContent !== s) el.textContent = s; };
  const order = S.fighters.map(f => f.id).sort((a, b) => S.fighters[a].name.localeCompare(S.fighters[b].name));
  let spec = Math.max(0, S.fighters.findIndex(f => f.name.toLowerCase() === cfg.me));
  let picked = !!cfg.me && S.fighters[spec].name.toLowerCase() === cfg.me, pending = null, note = '';
  if (!picked) spec = order[0];
  function cycle(dir) {
    picked = true; pending = null; note = '';
    let k = order.indexOf(spec);
    for (let n = 0; n < N; n++) { k = (k + dir + N) % N; if (S.fighters[order[k]].alive) break; }
    spec = order[k]; camSnap = 0.25;
  }
  $('prev').onclick = () => cycle(-1); $('next').onclick = () => cycle(1);
  addEventListener('keydown', e => { if (phase !== 'ceremony') { if (e.key === 'ArrowLeft') $('prev').click(); if (e.key === 'ArrowRight') $('next').click(); } });
  $('sound').onclick = () => { audio.setMuted(!audio.muted); $('sound').textContent = audio.muted ? '🔇' : '🔊'; };
  function feed(killer, victim, weapon, banned) {
    const d = document.createElement('div'), a = document.createElement('b'), b = document.createElement('b');
    a.textContent = killer; b.textContent = victim;
    d.append(a, banned ? ' BANNED ' : ` ⚔ `, b, ` · ${weapon}`);
    $('feed').append(d);
    while ($('feed').children.length > 6) $('feed').firstChild.remove();
    setTimeout(() => d.remove(), 7000);
  }

  // ---- events from the sim ----
  const P = (f, y = 1.2) => ({ x: f.x, y, z: f.z });
  // comic text only pops near whoever you are watching, so a 100-fighter brawl does not turn into a wall of words
  const near = f => { const s = S.fighters[spec]; return (f.x - s.x) ** 2 + (f.z - s.z) ** 2 < 150; };
  let shake = 0;
  // seconds by which each swing's clip is made to land early [low, mid, high]: measured as the gap between the frame
  // the sim registers a hit and the frame the blade is nearest the body, so the two coincide
  const OFFHAND = Object.fromEntries(Object.entries(WEAPON_OFFHAND).map(([k, v]) => [k, new THREE.Vector3(...v)]));
  const CARRY = Object.fromEntries(Object.entries(WEAPON_CARRY).map(([k, c]) => {
    const a = new THREE.Vector3(...c.dir).normalize(), b = new THREE.Vector3(...c.edge);
    b.addScaledVector(a, -b.dot(a)).normalize();
    const x = c.long ? b : a, y = c.long ? a : b, z = new THREE.Vector3().crossVectors(x, y);
    return [k, { pos: new THREE.Vector3(...c.hand), quat: new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z)) }];
  }));
  const LEAD = { blade: [-0.02, 0, 0.02], light: [0, 0, 0.045], heavy: [0, 0.02, 0.015], thrust: [0, 0, 0.035] };
  function handle(e) {
    const F = S.fighters;
    if (e.type === 'attack') {
      chars[e.id].aimAt = null;
      if (e.style === 'bow' || e.style === 'crossbow') {            // level it and hold the aim through the draw; the release is the 'shoot' event
        const c = chars[e.id], d = c._act('Pistol_Aim_Neutral').getClip().duration;
        c.oneShot('Pistol_Aim_Neutral', d / (e.wind + 0.5), 0.15, 0); c.swinging = true;
        audio.play('draw', P(F[e.id]), 0.4, e.style === 'bow' ? 0.7 : 1.2);
        return;
      }
      const clip = SWING[e.style][e.h], c = chars[e.id];
      c.aimAt = null;
      // time-scaled so the clip's contact frame lands in the middle of the sim's strike window (about 1x by construction),
      // a touch early: the victim is already being driven back by the time a late blade would arrive (measured; heavy swings most)
      c.oneShot(clip, Math.max(0.6, Math.min(1.7, c._act(clip).getClip().duration * CONTACT[clip] / (e.wind + e.act * 0.3 - (LEAD[e.style]?.[e.h] || 0)))), 0.08, LEANS[e.style][e.h]);
      c.swinging = true;
      audio.play('swish', P(F[e.id]), 0.35, e.style === 'heavy' ? 0.6 : 1);
    } else if (e.type === 'hit') {
      const v = F[e.b], c = chars[e.b], p = { x: e.x, y: HIT_Y[e.h], z: e.z };      // the sim's actual contact point
      chars[e.a].aimAt = e.b;                                // the blade is steered onto whoever it actually caught, even a bystander
      if (v.alive) {
        // reaction matches where the blow landed: head snaps back, body recoils, legs buckle forward
        // every blow rocks the body along the direction it travelled; a knockdown goes fully limp until they get up
        c.impulse(e.dx, e.dz, Math.min(9, 2.5 + WEAPON_BY_ID[e.wid].kb * 0.5) * (e.crit ? 1.4 : 1), e.h);
        if (e.slipped) c.ragdoll({ x: v.vx, y: 0, z: v.vz }, { x: e.dx * 2, y: 0.6, z: e.dz * 2 }, true);
        else { c.oneShot(e.h === 2 ? 'Hit_Head' : 'Hit_Chest', e.h === 0 ? 0.8 : 1, 0.04); c.swinging = false; }    // always react: the sim has stopped whatever they were doing
      }
      c.freeze = chars[e.a].freeze = e.crit ? 0.13 : 0.07;
      world.flash(p, e.crit ? 0.95 : 0.5); c.flash = e.crit ? 1 : 0.7;        // a burst where it landed, and the victim flares for an instant
      world.puff(p, e.crit ? 6 : 3, 0.35, HIT_Y[e.h] - 0.15);
      if (e.wid !== 'fists') world.blood(p, e.dx, e.dz, e.crit ? 10 : 5);
      if (SPARKY.has(e.wid)) world.spark(p, e.crit ? 16 : 6);
      audio.play(HIT_SOUND[e.wid], p, e.crit ? 1 : 0.7);
      if (e.wid === 'hammer' || e.wid === 'mace') audio.play('punchHeavy', p, 0.8);
      const word = e.crit ? (e.h === 2 ? 'HEADSHOT!' : 'CRIT!') : e.slipped ? 'KNOCKDOWN!' : e.back && (e.wid === 'dagger' || Math.random() < 0.4) ? 'BACKSTAB!' : '';
      if (word && near(v)) world.text(word, p, e.crit ? '#ff6b4a' : '#ffe08a');
      if (e.a === spec || e.b === spec) shake = Math.max(shake, e.crit ? 0.5 : 0.22);
    } else if (e.type === 'dodge') {
      const c = chars[e.b], p = P(F[e.b]);
      c.cancel(); c.dodgeClip = ['Jump_Start', 'Roll', 'Crouch_Idle_Loop'][e.h];
      if (e.h !== 2) world.puff(p, 4, 0.4, 0.1);                 // kicked-up sand from a roll or a hop
      audio.play('cloth', p, 0.8);
      if (e.b === spec || e.a === spec || Math.random() < 0.35) world.text(pick(['DODGE!', 'MISSED!', 'NOPE', 'TOO SLOW']), p, '#b8f5c5');
    } else if (e.type === 'clash') {                       // weapon met weapon or a raised guard
      const p = { x: e.x, y: HIT_Y[e.h], z: e.z };
      world.spark(p, 18); if (near(F[e.b])) world.text('CLANG!', p, '#cfe6ff');
      audio.play('plate', p, 1); audio.play('metal', p, 0.8);
      chars[e.a].oneShot('Hit_Chest', 1, 0.04);
      { const a = F[e.a], b = F[e.b], d = Math.hypot(a.x - b.x, a.z - b.z) || 1; chars[e.a].impulse((a.x - b.x) / d, (a.z - b.z) / d, 5); chars[e.b].impulse((b.x - a.x) / d, (b.z - a.z) / d, 2.5); }
      chars[e.a].freeze = chars[e.b].freeze = 0.1;
      if (e.a === spec || e.b === spec) shake = Math.max(shake, 0.3);
    } else if (e.type === 'shield') {                      // caught on the shield
      const p = { x: e.x, y: HIT_Y[e.h], z: e.z }, b = F[e.b], a = F[e.a], d = Math.hypot(a.x - b.x, a.z - b.z) || 1;
      world.spark(p, e.missile ? 6 : 12); world.puff(p, 2, 0.3, p.y);
      audio.play('wood', p, 1); audio.play('plate', p, 0.5);
      if (near(b) && Math.random() < 0.6) world.text('BLOCKED!', p, '#cfe6ff');
      chars[e.b].oneShot('Shield_OneShot', 1.5, 0.05); chars[e.b].impulse((b.x - a.x) / d, (b.z - a.z) / d, 3);
      if (!e.missile) {                                   // the blow stops dead on the shield and the attacker rebounds off it
        chars[e.a].oneShot('Hit_Chest', 1.2, 0.05); chars[e.a].swinging = false;
        chars[e.a].impulse((a.x - b.x) / d, (a.z - b.z) / d, 4.5); chars[e.a].freeze = chars[e.b].freeze = 0.08;
      }
      world.flash(p, 0.45);
      if (e.missile && chars[e.b].shield && spent.length < 60) {      // the arrow stays in the board, quivering no more
        const a = makeArrow(); a.rotation.set(Math.PI / 2 + (Math.random() - 0.5) * 0.5, 0, (Math.random() - 0.5) * 0.5);
        a.position.set((Math.random() - 0.5) * 0.24, 0.29, (Math.random() - 0.3) * 0.3);
        chars[e.b].shield.add(a); spent.push({ a, t: 20 });
      }
      if (e.a === spec || e.b === spec) shake = Math.max(shake, 0.25);
    } else if (e.type === 'slam') {                        // knocked into the arena wall
      const c = chars[e.id], p = { x: e.x, y: 1, z: e.z };
      world.puff(p, 10, 0.7, 0.9); if (near(F[e.id])) world.text('SLAM!', p, '#ff9a5a');
      audio.play('punchHeavy', p, 1); audio.play('wood', p, 0.6);
      if (F[e.id].alive) { const d = Math.hypot(e.x, e.z) || 1; c.oneShot('Hit_Chest', 0.8, 0.04); c.impulse(-e.x / d, -e.z / d, 8); c.freeze = 0.1; }      // rebounds off the wall
      if (e.id === spec) shake = Math.max(shake, 0.5);
    } else if (e.type === 'shove') {                       // victim breaks a combo by shoving the attacker off
      const p = P(F[e.a]);
      chars[e.a].oneShot('Punch_Cross', 1.6, 0.05);
      { const a = F[e.a], b = F[e.b], d = Math.hypot(a.x - b.x, a.z - b.z) || 1; chars[e.b].impulse((b.x - a.x) / d, (b.z - a.z) / d, 6); }
      world.puff(p, 4, 0.4, 1.0); audio.play('punch', p, 0.8);
      if (near(F[e.a])) world.text(pick(['BACK OFF!', 'ENOUGH!', 'GET OFF!']), p, '#ffd9a0');
    } else if (e.type === 'bump') {                        // a body sent flying bowls into another
      const p = P(F[e.b]);
      world.puff(p, 3, 0.4, 0.9); audio.play('soft', p, 0.8);
      if (F[e.b].alive) { const a = F[e.a], b = F[e.b], d = Math.hypot(a.x - b.x, a.z - b.z) || 1; chars[e.b].oneShot('Hit_Chest', 1, 0.05); chars[e.b].impulse((b.x - a.x) / d, (b.z - a.z) / d, 6); chars[e.a].impulse((a.x - b.x) / d, (a.z - b.z) / d, 3); }
    } else if (e.type === 'break') {
      const p = P(F[e.id]); items[e.item].mesh.scale.y = 0.55; world.text('SNAP!', p); audio.play('wood', p, 1);
    } else if (e.type === 'shoot') {                       // arrows themselves are drawn from the sim's projectiles each frame
      const c = chars[e.a];
      c.oneShot('Pistol_Shoot', 1, 0.03); c.swinging = true;
      audio.play('swish', P(F[e.a]), 0.6, 1.5);
    } else if (e.type === 'arrow') {
      const a = arrows.get(e.id);
      if (a) {
        arrows.delete(e.id);
        if (e.hit) scene.remove(a);
        else { a.position.set(e.x, 0.13, e.z); a.rotation.set(0.45, Math.atan2(e.dx, e.dz), 0, 'YXZ'); spent.push({ a, t: 8 }); world.puff(e, 1, 0.2); }   // buried in the sand for a while
      }
    } else if (e.type === 'throw') {
      const v = items[e.item];
      scene.attach(v.mesh); v.held = null; v.air = true;       // from here it follows the sim's projectile
    } else if (e.type === 'land') {
      items[e.item].air = false; itemGround(e.item, e.x, e.z); world.puff(e, 2, 0.3);
    } else if (e.type === 'drop') {
      itemTumble(e.item);
    } else if (e.type === 'pickup') {
      itemHold(e.item, chars[e.id]); audio.play('draw', P(F[e.id]), 0.6);
    } else if (e.type === 'death') {
      const v = F[e.id], k = F[e.by], c = chars[e.id], p = P(v), w = WEAPON_BY_ID[e.wid];
      if (c.col) { physics.removeRigidBody(c.col); c.col = null; }
      c.root.updateMatrixWorld(true);
      const push = 1.2 + e.kb * 0.45;                    // a shove off the feet, not a launch
      c.ragdoll({ x: v.vx, y: 0, z: v.vz }, { x: e.dx * push, y: 0.7 + e.kb * 0.12, z: e.dz * push });
      world.puff(p, 10, 0.7); world.excite(0.7); audio.cheer(0.6); audio.play('punchHeavy', p, 1);
      feed(k.name, v.name, w.name, e.banned);
      if (e.id === spec) { note = `Eliminated by ${k.name}`; pending = { to: e.by, t: 1.8 }; shake = 0.6; }
      if ((e.id === spec || e.by === spec) && S.alive > 1) slowT = 0.55;
      if (S.alive === 2 && N > 2) {                      // two left: the arena knows it
        setText($('ct'), 'FINAL DUEL'); setTimeout(() => phase === 'fight' && setText($('ct'), ''), 2200);
        world.excite(1); audio.cheer(1);
      }
    } else if (e.type === 'win') startFinale();
  }

  // ---- cameras ----
  const camPos = new THREE.Vector3(0, 30, 50), camLook = new THREE.Vector3(), want = new THREE.Vector3(), tp = new THREE.Vector3();
  let camYaw = 0, camSnap = 0, focus = 6;
  const foe = { x: 0, z: 0, w: 0 };
  let lift = 0;
  function specCamera(dt) {
    const f = S.fighters[spec], c = chars[spec];
    if (c.dead) c.bones.pelvis.getWorldPosition(tp); else tp.set(f.x, 1.0, f.z);
    tp.y = Math.max(tp.y, 0.4) + 0.5;
    // who are they fighting? their current target if it is close, otherwise nobody
    const e = !c.dead && f.goal && f.goal.enemy && f.goal.enemy.alive ? f.goal.enemy : null;
    const de = e ? Math.hypot(e.x - f.x, e.z - f.z) : 99, engaged = de < 7;
    foe.w += ((engaged ? 1 : 0) - foe.w) * damp(3, dt);
    if (engaged) { foe.x += (e.x - foe.x) * damp(6, dt); foe.z += (e.z - foe.z) * damp(6, dt); }
    else { foe.x += (f.x + f.fx * 3 - foe.x) * damp(3, dt); foe.z += (f.z + f.fz * 3 - foe.z) * damp(3, dt); }
    if (!c.dead) {
      const yawWant = engaged ? Math.atan2(e.x - f.x, e.z - f.z) + 0.5 : Math.atan2(f.fx, f.fz);   // off to one side of the duel line, so both are in view
      camYaw = lerpAngle(camYaw, yawWant, damp(camSnap > 0 ? 30 : engaged ? 0.9 : 1.2, dt));
    }
    const sx = Math.sin(camYaw), cz = Math.cos(camYaw), back = 4.4 + foe.w * Math.min(2.2, de * 0.35);
    want.set(tp.x - sx * back + cz * 0.9, tp.y + 1.1 + foe.w * 0.35, tp.z - cz * back - sx * 0.9);
    // somebody standing between the camera and the fighter: rise to look over their shoulders
    let blocked = 0;
    for (const o of S.fighters) {
      if (!o.alive || o === f) continue;
      const ax = tp.x - want.x, az = tp.z - want.z, u = ((o.x - want.x) * ax + (o.z - want.z) * az) / (ax * ax + az * az);
      if (u > 0.08 && u < 0.85 && Math.hypot(want.x + ax * u - o.x, want.z + az * u - o.z) < 0.6) { blocked = 1; break; }
    }
    lift += (blocked - lift) * damp(blocked ? 4 : 1.2, dt);
    want.y += lift * 1.5;
    const el = (want.x * want.x) / (RX * RX) + (want.z * want.z) / (RZ * RZ);
    if (el > 0.93) { const k = Math.sqrt(0.93 / el); want.x *= k; want.z *= k; want.y += (1 - k) * 12; }
    camPos.lerp(want, damp(camSnap > 0 ? 40 : 4, dt));
    // look at a point between the two of them when they are fighting, otherwise just ahead of the fighter
    const m = foe.w * 0.45;
    want.set(tp.x + (foe.x - tp.x) * m + sx * 2 * (1 - foe.w), tp.y - 0.1, tp.z + (foe.z - tp.z) * m + cz * 2 * (1 - foe.w));
    camLook.lerp(want, damp(camSnap > 0 ? 40 : 6, dt));
    camSnap -= dt;
    focus = camPos.distanceTo(tp);
  }
  function orbit(cx, cy, cz, r, h, speed, t, dt, k = 3) {
    want.set(cx + Math.sin(t * speed) * r, cy + h, cz + Math.cos(t * speed) * r);
    camPos.lerp(want, damp(k, dt)); camLook.lerp(want.set(cx, cy, cz), damp(k, dt));
    focus = camPos.distanceTo(camLook);
  }
  const cut = (px, py, pz, lx, ly, lz) => { camPos.set(px, py, pz); camLook.set(lx, ly, lz); };

  // ---- ending: slow-mo, king rises, walks out, hands over the chest ----
  let phase = 'countdown', animScale = 1, cine = 0, step = 0, winner = null, wchar = null;
  const MEET = GATE.z + 7.4;
  // the chest is held, not parked on the chest: every frame it sits between the carrier's two hands
  let holder = null;
  const hl = new THREE.Vector3(), hr = new THREE.Vector3();
  function holdChest() {
    if (!holder) return;
    holder.root.updateMatrixWorld(true);
    holder.bones.hand_l.getWorldPosition(hl); holder.bones.hand_r.getWorldPosition(hr);
    const yaw = holder.root.rotation.y, s = hl.distanceTo(hr) / 0.56 * 0.92;        // sized so the hands are on its two ends
    chest.scale.setScalar(Math.max(0.55, Math.min(0.95, s)));
    chest.position.set((hl.x + hr.x) / 2 + Math.sin(yaw) * 0.05, (hl.y + hr.y) / 2 - 0.17 * chest.scale.y, (hl.z + hr.z) / 2 + Math.cos(yaw) * 0.05);
    chest.rotation.set(0, yaw, 0);
  }
  function startFinale() {
    phase = 'ceremony'; cine = 0; step = 0; winner = S.winner; wchar = chars[winner.id];
    spec = winner.id; pending = null; animScale = 0.18;
    wchar.tag.sprite.visible = false;
    $('bars').classList.add('on'); $('spec').hidden = true; $('feed').hidden = true;
    setText($('ct'), ''); setText($('cs'), 'LAST ONE STANDING');
    world.excite(1); audio.cheer(1);
  }
  const at = (n, t) => step === n && cine >= t && (step++, true);
  function ceremony(dt, rdt) {
    cine += rdt;
    holdChest();
    const k = king, kz = k.root.position;
    if (cine < 3) { orbit(winner.x, 1.3, winner.z, 3.6, 0.5, 0.5, cine, rdt, 6); if (cine > 2.2) animScale = Math.min(1, animScale + rdt * 2); }
    if (at(0, 3)) {
      animScale = 1; wchar.setBase('Idle_Loop'); setText($('cs'), 'The King rises');
      cut(1.8, BOX_Y + 1.3, THRONE.z + 4.6, 0, BOX_Y + 1.5, THRONE.z);
      k.oneShot('Sitting_Exit', 0.8, 0.2); k.setBase('Idle_Talking_Loop');
      world.excite(0.8); audio.cheer(0.8);
    }
    if (cine >= 3 && cine < 7.5) { camPos.z -= rdt * 0.35; camPos.x -= rdt * 0.15; camLook.y = BOX_Y + 1.75; focus = camPos.distanceTo(camLook); }
    if (at(1, 7.5)) {
      setText($('cs'), '');
      k.root.position.set(0, 0, GATE.z); k.setBase('Walk_Carry_Loop'); holder = k;
      wchar.root.position.set(0, 0, MEET + 1.35); wchar.root.rotation.y = Math.PI; wchar.freezeAt('Fixing_Kneeling', 0.5);     // the victor kneels as the king approaches
      wchar.setShield('back'); if (winner.item) items[winner.item.id].mesh.visible = false;      // hands free to receive the prize: weapon laid down, shield slung
      cut(5.5, 1.5, GATE.z + 2.5, 0, 1.3, GATE.z + 1);
    }
    if (cine >= 7.5 && step === 2) {
      kz.z = Math.min(MEET, kz.z + rdt * 1.25);
      want.set(5.2, 1.5, kz.z + 2.6); camPos.lerp(want, damp(3, rdt)); camLook.lerp(want.set(0, 1.25, kz.z + 0.8), damp(4, rdt)); focus = camPos.distanceTo(camLook);
      if (Math.random() < rdt * 2) world.puff(kz, 1, 0.3);
      if (kz.z >= MEET) { step = 3; cine = 20; k.setBase('Walk_Carry_Loop', 0); }
    }
    if (at(3, 20.6)) { wchar.setBase('Walk_Carry_Loop', 0); cut(-3.4, 1.55, MEET + 2.6, 0, 1.2, MEET + 0.7); }
    if (at(4, 21.6)) { holder = wchar; k.setBase('Idle_Talking_Loop'); audio.play('coins', kz, 1); }
    if (cine >= 20.6 && cine < 23.4) { camPos.x += rdt * 0.25; camPos.z -= rdt * 0.2; focus = camPos.distanceTo(camLook); }
    if (at(5, 23.4)) {
      holder = null; chest.scale.setScalar(1); chest.position.set(0.85, 0, MEET + 0.7); chest.rotation.set(0, -1.57, 0);
      wchar.setBase('Idle_FoldArms_Loop'); k.setBase('Idle_Loop'); k.oneShot('Yes', 1, 0.3);      // victor stands proud, the king nods
      chest.userData.glow.intensity = 14;
      world.confetti({ x: 0, z: MEET + 0.7 }); world.excite(1); audio.cheer(1); audio.play('coins', kz, 1);
      setText($('ct'), winner.name); setText($('cs'), cfg.prize ? `wins ${cfg.prize}` : 'wins the giveaway');
    }
    if (step >= 6) {
      const lid = chest.userData.lid; lid.rotation.x = Math.max(-1.9, lid.rotation.x - rdt * 3);
      orbit(0, 1.15, MEET + 0.8, 5.2, 0.7, 0.16, cine, rdt, 1.5);
      if (Math.random() < rdt * 0.25) { world.excite(0.9); audio.cheer(0.8); }
    }
  }

  // ---- main loop ----
  let last = performance.now(), frameNo = 0, simClock = 0, fpsT = 0, fpsN = 0, started = false, slowT = 0;
  const up = new THREE.Vector3(0, 1, 0);
  let labOn = false, lookTick = null, virt = null;
  let skew = 0;                                         // test hook: lets __game.advance() step time by hand
  const clock = () => Date.now() + skew;
  function frame(now, manual) {
    if (!manual) requestAnimationFrame(frame);
    if (labOn) { lookTick?.(now); camera.position.copy(camPos); camera.lookAt(camLook); composer.render(0.016); return; }
    const rdt = Math.max(0, Math.min(0.05, (now - last) / 1000)); last = now;
    // a kill by or of the fighter you are watching plays for a moment in slow motion
    if (slowT > 0 && phase === 'fight') { slowT -= rdt; animScale = slowT > 0 ? 0.3 : 1; }
    const dt = rdt * animScale, t = now / 1000;

    // -- advance the shared fight clock
    const target = (clock() - t0) / 1000;
    if (phase === 'countdown') {
      if (target >= 0) { phase = 'fight'; started = true; setText($('ct'), 'FIGHT!'); setText($('cs'), ''); setTimeout(() => phase === 'fight' && setText($('ct'), ''), 1300); audio.cheer(1); world.excite(1); }
      else {
        const s = Math.ceil(-target);
        setText($('ct'), s <= 5 ? String(s) : '');
        setText($('cs'), s <= 5 ? '' : `${isReplay ? 'Replay starts' : 'The games begin'} in ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`);
      }
    }
    if (phase === 'fight') {
      const behind = target - simClock;
      if (behind > 3) {                                  // joined late or tab was asleep: catch up silently
        while (S.t + DT <= target && !S.winner) { S.step(); S.events.length = 0; }
        simClock = target; syncAll();
        if (S.winner) startFinale();
      } else simClock += rdt * (slowT > 0 ? 0.3 : 1 + Math.max(-0.3, Math.min(0.5, behind)));     // (after a slow-motion beat the clock catches back up to everyone else)
      while (phase === 'fight' && S.t + DT <= simClock) {
        S.step();
        for (const e of S.events) { handle(e); window.__game.tap?.(e); }      // (tap: test hook)
        S.events.length = 0;
      }
    }

    // -- physics for ragdolls and dropped weapons
    physics.timestep = Math.max(dt, 1e-4); physics.step();

    // -- fighters
    for (let i = 0; i < N; i++) {
      const f = S.fighters[i], c = chars[i];
      if (f.alive && !(phase === 'ceremony' && step >= 2)) {
        c.root.position.set(f.x, 0, f.z);
        { const slung = (S.weaponOf(f).hands || 1) > 1; if (c.slung !== slung) { c.slung = slung; c.setShield(slung ? 'back' : 'arm'); } }
        c.guardUp = f.guard > 0 && !c.slung;                // shield arm comes up over whatever the body is doing
        { // where the head should be turned: at the enemy being fought, or at whoever is nearest when running for a weapon or away
          const o = f.goal && f.goal.enemy && f.goal.enemy.alive ? f.goal.enemy : f.near && f.near.alive ? f.near : null;
          const far = o ? Math.hypot(o.x - f.x, o.z - f.z) : 99;
          c.look = o && far < 12 && far > 0.3 && f.act !== 'dodge' && f.act !== 'stun' && f.act !== 'slip' && phase !== 'ceremony' ? lerpAngle(0, Math.atan2(o.x - f.x, o.z - f.z) - c.yaw, 1) : 0;
          c.look = Math.abs(c.look) > 2.1 ? 0 : Math.max(-1.1, Math.min(1.1, c.look));      // no owl necks: someone straight behind is not looked at
        }
        { const oh = f.item && f.act !== 'dodge' && f.act !== 'slip' && !c.rag && phase !== 'ceremony' && OFFHAND[f.item.wid]; c.offhand = oh || null; if (oh) { c.offMesh = items[f.item.id].mesh; c.offAxis = f.item.wid === 'crossbow' ? 0 : 1; }
          c.carry = oh && !f.swing && f.guard <= 0 && f.act !== 'pickup' && f.act !== 'taunt' ? CARRY[f.item.wid] : null; }      // both hands on a two-handed weapon
        if (c.col) c.col.setNextKinematicTranslation({ x: f.x, y: c.rag ? -50 : 0, z: f.z });      // out of the way of its own limp body
        if (c.rag) { c.rag.follow = f; if (f.act !== 'slip') c.recover(); }
        { // turn like a body with weight: eased, and never faster than about a full turn a second
          // a roll goes head-first along the way the body is travelling, then they turn back to face the fight
          const rolling = f.act === 'dodge' && c.dodgeClip === 'Roll' && Math.hypot(f.kx + f.vx, f.kz + f.vz) > 1.2, quick = rolling || f.act === 'attack';
          const face = rolling ? Math.atan2(f.kx + f.vx, f.kz + f.vz) : Math.atan2(f.fx, f.fz);
          const d = lerpAngle(0, face - c.yaw, 1), rate = quick ? 20 : 6.5, step = Math.max(-rate * dt, Math.min(rate * dt, d * damp(quick ? 30 : 10, dt)));   // squares up fast as a swing starts
          c.yaw += step; c.root.rotation.y = c.yaw;
        }
        // Weapons are aimed: while a spear or trident is being driven in, the shaft is turned to point at the spot on the
        // target the sim is striking, easing in through the wind-up and out through the recovery.
        if (f.item && (f.swing ? !f.swing.w.thrown : items[f.item.id].aim > 0)) {
          const v = items[f.item.id], sw = f.swing, tg = sw && S.fighters[c.aimAt ?? sw.target], wNow = sw ? sw.w : S.weaponOf(f), shooter = !!wNow.shoot, thrust = shooter || wNow.style === 'thrust';   // (a javelin used up close is a thrust)
          // cuts keep their arc and are only nudged onto the target as they land; thrusts are aimed the whole way in
          const ramp = !sw ? 0 : sw.t < sw.wind ? (thrust ? Math.min(1, sw.t / (sw.wind * 0.6)) : Math.max(0, (sw.t - sw.wind * 0.55) / (sw.wind * 0.45))) : sw.t < sw.wind + sw.act + 0.08 ? 1 : Math.max(0, 1 - (sw.t - sw.wind - sw.act - 0.08) / 0.2);
          const want = ramp * (thrust ? 1 : 0.55);
          v.aim = (v.aim || 0) + (want - (v.aim || 0)) * Math.min(1, dt * 25);
          if (tg && v.aim > 0.01) {
            c.grip.updateWorldMatrix(true, false);
            aimP.setFromMatrixPosition(c.grip.matrixWorld);
            aimD.set(tg.x - aimP.x, HIT_Y[sw.h] - aimP.y, tg.z - aimP.z).normalize();
            if (shooter) aimD.y *= 0.3, aimD.normalize();              // bows stay near level
            aimQ.setFromUnitVectors(shooter ? aimFwd : aimUp, aimD).premultiply(c.grip.getWorldQuaternion(aimQ2).invert());
            v.mesh.quaternion.identity().slerp(aimQ, v.aim);
          } else if (v.aim <= 0.01) { v.aim = 0; v.mesh.quaternion.identity(); }
        }
        // swing trail: sample the outer part of the blade while the blow is in motion, and let the ribbon fade behind it
        {
          const len = f.item && f.swing && !f.swing.over && f.swing.t > f.swing.wind * 0.4 ? WEAPON_LEN[f.item.wid] : 0;
          const tr = len ? trailFor(c) : c.trail;
          if (tr) {
            if (len) {
              const wm = items[f.item.id].mesh; wm.updateWorldMatrix(true, false);
              tipP.setFromMatrixPosition(wm.matrixWorld); tipD.setFromMatrixColumn(wm.matrixWorld, 1).normalize();
              midP.copy(tipP).addScaledVector(tipD, len * 0.45); tipP.addScaledVector(tipD, len);
              tr.pts.unshift([tipP.x, tipP.y, tipP.z, midP.x, midP.y, midP.z, 0]); tr.live = 0.25;
            } else tr.live -= dt;
            if (tr.pts.length > TRAIL_N) tr.pts.length = TRAIL_N;
            for (const p of tr.pts) p[6] += dt * 5;                                // age: fully faded after 0.2 s
            while (tr.pts.length && tr.pts[tr.pts.length - 1][6] >= 1) tr.pts.pop();
            tr.mesh.visible = tr.pts.length > 1;
            if (tr.mesh.visible) {
              const pos = tr.mesh.geometry.attributes.position, age = tr.mesh.geometry.attributes.age;
              for (let k = 0; k < TRAIL_N; k++) {
                const p = tr.pts[Math.min(k, tr.pts.length - 1)], a = k < tr.pts.length ? p[6] : 1;
                pos.setXYZ(k * 2, p[3], p[4], p[5]); pos.setXYZ(k * 2 + 1, p[0], p[1], p[2]); age.setX(k * 2, a); age.setX(k * 2 + 1, a);
              }
              pos.needsUpdate = age.needsUpdate = true;
            }
          }
        }
        // an attack clip must not outlive the swing: once the sim says the swing is over, ease back to the stance
        if (c.swinging && !f.swing) { c.swinging = false; if (c.busy && !c.busy.getClip().name.startsWith('Hit')) c.cancel(); }
        const sp = Math.hypot(f.vx, f.vz);
        // driven back by a blow: the feet plough the sand
        if (Math.hypot(f.kx, f.kz) > 2.5 && (c.skidT = (c.skidT || 0) - dt) < 0) { c.skidT = 0.07; world.puff(f, 1, 0.3, 0.05); }
        if (phase === 'ceremony') { /* driven by the ceremony */ }
        else if (f.act === 'dodge') {
          const d = c._act(c.dodgeClip || 'Roll').getClip().duration;
          c.setBase(c.dodgeClip || 'Roll', c.dodgeClip === 'Crouch_Idle_Loop' ? 1 : d / (c.dodgeClip === 'Roll' ? 0.7 : 0.45));
        } else if (f.act === 'taunt') { if (c.base !== 'TreeChopping_Loop') c.freezeAt('TreeChopping_Loop', 0.27, 0.25); }     // weapon thrust overhead in triumph
        else if ((f.act === 'run' || f.act === 'flee') && sp > 0.7) {
          const fwd = (f.vx * Math.sin(c.yaw) + f.vz * Math.cos(c.yaw));      // speed along the way the body is facing
          if (f.act === 'flee') c.setBase('Sprint_Loop', Math.max(0.7, Math.min(1.4, sp / 5)));
          else if (fwd < -0.3) c.setBase('Walk_Loop', Math.max(-1.6, fwd / 1.3));            // backing off: the walk played in reverse
          // walk or jog, with slack between the two so a fighter getting up to speed does not flick through a walk on the way
          else if ((f.goal && f.goal.enemy && Math.hypot(f.goal.enemy.x - f.x, f.goal.enemy.z - f.z) < 3.2) || (c.base === 'Walk_Loop' ? sp < 2.6 : c.base === 'Jog_Fwd_Loop' && sp < 1.8))   // footwork inside a duel is always stepped, never jogged
            c.setBase('Walk_Loop', Math.max(0.6, Math.min(2.2, sp / 1.3)));                  // closing the last step or two
          else c.setBase('Jog_Fwd_Loop', Math.max(0.6, Math.min(1.5, sp / 3.5)));
          if ((c.stepT -= dt * sp) < 0) { c.stepT = 1.5; world.puff(f, 1, 0.28, 0.05); if (i === spec) audio.play('step', P(f, 0), 0.35); }
        } else if (f.act === 'stun' || f.act === 'slip') c.setBase('Zombie_Idle_Loop', 1.4);
        else if (f.act === 'pickup') c.setBase('PickUp_Table', 1.7);
        else if (f.act !== 'attack') c.setBase(f.guard > 0 && c.slung ? 'Sword_Block' : f.item ? 'Sword_Idle' : 'Idle_Loop', 1);      // idle, hurt, or barely moving; no shield in hand means the weapon itself is raised to parry
        const hp = Math.ceil(f.hp);
        if (hp !== c.hp) { c.hp = hp; c.tag.draw(hp); }
        c.tag.sprite.material.color.setHex(i === spec ? 0xffd76a : 0xffffff);
        const d2 = camPos.distanceToSquared(c.root.position);
        c.lod(d2 < 200); c.tag.sprite.visible = phase !== 'ceremony' && (d2 < 1600 || i === spec);
      }
      // distant fighters animate at half rate; nobody can tell from across the arena
      const far = !c.dead && camPos.distanceToSquared(c.root.position) > 500;
      if (!far) c.update(dt); else if ((frameNo + i) & 1) c.update(dt * 2);
    }
    frameNo++;
    king.update(dt);

    // -- arrows and bolts in flight follow the sim's projectiles exactly
    for (const q of S.shots) {
      if (q.it) continue;
      let a = arrows.get(q.id);
      if (!a) { a = makeArrow(); scene.add(a); arrows.set(q.id, a); }
      a.position.set(q.x, q.h === 2 ? 1.55 : 1.2, q.z); a.rotation.set(0, Math.atan2(q.dx, q.dz), 0);
    }
    for (let i = spent.length - 1; i >= 0; i--) if ((spent[i].t -= dt) <= 0) { spent[i].a.removeFromParent(); spent.splice(i, 1); }
    // -- loose weapons (the glow under each one breathes)
    { const k = 1.1 + 0.7 * (0.5 + 0.5 * Math.sin(t * 3.2)); for (const g of glowTwins.values()) g.emissiveIntensity = k; }
    for (let i = 0; i < items.length; i++) {
      const v = items[i];
      if (v.air) {
        v.mesh.position.set(S.items[i].x, 1.35, S.items[i].z); v.mesh.rotation.x += dt * 22;
      } else if (v.body) {
        const p = v.body.translation(), q = v.body.rotation();
        v.mesh.position.set(p.x, p.y, p.z); v.mesh.quaternion.set(q.x, q.y, q.z, q.w);
        if ((v.t += dt) > 4) itemGround(i, 0, 0, true);
      }
    }

    // -- camera
    if (pending && (pending.t -= rdt) <= 0) { spec = pending.to; pending = null; note = ''; camSnap = 0.3; }
    if (phase === 'ceremony') ceremony(dt, rdt);
    else if (phase === 'countdown' && !picked && target < -5) orbit(0, 2, 0, 44, 15, 0.07, t, rdt, 2);
    else specCamera(rdt);
    shake *= Math.exp(-7 * rdt);
    camera.position.copy(camPos);
    camera.position.x += (Math.random() - 0.5) * shake * 0.3; camera.position.y += (Math.random() - 0.5) * shake * 0.3;
    camera.up.copy(up); camera.lookAt(camLook);
    bokeh.uniforms.focus.value += (focus - bokeh.uniforms.focus.value) * damp(6, rdt);

    // -- HUD
    if (phase !== 'ceremony') {
      const f = S.fighters[spec], w = S.weaponOf(f);
      setText($('wn'), f.name);
      const foeNow = f.alive && f.goal && f.goal.enemy && f.goal.enemy.alive && Math.hypot(f.goal.enemy.x - f.x, f.goal.enemy.z - f.z) < 7 ? f.goal.enemy : null;
      setText($('ww'), note || (f.alive ? `${w.name} · ${f.kills} kill${f.kills === 1 ? '' : 's'}${foeNow ? ' · fighting ' + foeNow.name : ''}` : 'Eliminated'));
      $('whp').style.width = Math.max(0, f.hp) + '%';
    }
    setText($('halive'), `⚔ ${S.alive} / ${N} alive`);

    Char.time.value = t;
    world.update(dt, t);
    audio.update(camera, rdt);
    grade.uniforms.uTime.value = t;
    composer.render(rdt);

    // -- drop a quality tier if the machine can't hold ~30 fps
    if (cfg.q == null && started && quality > 0) {
      fpsT += rdt; fpsN++;
      if (fpsN >= 120) { if (fpsT / fpsN > 0.034) { quality--; applyQuality(); } fpsT = fpsN = 0; }
    }
  }
  window.__game = { advance(sec, fps = 30) { virt ??= clock(); for (let i = 0; i < sec * fps; i++) { virt += 1000 / fps; skew = virt - Date.now(); frame(last + 1000 / fps, true); } last = performance.now(); },   // virtual clock, kept across calls: real time spent rendering must not leak in
    get S() { return S; }, get spec() { return spec; }, cycle,
    // dev: freeze fighters in a row, each posed part-way through a clip, to eyeball animations and grips
    lab(clips, frac = 0.5, weapon, cam = [0, 1.6, 7, 0, 1, 0]) {
      labOn = true;
      chars.forEach((c, i) => {
        c.root.visible = i < clips.length;
        if (i >= clips.length) return;
        c.root.position.set((i - (clips.length - 1) / 2) * 1.6, 0, 0); c.root.rotation.y = 0; c.tag.sprite.visible = false;
        const act = c._act(clips[i]);
        c.mixer.stopAllAction(); act.reset().play(); act.paused = true; act.time = act.getClip().duration * (Array.isArray(frac) ? frac[i] : frac); c.mixer.update(0);
        if (c.labW) c.grip.remove(c.labW);
        if (weapon) { c.labW = makeWeapon(weapon); c.grip.add(c.labW); c.armed = true; }
        c.post?.();
      });
      items.forEach(v => { v.mesh.visible = false; });
      camPos.set(cam[0], cam[1], cam[2]); camLook.set(cam[3], cam[4], cam[5]);
      frame(last, true);
    }, chars, world, camera, king, CARRY, OFFHAND, get phase() { return phase; }, set t0(v) { t0 = v; }, get quality() { return quality; } };
  // #look: a turntable for checking every hairstyle on its own. ◀ ▶ steps through them; each has a number to refer to.
  if (cfg.look) {
    labOn = true;
    chars.forEach(c => { c.root.visible = false; });
    items.forEach(v => { v.mesh.visible = false; });
    setText($('ct'), ''); setText($('cs'), ''); $('top').hidden = true; $('feed').hidden = true;
    const models = ['f', 'm'].flatMap(g => STYLES[g].map((style, i) => {
      const c = new Char({ g, color: 0x888888, seed: 0.37, style });
      c.root.visible = false; c.setBase('Idle_Loop'); scene.add(c.root);
      const label = style.filter(p => p !== 'Cap' || style.length === 1).map(p => p.replace('Hair_', '').replace('SimpleParted', 'Parted')).join(' + ');
      return { c, text: `${g === 'f' ? 'Women' : 'Men'} #${i + 1} of ${STYLES[g].length} — ${label}` };
    }));
    let k = 0, spin = true, t0 = performance.now(), prev = t0;
    const pick = d => {
      models[k].c.root.visible = false; k = (k + d + models.length) % models.length; models[k].c.root.visible = true;
      setText($('wn'), models[k].text); setText($('ww'), 'arrow keys or ◀ ▶ to change · space to stop / start turning'); $('whp').style.width = '0';
    };
    $('prev').onclick = () => pick(-1); $('next').onclick = () => pick(1);
    addEventListener('keydown', e => { if (e.key === ' ') spin = !spin; });
    pick(0);
    camPos.set(0, 1.68, 1.25); camLook.set(0, 1.6, 0);
    let angle = 0;
    lookTick = now => {
      const dt = Math.min(0.05, (now - prev) / 1000); prev = now;
      if (spin) angle += dt * 0.9;
      const m = models[k].c;
      m.root.rotation.y = angle; m.update(dt);
      world.update(dt, now / 1000);
    };
  }
  requestAnimationFrame(frame);
}

const cfg = location.hash === '#look'
  ? { players: [{ name: 'A', g: 'f' }, { name: 'B', g: 'm' }], seed: 1, start: Date.now() + 1e10, prize: '', me: '', q: null, look: true }
  : readLink();
if (cfg) show(cfg).catch(e => { console.error(e); $('loadmsg').textContent = 'Failed to load: ' + e.message; });
else admin();
