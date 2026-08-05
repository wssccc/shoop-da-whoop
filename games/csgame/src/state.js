// state.js — shared game state + constants + platform abstraction.
//
// WHY A SINGLE OBJECT: this engine was previously one big file full of
// module-scope `let`/`const` globals. Splitting it into ES modules needs a
// shared home for the data every subsystem mutates (scene, camera, player,
// enemy list, input flags…). We put them all on one exported object `S`;
// ES module imports are live+read-only bindings, so a re-assigned scalar
// (e.g. `S.player = {...}` on reset) could NOT be shared via a bare `let`
// export — an object property is the only shape that round-trips. Modules
// therefore `import { S, ... } from './state.js'` and read/write `S.xxx`.
//
// This file deliberately owns NO cross-module imports (only three.js), so it
// sits at the bottom of the dependency graph and breaks every would-be cycle:
// engage() → resumeAudio() (same file), enter() → controls.lock() (reads
// S.controls). Everything else that needs cross-module calls imports state.

import * as THREE from 'three';

// ---- tunables (read by physics / shoot / world / player) ----
export const EYE_HEIGHT   = 1.70;
export const RADIUS       = 0.40;       // player collision radius (xz)
export const WALK_SPEED   = 5.5;
export const RUN_SPEED    = 9.0;
export const GRAVITY      = 26.0;
export const JUMP_V       = 8.4;

export const MAG_SIZE     = 17;
export const RESERVE_MAX  = 68;
export const FIRE_CD      = 0.115;      // seconds between shots
export const RELOAD_TIME  = 1.55;
export const DAMAGE       = 26;         // per shot to enemy
export const RECOIL_KICK  = 0.011;      // radians upward kick per shot

export const PLAYER_HP_MAX = 100;

export const ENEMY_HP     = 100;
export const ENEMY_R      = 0.42;
export const ENEMY_H      = 1.85;
export const ENEMY_SPEED  = 2.7;
export const ENEMY_RANGE  = 30;         // player acquisition range
export const ENEMY_FIRE_CD= 1.05;       // seconds between enemy shots
export const ENEMY_BURST  = 3;          // shots per engagement
export const ENEMY_BURST_GAP = 0.12;
export const ENEMY_DMG    = 7.5;
export const ENEMY_HIT_P  = 0.62;       // probability of landing a shot when in range+LOS
export const MAX_ENEMIES  = 6;
export const RESPAWN_SEC  = 2.6;

export const ARENA        = 50;         // ground half-extent -> 100x100 map

// ---- shared mutable state ----
export const S = {
  scene: null,
  camera: null,
  renderer: null,
  controls: null,        // PointerLockControls (desktop only; null on touch)
  player: null,          // runtime reset object
  colliders: [],         // Box3 (world walls / crates) for collision
  solids: [],            // array of {mesh, box, kind} for bullet-raycast hitsets
  enemySpawns: [],       // spawn points
  enemies: [],           // live enemy objects
  tracers: [],           // visible tracer lines
  particles: [],         // hit spark particles
  shells: [],            // ejected shells
  audio: null,           // { ctx } Web Audio context holder
  raycaster: new THREE.Raycaster(),
  clock: { last: performance.now(), dt: 0 },
  stats: { kills: 0, shotsFired: 0, shotsHit: 0 },
  keys: {
    forward: false, back: false, left: false, right: false,
    run: false, jump: false, aiming: false,
  },
  // weapon viewmodel (shared by shoot.js + physics.updatePlayer + weapon.js)
  weaponGroup: null,
  muzzleFlash: null,
  muzzleLight: null,
  weaponRecoil: 0,
  weaponSwing: 0,
};

// =====================================================================
//  PLATFORM / ENGAGEMENT
//  iOS Safari has NEVER shipped the Pointer Lock API (and iPadOS claims a
//  desktop UA but still lacks it). Detection of a touch platform flips us
//  into twin-stick on-screen controls instead of PointerLockControls.
//  Both modes funnel through the same `engaged` flag so the rest of the
//  engine never has to know which input paradigm is active.
// =====================================================================
export const isTouch =
  ('ontouchstart' in window) ||
  (navigator.maxTouchPoints || 0) > 0;

export let engaged = false;           // true while a round is actively being played
export let touchRun = false;          // sprint toggle (touch)
export let fireHeld = false;          // fire button (or mouse) held down -> auto-fire
export let jumpQueued = false;        // edge-triggered jump from touch button
// analog movement from the on-screen stick, range -1..1. Y is inverted vs
// screen pixels (up on the stick = forward = negative screen-Y delta).
export let touchMoveX = 0;
export let touchMoveY = 0;
// touch look euler (YXZ); only owned by the touch branch. Desktop keeps
// using PointerLockControls' internal euler.
export let touchYaw = 0;
export let touchPitch = 0;

// Re-assignable scalars need setters because ES module exports are read-only
// from the importer's view. We centralize the small set of cross-module
// input flags here so touch.js / input.js / physics.js share one truth.
export function setEngaged(v)         { engaged = v; }
export function setTouchRun(v)        { touchRun = v; }
export function setFireHeld(v)        { fireHeld = v; }
export function queueJump()           { jumpQueued = true; }
export function setTouchMove(x, y)    { touchMoveX = x; touchMoveY = y; }
export function addLook(dx, dy) {
  touchYaw -= dx * 0.0045;
  touchPitch -= dy * 0.0045;
  if (touchPitch > 1.4)  touchPitch = 1.4;
  if (touchPitch < -1.4) touchPitch = -1.4;
}
export function resetLook() { touchYaw = 0; touchPitch = 0; }
export function consumeJump() {
  const j = jumpQueued;
  jumpQueued = false;
  return j;
}

export function isEngaged() {
  return engaged && !!(S.player && !S.player.gameOver);
}
function applyEngagedUI(eng) {
  const startEl = document.getElementById('start');
  if (!startEl) return;
  if (eng) {
    startEl.classList.add('hidden');
    document.body.classList.add('engaged');
  } else {
    document.body.classList.remove('engaged');
    if (!S.player || !S.player.gameOver) {
      startEl.classList.remove('hidden');
      const sEl = startEl.querySelector('.stats');
      if (sEl) sEl.textContent = '已暂停 · 点击继续';
    }
  }
}
/** Enter the active round. Desktop asks the browser for pointer lock;
 *  touch just flips the flag (pointer lock does not exist there). */
export function engage() {
  if (S.player && S.player.gameOver) return;
  resumeAudio();
  if (S.controls) {
    // Pointer Lock is async + may be silently rejected by the browser; the
    // actual engagement flip happens in its 'lock' event (see main.js),
    // which calls notifyEngagement().
    S.controls.lock();
  } else {
    notifyEngagement(true);
  }
}
export function disengage() {
  if (S.controls) {
    S.controls.unlock();
  } else {
    notifyEngagement(false);
  }
}
/** Sync engagement flag + UI atomically. Called either from engage/disengage
 *  (touch branch) or from PointerLockControls' lock/unlock event (desktop). */
export function notifyEngagement(v) {
  setEngaged(v);
  applyEngagedUI(v);
}

// =====================================================================
//  AUDIO resume — owned here (not in audio.js) so engage() can call it
//  without creating a state → audio → state cycle.
// =====================================================================
export function resumeAudio() {
  if (S.audio && S.audio.ctx && S.audio.ctx.state === 'suspended') S.audio.ctx.resume();
}

// =====================================================================
//  VIEWPORT HELPERS — follow layout AND visual viewport so the canvas stays
//  full-screen on iOS while the Safari chrome slides in/out.
// =====================================================================
export function getViewportW() {
  const vv = window.visualViewport;
  return vv ? vv.width : window.innerWidth;
}
export function getViewportH() {
  const vv = window.visualViewport;
  return vv ? vv.height : window.innerHeight;
}
export function applyRendererSize() {
  const w = getViewportW();
  const h = getViewportH();
  S.renderer.setSize(w, h);
  // Anchor the canvas at the visual-viewport origin so iOS Safari's dynamic
  // toolbars do not leave a gap / overlap when they resize.
  const vv = window.visualViewport;
  const el = S.renderer.domElement;
  el.style.left = (vv ? vv.offsetLeft : 0) + 'px';
  el.style.top = (vv ? vv.offsetTop : 0) + 'px';
}

// Recoil kicks the aim up. Both input branches ultimately mutate the same
// camera rotation; the touch branch mirrors that into its pitch bookkeeping.
export function applyRecoil(kick) {
  touchPitch -= kick;
  if (touchPitch < -1.4) touchPitch = -1.4;
  S.camera.rotation.x -= kick;
}
