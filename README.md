# Colosseum Giveaway Royale

A browser 3D battle royale for picking a giveaway winner. Static files only, no server.

**Live:** https://devadula-nandan.github.io/colosseum-fight-simulator/

## What happens

- The admin pastes the participants and a prize and gets a link. Each link has its own random seed, so nobody knows the winner in advance, and everyone who opens the same link sees the same fight.
- Every participant enters a Roman colosseum as a fighter in full plate (silver, 14 ct gold or bronze, in six cuts and four plate surfaces) with a shield and a long sword.
- Special weapons lie in the middle of the arena: dagger, mace, spear, javelin, battle axe, warhammer, trident, bow and crossbow. Each trades something for its special; two-handed ones are held in both hands and the shield goes on the back.
- They fight until one is left: swings at three heights, dodges, shield blocks, parries, knockdowns, arrows that stick in shields.
- The king comes down from his box and hands the winner the prize.

## Run locally

```bash
node serve.mjs
```

Then open http://localhost:8765. (Any static file server works; opening `index.html` straight from disk does not, because browsers block module scripts on `file://`.)

## Host it

Upload the whole folder to any static host (GitHub Pages, Netlify, Cloudflare Pages). No build step. This repo is served by GitHub Pages straight from the `main` branch.

## Use it

1. Open the page with no link data: you get the admin screen. Paste names (one per line, optionally `Name, m` / `Name, f`), set each fighter's gender, the prize and the start delay, then **Create giveaway link**.
2. Post the link. Everyone who opens it sees the same fight at the same moment, with their own camera.
3. Viewers can add `&me=TheirName` to the link to start on their own fighter. `◀ ▶` (or arrow keys) switch fighter.
4. A link opened more than a minute after its fight ended plays as a replay from the start.

Optional `&q=0`, `&q=1` or `&q=2` forces low / medium / high graphics. By default it picks a tier from the GPU and steps down if the frame rate is poor.

## Tuning

- `src/weapons.js` — weapon stats.
- `DMG` at the top of `src/sim.js` — fight length (lower is longer). Dodge chance, flee thresholds and personality traits (`brave`, `greed`, `agile`, `mean`) are in the same file.
- Armour is in `src/fighters.js`: `METALS` (silver, 14 ct gold, bronze), `KITS` (which modelled pieces each cut of armour wears), `pieces` (the pieces themselves) and the four plate surfaces in `ARMOUR_GLSL`. Skin tones are `SKIN` and `DEEP_SHARE`. Weapon sizes are `SCALE` in `src/props.js`.
- `node src/sim.test.js` — checks that a seed always replays identically and every fight ends with one survivor.
- `node src/balance.js` — duels every weapon against every other and prints win rates; use it after changing weapon stats.
- `node src/melee.js` — 200 twenty-fighter brawls; prints which weapon the winner held and kills per weapon, to check no weapon owns crowd fights.
