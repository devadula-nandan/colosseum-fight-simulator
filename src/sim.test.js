// node src/sim.test.js
import assert from 'node:assert';
import { createSim, RX, RZ } from './sim.js';

function run(n, seed) {
  const S = createSim(Array.from({ length: n }, (_, i) => ({ name: 'P' + i, g: 'r' })), seed);
  const log = [];
  let reused = false;
  while (!S.winner) {
    S.step();
    assert(S.t < 15 * 60, `fight with ${n} players, seed ${seed} did not finish in 15 min`);
    for (const e of S.events) {
      if (e.type === 'death') log.push(e.id);
      if (e.type === 'pickup' && e.reused) reused = true;
    }
    S.events.length = 0;
    for (const f of S.fighters) assert((f.x * f.x) / (RX * RX) + (f.z * f.z) / (RZ * RZ) <= 1.001, 'fighter left the arena');
  }
  assert.equal(S.fighters.filter(f => f.alive).length, 1, 'exactly one survivor');
  assert.equal(log.length, n - 1);
  return { winner: S.winner.id, log: log.join(','), t: S.t, reused, genders: S.fighters.map(f => f.g).join('') };
}

const a = run(40, 12345), b = run(40, 12345), c = run(40, 54321);
assert.deepEqual(a, b, 'same seed must replay identically');
assert.notEqual(a.log, c.log, 'different seed must give a different fight');

let reused = false;
const winners = new Set(), times = [];
for (const n of [2, 3, 10, 40, 100]) for (let s = 1; s <= 6; s++) {
  const r = run(n, s * 7919);
  reused ||= r.reused; times.push(`${n}p:${r.t.toFixed(0)}s`);
  if (n === 10) winners.add(r.winner);
}
assert(reused, 'a dropped weapon should get picked up by someone else');
assert(winners.size > 2, 'winner should vary with the seed');
console.log('ok', times.join(' '));
