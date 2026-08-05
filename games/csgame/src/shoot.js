// shoot.js — player's hitscan pistol: ray from screen center, headshot
// damage, ammo/reload accounting.

import { Audio } from './audio.js';
import { damageEnemy } from './enemy.js';
import {
    burstParticles,
    ejectShell,
    showHitmarker,
    spawnTracer,
} from './fx.js';
import { bindAmmo } from './hud.js';
import {
    DAMAGE,
    FIRE_CD,
    MAG_SIZE,
    RECOIL_KICK,
    RELOAD_TIME,
    S,
    applyRecoil,
} from './state.js';

export function tryShoot() {
  const now = performance.now() / 1000;
  if (S.player.reloading) return;
  if (now - S.player.lastShot < FIRE_CD) return;
  if (S.player.ammo <= 0) { Audio.playDryFire(); S.player.lastShot = now; return; }

  S.player.ammo--; S.player.lastShot = now;
  S.stats.shotsFired++;
  bindAmmo();
  Audio.playShot();

  // visual recoil
  S.weaponRecoil = Math.min(0.16, S.weaponRecoil + RECOIL_KICK * 22);
  applyRecoil(RECOIL_KICK * (S.keys.aiming ? 0.6 : 1.0));
  // random spread (smaller while aiming)
  S.muzzleFlash.material.opacity = 1;
  S.muzzleFlash.rotation.z = Math.random() * Math.PI;
  S.muzzleFlash.scale.setScalar(0.8 + Math.random() * 0.6);
  S.muzzleLight.intensity = 4;

  // ray from screen center
  S.raycaster.setFromCamera({ x: 0, y: 0 }, S.camera);
  S.raycaster.far = 220;
  const spread = S.keys.aiming ? 0.004 : 0.014;
  const dir = S.raycaster.ray.direction.clone();
  dir.x += (Math.random() - 0.5) * spread;
  dir.y += (Math.random() - 0.5) * spread * 0.6;
  dir.z += (Math.random() - 0.5) * spread;
  dir.normalize();
  const origin = S.raycaster.ray.origin.clone();

  // intersect world solids + enemy parts
  const targets = [];
  for (const s of S.solids) targets.push(s.mesh);
  for (const e of S.enemies) if (e.alive) {
    targets.push(e.head, e.torso, e.armL, e.armR, e.legL, e.legR);
  }
  const hits = S.raycaster.intersectObjects(targets, false);

  let endPoint = origin.clone().addScaledVector(dir, 100);
  if (hits.length) {
    const hit = hits[0];
    endPoint = hit.point.clone();
    const ownerEnemy = findEnemyOfPart(hit.object);
    if (ownerEnemy) {
      const headshot = hit.object.userData.bodypart === 'head';
      damageEnemy(ownerEnemy, DAMAGE, headshot, origin);
      S.stats.shotsHit++;
      showHitmarker();
      Audio.playHit(headshot);
      burstParticles(hit.point.clone(), headshot ? 0xff3b3b : 0xffd060, headshot ? 14 : 8);
    } else {
      burstParticles(hit.point.clone(), 0xd8c59a, 7);
    }
  }
  spawnTracer(origin.clone().addScaledVector(dir, 0.5), endPoint);
  ejectShell();
}

function findEnemyOfPart(obj) {
  if (!obj.parent) return null;
  let p = obj.parent;
  while (p) {
    const found = S.enemies.find(e => e.group === p);
    if (found) return found;
    p = p.parent;
  }
  return null;
}

export function tryReload() {
  if (S.player.reloading) return;
  if (S.player.ammo >= MAG_SIZE) return;
  if (S.player.reserve <= 0) return;
  S.player.reloading = true;
  S.player.reloadEnd = performance.now() / 1000 + RELOAD_TIME;
  document.getElementById('reload-hint').textContent = '装弹中…';
  Audio.playReload();
}
export function finishReloadIfDue(now) {
  if (S.player.reloading && now >= S.player.reloadEnd) {
    const need = MAG_SIZE - S.player.ammo;
    const give = Math.min(need, S.player.reserve);
    S.player.ammo += give;
    S.player.reserve -= give;
    S.player.reloading = false;
    bindAmmo();
    document.getElementById('reload-hint').textContent = '';
  }
}
