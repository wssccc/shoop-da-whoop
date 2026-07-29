# 1A2B · 猜数字

经典 1A2B（Bulls and Cows）猜数字游戏：电脑随机生成 4 位不重复数字，玩家通过 A/B 反馈推理出答案。融入 Shoop Da Whoop 站点调性——猜中时以纸面「命中」盖戳 + 墨点迸溅庆祝。

## 快速开始

> 所有 npm 命令均在**仓库根目录**运行（站点级配置 `vite.config.js` / `package.json` 位于根，本目录只含游戏源码）。

```bash
npm install      # 安装依赖（首次）
npm run dev      # 启动 Vite 开发服务器（HMR）
# 首页：    http://localhost:8000/
# 本游戏：  http://localhost:8000/games/1a2b/
```

构建与预览生产版本：

```bash
npm run build      # 产出 dist/（modern ESM + legacy nomodule 双包）
npm run preview    # 本地预览构建产物（端口 8000）
```

## 项目结构

```text
games/1a2b/
├── index.html              # 游戏页面（DOM 结构）
├── README.md               # 本文件
├── css/
│   └── style.css           # 纸面记事本极简拟物 + light/dark 双主题
├── docs/
│   ├── rules.md            # 玩法规则
│   └── design.md           # 技术设计文档
└── js/
    ├── constants.js        # 常量、localStorage key、成就定义
    ├── rules.js            # 纯规则函数（生成答案 / 校验 / A·B 计数）
    ├── state.js            # 状态结构与 (de)序列化
    ├── game.js             # 控制器 + 事件总线（on/emit）
    ├── render.js           # DOM 渲染（输入槽 / 历史 / 统计）
    ├── audio.js            # Web Audio 合成音效
    ├── storage.js          # localStorage 持久化
    ├── achievements.js     # 成就检测
    └── main.js             # 入口：组装、事件绑定、主题切换、命中庆祝
```

## 玩法

输入 4 位不重复数字，点击 **⚡ FIRE**（或按 `Enter`）提交。系统给出 A/B 反馈：

- **A** = 数字与位置都对的数量
- **B** = 数字对但位置错的数量

猜中即 **4A0B**——激光发射！无次数上限，追求用最少次数猜中。

详见 [docs/rules.md](docs/rules.md)。

## 操作表

| 操作 | 鼠标 / 屏幕 | 键盘 |
| --- | --- | --- |
| 输入数字 | 点击数字键 | `0–9` |
| 提交 | 点击 `⚡ FIRE` | `Enter` |
| 退格 | 点击 `⌫` | `Backspace` |
| 清空输入 | 点击 `C` | `Esc` |
| 新局 | 点击 `⟳` | `N` |
| 静音 | 点击 `🔊` | `M` |
| 全屏 | 点击 `⛶` | `F` |
| 主题切换 | 点击 `🌗` | `T` |
| 清除记录 | 点击 `🗑`（需确认） | — |

## 设计文档

- [玩法规则](docs/rules.md)
- [技术设计](docs/design.md)
