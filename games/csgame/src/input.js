// input.js — keyboard + desktop-mouse wiring. Keyboard works in BOTH modes
// (physical keyboards on iPad / a Bluetooth game keyboard on a phone); the
// desktop-only mouse branch is gated on !isTouch because touch devices
// use touch.js instead.

import { spawnEnemy } from './enemy.js';
import { resetPlayer } from './player.js';
import { tryReload, tryShoot } from './shoot.js';
import {
    ARENA,
    EYE_HEIGHT,
    JUMP_V,
    MAX_ENEMIES,
    S,
    engage,
    isEngaged,
    isTouch,
    resetLook,
    setFireHeld,
} from './state.js';

export function setupInput() {
  // Keyboard works in BOTH modes (physical keyboards on iPad / Bluetooth).
  document.addEventListener('keydown', (e) => {
    if (onKey(e, true) === false) e.preventDefault();
  });
  document.addEventListener('keyup', (e) => { onKey(e, false); });

  document.getElementById('start').addEventListener('click', () => startGame());
  document.getElementById('over').addEventListener('click', () => restart());

  if (!isTouch) {
    // DESKTOP: hold left mouse to auto-fire, hold right mouse to ADS.
    // (Auto-fire is rate-limited inside the animate loop via FIRE_CD.)
    S.renderer.domElement.addEventListener('mousedown', (e) => {
      if (!isEngaged()) return;
      if (e.button === 0) { setFireHeld(true); tryShoot(); }
      if (e.button === 2) S.keys.aiming = true;
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) setFireHeld(false);
      if (e.button === 2) S.keys.aiming = false;
    });
    S.renderer.domElement.addEventListener('contextmenu', (e) => e.preventDefault());
  }
}

export function onKey(e, down) {
  switch (e.code) {
    case 'KeyW': case 'ArrowUp':    S.keys.forward = down; break;
    case 'KeyS': case 'ArrowDown':  S.keys.back = down; break;
    case 'KeyA': case 'ArrowLeft':  S.keys.left = down; break;
    case 'KeyD': case 'ArrowRight': S.keys.right = down; break;
    case 'ShiftLeft': case 'ShiftRight': S.keys.run = down; break;
    case 'Space':
      if (down && S.player && S.player.onGround && isEngaged()) {
        S.player.velY = JUMP_V; S.player.onGround = false;
      }
      return false; // prevent page scroll
    case 'KeyR':
      if (down) tryReload(); break;
  }
}

export function startGame() {
  if (S.player.gameOver) return; // click on over handled elsewhere
  if (!S.player.started) S.player.started = true;
  engage();
}

export function restart() {
  resetPlayer(true);
  S.camera.position.set(0, EYE_HEIGHT, ARENA * 0.62);
  // reset look orientation for the touch branch (desktop PLC manages its own)
  resetLook();
  S.camera.rotation.set(0, 0, 0, 'YXZ');
  // clear enemies
  while (S.enemies.length) { const e = S.enemies.pop(); S.scene.remove(e.group); }
  for (let i = 0; i < MAX_ENEMIES; i++) spawnEnemy();
  document.getElementById('lowhp').classList.remove('on');
  engage();
}
