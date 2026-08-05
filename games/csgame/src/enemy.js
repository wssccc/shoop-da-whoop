// enemy.js — bot caps: spawning, taking damage (flashing + ragdoll burst),
// health-bar billboard. AI movement/shooting lives in physics.js.

import * as THREE from 'three';
import { burstParticles, pushFeed } from './fx.js';
import { bindKills } from './hud.js';
import {
    ENEMY_FIRE_CD,
    ENEMY_H,
    ENEMY_HP, ENEMY_R,
    MAX_ENEMIES, RESPAWN_SEC,
    S,
} from './state.js';

export function spawnEnemy(fromPos) {
  // pick a spawn point far enough from the player
  const playerPos = S.camera.position;
  let pos = null;
  for (let tries = 0; tries < 24; tries++) {
    const c = S.enemySpawns[Math.floor(Math.random() * S.enemySpawns.length)];
    const d = c.distanceTo(playerPos);
    if (d > 18 || tries > 16) { pos = fromPos || c.clone(); break; }
  }
  if (!pos) pos = S.enemySpawns[0].clone();

  const group = new THREE.Group();
  group.position.copy(pos);
  group.position.y = 0;

  const skin = new THREE.MeshStandardMaterial({ color: 0xb54036, roughness: 0.7, emissive: 0x000000 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x2a2a30, roughness: 0.6, metalness: 0.4 });
  const headMat = new THREE.MeshStandardMaterial({ color: 0xe8c79a, roughness: 0.85 });

  // torso (capsule-ish)
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(ENEMY_R * 0.85, 0.85, 6, 12), skin);
  torso.position.y = 1.10;
  torso.castShadow = true; torso.receiveShadow = true;
  torso.userData.bodypart = 'torso';
  group.add(torso);

  // head
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 16, 14), headMat);
  head.position.y = 1.78;
  head.castShadow = true;
  head.userData.bodypart = 'head';
  group.add(head);

  // helmet line
  const helm = new THREE.Mesh(new THREE.SphereGeometry(0.235, 16, 8, 0, Math.PI * 2, 0, Math.PI * 0.5), dark);
  helm.position.y = 1.79;
  group.add(helm);

  // arms
  const armMat = skin;
  const armGeo = new THREE.CapsuleGeometry(0.13, 0.55, 4, 8);
  const armL = new THREE.Mesh(armGeo, armMat); armL.position.set(-0.42, 1.18, 0); armL.castShadow = true;
  const armR = new THREE.Mesh(armGeo, armMat); armR.position.set(0.42, 1.18, 0); armR.castShadow = true;
  armL.userData.bodypart = 'torso'; armR.userData.bodypart = 'torso';
  group.add(armL, armR);

  // legs
  const legMat = dark;
  const legGeo = new THREE.CapsuleGeometry(0.16, 0.55, 4, 8);
  const legL = new THREE.Mesh(legGeo, legMat); legL.position.set(-0.18, 0.42, 0); legL.castShadow = true;
  const legR = new THREE.Mesh(legGeo, legMat); legR.position.set(0.18, 0.42, 0); legR.castShadow = true;
  legL.userData.bodypart = 'leg'; legR.userData.bodypart = 'leg';
  group.add(legL, legR);

  // gun held in right arm
  const egun = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.4), dark);
  egun.position.set(0.42, 1.10, 0.18);
  group.add(egun);

  // health bar (billboarded sprite via 2 meshes that we rotate manually)
  const barBg = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.09),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.55 }));
  const bar = new THREE.Mesh(new THREE.PlaneGeometry(0.86, 0.05),
    new THREE.MeshBasicMaterial({ color: 0xff4040 }));
  barBg.position.y = 2.06; bar.position.set(0, 2.06, 0.001);
  group.add(barBg, bar);

  S.scene.add(group);

  const box = new THREE.Box3(
    new THREE.Vector3(-ENEMY_R, 0, -ENEMY_R),
    new THREE.Vector3(ENEMY_R, ENEMY_H, ENEMY_R)
  );
  const e = {
    group, head, torso, bar, barBg, legL, legR, armL, armR,
    box, hp: ENEMY_HP, alive: true,
    fireCd: 1 + Math.random() * ENEMY_FIRE_CD,
    burstLeft: 0, nextBurstCd: 0,
    walkPhase: Math.random() * Math.PI * 2,
    aim: new THREE.Vector3(),
  };
  S.enemies.push(e);
}

export function damageEnemy(e, amount, headshot, fromPos) {
  if (!e.alive) return;
  e.hp -= amount * (headshot ? 2.4 : 1);
  flashEnemy(e);
  if (e.hp <= 0) {
    e.alive = false;
    S.stats.kills++;
    bindKills();
    pushFeed(`敌兵 ${headshot ? '「HEADSHOT」' : ''} 被击杀`);
    ragdoll(e);
    S.scene.remove(e.group);
    // respawn timer (only if we are not over-populated / not game over)
    setTimeout(() => {
      const idx = S.enemies.indexOf(e);
      if (idx >= 0) { S.enemies.splice(idx, 1); }
      if (!S.player.gameOver && S.enemies.length < MAX_ENEMIES) spawnEnemy();
    }, RESPAWN_SEC * 1000);
  }
  // update bar
  const ratio = Math.max(0, e.hp / ENEMY_HP);
  e.bar.scale.x = Math.max(0.0001, ratio);
  e.bar.material.color.setHSL(0.0, 0.9, 0.35 + ratio * 0.25);
}

function flashEnemy(e) {
  if (!e.torso) return;
  e.torso.material.emissive.setHex(0x661111);
  e.torso.material.emissiveIntensity = 0.7;
  setTimeout(() => {
    if (e.torso && e.torso.material) e.torso.material.emissiveIntensity = 0;
  }, 90);
}

// sparkle on death covers the moment the body is removed
function ragdoll(e) {
  e.laidOut = true;
  burstParticles(e.group.position.clone().setY(1.2), 0xff6b3a, 18);
}
