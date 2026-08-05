// touch.js — on-screen twin-stick controls, only wired up on touch devices
// (all of iOS / iPadOS) where the Pointer Lock API does not exist.
//
// Left half of the screen = floating movement stick; right half = look-drag;
// bottom-right cluster = FIRE / JUMP / RELOAD / ADS buttons. Buttons stop
// propagation so a tap on them never also feeds the stick/look handlers.
// Look/move state is written into state.js via the small setter API so this
// module owns no cross-module mutable globals of its own.

import { tryReload, tryShoot } from './shoot.js';
import {
    S,
    addLook,
    isTouch,
    queueJump,
    setFireHeld,
    setTouchMove,
} from './state.js';

export function setupTouchControls() {
  const stickZone = document.getElementById('stick-zone');
  const lookZone = document.getElementById('look-zone');
  const stickBase = document.getElementById('stick-base');
  const knob = document.getElementById('stick-knob');
  const STICK_R = 60;

  const stick = { id: null, ox: 0, oy: 0 };
  const look = { id: null, lx: 0, ly: 0 };

  const showStick = (x, y) => {
    stickBase.style.left = x + 'px';
    stickBase.style.top = y + 'px';
    stickBase.classList.add('show');
  };
  const moveKnob = (dx, dy) => {
    knob.style.transform =
      'translate(calc(-50% + ' + dx + 'px), calc(-50% + ' + dy + 'px))';
  };
  const resetStick = () => {
    knob.style.transform = 'translate(-50%, -50%)';
    stickBase.classList.remove('show');
  };

  stickZone.addEventListener('touchstart', (e) => {
    e.preventDefault();
    if (stick.id !== null) return;
    const t = e.changedTouches[0];
    stick.id = t.identifier;
    stick.ox = t.clientX; stick.oy = t.clientY;
    setTouchMove(0, 0);
    showStick(t.clientX, t.clientY);
  }, { passive: false });

  stickZone.addEventListener('touchmove', (e) => {
    e.preventDefault();
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];
      if (t.identifier !== stick.id) continue;
      let dx = t.clientX - stick.ox;
      let dy = t.clientY - stick.oy;
      const len = Math.hypot(dx, dy);
      if (len > STICK_R) { dx = dx / len * STICK_R; dy = dy / len * STICK_R; }
      moveKnob(dx, dy);
      setTouchMove(dx / STICK_R, dy / STICK_R);
    }
  }, { passive: false });

  const endStick = (e) => {
    e.preventDefault();
    for (let i = 0; i < e.changedTouches.length; i++) {
      if (e.changedTouches[i].identifier === stick.id) {
        stick.id = null; setTouchMove(0, 0);
        resetStick();
      }
    }
  };
  stickZone.addEventListener('touchend', endStick, { passive: false });
  stickZone.addEventListener('touchcancel', endStick, { passive: false });

  // ---- look drag (right half) ----
  lookZone.addEventListener('touchstart', (e) => {
    e.preventDefault();
    if (look.id !== null) return;
    const t = e.changedTouches[0];
    look.id = t.identifier; look.lx = t.clientX; look.ly = t.clientY;
  }, { passive: false });
  lookZone.addEventListener('touchmove', (e) => {
    e.preventDefault();
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];
      if (t.identifier !== look.id) continue;
      const dx = t.clientX - look.lx;
      const dy = t.clientY - look.ly;
      look.lx = t.clientX; look.ly = t.clientY;
      addLook(dx, dy);
    }
  }, { passive: false });
  const endLook = (e) => {
    e.preventDefault();
    for (let i = 0; i < e.changedTouches.length; i++) {
      if (e.changedTouches[i].identifier === look.id) look.id = null;
    }
  };
  lookZone.addEventListener('touchend', endLook, { passive: false });
  lookZone.addEventListener('touchcancel', endLook, { passive: false });

  // ---- action buttons ----
  // stopPropagation on every button so a tap on a button never also feeds
  // the look/stick handler sitting behind it.
  const bindHold = (btn, onDown, onUp) => {
    const down = (e) => {
      e.preventDefault(); e.stopPropagation();
      if (onDown) onDown();
      btn.classList.add('active');
    };
    const up = (e) => {
      e.preventDefault(); e.stopPropagation();
      if (onUp) onUp();
      btn.classList.remove('active');
    };
    btn.addEventListener('touchstart', down, { passive: false });
    btn.addEventListener('touchend', up, { passive: false });
    btn.addEventListener('touchcancel', up, { passive: false });
  };

  // FIRE: hold to auto-fire. Fire immediately on press for responsiveness;
  // subsequent shots are throttled by FIRE_CD in the animate loop.
  bindHold(document.getElementById('btn-fire'),
    () => { setFireHeld(true); tryShoot(); },
    () => { setFireHeld(false); });

  // JUMP: edge-triggered; updatePlayer consumes queueJump via consumeJump.
  bindHold(document.getElementById('btn-jump'),
    () => { queueJump(); }, null);

  // RELOAD: one-shot.
  bindHold(document.getElementById('btn-reload'),
    () => { tryReload(); }, null);

  // ADS: toggle (stays "active" while zoomed).
  const adsBtn = document.getElementById('btn-ads');
  adsBtn.addEventListener('touchstart', (e) => {
    e.preventDefault(); e.stopPropagation();
    S.keys.aiming = !S.keys.aiming;
    adsBtn.classList.toggle('active', S.keys.aiming);
  }, { passive: false });
}

// reference-only export to keep isTouch imported-under-this-module semantic
// (setupTouchControls is only called when isTouch is true; mirroring the
// constant here documents that contract to readers).
export const TOUCH_ONLY = isTouch;
