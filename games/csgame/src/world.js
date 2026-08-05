// world.js — scene construction: lights, sand ground, perimeter walls,
// scattered cover crates + barrels, a central ramp block, and the enemy
// spawn ring. Each solid is registered into S.colliders / S.solids so
// bullets + player + enemy AI all share one geometry source of truth.

import * as THREE from 'three';
import { ARENA, S } from './state.js';

export function buildLights() {
  const hemi = new THREE.HemisphereLight(0xfff2cc, 0x4a3a1f, 0.85);
  S.scene.add(hemi);

  const sun = new THREE.DirectionalLight(0xfff1bb, 1.55);
  sun.position.set(38, 60, 24);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const d = ARENA * 0.95;
  Object.assign(sun.shadow.camera, { left: -d, right: d, top: d, bottom: -d, near: 1, far: 240 });
  sun.shadow.bias = -0.0004;
  S.scene.add(sun);

  const fill = new THREE.DirectionalLight(0x9bb0c8, 0.25);
  fill.position.set(-30, 20, -25);
  S.scene.add(fill);
}

// register a solid object for collisions + bullets
export function registerSolid(mesh, kind) {
  mesh.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(mesh);
  S.colliders.push(box);
  S.solids.push({ mesh, box, kind: kind || 'world' });
}

export function buildWorld() {
  // ---- ground ----
  const groundCanvas = makeGroundTexture();
  const groundTex = new THREE.CanvasTexture(groundCanvas);
  groundTex.wrapS = groundTex.wrapT = THREE.RepeatWrapping;
  groundTex.repeat.set(ARENA / 2, ARENA / 2);
  groundTex.anisotropy = S.renderer.capabilities.getMaxAnisotropy();
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(ARENA * 2, ARENA * 2),
    new THREE.MeshStandardMaterial({ map: groundTex, roughness: 1, metalness: 0 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  S.scene.add(ground);
  S.solids.push({ mesh: ground, kind: 'ground' });

  // ---- perimeter walls ----
  const wallMat = new THREE.MeshStandardMaterial({ color: 0xb89a5e, roughness: 0.95 });
  const trimMat = new THREE.MeshStandardMaterial({ color: 0x6e5a33, roughness: 1 });
  const t = 2, h = 8, e = ARENA; // half-extent e, thickness t, height h
  const wallGeo = [
    new THREE.Mesh(new THREE.BoxGeometry(e * 2, h, t), wallMat),
    new THREE.Mesh(new THREE.BoxGeometry(e * 2, h, t), wallMat),
    new THREE.Mesh(new THREE.BoxGeometry(t, h, e * 2), wallMat),
    new THREE.Mesh(new THREE.BoxGeometry(t, h, e * 2), wallMat),
  ];
  wallGeo[0].position.set(0, h / 2, -e); wallGeo[0].castShadow = wallGeo[0].receiveShadow = true;
  wallGeo[1].position.set(0, h / 2, e); wallGeo[1].castShadow = wallGeo[1].receiveShadow = true;
  wallGeo[2].position.set(-e, h / 2, 0); wallGeo[2].castShadow = wallGeo[2].receiveShadow = true;
  wallGeo[3].position.set(e, h / 2, 0); wallGeo[3].castShadow = wallGeo[3].receiveShadow = true;
  wallGeo.forEach(m => { S.scene.add(m); registerSolid(m); });

  // capping trims on top
  [...wallGeo].forEach(m => {
    const cap = new THREE.Mesh(new THREE.BoxGeometry(m.geometry.parameters.width + 0.4, 0.6, m.geometry.parameters.depth + 0.4), trimMat);
    cap.position.copy(m.position); cap.position.y += h / 2 + 0.3;
    cap.castShadow = cap.receiveShadow = true;
    S.scene.add(cap);
  });

  // ---- scattered crates / cover (de_dust vibe) ----
  const crateMat = new THREE.MeshStandardMaterial({ color: 0xc7a14f, roughness: 0.95 });
  const crateMat2 = new THREE.MeshStandardMaterial({ color: 0x9c7a36, roughness: 1 });
  const barrelMat = new THREE.MeshStandardMaterial({ color: 0x884a2a, roughness: 0.7, metalness: 0.15 });

  const coverSpots = [
    [0, 6, 2.4, 2.4, 2.4, true],
    [6, 0, 2.4, 2.4, 2.4, true],
    [-8, 4, 3.0, 3.0, 2.0, false],
    [10, 10, 2.0, 2.0, 2.0, true],
    [-12, -10, 2.4, 2.4, 2.4, true],
    [14, -14, 1.8, 1.8, 1.8, false],
    [-16, 8, 3.0, 2.0, 1.6, false],
    [0, -16, 4.0, 2.0, 2.4, true],
    [-2, 16, 1.6, 1.6, 1.6, false],
    [18, 2, 2.4, 2.4, 2.4, true],
    [-18, -2, 2.4, 2.4, 2.4, true],
    [4, -22, 3.0, 3.0, 1.8, true],
    [-6, 24, 2.0, 2.0, 2.0, false],
    [22, 18, 2.0, 2.0, 2.0, true],
    [-22, -16, 2.0, 2.0, 2.0, true],
  ];
  for (const [x, z, w, d, hh, stacked] of coverSpots) {
    placeCrate(x, z, w, d, hh, Math.random() * Math.PI * 0.1 - 0.05, crateMat);
    if (stacked) placeCrate(x + w * 0.5, z + d * 0.3, w * 0.7, d * 0.7, hh * 0.7, Math.random(), crateMat2);
  }

  // barrels
  for (let i = 0; i < 7; i++) {
    const x = (Math.random() * 2 - 1) * (ARENA - 4);
    const z = (Math.random() * 2 - 1) * (ARENA - 4);
    placeBarrel(x, z, barrelMat);
  }

  // central elevated platform (long sightline perch)
  placeRampBlock(0, 0, 9, 1.4, 3.6, crateMat2);
}

function placeCrate(x, z, w, d, h, rotY, mat) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, h / 2, z);
  m.rotation.y = rotY;
  m.castShadow = true; m.receiveShadow = true;
  S.scene.add(m);
  registerSolid(m);
}
function placeBarrel(x, z, mat) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 1.5, 18), mat);
  m.position.set(x, 0.75, z);
  m.castShadow = true; m.receiveShadow = true;
  S.scene.add(m);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.56, 0.07, 8, 18),
    new THREE.MeshStandardMaterial({ color: 0x553319 }));
  rim.rotation.x = Math.PI / 2; rim.position.set(x, 1.0, z);
  S.scene.add(rim);
  registerSolid(m);
}
function placeRampBlock(x, z, w, h, d, mat) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w * 0.6, h, d), mat);
  m.position.set(x, h / 2, z);
  m.castShadow = true; m.receiveShadow = true;
  S.scene.add(m);
  registerSolid(m);
  // small step blocks as ramp
  for (let i = 0; i < 4; i++) {
    const s = new THREE.Mesh(new THREE.BoxGeometry(w * 0.6, (h / 5) * (4 - i), d * 0.4), mat);
    s.position.set(x, ((h / 5) * (4 - i)) / 2, z - d * 0.5 - i * d * 0.25);
    s.castShadow = true; s.receiveShadow = true;
    S.scene.add(s);
    registerSolid(s);
  }
}

export function buildSpawnPoints() {
  // mutate in place (other modules hold the S.enemySpawns reference).
  S.enemySpawns.length = 0;
  const r = ARENA - 3;
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    S.enemySpawns.push(new THREE.Vector3(Math.cos(a) * r * (0.6 + Math.random() * 0.4), 0, Math.sin(a) * r * (0.6 + Math.random() * 0.4)));
  }
}

// procedural sandy ground texture
function makeGroundTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#c2a878';
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 1400; i++) {
    const v = 170 + Math.floor(Math.random() * 60);
    g.fillStyle = `rgba(${v},${v - 30},${v - 90},${Math.random() * 0.4})`;
    g.fillRect(Math.random() * 256, Math.random() * 256, Math.random() * 2 + 0.5, Math.random() * 2 + 0.5);
  }
  // cracks
  g.strokeStyle = 'rgba(80,60,30,0.35)';
  g.lineWidth = 1;
  for (let i = 0; i < 12; i++) {
    g.beginPath();
    let x = Math.random() * 256, y = Math.random() * 256;
    g.moveTo(x, y);
    for (let s = 0; s < 6; s++) {
      x += (Math.random() - 0.5) * 40; y += (Math.random() - 0.5) * 40;
      g.lineTo(x, y);
    }
    g.stroke();
  }
  return c;
}
