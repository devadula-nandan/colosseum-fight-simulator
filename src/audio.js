// Positional sound effects, crowd bed and music on raw WebAudio.
// Browsers keep audio suspended until a user gesture, so everything starts muted
// and the HUD sound button calls setMuted(false).
import * as THREE from 'three';

const A = 'assets/audio/';
const GROUPS = {
  metal: ['impact_metal_medium_000', 'impact_metal_medium_001', 'impact_metal_medium_002'],
  metalHeavy: ['impact_metal_heavy_000', 'impact_metal_heavy_001'],
  punch: ['impact_punch_medium_000', 'impact_punch_medium_001', 'impact_punch_medium_002'],
  punchHeavy: ['impact_punch_heavy_000', 'impact_punch_heavy_001'],
  wood: ['impact_wood_medium_000', 'impact_wood_medium_001'],
  soft: ['impact_soft_heavy_000', 'impact_soft_heavy_001'],
  bell: ['impact_bell_heavy_000'], plate: ['impact_plate_heavy_000'], pot: ['metal_pot_1'],
  step: ['footstep_0', 'footstep_1', 'footstep_2', 'footstep_3'],
  draw: ['draw_knife_1'], swish: ['knife_slice', 'knife_slice_2'], coins: ['handle_coins'], cloth: ['cloth_1'],
  crowd: ['crowd'],
};

export function createAudio() {
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const master = ctx.createGain(); master.gain.value = 0; master.connect(ctx.destination);
  const buffers = {};
  const music = new Audio(A + 'battle_theme.mp3'); music.loop = true; music.volume = 0.3;
  let muted = true, crowdGain = null, crowdLevel = 0.25;

  const load = Promise.all(Object.values(GROUPS).flat().map(async n => {
    try {
      const r = await fetch(`${A}${n}.ogg`);
      buffers[n] = await ctx.decodeAudioData(await r.arrayBuffer());
    } catch (e) { console.warn('sound failed to load:', n, e); }
  }));

  function source(name, rate) {
    const g = GROUPS[name], buf = buffers[g[Math.floor(Math.random() * g.length)]];
    if (!buf) return null;
    const s = ctx.createBufferSource(); s.buffer = buf; s.playbackRate.value = rate;
    return s;
  }

  function play(name, pos, vol = 1, rate = 1) {
    if (muted) return;
    const s = source(name, rate * (0.92 + Math.random() * 0.16));
    if (!s) return;
    const g = ctx.createGain(); g.gain.value = vol;
    s.connect(g);
    if (pos) {
      const p = ctx.createPanner(); p.panningModel = 'equalpower'; p.distanceModel = 'inverse'; p.refDistance = 4; p.rolloffFactor = 1.2;
      p.positionX.value = pos.x; p.positionY.value = pos.y ?? 1; p.positionZ.value = pos.z;
      g.connect(p); p.connect(master);
    } else g.connect(master);
    s.start();
  }

  // rubber chicken: a quick sine chirp, no sample needed
  function squeak(pos, pitch = 1) {
    if (muted) return;
    const o = ctx.createOscillator(), g = ctx.createGain(), p = ctx.createPanner(), t = ctx.currentTime;
    o.type = 'sine';
    o.frequency.setValueAtTime(900 * pitch, t); o.frequency.exponentialRampToValueAtTime(2200 * pitch, t + 0.06); o.frequency.exponentialRampToValueAtTime(700 * pitch, t + 0.2);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.5, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    p.refDistance = 4; p.positionX.value = pos.x; p.positionY.value = 1; p.positionZ.value = pos.z;
    o.connect(g); g.connect(p); p.connect(master); o.start(t); o.stop(t + 0.25);
  }

  function startBeds() {
    if (!crowdGain && buffers.crowd) {
      const s = ctx.createBufferSource(); s.buffer = buffers.crowd; s.loop = true;
      crowdGain = ctx.createGain(); crowdGain.gain.value = crowdLevel;
      s.connect(crowdGain); crowdGain.connect(master); s.start();
    }
    music.play().catch(() => {});
  }

  const fwd = new THREE.Vector3(), up = new THREE.Vector3();
  return {
    load, play, squeak,
    get muted() { return muted; },
    setMuted(m) {
      muted = m;
      master.gain.value = m ? 0 : 1;
      if (m) music.pause(); else ctx.resume().then(startBeds);
    },
    // 0..1 excitement; decays back in update()
    cheer(v) { crowdLevel = Math.max(crowdLevel, 0.25 + v * 0.75); },
    update(camera, dt) {
      crowdLevel += (0.25 - crowdLevel) * Math.min(1, dt * 0.5);
      if (crowdGain) crowdGain.gain.value = crowdLevel;
      const l = ctx.listener;
      if (!Number.isFinite(camera.position.x + camera.position.y + camera.position.z)) return;      // never hand the audio engine a broken camera
      camera.getWorldDirection(fwd); up.copy(camera.up);
      if (l.positionX) {
        l.positionX.value = camera.position.x; l.positionY.value = camera.position.y; l.positionZ.value = camera.position.z;
        l.forwardX.value = fwd.x; l.forwardY.value = fwd.y; l.forwardZ.value = fwd.z;
        l.upX.value = up.x; l.upY.value = up.y; l.upZ.value = up.z;
      } else { l.setPosition(camera.position.x, camera.position.y, camera.position.z); l.setOrientation(fwd.x, fwd.y, fwd.z, up.x, up.y, up.z); }
    },
  };
}
