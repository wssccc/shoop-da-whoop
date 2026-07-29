# 1A2B · 技术设计文档

## 1. 技术栈

| 层级 | 技术选型 |
| --- | --- |
| 构建 / 开发 | **Vite 8**——ESM 开发服务器（HMR）+ 生产打包 |
| 语言 | JavaScript (ES2020+，源码可自由使用空值合并、逻辑或赋值、可选链等现代语法) |
| 兼容性 | `@vitejs/plugin-legacy` 产出 **modern ESM + `nomodule` 旧版双包**；目标统一声明在 `.browserslistrc`（底限 iOS 13 / Safari 13） |
| 样式 | CSS（CSS Variables + Flexbox + Grid），经 **PostCSS preset-env (stage 3) + autoprefixer** 自动加前缀并生成可行回退 |
| 音效 | Web Audio API（合成音效，无外部资源） |
| 持久化 | `localStorage` |
| 部署 | 产物为纯静态文件，`base: './'` 相对路径，可托管于任意子路径 / GitHub Pages / `file://` |

> 本游戏是 Shoop Da Whoop 多入口站点的附属页面，已在 `vite.config.js` 的 `build.rollupOptions.input` 中注册为 `'1a2b'` 入口，无需额外配置即可被 `vite build` 打包。

---

## 2. 架构总览

本游戏架构参照同站点 `games/solitaire`，但按 1A2B 的实际复杂度做了**精简裁剪**：1A2B 没有「棋盘上移动卡牌」这类连续空间操作，因此**无需 FLIP 动画（无 `anim.js`）**，也**无需拖拽控制器（无 `input.js`）**——键盘与点击事件直接在 `main.js` 中接线。模块共 9 个。

```text
┌──────────────────────────────────────────────────────┐
│                       main.js                         │
│      (入口 / 组装 / 事件绑定 / 主题切换 / 命中庆祝 / 全屏)        │
└──┬───────┬────────┬────────┬──────────┬─────────────┘
   │       │        │        │          │
   ▼       ▼        ▼        ▼          ▼
┌──────┐┌──────┐┌──────┐┌──────┐  ┌──────────┐
│ game ││render││      ││audio │  │ storage  │
│ .js  ││ .js  ││      ││ .js  │  │  .js     │
└──┬───┘└──────┘┘      └──────┘  └────┬─────┘
   │                                  │
   ▼                                  │
┌──────┐  ┌──────────┐                │
│rules │  │  state   │◄───────────────┘ (toSaveable/fromSaveable)
│ .js  │  │  .js     │
└──┬───┘  └──────────┘
   │
   ▼
┌──────────┐  ┌─────────────┐
│constants │◄─┤ achievements │
│  .js     │  │   .js       │
└──────────┘  └─────────────┘
```

### 数据流（单向）

```text
用户输入(键盘/点击) → game.inputDigit/backspace/clearInput/submitGuess
   → game 校验并修改 state → emit('change' / 'sound' / 'win')
   → main.js 监听 → renderAll() 重建 DOM + Storage.saveGame()
```

`Game` 是唯一会修改状态的对象；`render.js` 只读 state 输出 DOM；`storage.js` 只做读写桥接。

### 通信约定（沿用 solitaire）

- **Game → main.js**：自定义事件（`on` / `emit`）。
- **main.js → Render / Storage / Audio**：直接函数调用。
- **rules.js / constants.js**：纯函数与常量，被 game / state / achievements 直接 `import`。
- **无全局事件总线**：一切以 `Game` 为中心枢纽。

---

## 3. 模块详解

### 3.1 `constants.js`

集中所有可调参数与配置：

```js
export const DIGITS = 4;                 // 答案位数
export const PREFIX = 'sz1a2b.';         // localStorage key 前缀
export const STORAGE_STATS / ACHV / MUTE / SAVE;
export const ACHIEVEMENTS = [ ... ];     // 5 项成就，含 type:'count'|'guesses'
```

### 3.2 `rules.js`（纯函数）

无 DOM、无副作用，可独立单元测试。核心函数：

| 函数 | 说明 |
| --- | --- |
| `generateSecret()` | 用 `shared/utils/common.js` 的 `shuffle` 洗 `0–9` 取前 4，返回**字符串**（保留前导 0） |
| `hasUniqueDigits(s)` | 各位是否互异 |
| `validateGuess(input)` | 返回 `{ok, reason}`：长度 4 / 全数字 / 不重复 |
| `computeAB(guess, secret)` | 经典 A/B 计数；A=位对，B=数对位错 |
| `isWin(ab)` | `ab.a === 4` |

> **前导 0 处理**：secret 与 guess 全程以字符串表示，因此 `0123` 合法。切勿用 `Number()` 转换会丢前导 0。

### 3.3 `state.js`

状态结构：

```js
{
  secret: string,                    // 答案
  guesses: [{ guess, a, b }, ...],   // 已提交猜测
  input: string,                     // 输入中、未提交的数字串
  won: boolean,                      // 本局是否已猜中
}
```

函数：`createInitialState()` / `toSaveable(state)` / `fromSaveable(data)`（含结构校验）。

> **无快照栈**：本游戏不提供撤销，故 state 不含 history。

### 3.4 `game.js`（控制器 + 事件总线）

`class Game`，简易事件系统（`on` / `emit` / `sound`），事件：`change`、`sound`、`win`、`newgame`。

| 方法 | 行为 |
| --- | --- |
| `newGame()` | 重置状态，emit `newgame` + `change`，播 `newgame` 音 |
| `restore(state)` | 恢复存档（不重新计胜） |
| `inputDigit(d)` | 追加数字；`won` 或已满或重复则拒绝（重复触发 `error` 音） |
| `backspace()` / `clearInput()` | 编辑输入 |
| `submitGuess()` | 校验 → `computeAB` → 入历史 → 清 input → emit `change` + `submit` 音；4A0B 则置 `won`、emit `win` |

`_winAwarded` 守卫防止同一局重复计胜（恢复已完成的存档时也不会重复计）。

### 3.5 `render.js`

`export const Render` 命名空间 + `buildRow()` 构造器，全量重建各区域：

- `input(state)`：4 个槽位，已填数字高亮，下一个待填位带脉冲光标。
- `history(state)`：整列重建，新猜测追加在底部并自动滚动；最近一条且 `won` 时整行高亮为胜利色。
- `stats(stats)`：工具栏紧凑统计栏（局数 / 最佳 / 平均）。

> 与 solitaire 一致采用「全量重建」而非增量 diff——1A2B 的 DOM 量很小，重建代价可忽略，且代码更简单。

### 3.6 `audio.js`

`export const Audio` 单例，懒创建 `AudioContext` + master gain（0.6 留头空间）+ `DynamicsCompressor` 限制器。所有音效纯合成，无音频文件：

| 音效 | 触发场景 | 合成 |
| --- | --- | --- |
| `newgame()` | 新局开始 | 330→440→587Hz 上行 triangle/sine |
| `submit()` | 提交一次猜测 | 520Hz square + 392Hz sine |
| `win()` | 猜中 4A0B | C-E-G-C（523/659/784/1047Hz）上行旋律 |
| `error()` | 无效输入 | 150Hz square 低沉 |

> 浏览器要求用户手势后才能播音；`Audio.resume()` 在首次输入时唤醒 `AudioContext`。

### 3.7 `storage.js`

`export const Storage` 命名空间，所有 key 前缀 `sz1a2b.`：

| Key | schema |
| --- | --- |
| `sz1a2b.stats` | `{ games, best, total }` JSON |
| `sz1a2b.achievements` | `{ id: true }` JSON |
| `sz1a2b.muted` | `'1'` / `'0'` |
| `sz1a2b.save` | `toSaveable(state)` JSON |

- `getStats` 对每个字段做类型/范围校验，损坏则回退默认值。
- `loadGame` 委托给 `state.fromSaveable` 做结构校验（答案 4 位不重复、guesses 合法、input 字符串等），损坏返回 `null`。
- `clearAll()` 清除本游戏拥有的全部 key（不含其它游戏/站点的数据）。

### 3.8 `achievements.js`

`checkAchievements(stats, guesses, onUnlock)`：遍历 `ACHIEVEMENTS`，对 `type:'count'` 校验 `stats.games >= threshold`，对 `type:'guesses'` 校验 `guesses <= threshold`；新解锁项写入 storage 并回调 `onUnlock`（由 main.js 弹 Toast）。

> 相比 solitaire 的「仅计数型」，本游戏额外支持「单局技巧型」（神机妙算 / 料事如神）。

### 3.9 `main.js`（编排枢纽）

启动流程：

1. `new Game()`（构造器已 `createInitialState` 生成 secret）。
2. `Storage.loadGame()` 恢复存档（若有则覆盖 state）。
3. 读 `stats` / `muted`，`Audio.setMuted`。
4. 注册 `game.on('change' / 'sound' / 'win' / 'newgame')`。
5. 绑定键盘 + 键盘按钮（事件委托，按 `data-key`）。
6. 绑定工具栏按钮（主题 / 静音 / 新局 / 重置 / 全屏）。
7. 初始化并应用主题（`applyTheme()`），监听系统 `prefers-color-scheme` 变化。
8. `renderAll()`。

关键机制见后续章节。

---

## 4. 输入与交互

### 键盘

| 物理键 | 行为 |
| --- | --- |
| `0–9` | 输入数字 |
| `Enter` | 提交（⌡) |
| `Backspace` | 退格 |
| `Esc` | 清空当前输入 |
| `N` | 新局 |
| `M` | 静音切换 |
| `T` | 主题切换（auto → light → dark） |
| `F` | 全屏切换 |

带修饰键（Ctrl/Cmd/Alt）的按键不拦截。

### 屏幕键盘

电话式 `1–9` 三列九宫格 + 底行 `⌫ / 0 / C`，下方为全宽 **`⚡ FIRE`** 提交按钮。通过 `#keypad` 上的事件委托（`closest('[data-key]')`）统一处理。

### FIRE 按钮反馈

- 平时灰显；当输入满 4 位（且未 `won`）时加 `.ready` 类——CSS `chargeGlow` 动画使其呼吸发光，表示「蓄能完毕」。
- 提交成功时加 `.firing` 类触发 `recoil` 后坐动画。
- 无效提交（位数不足）时抖动输入区（`.shake`）并播 `error` 音。

### iOS 长按防御

与 solitaire 一致：`touchstart` 设 350ms 定时器，到期标记 `blocked`，在随后的 `touchmove`/`touchend` 中 `preventDefault()`，阻止系统长按弹出菜单。

---

## 5. 胜利庆祝

猜中 4A0B 时触发 **SHOOP DA WHOOP** 命中庆祝：

1. `playWinCelebration()`：移除 `#win-overlay` 的 `hidden`，给 overlay 加 `.celebrate` 类。
2. CSS 动画：
   - `.win-stamp` 执行 `stampPop`——「命中」印章旋转弹入。
   - `.win-splash` 执行 `splash`——墨点向四周迸溅后淡出。
   - `.win-content` 执行 `pop`——「SHOOP DA WHOOP!」文字弹入。
3. `animationend`（或 1200ms 兜底）后移除 `.celebrate`，保留结果面板（显示所用次数与历史最佳）。
4. 点击「再来一局」或按 `N` 开始新一局。

> **无障碍**：`@media (prefers-reduced-motion: reduce)` 下所有动画降至近零时长，`.win-splash` 直接 `display:none`，印章与文字静态显示。

---

## 6. 主题切换

支持 **light / dark / auto** 三态，默认 `auto`（跟随系统 `prefers-color-scheme`）。

- **CSS**：`:root, [data-theme="light"]` 与 `[data-theme="dark"]` 各持一套 token（`--bg`、`--ink`、`--accent` 等），组件样式全部基于 token，无硬编码色值。
- **FOUC 防御**：`index.html` `<head>` 内联脚本在 CSS 加载前读取 `localStorage['sz1a2b.theme']`，解析为具体 `light`/`dark` 后写 `document.documentElement.dataset.theme`，避免首屏闪烁。
- **JS**：`main.js` 中 `resolveTheme()` 处理 auto→具体值；`applyTheme()` 同步 `data-theme`、`<meta name="theme-color">` 与按钮图标（🌗/☀️/🌙）；`toggleTheme()` 循环 auto→light→dark→auto 并持久化；`matchMedia('prefers-color-scheme: dark')` 的 `change` 事件仅在 auto 模式下触发重应用。
- **清空记录**：`clearAll()` 同时移除 `sz1a2b.theme`，重置后恢复 auto。

---

## 7. 持久化与统计

- **中途存档**：每次 `change`（未 `won` 时）`saveGame`；猜中后 `clearSave`，刷新即新局。
- **统计更新**（仅于 `win` 时）：`games++`、`total += 本次猜测数`、`best = min(best, 本次)`。
- **重置**：工具栏 `🗑` → 二次确认浮层 → `clearAll()` 清空 save/stats/achievements/mute。

---

## 8. 响应式

- 容器最大宽 `30rem` 居中；槽位、按键、历史字号均用 `clamp()` 随视口缩放。
- `@media (max-width: 360px)` 进一步收紧间距。
- 全屏 API 在 iOS Safari（仅 video 可全屏）可能不可用——`toggleFullscreen` 以 `try-catch` 包裹并静默忽略失败。

---

## 9. MPA 部署注意事项

- `vite.config.js` 已含 `'1a2b'` 入口；`base: './'` 使产物可用相对路径部署到任意子路径。
- 共享资源以**相对路径**引用：从 `games/1a2b/js/` 到仓库根需三层 `../../../`（如 `../../../shared/utils/common.js`）；CSS 与 HTML 各自从其所在目录计算层级。
