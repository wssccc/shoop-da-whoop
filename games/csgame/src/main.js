// main.js — entry point / orchestrator.
//
// This file used to be the entire game. After the split, each subsystem
// lives in its own module (state, world, weapon, enemy, player, input,
// touch, shoot, physics, fx, audio, hud); main.js now only owns the THREE
// renderer build, the scene/camera assemble, the input-mode branch (desktop
// PointerLockControls vs touch on-screen controls), the resize listeners,
// and the requestAnimationFrame loop that ticks the subsystems every frame.

import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';

import { setupAudio } from './audio.js';
import { spawnEnemy } from './enemy.js';
import { updateFx } from './fx.js';
import { setupInput } from './input.js';
import { updateEnemies, updatePlayer } from './physics.js';
import { resetPlayer } from './player.js';
import { tryShoot } from './shoot.js';
import {
    ARENA,
    EYE_HEIGHT,
    MAX_ENEMIES,
    S,
    applyRendererSize,
    fireHeld,
    getViewportH,
    getViewportW,
    isEngaged,
    isTouch,
    notifyEngagement,
} from './state.js';
import { setupTouchControls } from './touch.js';
import { buildWeapon } from './weapon.js';
import { buildLights, buildSpawnPoints, buildWorld } from './world.js';

function init() {
  S.scene = new THREE.Scene();
  S.scene.background = new THREE.Color(0xbfae8e);
  S.scene.fog = new THREE.Fog(0xbfae8e, 28, 95);

  S.camera = new THREE.PerspectiveCamera(78, getViewportW() / getViewportH(), 0.05, 600);
  // camera always doubles as the player object: PointerLockControls (desktop)
  // and the touch look branch BOTH read/write camera.position directly, so the
  // rest of the engine can ignore which input mode is active.
  S.scene.add(S.camera);

  S.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  S.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  applyRendererSize();
  S.renderer.shadowMap.enabled = true;
  S.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  S.renderer.outputColorSpace = THREE.SRGBColorSpace;
  document.getElementById('app').appendChild(S.renderer.domElement);

  buildLights();
  buildWorld();
  buildSpawnPoints();

  // Spawn the player at the friendly edge of the arena.
  S.camera.position.set(0, EYE_HEIGHT, ARENA * 0.62);

  if (!isTouch) {
    // DESKTOP: real mouse-look via Pointer Lock. The browser hides the
    // cursor and feeds relative movement while locked.
    S.controls = new PointerLockControls(S.camera, S.renderer.domElement);
    // Engagement transitions are async (the browser may reject the request),
    // so we mirror the actual lock state into our own flag here.
    S.controls.addEventListener('lock', () => notifyEngagement(true));
    S.controls.addEventListener('unlock', () => notifyEngagement(false));
  } else {
    // TOUCH (incl. all of iOS): no Pointer Lock exists. Twin-stick on-screen
    // controls drive movement + look; taps on the canvas / buttons fire.
    document.body.classList.add('touch');
    setupTouchControls();
  }

  buildWeapon();
  setupAudio();

  resetPlayer(true);
  for (let i = 0; i < MAX_ENEMIES; i++) spawnEnemy();

  setupInput();

  document.getElementById('loader').classList.add('hidden');

  // Resize must follow both the layout viewport (rotate / desktop resize)
  // and the visual viewport (iOS Safari URL bar slide-in/out). The latter
  // is the only signal that fires when the chrome shrinks on iPhone.
  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', () => setTimeout(onResize, 200));
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', onResize);
    window.visualViewport.addEventListener('scroll', onResize);
  }
  // Prevent the page from scrolling under fingers on iOS while controls are
  // showing — these are passive guards that complement the CSS touch-action.
  document.addEventListener('gesturestart', (e) => e.preventDefault());
  document.addEventListener('touchmove', (e) => {
    if (isTouch) e.preventDefault();
  }, { passive: false });

  animate(performance.now());
}

function animate(time) {
  requestAnimationFrame(animate);
  const dt = Math.min(0.05, (time - S.clock.last) / 1000);
  S.clock.last = time;
  const now = time / 1000;

  // A round runs only while engaged & not game over. FX still ticks while
  // paused so muzzle flashes / tracers fade out gracefully.
  if (isEngaged()) {
    updatePlayer(dt, now);
    updateEnemies(dt, now);
    // Hold-to-auto-fire: fireHeld is set by mouse (desktop) or the FIRE
    // button (touch). tryShoot self-throttles via FIRE_CD and checks ammo,
    // so we can call it every frame while the input is held.
    if (fireHeld) tryShoot();
  }
  updateFx(dt);

  S.renderer.render(S.scene, S.camera);
}

function onResize() {
  const w = getViewportW();
  const h = getViewportH();
  S.camera.aspect = w / h;
  S.camera.updateProjectionMatrix();
  applyRendererSize();
}

init();
