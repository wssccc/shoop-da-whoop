// Entry point: wires the Game, renderer, drag controller, persistence, audio and
// achievements together, and binds the toolbar buttons.


import { FLIP_MS, captureRects, playFlip } from './anim.js';
import { Audio } from './audio.js';
import { Game } from './game.js';
import { DragController } from './input.js';
import { Render, buildCard } from './render.js';
import * as Rules from './rules.js';
import { fromLayout } from './state.js';
import { Storage } from './storage.js';

const $ = sel => document.querySelector(sel);

const game = new Game();

// Resume an in-progress game if one was saved.
const saved = Storage.loadGame();
if (saved) game.state = fromLayout(saved);
game.applyAutoMoves(); // settle any exposed flower / safe aces on boot

let wins = Storage.getWins();
let muted = Storage.getMuted();
Audio.setMuted(muted);

// ---- Rendering & chrome ----
// renderAll() wraps Render.board() in a FLIP pass so any card whose slot
// changed between renders eases from its previous position to the new one.
// This covers undo, dragon-collect aftermath and the auto-move cascade inside
// a single move; drag success/cancel is seeded by input.js (see onUp).
function renderAll() {
  window.__renderCount = (window.__renderCount || 0) + 1;
  const board = $('#board');
  const firstRects = captureRects(board);
  Render.board(game.getState());
  updateChrome();
  // playFlip returns the full animation time (incl. cascade stagger) so the
  // win modal can be deferred until the final foundation flight has landed.
  lastFlipMs = playFlip(board, firstRects) || FLIP_MS;
}

function updateChrome() {
  const st = game.getState();
  $('#btn-undo').disabled = !game.canUndo();
  $('#dragon-btn').classList.toggle('ready', !!Rules.readyDragonColor(st));
  const rc = Rules.readyDragonColor(st);
  if (rc) {
    $('#dragon-btn').dataset.color = rc;
  } else {
    delete $('#dragon-btn').dataset.color;
  }
  $('#wins-count').textContent = String(wins);
  $('#btn-mute').textContent = muted ? '🔇' : '🔊';

}

// ---- Game events ----
game.on('sound', name => { if (Audio[name]) Audio[name](); });

// 'change' fires after any committed mutation (move, undo, dragon-collect).
// renderAll()'s FLIP pass animates each relocated card; afterwards we persist.
// (Auto-cascades induced inside one move collapse into a single animated render
// instead of queued clones, so there is no longer an autoMove handler.)
game.on('change', () => {
  renderAll();
  Storage.saveGame(game.getState());
});

game.on('dealing', () => {
  // Clear tableau so cards fly into an empty board.
  for (let col = 0; col < 8; col++) {
    const colEl = document.getElementById('col-' + col);
    if (colEl) { colEl.innerHTML = ''; colEl.classList.add('empty'); }
  }
  // Also clear foundations, flower slot and free cells for a clean start.
  for (const color of ['red', 'black', 'green']) {
    const slot = document.getElementById('found-' + color);
    if (slot) { slot.innerHTML = ''; slot.classList.add('empty'); slot.classList.remove('c-red', 'c-black', 'c-green'); }
  }
  const fs = document.getElementById('flower-slot');
  if (fs) { fs.innerHTML = ''; fs.classList.add('empty'); }
  for (let i = 0; i < 3; i++) {
    const fc = document.getElementById('fc-' + i);
    if (fc) { fc.innerHTML = ''; fc.classList.add('empty'); fc.classList.remove('locked', 'c-red', 'c-black', 'c-green'); }
  }

  const state = game.getState();
  const flowerSlot = document.getElementById('flower-slot');
  const originRect = flowerSlot ? flowerSlot.getBoundingClientRect() : null;

  // Build deal sequence in dealing order (round-robin across columns).
  const dealSequence = [];
  for (let row = 0; row < state.tableau[0].length; row++) {
    for (let col = 0; col < state.tableau.length; col++) {
      if (state.tableau[col][row]) {
        dealSequence.push({ card: state.tableau[col][row], col });
      }
    }
  }

  let idx = 0;
  function dealNext() {
    if (idx >= dealSequence.length) {
      game.applyAutoMoves();
      renderAll();
      Storage.saveGame(game.getState());
      return;
    }
    const { card, col } = dealSequence[idx++];
    const colEl = document.getElementById('col-' + col);
    colEl.classList.remove('empty');

    // Insert the real card hidden.
    const cardEl = buildCard(card);
    cardEl.style.opacity = '0';
    colEl.appendChild(cardEl);

    // Create flying clone from the flower slot.
    const rect = cardEl.getBoundingClientRect();
    const clone = cardEl.cloneNode(true);
    clone.classList.add('flying-card');
    clone.style.opacity = '1';
    if (originRect) {
      clone.style.left = originRect.left + 'px';
      clone.style.top = originRect.top + 'px';
    } else {
      clone.style.left = (window.innerWidth / 2 - rect.width / 2) + 'px';
      clone.style.top = (window.innerHeight / 2 - rect.height / 2) + 'px';
    }
    clone.style.width = rect.width + 'px';
    clone.style.height = rect.height + 'px';
    document.body.appendChild(clone);

    const cloneRect = clone.getBoundingClientRect();
    const dx = rect.left - cloneRect.left;
    const dy = rect.top - cloneRect.top;

    requestAnimationFrame(() => {
      clone.style.transform = `translate(${dx}px, ${dy}px)`;
    });

    setTimeout(() => {
      cardEl.style.opacity = '1';
      clone.remove();
      dealNext();
    }, 100);
  }

  dealNext();
});

// 'win' fires synchronously right after 'change' (which started the FLIP
// flight). Defer the modal until that flight has visually settled so the last
// foundation cards land before the overlay appears. On a winning solve the
// cascade often runs many staggered cards, so wait for that full duration
// rather than the single-card FLIP_MS.
let winTimer = null;
let lastFlipMs = FLIP_MS;
game.on('win', () => {
  wins += 1;
  Storage.setWins(wins);
  clearTimeout(winTimer);
  winTimer = setTimeout(() => {
    // Guard: the user may have started a new game while we were waiting.
    if (Rules.isWin(game.getState())) showWin();
  }, Math.max(FLIP_MS + 120, lastFlipMs + 160));
});

// ---- Toasts ----
function showToast(text) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = text;
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), 2300);
}

// ---- Win overlay ----
function showWin() {
  $('#win-wins').textContent = String(wins);
  $('#win-overlay').hidden = false;
}
function hideWin() { $('#win-overlay').hidden = true; }

// ---- Buttons ----
$('#btn-new').addEventListener('click', () => {
  Audio.resume();
  hideWin();
  game.newGame();
});
$('#btn-undo').addEventListener('click', () => {
  if (!game.undo()) Audio.error();
});
$('#btn-mute').addEventListener('click', () => {
  muted = !muted;
  Audio.setMuted(muted);
  Storage.setMuted(muted);
  updateChrome();
  if (!muted) { Audio.resume(); Audio.place(); }
});
$('#dragon-btn').addEventListener('click', () => {
  const color = Rules.readyDragonColor(game.getState());
  if (!color) { Audio.error(); return; }
  const r = game.collectDragons(color);
  if (!r.ok) Audio.error();
});
$('#play-again').addEventListener('click', () => {
  hideWin();
  game.newGame();
});

// ---- Keyboard shortcuts ----
window.addEventListener('keydown', e => {
  const tag = (e.target && e.target.tagName) || '';
  if (tag === 'INPUT' || tag === 'TEXTAREA') return;
  const k = e.key.toLowerCase();
  if (k === 'n') $('#btn-new').click();
  else if (k === 'u' || k === 'z') $('#btn-undo').click();
  else if (k === 'm') $('#btn-mute').click();
  else if (k === 'c') $('#dragon-btn').click();
  else if (k === 'f') $('#btn-fullscreen').click();
});

// ---- Fullscreen / landscape (mobile) ----
const fsSupported = !!(document.documentElement.requestFullscreen ||
                       document.documentElement.webkitRequestFullscreen);
function isFullscreen() {
  return !!(document.fullscreenElement || document.webkitFullscreenElement);
}
async function toggleFullscreen() {
  if (!fsSupported) return;
  Audio.resume();
  if (isFullscreen()) {
    try { await document.exitFullscreen(); } catch {}
    return;
  }
  const el = document.documentElement;
  try {
    if (el.requestFullscreen) await el.requestFullscreen();
    else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
  } catch {}
  // Lock to landscape when supported (mobile; requires fullscreen).
  const orient = window.screen && window.screen.orientation;
  if (orient && typeof orient.lock === 'function') {
    try { await orient.lock('landscape'); } catch {}
  }
}
function syncFullscreen() {
  const btn = $('#btn-fullscreen');
  if (!btn) return;
  btn.classList.toggle('fs-active', isFullscreen());
  btn.title = isFullscreen() ? '退出全屏 (F)' : '横屏全屏 (F)';
}
$('#btn-fullscreen').addEventListener('click', toggleFullscreen);
document.addEventListener('fullscreenchange', syncFullscreen);
document.addEventListener('webkitfullscreenchange', syncFullscreen);
if (!fsSupported) $('#btn-fullscreen').style.display = 'none';
syncFullscreen();

// ---- iOS Safari long-press defenses ----
// On iOS 13/14 (our legacy floor) `user-select:none` + `-webkit-touch-callout:none`
// are not always honoured: a sustained touch still summons the system "Select /
// Copy / Look Up" callout. Block that by cancelling the gesture-driven events.
// `selectionchange` fires when iOS begins a native selection pass; preventing
// the preceding `selectstart` stops it before it takes hold.
document.addEventListener('selectstart', e => e.preventDefault(), { passive: false });
document.addEventListener('contextmenu',  e => e.preventDefault(), { passive: false });
// A *stationary* long touch is what iOS turns into the callout. A genuine tap
// or pointer drag starts immediately, so we only kill the gesture if the touch
// is held without moving for 350ms+ (drag is already immune because DragController
// consumes pointer events). Done via a one-shot timer flipped by touchend/move.
let longPressTimer = null;
function armLongPressLock(e) {
  clearTimeout(longPressTimer);
  // Use the first touch only; secondary touches are multi-touch gestures.
  const t = e.touches && e.touches[0];
  if (!t) return;
  longPressTimer = setTimeout(() => {
    // Once the long-press threshold elapses, suppress what iOS will show next.
    const guard = ev => { ev.preventDefault(); };
    window.addEventListener('touchend', guard, { once: true, capture: true });
    window.addEventListener('touchmove', guard, { once: true, capture: true });
    setTimeout(() => {
      window.removeEventListener('touchend', guard, { capture: true });
      window.removeEventListener('touchmove', guard, { capture: true });
    }, 800);
  }, 350);
}
function cancelLongPressLock() { clearTimeout(longPressTimer); }
window.addEventListener('touchstart', armLongPressLock, { passive: true });
window.addEventListener('touchmove',  cancelLongPressLock, { passive: true });
window.addEventListener('touchend',   cancelLongPressLock, { passive: true });
window.addEventListener('touchcancel',cancelLongPressLock, { passive: true });

// ---- Boot ----
new DragController($('#board'), game);
renderAll();

// Debug hook (harmless in production).
window.__game = game;
window.__rules = Rules;
