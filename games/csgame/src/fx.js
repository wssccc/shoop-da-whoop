// fx.js — transient visuals: bullet tracers, muzzle sparks (particles),
// ejected shells, HUD hitmarker, killfeed entries, and the per-frame
// update that ages/culls all of them.

import * as THREE from 'three';
import { S } from './state.js';

export function spawnTracer(a, b) {
  const geo = new THREE.BufferGeometry().setFromPoints([a, b]);
  const mat = new THREE.LineBasicMaterial({ color: 0xfff1a0, transparent: true, opacity: 0.9 });
  const line = new THREE.Line(geo, mat);
  line.userData.life = 0.06;
  S.scene.add(line);
  S.tracers.push(line);
}

export function ejectShell() {
  const shell = new THREE.Mesh(
    new THREE.CylinderGeometry(0.012, 0.012, 0.04, 6),
    new THREE.MeshStandardMaterial({ color: 0xd9b04a, metalness: 0.8, roughness: 0.3 })
  );
  const start = S.camera.getWorldPosition(new THREE.Vector3());
  // approximate at gun location (right-hand side, in front)
  start.addScaledVector(S.camera.getWorldDirection(new THREE.Vector3()), 0.6);
  start.add(new THREE.Vector3(0.15, -0.12, 0));
  shell.position.copy(start);
  // velocity: up-right random
  const up = new THREE.Vector3(0, 1, 0);
  const fwd = S.camera.getWorldDirection(new THREE.Vector3());
  const right = new THREE.Vector3().crossVectors(fwd, up).normalize();
  const vel = right.multiplyScalar(1.6).add(up.multiplyScalar(1.7)).add(fwd.multiplyScalar(0.6));
  shell.userData = { vel, life: 1.2, rvel: new THREE.Vector3(Math.random() * 8, Math.random() * 8, Math.random() * 8) };
  S.scene.add(shell);
  S.shells.push(shell);
}

export function burstParticles(at, color, count) {
  for (let i = 0; i < count; i++) {
    const p = new THREE.Mesh(
      new THREE.SphereGeometry(0.03, 6, 6),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1 })
    );
    p.position.copy(at);
    const v = new THREE.Vector3((Math.random() - 0.5), Math.random() * 0.6 + 0.2, (Math.random() - 0.5))
      .normalize().multiplyScalar(2 + Math.random() * 3);
    p.userData = { vel: v, life: 0.5 + Math.random() * 0.3, maxLife: 0.8 };
    S.scene.add(p);
    S.particles.push(p);
  }
}

export function showHitmarker() {
  const hm = document.getElementById('hitmarker');
  hm.classList.add('show');
  clearTimeout(showHitmarker._t);
  showHitmarker._t = setTimeout(() => hm.classList.remove('show'), 110);
}

export function pushFeed(text) {
  const feed = document.getElementById('feed');
  const div = document.createElement('div');
  div.className = 'entry';
  div.textContent = text;
  feed.appendChild(div);
  while (feed.children.length > 5) feed.removeChild(feed.firstChild);
  setTimeout(() => { if (div.parentNode) div.parentNode.removeChild(div); }, 3500);
}

export function updateFx(dt) {
  // tracers fade
  for (let i = S.tracers.length - 1; i >= 0; i--) {
    const t = S.tracers[i];
    t.userData.life -= dt;
    t.material.opacity = Math.max(0, t.userData.life / 0.06);
    if (t.userData.life <= 0) {
      S.scene.remove(t); t.geometry.dispose(); t.material.dispose();
      S.tracers.splice(i, 1);
    }
  }
  // shells / particles
  for (let i = S.particles.length - 1; i >= 0; i--) {
    const p = S.particles[i];
    p.userData.life -= dt;
    p.userData.vel.y -= 9 * dt;
    p.position.addScaledVector(p.userData.vel, dt);
    if (p.position.y < 0.04) { p.position.y = 0.04; p.userData.vel.multiplyScalar(0.3); p.userData.vel.y = 0; }
    p.material.opacity = Math.max(0, p.userData.life / p.userData.maxLife);
    if (p.userData.life <= 0) {
      S.scene.remove(p); p.geometry.dispose(); p.material.dispose();
      S.particles.splice(i, 1);
    }
  }
  for (let i = S.shells.length - 1; i >= 0; i--) {
    const s = S.shells[i];
    s.userData.vel.y -= 18 * dt;
    s.position.addScaledVector(s.userData.vel, dt);
    s.rotation.x += s.userData.rvel.x * dt;
    s.rotation.y += s.userData.rvel.y * dt;
    s.rotation.z += s.userData.rvel.z * dt;
    s.userData.life -= dt;
    if (s.position.y < 0.02) { s.position.y = 0.02; s.userData.vel.multiplyScalar(0.4); s.userData.vel.y = 0; }
    if (s.userData.life <= 0) {
      S.scene.remove(s); s.geometry.dispose(); s.material.dispose();
      S.shells.splice(i, 1);
    }
  }
}
