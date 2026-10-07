// Weapon stat table. Pure data: imported by the sim (Node-safe) and by the renderer.
// dmg: base damage (fighters have 100 hp)   cd: seconds between attacks   kb: knockback (m/s)   crit: crit chance (x2.5)
// reach: metres from the attacker's centre to the weapon tip at full extension, measured from the animations
//        (arm reach about 0.85 m plus the length of the weapon model), so a hit in the sim is a hit on screen.
//        For ranged weapons it is how far the missile flies.
// style: how it is swung (see STYLE / TIMING in sim.js)
// hands: 2 = two-handed. The shield goes on the fighter's back and cannot block while this is the weapon in hand.
// back: damage multiplier for a blow from behind (default 1.3)   stun: seconds of daze on hit   knock: chance to knock the target down   slow: seconds of hobble
// melee: stats used instead when the enemy is within `within` metres: a javelin is thrust like a short spear,
//        a bow or crossbow is swung to knock the enemy back and make room to shoot
// shoot: missiles loosed per attack (the weapon stays in hand)   thrown: the weapon itself is thrown and must be picked up again
//
// Everyone starts with a shield and the Long Sword, which has plain stats and no special. The other weapons lie in the
// middle of the arena: each trades something for its special. One-handed ones keep the shield; two-handed ones hit
// harder, reach further or shoot, but give the shield up.
// Balance: every weapon is meant to be a fair pick. The numbers were tuned with `node src/balance.js`, which plays each
// weapon against every other a few hundred times (shields included).
export const FISTS = { id: 'fists', name: 'Fists', style: 'fists', dmg: 5, cd: 0.7, reach: 0.9, kb: 1.5, crit: 0.05, tier: 0, count: 0 };

export const WEAPONS = [
  { id: 'longsword', name: 'Long Sword', style: 'blade',    dmg: 16.5, cd: 1.0, reach: 1.75, kb: 3,   crit: 0.1,  tier: 4, count: 0 },
  { id: 'dagger',    name: 'Dagger',     style: 'light',    dmg: 10.5, cd: 0.5, reach: 1.1,  kb: 1,   crit: 0.25, tier: 6, count: 2, back: 3.6 },
  { id: 'mace',      name: 'Mace',       style: 'blade',    dmg: 18.5, cd: 1.1, reach: 1.35, kb: 4,   crit: 0.08, tier: 6, count: 2, stun: 0.45, back: 2 },
  { id: 'spear',     name: 'Spear',      style: 'thrust',   dmg: 19, cd: 1.1, reach: 2.45, kb: 3,   crit: 0.1,  tier: 6, count: 2, back: 1 },
  { id: 'javelin',   name: 'Javelin',    style: 'thrown',   dmg: 32, cd: 1.3, reach: 14,   kb: 4,   crit: 0.15, tier: 6, count: 2, thrown: true, melee: { within: 3.2, style: 'thrust', dmg: 26, cd: 1.0, reach: 1.9, kb: 2.5 } },
  { id: 'axe',       name: 'Battle Axe', style: 'heavy',    dmg: 35, cd: 1.6, reach: 1.3,  kb: 5,   crit: 0.15, tier: 6, count: 2, hands: 2 },
  { id: 'hammer',    name: 'Warhammer',  style: 'heavy',    dmg: 40.5, cd: 2.0, reach: 1.2, kb: 6.5, crit: 0.08, tier: 6, count: 2, hands: 2, knock: 0.3 },
  { id: 'trident',   name: 'Trident',    style: 'thrust',   dmg: 24.5, cd: 1.3, reach: 1.9, kb: 3,   crit: 0.1,  tier: 6, count: 2, hands: 2, slow: 1.5, back: 1 },
  { id: 'bow',       name: 'Bow',        style: 'bow',      dmg: 38, cd: 1.5, reach: 18,   kb: 2,   crit: 0.15, tier: 6, count: 2, hands: 2, shoot: 1, slow: 1.4, melee: { within: 1.9, style: 'blade', dmg: 8, cd: 0.3, reach: 1.15, kb: 6.5, crit: 0, stun: 0.4 } },
  { id: 'crossbow',  name: 'Crossbow',   style: 'crossbow', dmg: 46, cd: 2.4, reach: 18,   kb: 2.5, crit: 0.1,  tier: 6, count: 2, hands: 2, shoot: 3, slow: 1.4, melee: { within: 1.9, style: 'blade', dmg: 9, cd: 0.3, reach: 1.0, kb: 6.5, crit: 0, stun: 0.4 } },
];

export const WEAPON_BY_ID = Object.fromEntries([FISTS, ...WEAPONS].map(w => [w.id, w]));
