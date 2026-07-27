# 纸牌接龙 · Solitaire

基于经典 FreeCell（空当接龙）机制的 HTML5 单人纸牌游戏，融合东方元素（龙、花、阴阳三色）。

## 快速开始

```bash
npm install      # 安装依赖（首次）
npm run dev      # 启动 Vite 开发服务器（HMR）
# 浏览器打开 http://localhost:8000
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

```text
solitaire/
├── index.html          # 单页入口
├── vite.config.js      # Vite 配置（dev/preview 端口、legacy 插件）
├── postcss.config.js   # PostCSS：preset-env(stage 3) + autoprefixer
├── .browserslistrc     # 兼容性底限（iOS/Safari 13、Chrome 60、FF 70、Edge 79）
├── css/style.css       # 样式
├── js/
│   ├── main.js         # 入口：组装模块、绑定事件、发牌动画、全屏
│   ├── game.js         # 游戏控制器（事件驱动）
│   ├── state.js        # 状态管理 + 快照撤销
│   ├── rules.js        # 纯规则函数（无副作用）
│   ├── deck.js         # 牌组与发牌
│   ├── render.js       # DOM 渲染（全量重建）
│   ├── anim.js         # FLIP 位移动画 + 缓动常量
│   ├── input.js        # 拖拽交互（pointer 事件）
│   ├── audio.js        # Web Audio 合成音效
│   ├── storage.js      # localStorage 持久化
│   ├── achievements.js # 成就里程碑检测
│   └── constants.js    # 全局常量
└── docs/
    ├── rules.md        # 游戏规则文档
    └── design.md       # 技术设计文档
```

## 操作

| 操作 | 方式 |
| --- | --- |
| 移动牌 | 拖拽 |
| 收龙 | 点击 🐉 收龙按钮 / `C`（按钮高亮时生效） |
| 新局 | `N` |
| 撤销 | `U` / `Z` |
| 静音 | `M` |
| 横屏全屏 | 移动端 ⛶ 按钮 / `F` |

> 桌面端为鼠标拖拽；移动端支持触摸拖拽，并额外显示横屏全屏按钮。

## 文档

- [游戏规则](docs/rules.md)
- [技术设计](docs/design.md)
