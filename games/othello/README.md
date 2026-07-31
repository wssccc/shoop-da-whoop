# 黑白棋 (Othello) — MCTS AI

Vue 3 + TypeScript implementation of Othello (Reversi) with a Monte Carlo Tree
Search AI opponent, part of the **Shoop Da Whoop** game collection.

## Tech Stack

- **Framework:** Vue 3 (Composition API, `<script setup>`)
- **Language:** TypeScript ~5.9 with strict mode
- **Build:** Vite 8 (multi-page app alongside other games)
- **Styling:** Tailwind CSS 3.4 + shadcn-inspired theme variables
- **AI:** MCTS (Monte Carlo Tree Search) running in a Web Worker
- **Linting:** ESLint 9 + typescript-eslint + eslint-plugin-vue

## Project Structure

```
games/othello/
├── index.html              # Entry HTML
├── src/
│   ├── main.ts             # Vue app bootstrap
│   ├── App.vue             # Root component (UI layout)
│   ├── index.css           # Tailwind directives + CSS variables
│   ├── storage.ts          # localStorage persistence
│   ├── game/
│   │   ├── OthelloGame.ts  # Game logic (board, moves, rules)
│   │   ├── MCTS.ts         # MCTS AI algorithm
│   │   └── Evaluator.ts    # Board evaluation heuristics
│   ├── composables/
│   │   └── useOthelloGame.ts  # Vue composable (state + AI orchestration)
│   ├── components/
│   │   ├── OthelloBoard.vue   # 8×8 grid renderer
│   │   ├── BoardCell.vue      # Single cell with piece + animations
│   │   └── ui/
│   │       ├── BaseButton.vue
│   │       ├── BaseBadge.vue
│   │       └── BaseDialog.vue
│   └── worker/
│       └── mcts.worker.ts  # Web Worker for non-blocking AI
├── tsconfig.json            # Root TS config (references)
├── tsconfig.app.json        # App TS config (strict, bundler mode)
└── eslint.config.js         # ESLint flat config
```

## AI Difficulty Levels

| Level  | Iterations | Description              |
|--------|------------|--------------------------|
| Easy   | 300        | Fast, makes obvious mistakes |
| Medium | 1,200      | Balanced challenge         |
| Hard   | 3,000      | Strong play               |
| Expert | 6,000      | ~300-500ms per move       |

## Features

- **MCTS AI**: Pure Monte Carlo Tree Search with UCB1 selection
- **Web Worker**: AI runs off the main thread — no UI freezes
- **Flip animation**: 3D perspective `rotateY` animation on captures
- **Local persistence**: Auto-saves game state and settings
- **Game-over detection**: Endgame scoring with winner announcement
- **Undo (悔棋)**: Reverts your last move together with the AI's reply, back to your
  previous decision point. Unlimited per game; survives a page refresh.
- **Dark theme**: Tailwind `slate` palette with green board

## Build

Built from the workspace root via Vite (multi-page entry):

```bash
npm run build          # Build all entries
npm run typecheck      # vue-tsc type check for Othello
npm run dev            # Dev server with HMR
```
