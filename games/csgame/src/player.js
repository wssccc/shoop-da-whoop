// player.js — player lifecycle: (re)spawn state, taking damage + low-hp
// FX, and game-over accounting. Movement lives in physics.js.

import { bindAmmo, bindHp, bindKills } from './hud.js';
import {
    MAG_SIZE,
    PLAYER_HP_MAX,
    RESERVE_MAX,
    S,
    disengage,
} from './state.js';

export function resetPlayer(full) {
  if (full || !S.player) {
    S.player = {
      hp: PLAYER_HP_MAX, ammo: MAG_SIZE, reserve: RESERVE_MAX,
      lastShot: 0, reloading: false, reloadEnd: 0,
      velY: 0, onGround: true,
      gameOver: false, started: false,
    };
    S.stats = { kills: 0, shotsFired: 0, shotsHit: 0 };
  } else {
    S.player.hp = PLAYER_HP_MAX;
    S.player.ammo = MAG_SIZE; S.player.reserve = RESERVE_MAX;
    S.player.gameOver = false;
  }
  bindHp(); bindAmmo(); bindKills();
  document.getElementById('lowhp').classList.remove('on');
  document.getElementById('over').classList.add('hidden');
}

export function playerTakeDamage(amount) {
  if (S.player.gameOver) return;
  S.player.hp = Math.max(0, S.player.hp - amount);
  bindHp();
  const dam = document.getElementById('damage');
  dam.classList.add('hit');
  setTimeout(() => dam.classList.remove('hit'), 220);
  if (S.player.hp < 30) document.getElementById('lowhp').classList.add('on');
  if (S.player.hp <= 0) gameOver();
}

export function gameOver() {
  S.player.gameOver = true;
  document.body.classList.add('gameover');
  disengage();
  const acc = S.stats.shotsFired ? Math.round(S.stats.shotsHit / S.stats.shotsFired * 100) : 0;
  document.getElementById('final-kills').textContent = S.stats.kills;
  document.getElementById('final-acc').textContent = acc + '%';
  document.getElementById('over').classList.remove('hidden');
}
