// Character visuals: CC0 bodies + hair, mocap clips retargeted from the animation library's
// mannequin, gladiator kit, name tag, and a Rapier ragdoll on death.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const C = 'assets/char/';
const HAIR = { m: ['Hair_Buzzed', 'Hair_SimpleParted', 'Hair_Long', 'Hair_Beard'], f: ['Hair_Long', 'Hair_Buns', 'Hair_BuzzedFemale'] };
// Hairstyles: each is a set of parts. "Hair_*" parts are the modelled meshes from the character pack; the rest
// (Tail, Knot, Mohawk, Braid, Pigtails) are built in code and ride on the head bone, Curls is a mass of small tufts, and the caps (Cap, Crop)
// are a thin layer of scalp hair grown off that character's own head, thinning out to a ragged hairline.
const STYLES = {
  m: [['Hair_Buzzed'], ['Hair_SimpleParted'], ['Hair_Long'], ['Cap', 'Braid'], ['Hair_Buzzed', 'Mohawk'], ['Cap', 'Tail'], ['Curls']],
  f: [['Hair_Long'], ['Hair_Buns'], ['Hair_Long', 'Knot'], ['Cap', 'Tail'], ['Cap', 'Braid'], ['Cap', 'Pigtails'], ['Curls'], ['Hair_Buns', 'Braid']],
};
const HAIR_COLORS = [0x1b1410, 0x2a1d14, 0x3a2416, 0x6b4423, 0xa8763a, 0xd9b36a, 0x8c2f1b];   // black through blond and red: no white or grey
// skin: two painted textures (light, dark), each tinted three ways: six tones from pale to deep brown
// share of fighters given the deeper of the two skin textures (the rest get the lighter one); each is then tinted three ways
const DEEP_SHARE = 0;        // share of fighters on the darker skin texture: none, everyone is in the lighter shades
const SKIN = { light: [0xffffff, 0xf6e0cc, 0xecceb2], dark: [0xffffff, 0xd8b8a4, 0xa8866f] };
// [bone, parent body, child bone (gives length), radius]
const RAG = [
  ['pelvis', null, null, 0.13], ['spine_02', 'pelvis', 'neck_01', 0.13], ['Head', 'spine_02', null, 0.11],
  ['upperarm_l', 'spine_02', 'lowerarm_l', 0.05], ['lowerarm_l', 'upperarm_l', 'hand_l', 0.045],
  ['upperarm_r', 'spine_02', 'lowerarm_r', 0.05], ['lowerarm_r', 'upperarm_r', 'hand_r', 0.045],
  ['thigh_l', 'pelvis', 'calf_l', 0.075], ['calf_l', 'thigh_l', 'foot_l', 0.055],
  ['thigh_r', 'pelvis', 'calf_r', 0.075], ['calf_r', 'thigh_r', 'foot_r', 0.055],
];
// How far each ragdoll joint may move from the rest pose. Ball joints get a cone (radians); elbows and knees are hinges
// that only fold the way a real one does (axis given in character space at the T-pose rest).
const LIMITS = {
  spine_02: { max: 0.45 }, Head: { max: 0.55 }, upperarm_l: { max: 1.5 }, upperarm_r: { max: 1.5 }, thigh_l: { max: 1.1 }, thigh_r: { max: 1.1 },
  lowerarm_l: { hinge: [0, -1, 0], lo: 0.05, hi: 2.3 }, lowerarm_r: { hinge: [0, 1, 0], lo: 0.05, hi: 2.3 },
  calf_l: { hinge: [1, 0, 0], lo: 0.02, hi: 2.2 }, calf_r: { hinge: [1, 0, 0], lo: 0.02, hi: 2.2 },
};
const V = () => new THREE.Vector3(), Q = () => new THREE.Quaternion();
const v1 = V(), v2 = V(), q1 = Q(), q2 = Q(), q3 = Q(), q4 = Q(), QI = Q();

export async function loadCharacters(manager, RAPIER, physics) {
  const loader = new GLTFLoader(manager);
  const tl = new THREE.TextureLoader(manager);
  const load = f => loader.loadAsync(C + f);
  const hairNames = [...new Set([...HAIR.m, ...HAIR.f])];
  const [male, female, ual1, ual2, ...hairs] = await Promise.all([
    load('Superhero_Male_FullBody.gltf'), load('Superhero_Female_FullBody.gltf'), load('UAL1_Standard.glb'), load('UAL2_Standard.glb'),
    ...hairNames.map(n => load(n + '.gltf')),
  ]);
  const skinTex = f => { const t = tl.load(C + f); t.flipY = false; t.colorSpace = THREE.SRGBColorSpace; return t; };
  const lightSkin = { m: skinTex('T_Superhero_Male_Light.png'), f: skinTex('T_Superhero_Female_Light_BaseColor.png') };

  // ---- retarget clips: keep each bone's rotation relative to its own rest pose ----
  const rest = scene => { const r = {}; scene.traverse(o => { r[o.name] = { q: o.quaternion.clone(), p: o.position.clone() }; }); return r; };
  function retarget(clip, from, to) {
    const tracks = [];
    for (const t of clip.tracks) {
      const dot = t.name.lastIndexOf('.'), bone = t.name.slice(0, dot), prop = t.name.slice(dot + 1);
      const a = from[bone], b = to[bone];
      if (!a || !b) continue;
      if (prop === 'quaternion' && t.values.length === t.times.length * 4) {
        const pre = b.q.clone().multiply(a.q.clone().invert()), out = new Float32Array(t.values.length);
        for (let i = 0; i < out.length; i += 4) { q1.fromArray(t.values, i).premultiply(pre); q1.toArray(out, i); }
        tracks.push(new THREE.QuaternionKeyframeTrack(t.name, t.times, out));
      } else if (prop === 'position' && bone === 'pelvis' && t.values.length === t.times.length * 3) {
        const k = b.p.length() / a.p.length(), out = new Float32Array(t.values.length);
        for (let i = 0; i < out.length; i += 3) { v1.fromArray(t.values, i).sub(a.p).multiplyScalar(k).add(b.p); v1.toArray(out, i); }
        tracks.push(new THREE.VectorKeyframeTrack(t.name, t.times, out));
      }
    }
    return new THREE.AnimationClip(clip.name, clip.duration, tracks);
  }

  // ---- body material: gladiator kit painted on in the shader using rest-pose position ----
  function kitMaterial(base, cloth, g) {
    const m = base.clone();
    m.userData.kit = { uCloth: { value: new THREE.Color(cloth) }, uG: { value: g } };
    m.onBeforeCompile = s => {
      Object.assign(s.uniforms, m.userData.kit);
      s.vertexShader = 'varying vec3 vRest;\n' + s.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n vRest = position;');
      s.fragmentShader = 'varying vec3 vRest; uniform vec3 uCloth; uniform float uG; float kitMetal = 0.0;\n' + s.fragmentShader
        .replace('#include <map_fragment>', `#include <map_fragment>
        {
          vec3 r = vRest; float ax = abs(r.x);
          vec3 leather = vec3(0.13, 0.07, 0.035), brz = vec3(0.75, 0.5, 0.2);
          bool torso = ax < 0.27;
          if (uG > 1.5) {                                                    // king: full toga
            if (torso && r.y > 0.12 && r.y < 1.5) diffuseColor.rgb = uCloth * (0.85 + 0.15 * sin(r.x * 60.0));
            if (ax >= 0.27 && ax < 0.5 && r.y > 1.2) diffuseColor.rgb = uCloth;
            if (torso && r.y > 0.95 && r.y < 1.55 && abs((r.y - 1.27) + r.x * 1.3) < 0.06) { diffuseColor.rgb = vec3(1.0, 0.76, 0.25); kitMetal = 1.0; }   // gold sash
          } else {
            if (torso && r.y > 0.8 && r.y < 1.04) diffuseColor.rgb = uCloth;                                   // loincloth
            if (uG > 0.5 && ax < 0.21 && r.y > 1.2 && r.y < 1.43) diffuseColor.rgb = uCloth;                   // top
            if (uG < 0.5 && ax < 0.21 && r.y > 1.04 && r.y < 1.52 && abs((r.y - 1.28) - r.x * 1.25) < 0.035) diffuseColor.rgb = leather;   // baldric
          }
          if (torso && r.y > 1.0 && r.y < 1.075) { if (uG > 1.5) { diffuseColor.rgb = vec3(1.0, 0.76, 0.25); kitMetal = 1.0; } else diffuseColor.rgb = leather; }                                 // belt
          if (uG > 1.5 && ax > 0.47 && ax < 0.68 && r.y > 1.2) { diffuseColor.rgb = vec3(1.0, 0.76, 0.25); kitMetal = 1.0; }                               // bracers
          if (r.y < 0.075 || (r.y < 0.17 && fract(r.y * 22.0) < 0.4)) diffuseColor.rgb = leather;              // sandals
        }`)
        .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\n metalnessFactor = mix(metalnessFactor, 1.0, kitMetal); roughnessFactor = mix(roughnessFactor, 0.38, kitMetal);');
    };
    return m;
  }

  const DS = THREE.DoubleSide;
  const GOLD14 = 0xe6c378;                                         // 14 carat: paler and less orange than pure gold
  const METALS = [[0xc2c4c8, 0.28], [GOLD14, 0.22], [0xa9743f, 0.3]];  // [colour, base roughness]: silver, 14 ct gold, bronze
  const LEATHERS = [0x2b1d13, 0x35251a, 0x241d19];                  // dark, so leather never reads as bare skin                  // dark, so leather never reads as bare skin
  const KIND = { cloth: 0, leather: 1, metal: 2 };
  // One material (and one draw call) for a fighter's whole outfit. Each vertex says whether it is leather or metal;
  // the surface detail is procedural, driven by the rest-pose position so it stays glued to the body:
  // overlapping plates (lames) on arms, shoulders and belly, a sternum groove and collar on the chest, ridged greaves,
  // hanging strips on the skirt, quilted stitching on leather. It bends the shading normal for relief and darkens
  // the recesses, which is what gives plate its depth.
  const ARMOUR_GLSL = String.raw`
    varying vec3 vRest; varying float vKind; varying vec3 vBand;
    uniform vec3 uC0; uniform vec3 uC1; uniform vec3 uC2; uniform float uRough; uniform float uW; uniform float uD;
    float gH = 0.0, gCav = 1.0, gEdge = 0.0, gKind = 1.0, gSash = 0.0;
    // the base suit decides plate vs leather per pixel, so the joins are clean lines rather than jagged triangles
    float suitKind(vec3 r) {
      if (uW > 3.5) return 2.0;                          // fighters: plate from neck to toe
      float ax = abs(r.x);
      bool torso = ax < 0.3, arm = r.y > 1.2;
      bool m = r.y <= 0.16 || (torso && r.y > 0.99 && r.y <= 1.085) || (torso && r.y > 0.16 && r.y < 0.5) || (arm && ax > 0.47 && ax < 0.68)
        || (uW > 0.5 && torso && r.y > 1.085) || (uW > 1.5 && ((arm && ax >= 0.3 && ax <= 0.47) || (torso && r.y >= 0.5 && r.y < 0.8)))
        || (uW > 2.5 && (r.y <= 0.16 || (arm && ax >= 0.68)));
      return m ? 2.0 : 1.0;
    }
    float lame(float u, float period) {               // sawtooth: each plate rises then tucks under the next one
      float s = fract(u / period);
      gCav = smoothstep(0.0, 0.2, s) * (0.75 + 0.25 * smoothstep(1.0, 0.8, s));
      gEdge = smoothstep(0.8, 0.95, s);
      return s * smoothstep(1.0, 0.9, s);
    }
    float scales(float u, float v) {                   // overlapping rounded scales, each lipped over the row below
      float row = floor(v / 0.042), s = 1.0 - fract(v / 0.042);
      float xr = abs(fract(u / 0.046 + 0.5 * mod(row, 2.0)) - 0.5) * 2.0, rnd = sqrt(max(0.0, 1.0 - xr * xr));
      gCav = smoothstep(0.0, 0.25, s) * (0.5 + 0.5 * rnd); gEdge = smoothstep(0.7, 0.95, s) * rnd * 0.8;
      return s * rnd;
    }
    void armour(vec3 r, float kind) {
      float ax = abs(r.x);
      bool skirt = false;                                   // (hanging skirt strips are gone; hips and thighs are banded plate)
      float strip = fract(atan(r.x, r.z) * 2.546);    // 16 hanging strips around the hips
      if (kind > 1.5) {
        if (r.y > 1.37 && ax > 0.13 && ax <= 0.31) gH = lame(ax + r.y * 0.3, 0.05);            // shoulder plates
        else if (r.y > 1.2 && ax > 0.27) gH = ax > 0.68 ? lame(ax, 0.022) : lame(ax, 0.058);     // arm lames, finger joints
        else if (r.y > 1.1 && r.y < 1.3 && ax <= 0.27) gH = lame(-r.y, 0.05);                    // belly bands
        else if (r.y >= 1.3 && ax <= 0.27) {                                                    // breastplate: sternum groove, collar rim
          float g = smoothstep(0.0, 0.014, ax), collar = smoothstep(0.05, 0.0, abs(length(vec2(r.x, r.y - 1.56)) - 0.13));
          gH = g * 0.6 + collar; gCav = (0.5 + 0.5 * g) * (1.0 - 0.35 * collar * (1.0 - collar) * 4.0); gEdge = collar;
        }
        else if (skirt) { gH = strip * smoothstep(1.0, 0.86, strip) + lame(-r.y, 0.12) * 0.5; gCav *= smoothstep(0.0, 0.16, strip); }
        else if (r.y >= 0.5 && r.y <= 0.57) { gH = 1.0; gEdge = 1.0; }                           // knee
        else if (r.y > 0.16 && r.y < 0.5) {                                                     // greave: front ridge, rims
          float ridge = r.z > 0.0 ? smoothstep(0.035, 0.0, abs(ax - 0.1)) : 0.0, rim = smoothstep(0.03, 0.0, min(r.y - 0.16, 0.5 - r.y));
          gH = ridge + rim; gCav = 0.8 + 0.2 * ridge; gEdge = max(ridge, rim) * 0.7;
        }
        else if (r.y <= 0.16) gH = lame(r.z, 0.045);                                             // sabaton
        else gH = lame(-r.y, 0.07);                                                              // thigh plates, belt
        // the make of the plate on chest, belly, hips, thighs and arms: 0 banded, 1 scale, 2 fluted, 3 broad plates
        bool limb = r.y > 1.2 && ax > 0.31 && ax < 0.66, leg = r.y > 0.58 && r.y < 0.965 && ax < 0.3;
        if (uD > 0.5 && (limb || leg || (ax <= 0.27 && r.y >= 0.965 && r.y < 1.46))) {
          float u = limb ? atan(r.z, r.y - 1.42) * 0.05 : leg ? atan(ax - 0.1, r.z) * 0.09 : atan(r.x, r.z) * 0.15, v = limb ? -ax : r.y;
          if (uD < 1.5) gH = scales(u, v);
          else if (uD < 2.5) { float b = lame(-v, 0.21), c = abs(fract(u / 0.03) - 0.5) * 2.0; gH = c + b * 0.5; gCav *= 0.6 + 0.4 * c; gEdge = max(gEdge, smoothstep(0.75, 1.0, c) * 0.5); }
          else { gH = lame(-v, 0.15) * 1.6; float seam = smoothstep(0.012, 0.0, abs(u)); gCav *= 1.0 - 0.5 * seam; }
        }
        float riv = length(fract(vec2(r.x, r.y) / 0.05) - 0.5);                                   // rivets on the banded parts
        if (r.y > 0.965 && r.y < 1.1 && ax < 0.3) { float dot_ = smoothstep(0.16, 0.08, riv); gH = dot_; gCav = 1.0 - 0.3 * smoothstep(0.1, 0.2, riv) * smoothstep(0.3, 0.2, riv); gEdge = dot_; }
      } else if (kind < 0.5) {                                // cloth: soft vertical folds
        gH = 0.5 + 0.5 * sin(r.x * 46.0 + sin(r.y * 9.0) * 2.0 + r.z * 20.0); gCav = 0.7 + 0.3 * gH;
        // imperial purple: a sash across the chest, the hem of the tunic, and the cuffs
        if (ax < 0.3 && r.y > 0.95 && r.y < 1.56 && abs((r.y - 1.27) + r.x * 1.25) < 0.075) gSash = 1.0;
        if (ax < 0.3 && r.y > 0.64 && r.y < 0.72) gSash = 1.0;
        if (r.y > 1.2 && ax > 0.52 && ax < 0.6) gSash = 1.0;
      } else if (skirt) {
        gH = smoothstep(0.0, 0.12, strip) * smoothstep(1.0, 0.88, strip); gCav = 0.45 + 0.55 * gH;
        float stud = smoothstep(0.12, 0.05, length(vec2(strip - 0.5, fract(r.y / 0.09) - 0.5) * vec2(1.0, 0.6)));
        gH += stud; gEdge = stud;
      } else {                                                                                    // quilted leather with stitch lines
        vec2 q = vec2(r.x + r.z * 0.7, r.y) / 0.045;
        float d = min(abs(fract(q.x + q.y) - 0.5), abs(fract(q.x - q.y) - 0.5));
        gH = smoothstep(0.0, 0.16, d); gCav = 0.3 + 0.7 * gH;
        // buckled straps wrapped round the limbs so it reads as gear, not skin
        float u = (r.y > 1.2 && ax > 0.27) ? ax : r.y, s = fract(u / 0.14);
        float strap = smoothstep(0.0, 0.04, s) * smoothstep(0.3, 0.26, s);
        if (r.y > 0.16) { gH = max(gH * 0.4, strap * 1.6); gCav = mix(gCav, 0.85, strap); gEdge = strap * 0.6 * step(0.02, s); }
      }
    }
    vec3 bumped(vec3 pos, vec3 nrm, vec2 dH, float face) {
      vec3 sx = normalize(dFdx(pos)), sy = normalize(dFdy(pos));
      vec3 r1 = cross(sy, nrm), r2 = cross(nrm, sx);
      float det = dot(sx, r1) * face;
      return normalize(abs(det) * nrm - sign(det) * (dH.x * r1 + dH.y * r2));
    }
  `;
  function outfitMaterial(cloth, leather, metal, rough, weight, design = 0) {
    const m = new THREE.MeshStandardMaterial({ side: DS });
    const u = { uC0: { value: new THREE.Color(cloth) }, uC1: { value: new THREE.Color(leather) }, uC2: { value: new THREE.Color(metal) }, uRough: { value: rough }, uW: { value: weight }, uD: { value: design } };
    m.onBeforeCompile = s => {
      Object.assign(s.uniforms, u);
      s.vertexShader = 'attribute float kind; attribute vec3 band; varying float vKind; varying vec3 vRest; varying vec3 vBand;\n' + s.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n vKind = kind; vRest = position; vBand = band;');
      s.fragmentShader = ARMOUR_GLSL + s.fragmentShader
        .replace('#include <map_fragment>', '#include <map_fragment>\n if (vBand.x > 0.5) { float c = vBand.x < 1.5 ? vRest.y : abs(vRest.x); if (c < vBand.y || c > vBand.z) discard; }\n gKind = vKind > 2.5 ? suitKind(vRest) : vKind;\n armour(vRest, gKind);\n vec3 kc = gKind < 0.5 ? mix(uC0, vec3(0.2, 0.06, 0.33), gSash) : gKind < 1.5 ? uC1 : uC2;\n diffuseColor.rgb = kc * (0.16 + 0.84 * gCav) * (1.0 + (gKind < 1.5 ? 1.2 : 0.45) * gEdge);')
        .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\n metalnessFactor = step(1.5, gKind);\n roughnessFactor = gKind < 1.5 ? 0.62 - 0.2 * gEdge : clamp(uRough + (1.0 - gCav) * 0.55 - gEdge * 0.1, 0.12, 1.0);')
        .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n { float k = gKind < 1.5 ? 0.012 : 0.02; vec2 dH = clamp(vec2(dFdx(gH), dFdy(gH)) * k, -0.06, 0.06); normal = bumped(-vViewPosition, normal, dH, faceDirection); }');
    };
    return m;
  }

  // Clothing and armour are shells lifted off the body mesh itself: same triangles, same skin weights,
  // pushed out along the normals. They deform exactly like the body, so nothing floats or clips.
  // band: [1, lo, hi] clips the piece to a height range, [2, lo, hi] to a distance-from-centre range (done per pixel)
  function shell(src, inside, offset, kind, band = [0, 0, 0]) {
    const P = src.attributes.position, Nm = src.attributes.normal, SI = src.attributes.skinIndex, SW = src.attributes.skinWeight;
    const map = new Int32Array(P.count).fill(-1), pos = [], nor = [], si = [], sw = [], kd = [], idx = [], p = V(), n = V();
    let abs = false;
    const use = i => {
      if (map[i] !== -1) return map[i];
      p.fromBufferAttribute(P, i); n.fromBufferAttribute(Nm, i);
      if (!inside(p, n)) return map[i] = -2;
      const o = offset(p);
      if (o.length) { abs = true; kd.push(typeof kind === 'function' ? kind(p) : kind); pos.push(o[0], o[1], o[2]); nor.push(n.x, n.y, n.z); si.push(SI.getX(i), SI.getY(i), SI.getZ(i), SI.getW(i)); sw.push(SW.getX(i), SW.getY(i), SW.getZ(i), SW.getW(i)); return map[i] = pos.length / 3 - 1; }
      kd.push(typeof kind === 'function' ? kind(p) : kind);
      pos.push(p.x + n.x * o, p.y + n.y * o, p.z + n.z * o); nor.push(n.x, n.y, n.z);
      si.push(SI.getX(i), SI.getY(i), SI.getZ(i), SI.getW(i)); sw.push(SW.getX(i), SW.getY(i), SW.getZ(i), SW.getW(i));
      return map[i] = pos.length / 3 - 1;
    };
    const ix = src.index.array;
    for (let t = 0; t < ix.length; t += 3) { const a = use(ix[t]), b = use(ix[t + 1]), c = use(ix[t + 2]); if (a >= 0 && b >= 0 && c >= 0) idx.push(a, b, c); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4)); g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
    g.setAttribute('band', new THREE.Float32BufferAttribute(new Float32Array(pos.length).map((_, i) => band[i % 3]), 3));
    g.setAttribute('kind', new THREE.Float32BufferAttribute(kd, 1));
    g.setIndex(idx);
    if (abs) g.computeVertexNormals();                       // reshaped pieces are lit by their own form, not the body's
    return g;
  }
  // Everyone wears a full suit: gold plate and leather from the neck down, only the head is bare.
  // The suit is one shell over the whole body; "weight" decides which regions are plate and which are leather.
  function pieces(src, g) {
    src.computeBoundingBox();
    const top = src.boundingBox.max.y, neck = top - 0.235, ax = p => Math.abs(p.x), L = KIND.leather, M = KIND.metal, e = 0.04;
    const thin = p => (ax(p) >= 0.68 && p.y > 1.2) || p.y > neck - 0.06;      // gloves, boots and collar hug closer
    const chest = g === 'm' ? 0.215 : 0.19;
    const yBand = (lo, hi, off, kind, w = 0.3) => shell(src, p => ax(p) < w && p.y > lo - e && p.y < hi + e, () => off, kind, [1, lo, hi]);
    const xBand = (lo, hi, off, s) => shell(src, p => p.x * s > lo - e && p.x * s < hi + e && p.y > 1.2, () => off, M, [2, lo, hi]);
    // A rigid plate round the trunk. At each height the body's outline is measured and the plate is an ellipse fitted
    // round it; hollows are bridged, so the plate has its own form instead of following every curve underneath.
    const P = src.attributes.position, STEP = 0.03;
    const hull = (lo, hi, pad, k, w) => {
      const n = Math.ceil((hi - lo) / STEP) + 2, S = Array.from({ length: n }, () => [0, -9, 9]);
      for (let i = 0; i < P.count; i++) {
        const x = Math.abs(P.getX(i)), y = P.getY(i), z = P.getZ(i);
        if (x >= w || y < lo - STEP || y > hi + STEP) continue;
        const s = S[Math.max(0, Math.min(n - 1, Math.round((y - lo) / STEP)))];
        if (x > s[0]) s[0] = x; if (z > s[1]) s[1] = z; if (z < s[2]) s[2] = z;
      }
      for (let i = 0; i < n; i++) if (S[i][1] < -8) S[i] = S[i ? i - 1 : 1];
      return shell(src, p => ax(p) < w && p.y > lo - e && p.y < hi + e, p => {
        const f = Math.max(0, Math.min(n - 1.001, (p.y - lo) / STEP)), i = Math.floor(f), u = f - i, a = S[i], b = S[i + 1];
        const sx = a[0] + (b[0] - a[0]) * u + pad, zf = a[1] + (b[1] - a[1]) * u, zb = a[2] + (b[2] - a[2]) * u;
        const zc = (zf + zb) / 2, sz = (zf - zb) / 2 + pad, dx = p.x, dz = p.z - zc, r = Math.sqrt(dx * dx + dz * dz) || 1e-6;
        const er = k / Math.sqrt((dx / r / sx) ** 2 + (dz / r / sz) ** 2), nr = Math.max(r + pad * 0.6, er);
        return [dx / r * nr, p.y, zc + dz / r * nr];
      }, M, [1, lo, hi]);
    };
    const pauld = s => mergeGeometries([                                                       // three overlapping shoulder plates
      shell(src, p => p.x * s > 0.13 - e && p.x * s < 0.33 + e && p.y > 1.36, () => 0.034, M, [2, 0.13, 0.33]),
      shell(src, p => p.x * s > 0.13 - e && p.x * s < 0.26 + e && p.y > 1.4, () => 0.05, M, [2, 0.135, 0.26]),
      shell(src, p => p.x * s > 0.13 - e && p.x * s < 0.2 + e && p.y > 1.43, () => 0.064, M, [2, 0.14, 0.2]),
    ]);
    return {
      suit: shell(src, p => p.y < neck + e || ax(p) > 0.14, p => thin(p) ? 0.006 : 0.013, 3, [1, -9, neck]),
      // raised bands where plate meets leather: waist, knees, elbows, wrists
      trim: mergeGeometries([yBand(0.965, 1.1, 0.03, M), yBand(0.455, 0.57, 0.03, M), yBand(0.13, 0.2, 0.026, M), xBand(0.44, 0.5, 0.026, 1), xBand(0.44, 0.5, 0.026, -1), xBand(0.655, 0.69, 0.02, 1), xBand(0.655, 0.69, 0.02, -1)]),
      cuirass: hull(1.09, 1.5, 0.022, 0.97, chest),       // every suit: a plain plate round the chest
      breastplate: mergeGeometries([hull(1.1, 1.5, 0.034, 0.99, chest), hull(1.3, 1.5, 0.046, 1, chest - 0.02)]),   // a heavier, layered one on top
      pauldL: pauld(1), pauldR: pauld(-1),
      // Hips and thighs. These hug the body instead of flaring out from it, so they move with the legs:
      // a banded skirt of plates round the hips (fauld) and a plate down the front and outside of each thigh (cuisses).
      fauldM: yBand(0.8, 0.985, 0.027, M), fauldL: yBand(0.8, 0.985, 0.022, L),
      cuisses: shell(src, (p, n) => ax(p) < 0.3 && p.y > 0.5 - e && p.y < 0.83 && n.x * Math.sign(p.x) > (n.z > 0 ? -0.45 : 0.1), () => 0.025, M, [1, 0.5, 0.82]),
      gorget: mergeGeometries([yBand(neck - 0.11, neck - 0.01, 0.026, M, 0.2), yBand(neck - 0.07, neck - 0.01, 0.036, M, 0.2)]),     // two rings guarding the throat
      vambraces: mergeGeometries([xBand(0.5, 0.655, 0.024, 1), xBand(0.5, 0.655, 0.024, -1), xBand(0.5, 0.56, 0.034, 1), xBand(0.5, 0.56, 0.034, -1)]),   // forearm plates with an elbow cop
      greaves: mergeGeometries([yBand(0.2, 0.455, 0.024, M), shell(src, (p, n) => ax(p) < 0.3 && p.y > 0.2 - e && p.y < 0.455 + e && n.z > 0.2, () => 0.036, M, [1, 0.22, 0.44])]),   // shin plates, thicker down the front
      sabatons: shell(src, p => p.y < 0.26, p => p.y < 0.1 && p.z > 0.06 ? 0.055 : 0.034, M, [1, -9, 0.22]),      // armoured boots: thick enough to close over the toes
      boots: shell(src, p => p.y < 0.26, () => 0.036, L, [1, -9, 0.22]),       // the king's soft leather boots
      // the king: a cloth tunic and a few gold ornaments (belt, cuffs, collar), no armour
      tunic: mergeGeometries([
        shell(src, p => p.y < neck + e || ax(p) > 0.14, p => thin(p) ? 0.006 : p.y < 0.95 && ax(p) < 0.3 ? 0.03 : 0.018, KIND.cloth, [1, -9, neck]),   // loose below the waist
        shell(src, (p, n) => ax(p) < 0.3 && p.y > 0.6 && p.y < 1.02 && n.x * Math.sign(p.x) > -0.25, p => 0.03 + Math.max(0, 0.98 - p.y) * 0.13, KIND.cloth, [1, 0.64, 1.0]),   // the hem of the tunic
      ]),
      ornaments: mergeGeometries([yBand(0.985, 1.09, 0.03, M), xBand(0.6, 0.69, 0.024, 1), xBand(0.6, 0.69, 0.024, -1), yBand(neck - 0.1, neck - 0.025, 0.024, M, 0.2)]),
    };
  }

  const goldM = new THREE.MeshStandardMaterial({ color: GOLD14, metalness: 1, roughness: 0.22 });

  // hair: flat colour reads as plastic, so run fine strands through it and let them catch the light
  // cap: scalp hair. Its 'edge' attribute is how far inside the hairline a point is; near the edge it breaks up into strands.
  function hairMaterial(color, cap = false) {
    const m = new THREE.MeshStandardMaterial({ color, roughness: 0.5, side: THREE.DoubleSide });
    m.onBeforeCompile = s => {
      s.vertexShader = (cap ? 'attribute float edge; varying float vEdge;\n' : '') + 'varying vec3 vHair;\n' + s.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n vHair = position;' + (cap ? ' vEdge = edge;' : ''));
      s.fragmentShader = (cap ? 'varying float vEdge;\n' : '') + 'varying vec3 vHair;\n' + s.fragmentShader
        .replace('#include <map_fragment>', '#include <map_fragment>\n' + (cap ? ' { float hn = 0.5 + 0.5 * sin(vHair.x * 330.0 + sin(vHair.y * 95.0 + vHair.z * 60.0) * 2.2); if (vEdge < 0.02 + hn * 0.1) discard; }\n' : '') + ' float hs = sin(vHair.x * 240.0 + sin(vHair.y * 60.0) * 1.6 + vHair.z * 110.0), hb = sin(vHair.x * 37.0 + vHair.z * 29.0 + vHair.y * 13.0);\n diffuseColor.rgb *= (0.62 + 0.38 * hs * hs) * (0.85 + 0.15 * hb);')
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n roughnessFactor = 0.38 + 0.3 * hs * hs;');
    };
    return m;
  }

  // ---- one template per gender, cloned per fighter ----
  function template(gltf, g) {
    const scene = gltf.scene;
    scene.updateMatrixWorld(true);
    let body = null;
    scene.traverse(o => { if (o.isSkinnedMesh && (!body || o.geometry.attributes.position.count > body.geometry.attributes.position.count)) body = o; });
    body.name = 'body';
    const bones = Object.fromEntries(body.skeleton.bones.map(b => [b.name, b]));
    HAIR[g].forEach(n => {
      let hm = null;
      hairs[hairNames.indexOf(n)].scene.traverse(o => { if (o.isSkinnedMesh) hm = o; });
      hm = hm.clone();
      const src = hm.skeleton;
      hm.bind(new THREE.Skeleton(src.bones.map(b => bones[b.name]), src.boneInverses), hm.bindMatrix);
      hm.name = 'hair:' + n; hm.visible = false;
      scene.add(hm);
    });
    // grip: sits in the palm just behind the knuckles
    // with its striking edge (weapon +X) facing the way the knuckles do
    const grip = new THREE.Group(); grip.name = 'grip';
    {
      const idx = bones.index_01_r.position, pk = bones.pinky_01_r.position;
      const across = idx.clone().sub(pk).normalize(), mid = idx.clone().add(pk).multiplyScalar(0.5);
      const fwd = mid.clone().addScaledVector(across, -mid.dot(across)).normalize();
      const palm = new THREE.Vector3().crossVectors(fwd, across);
      // the mocap sword clips carry the blade along the hand bone's +Z, with the edge leading along the fingers (+Y)
      grip.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(1, 0, 0)));
      if (palm.dot(bones.thumb_01_r.position) < 0) palm.negate();
      grip.position.copy(mid).multiplyScalar(0.82).addScaledVector(palm, 0.028);
      bones.hand_r.add(grip);
    }
    {
      body.geometry.computeBoundingBox();
      const top = body.geometry.boundingBox.max.y, head = body.skeleton.bones.indexOf(bones.Head);
      const blob = (x, y, z, r, sx = 1, sy = 1, sz = 1) => new THREE.IcosahedronGeometry(r, 2).scale(sx, sy, sz).translate(x, y, z);
      // a lock of hair: overlapping blobs along a curve, thinning toward the tip
      const lock = (a, c, b, r0, r1, n = 16, wob = 0) => Array.from({ length: n }, (_, i) => {
        const t = i / (n - 1), u = 1 - t, w = wob * (i % 2 ? 1 : -1);
        return blob(u * u * a[0] + 2 * u * t * c[0] + t * t * b[0] + w, u * u * a[1] + 2 * u * t * c[1] + t * t * b[1], u * u * a[2] + 2 * u * t * c[2] + t * t * b[2], r0 + (r1 - r0) * t * t, 1, 1.3, 1);
      });
      const y = d => top - d;
      const parts = {
        Tail: [blob(0, y(0.07), -0.105, 0.03), ...lock([0, y(0.07), -0.11], [0, y(0.04), -0.26], [0, y(0.38), -0.19], 0.045, 0.018)],
        Knot: [blob(0, y(-0.005), -0.045, 0.05, 1, 0.9, 1), blob(0, y(0.03), -0.045, 0.036)],
        Mohawk: Array.from({ length: 17 }, (_, i) => {
          const th = -0.6 + i * 0.185, r = 0.036 + 0.014 * Math.sin(i / 16 * Math.PI);
          return blob(0, y(0.105) + Math.cos(th) * 0.118, -0.005 - Math.sin(th) * 0.123, r, 0.72, 1.25, 1.25);
        }),
        Braid: lock([0, y(0.08), -0.11], [0, y(0.25), -0.17], [0, y(0.56), -0.12], 0.04, 0.022, 15, 0.013),
        Pigtails: [-1, 1].flatMap(s => [blob(s * 0.095, y(0.1), -0.03, 0.028), ...lock([s * 0.1, y(0.1), -0.03], [s * 0.2, y(0.1), -0.05], [s * 0.14, y(0.4), -0.01], 0.04, 0.016)]),
      };
      // Scalp region, measured as a direction from the middle of the skull: the hairline sits high over the
      // forehead, drops past the temples and runs down to the nape. "drop" lowers it for longer cuts.
      // Scalp region, measured as a direction from the middle of the skull: the hairline sits high over the
      // forehead, drops past the temples and runs down to the nape. inside() > 0 means under hair, and grows inward.
      const cy = top - 0.115;
      const inside = p => {
        if (Math.abs(p.x) > 0.14 || p.y < top - 0.27) return -1;
        const dx = p.x, dy = p.y - cy, dz = p.z + 0.005, l = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1, vy = dy / l, vz = dz / l;
        return vy - (vz > 0 ? 0.1 + 0.6 * vz : 0.1 + 0.9 * vz);
      };
      const add = (name, geo) => {
        const sm = new THREE.SkinnedMesh(geo, new THREE.MeshStandardMaterial());
        sm.bind(body.skeleton, body.bindMatrix); sm.name = 'hair:' + name; sm.visible = false;
        scene.add(sm);
      };
      // tufts scattered evenly over the scalp: reads as tight curls
      const P3 = new THREE.Vector3();
      parts.Curls = Array.from({ length: 150 }, (_, i) => {
        const yy = 1 - 2 * (i + 0.5) / 150, rr = Math.sqrt(1 - yy * yy), a = i * 2.399963;
        P3.set(Math.cos(a) * rr * 0.082, cy + yy * 0.108, -0.005 + Math.sin(a) * rr * 0.1);
        return inside(P3) > 0.04 ? blob(P3.x * 1.12, cy + (P3.y - cy) * 1.1, P3.z * 1.1 - 0.004, 0.034 + 0.01 * ((i * 7) % 5) / 5) : null;
      }).filter(Boolean);
      for (const [name, geos] of Object.entries(parts)) {
        const geo = mergeGeometries(geos), n = geo.attributes.position.count;
        geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Uint16Array(n * 4).map((_, i) => i % 4 ? 0 : head), 4));
        geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(new Float32Array(n * 4).map((_, i) => i % 4 ? 0 : 1), 4));
        add(name, geo);
      }
      const cap = (name, thick) => {
        const taper = p => 0.0025 + thick * Math.min(1, Math.max(0, inside(p)) / 0.3);
        const geo = shell(body.geometry, p => inside(p) > -0.02, taper, 0), pos = geo.attributes.position;
        geo.setAttribute('edge', new THREE.Float32BufferAttribute(Float32Array.from({ length: pos.count }, (_, i) => inside(P3.fromBufferAttribute(pos, i))), 1));
        add(name, geo);
      };
      cap('Cap', 0.012);                                                   // pulled back tight, for tails, braids and knots
    }
    // Where the shield sits: strapped to the outside of the left forearm, or slung across the back.
    {
      const anchor = (name, bone, wx, wy, wz, normal) => {
        const a = new THREE.Group(), b = bones[bone], p = b.getWorldPosition(new THREE.Vector3());
        a.name = name;
        a.quaternion.copy(b.getWorldQuaternion(Q()).invert()).multiply(Q().setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal));
        a.position.copy(b.worldToLocal(p.add(new THREE.Vector3(wx, wy, wz))));
        b.add(a);
      };
      anchor('shieldArm', 'lowerarm_l', 0.13, 0.065, 0, new THREE.Vector3(0, 1, 0));       // rest pose is palm-down: the back of the forearm faces up
      anchor('shieldBack', 'spine_03', 0, -0.04, -0.2, new THREE.Vector3(0, 0, -1));
    }
    const tag = new THREE.Group(); tag.name = 'tagAnchor'; tag.position.y = 2.08; scene.add(tag);
    // local axes that pitch the torso forward/back (used to aim swings high or low and to flinch)
    const lean = ['spine_01', 'spine_03'].map(n => [n, new THREE.Vector3(1, 0, 0).applyQuaternion(bones[n].getWorldQuaternion(Q()).invert())]);
    // bones that rock when the body takes a blow: [bone, pitch axis, roll axis, share of the motion]
    const sway = [['spine_01', 0.35], ['spine_03', 0.35], ['Head', 0.3]].map(([n, g]) => {
      const inv = bones[n].getWorldQuaternion(Q()).invert();
      return [n, new THREE.Vector3(1, 0, 0).applyQuaternion(inv), new THREE.Vector3(0, 0, 1).applyQuaternion(inv), g];
    });
    const joints = {};
    for (const [n, parent] of RAG) if (parent) {
      const cq = bones[n].getWorldQuaternion(Q()), L = LIMITS[n];
      joints[n] = { rel: bones[parent].getWorldQuaternion(Q()).invert().multiply(cq), max: L.max, lo: L.lo, hi: L.hi, axis: L.hinge && new THREE.Vector3(...L.hinge).applyQuaternion(cq.clone().invert()).normalize() };
    }
    scene.traverse(o => { if (o.isSkinnedMesh && o !== body && o.skeleton === body.skeleton) o.userData.shareBody = true; });
    return { scene, rest: rest(scene), baseMat: body.material, pieces: pieces(body.geometry, g), merged: new Map(), lean, sway, joints };
  }
  const T = { m: template(male, 'm'), f: template(female, 'f') };

  const clips = { m: {}, f: {} }, guardPose = { m: [], f: [] };
  for (const lib of [ual1, ual2]) {
    const from = rest(lib.scene);
    for (const c of lib.animations) for (const g of ['m', 'f']) clips[g][c.name] ??= retarget(c, from, T[g].rest);
  }
  // the shield-arm pose from the guard clip: blended over any other animation while a fighter has their guard up
  for (const g of ['m', 'f']) for (const bone of ['clavicle_l', 'upperarm_l', 'lowerarm_l', 'hand_l']) {
    const tr = clips[g].Idle_Shield_Loop.tracks.find(t => t.name === bone + '.quaternion');
    if (tr) guardPose[g].push([bone, new THREE.Quaternion().fromArray(tr.values, 0)]);
  }

  function makeTag(name) {
    const c = document.createElement('canvas'); c.width = 512; c.height = 112;
    const tx = new THREE.CanvasTexture(c); tx.colorSpace = THREE.SRGBColorSpace;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tx, transparent: true, depthWrite: false }));
    s.scale.set(1.3, 0.284, 1); s.layers.set(1);
    const draw = hp => {
      const x = c.getContext('2d');
      x.clearRect(0, 0, 512, 112);
      x.font = '700 50px Cinzel, Georgia, serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
      x.lineWidth = 9; x.strokeStyle = 'rgba(0,0,0,.85)'; x.strokeText(name, 256, 40, 500);
      x.fillStyle = '#fff'; x.fillText(name, 256, 40, 500);
      x.fillStyle = 'rgba(0,0,0,.7)'; x.fillRect(126, 84, 260, 16);
      x.fillStyle = hp > 50 ? '#7bd34f' : hp > 25 ? '#e8c26a' : '#e2452f'; x.fillRect(129, 87, 254 * Math.max(0, hp) / 100, 10);
      tx.needsUpdate = true;
    };
    draw(100);
    return { sprite: s, draw };
  }

  const live = [];                                                  // characters with an active ragdoll, oldest first
  // round shield: leather face, gold rim and boss. The disc's +Y is the side that faces the enemy.
  // Shield: a heater, the badge shape with a flat top and sides that sweep down to a point. A thick board with a
  // gold bevelled edge, a domed boss and ring, a spine running down to the tip, rivets, and a painted face.
  // Built in the shield anchor's frame: +Y faces the enemy, X runs along the forearm (width), +Z is the top.
  const shieldParts = (() => {
    const W = 0.44, H = 0.56, w = W / 2, h = H / 2;
    const outline = (c, sx, sy, ox, oy) => {                           // the same outline, for the mesh and for the painting
      c.moveTo(ox - w * sx, oy + (h - 0.03) * sy);
      c.quadraticCurveTo(ox - w * sx, oy + h * sy, ox - (w - 0.03) * sx, oy + h * sy);
      c.lineTo(ox + (w - 0.03) * sx, oy + h * sy);
      c.quadraticCurveTo(ox + w * sx, oy + h * sy, ox + w * sx, oy + (h - 0.03) * sy);
      c.bezierCurveTo(ox + w * sx, oy - 0.06 * sy, ox + w * 0.55 * sx, oy - (h - 0.1) * sy, ox, oy - h * sy);
      c.bezierCurveTo(ox - w * 0.55 * sx, oy - (h - 0.1) * sy, ox - w * sx, oy - 0.06 * sy, ox - w * sx, oy + (h - 0.03) * sy);
    };
    const shape = new THREE.Shape(); outline(shape, 1, -1, 0, 0);       // drawn upside down: rotating it to face +Y turns it the right way up
    // painted face and a matching height map (grain, scuffs and the raised paint catch the light)
    const cv = document.createElement('canvas'), bm = document.createElement('canvas'), PX = 512 / W;
    cv.width = bm.width = 512; cv.height = bm.height = Math.round(H * PX);
    const x = cv.getContext('2d'), b = bm.getContext('2d'), CH = cv.height;
    x.fillStyle = '#6e1712'; x.fillRect(0, 0, 512, CH); b.fillStyle = '#808080'; b.fillRect(0, 0, 512, CH);
    for (let i = 1; i < 5; i++) { b.fillStyle = '#585858'; b.fillRect(i * 102, 0, 4, CH); x.fillStyle = 'rgba(0,0,0,0.2)'; x.fillRect(i * 102, 0, 4, CH); }     // plank joins
    for (let i = 0; i < 1400; i++) {
      const px = Math.random() * 512, py = Math.random() * CH;
      x.fillStyle = Math.random() < 0.5 ? 'rgba(0,0,0,0.10)' : 'rgba(255,190,150,0.05)'; x.fillRect(px, py, 2, 8 + Math.random() * 40);
      if (i % 12 === 0) for (const [c, col] of [[x, 'rgba(30,8,6,0.55)'], [b, '#484848']]) { c.strokeStyle = col; c.lineWidth = 2; c.beginPath(); c.moveTo(px, py); c.lineTo(px + 24 - Math.random() * 48, py + 30); c.stroke(); }   // sword scars
    }
    for (const [c, col] of [[x, '#e3b648'], [b, '#d0d0d0']]) {
      c.fillStyle = c.strokeStyle = col;
      for (const [inset, lw] of [[0.93, 12], [0.84, 5]]) { c.lineWidth = lw; c.beginPath(); outline(c, PX * inset, -PX * inset, 256, CH / 2); c.stroke(); }   // double border following the edge
      const cy = CH * 0.36;
      c.lineWidth = 9; c.beginPath(); c.arc(256, cy, 92, 0, 7); c.stroke();                         // ring round the boss
      for (const s of [-1, 1]) for (let k = 0; k < 5; k++) {                                       // wings
        c.save(); c.translate(256, cy); c.scale(s, 1); c.translate(96, -6); c.rotate(-0.5 + k * 0.24);
        c.beginPath(); c.ellipse(50 + k * 4, 0, 52 + k * 5, 11, 0, 0, 7); c.fill(); c.restore();
      }
      c.beginPath(); c.moveTo(244, cy + 110); c.lineTo(282, cy + 190); c.lineTo(254, cy + 190); c.lineTo(276, CH * 0.9); c.lineTo(226, cy + 212); c.lineTo(256, cy + 212); c.closePath(); c.fill();   // thunderbolt down to the point
    }
    const tex = new THREE.CanvasTexture(cv), bump = new THREE.CanvasTexture(bm);
    tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
    for (const t of [tex, bump]) { t.repeat.set(1 / W, -1 / H); t.offset.set(0.5, 0.5); }           // cap UVs are in metres from the centre
    const face = new THREE.MeshStandardMaterial({ map: tex, bumpMap: bump, bumpScale: 1.8, roughness: 0.7 });
    const trim = new THREE.MeshStandardMaterial({ color: 0xe6c378, metalness: 1, roughness: 0.32 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x8a6426, metalness: 1, roughness: 0.5 });
    trim.userData.tint = 1; dark.userData.tint = 0.6;                  // the metal fittings are re-coloured to match the bearer's armour
    // extruded board: flat faces take the painting, the bevelled edge is gold. Shape -y (its top) becomes +Z, depth becomes +Y.
    const up = g => g.rotateX(-Math.PI / 2);
    const board = new THREE.ExtrudeGeometry(shape, { depth: 0.022, bevelEnabled: true, bevelSize: 0.012, bevelThickness: 0.012, bevelSegments: 3, curveSegments: 18 }).translate(0, 0, -0.011);
    const rimShape = new THREE.Shape(); outline(rimShape, 1, -1, 0, 0);
    const hole = new THREE.Path(); outline(hole, 0.86, -0.86, 0, 0); rimShape.holes.push(hole);
    const rim = new THREE.ExtrudeGeometry(rimShape, { depth: 0.012, bevelEnabled: true, bevelSize: 0.004, bevelThickness: 0.004, bevelSegments: 2, curveSegments: 18 }).translate(0, 0, 0.02);
    const by = H * 0.14;                                               // the boss sits above the middle
    const parts = [
      [up(board), [face, trim]],
      [up(rim), trim],                                                 // a raised metal band inside the edge
      [new THREE.SphereGeometry(0.07, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.9, 1).translate(0, 0.024, by), trim],
      [new THREE.TorusGeometry(0.078, 0.01, 6, 22).rotateX(Math.PI / 2).translate(0, 0.028, by), dark],
      [new THREE.CylinderGeometry(0.095, 0.095, 0.012, 22).translate(0, 0.026, by), dark],
      [new THREE.BoxGeometry(0.03, 0.02, H * 0.52).translate(0, 0.028, by - 0.07 - H * 0.26), dark],   // spine from the boss to the tip
    ];
    for (const [rx, rz] of [[-0.16, 0.22], [0.16, 0.22], [-0.17, 0.05], [0.17, 0.05], [-0.1, -0.13], [0.1, -0.13]]) parts.push([new THREE.SphereGeometry(0.013, 8, 6).translate(rx, 0.036, rz), trim]);   // rivets on the band
    return parts;
  })();
  const fitCache = new Map();
  const fitting = (m, metal) => {                                      // a shield fitting in this fighter's metal
    if (Array.isArray(m)) return m.map(x => fitting(x, metal));
    if (!m.userData.tint) return m;
    const k = m.uuid + metal;
    if (!fitCache.has(k)) { const c = m.clone(); c.color.setHex(metal).multiplyScalar(m.userData.tint); fitCache.set(k, c); }
    return fitCache.get(k);
  };
  const ikSave = [Q(), Q(), Q(), Q(), Q(), Q()], ikHold = Q(), ikG = V();
  // two-bone reach: bend the elbow until the hand is the right distance from the shoulder, then swing the whole arm
  // so the hand lands on the target
  function reachTo(up, lo, hand, target) {
    const turn = (bone, qw) => { bone.parent.getWorldQuaternion(ikP); bone.quaternion.premultiply(ikQ.copy(ikP).invert().multiply(qw).multiply(ikP)); };
    const S = ikS2, E = ikE2, H = ikH2;
    up.getWorldPosition(S); lo.getWorldPosition(E); hand.getWorldPosition(H);
    const a = E.distanceTo(S), b = H.distanceTo(E), d = Math.max(Math.abs(a - b) + 0.03, Math.min((a + b) * 0.985, target.distanceTo(S)));
    ikX.copy(S).sub(E); ikY.copy(H).sub(E);
    const th0 = ikX.angleTo(ikY), th1 = Math.acos(Math.max(-1, Math.min(1, (a * a + b * b - d * d) / (2 * a * b))));
    // the elbow bends about the arm's own plane; when the arm is nearly straight that plane is ill-defined, so it
    // falls back on the joint's hinge axis rather than flipping from frame to frame
    ikX.cross(ikY);
    const k = Math.min(1, ikX.length() / (a * b) * 4);
    lo.getWorldQuaternion(ikP);
    ikY.set(-1, 0, 0).applyQuaternion(ikP);              // (measured: on this skeleton both elbows hinge about the forearm's -X)
    if (k > 1e-4) ikX.normalize().multiplyScalar(k).addScaledVector(ikY, 1 - k); else ikX.copy(ikY);
    turn(lo, ikR.setFromAxisAngle(ikX.normalize(), th1 - th0));
    hand.getWorldPosition(H);
    turn(up, ikR.setFromUnitVectors(H.sub(S).normalize(), ikX.copy(target).sub(S).normalize()));
  }
  const UP = new THREE.Vector3(0, 1, 0);
  const ikS2 = V(), ikE2 = V(), ikH2 = V(), ikX = V(), ikY = V();
  const ikM = new THREE.Matrix4(), ikT = V(), ikS = V(), ikE = V(), ikH = V(), ikA = V(), ikB = V(), ikP = Q(), ikQ = Q(), ikR = Q(), ikU = Q(), ikL = Q();
  class Char {
    static time = { value: 0 };                        // shared clock for cloth sway
    // o: { g: 'm'|'f', name, color, seed (0..1 look variety), king }
    constructor(o) {
      const t = T[o.g], r = (k => { const x = Math.sin((o.seed ?? 0.5) * 999 + k * 77.7) * 43758.5; return x - Math.floor(x); });
      this.g = o.g;
      this.root = SkeletonUtils.clone(t.scene);
      this.bones = {}; this.skinned = []; this.detail = [];
      // outfit: every fighter rolls their own mix of kilt, body armour, shoulder, arm, leg and head pieces
      const pickOf = (k, ...opts) => { const x = r(k); for (let i = 0; i < opts.length; i += 2) if (x < opts[i]) return opts[i + 1]; return []; };
      const weight = o.king ? 3 : 4;                       // 4 = the whole suit is plate
      const KITS = [
        ['breastplate', 'pauldL', 'pauldR', 'cuisses'],                                    // legionary
        ['breastplate', 'pauldL', 'pauldR', 'cuisses', 'gorget', 'vambraces', 'greaves'],  // full harness
        ['breastplate', 'vambraces', 'greaves'],                                           // hoplite: cuirass and limbs, bare shoulders
        ['pauldL', 'gorget', 'vambraces', 'cuisses'],                                      // arena fighter: one great shoulder
        ['gorget', 'pauldL', 'pauldR', 'greaves'],                                         // light
        ['breastplate', 'pauldL', 'pauldR', 'gorget', 'greaves'],                          // heavy infantry
      ];
      const kit = o.king ? ['tunic', 'ornaments', 'boots'] : ['suit', 'trim', 'fauldM', 'sabatons', 'cuirass', ...KITS[Math.floor(r(12) * KITS.length)]];
      const design = o.king ? 0 : Math.floor(r(11) * 4), metal = METALS[o.king ? 1 : Math.floor(r(18) * METALS.length)];
      this.metal = metal[0];
      const style = o.style ? o.style : o.king ? ['Hair_Long'] : o.g === 'm' && r(1) < 0.04 ? [] : STYLES[o.g][Math.floor(r(1) * STYLES[o.g].length)];
      const beard = o.g === 'm' && !o.style && (o.king || r(2) < 0.45);
      const hairColor = o.king ? 0xa8763a : HAIR_COLORS[Math.floor(r(3) * HAIR_COLORS.length)];
      let hairMat = null, capMat = null;
      this.root.traverse(n => {
        if (n.isBone) this.bones[n.name] = n;
        if (n.name === 'grip') this.grip = n;
        if (n.name === 'index_01_l') { const pk = n.parent.children.find(o => o.name === 'pinky_01_l'), m = n.position.clone().add(pk.position).multiplyScalar(0.5); this.palm = m.length() * 0.75; this.palmDir = m.normalize(); }
        if (n.name === 'shieldArm') this.shieldArm = n;
        if (n.name === 'shieldBack') this.shieldBack = n;
        if (n.name === 'tagAnchor') this.tagAnchor = n;
        if (n.name === 'body') this.body = n;
        if (!n.isSkinnedMesh) return;
        n.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 1, 0), 2.2);    // follows the root; cheap and safe for culling
        n.castShadow = n.name === 'body'; n.receiveShadow = true; this.skinned.push(n);
        if (n.name !== 'body' && (!n.name.startsWith('hair:') || n.name === 'hair:Hair_Beard')) this.detail.push(n);
        if (n.name === 'body') {
          n.material = kitMaterial(t.baseMat, o.color, o.king ? 2 : o.g === 'm' ? 0 : 1);
          const fair = o.king || r(5) >= DEEP_SHARE;
          if (fair) n.material.map = lightSkin[o.g];
          n.material.color.setHex(o.king ? 0xffffff : SKIN[fair ? 'light' : 'dark'][Math.floor(r(6) * 3)]);
        } else if (n.name.startsWith('hair:')) {
          n.visible = style.includes(n.name.slice(5)) || (beard && n.name === 'hair:Hair_Beard');
          if (n.visible) { hairMat ??= hairMaterial(hairColor); capMat ??= hairMaterial(hairColor, true); n.material = n.name === 'hair:Cap' || n.name === 'hair:Crop' ? capMat : hairMat; }
        } else if (n.material.name.startsWith('MI_Hair')) {        // eyebrows
          hairMat ??= hairMaterial(hairColor); capMat ??= hairMaterial(hairColor, true);
          n.material = hairMat;
        }
      });
      for (const n of this.detail) n.userData.on = n.visible;
      // meshes that used the body's skeleton in the template share it here too: one bone update per fighter, not one per mesh
      for (const n of this.skinned) if (n.userData.shareBody) n.bind(this.body.skeleton, this.body.bindMatrix);
      {
        const key = kit.join('+'), leather = LEATHERS[Math.floor(r(17) * LEATHERS.length)];
        if (!t.merged.has(key)) t.merged.set(key, mergeGeometries(kit.map(k => t.pieces[k])));
        const sm = this.outfit = new THREE.SkinnedMesh(t.merged.get(key), outfitMaterial(o.king ? 0xe6dcc4 : leather, leather, metal[0], metal[1] + r(20) * 0.12, weight, design));
        sm.bind(this.body.skeleton, this.body.bindMatrix);            // shares the body skeleton: no extra bone updates
        sm.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 1, 0), 2.2); sm.receiveShadow = true;
        this.body.parent.add(sm); this.skinned.push(sm);
        if (!o.king) this.root.scale.setScalar(0.94 + r(19) * 0.12);
      }
      this.leanBones = t.lean.map(([n, axis]) => [this.bones[n], axis]);
      this.lean = this.flinch = this.leanNow = this.freeze = 0;
      this.sway = t.sway.map(([n, ax, az, g]) => [this.bones[n], ax, az, g]);
      this.jolt = { p: 0, r: 0, vp: 0, vr: 0, h: 1 }; this.joints = t.joints; this.blend = null;
      this.flash = 0; this.guardUp = false; this.guardW = 0; this.guardBones = guardPose[o.g].map(([n, q]) => [this.bones[n], q]);
      this.allBones = Object.values(this.bones);
      if (o.king) {
        const crown = new THREE.Group();
        const band = new THREE.Mesh(new THREE.CylinderGeometry(0.105, 0.1, 0.06, 20, 1, true), goldM); band.material.side = THREE.DoubleSide; crown.add(band);
        for (let i = 0; i < 8; i++) { const s = new THREE.Mesh(new THREE.ConeGeometry(0.022, 0.09, 4), goldM); s.position.set(Math.cos(i * 0.785) * 0.102, 0.07, Math.sin(i * 0.785) * 0.102); crown.add(s); }
        crown.traverse(n => { n.castShadow = true; });
        const h = this.bones.Head;
        this.root.updateMatrixWorld(true);
        crown.quaternion.copy(h.getWorldQuaternion(q1).invert());
        crown.position.copy(h.worldToLocal(h.getWorldPosition(v1).add(v2.set(0, 0.2, 0.015))));
        h.add(crown);
        // a cape from the shoulders to the calves, hung off the upper spine so it follows the torso, with a slow sway
        const capeMat = new THREE.MeshStandardMaterial({ color: 0x4a1564, roughness: 0.75, side: THREE.DoubleSide });
        capeMat.onBeforeCompile = s => {
          s.uniforms.uT = Char.time;
          s.vertexShader = 'uniform float uT;\n' + s.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n float cf = 1.0 - uv.y; transformed.z -= cf * cf * 0.22 + sin(uT * 1.7 + position.x * 5.0 + cf * 4.0) * 0.03 * cf; transformed.x *= 1.0 + cf * 0.25;');
        };
        const cape = new THREE.Mesh(new THREE.PlaneGeometry(0.66, 1.15, 6, 12), capeMat);
        cape.castShadow = true;
        const sb = this.bones.spine_03, top = sb.getWorldPosition(new THREE.Vector3());
        cape.quaternion.copy(sb.getWorldQuaternion(q1).invert());
        cape.position.copy(sb.worldToLocal(v1.set(top.x, top.y + 0.2 - 0.575, top.z - 0.15)));
        sb.add(cape);
        for (const sx of [-0.2, 0.2]) {                               // gold clasps on the shoulders
          const clasp = new THREE.Mesh(new THREE.SphereGeometry(0.035, 12, 8), goldM);
          clasp.position.copy(sb.worldToLocal(v1.set(top.x + sx, top.y + 0.2, top.z - 0.06)));
          sb.add(clasp);
        }
      }
      this.mixer = new THREE.AnimationMixer(this.root);
      this.actions = {}; this.cur = null; this.base = null; this.busy = null; this.rag = null; this.dead = false;
      this.mixer.addEventListener('finished', e => { if (e.action === this.busy) { this.busy = null; this.lean = 0; if (this.base) this._go(this._act(this.base), 0.2); } });
      if (o.name) { this.tag = makeTag(o.name); this.tagAnchor.add(this.tag.sprite); }
      this.yaw = 0;
    }
    _act(name) { return this.actions[name] ??= this.mixer.clipAction(clips[this.g][name]); }
    _go(to, d) {
      const from = this.cur;
      if (from === to) return;
      to.enabled = true; to.setEffectiveWeight(1); to.play();
      if (from) from.crossFadeTo(to, d, false);
      this.cur = to;
    }
    setBase(name, ts = 1) {
      const a = this._act(name);
      a.timeScale = ts;
      if (this.base === name) return;
      this.base = name;
      if (!this.busy) { a.reset(); a.timeScale = ts; this._go(a, 0.2); }
    }
    // lean: torso pitch held for the duration of the clip (+ forward for low strikes, - back for high ones)
    oneShot(name, ts = 1, fade = 0.08, lean = 0) {
      const a = this._act(name);
      a.reset(); a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; a.timeScale = ts;
      this.busy = a; this.lean = lean; this._go(a, fade);
    }
    // 'arm' = strapped on and usable, 'back' = slung (two-handed weapon in hand), anything else = none
    setShield(mode) {
      if (!this.shield) {
        this.shield = new THREE.Group();
        for (const [geo, m] of shieldParts) { const p = new THREE.Mesh(geo, this.metal ? fitting(m, this.metal) : m); p.castShadow = true; this.shield.add(p); }
      }
      const to = mode === 'arm' ? this.shieldArm : mode === 'back' ? this.shieldBack : null;
      if (to) to.add(this.shield); else this.shield.removeFromParent();
    }
    // settle into the pose a clip has part-way through, and stay there
    freezeAt(name, frac, fade = 0.45) {
      const a = this._act(name);
      a.reset(); a.timeScale = 0; a.time = a.getClip().duration * frac;
      this.base = name; this.busy = null; this.lean = 0; this._go(a, fade);
    }
    // drop the current one-shot and fall back to whatever base loop is set next
    cancel() { if (this.busy) { this.busy = null; this.lean = 0; this.base = null; } }
    // freeze on the last frame of a clip (corpses for late joiners)
    pose(name) {
      const a = this._act(name);
      a.reset(); a.play(); a.time = a.getClip().duration - 0.01; a.paused = true;
      this.cur = a; this.mixer.update(0); this.dead = true;
      if (this.tag) this.tag.sprite.visible = false;
    }
    update(dt) {
      if (this.rag) { this._syncRag(dt); if (this.dead || this.rag) return; }
      if (this.dead) return;
      const real = dt;
      if (this.freeze > 0) { this.freeze -= dt; dt *= 0.05; }           // hit-stop: both fighters hang for a beat on impact
      this.mixer.update(dt);
      this.leanNow += (this.lean + this.flinch - this.leanNow) * Math.min(1, dt * 14);
      this.flinch *= Math.exp(-dt * 5);
      if (Math.abs(this.leanNow) > 0.004) for (const [b, axis] of this.leanBones) b.quaternion.multiply(q1.setFromAxisAngle(axis, this.leanNow * 0.5));
      // impact sway: the torso and head are a damped spring that every blow kicks, so the body rocks with the hit
      const j = this.jolt, h = Math.min(real, 0.033);
      j.vp += (-110 * j.p - 12 * j.vp) * h; j.p = Math.max(-0.9, Math.min(0.9, j.p + j.vp * h));
      j.vr += (-110 * j.r - 12 * j.vr) * h; j.r = Math.max(-0.9, Math.min(0.9, j.r + j.vr * h));
      if (Math.abs(j.p) + Math.abs(j.r) > 0.003) for (const [b, ax, az, g] of this.sway) {
        const k = g * (b.name === 'Head' ? (j.h === 2 ? 1.7 : 0.8) : (j.h === 2 ? 0.6 : 1));
        b.quaternion.multiply(q1.setFromAxisAngle(ax, j.p * k)).multiply(q1.setFromAxisAngle(az, j.r * k));
      }
      // eyes on the enemy: the head and neck turn toward whoever this fighter is dealing with, within what a neck can do
      this.lookNow = (this.lookNow || 0) + ((this.look || 0) - (this.lookNow || 0)) * Math.min(1, real * 6);
      if (Math.abs(this.lookNow) > 0.02) for (const [b, k] of (this.lookBones ??= [[this.bones.neck_01, 0.4], [this.bones.Head, 0.6]])) {
        b.parent.getWorldQuaternion(ikP);
        b.quaternion.premultiply(ikQ.copy(ikP).invert().multiply(ikR.setFromAxisAngle(UP, this.lookNow * k)).multiply(ikP));
      }
      // hit flash: armour and skin flare warm-white for a few frames when a blow lands
      if (this.flash > 0 || this.flashOn) {
        this.flash = Math.max(0, this.flash - real * 7); this.flashOn = this.flash > 0;
        for (const m of [this.body.material, this.outfit && this.outfit.material]) if (m) { m.emissive.setRGB(1, 0.85, 0.7); m.emissiveIntensity = this.flash * 0.4; }
      }
      // shield arm: eased up into the guard pose and back down, on top of the running, standing or reacting body
      this.guardW += ((this.guardUp ? 1 : 0) - this.guardW) * Math.min(1, real * 14);
      if (this.guardW > 0.02) for (const [b, q] of this.guardBones) b.quaternion.slerp(q, this.guardW);
      // Two-handed weapons are held in both hands. The clips are one-handed, so the right hand often carries the
      // weapon out of the left arm's reach; when it does, the right hand is drawn in toward the body just far enough
      // (the weapon keeps its direction), then the left hand is placed on the weapon, palm on the haft.
      this.offW = (this.offW || 0) + ((this.offhand ? 1 : 0) - (this.offW || 0)) * Math.min(1, real * 10);
      if (this.offhand) { this.offAt = this.offhand; this.offOn = this.offMesh; }
      if (this.offW > 0.02 && this.offOn && this.offOn.parent === this.grip) {
        const B = this.bones, w = this.offW, arms = this.ikArms ??= [B.upperarm_r, B.lowerarm_r, B.hand_r, B.upperarm_l, B.lowerarm_l, B.hand_l];
        for (let i = 0; i < 6; i++) ikSave[i].copy(arms[i].quaternion);
        const mesh = this.offOn;
        const haftPoint = () => { mesh.updateWorldMatrix(true, false); return ikT.copy(this.offAt).applyMatrix4(mesh.matrixWorld); };
        // 1. draw the right hand in until the spot for the left hand is within the left arm's reach
        haftPoint();
        B.upperarm_l.getWorldPosition(ikS); B.lowerarm_l.getWorldPosition(ikE); B.hand_l.getWorldPosition(ikH);
        const reach = (ikE.distanceTo(ikS) + ikH.distanceTo(ikE)) * 0.9 - this.palm, over = ikT.distanceTo(ikS) - reach;
        if (over > 0) {
          B.hand_r.getWorldQuaternion(ikHold);
          B.hand_r.getWorldPosition(ikG).addScaledVector(ikA.copy(ikS).sub(ikT).normalize(), over);
          reachTo(B.upperarm_r, B.lowerarm_r, B.hand_r, ikG);
          B.hand_r.parent.getWorldQuaternion(ikP); B.hand_r.quaternion.copy(ikP.invert().multiply(ikHold));     // the hand, and so the weapon, keeps pointing the way it was
          haftPoint();
        }
        // 2. left hand onto the weapon: the wrist stops a palm's width short, on the elbow's side of the haft
        B.lowerarm_l.getWorldPosition(ikE);
        ikB.setFromMatrixColumn(mesh.matrixWorld, this.offAxis ?? 1).normalize();          // the weapon's long axis there
        ikA.copy(ikE).sub(ikT); ikA.addScaledVector(ikB, -ikA.dot(ikB));
        if (ikA.lengthSq() < 1e-6) ikA.set(0, -1, 0); ikA.normalize();
        ikG.copy(ikT).addScaledVector(ikA, this.palm);
        reachTo(B.upperarm_l, B.lowerarm_l, B.hand_l, ikG);
        // the hand itself turns so the palm faces the haft
        B.hand_l.getWorldQuaternion(ikHold); B.hand_l.parent.getWorldQuaternion(ikP);
        ikR.setFromUnitVectors(ikG.copy(this.palmDir).applyQuaternion(ikHold).normalize(), ikA.negate());
        B.hand_l.quaternion.copy(ikP.invert().multiply(ikR).multiply(ikHold));
        if (w < 0.98) for (let i = 0; i < 6; i++) arms[i].quaternion.copy(ikSave[i].slerp(arms[i].quaternion, w));
      }
      // getting up after a knockdown: ease from where the ragdoll left the body back into the animation
      if (this.blend) {
        const k = (this.blend.t += real) / 0.5;
        if (k >= 1) this.blend = null;
        else {
          const e = k * k * (3 - 2 * k);
          for (const [b, q, p] of this.blend.list) { b.quaternion.copy(q2.copy(q).slerp(b.quaternion, e)); if (p) b.position.copy(v1.copy(p).lerp(b.position, e)); }
        }
      }
    }
    // a blow travelling along world (dx, dz): strength in rad/s of kick, h = 0 legs, 1 body, 2 head
    impulse(dx, dz, strength, h = 1) {
      const c = Math.cos(this.yaw), s = Math.sin(this.yaw), lx = dx * c - dz * s, lz = dx * s + dz * c;
      this.jolt.vp += lz * strength * (h === 0 ? -0.7 : 1);              // a leg hit folds you forward over it
      this.jolt.vr -= lx * strength; this.jolt.h = h;
    }
    // eyes, brows and beard are separate skinned draws: only worth it up close
    lod(near) { if (near !== this.near) { this.near = near; for (const n of this.detail) n.visible = near && n.userData.on; } }

    // temp = a knockdown: the fighter is alive and will get back up (see recover)
    ragdoll(vel, push, temp = false) {
      if (this.rag) { if (!temp) { this.rag.temp = false; this.dead = true; this.blend = null; if (this.tag) this.tag.sprite.visible = false; } return; }
      if (!temp) { this.dead = true; if (this.tag) this.tag.sprite.visible = false; }
      this.blend = null;
      for (const n of this.skinned) n.frustumCulled = false;      // the body leaves its root while it tumbles
      this.root.updateMatrixWorld(true);
      const bodies = {}, list = [];
      for (const [name, parent, child, rad] of RAG) {
        const b = this.bones[name];
        const p = b.getWorldPosition(V()), q = b.getWorldQuaternion(Q());
        const len = child ? this.bones[child].getWorldPosition(v1).distanceTo(p) : 0.14;
        const k = name === 'pelvis' || name === 'spine_02' ? 1 : 0.7;
        const rb = physics.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(p.x, Math.max(p.y, rad + 0.02), p.z).setRotation(q)
          .setLinvel(vel.x + push.x * k, vel.y + push.y * k, vel.z + push.z * k)
          .setAngvel({ x: (Math.random() - 0.5) * 1.5, y: (Math.random() - 0.5), z: (Math.random() - 0.5) * 1.5 })
          .setLinearDamping(0.5).setAngularDamping(4.5));
        const cd = (len > rad * 2.2 ? RAPIER.ColliderDesc.capsule(len / 2 - rad, rad) : RAPIER.ColliderDesc.ball(rad))
          .setTranslation(0, len / 2, 0).setCollisionGroups(0x00020009).setFriction(1).setRestitution(0.02).setDensity(name === 'Head' ? 400 : 1000);
        const col = physics.createCollider(cd, rb);
        if (parent) {
          const pb = bodies[parent], pp = pb.translation(), pq = pb.rotation();
          v1.copy(p).sub(pp).applyQuaternion(q1.set(pq.x, pq.y, pq.z, pq.w).invert());
          physics.createImpulseJoint(RAPIER.JointData.spherical({ x: v1.x, y: v1.y, z: v1.z }, { x: 0, y: 0, z: 0 }), pb, rb, true);
        }
        bodies[name] = rb; list.push([b, rb, parent ? this.joints[name] : null, parent ? bodies[parent] : null, col]);
      }
      this.rag = { list, t: 0, temp, follow: null };
      live.push(this);
      if (live.length > 14) live.shift().rag.cut = true;            // cap how many bodies simulate at once
    }
    // stand back up: drop the physics bodies and blend from the pose they left into the animation
    recover() {
      if (!this.rag || this.dead) return;
      this.blend = { t: 0, list: this.allBones.map(b => [b, b.quaternion.clone(), b.name === 'pelvis' ? b.position.clone() : null]) };
      this._endRag(new THREE.Vector3(0, 1, 0));
    }
    _endRag(centre) {
      for (const [, rb] of this.rag.list) physics.removeRigidBody(rb);
      this.rag = null;
      const li = live.indexOf(this); if (li >= 0) live.splice(li, 1);
      for (const n of this.skinned) { n.boundingSphere.center.copy(centre); n.frustumCulled = true; }
    }
    _syncRag(dt) {
      const r = this.rag;
      // Keep every joint inside what a body can do. The physics joints only pin the bones together, so after each
      // step anything bent too far is pulled back to its limit and loses its spin relative to the parent.
      for (const [, rb, J, prb] of r.list) {
        if (!J) continue;
        const a = prb.rotation(), b = rb.rotation();
        q1.set(a.x, a.y, a.z, a.w); q2.set(b.x, b.y, b.z, b.w);
        q3.copy(J.rel).invert().multiply(q4.copy(q1).invert().multiply(q2));        // rotation away from rest, in the child's frame
        if (q3.w < 0) q3.set(-q3.x, -q3.y, -q3.z, -q3.w);
        let fix = false;
        if (J.axis) {
          const d = q3.x * J.axis.x + q3.y * J.axis.y + q3.z * J.axis.z, th = 2 * Math.atan2(d, q3.w), c = Math.max(J.lo, Math.min(J.hi, th));
          q4.setFromAxisAngle(J.axis, c);
          fix = q3.angleTo(q4) > 0.06; if (fix) q3.copy(q4);
        } else {
          const ang = 2 * Math.acos(Math.min(1, q3.w));
          if (ang > J.max) { q4.copy(q3); q3.identity().slerp(q4, J.max / ang); fix = true; }
        }
        if (fix) {
          q1.multiply(J.rel).multiply(q3);
          rb.setRotation({ x: q1.x, y: q1.y, z: q1.z, w: q1.w }, true);
          rb.setAngvel(prb.angvel(), true);
        }
      }
      for (const [bone, rb] of r.list) {
        const t = rb.translation(), q = rb.rotation();
        bone.parent.getWorldQuaternion(q1).invert();
        bone.quaternion.copy(q1).multiply(q2.set(q.x, q.y, q.z, q.w));
        if (bone.name === 'pelvis') bone.position.copy(bone.parent.worldToLocal(v1.set(t.x, t.y, t.z)));
        bone.updateMatrix();
      }
      const pelvis = r.list[0][1], lv = pelvis.linvel(), at = pelvis.translation();
      r.t += dt;
      if (r.temp) {
        // knocked down but alive: the body slides with the fighter's real position so it gets up where it should
        if (r.follow) pelvis.setLinvel({ x: (r.follow.x - at.x) * 5, y: lv.y, z: (r.follow.z - at.z) * 5 }, true);
        if (r.cut || r.t > 3) this.recover();
        return;
      }
      // A corpse must end up on the sand. Bodies bounce off living fighters at first, but that can leave one propped
      // upright against somebody; after a moment (or when the simulation budget is needed) it stops colliding with the
      // living and only the ground holds it. It is only frozen once it is actually lying down.
      if (!r.loose && (r.t > 1.4 || r.cut)) { r.loose = true; for (const e of r.list) e[4].setCollisionGroups(0x00020001); }
      // Nobody dies sitting up: a body that has come to rest on its knees or haunches is tipped over, and it is not
      // frozen until the head is down as well.
      r.head ??= r.list.find(e => e[0].name === 'Head')[1];
      const hy = r.head.translation().y;
      if (r.t > 1.6 && hy > 0.55) {
        r.tip ??= Math.random() * 6.283;
        const hv = r.head.linvel();
        r.head.setLinvel({ x: hv.x + (Math.cos(r.tip) * 2.2 - hv.x) * 0.2, y: Math.min(hv.y, -0.6), z: hv.z + (Math.sin(r.tip) * 2.2 - hv.z) * 0.2 }, true);
      }
      const low = at.y < 0.45 && hy < 0.55, still = lv.x * lv.x + lv.y * lv.y + lv.z * lv.z < 0.04;
      if ((low && (r.cut || r.t > 4.5 || (r.t > 1.2 && still))) || r.t > 12) {
        this._endRag(this.root.worldToLocal(this.bones.pelvis.getWorldPosition(new THREE.Vector3())));
      }
    }
  }

  return { Char, clips, STYLES };
}
