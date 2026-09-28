# Shoop Da Whoop

> Shoop Da Whoop — Raw Meme Collage. 复古梗图拼贴站点，附带若干小游戏。

**线上地址**：<https://shoopdawhoop.wssccc.com>

## 项目简介

Shoop Da Whoop 是一个 IE6 复古拼贴风主题站点：

- **首页**（`index.html`）：Raw Meme Collage 原始梗拼贴页，附带各游戏入口链接。
- **附属游戏**（`games/`）：
  - `solitaire/` — 纸牌接龙（FreeCell 风格，已实现）
  - `1a2b/` — 猜数字（1A2B · Bulls and Cows，已实现）
  - `othello/` — 黑白棋（Othello · Reversi，MCTS AI，已实现）
  - `burnrate/` — 烧钱计划（卡牌对战 AI，Vue 3 + TypeScript + Tailwind）
  - `keyflow/` — 打字训练（课程/测试/报告，单用户 + 98.css Win98 风格，Vue 3 + TypeScript）
  - `csgame/` — 第一人称射击（CS 风格 FPS，Three.js，原生 JS，桌面 / 触屏）

技术栈：Vite MPA；Solitaire / Othello / Burnrate / Keyflow 用 Vue 3 + TypeScript（Tailwind 按需引入），1A2B / Csgame 用原生 JavaScript（Csgame 采用 Three.js），`@vitejs/plugin-legacy` 双包兼容 iOS/Safari 13。

## 开发

```bash
npm install      # 安装依赖（首次）
npm run dev      # 启动开发服务器（HMR）
```

开发环境访问（端口 8000）：

| 页面 | 地址 |
|------|------|
| 首页 | <http://localhost:8000/> |
| 纸牌接龙 | <http://localhost:8000/games/solitaire/> |
| 1A2B | <http://localhost:8000/games/1a2b/> |
| Othello | <http://localhost:8000/games/othello/> |
| 烧钱计划 | <http://localhost:8000/games/burnrate/> |
| Keyflow | <http://localhost:8000/games/keyflow/> |
| Whoop Strike | <http://localhost:8000/games/csgame/> |

## 构建与部署

```bash
npm run build    # 产出 dist/（modern ESM + legacy nomodule 双包）
npm run preview  # 本地预览构建产物
```

构建产物在 `dist/`（根绝对路径资源，`base: '/'`），并附带 PWA 产物：`manifest.webmanifest`、`sw.js`（Workbox 预缓存全站，含 legacy 双包）与 `pwa/` 图标。

站点部署至 **<https://shoopdawhoop.wssccc.com>**（域名根；因此 service worker scope 为 `/`）：将 `dist/` 内容上传至服务器对应目录即可。

## PWA（离线游玩）

站点是一个完整 PWA：全部游戏资源在首次访问时被 Service Worker 预缓存，之后可离线游玩；iOS / Android 可安装到主屏幕。

- **注册与更新**：每个入口引入 `shared/pwa/pwa.ts`（`registerType: 'prompt'`）。检测到新版本时页面底部出现非阻塞横幅，玩家点「更新」才激活新 SW 并刷新——对局不会被打断。
- **安装引导**：首页的「安装到主屏幕」按钮（`shared/pwa/install.ts`）在 iOS 显示分步指引，在 Chromium 走原生安装弹窗；按钮仅在可安装时可见。
- **service worker**：由 `vite-plugin-pwa` 生成（generateSW），预缓存范围 = 全站（7 个 HTML 入口 + modern/legacy 双包 + `public/`）。MPA 下刻意 **不设** `navigateFallback`，目录导航（如 `/games/solitaire/`）由 `directoryIndex` 落到各自 `index.html`。
- **验证**：`npx playwright test --project=pwa`（构建产物 + 离线断言）；iOS 真机需手动验收（添加到主屏幕 → 飞行模式启动）。
- **注意**：SW 只在构建产物里生效（dev 下关闭）；改图标后 iOS 会缓存主屏图标，需删除重加。

## 目录结构

```text
shoop-da-whoop/
├── index.html / main.js / style.css   # 首页（Raw Meme Collage）
├── vite.config.js / package.json      # 站点级配置（含 VitePWA）
├── .browserslistrc                    # 浏览器兼容性目标
├── e2e/pwa.spec.ts                    # PWA 离线 e2e（顶层级）
├── public/images/ sfx/ pwa/           # 静态图片 / 音效 / PWA 图标
├── shared/                            # 共享样式与工具
│   ├── pwa/                           # SW 注册 + 更新横幅 + 安装引导
│   ├── styles/reset.css               # 全局样式重置
│   └── utils/common.js                # 通用纯函数工具
└── games/                             # 附属游戏
    ├── solitaire/                     # 纸牌接龙（Vue 3 + TS）
    │   ├── index.html / css/ / docs/ / src/
    ├── 1a2b/                          # 猜数字（原生 JS）
    │   ├── index.html / css/ js/ docs/
    ├── othello/                       # 黑白棋（Vue 3 + TS）
    │   ├── index.html / src/ / tsconfig*.json / eslint.config.js
    ├── burnrate/                      # 烧钱计划（Vue 3 + TS + Tailwind）
    │   ├── index.html / src/ / tsconfig*.json
    ├── keyflow/                       # 打字训练（单用户，Vue 3 + TS + 98.css）
    │   ├── index.html / src/ / tsconfig*.json / e2e/ / docs/
    └── csgame/                        # 第一人称射击（原生 JS + Three.js）
        ├── index.html / css/ / src/
```

详见各游戏 README：

- [games/solitaire/README.md](./games/solitaire/README.md)
- [games/1a2b/README.md](./games/1a2b/README.md)
- [games/othello/README.md](./games/othello/README.md)
- [games/burnrate/README.md](./games/burnrate/README.md)
- [games/keyflow/README.md](./games/keyflow/README.md)
- [games/csgame/README.md](./games/csgame/README.md)
