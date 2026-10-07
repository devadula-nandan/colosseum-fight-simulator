// Crowd-fight audit: who wins and who kills when 20 fight at once. `node src/melee.js`
import { createSim } from './sim.js';
const wins = {}, kills = {}, held = {};
const RUNS = +(process.argv[2] || 200), N = +(process.argv[3] || 20);
for (let s = 1; s <= RUNS; s++) {
  const S = createSim(Array.from({ length: N }, (_, i) => ({ name: 'P' + i, g: 'm' })), s * 7919);
  while (!S.winner && S.t < 600) {
    S.step();
    for (const e of S.events) if (e.type === 'death') kills[e.wid] = (kills[e.wid] || 0) + 1;
    S.events.length = 0;
    if (Math.round(S.t * 60) % 30 === 0) for (const f of S.fighters) if (f.alive) { const w = S.weaponOf(f).id; held[w] = (held[w] || 0) + 0.5; }
  }
  const w = S.weaponOf(S.winner).id; wins[w] = (wins[w] || 0) + 1;
}
for (const w of Object.keys(held).sort()) console.log(w.padEnd(10), 'wins', String(wins[w] || 0).padStart(3), ' kills', String(kills[w] || 0).padStart(4), ' kills/min held', ((kills[w] || 0) / held[w] * 60).toFixed(2));
