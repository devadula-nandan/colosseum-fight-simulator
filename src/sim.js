// Seeded fight simulation. Pure logic: no rendering, no DOM, runs in Node.
// Every viewer of the same link runs this with the same seed and must get the same fight,
// so: fixed timestep, one seeded RNG, and only + - * / sqrt (no sin/cos/atan2/hypot, whose
// last bits differ between browsers).
import { WEAPONS, WEAPON_BY_ID, FISTS } from './weapons.js';

export const DT = 1 / 60;
export const RX = 32, RZ = 22;          // arena ellipse radii, metres
const SPEED = 4.3, RADIUS = 0.38;
const DMG = 0.3;                        // global pacing knob: lower = longer fights

function mulberry32(a) {
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// players: [{ name, g: 'm' | 'f' | 'r' }]
// opts.loadout: [weapon id per fighter]: everyone starts armed and nothing lies on the sand (used by balance.js)
export function createSim(players, seed, opts = {}) {
  const rand = mulberry32(seed >>> 0);
  const S = { t: 0, tick: 0, fighters: [], items: [], shots: [], shotId: 0, events: [], winner: null, alive: players.length };
  const F = S.fighters, I = S.items;
  const emit = (type, e) => { e.type = type; e.t = S.t; S.events.push(e); };

  const inArena = (x, z, m) => (x * x) / (RX * RX * m * m) + (z * z) / (RZ * RZ * m * m) <= 1;
  function randomSpot(m) {
    for (;;) {
      const x = (rand() * 2 - 1) * RX * m, z = (rand() * 2 - 1) * RZ * m;
      if (inArena(x, z, m)) return [x, z];
    }
  }

  players.forEach((p, id) => {
    // spawn on a ring near the wall, spaced apart where possible
    let x = 0, z = 0;
    for (let tries = 0; tries < 40; tries++) {
      let dx, dz, l;
      do { dx = rand() * 2 - 1; dz = rand() * 2 - 1; l = Math.sqrt(dx * dx + dz * dz); } while (l < 0.2 || l > 1);
      x = dx / l * RX * 0.86; z = dz / l * RZ * 0.86;
      if (F.every(o => (o.x - x) * (o.x - x) + (o.z - z) * (o.z - z) > 6)) break;
    }
    const l = Math.sqrt(x * x + z * z);
    F.push({
      id, name: p.name, g: p.g === 'm' || p.g === 'f' ? p.g : (rand() < 0.5 ? 'm' : 'f'),
      x, z, vx: 0, vz: 0, kx: 0, kz: 0, fx: -x / l, fz: -z / l,
      hp: 100, alive: true, item: null, kills: 0, act: 'idle',
      cd: 0, stun: 0, slow: 0, think: rand() * 0.3, flee: 0, fleeCd: 0,
      swing: null, pick: null, goal: null, near: null, grudge: null, dodge: 0, dodgeType: 1, guard: 0, slamCd: 0, taunt: 0,
      safe: 0, steady: 0, hurt: 0, eng: false, lockT: 0, combo: 0, comboBy: -1, comboT: 0, fleeX: 0, fleeZ: 0,
      pace: 0.92 + rand() * 0.16, strafe: rand() < 0.5 ? 1 : -1, look: 0.7 + rand() * 0.6,
      // personality: these make fighters behave differently from each other
      brave: rand(), greed: rand(), agile: 0.5 + rand(), mean: rand(), shield: true,
    });
  });

  // loot: one of everything, then extras in proportion, scaled to the head count
  // Everyone starts with a long sword and a shield. The special weapons (one of each, then extras in proportion to the
  // head count) are piled around the centre for whoever wants to trade up.
  if (opts.loadout) {
    opts.loadout.forEach((wid, id) => { if (wid === 'fists') return; const it = { id: I.length, wid, x: F[id].x, z: F[id].z, holder: F[id], air: false, broken: false, drops: 0 }; I.push(it); F[id].item = it; });
  } else {
    F.forEach(f => { const it = { id: I.length, wid: 'longsword', x: f.x, z: f.z, holder: f, air: false, broken: false, drops: 0 }; I.push(it); f.item = it; });
    const special = WEAPONS.filter(w => w.count > 0);
    const want = Math.max(special.length, Math.ceil(players.length * 0.9));     // nearly one each
    const pool = special.flatMap(w => Array(w.count).fill(w.id));
    const loot = special.map(w => w.id);
    while (loot.length < want) loot.push(pool[Math.floor(rand() * pool.length)]);
    const spread = Math.min(0.5, 0.2 + want * 0.004);                    // a bigger pile for a bigger crowd
    for (const wid of loot) {
      const [x, z] = randomSpot(spread);
      I.push({ id: I.length, wid, x, z, holder: null, air: false, broken: false, drops: 0 });
    }
  }

  const weaponOf = f => f.item ? WEAPON_BY_ID[f.item.wid] : FISTS;
  // A shield blocks only from the front, only when the fighter can act, and only while a one-handed weapon is in hand
  // (with a two-handed weapon it is slung on the back).
  const BLOCK = 0.12;                                                  // chance a shield happens to catch something its owner was not braced for (a stray arrow, a blow meant for someone else)
  const shieldUp = o => o.shield && (weaponOf(o).hands || 1) < 2 && o.stun <= 0 && o.dodge <= 0 && o.taunt <= 0 && !o.pick;
  const tierOf = it => it ? (it.broken ? 2 : WEAPON_BY_ID[it.wid].tier) : 0;
  const dist = (a, b) => Math.sqrt((a.x - b.x) * (a.x - b.x) + (a.z - b.z) * (a.z - b.z));

  function drop(f, x, z) {
    const it = f.item;
    if (!it) return;
    it.holder = null; it.x = x; it.z = z; it.drops++; f.item = null;
    emit('drop', { id: f.id, item: it.id });
  }

  function die(f, by, w, banned, dx, dz) {
    if (!f.alive) return;
    f.alive = false; f.hp = 0; f.swing = f.pick = null; f.act = 'dead';
    S.alive--;
    emit('death', { id: f.id, by: by.id, wid: w.id, banned, dx, dz, kb: w.kb });
    drop(f, f.x, f.z);
    by.kills++; by.hp = Math.min(100, by.hp + 15);
    if (by.brave > 0.55 && rand() < 0.5 && S.alive > 2) by.taunt = 1.3;      // showboating leaves you open
    if (S.alive === 1) { S.winner = F.find(o => o.alive); emit('win', { id: S.winner.id }); }
  }

  // ---- combat geometry ----
  // A swing is a real sweep. The weapon is a segment from the hand to the tip that rotates through an arc (or lunges
  // straight out) over several ticks, at head, body or leg height. Whoever's body it touches first is hit: the intended
  // target, a bystander, or nobody if the target stepped, rolled, ducked or hopped clear. A raised guard or a
  // simultaneous swing at the same height turns it into a weapon clash instead.
  const ROT_C = 0.9950041652780258, ROT_S = 0.09983341664682815;        // cos and sin of 0.1 rad, as literals (see header)
  // style: [arc half-width in 0.1 rad steps (0 = thrust), bodies it can pass through]
  // (arcs are kept fairly tight, about 35 to 45 degrees either side, so a blow goes where it was aimed rather than into the crowd)
  const ARCHER_PULL = 4.5;      // tuned with `node src/melee.js` so bows do not own every crowd fight
  const STYLE = { fists: [4, 1], thrust: [0, 1], blade: [6, 1], light: [5, 1], heavy: [8, 2], thrown: [0, 1], bow: [0, 1], crossbow: [0, 1] };
  // [wind-up, active, recovery] seconds for a low, mid and high swing. Measured from the animation clips: wind-up ends
  // where the weapon tip reaches furthest forward in the clip that is played for that swing (see SWING in main.js), so
  // the clip runs at its natural speed and the blade meets the body on the frame the sim registers the hit. The fighter
  // is rooted for all three phases: no sliding mid-swing, and a missed heavy swing leaves a real opening.
  const TIMING = {
    fists: [[0.225, 0.1, 0.3], [0.225, 0.1, 0.3], [0.225, 0.1, 0.3]],
    blade: [[0.28, 0.1, 0.35], [0.2, 0.1, 0.14], [0.37, 0.1, 0.45]],
    light: [[0.21, 0.1, 0.22], [0.14, 0.1, 0.1], [0.23, 0.1, 0.25]],
    thrust: [[0.28, 0.1, 0.4], [0.28, 0.1, 0.4], [0.37, 0.1, 0.45]],
    heavy: [[0.37, 0.14, 0.4], [0.26, 0.14, 0.22], [0.49, 0.14, 0.5]],
    thrown: [[0.4, 0.05, 0.35], [0.4, 0.05, 0.35], [0.4, 0.05, 0.35]],
    bow: [[0.75, 0.05, 0.3], [0.75, 0.05, 0.3], [0.75, 0.05, 0.3]],          // nock, draw, loose
    crossbow: [[0.45, 0.05, 0.5], [0.45, 0.05, 0.5], [0.45, 0.05, 0.5]],     // quick to level; the long reload is its cooldown
  };
  const styleOf = w => w.style;

  // can a swing at height h (0 legs, 1 body, 2 head) connect with o right now?
  function exposed(o, h) {
    if (o.safe > 0) return false;                                       // just been hit: a beat of grace before the next blow can land
    if (o.act === 'slip') return h === 0;                               // flat on the sand: only low blows land
    if (o.dodge > 0 && o.dodgeType === 2 && h === 2) return false;      // ducked under it
    if (o.dodge > 0 && o.dodgeType === 0 && h === 0) return false;      // hopped over it
    return true;
  }

  function startSwing(f, e, w) {
    const d = dist(f, e) || 0.001, dx = (e.x - f.x) / d, dz = (e.z - f.z) / d;
    const style = styleOf(w), [half, pierce] = STYLE[style];
    const h = e.act === 'slip' ? 0 : Math.floor(rand() * 3), side = rand() < 0.5 ? 1 : -1;
    const [wind, act, rec] = TIMING[style][h];
    let wx = dx, wz = dz;                                               // weapon direction: starts wound back to one side
    for (let i = 0; i < half; i++) { const x = wx * ROT_C + wz * ROT_S * side; wz = wz * ROT_C - wx * ROT_S * side; wx = x; }
    f.swing = { w, t: 0, wind, act, rec, h, side, half, dx, dz, wx, wz, done: 0, pierce, hits: [], target: e.id, over: false };
    f.fx = dx; f.fz = dz; f.cd = Math.max(w.cd, wind + act + rec + 0.1);
    f.combo = 0;                                                        // fighting back clears any combo being run on you
    f.kx += dx * 0.9; f.kz += dz * 0.9;                                 // a short step into it
    emit('attack', { id: f.id, wid: w.id, target: e.id, h, wind, act, style });
    // the target may see it coming and react: dodge (not always the right way), or raise a guard
    const facing = -(e.fx * dx + e.fz * dz);                            // 1 = looking straight at the attacker
    if (e.stun > 0 || e.swing || e.pick || e.taunt > 0 || e.dodge > 0 || e.guard > 0 || facing < -0.2) return;
    const tw = weaponOf(e), quick = e.slow > 0 ? 0.4 : 1;
    if (rand() < 0.26 * e.agile * quick) {
      const type = rand() < 0.75 ? h : (h + 1 + Math.floor(rand() * 2)) % 3;
      e.dodge = type === 1 ? Math.max(0.7, wind + act + 0.1) : wind + act + 0.2; e.dodgeType = type;
      if (type === 1) {                                                   // roll out sideways, toward open sand
        const side = (-dz * e.x + dx * e.z) > 0 ? -1 : 1;
        e.kx += -dz * side * 6.5; e.kz += dx * side * 6.5;
      }
      else if (type === 0) { e.kx += dx * 3.5; e.kz += dz * 3.5; }                        // hop back
      emit('dodge', { a: f.id, b: e.id, h: type });
    } else if ((tw !== FISTS || shieldUp(e)) && rand() < (shieldUp(e) ? 0.4 : 0.12)) {      // sees it coming and sets a guard
      // The shield comes up during the attacker's wind-up, so a block is visible before the blow lands. Against a missile
      // the guard is held for the flight time as well.
      e.guard = wind + act + 0.15 + (w.shoot || w.thrown ? d / 30 : 0); e.fx = -dx; e.fz = -dz;
      emit('block', { id: e.id });
    }
  }

  // a weapon (or thrown object) travelling along (tx, tz) has touched o at (cx, cz)
  function strike(f, o, w, it, h, tx, tz, cx, cz) {
    const d = dist(f, o) || 0.001, rx = (o.x - f.x) / d, rz = (o.z - f.z) / d;
    const back = o.fx * rx + o.fz * rz > 0.3;                           // o is facing away: no defence, and it hurts more
    o.grudge = f;
    const clash = !back && (o.guard > 0 || (o.swing && o.swing.t >= o.swing.wind * 0.5 && o.swing.h === h && o.fx * rx + o.fz * rz < -0.5));
    // shield: a raised guard always holds (see startSwing: the defender decides during the wind-up). It stops arrows and
    // javelins too, and now and then catches something its owner was not braced for.
    if (!back && shieldUp(o) && (o.guard > 0 || ((w.thrown || w.shoot || o.id !== f.swing?.target) && rand() < BLOCK))) {
      o.guard = 0; o.safe = 0.25; o.kx += rx * 1.2; o.kz += rz * 1.2;
      if (!w.thrown && !w.shoot) { f.cd += 0.15; if (f.swing) f.swing.over = true; }
      emit('shield', { a: f.id, b: o.id, x: cx, z: cz, h, missile: !!(w.thrown || w.shoot) });
      return false;
    }
    if (clash && !w.thrown && !w.shoot) {
      f.stun = Math.max(f.stun, 0.25); f.swing = null; o.guard = 0;
      f.kx -= rx * 2.5; f.kz -= rz * 2.5; o.kx += rx * 1.5; o.kz += rz * 1.5;
      emit('clash', { a: f.id, b: o.id, x: cx, z: cz, h });
      return false;
    }
    const crit = rand() < w.crit, banned = !!w.ban && rand() < w.ban;
    // high = head and shoulders (hurts most, can daze), low = legs (hobbles), mid = body
    let dmg = DMG * w.dmg * (it && it.broken ? 0.5 : 1) * (0.8 + 0.4 * rand()) * (crit ? (w.critMul || 2.5) : 1) * (h === 2 ? 1.3 : h === 0 ? 0.85 : 1) * (back ? (w.back || 1.3) : 1);
    if (banned) dmg = 9999;
    if (w.breakChance && it && !it.broken && rand() < w.breakChance) { it.broken = true; emit('break', { id: f.id, item: it.id }); }
    let slipped = false;
    // Fairness: nobody gets locked down.
    //  - after any hit the victim cannot be hit again for a moment
    //  - once stunned or floored, they cannot be stunned again until they have had a few seconds on their feet
    //  - two unanswered hits from the same attacker and the victim shoves them off: the attacker is left winded
    //    and the victim gets the next move
    o.safe = 0.35; o.hurt = 0.28;                                       // staggered: cannot act for a moment (and cannot be hit again)
    // Being hit stops whatever swing you had not landed yet: whoever connects first wins the exchange. (A swing already
    // in its follow-through just finishes.) You get most of the cooldown back so you can answer.
    // A dagger nick is too light to stop a committed swing.
    if (o.swing && !o.swing.over && (w.style !== 'light' || o.swing.t < o.swing.wind * 0.6)) { o.swing = null; o.cd = Math.min(o.cd, 0.45); }   // (it only stops a swing early in its wind-up)
    const canStun = o.steady <= 0;
    let stunFor = 0;
    if (w.stun && canStun) stunFor = w.stun;
    if (w.knock && canStun && rand() < w.knock) { stunFor = 1.1; slipped = true; }   // knocked off their feet
    if (w.slow) o.slow = w.slow;
    if (h === 2 && canStun && rand() < 0.15) stunFor = Math.max(stunFor, 0.5);
    if (stunFor > 0) { o.stun = Math.max(o.stun, stunFor); o.steady = stunFor + 3; }
    if (h === 0) o.slow = Math.max(o.slow, 1.2);
    o.taunt = 0; o.pick = null; o.guard = 0;
    if (o.comboBy === f.id && o.comboT > 0) o.combo++; else { o.combo = 1; o.comboBy = f.id; }
    o.comboT = 2.5;
    let shove = false;
    if (o.combo >= 2 && !banned) {
      shove = true; o.combo = 0;
      f.cd = Math.max(f.cd, 0) + 0.9; f.kx -= rx * 5; f.kz -= rz * 5;
      o.cd = 0; o.stun = Math.min(o.stun, 0.15); o.safe = 0.6; o.hurt = 0.12;
    }
    // knockback follows the blow: mostly along the weapon's travel, partly away from the attacker
    let kx = tx * 0.75 + rx * 0.6, kz = tz * 0.75 + rz * 0.6;
    const kl = Math.sqrt(kx * kx + kz * kz) || 1, kb = Math.min(w.kb, 6.5) * (crit ? 1.3 : 1);   // a stagger, not a launch
    kx /= kl; kz /= kl;
    o.kx += kx * kb; o.kz += kz * kb;
    o.hp -= dmg;
    emit('hit', { a: f.id, b: o.id, dmg, crit, wid: w.id, slipped, stunned: stunFor > 0 && !slipped, h, x: cx, z: cz, dx: kx, dz: kz, back });
    if (shove && o.hp > dmg) emit('shove', { a: o.id, b: f.id });
    if (slipped && o.hp > 0) o.act = 'slip';
    if (o.hp <= 0) die(o, f, w, banned, kx, kz);
    return true;
  }

  // advance one fighter's swing by a tick; returns false once it is over
  function sweep(f) {
    const sw = f.swing, w = sw.w, it = f.item;
    sw.t += DT;
    if (sw.t < sw.wind) return true;
    if (sw.over) return sw.t < sw.wind + sw.act + sw.rec;                 // recovering: rooted until the follow-through ends
    if (w.shoot) {                                                       // loose: one arrow, or a spread of three bolts
      for (let n = 0; n < w.shoot; n++) {
        let dx = sw.dx, dz = sw.dz;
        const turn = n === 1 ? 1 : n === 2 ? -1 : 0;                       // the 2nd and 3rd bolt fan out 0.1 rad either side
        if (turn) { const x = dx * ROT_C - dz * ROT_S * turn; dz = dz * ROT_C + dx * ROT_S * turn; dx = x; }
        S.shots.push({ id: S.shotId++, it: null, w, by: f, x: f.x + dx * 0.6, z: f.z + dz * 0.6, dx, dz, left: w.reach, sub: 2, h: sw.h === 0 ? 1 : sw.h });
      }
      emit('shoot', { a: f.id, wid: w.id });
      sw.over = true;
      return true;
    }
    if (w.thrown) {                                                      // release: it becomes a projectile
      it.holder = null; it.air = true; f.item = null;
      S.shots.push({ id: S.shotId++, it, w, by: f, x: f.x + sw.dx * 0.5, z: f.z + sw.dz * 0.5, dx: sw.dx, dz: sw.dz, left: w.reach, sub: 1, h: sw.h === 0 ? 1 : sw.h });
      it.x = f.x; it.z = f.z;
      emit('throw', { a: f.id, item: it.id });
      sw.over = true;
      return true;
    }
    const p = Math.min(1, (sw.t - sw.wind) / sw.act), want = sw.half ? Math.floor(p * sw.half * 2) : 1;
    for (let n = sw.half ? sw.done : 0; n < want; n++) {
      let tx = sw.dx, tz = sw.dz, from = 0.3, to = 0.4 + (w.reach - 0.4) * p;
      if (sw.half) {                                                     // rotate the weapon one 0.1 rad notch across the arc
        const x = sw.wx * ROT_C - sw.wz * ROT_S * sw.side; sw.wz = sw.wz * ROT_C + sw.wx * ROT_S * sw.side; sw.wx = x;
        tx = -sw.wz * sw.side; tz = sw.wx * sw.side; to = w.reach;
      } else { sw.wx = sw.dx; sw.wz = sw.dz; }
      const ax = f.x + sw.wx * from, az = f.z + sw.wz * from, len = to - from;
      // nearest body along the weapon wins
      let hitO = null, hitT = 2;
      for (const o of F) {
        if (!o.alive || o === f || sw.hits.includes(o.id) || !exposed(o, sw.h)) continue;
        let t = ((o.x - ax) * sw.wx + (o.z - az) * sw.wz) / len;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const cx = ax + sw.wx * len * t - o.x, cz = az + sw.wz * len * t - o.z;
        if (cx * cx + cz * cz <= RADIUS * RADIUS && t < hitT) { hitT = t; hitO = o; }
      }
      if (hitO) {
        sw.hits.push(hitO.id);
        const landed = strike(f, hitO, w, it, sw.h, tx, tz, ax + sw.wx * len * hitT, az + sw.wz * len * hitT);
        if (!f.swing || S.winner) return false;                          // clashed, or that was the last kill
        if (!landed || sw.hits.length >= sw.pierce) { sw.over = true; return true; }   // the weapon stops in the body it hit
      }
    }
    sw.done = want;
    if (p >= 1) { if (!sw.hits.length) emit('miss', { a: f.id }); sw.over = true; }
    return true;
  }

  // thrown weapons fly as real projectiles and hit whoever is in the way
  // Missiles are real projectiles: they fly straight and hit whoever is in the way. A javelin (18 m/s) is the weapon
  // itself and lands where it stops; arrows and bolts (36 m/s) are spent.
  function flyShots() {
    for (let i = S.shots.length - 1; i >= 0; i--) {
      const q = S.shots[i], it = q.it;
      let done = false, hit = false;
      for (let n = 0; n < q.sub && !done; n++) {
        q.x += q.dx * 0.3; q.z += q.dz * 0.3; q.left -= 0.3;
        done = q.left <= 0 || !inArena(q.x, q.z, 0.95);
        for (const o of F) {
          if (done || !o.alive || o === q.by || !exposed(o, q.h)) continue;
          const dx = o.x - q.x, dz = o.z - q.z;
          if (dx * dx + dz * dz < (RADIUS + 0.08) * (RADIUS + 0.08)) { strike(q.by, o, q.w, it, q.h, q.dx, q.dz, q.x, q.z); done = hit = true; }
        }
      }
      if (it) { it.x = q.x; it.z = q.z; }
      if (done) {
        if (it) {
          if (!inArena(it.x, it.z, 0.95)) { it.x -= q.dx * 0.6; it.z -= q.dz * 0.6; }
          it.air = false; it.drops++;
          emit('land', { item: it.id, x: it.x, z: it.z });
        } else emit('arrow', { id: q.id, x: q.x, z: q.z, dx: q.dx, dz: q.dz, hit });
        S.shots.splice(i, 1);
        if (S.winner) return;
      }
    }
  }

  function think(f) {
    const mine = tierOf(f.item);
    // pick a target: usually the nearest, but grudges, bullies and cowards skew it
    let e = null, es = 1e9, near = null, dn = 1e9;
    for (const o of F) if (o.alive && o !== f) {
      const d = dist(f, o);
      if (d < dn) { dn = d; near = o; }
      let sc = d;
      if (o === f.grudge) sc -= 6;
      if (weaponOf(o).shoot && d < 22) sc -= ARCHER_PULL + (weaponOf(o).shoot - 1) * 0.9;                 // get the archer: someone loosing arrows into the melee draws a charge
      if (f.goal && o === f.goal.enemy) sc -= f.lockT > 0 ? 9 : 3;     // stick with the current fight rather than flitting between opponents
      if (f.mean > 0.65) sc += o.hp * 0.05;                           // bullies hunt the wounded
      if (f.brave < 0.35) sc += tierOf(o.item) * 1.2;                 // cowards avoid the well armed
      if (sc < es) { es = sc; e = o; }
    }
    f.near = near;
    if (!e) { f.goal = null; return; }
    const de = dist(f, e);
    let best = null, bs = 0, bd = 0;
    for (const it of I) {
      if (it.holder || it.air) continue;
      const gain = tierOf(it) - mine;
      if (gain <= 0) continue;
      const d = dist(f, it), sc = gain / (d + 2);
      if (sc > bs) { bs = sc; best = it; bd = d; }
    }
    // run away: when badly hurt, or bare-handed against steel (braver fighters hold out longer)
    // (not in the final duel: with two left it is fought to the end. Archers still fall back to make room to shoot.)
    if ((S.alive > 2 || weaponOf(f).shoot) && f.fleeCd <= 0 && dn < 6 && (f.hp < 15 + (1 - f.brave) * 35 || (!f.item && tierOf(near.item) >= 5 && f.brave < 0.7))) {
      f.flee = 1.2 + (1 - f.brave) * 2.5; f.fleeCd = f.flee + 5 + f.brave * 6;
      // run to a random patch of sand that is away from the threat, rather than straight back into the wall
      for (let i = 0; i < 6; i++) {
        const [x, z] = randomSpot(0.7);
        f.fleeX = x; f.fleeZ = z;
        if ((x - near.x) * (x - near.x) + (z - near.z) * (z - near.z) > 100 && (x - f.x) * (f.x - near.x) + (z - f.z) * (f.z - near.z) > 0) break;
      }
    }
    // the opening: most fighters make straight for the pile in the middle to trade the plain sword for something special
    const rush = S.t < 30 && f.greed > 0.06 && mine < 5 && de > 1.5;   // almost everyone still holding the plain sword, unless someone is right on them
    const wantLoot = best && (rush || (f.item
      ? bd < (10 + f.greed * 22) * f.look && tierOf(best) - mine >= (f.greed > 0.7 ? 1 : 2) && de > 2.5
      : bd < 40 * f.look && (de > 3 || bd < de || f.brave < 0.5)));
    if (!wantLoot && !(f.goal && f.goal.enemy === e)) f.lockT = 2.5;
    f.goal = wantLoot ? { item: best } : { enemy: e };
    f.loot = best;
  }

  function step() {
    S.t = ++S.tick * DT;
    if (S.winner) return;
    for (const f of F) {
      if (!f.alive) continue;
      f.cd -= DT; f.stun -= DT; f.slow -= DT; f.think -= DT; f.flee -= DT; f.fleeCd -= DT; f.dodge -= DT; f.taunt -= DT; f.guard -= DT; f.slamCd -= DT; f.safe -= DT; f.hurt -= DT; f.lockT -= DT; f.steady -= DT; f.comboT -= DT;
      f.kx *= 0.86; f.kz *= 0.86;
      // a raised guard does not root you: you keep closing behind the shield, a little slower, but cannot swing until it drops
      let mx = 0, mz = 0, lock = false, sp = SPEED * f.pace * (f.slow > 0 ? 0.5 : 1) * (f.guard > 0 ? 0.85 : 1);
      if (f.stun <= 0 && f.hurt > 0) {
        f.act = 'hurt';
      } else if (f.stun > 0) {
        if (f.act !== 'slip') f.act = 'stun';
      } else if (f.dodge > 0) {
        f.act = 'dodge';
      } else if (f.taunt > 0) {
        f.act = 'taunt';
      } else if (f.swing) {
        f.act = 'attack';
        if (!sweep(f)) f.swing = null;
        if (S.winner) return;
      } else if (f.pick) {
        f.act = 'pickup';
        if ((f.pick.t -= DT) <= 0) {
          const it = f.pick.item; f.pick = null;
          if (!it.holder && !it.air) {
            drop(f, f.x, f.z);
            it.holder = f; f.item = it;
            emit('pickup', { id: f.id, item: it.id, wid: it.wid, reused: it.drops > 0 });
          }
          f.think = 0;
        }
      } else {
        if (f.think <= 0) { think(f); f.think = 0.2 + rand() * 0.1; }
        const g = f.goal;
        f.act = 'idle';
        if (f.flee > 0 && f.near && f.near.alive) {
          const d = Math.sqrt((f.fleeX - f.x) * (f.fleeX - f.x) + (f.fleeZ - f.z) * (f.fleeZ - f.z));
          if (d < 1) f.flee = 0;
          else { mx = (f.fleeX - f.x) / d; mz = (f.fleeZ - f.z) / d; f.act = 'flee'; sp *= 1.12; }
          const it = f.loot;                                          // a better weapon on the way out is worth the detour
          if (it && !it.holder && !it.air && f.flee > 0) {
            const di = dist(f, it) || 0.001;
            if (di < 6) { mx = (it.x - f.x) / di; mz = (it.z - f.z) / di; if (di < 0.9) { f.pick = { t: 0.45, item: it }; f.flee = 0; mx = mz = 0; } }
          }
        } else if (g && g.item) {
          const it = g.item;
          if (it.holder || it.air) f.think = 0;
          else {
            const d = dist(f, it) || 0.001;
            mx = (it.x - f.x) / d; mz = (it.z - f.z) / d;
            if (d < 0.9) { f.pick = { t: 0.45, item: it }; mx = mz = 0; } else f.act = 'run';
          }
        } else if (g && g.enemy) {
          const e = g.enemy;
          if (!e.alive) f.think = 0;
          else {
            const d = dist(f, e) || 0.001, w0 = weaponOf(f), w = w0.melee && d < w0.melee.within ? (w0.close ??= { ...w0, thrown: false, shoot: 0, hands: w0.hands, ...w0.melee, melee: null }) : w0;   // up close a javelin is a short spear, and a bow or crossbow is a club
            const range = w.shoot ? 13 : w.thrown ? 9 : Math.max(w.reach * 0.8, RADIUS * 2 + 0.1);   // (bodies cannot get closer than two radii)   // close enough to land the blade, not just graze with the tip
            const dx = (e.x - f.x) / d, dz = (e.z - f.z) / d;
            f.fx = dx; f.fz = dz;
            // close to striking distance, then hold it: only step back in once ready to swing again
            if (d <= range) f.eng = true; else if (d > range * 1.3 || f.cd <= 0) f.eng = false;
            if (w.shoot && f.cd > 0 && d < 5) { mx = -dx; mz = -dz; sp *= 0.6; f.act = 'run'; lock = true; }   // reloading with someone closing: give ground, facing them
            else if (f.eng && d > range) { /* in the pocket, recovering: stand and face them */ }
            else if (d <= range) {
              if (f.cd <= 0 && f.guard <= 0) startSwing(f, e, w);
            } else { mx = dx; mz = dz; f.act = 'run'; const ease = (d - range) / 1.3; sp *= ease < 0.75 ? 0.75 : ease > 1 ? 1 : ease; }   // slow into striking distance instead of stopping dead
          }
        }
      }
      if ((f.act === 'run' || f.act === 'flee') && (mx || mz) && !lock) { f.fx = mx; f.fz = mz; }
      if (f.act === 'slip' && f.stun <= 0) f.act = 'idle';
      if (mx || mz) { f.vx += (mx * sp - f.vx) * 0.2; f.vz += (mz * sp - f.vz) * 0.2; }
      else { f.vx *= 0.55; f.vz *= 0.55; }                               // plant the feet: no gliding to a stop
      f.x += (f.vx + f.kx) * DT; f.z += (f.vz + f.kz) * DT;
    }
    // slipped fighters are flagged from hit events (act is recomputed each tick otherwise)
    flyShots();
    if (S.winner) return;
    // bodies are solid: they push each other apart, a fighter sent flying bowls into whoever is behind them,
    // and being knocked into the arena wall hurts
    // ponytail: O(n²) pair scan, fine to ~150 fighters; spatial grid if that ever grows
    for (let i = 0; i < F.length; i++) {
      const a = F[i]; if (!a.alive) continue;
      for (let j = i + 1; j < F.length; j++) {
        const b = F[j]; if (!b.alive) continue;
        const dx = b.x - a.x, dz = b.z - a.z, d2 = dx * dx + dz * dz, min = RADIUS * 2;
        if (d2 < min * min && d2 > 1e-8) {
          const d = Math.sqrt(d2), p = (min - d) / d * 0.5;
          a.x -= dx * p; a.z -= dz * p; b.x += dx * p; b.z += dz * p;
          const ka = a.kx * a.kx + a.kz * a.kz, kb = b.kx * b.kx + b.kz * b.kz;
          const fast = ka > kb ? a : b, slow = ka > kb ? b : a;
          if (Math.max(ka, kb) > 20 && fast.slamCd <= 0) {              // > ~4.5 m/s: momentum carries into the other body
            slow.kx += fast.kx * 0.55; slow.kz += fast.kz * 0.55; fast.kx *= 0.45; fast.kz *= 0.45;
            slow.stun = Math.max(slow.stun, 0.3); fast.slamCd = 0.5;
            if (slow.swing) slow.swing = null;
            emit('bump', { a: fast.id, b: slow.id });
          }
        }
      }
      const e = (a.x * a.x) / (RX * RX) + (a.z * a.z) / (RZ * RZ);
      if (e > 0.94) {
        const k = Math.sqrt(0.94 / e), sp = Math.sqrt(a.kx * a.kx + a.kz * a.kz);
        a.x *= k; a.z *= k;
        if (sp > 5 && a.slamCd <= 0) {
          a.slamCd = 1; a.stun = Math.max(a.stun, 0.6);
          const dmg = DMG * sp * 1.4;
          emit('slam', { id: a.id, x: a.x, z: a.z, dmg });
          a.hp -= dmg;
          if (a.hp <= 0) { if (a.grudge && a.grudge.alive) { die(a, a.grudge, FISTS, false, -a.kx / sp, -a.kz / sp); if (S.winner) return; } else a.hp = 1; }
        }
        a.kx *= 0.3; a.kz *= 0.3;
      }
    }
  }

  S.step = step;
  S.weaponOf = weaponOf;
  return S;
}
