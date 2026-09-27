# 纸牌接龙 · Solitaire

基于经典 FreeCell（空当接龙）机制的 HTML5 单人纸牌游戏，融合东方元素（龙、花、阴阳三色）。

## 快速开始

> 所有 npm 命令均在**仓库根目录**运行（站点级配置 `vite.config.js` / `package.json` 位于根，本目录只含游戏源码）。

```bash
npm install      # 安装依赖（首次）
npm run dev      # 启动 Vite 开发服务器（HMR）
# 首页：    http://localhost:8000/
# 本游戏：  http://localhost:8000/games/solitaire/
```

构建与预览生产版本：

```bash
npm run build      # 产出 dist/（modern ESM + legacy nomodule 双包）
npm run preview    # 本地预览构建产物（端口 8000）
```

### npm 脚本

| 脚本 | 说明 |
| --- | --- |
| `npm run dev` | Vite 开发服务器，热模块替换（HMR） |
| `npm run build` | 生产打包：Terser 压缩 + `@vitejs/plugin-legacy` 双包 |
| `npm run preview` / `npm run serve` | 本地预览 `dist/` 构建产物 |
| `npm run legacy-check` | 构建并检查 `dist/assets` 中的新旧双产物 |

## 项目结构

本目录位于仓库根 `games/solitaire/`，是 Shoop Da Whoop 站点的一个附属游戏。站点级配置（`vite.config.js` / `postcss.config.js` / `.browserslistrc` / `package.json`）位于**仓库根**，不在此目录内。

```text
games/solitaire/
├── index.html              # 单页 HTML（preload 胜利 gif）
├── tsconfig*.json          # TypeScript 配置（base / app）
├── src/
│   ├── main.ts             # 入口：创建 Vue 应用
│   ├── App.vue             # 组装 composable + 渲染棋盘 / 工具栏 / Dialog / WinCard
│   ├── index.css           # 全部样式（CSS Variables + Flexbox + Grid + Tailwind 指令）
│   ├── storage.ts          # localStorage 持久化封装
│   ├── game/
│   │   ├── engine.ts       # SolitaireEngine：状态变更唯一入口 + unit 生命周期
│   │   ├── rules.ts        # 纯规则函数（无副作用）
│   │   ├── state.ts        # 牌组 / 洗牌 / 发牌 / 快照 / 撤销
│   │   ├── types.ts        # Card / DestDescriptor / MoveResult 等类型
│   │   ├── constants.ts    # 全局常量 + 成就定义
│   │   ├── solverAdapter.ts# GameState ↔ SolverState 适配
│   │   ├── achievements.ts # 成就检测
│   │   └── engine.test.ts  # vitest 引擎单测（unit 顺序模型）
│   ├── composables/
│   │   ├── useSolitaireGame.ts  # 控制器 + consumeUnit 执行器 + busy 锁
│   │   ├── animateAutoMoves.ts  # FLIP 单卡飞行 + 动画常量（FLY_MS / STAGGER_MS）
│   │   ├── useDealing.ts        # 发牌飞入动画 + settle
│   │   ├── useDragController.ts # 拖拽交互（真牌跟随 + slotAtPoint）
│   │   ├── useHint.ts           # 提示（worker 求解 + 缓存 + 逐步执行）
│   │   ├── useAudio.ts          # howler 音效薄壳（iOS 挂起恢复）
│   │   ├── useAchievements.ts   # 成就 UI 桥接（toast）
│   │   └── useGestureLock.ts    # 全局手势锁（禁选择/缩放/滚动，旧 iOS 兜底）
│   ├── components/
│   │   ├── Card.vue / CardBack.vue / WinCard.vue
│   │   └── Toaster.vue / GlyphIcon.vue / ui/（BaseBadge / BaseButton）
│   ├── lib/                # audio.ts（howler 封装）/ toaster.ts / winGif.ts / utils.ts
│   └── worker/solver.worker.ts  # 求解器 worker（压缩失败时 raw 兜底）
├── e2e/                    # Playwright 端到端（board / undo / restart / touch-input …）
├── tools/solver/           # 求解器（rules.js / solver.js / compress.js，node 脚本）
└── docs/
    ├── rules.md            # 游戏规则文档
    ├── design.md           # 技术设计文档
    ├── glossary.md         # 术语表（与代码对齐）
    └── solver.md           # 求解器文档
```

## 操作

| 操作 | 方式 |
| --- | --- |
| 移动牌 | 拖拽 |
| 收龙 | 点击 🐉 收龙按钮 / `C`（按钮高亮时生效） |
| 新局 | `N` |
| 撤销 | `U` / `Z` |
| 重新开始（回到本局开局，同一副牌） | 工具栏 ⟲ 按钮（需确认） |
| 静音 | `M` |
| 横屏全屏 | 移动端 ⛶ 按钮 / `F` |

> 桌面端为鼠标拖拽；移动端支持触摸拖拽，并额外显示横屏全屏按钮。

## 文档

- [游戏规则](docs/rules.md)
- [技术设计](docs/design.md)
