# Whoop Strike (CS-style FPS)

A single-page `Counter-Strike`-style first-person shooter built with
[three.js](https://threejs.org/). Embedded as a sub-game of the
Shoop Da Whoop archive, served through the site's Vite MPA pipeline
(so it shares the same legacy / iOS-Safari-13 transpile pipeline as the
other games).

> Desktop browsers only — it relies on the Pointer Lock API, which touch
> devices don't have.

## Play it

From the repo root:

```bash
npm install      # first time
npm run dev      # dev server with HMR on http://localhost:8000
```

Then open <http://localhost:8000/games/csgame/>, or click the
**Whoop Strike** link on the [home page](../../index.html).

For a production preview:

```bash
npm run build && npm run preview
```

## Controls

| Action | Key |
| --- | --- |
| Lock / free mouse | click the screen |
| Move | `W` `A` `S` `D` |
| Sprint | `Shift` |
| Jump | `Space` |
| Aim down sights | right mouse |
| Shoot | left mouse |
| Reload | `R` |
| Restart (after death) | `R` or click button |

## How it plays

- Desert-arena map with cover crates and perimeter walls (AABB collision).
- 6 enemy bots keep respawning; each has a health bar, line-of-sight gating,
  and a 3-round burst. Headshots do ×2.4 damage.
- Player has an HP bar (red vignette + low-HP pulse), a 17-round pistol mag +
  reserve ammo, reload delay, recoil and walk-bob.
- Score = total kills. Death restarts everything. There is no "win" — survive.

## Architecture

The source is split into focused ES modules under `src/` (no bundling step
beyond Vite):

- `index.html` — page shell: HUD markup + start / pause / game-over overlays.
  Links `css/style.css` and loads `src/main.js` as a module.
- `css/style.css` — HUD + screens + touch-control styling.
- `src/state.js` — single source of truth: all tunables, the shared mutable
  state object `S`, platform detection (`isTouch`), the engagement abstraction
  (`engage`/`disengage`/`isEngaged`), and viewport helpers. Owns no
  cross-module imports, so it breaks every dependency cycle.
- `src/world.js` — scene build: lights, sand ground, walls, cover crates,
  barrels, spawn ring.
- `src/weapon.js` — first-person pistol viewmodel + `positionWeapon`.
- `src/enemy.js` — bot spawning, damage/flash/death, health-bar billboard.
- `src/player.js` — (re)spawn state, damage + game-over accounting.
- `src/shoot.js` — hitscan fire, ammo/reload.
- `src/physics.js` — player movement (keyboard + stick merged), AABB
  push-out, enemy AI (chase / strafe / LOS burst).
- `src/fx.js` — tracers, particles, shells, hitmarker, killfeed, FX update.
- `src/audio.js` — Web-Audio synth SFX.
- `src/hud.js` — DOM bindings for HP / ammo / kills.
- `src/input.js` — keyboard + desktop-mouse wiring.
- `src/touch.js` — on-screen twin-stick controls (touch devices only).
- `src/main.js` — entry/orchestrator: renderer build, input-mode branch
  (desktop PointerLockControls vs touch), resize listeners, RAF loop.

`three` is a repo `package.json` dependency; bare imports of `three` and
`three/addons/...` resolve through Vite, then `@vitejs/plugin-legacy`
transpiles per `.browserslistrc` for iOS / Safari 13.

## Notes

- The game uses real Pointer Lock, so it must be served over `http(s)://`
  or `localhost`; the `file://` scheme will refuse to lock the mouse.
- Scores are per-session; nothing is persisted.
