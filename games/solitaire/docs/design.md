# 纸牌接龙 · 技术设计文档

## 1. 技术栈

| 层级 | 技术选型 |
| --- | --- |
| 构建 / 开发 | **Vite 8**——ESM 开发服务器（HMR）+ 生产打包 |
| 语言 | JavaScript (ES2020+，源码可自由使用空值合并 `??`、逻辑或赋值、可选链等现代语法) |
| 兼容性 | `@vitejs/plugin-legacy` 产出 **modern ESM + `nomodule` 旧版双包**；目标统一声明在 `.browserslistrc`（底限 iOS 13 / Safari 13） |
| 样式 | CSS（CSS Variables + Flexbox + Grid），经 **PostCSS preset-env (stage 3) + autoprefixer** 自动加前缀并生成可行回退 |
| 音效 | Web Audio API（合成音效，无外部资源） |
| 持久化 | `localStorage` |
| 部署 | 产物为纯静态文件，`base: './'` 相对路径，可托管于任意子路径 / GitHub Pages / `file://` |

> 构建产物：`vite.config.js` 中 `build.target` 未显式声明，由 `@vitejs/plugin-legacy` 接管——它同时产出压缩后的现代 ESM 包与经 core-js polyfill 的 `nomodule` 包，`index.html` 的单一 `<script type="module">` 由插件自动补上 legacy fallback。

---

## 2. 架构总览

```text
┌──────────────────────────────────────────────────────┐
│                       main.js                         │
│      (入口 / 组装 / 事件绑定 / 发牌动画 / 全屏)        │
└──┬───────┬────────┬────────┬──────────┬─────────────┘
   │       │        │        │          │
   ▼       ▼        ▼        ▼          ▼
┌──────┐┌──────┐┌──────┐┌──────┐  ┌──────────┐
│ game ││render││input ││audio │  │  anim     │
│ .js  ││ .js  ││ .js  ││ .js  │  │ (FLIP) .js│
└──┬───┘└───┬──┘└──┬───┘└──────┘  └─────┬────┘
   │        │      │                     │ 提供 captureRects/
   ▼        │      │                     ▼ playFlip + 缓动常量
┌──────┐    │      │              (render/input 均消费)
│rules │◄───┴──────┘ (查询合法目标)
│ .js  │
└──┬───┘
   │
   ▼
┌──────┐  ┌──────┐
│state │  │ deck │
│ .js  │  │ .js  │
└──┬───┘  └──────┘
   │
   ▼
┌──────────┐  ┌──────────────┐
│ storage  │  │ achievements │
│  .js     │  │    .js       │
└──────────┘  └──────────────┘
     │               │
     ▼               ▼
┌──────────────────────────────┐
│        constants.js          │
│    (全局常量 / 配置)          │
└──────────────────────────────┘
```

**数据流方向**：`main.js` 作为中心枢纽，持有 `Game` 实例并监听其 `change` / `sound` / `win` / `dealing` / `autoMove` 事件，驱动 `Render` 重绘并持久化。每次重绘由 `anim.js` 的 FLIP 包裹，使所有改位的牌获得位移过渡动画。`DragController` 读取 `Game` 状态计算合法目标，用户松手后调用 `Game.move()`（成功则由 `change` 触发的 FLIP 把牌"飞"到位，失败则用 `anim` 缓动常量回弹）。

---

## 3. 模块设计

### 3.1 `constants.js` — 全局常量

定义所有游戏常量和配置键：

```js
COLORS = ['red', 'black', 'green']       // 三种颜色
TYPE_NUMBER / TYPE_DRAGON / TYPE_FLOWER   // 牌类型枚举
TABLEAU_COLS = 8                          // 桌面列数
FREE_CELL_COUNT = 3                       // 空闲格数量
RANK_MIN = 1 / RANK_MAX = 9              // 数字范围
DRAGON_COUNT_PER_COLOR = 4               // 每种颜色 4 张龙
STORAGE_WINS / STORAGE_ACHV / ...        // localStorage 键名
ACHIEVEMENTS = [...]                     // 成就定义数组
```

### 3.2 `deck.js` — 牌组与发牌

**职责**：创建牌组、洗牌、发牌。

| 函数 | 说明 |
| --- | --- |
| `createDeck()` | 构建 40 张牌（27 数字 + 12 龙 + 1 花） |
| `shuffle(arr, rng)` | Fisher-Yates 洗牌，支持自定义随机数生成器 |
| `deal()` | 洗牌后按列循环分配至 8 列（每列 5 张，全部面朝上） |

**牌数据结构**（纯数据对象，无类）：

```js
// 数字牌
{ id: 'n-red-5', type: 'number', color: 'red', rank: 5 }

// 龙牌
{ id: 'dragon-black-2', type: 'dragon', color: 'black' }

// 花牌
{ id: 'flower', type: 'flower' }
```

### 3.3 `state.js` — 状态管理与快照

**职责**：创建初始状态、深拷贝快照、撤销/恢复。

**状态结构**：

```js
{
  tableau: Card[][],        // 8 个列，每列是 Card 数组（栈顶 = 数组末尾）
  freeCells: (Card | null | DragonPile)[],  // 3 个空闲格
  foundations: { red: Card[], black: Card[], green: Card[] },
  flowerSlot: Card | null,
  history: Snapshot[]       // 撤销栈（最多 300 层）
}
```

**DragonPile 结构**（锁定的龙牌收纳格）：

```js
{ locked: true, type: 'dragonpile', color: 'red', cards: [Card, ...] }
```

| 函数 | 说明 |
| --- | --- |
| `createInitialState()` | 发牌 + 初始化空区域 |
| `fromLayout(layout)` | 从持久化数据恢复状态 |
| `snapshot(state)` | 深拷贝当前棋局推入 `history` 栈 |
| `restoreSnapshot(state)` | 弹出并恢复最近快照，返回 `false` 表示无可撤销 |
| `toSaveable(state)` | 导出可序列化的棋局（不含 history） |

**关键设计**：不可变快照。每次用户操作前调用 `snapshot()`，深拷贝整个棋盘（不包括 history），确保撤销时完整还原。快照上限 300 层防止内存溢出。

### 3.4 `rules.js` — 纯规则函数

**职责**：所有规则判断和查询，纯函数，无副作用，可独立单元测试。

| 函数 | 说明 |
| --- | --- |
| `isNumber(c)` / `isDragon(c)` / `isFlower(c)` | 类型判断 |
| `canStack(moving, target)` | 判断 `moving` 能否叠放到 `target` 上 |
| `isValidRun(cards)` | 判断牌序列是否形成合法 run |
| `findCard(state, cardId)` | 在 tableau 和 freeCells 中定位牌 |
| `freeEmptyCount(state)` | 空闲格空位数 |
| `emptyColumnCount(state)` | 空列数 |
| `movableCount(state)` | 理论最大可移动牌数（参考用） |
| `dragonsOnBoard(state)` | 场上残余龙牌数 |
| `allDragonsOfColorExposed(state, color)` | 某颜色龙牌是否全部暴露 |
| `canCollectDragons(state, color)` | 某颜色龙牌是否可收集 |
| `readyDragonColor(state)` | 返回首个可收集的龙牌颜色 |
| `grabRunFromTableau(state, cardId)` | 从点击位置提取可拖动的 run |
| `validDropTargets(state, run)` | 计算所有合法放置目标 |
| `nextAutoMove(state)` | 返回下一个自动归位操作 |
| `isWin(state)` | 判断是否达成胜利条件 |
| `sameDest(a, b)` | 比较两个目标描述符是否相同 |

**`validDropTargets` 算法**：

1. 遍历 8 个 tableau 列 → 空列（总是合法）或栈顶可叠放
2. 如果 run 长度为 1 → 遍历空闲格空位
3. 如果 run 长度为 1 且为数字牌 → 检查是否可入终局槽
4. 如果 run 长度为 1 且为花牌 → 检查花牌位是否为空

龙牌顶部不可作为叠放目标。

### 3.5 `game.js` — 游戏控制器

**职责**：状态变更的唯一入口，协调规则校验、快照、自动归位和事件通知。

**事件驱动模型**（`emit`/`on` 简易实现）：

```js
game.on('change',   () => { /* 重绘 UI + 持久化 */ });
game.on('sound',    name => { /* 播放音效 */ });
game.on('win',      () => { /* 延迟展示胜利浮层 */ });
game.on('dealing',  () => { /* 清空棋盘并播放发牌飞行 */ });
game.on('autoMove', m => { /* 自动归位明细（可观察） */ });
```

事件含义：`change` 为任意已提交变更（move / undo / 收龙）；`sound` 携带音效名；`win` 在 `change` 之后同步触发，UI 会延迟 `FLIP_MS` 后再弹胜利浮层；`dealing` 由 `newGame()` 抛出，`main.js` 据此执行逐张发牌动画；`autoMove` 在自动归位级联中为每一步抛出。

| 方法 | 说明 |
| --- | --- |
| `newGame()` | 重置状态并触发自动归位 |
| `move(run, dest)` | 用户移动操作：校验 → 快照 → 执行 → 自动归位 → 检查胜利 |
| `collectDragons(color)` | 收龙操作：校验 → 快照 → 收集 → 锁定格子 → 自动归位 |
| `undo()` | 回退到最近快照 |
| `applyAutoMoves()` | 循环执行自动归位直到收敛（最多 1000 次防止死循环） |
| `canUndo()` | 是否有可撤销的历史 |
| `dragonReady()` | 是否有可收集的龙牌 |

**move() 流程**：

```text
1. 解析 run 的源位置 (findCard)
2. 校验 run 合法性（长度匹配、isValidRun）
3. 调用 validDropTargets 获取合法目标
4. 匹配 dest 是否在合法目标中
5. snapshot() 保存状态
6. _take() 从源位置移除
7. _place() 放入目标位置
8. 播放音效
9. applyAutoMoves() 级联自动归位
10. emit('change') 通知 UI 重绘
11. 检查 isWin() → emit('win')
```

### 3.6 `render.js` — 渲染器

**职责**：根据状态重建 DOM 元素，无虚拟 DOM，直接操作。

**渲染策略**：全量重绘。每次 `change` 事件触发时，清空所有 slot 容器并用 `buildCard()` 重建 card 元素。牌元素使用 `data-id` 属性绑定，拖拽时通过 `cardEl(id)` 查找。

**Card DOM 结构**：

```html
<!-- 数字牌 -->
<div class="card num c-red" data-id="n-red-5">
  <span class="corner tl"><span class="rank-num">5</span></span>
  <span class="corner br"><span class="rank-num">5</span></span>
</div>

<!-- 龙牌（每色一个雀牌字样，按颜色区分） -->
<div class="card dragon c-black" data-id="dragon-black-0">
  <span class="corner tl"><span class="glyph-small">萬</span></span>
  <span class="corner br"><span class="glyph-small">萬</span></span>
</div>

<!-- 花牌 -->
<div class="card flower" data-id="flower">
  <span class="corner tl"><span class="glyph-small">✿</span></span>
  <span class="corner br"><span class="glyph-small">✿</span></span>
</div>
```

**终局槽渲染**：显示栈顶牌 + 计数徽章。

**龙牌字样颜色映射**：`red → 中`、`black → 萬`、`green → 發`（雀牌字样），赋给 `.glyph-small`；不匹配的颜色 fallback 为 `龍`。

**锁定龙牌格渲染**：显示 🐙 + 🔒 图标，并在格子上加 `locked` + `c-{color}` 类以着色。

### 3.7 `anim.js` — FLIP 动画

**职责**：为渲染前后位置发生变化的牌提供 FLIP（First–Last–Invert–Play）位移动画；并向拖拽控制器等提供统一的缓动常量。它是"丝滑"视觉体验的核心。

**为什么需要它**：`Render.board()` 每次都是全量重建 DOM，牌会瞬间"跳"到新位置。FLIP 在重建前用 `getBoundingClientRect()` 记录每张牌的旧矩形，重建后把仍存在的牌反向位移回旧位置（无动画），再在下一帧用 CSS transform 缓动归位。

**关键技巧**：`getBoundingClientRect()` 会读出 inline transform。因此拖拽落点（`input.js` 在 `pointerup` 时把位移写到真实卡片上）会被视为该牌的"起始位置"，让撤销、收龙、自动归位级联都获得天然连续的飞行效果。

| 导出 | 说明 |
| --- | --- |
| `FLIP_MS` / `FLIP_EASE` | 统一动画时长与缓动曲线（`240ms`，`cubic-bezier(0.2,0.8,0.2,1)`） |
| `captureRects(root)` | 重建前记录所有 `.card[data-id]` 的视口矩形（`Map<id, Rect>`） |
| `playFlip(root, firstRects)` | 重建后比对矩形，把位移 > 0.5px 的牌先 invert 再播放归位 |

**调用点**：`main.js` 的 `renderAll()` 用 `captureRects` → `Render.board()` → `playFlip` 包裹重绘；`input.js` 取 `FLIP_MS`/`FLIP_EASE` 做取消拖拽的回弹；`main.js` 发牌动画以 `FLIP_MS` 作为节奏基准。

**节流**：动画结束后在 `FLIP_MS + 60ms` 后清除 inline 的 `transition`/`transform`，避免残留影响下一轮 FLIP 测量或下一帧渲染。

---

### 3.8 `input.js` — 拖拽交互

**职责**：将 pointer 事件转换为游戏操作。

**DragController 工作流**：

```text
pointerdown → 定位牌 → 提取 run → 生成 ghost 元素 → 计算合法目标
pointermove → 移动 ghost → elementFromPoint 检测 hover → 高亮合法目标
pointerup   → 若 hover 合法 → game.move(run, dest)
             → 否则 → 还原，播放错误音效
```

**Ghost 元素**：克隆原始 card 元素，添加 `ghost` 类，使用 `position: fixed` + `transform: translate()` 跟随指针。原始卡片添加 `is-dragging` 类使其半透明。

**目标检测**：使用 `elementFromPoint()` 获取指针下的元素，向上查找 `[data-slot]` 属性，解析目标描述符后与 `validDropTargets` 结果匹配。

### 3.9 `audio.js` — 音效系统

**职责**：Web Audio API 合成芯片音效（chiptune），无外部音频文件。

**音效表**：

| 音效 | 触发场景 | 合成参数 |
| --- | --- | --- |
| `move` | 牌移入空闲格 | 520Hz triangle, 50ms |
| `place` | 牌移入其他列 | 330Hz sine, 60ms |
| `foundation` | 牌入终局槽 | 660Hz + 880Hz 双音 |
| `dragon` | 收龙 | 180Hz sawtooth + 120Hz sine |
| `flower` | 花牌自动归位 | 740Hz + 988Hz |
| `win` | 胜利 | C-E-G-C 上行琶音 |
| `error` | 非法操作 | 150Hz square |

**实现细节**：

- 延迟创建 `AudioContext`（按需）、延迟创建 `master` 增益节点
- 用户手势后调用 `resume()` 解除浏览器自动播放限制
- 所有音效通过 `tone(freq, dur, type, gain, delay)` 合成，使用 `oscillator` + `gain` 节点包络（exponentialRamp 衰减）
- **主总线 + 限幅器**：`voice → 每 tone 的 gain → master gain(0.6) → DynamicsCompressor(限幅) → destination`。限幅器在自动归位级联多层音叠加时软削波，避免增益叠加 > 1.0 产生磨机音/爆音
- **避免咔哒声**：每个 tone 在 `t0` 先 `setValueAtTime(0)` 重置增益，防止 GainNode 默认 1.0 导致首个样本以满音量泄漏（=咔哒声）；节点 `stop` 后断开以释放内存

### 3.10 `storage.js` — 持久化

**职责**：封装 `localStorage` 读写。

**存储键**：

| 键 | 内容 | 格式 |
| --- | --- | --- |
| `szsol.wins` | 累计胜局数 | 整数字符串 |
| `szsol.achievements` | 成就解锁状态 | JSON `{ climb: true, ... }` |
| `szsol.muted` | 静音状态 | `'0'` / `'1'` |
| `szsol.save` | 当前棋局存档 | JSON（snapshotClone 格式） |

**存档策略**：每次 `change` 事件触发时保存。页面刷新后自动恢复，实现断点续玩。存档仅保存棋盘状态（不含 history），撤销栈不持久化。

### 3.11 `achievements.js` — 成就系统

**职责**：检查胜局数是否达到里程碑，解锁新成就。

```js
checkAchievements(wins, onUnlock) → 对比阈值 → 解锁新成就 → 回调通知
unlockedList() → 返回已解锁状态
```

> **现状**：该模块提供了完整的检测 / 存储 / 回调 API（依赖 `Storage` 与 `constants.ACHIEVEMENTS`），但 **`main.js` 当前未在胜局流程中调用 `checkAchievements`**。胜局时仅做 `wins += 1` 并持久化 + 展示胜利浮层，成就解锁与弹出提示尚未接入 UI。如需启用，在 `game.on('win')` 中调用 `checkAchievements(wins, a => showToast(a.name))` 即可。

### 3.12 `main.js` — 入口

**职责**：组装所有模块，绑定 UI 事件和键盘快捷键，并负责发牌动画、全屏与 iOS 长按防御。

初始化 / 运行流程：

1. 创建 `Game` 实例；若 `Storage.loadGame()` 有存档则用 `fromLayout()` 写回 `game.state`；随后始终调用 `applyAutoMoves()` 收口（安顿开机即暴露的花牌 / 安全起手）
2. 恢复胜局数与静音状态，调用 `Audio.setMuted(muted)`
3. 包裹重绘为 `renderAll()`：`captureRects → Render.board → updateChrome → playFlip`，使任意棋局变更都带 FLIP 动画
4. 绑定事件：`change` 重绘并存档；`sound` 播放音效；`win` 在 `FLIP_MS + 120ms` 后弹胜利浮层（防与最后一飞动画冲突）；`dealing` 执行逐张发牌动画
5. 创建 `DragController` 绑定到 `#board`
6. 绑定工具栏按钮（新局 / 撤销 / 静音 / 收龙 / 再来一局）与键盘快捷键 `N/U/Z/M/C/F`
7. 全屏与横屏锁定：`F` 或移动端 ⛶ 按钮触发 `requestFullscreen`（尝试 `screen.orientation.lock('landscape')`），不支持时隐藏按钮
8. iOS Safari 长按防御：拦截 `selectstart` / `contextmenu`，并在静按 350ms+ 时折返回的手势以防系统 “选择/复制” 菜单弹出

**键盘快捷键**：`N` 新局、`U`/`Z` 撤销、`M` 静音、`C` 收龙、`F` 全屏。输入框聚焦时快捷键不生效。

---

## 4. 数据模型

### 4.1 Card 类型

```ts
// 数字牌
interface NumberCard {
  id: string;          // "n-{color}-{rank}"
  type: 'number';
  color: 'red' | 'black' | 'green';
  rank: number;        // 1-9
}

// 龙牌
interface DragonCard {
  id: string;          // "dragon-{color}-{index}"
  type: 'dragon';
  color: 'red' | 'black' | 'green';
}

// 花牌
interface FlowerCard {
  id: 'flower';
  type: 'flower';
}

type Card = NumberCard | DragonCard | FlowerCard;
```

### 4.2 目标描述符

```ts
type DestDescriptor =
  | { type: 'column'; index: number }        // 桌面列
  | { type: 'freecell'; index: number }      // 空闲格
  | { type: 'foundation'; color: string }    // 终局槽
  | { type: 'flower' };                      // 花牌位
```

### 4.3 位置描述符

```ts
type LocDescriptor =
  | { zone: 'tableau'; col: number; idx: number }
  | { zone: 'freecell'; idx: number };
```

---

## 5. 核心算法

### 5.1 发牌算法

```text
createDeck() → shuffle() → deal()
                                ↓
              按列循环分配：第 i 张牌 → 列 i % 8
              每列 5 张，全部面朝上，无暗牌
```

### 5.2 合法目标计算 (`validDropTargets`)

```text
输入: state, run[]
输出: DestDescriptor[]

for each tableau column (排除源列):
  if 列空 → 加入目标
  else if 栈顶非龙牌 && canStack(head, top) → 加入目标

if run.length == 1:
  for each free cell:
    if 空 → 加入目标
  if isNumber(head):
    if foundation[head.color].length == head.rank - 1 → 加入目标
  if isFlower(head) && flowerSlot == null → 加入目标
```

### 5.3 自动归位 (`nextAutoMove`)

```text
1. 花牌优先：如果花牌位为空，扫描所有列顶和空闲格，找到花牌 → 返回
2. 数字牌安全检测：
   - 收集所有暴露的数字牌（列顶 + 空闲格）
   - 过滤 isSafeNumber(state, card) 为 true 的牌
   - 按 rank 升序排列
   - 返回 rank 最小的那张
3. 无候选 → 返回 null

isSafeNumber(state, card):
  - 该牌确实是其颜色终局槽的下一个所需 rank（foundations[card.color].length == card.rank - 1），且
  - 所有**其他**颜色终局槽都至少达到 rank - 1（保证这张牌永远不会被需要作为桌面的叠放点）
  - rank 1 为总是安全（只要其颜色终局槽期待它）
  - 所有其他颜色的终局槽都已达到至少 rank-1
```

### 5.4 龙牌收集 (`collectDragons`)

```text
1. 检查 allDragonsOfColorExposed(state, color) → 所有该色龙牌是否在列顶或空闲格
2. 查找目标空闲格：优先空位，其次含单张龙牌的格子
3. 从所有列顶和空闲格中收集该色龙牌 → 打包为 DragonPile
4. 放入目标空闲格并锁定
```

### 5.5 胜利判定 (`isWin`)

```text
all foundations[color].length == 9  // 所有终局槽满
  && flowerSlot != null              // 花牌已归位
  && dragonsOnBoard(state) == 0      // 无残余龙牌
```

### 5.6 撤销 / 重做

- 仅支持撤销（Undo），不支持重做（Redo）
- 每次操作前调用 `snapshot(state)` 深拷贝当前状态推入栈
- 撤销时 `restoreSnapshot(state)` 弹出栈顶并覆盖当前状态
- history 栈上限 300，超出时 shift 最旧记录

---

## 6. 渲染与交互

### 6.1 渲染策略

- **全量重绘**：每次 `change` 事件触发完整的 `Render.board(state)` 重绘
- **DOM 复用**：不保留 DOM 引用，每次根据 `data-id` 重建
- **性能考量**：40 张牌 + 固定 slot 数量，全量重绘毫秒级完成

### 6.2 拖拽系统

- **Ghost 元素**：`position: fixed` + CSS `transform: translate(dx, dy)` 实现无布局抖动跟随
- **目标检测**：`elementFromPoint(x, y)` + `closest('[data-slot]')` 获取目标 slot
- **高亮反馈**：合法目标添加 `drop-ok` 类（绿色边框发光），非法目标无反馈
- **错误反馈**：非法释放时播放 `error` 音效 + 卡片 `shake` 动画

### 6.3 视觉设计

- **配色**：深色玉纹背景（`#0d2b1a`），金色装饰，配合复古终端风格
- **字体**：等宽字体（DejaVu Sans Mono / Consolas / Menlo），呼应终端美学
- **牌面**：圆角卡片，数字牌显示数字，龙牌显示「龙」字，花牌显示 ✿
- **响应式**：CSS Grid + Flexbox，适配桌面和移动端

### 6.4 z-index 分层设计

所有层级分两**带**：**牌动画带**（5000~9000，全部由 composables 以 inline style 动态设置）与**固定浮层带**（100~110，静态 CSS）。两带之间刻意留出 4900 的间隙，保证**浮层永远盖住飞行中的牌**。

| z-index | 用途 | 归属 | 设置位置 |
| --- | --- | --- | --- |
| `auto` | 棋盘 / 牌面的自然层叠（列内按 DOM 序） | 静态 | CSS 默认 |
| `100` | `.overlay` 全屏遮罩（新局确认 / 胜利） | 静态 | `index.css` |
| `105` | `.overlay.newgame-overlay` 新局确认（防御：须在胜利之上） | 静态 | `index.css` |
| `110` | `.toasts` 成就提示（`pointer-events: none`） | 静态 | `index.css` |
| `5000 + i` | 发牌动画：snap 到 stock 等待的牌（后发的叠上层） | 动态 | `useDealing.ts` |
| `5000 + (len-1-i)` | 收牌动画：snap 回列原位等待的牌（**先飞的叠上层**，还原列叠放） | 动态 | `useDragonCollect.ts`（`HOLD_Z_BASE`） |
| `6000 + i` | 自动归位飞行（发牌 settleAutoMoves / 收牌后数字牌收向终局） | 动态 | `useDealing.ts` / `useDragonCollect.ts` |
| `7000 + i` | 收牌动画：龙牌飞向锁定格 | 动态 | `useDragonCollect.ts` |
| `9000` | 拖拽中的牌（`.is-dragging`）/ 发牌飞行中的牌 | 动态 | `index.css` / `useDealing.ts` |

#### 核心原则

1. **只在飞行瞬间抬升、落地清除**：z-index 在 `takeOff()`/`fly()` 内设置，落地用 `setTimeout` 清回 `''`（auto）。等待起飞的牌保持自然层叠，否则会干扰列内叠放（曾出现"等待牌一次性抬升 → 列内层级反转"的 bug）。
2. **等待期按起飞顺序反序排序**：自动收牌时牌被 Vue 重排进 foundation（absolute 堆叠，DOM 序 9 最后 = 最上），snap 回列位后必须反序设 z-index（先飞的在上层）才能还原列的"8 盖住 9"自然叠放——否则会出现"9 突然盖住 8 且透出半透明渐变"的视觉错乱。
3. **飞行带相对顺序**：龙牌（7000）> 自动归位（6000）> 等待/驻留（5000），保证相邻两张短暂同飞时后起飞的盖住先起飞的（追尾效果合理）。
4. **浮层带永远最高**：胜利 overlay 可能在收牌动画进行中就出现（最后一张自动收 = 胜利），若 overlay 低于飞行带，最后一张牌会飘在"恭喜通关"之上。
5. **弹窗互不叠加**：胜利 overlay 与确认弹窗同为全屏层，靠 DOM 序 + `newgame-overlay` 更高的 z 保证确认弹窗按钮可点（另有 `askNewGame()` 胜利时跳过确认的行为层兜底）。

#### 胜利弹窗的时机（动画完成后显示）

引擎 `onWin` 回调会**先记胜局数**（`wins` +1 并持久化），但 `won`（弹窗开关）的置位分两种情况：

- **普通移动触发胜利**（最后一张牌手动放上终局）：`collecting === false` → `won` 立即置位，弹窗马上出现
- **收牌动画途中触发胜利**（最后一张数字牌自动收向终局即是胜利）：此时 `collecting === true` → 存入 `deferredWin`，**不立即置位**；`useDragonCollect` 在飞牌动画完全结束的 `finally` 中调用 `flushDeferredWin()` 才释放弹窗——保证"恭喜通关"不会在飞行中的牌上方弹出

相关状态：`deferredWin`（`useSolitaireGame.ts` 模块级私有标志），`undo()` / `newGame()` 都会清除它（撤销后棋盘不再是胜利状态、新局自然无胜利）。胜利音效不延迟（`onSound('win')` 随引擎立即播放）。

---

## 7. 音效系统

### 设计原则

- **零外部依赖**：所有音效通过 Web Audio API 实时合成
- **芯片风格**：使用 triangle / sawtooth / sine 波形模拟 8-bit 音效
- **低延迟**：`OscillatorNode` + `GainNode` 直接连接 `destination`

### 浏览器兼容

- 延迟创建 `AudioContext`（避免 Safari 自动播放限制）
- 用户首次交互时调用 `resume()` 激活 AudioContext
- 静音状态持久化到 `localStorage`

---

## 8. 持久化

### 存档策略

| 数据 | 触发时机 | 内容 |
| --- | --- | --- |
| 棋局存档 | 每次 `change` 事件 | 完整棋盘（不含 history） |
| 胜局计数 | 每次胜利 | 累计整数 |
| 成就状态 | 解锁新成就时 | 解锁标记 Map |
| 静音状态 | 切换时 | 布尔值 |

### 容错

- `loadGame()` 包含完整校验（tableau 数组、freeCells 长度、foundations 完整性）
- 任何校验失败返回 `null`，触发新游戏
- JSON 解析异常静默忽略

---

## 9. 项目结构

```text
solitaire/
├── index.html              # 单页 HTML（含静态布局骨架）
├── package.json            # 仅含 serve 脚本 + 文档转换依赖
├── css/
│   └── style.css           # 全部样式（CSS Variables + Flexbox + Grid）
├── js/
│   ├── main.js             # 入口：组装模块、绑定事件
│   ├── game.js             # 游戏控制器：move / undo / collectDragons
│   ├── state.js            # 状态模型 + 快照 / 撤销
│   ├── rules.js            # 纯规则函数（无副作用）
│   ├── deck.js             # 牌组创建、洗牌、发牌
│   ├── render.js           # DOM 渲染器
│   ├── input.js            # 拖拽交互控制器
│   ├── audio.js            # Web Audio 合成音效
│   ├── storage.js          # localStorage 持久化
│   ├── achievements.js     # 成就检查
│   └── constants.js        # 全局常量
├── docs/
│   ├── desc.md             # 原始设计文档
│   ├── rules.md            # 游戏规则文档
│   └── design.md           # 本文件
└── temp/                   # 临时文件（数据抓取 / 转换脚本）
```

---

## 10. 测试

### 单元测试

`rules.js` 作为纯函数模块，可独立进行单元测试。测试文件位于 `temp/logic_test.js`。

**建议测试覆盖**：

- `canStack()` — 合法/非法叠放组合
- `isValidRun()` — 合法/非法序列
- `validDropTargets()` — 各种棋盘状态下的目标集合
- `nextAutoMove()` — 自动归位优先级
- `isWin()` — 胜利条件判定
- `findCard()` — 牌定位

### 集成测试

- 完整游戏流程：发牌 → 移动 → 收龙 → 胜利
- 撤销多步后状态一致性
- 存档/读档往返一致性

---

## 11. 设计决策记录

| 决策 | 理由 |
| --- | --- |
| 不使用框架 | 极简项目，原生 DOM 操作足够，零构建开销 |
| 纯函数规则模块 | 便于测试、推理、复用 |
| 全量重绘 | 牌数少（40 张），性能无瓶颈，避免增量同步的复杂性 |
| 快照撤销（非命令模式） | 实现简单，状态不可变保证正确性 |
| Web Audio 合成音效 | 无需外部资源文件，chip 风格契合游戏主题 |
| 无打包器 | 现代浏览器原生支持 ES Modules，开发体验更轻量 |
