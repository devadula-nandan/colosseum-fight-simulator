// Procedural prop meshes: weapons (grip at origin, business end along +Y) and the prize chest.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const mat = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0, ...o });
const steel = mat(0xdfe4ea, { metalness: 1, roughness: 0.25 });
const bronze = mat(0xb9853c, { metalness: 1, roughness: 0.35 });
const iron = mat(0x3d3d42, { metalness: 0.9, roughness: 0.5 });
const wood = mat(0x6b4423, { roughness: 0.8 });
const leather = mat(0x3a2414, { roughness: 0.9 });
const gold = mat(0xe6c378, { metalness: 1, roughness: 0.22 });

const cyl = (rt, rb, h, s = 12) => new THREE.CylinderGeometry(rt, rb, h, s);
const box = (x, y, z) => new THREE.BoxGeometry(x, y, z);
const sph = (r, w = 16, h = 12) => new THREE.SphereGeometry(r, w, h);

function part(g, geo, m, p = [0, 0, 0], r = [0, 0, 0], s = [1, 1, 1]) {
  const o = new THREE.Mesh(geo, m);
  o.position.set(...p); o.rotation.set(...r); o.scale.set(...s);
  o.castShadow = true;
  g.add(o);
  return o;
}

// Each is built with the grip at the origin, the business end along +Y and the striking edge toward +X
// (which is the way the knuckles face in the hand).
const BUILD = {
  dagger(g) {
    part(g, cyl(0.016, 0.016, 0.11), wood);
    part(g, sph(0.022), bronze, [0, -0.06, 0]);
    part(g, box(0.09, 0.02, 0.035), bronze, [0, 0.06, 0]);
    part(g, cyl(0.004, 0.03, 0.26, 4), steel, [0, 0.2, 0], [0, 0, 0], [1, 1, 0.25]);
  },
  sword(g) {
    part(g, cyl(0.018, 0.018, 0.13), wood);
    part(g, sph(0.028), bronze, [0, -0.075, 0]);
    part(g, box(0.16, 0.025, 0.045), bronze, [0, 0.075, 0]);
    part(g, cyl(0.034, 0.042, 0.48, 4), steel, [0, 0.33, 0], [0, 0, 0], [1, 1, 0.2]);
    part(g, new THREE.ConeGeometry(0.034, 0.1, 4), steel, [0, 0.62, 0], [0, 0, 0], [1, 1, 0.2]);
  },
  longsword(g) {
    part(g, cyl(0.019, 0.019, 0.24), wood, [0, -0.04, 0]);
    part(g, sph(0.032), iron, [0, -0.17, 0]);
    part(g, box(0.26, 0.028, 0.05), iron, [0, 0.09, 0]);
    part(g, cyl(0.03, 0.045, 0.78, 4), steel, [0, 0.49, 0], [0, 0, 0], [1, 1, 0.18]);
    part(g, new THREE.ConeGeometry(0.03, 0.12, 4), steel, [0, 0.94, 0], [0, 0, 0], [1, 1, 0.18]);
  },
  mace(g) {
    part(g, cyl(0.018, 0.02, 0.5), wood, [0, 0.17, 0]);
    part(g, cyl(0.024, 0.024, 0.05), iron, [0, -0.08, 0]);
    part(g, sph(0.062), iron, [0, 0.47, 0]);
    for (let i = 0; i < 6; i++) part(g, box(0.05, 0.13, 0.016), iron, [Math.cos(i * 1.047) * 0.062, 0.47, Math.sin(i * 1.047) * 0.062], [0, -i * 1.047, 0]);
    part(g, new THREE.ConeGeometry(0.02, 0.07, 6), iron, [0, 0.56, 0]);
  },
  axe(g) {
    part(g, cyl(0.02, 0.022, 0.78), wood, [0, 0.27, 0]);
    part(g, new THREE.CylinderGeometry(0.19, 0.19, 0.022, 20, 1, false, -0.95, 1.9), steel, [-0.02, 0.56, 0], [Math.PI / 2, 0, 0]);   // the crescent blade
    part(g, box(0.07, 0.11, 0.05), iron, [0, 0.56, 0]);
    part(g, new THREE.ConeGeometry(0.03, 0.1, 4), iron, [-0.08, 0.56, 0], [0, 0, Math.PI / 2]);
  },
  hammer(g) {
    part(g, cyl(0.021, 0.023, 0.82), wood, [0, 0.29, 0]);
    part(g, box(0.2, 0.12, 0.12), iron, [0.02, 0.66, 0]);
    part(g, box(0.03, 0.14, 0.14), bronze, [0.11, 0.66, 0]);
    part(g, new THREE.ConeGeometry(0.04, 0.13, 4), iron, [-0.14, 0.66, 0], [0, 0, Math.PI / 2]);
  },
  spear(g) {
    part(g, cyl(0.015, 0.017, 1.8), wood, [0, 0.5, 0]);
    part(g, cyl(0.02, 0.02, 0.06), bronze, [0, 1.4, 0]);
    part(g, new THREE.ConeGeometry(0.035, 0.24, 4), steel, [0, 1.54, 0], [0, 0, 0], [1, 1, 0.35]);
  },
  trident(g) {
    part(g, cyl(0.016, 0.018, 1.35), wood, [0, 0.32, 0]);
    part(g, box(0.24, 0.03, 0.03), steel, [0, 1.0, 0]);
    for (const x of [-0.11, 0, 0.11]) part(g, cyl(0.003, 0.013, x ? 0.2 : 0.28, 8), steel, [x, x ? 1.1 : 1.14, 0]);
  },
  javelin(g) {
    part(g, cyl(0.011, 0.013, 1.35), wood, [0, 0.18, 0]);
    part(g, cyl(0.016, 0.016, 0.16), leather, [0, 0, 0]);
    part(g, new THREE.ConeGeometry(0.02, 0.2, 6), steel, [0, 0.95, 0]);
  },
  bow(g) {
    // a recurve held at its middle: the belly curves toward +X (forward when aiming), string behind
    const R = 0.62, A = 1.9;
    part(g, new THREE.TorusGeometry(R, 0.013, 6, 22, A), wood, [-R, 0, 0], [0, 0, -A / 2]);
    part(g, cyl(0.018, 0.018, 0.14), leather);
    const tx = R * Math.cos(A / 2) - R, ty = R * Math.sin(A / 2);
    part(g, cyl(0.003, 0.003, ty * 2, 4), mat(0xe8e0c8, { roughness: 0.9 }), [tx, 0, 0]);
  },
  crossbow(g) {
    // held like a pistol: stock runs forward along +X, the prod lies across it
    part(g, box(0.5, 0.045, 0.05), wood, [0.16, 0.05, 0]);
    part(g, box(0.04, 0.12, 0.04), wood, [-0.02, -0.02, 0]);
    part(g, box(0.03, 0.025, 0.56), iron, [0.38, 0.06, 0]);
    part(g, cyl(0.003, 0.003, 0.56, 4), mat(0xe8e0c8, { roughness: 0.9 }), [0.3, 0.06, 0], [Math.PI / 2, 0, 0]);
    part(g, cyl(0.007, 0.007, 0.34, 6), wood, [0.26, 0.08, 0], [0, 0, Math.PI / 2]);
  },
};

const SCALE = {};                                       // per-weapon size tweak; models are built at real size
const cache = {};
export function makeWeapon(id) {
  if (!cache[id]) {
    // build from parts, then merge per material so a weapon costs 2-3 draw calls instead of 5-8
    const parts = new THREE.Group(), byMat = new Map();
    BUILD[id](parts);
    for (const m of parts.children) {
      m.updateMatrix();
      const k = SCALE[id] || 1, geo = m.geometry.clone().applyMatrix4(m.matrix).scale(k, k, k);
      byMat.set(m.material, [...(byMat.get(m.material) || []), geo.index ? geo.toNonIndexed() : geo]);
    }
    cache[id] = [...byMat].map(([material, geos]) => [mergeGeometries(geos), material]);
  }
  const g = new THREE.Group();
  for (const [geo, material] of cache[id]) { const m = new THREE.Mesh(geo, material); m.castShadow = true; g.add(m); }
  return g;
}

// rough half-extents for the physics box of a dropped weapon: [x, y, z] with y the long axis
// how far each weapon's tip is from the grip (metres): used for swing trails
export const WEAPON_LEN = { dagger: 0.33, longsword: 1.0, mace: 0.6, spear: 1.66, javelin: 1.05, axe: 0.72, hammer: 0.72, trident: 1.28 };

// where the second hand goes on a two-handed weapon, in the weapon's own frame (grip at the origin)
export const WEAPON_OFFHAND = { axe: [0, 0.26, 0], hammer: [0, 0.28, 0], trident: [0, 0.4, 0], crossbow: [0.24, 0.02, 0], bow: [-0.259, 0, 0] };

export const WEAPON_BOX = {
  dagger: [0.04, 0.17, 0.02], sword: [0.07, 0.34, 0.02], longsword: [0.1, 0.52, 0.02], mace: [0.07, 0.3, 0.07], axe: [0.14, 0.38, 0.03],
  hammer: [0.13, 0.4, 0.07], spear: [0.03, 0.85, 0.03], trident: [0.12, 0.62, 0.02], javelin: [0.02, 0.6, 0.02], bow: [0.12, 0.5, 0.02], crossbow: [0.26, 0.06, 0.28],
};

// an arrow / bolt, pointing along +Z
export function makeArrow() {
  const g = new THREE.Group();
  part(g, cyl(0.007, 0.007, 0.62, 5), wood, [0, 0, 0], [Math.PI / 2, 0, 0]);
  part(g, new THREE.ConeGeometry(0.016, 0.07, 5), steel, [0, 0, 0.34], [Math.PI / 2, 0, 0]);
  for (const r of [0, Math.PI / 2]) part(g, box(0.05, 0.002, 0.09), mat(0xd9d2c0, { roughness: 0.9, side: THREE.DoubleSide }), [0, 0, -0.27], [0, 0, r]);
  return g;
}

export function makeChest() {
  const g = new THREE.Group();
  const dark = mat(0x4a2c14, { roughness: 0.7 });
  part(g, box(0.56, 0.3, 0.36), dark, [0, 0.15, 0]);
  for (const x of [-0.2, 0.2]) part(g, box(0.05, 0.31, 0.37), gold, [x, 0.15, 0]);
  part(g, box(0.5, 0.02, 0.3), mat(0xffd76a, { emissive: 0xffb300, emissiveIntensity: 3 }), [0, 0.3, 0]);
  const lid = new THREE.Group(); lid.position.set(0, 0.3, -0.18); g.add(lid);
  part(lid, cyl(0.18, 0.18, 0.56, 16, 1), dark, [0, 0, 0.18], [0, 0, Math.PI / 2], [1, 1, 1]).geometry = new THREE.CylinderGeometry(0.18, 0.18, 0.56, 16, 1, false, -Math.PI / 2, Math.PI);
  for (const x of [-0.2, 0.2]) part(lid, new THREE.CylinderGeometry(0.185, 0.185, 0.05, 16, 1, false, -Math.PI / 2, Math.PI), gold, [x, 0, 0.18], [0, 0, Math.PI / 2]);
  part(g, box(0.07, 0.09, 0.02), gold, [0, 0.27, 0.185]);
  const glow = new THREE.PointLight(0xffc040, 0, 6); glow.position.set(0, 0.5, 0); g.add(glow);
  g.userData = { lid, glow };
  return g;
}

export { gold, bronze };
