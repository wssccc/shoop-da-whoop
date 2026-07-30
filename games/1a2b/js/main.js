// Entry point: wires the Game, renderer, persistence, audio, achievements and
// the SHOOP DA WHOOP laser celebration together, and binds the toolbar / keypad.
//
// Data flow is one-way, like solitaire: user input → Game method → emit event
// → renderAll() rebuilds the DOM + Storage persists.

import { checkAchievements } from './achievements.js';
import { Audio } from './audio.js';
import { Game } from './game.js';
import { Render } from './render.js';
import { Storage } from './storage.js';

const $ = sel => document.querySelector(sel);

const game = new Game();

// Resume an in-progress game if one was saved; otherwise the fresh state from
// the constructor stands (no newgame sound on cold boot — keep it quiet).
const saved = Storage.loadGame();
if (saved) game.state = saved;
game._winAwarded = !!game.state.won; // a resumed, already-won game re-awards nothing

let stats = Storage.getStats();
let muted = Storage.getMuted();
Audio.setMuted(muted);

let theme = Storage.getTheme();

function resolveTheme() {
  if (theme === 'light' || theme === 'dark') return theme;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme() {
  const resolved = resolveTheme();
  document.documentElement.dataset.theme = resolved;

  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = resolved === 'dark' ? '#2a2622' : '#f3ede1';

  const btn = $('#btn-theme');
  if (btn) btn.textContent = theme === 'auto' ? '🌗' : (resolved === 'dark' ? '🌙' : '☀️');
}

function toggleTheme() {
  const cycle = { auto: 'light', light: 'dark', dark: 'auto' };
  theme = cycle[theme] || 'auto';
  Storage.setTheme(theme);
  applyTheme();
}

// ---- Rendering & chrome ----

function updateFireButton() {
  const btn = $('#keypad .key-fire');
  const over = game.state.won || game.state.lost;
  const ready = game.state.input.length === 4 && !over;
  btn.classList.toggle('ready', ready);
  btn.disabled = !ready;
}

function renderAll() {
  window.__renderCount = (window.__renderCount || 0) + 1;
  const st = game.getState();
  Render.input(st);
  Render.history(st);
  Render.stats(stats);
  updateFireButton();
}

// ---- Toasts & celebration ----

function showToast(msg) {
  const host = $('#toasts');
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  host.appendChild(el);
  setTimeout(() => {
    el.classList.add('leaving');
    el.addEventListener('animationend', () => el.remove(), { once: true });
  }, 2300);
}

/** Trigger the win celebration: stamp + ink-splash + content pop. */
function playWinCelebration() {
  const overlay = $('#win-overlay');
  overlay.hidden = false;

  overlay.classList.add('celebrate');
  const cleanup = () => overlay.classList.remove('celebrate');
  // the longest animation among stamp/splash wins the race
  overlay.addEventListener('animationend', cleanup, { once: true });
  setTimeout(cleanup, 1200);
}

/** Trigger the out-of-shots reveal: a sombre stamp + content pop. */
function playLoseCelebration() {
  const overlay = $('#lose-overlay');
  overlay.hidden = false;

  overlay.classList.add('celebrate');
  const cleanup = () => overlay.classList.remove('celebrate');
  overlay.addEventListener('animationend', cleanup, { once: true });
  setTimeout(cleanup, 1200);
}

// ---- Confirm dialog (returns a Promise<boolean>) ----

function confirmDialog(message) {
  return new Promise(resolve => {
    const overlay = $('#confirm-overlay');
    $('#confirm-msg').textContent = message;
    overlay.hidden = false;

    const ok = $('#confirm-ok');
    const cancel = $('#confirm-cancel');
    const done = (result) => {
      overlay.hidden = true;
      ok.removeEventListener('click', onOk);
      cancel.removeEventListener('click', onCancel);
      document.removeEventListener('keydown', onKey);
      resolve(result);
    };
    const onOk = () => done(true);
    const onCancel = () => done(false);
    // Enter confirms, Escape cancels while the dialog is up.
    const onKey = (e) => {
      if (e.key === 'Enter') { e.preventDefault(); done(true); }
      else if (e.key === 'Escape') { e.preventDefault(); done(false); }
    };
    ok.addEventListener('click', onOk);
    cancel.addEventListener('click', onCancel);
    document.addEventListener('keydown', onKey);
  });
}

// ---- Win flow ----

function onWin(payload) {
  const used = payload.guesses; // guesses spent to win this game
  stats.games += 1;
  stats.total += used;
  if (stats.best == null || used < stats.best) stats.best = used;
  Storage.setStats(stats);

  // The game is finished: drop the in-progress save so a refresh starts fresh.
  Storage.clearSave();

  // Celebrate the win.
  playWinCelebration();

  checkAchievements(stats, used, a => showToast(`${a.icon} ${a.name}`));

  $('#win-result').textContent = `用 ${used} 次猜中！最佳：${stats.best == null ? '—' : stats.best}`;
  renderAll();
}

// ---- Lose flow ----

function onLose(payload) {
  // Out of guesses: drop the in-progress save so a refresh starts fresh.
  Storage.clearSave();

  playLoseCelebration();

  $('#lose-result').textContent = payload.secret;
  renderAll();
}

// ---- Game events ----

game.on('newgame', () => { /* sound handled below; render via 'change' */ });
game.on('sound', name => { Audio.resume(); if (Audio[name]) Audio[name](); });
game.on('change', () => {
  renderAll();
  // Persist the in-progress state only while a game is actually live.
  if (!game.state.won && !game.state.lost) Storage.saveGame(game.state);
});
game.on('win', onWin);
game.on('lose', onLose);

// ---- Actions ----

function doNewGame() {
  Audio.resume();
  game.newGame();
}

async function requestNewGame() {
  // Confirm only if there's measurable progress to throw away.
  if (game.state.guesses.length > 0 && !game.state.won && !game.state.lost) {
    const ok = await confirmDialog('当前局有未完成的进度，确定开始新局吗？');
    if (!ok) return;
  }
  $('#win-overlay').hidden = true;
  $('#lose-overlay').hidden = true;
  doNewGame();
}

async function requestReset() {
  const ok = await confirmDialog('确定清除全部统计与存档吗？此操作不可撤销。');
  if (!ok) return;
  Storage.clearAll();
  stats = Storage.getStats();
  muted = Storage.getMuted();
  Audio.setMuted(muted);
  $('#win-overlay').hidden = true;
  $('#lose-overlay').hidden = true;
  doNewGame();
  applyMuteIcon();
  showToast('已清除全部记录');
}

function toggleMute() {
  muted = !muted;
  Audio.setMuted(muted);
  Storage.setMuted(muted);
  applyMuteIcon();
}

function applyMuteIcon() {
  $('#btn-mute').textContent = muted ? '🔇' : '🔊';
  $('#btn-mute').classList.toggle('muted', muted);
}

function toggleFullscreen() {
  Audio.resume();
  const doc = document;
  const el = document.documentElement;
  try {
    if (!doc.fullscreenElement && !doc.webkitFullscreenElement) {
      const req = el.requestFullscreen || el.webkitRequestFullscreen;
      if (req) req.call(el);
    } else {
      const exit = doc.exitFullscreen || doc.webkitExitFullscreen;
      if (exit) exit.call(doc);
    }
  } catch (_) { /* unsupported (e.g. iOS Safari) — silently ignore */ }
}

// ---- Keypad & keyboard input ----

function fireRecoil() {
  const btn = $('#keypad .key-fire');
  btn.classList.add('firing');
  btn.addEventListener('animationend', () => btn.classList.remove('firing'), { once: true });
}

function shakeInput() {
  const el = $('#input-display');
  el.classList.remove('shake');
  // reflow so the animation can restart
  void el.offsetWidth;
  el.classList.add('shake');
  el.addEventListener('animationend', () => el.classList.remove('shake'), { once: true });
}

function handleKey(key) {
  Audio.resume();
  if (key === 'fire') {
    if (game.state.won || game.state.lost) return;
    const res = game.submitGuess();
    if (res.ok) {
      fireRecoil();
    } else {
      shakeInput();
    }
    return;
  }
  if (key === 'back') { game.backspace(); return; }
  if (key === 'clear') { game.clearInput(); return; }
  if (/^[0-9]$/.test(key)) { game.inputDigit(key); return; }
}

// Keypad button delegation via data-key.
$('#keypad').addEventListener('click', e => {
  const btn = e.target.closest('[data-key]');
  if (!btn) return;
  handleKey(btn.dataset.key);
});

// Physical keyboard.
document.addEventListener('keydown', e => {
  // Ignore typing that originates inside a real text field (none here, but safe).
  if (e.target.matches && e.target.matches('input, textarea')) return;
  // Don't hijack browser shortcuts with modifiers.
  if (e.ctrlKey || e.metaKey || e.altKey) return;

  if (e.key >= '0' && e.key <= '9') { e.preventDefault(); handleKey(e.key); return; }
  switch (e.key) {
    case 'Enter': e.preventDefault(); handleKey('fire'); return;
    case 'Backspace': e.preventDefault(); handleKey('back'); return;
    case 'Escape': e.preventDefault(); if (!game.state.won) game.clearInput(); return;
    case 'n': case 'N': e.preventDefault(); requestNewGame(); return;
    case 'm': case 'M': e.preventDefault(); toggleMute(); return;
    case 'f': case 'F': e.preventDefault(); toggleFullscreen(); return;
    case 't': case 'T': e.preventDefault(); toggleTheme(); return;
  }
});

// ---- Toolbar wiring ----
$('#btn-theme').addEventListener('click', toggleTheme);
$('#btn-mute').addEventListener('click', toggleMute);
$('#btn-new').addEventListener('click', requestNewGame);
$('#btn-reset').addEventListener('click', requestReset);
$('#btn-fullscreen').addEventListener('click', toggleFullscreen);
$('#win-again').addEventListener('click', () => {
  $('#win-overlay').hidden = true;
  doNewGame();
});
$('#lose-again').addEventListener('click', () => {
  $('#lose-overlay').hidden = true;
  doNewGame();
});

// iOS long-press defence: the system context menu likes to steal touch-holds,
// so swallow the tail of a long press like solitaire does.
let pressTimer = null;
document.addEventListener('touchstart', () => {
  pressTimer = setTimeout(() => { pressTimer = 'blocked'; }, 350);
}, { passive: true });
document.addEventListener('touchmove', () => { if (pressTimer) pressTimer = 'blocked'; }, { passive: true });
document.addEventListener('touchend', e => {
  if (pressTimer === 'blocked') {
    e.preventDefault();
    pressTimer = null;
  } else if (pressTimer) {
    clearTimeout(pressTimer);
    pressTimer = null;
  }
}, { passive: false });

// ---- Boot ----
applyTheme();
applyMuteIcon();
renderAll();

// Re-evaluate when system scheme changes while in auto mode.
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if (theme === 'auto') applyTheme();
});

// Expose for console debugging, mirroring solitaire's convention.
window.__game = game;
