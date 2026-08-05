// weapon.js — the first-person pistol viewmodel attached to the camera.

import * as THREE from 'three';
import { S, isEngaged } from './state.js';

export function buildWeapon() {
  S.weaponGroup = new THREE.Group();
  S.camera.add(S.weaponGroup);
  S.scene.add(S.camera);

  const metal = new THREE.MeshStandardMaterial({ color: 0x2a2a2e, roughness: 0.55, metalness: 0.7 });
  const metalD = new THREE.MeshStandardMaterial({ color: 0x14141a, roughness: 0.45, metalness: 0.8 });
  const grip = new THREE.MeshStandardMaterial({ color: 0x171518, roughness: 0.9 });
  const gold = new THREE.MeshStandardMaterial({ color: 0xc89030, roughness: 0.4, metalness: 0.85 });

  // slide / body
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.14, 0.42), metal);
  body.position.set(0, 0, -0.05);
  S.weaponGroup.add(body);

  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.18, 12), metalD);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 0.02, -0.32);
  S.weaponGroup.add(barrel);

  // front + rear sight
  const sight = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.04, 0.012), metalD);
  sight.position.set(0, 0.09, -0.25);
  const sight2 = sight.clone();
  sight2.material = metalD;
  S.weaponGroup.add(sight, sight2);
  sight2.position.set(0, 0.09, 0.14);

  // grip
  const gripMesh = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.22, 0.12), grip);
  gripMesh.position.set(0, -0.17, 0.10);
  gripMesh.rotation.x = 0.18;
  S.weaponGroup.add(gripMesh);

  // trigger guard
  const guard = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.012, 8, 16, Math.PI), metalD);
  guard.rotation.x = -Math.PI / 2;
  guard.position.set(0, -0.06, 0.04);
  S.weaponGroup.add(guard);

  // accent
  const accent = new THREE.Mesh(new THREE.BoxGeometry(0.123, 0.012, 0.32), gold);
  accent.position.set(0, 0.04, -0.04);
  S.weaponGroup.add(accent);

  // magazine
  const mag = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.18, 0.10), metalD);
  mag.position.set(0, -0.22, -0.02);
  S.weaponGroup.add(mag);

  // muzzle flash (additive cone + point light)
  S.muzzleFlash = new THREE.Mesh(
    new THREE.ConeGeometry(0.08, 0.22, 10),
    new THREE.MeshBasicMaterial({ color: 0xffd35a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false })
  );
  S.muzzleFlash.rotation.x = -Math.PI / 2;
  S.muzzleFlash.position.set(0, 0.02, -0.45);
  S.weaponGroup.add(S.muzzleFlash);

  S.muzzleLight = new THREE.PointLight(0xffd066, 0, 6, 2);
  S.muzzleLight.position.set(0, 0.02, -0.45);
  S.weaponGroup.add(S.muzzleLight);

  positionWeapon();
}

export function positionWeapon() {
  // base pose: lower-right of screen, standard hip-fire
  const aim = S.keys.aiming && isEngaged();
  S.weaponGroup.position.set(
    aim ? 0.0 : 0.18,
    aim ? -0.14 : -0.18,
    aim ? -0.30 : -0.40
  );
  S.weaponGroup.rotation.set(0, 0, 0);
}
