# Othello — Shoop Da Whoop

## Stack

| Layer     | Choice |
|-----------|--------|
| Framework | Vue 3 (Composition API + `<script setup>`) |
| Language  | TypeScript 5.9 (strict, bundler mode) |
| Build     | Vite 8 (multi-page build from workspace root) |
| CSS       | Tailwind CSS 3.4 + shadcn-theme CSS variables |
| AI        | MCTS in Web Worker (4 difficulty levels) |
| Lint      | ESLint 9 flat config + vue-eslint-parser |

## Key Design Decisions

- **Zero React dependencies.** Game logic (`OthelloGame.ts`, `MCTS.ts`, `Evaluator.ts`) has zero framework coupling — same code would work in React, Svelte, or vanilla JS.
- **Minimal UI components.** 3 hand-written components (`BaseButton`, `BaseBadge`, `BaseDialog`) instead of pulling in reka-ui / shadcn-vue.
- **Web Worker for AI.** MCTS runs off the main thread; board state is serialized via `postMessage`.
- **`shallowRef` for game instance.** Prevents Vue's reactive proxy from interfering with class internals.
- **`@` path alias.** Mirrors the tsconfig `@/* -> ./src/*` for clean imports.

## Build Notes

Built as part of the monorepo MPA — no standalone `vite.config`. Run from root:

```bash
npm run dev
# or
npm run build
```

Tailwind is added as a PostCSS plugin at root level; its `content` scan is scoped to `games/othello/` so other entries are unaffected.