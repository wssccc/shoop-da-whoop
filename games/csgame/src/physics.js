// physics.js — per-frame integration: player movement (keyboard + analog
// stick merged), AABB push-out against world solids, gravity + jump, and
// the enemy AI (chase / strafe / line-of-sight burst fire).

import * as THREE from 'three';
import { spawnTracer } from './fx.js';
import { playerTakeDamage } from './player.js';
import { finishReloadIfDue } from './shoot.js';
import {
    ARENA,
    consumeJump,
    ENEMY_BURST, ENEMY_BURST_GAP, ENEMY_DMG,
    ENEMY_FIRE_CD,
    ENEMY_H,
    ENEMY_HIT_P,
    ENEMY_R,
    ENEMY_RANGE,
    ENEMY_SPEED,
    EYE_HEIGHT,
    GRAVITY,
    isTouch,
    JUMP_V,
    RADIUS,
    RUN_SPEED,
    S,
    touchMoveX, touchMoveY,
    touchPitch,
    touchRun,
    touchYaw,
    WALK_SPEED,
} from './state.js';
import { positionWeapon } from './weapon.js';

export function updatePlayer(dt, now) {
  const obj = S.camera;

  // Touch branch owns look: write the accumulated touch euler into the
  // camera every frame. Desktop leaves this to PointerLockControls.
  if (isTouch) {
    S.camera.rotation.set(touchPitch, touchYaw, 0, 'YXZ');
  }

  // Inputs from BOTH keyboard and on-screen stick (where present). The
  // stick reports analog values; we threshold for a deterministic walk.
  const running = S.keys.run || touchRun;
  const speed = running ? RUN_SPEED : WALK_SPEED;

  const forwardInput = S.keys.forward || touchMoveY < -0.3;
  const backInput    = S.keys.back    || touchMoveY >  0.3;
  const leftInput    = S.keys.left    || touchMoveX < -0.3;
  const rightInput   = S.keys.right   || touchMoveX >  0.3;

  // desired direction from inputs (camera-relative)
  const fwd = new THREE.Vector3();
  S.camera.getWorldDirection(fwd); fwd.y = 0; fwd.normalize();
  const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize();

  const dir = new THREE.Vector3();
  if (forwardInput) dir.add(fwd);
  if (backInput)    dir.sub(fwd);
  if (rightInput)   dir.add(right);
  if (leftInput)    dir.sub(right);
  if (dir.lengthSq() > 0) dir.normalize().multiplyScalar(speed * dt);

  // Jump: keyboard fires directly from onKey; touch edge-jumps via the
  // queue. consumeJump() drains it (only one jump per press).
  if (consumeJump() && S.player.onGround) {
    S.player.velY = JUMP_V; S.player.onGround = false;
  }

  // vertical motion (gravity)
  S.player.velY -= GRAVITY * dt;
  const dy = S.player.velY * dt;

  // propose move
  let np = obj.position.clone();
  np.x += dir.x; np.z += dir.z; np.y += dy;

  // collision: walls/crates (xz) -> resolve
  np = resolveCollisions(obj.position, np);

  // ground collision
  const groundY = EYE_HEIGHT;
  if (np.y <= groundY) { np.y = groundY; S.player.velY = 0; S.player.onGround = true; }
  else S.player.onGround = false;

  // arena keep-in
  const lim = ARENA - 1;
  np.x = Math.max(-lim, Math.min(lim, np.x));
  np.z = Math.max(-lim, Math.min(lim, np.z));

  obj.position.copy(np);

  // weapon bob / aim transition / recoil decay
  S.weaponRecoil = Math.max(0, S.weaponRecoil - dt * 1.8);
  positionWeapon();
  S.weaponGroup.position.z += S.weaponRecoil * 0.18;
  S.weaponGroup.rotation.x = -S.weaponRecoil * 0.5;
  // walk bob
  if (dir.lengthSq() > 0 && S.player.onGround) {
    S.weaponSwing += dt * (running ? 14 : 9);
    S.weaponGroup.position.y += Math.sin(S.weaponSwing) * 0.008;
    S.weaponGroup.position.x += Math.cos(S.weaponSwing * 0.5) * 0.005;
  }
  // muzzle decay
  S.muzzleFlash.material.opacity = Math.max(0, S.muzzleFlash.material.opacity - dt * 16);
  S.muzzleLight.intensity = Math.max(0, S.muzzleLight.intensity - dt * 60);

  finishReloadIfDue(now);
}

export function resolveCollisions(oldPos, newPos) {
  const r = RADIUS;
  const p = newPos.clone();
  for (const box of S.colliders) {
    // expand to player radius on xz
    const minX = box.min.x - r, maxX = box.max.x + r;
    const minZ = box.min.z - r, maxZ = box.max.z + r;
    const minY = box.min.y, maxY = box.max.y;
    // only matters if player eye height overlaps box y-range
    if (p.y < minY || p.y > maxY + 0.05) continue;
    if (p.x > minX && p.x < maxX && p.z > minZ && p.z < maxZ) {
      // figure smallest push-out
      const dLeft = p.x - minX;
      const dRight = maxX - p.x;
      const dFront = p.z - minZ;
      const dBack = maxZ - p.z;
      const m = Math.min(dLeft, dRight, dFront, dBack);
      if (m === dLeft) p.x = minX;
      else if (m === dRight) p.x = maxX;
      else if (m === dFront) p.z = minZ;
      else p.z = maxZ;
    }
  }
  return p;
}

export function updateEnemies(dt, now) {
  const playerPos = S.camera.position;
  for (const e of S.enemies) {
    // billboard the health bar
    if (e.bar.parent) {
      e.bar.parent.children.forEach(child => {
        if (child === e.bar || child === e.barBg) {
          child.quaternion.copy(S.camera.quaternion);
        }
      });
    }
    if (!e.alive) continue;

    const headPos = e.group.position.clone().setY(1.7);
    const toPlayer = playerPos.clone().sub(headPos);
    const dist = toPlayer.length();
    toPlayer.y = 0; toPlayer.normalize();

    // walk toward player if out of preferred range, strafe in range
    const desired = 12;
    let moveX = 0, moveZ = 0;
    if (dist > desired + 3) {
      moveX = toPlayer.x * ENEMY_SPEED * dt;
      moveZ = toPlayer.z * ENEMY_SPEED * dt;
    } else if (dist < desired - 2) {
      moveX = -toPlayer.x * ENEMY_SPEED * 0.5 * dt;
      moveZ = -toPlayer.z * ENEMY_SPEED * 0.5 * dt;
    } else {
      // strafe sideways
      const side = new THREE.Vector3(-toPlayer.z, 0, toPlayer.x);
      const s = Math.sin(now * 0.001 + e.walkPhase) > 0 ? 1 : -1;
      moveX = side.x * ENEMY_SPEED * 0.6 * s * dt;
      moveZ = side.z * ENEMY_SPEED * 0.6 * s * dt;
    }

    // face player
    e.group.rotation.y = Math.atan2(toPlayer.x, toPlayer.z);

    // leg animation
    e.walkPhase += dt * 8;
    e.legL.rotation.x = Math.sin(e.walkPhase) * 0.5;
    e.legR.rotation.x = -Math.sin(e.walkPhase) * 0.5;
    if (Math.abs(moveX) + Math.abs(moveZ) < 0.0001) { e.legL.rotation.x = 0; e.legR.rotation.x = 0; }

    // collision against solids (so enemies don't walk through crates)
    let np = e.group.position.clone();
    np.x += moveX; np.z += moveZ;
    np = resolveCollisionsEnemy(np);
    const lim = ARENA - 1.5;
    np.x = Math.max(-lim, Math.min(lim, np.x));
    np.z = Math.max(-lim, Math.min(lim, np.z));
    e.group.position.copy(np);

    // update enemy AABB (just motion-derived)
    e.box.min.set(np.x - ENEMY_R, 0, np.z - ENEMY_R);
    e.box.max.set(np.x + ENEMY_R, ENEMY_H, np.z + ENEMY_R);

    // shooting logic
    if (dist < ENEMY_RANGE && hasLineOfSight(headPos, playerPos)) {
      e.fireCd -= dt;
      if (e.fireCd <= 0) {
        e.burstLeft = ENEMY_BURST;
        e.fireCd = ENEMY_FIRE_CD + Math.random() * 0.8;
      }
      if (e.burstLeft > 0) {
        e.nextBurstCd -= dt;
        if (e.nextBurstCd <= 0) {
          e.nextBurstCd = ENEMY_BURST_GAP;
          enemyShoot(e, headPos, playerPos);
          e.burstLeft--;
        }
      }
    } else {
      e.fireCd = Math.max(0.2, e.fireCd - dt);
    }
  }
}

function resolveCollisionsEnemy(p) {
  const r = ENEMY_R;
  for (const box of S.colliders) {
    const minX = box.min.x - r, maxX = box.max.x + r;
    const minZ = box.min.z - r, maxZ = box.max.z + r;
    if (p.y < box.min.y) continue; // feet below box base assumes 0
    if (p.x > minX && p.x < maxX && p.z > minZ && p.z < maxZ) {
      const dLeft = p.x - minX, dRight = maxX - p.x;
      const dFront = p.z - minZ, dBack = maxZ - p.z;
      const m = Math.min(dLeft, dRight, dFront, dBack);
      if (m === dLeft) p.x = minX;
      else if (m === dRight) p.x = maxX;
      else if (m === dFront) p.z = minZ;
      else p.z = maxZ;
    }
  }
  return p;
}

export function hasLineOfSight(from, to) {
  // NOTE: never include enemy bodies in the blocker set — otherwise the
  // shooter would always block itself and never fire.
  S.raycaster.set(to.clone(), from.clone().sub(to).normalize());
  S.raycaster.far = Infinity;
  // shoot from player eye toward enemy head; if any world solid lies
  // BETWEEN target (to) and observer (from) the LOS is broken.
  const dist = from.distanceTo(to);
  const blockers = [];
  for (const s of S.solids) if (s.kind !== 'ground') blockers.push(s.mesh);
  const hits = S.raycaster.intersectObjects(blockers, false);
  if (hits.length === 0) return true;
  return hits[0].distance >= dist - 0.6;
}

function enemyShoot(e, fromPos, toPos) {
  // muzzle flash at enemy gun
  const dir = toPos.clone().sub(fromPos).normalize();
  fromPos = new THREE.Vector3(e.group.position.x, 1.1, e.group.position.z);
  spawnTracer(fromPos.clone(), toPos.clone().add(dir.clone().multiplyScalar(-0.4)));
  // hit probability check (player must be in sights)
  if (Math.random() < ENEMY_HIT_P) {
    playerTakeDamage(ENEMY_DMG);
  }
}
