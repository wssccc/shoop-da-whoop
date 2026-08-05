// hud.js — DOM bindings for the HUD (HP bar, ammo, kills counter).

import { PLAYER_HP_MAX, S } from './state.js';

export function bindHp() {
  document.getElementById('hpnum').innerHTML = `${Math.round(S.player.hp)}<small>HP</small>`;
  const ratio = Math.max(0, S.player.hp / PLAYER_HP_MAX);
  const fill = document.getElementById('hpfill');
  fill.style.width = (ratio * 100) + '%';
  const hue = ratio * 130; // 0 red -> 130 green
  fill.style.background = `linear-gradient(90deg, hsl(${hue}, 75%, 45%), hsl(${hue + 25}, 75%, 55%))`;
  if (ratio >= 0.3) document.getElementById('lowhp').classList.remove('on');
}
export function bindAmmo() {
  const m = document.getElementById('mag');
  m.textContent = S.player.ammo;
  m.classList.toggle('empty', S.player.ammo === 0);
  document.getElementById('reserve').textContent = '/ ' + S.player.reserve;
}
export function bindKills() {
  document.getElementById('kills').innerHTML = `${S.stats.kills} <small>KILLS</small>`;
}
