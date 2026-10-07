// node src/balance.js — plays every weapon against every other, 1v1 with fixed loadouts, and prints win rates.
// Used to tune weapons.js: a fair weapon wins about half its duels overall.
import { createSim } from './sim.js';
import { WEAPONS } from './weapons.js';

const ids = WEAPONS.map(w => w.id), N = 120;
const wins = Object.fromEntries(ids.map(a => [a, Object.fromEntries(ids.map(b => [b, 0]))]));
let draws = 0, time = 0, games = 0;
for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) for (let k = 0; k < N; k++) {
  const pair = k % 2 ? [ids[i], ids[j]] : [ids[j], ids[i]];         // swap sides each game
  const S = createSim([{ name: 'A', g: 'm' }, { name: 'B', g: 'm' }], 1000 + k * 7 + i * 131 + j * 17, { loadout: pair });
  while (!S.winner && S.t < 300) { S.step(); S.events.length = 0; }
  games++; time += S.t;
  if (!S.winner) { draws++; continue; }
  const w = pair[S.winner.id], l = pair[1 - S.winner.id];
  wins[w][l]++;
}
console.log(`${games} duels, ${draws} unfinished, average ${(time / games).toFixed(0)} s\n`);
console.log('weapon'.padEnd(10) + 'overall  ' + ids.map(b => b.slice(0, 6).padStart(7)).join(''));
for (const a of ids) {
  const total = ids.reduce((s, b) => s + (a === b ? 0 : wins[a][b]), 0);
  console.log(a.padEnd(10) + (100 * total / (N * (ids.length - 1))).toFixed(0).padStart(5) + '%   ' + ids.map(b => a === b ? '      -' : (100 * wins[a][b] / N).toFixed(0).padStart(6) + '%').join(''));
}
