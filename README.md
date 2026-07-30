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

技术栈：Vite + 原生 JavaScript（Solitaire/1A2B）+ Vue 3 + TypeScript（Othello），`@vitejs/plugin-legacy` 双包兼容 iOS/Safari 13。

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

## 构建与部署

```bash
npm run build    # 产出 dist/（modern ESM + legacy nomodule 双包）
npm run preview  # 本地预览构建产物
```

构建产物在 `dist/`，使用相对资源路径（`base: './'`），可托管于任意静态服务器或子路径。

站点部署至 **<https://shoopdawhoop.wssccc.com>**：将 `dist/` 内容上传至服务器对应目录即可。

## 目录结构

```text
shoop-da-whoop/
├── index.html / main.js / style.css   # 首页（Raw Meme Collage）
├── vite.config.js / package.json      # 站点级配置
├── .browserslistrc                    # 浏览器兼容性目标
├── public/images/                     # 首页静态资源
├── shared/                            # 共享样式与工具
│   ├── styles/reset.css               # 全局样式重置
│   └── utils/common.js                # 通用纯函数工具
└── games/                             # 附属游戏
    ├── solitaire/                     # 纸牌接龙（原生 JS）
    │   ├── index.html / css/ js/ docs/
    ├── 1a2b/                          # 猜数字（原生 JS）
    │   ├── index.html / css/ js/ docs/
    └── othello/                       # 黑白棋（Vue 3 + TS）
        ├── index.html / src/ / tsconfig*.json / eslint.config.js
```

详见各游戏 README：

- [games/solitaire/README.md](./games/solitaire/README.md)
- [games/1a2b/README.md](./games/1a2b/README.md)
- [games/othello/README.md](./games/othello/README.md)
