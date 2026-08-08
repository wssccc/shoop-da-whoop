# 纸牌接龙 · 技术设计文档

## 1. 技术栈

| 层级 | 技术选型 |
| --- | --- |
| 构建 / 开发 | **Vite 8**——ESM 开发服务器（HMR）+ 生产打包 |
| 语言 | JavaScript (ES2020+，源码可自由使用空值合并 `??`、逻辑或赋值、可选链等现代语法) |
| 兼容性 | `@vitejs/plugin-legacy` 产出 **modern ESM + `nomodule` 旧版双包**；目标统一声明在 `.browserslistrc`（底限 iOS 13 / Safari 13） |
| 样式 | CSS（CSS Variables + Flexbox + Grid），经 **Tailwind 工具类**（仅布局骨架，无响应式覆盖的类）+ **PostCSS preset-env (stage 3) + autoprefixer** 自动加前缀并生成可行回退；响应式覆盖与复杂视觉留在 `@layer components`（见 `src/index.css` 头部注释） |
| UI 组件 | **reka-ui**（Toast / Dialog 可访问性原语，enter/exit 走 `data-state` CSS 动画）+ **lucide-vue-next**（工具栏单色图标，按需 tree-shaken） |
| 动画 | **自研 FLIP**（`animateAutoMoves.ts`，无动画库）——单卡 FLIP tween + action-unit 执行器交错起飞；motion-v 已移除（见 §3.7） |
| 音效 | Web Audio API（合成音效，无外部资源） |
| 持久化 | `localStorage` |
| 部署 | 产物为纯静态文件，`base: './'` 相对路径，可托管于任意子路径 / GitHub Pages / `file://` |

> 构建产物：`vite.config.js` 中 `build.target` 未显式声明，由 `@vitejs/plugin-legacy` 接管——它同时产出压缩后的现代 ESM 包与经 core-js polyfill 的 `nomodule` 包，`index.html` 的单一 `<script type="module">` 由插件自动补上 legacy fallback。

---

## 2. 架构总览

```text
┌──────────────────────────────────────────────────────────────┐
│                      App.vue (入口组件)                       │
│   useSolitaireGame (游戏控制器 + unit 执行器)                  │
│   useDealing / useDragController / useHint / useAudio        │
│   useAchievements / Card / CardBack / WinCard / Toaster      │
└──┬──────────────────────┬───────────────────┬───────────────┘
   │ 发布 state (shallowRef) │ 事件回调            │ 动画
   ▼                       ▼                   ▼
┌──────────────┐   ┌────────────────┐   ┌──────────────────┐
│ SolitaireEngine│   │ animateAutoMoves│  │   lib/toaster.ts  │
│  (game/engine.ts)│◄──┤  (flyCardTo /   │  │  (reka-ui toast   │
│  状态变更唯一入口 │   │   flyCardHome)  │  │   命令式封装)      │
└──┬───────────┘   └────────────────┘   └──────────────────┘
   │ 原地修改 + 快照
   ▼
┌──────────────────────────────────────────┐
│  game/rules.ts (纯规则)  game/state.ts    │
│  game/types.ts  game/constants.ts         │
│  game/solverAdapter.ts (GameState↔SolverState)│
└──────────┬─────────────────────┬─────────┘
           │                     │
           ▼                     ▼
┌──────────────────┐   ┌──────────────────────┐
│  storage.ts       │   │  worker/solver.worker.ts │
│  (localStorage)   │   │  tools/solver/ (求解器)   │
└──────────────────┘   └──────────────────────┘
```

**数据流方向**：`App.vue` 装配各 composable。`useSolitaireGame` 持有唯一的 `SolitaireEngine` 实例——它是**状态变更的唯一入口**（`move` / `collectDragons` / `undo` / `newGame` / `applyAutoMoves`）。引擎**原地修改**状态，composable 通过 `publish()`（浅拷贝顶层对象 + 重赋 `state.value`）触发 Vue 重渲染。所有动画统一走 **action-unit 执行器**（`consumeUnit`）：引擎按 `stepUnit()` 逐步"生成并应用"原子步（每步一张牌），执行器 `publish → nextTick → flyCardTo/flyCardHome` 单卡 FLIP，数据与画面严格锁步。拖拽控制器在 `pointerup` 时调用 `moveCard`（落子后仅播 250ms 归位滑动，级联由执行器接管）；提示路径走 `moveCardAnimated`（run 整体 FLIP 飞达目标后同样进入执行器）。

**单元模型（核心）**：一次完整的玩家动作 = 1 user step + 0~N 级联步，打包为一个 **action unit**——共享一个 undo 快照、settle 后统一判胜 + 持久化一次。生命周期 `beginUnit → stepUnit* → endUnit`（`abortUnit` 撤销未起步的 unit）。详见 [glossary.md](./glossary.md) 与 §5.4。

---

## 3. 模块设计

### 3.1 `src/game/constants.ts` — 全局常量

定义所有游戏常量和配置键：

```ts
COLORS = ['red', 'black', 'green']       // 三种颜色
TYPE_NUMBER / TYPE_DRAGON / TYPE_FLOWER   // 牌类型枚举
TABLEAU_COLS = 8                          // 桌面列数
FREE_CELL_COUNT = 3                       // 空闲格数量
RANK_MIN = 1 / RANK_MAX = 9              // 数字范围
DRAGON_COUNT_PER_COLOR = 4               // 每种颜色 4 张龙
STORAGE_WINS / STORAGE_ACHV / ...        // localStorage 键名
ACHIEVEMENTS = [...]                     // 成就定义数组
```

### 3.2 `src/game/state.ts` — 状态、洗牌与发牌

**职责**：创建牌组、洗牌、发牌、初始状态、深拷贝快照、撤销/恢复。

| 函数 | 说明 |
| --- | --- |
| `createDeck()` | 构建 40 张牌（27 数字 + 12 龙 + 1 花） |
| `shuffle(arr, rng)` | Fisher-Yates 洗牌，支持自定义随机数生成器 |
| `deal()` | 洗牌后按列循环分配至 8 列（每列 5 张，全部面朝上） |
| `createInitialState()` | 发牌 + 初始化空区域 |
| `fromLayout(layout)` | 从持久化数据恢复状态 |
| `snapshot(state)` | 深拷贝当前棋局推入 `history` 栈 |
| `restoreSnapshot(state)` | 弹出并恢复最近快照，返回 `false` 表示无可撤销 |
| `toSaveable(state)` | 导出可序列化的棋局（不含 history） |

**牌数据结构**（纯数据对象，无类）：

```ts
// 数字牌
{ id: 'n-red-5', type: 'number', color: 'red', rank: 5 }

// 龙牌
{ id: 'dragon-black-2', type: 'dragon', color: 'black' }

// 花牌
{ id: 'flower', type: 'flower' }
```

**状态结构**：

```ts
{
  tableau: Card[][],        // 8 个列，每列是 Card 数组（栈顶 = 数组末尾）
  freeCells: (Card | null | DragonPile)[],  // 3 个空闲格
  foundations: { red: Card[], black: Card[], green: Card[] },
  flowerSlot: Card | null,
  history: Snapshot[]       // 撤销栈（最多 300 层）
}
```

**DragonPile 结构**（锁定的龙牌收纳格）：

```ts
{ locked: true, type: 'dragonpile', color: 'red', cards: [Card, ...] }
```

**关键设计**：不可变快照。每个 action unit 开始时 `snapshot()` 一次（深拷贝整个棋盘，不包括 history），unit 内所有步共享该快照——一次撤销回退整个 unit。快照上限 300 层防止内存溢出。

### 3.4 `src/game/rules.ts` — 纯规则函数

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

### 3.5 `src/game/engine.ts` — 游戏引擎（SolitaireEngine）

**职责**：状态变更的唯一入口，协调规则校验、undo 快照、action unit 生命周期与胜利判定。与 UI 解耦：引擎只暴露同步 API + `onSound` / `onWin` 回调（由 `useSolitaireGame` 接线），**不做任何 DOM / 动画 / 持久化**。

**Action unit 生命周期**（核心模型，动画层逐条消费）：

| 方法 | 说明 |
| --- | --- |
| `beginUnit(kind)` | 开 unit：拍 undo 快照，登记类型（`move` / `dragon`）。`move` 型在已有 unit 打开时**复用**（hint 路径先收敛 leading 级联再执行 user step，一个快照覆盖整个提示动作，一次 undo 全部撤回） |
| `stepUnit()` | 生成**并应用**当前 unit 的下一步（收龙 unit：空闲格龙 → 列顶龙；随后统一进入 auto-move 级联），返回 `UnitAction`（`{id, to}`）或 `null`（unit 完成） |
| `endUnit()` | 收尾：清 unit + `checkWin()`（赢局只记一次，`_winAwarded` 防重复） |
| `abortUnit()` | 未应用任何步前中止：清 unit + 弹回快照 |
| `move(run, dest)` | **只执行 user step**（校验 → `_take` → `_place` → 音效），级联由调用方经 `stepUnit` 消费 |
| `collectDragons(color)` | 校验 + 开 `dragon` unit（`beginUnit`）；实际收龙步骤经 `stepUnit` 逐条消费 |
| `applyAutoMoves()` | 无动画同步收敛（boot / restore / hint leading 镜像），最多 1000 次防死循环 |
| `undo()` | 回退到最近快照（= 整个 unit） |
| `newGame()` | 重置状态 + 关闭任何遗留 unit（新棋盘使旧 unit 作废，防快照复用） |
| `canUndo()` / `dragonReady()` | 查询 |

**收龙步骤顺序（关键）**：空闲格中的同色龙**先收**（腾出空位），列顶龙**最后收**——保证新建龙堆总有落脚处。若列顶龙先收而 3 个空闲格全被同色龙占着，`pushDragon` 会写入 `freeCells[-1]` 幽灵索引，那条龙无声消失（回归测试见 `engine.test.ts`）。

**Unit 快照语义**：undo 快照在 `beginUnit` 时拍**一次**，unit 内所有步共享——中途刷新页面则整个 unit 回滚（持久化也只发生在 `endUnit` 后一次）。

### 3.6 `src/components/` — 渲染层（Vue 组件）

**职责**：由 `App.vue` 按 `state` 声明式渲染整块棋盘，无手动 DOM 操作。

- `Card.vue`：单张牌（数字 / 龙 / 花），`data-id` 绑定；**无 motion-v**——位置动画全部走 FLIP inline transform（见 3.7）
- `CardBack.vue`：扑克牌背 `<img src="/images/card-back.svg">`（锁定龙堆翻面 + 胜利卡共享同一文件；`img` 引用规避 SVG 内部 pattern/filter id 跨实例冲突）
- `WinCard.vue`：胜利翻转卡（详见 §6.3）
- `Toaster.vue`：reka-ui Toast 挂载点（`lib/toaster.ts` 命令式驱动）
- `GlyphIcon.vue`：lucide-vue-next 单色图标（hint / hourglass / sound / muted）

**牌 DOM 结构**（`Card.vue`）：

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

**终局槽渲染**：`v-for` 渲染全部已收牌（FLIP 目标取槽 rect 中心），由 `foundations[color].length` 驱动。

**龙牌字样颜色映射**：`red → 中`、`black → 萬`、`green → 發`（雀牌字样），赋给 `.glyph-small`；不匹配的颜色 fallback 为 `龍`。

**锁定龙牌格渲染**：真实渲染全部 4 张同色龙牌（叠放于格原点，供收龙飞行动画取活元素），并在格子上加 `locked` + `c-{color}` 类以着色；堆集齐后三层 3D 结构（`.flip-scene` 透视根 600px → `.flip-tilt` 动画壳 → `.flip-card` 双面）整体 `rotateY(180°)` 翻面，呈现**单张扑克牌背面**（`CardBack.vue` → `<img src="/images/card-back.svg">`，蓝底圆环纹 + 花环边框 + 中央徽章，与胜利卡共享同一文件——一副牌一套牌背；SVG 白色纸面铺满 viewBox（`0,0,300,420`）无透明边缘，`.face.back` 纸色背景 + 卡片圆角兜底，`img` 100% 原样显示 = 与正常牌完全同尺寸 96×136）——翻面由数据驱动（`cards.length === DRAGON_COUNT_PER_COLOR`），飞行期间保持正面、落地后经 `0.4s` 延迟才翻转（等最后一张龙牌落地，`transition-delay` 与动画 `animation-delay` 同步）。**三阶段封存动画**（`flip-seal-tilt` keyframes：`scale(1) → scale(1.08)+rotateX(6°) → scale(1.08)+rotateX(10°) → scale(1.08)+rotateX(6°) → scale(1)+rotateX(0)`——**抬起(放大) → 翻转(保持放大) → 放下(回 settled size)**，0.8s）由 App.vue 的 `watch` 在堆变满瞬间触发（`playing` 类，`animationend` 清除）——boot 静态恢复的堆不播动画，直接定格背面。**sealed 边框**：堆满翻面后槽加 `sealed` 类，`.slot.locked.sealed` 隐藏彩色边框与内阴影（`border-color: transparent; box-shadow: none`）——翻面牌与正常牌（无边框）视觉一致；飞行中（未满）边框保留作目标指示。**iOS 13 兜底**：`.flip-card.flipped .face.front` 在 1.2s（0.4 delay + 0.8s 翻转）后强制 `visibility: hidden`（backface-visibility 在 Safari 扁平化 3D 下可能失效，兜底保证最终必显背面）。锁定堆不再显示锁图标。

### 3.7 `src/composables/animateAutoMoves.ts` — FLIP 动画

**职责**：为单张牌提供 FLIP（First–Last–Invert–Play）位移动画，并向拖拽控制器 / unit 执行器提供统一常量。它是"丝滑"视觉体验的核心。

**为什么需要它**：引擎逐步提交 + `publish()` 后，牌瞬间"跳"到新位置。FLIP 在 `publish` 前用 `getBoundingClientRect()` 记录旧矩形（牌还在旧渲染位），渲染到位后把牌反向位移回旧位置（无动画），再在下一帧用 CSS transform 缓动归位。

| 导出 | 说明 |
| --- | --- |
| `FLIP_SETTLE_MS` (250) | 拖拽落子"落地"tween 时长；**同时**是 `moveCard` 启动 `consumeUnit` 的延迟（单一真源） |
| `FLY_MS` (320) / `STAGGER_MS` (200) | 单飞总时长 / 级联相邻起飞发车间隔 |
| `IN_FLIGHT_Z` (9000) | 飞行中临时 z-index（落地立即清空） |
| `flyCardTo(el, fromRect, targetEl)` | FLIP 到目标槽**中心**（级联 / 收龙用） |
| `flyCardHome(el, fromRect)` | FLIP 到**自身当前渲染位**（hint 路径的 run 飞行用） |

**调用点**：`consumeUnit`（级联 / 收龙 / 发牌 settle）逐步调用 `flyCardTo`；`moveCardAnimated`（hint）对 run 内每张牌调 `flyCardHome`；`useDragController` 取 `FLIP_SETTLE_MS` 做落子归位滑动。**节流**：动画结束后 `FLY_MS + 60ms` 清除 inline 的 `transition`/`transform`/`zIndex`，避免残留影响下一轮 FLIP 测量。

---

### 3.8 `src/composables/useDragController.ts` — 拖拽交互

**职责**：将 pointer 事件转换为游戏操作（真牌跟随，无克隆 ghost）。

**DragController 工作流**：

```text
pointerdown → 定位牌 → 提取 run → 计算合法目标（busy/justDealt 时拒绝）
pointermove → 真牌加 translate(dx,dy) 跟随 → slotAtPoint 几何命中 → 高亮合法目标
pointerup   → 若命中合法 → game.moveCard(run, dest)（成功则 250ms 归位滑动）
             → 否则 → 回弹还原，播放错误音效
```

**真牌跟随**：拖拽时把 REAL 牌直接加 `translate(dx, dy)` 内联变换（`transition: none`，逐帧即时）；`is-dragging` 类做 z-index 抬升 + `will-change: transform` 独立合成层。原始卡片添加 `is-dragging` 类使其半透明。

**目标检测**：落点候选点 = 被拖 run **头牌的几何中心**（pointerdown 时 rect 中心 + 位移 (dx,dy)，纯算术零 reflow），**而非指针位置**——角点抓牌时高亮跟随牌的视觉位置而非手指，松开落点也按牌心提交。`slotAtPoint()` 遍历 `[data-slot]` 用 `getBoundingClientRect()` 做手动几何命中（**不用** `elementFromPoint`，避免页面缩放 / 祖先 transform 下的坐标漂移，见 memories/drag-hit-test-zoom.md）。拖动中**禁止滚动**（wheel preventDefault + 拖动牌 `touch-action: none`）；漏网的 scroll（键盘/程序化）会同时刷新槽矩形并重锚头牌中心。

### 3.9 `src/composables/useAudio.ts` — 音效系统

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

### 3.10 `src/storage.ts` — 持久化

**职责**：封装 `localStorage` 读写。

**存储键**：

| 键 | 内容 | 格式 |
| --- | --- | --- |
| `szsol.wins` | 累计胜局数 | 整数字符串 |
| `szsol.achievements` | 成就解锁状态 | JSON `{ climb: true, ... }` |
| `szsol.muted` | 静音状态 | `'0'` / `'1'` |
| `szsol.save` | 当前棋局存档 | JSON（snapshotClone 格式） |

**存档策略**：**每 unit 持久化一次**（`consumeUnit` 的 `finally`，或 `afterChange` 路径）——unit 原子性：中途刷新页面回滚到 unit 之前的状态。页面刷新后自动恢复，实现断点续玩。存档仅保存棋盘状态（不含 history），撤销栈不持久化。

### 3.11 `src/game/achievements.ts` + `src/composables/useAchievements.ts` — 成就系统

**职责**：检查胜局数是否达到里程碑，解锁新成就并弹 toast。

```ts
checkAchievements(wins, onUnlock) → 对比阈值 → 解锁新成就 → 回调通知
useAchievements(wins) → 监听胜局数变化 → checkAchievements → toast({title: a.name})
```

> **现状**：已接入 UI——`useAchievements` watch 胜局计数，新成就经 `lib/toaster.ts` 弹 toast（可堆叠、3.2s 自动消失）；`unlockedMap` / `unlockedCount` 驱动成就面板。

### 3.12 `src/main.ts` + `src/App.vue` — 入口

**职责**：`main.ts` 仅创建 Vue 应用挂载 `#root`；`App.vue` 组装所有 composable（`useSolitaireGame` / `useHint` / `useDealing` / `useDragController` / `useAudio` / `useAchievements` / `useFullscreen`），绑定工具栏按钮与 reka-ui Dialog（新局确认），渲染棋盘、锁定龙堆与 WinCard。

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

**收集动画（action-unit executor，见 `useSolitaireGame.consumeUnit`）**：引擎按 `stepUnit()` 逐条生成龙牌步骤，动画层对每条龙做单卡 FLIP（320ms 飞行 / 200ms 起飞间隔）。起飞顺序与引擎 `collectDragons()` 一致：**空闲格龙先飞、列顶龙最后飞**——空闲格龙被收后腾出空位，保证新建龙堆总有家（若列顶龙先收、而 3 个空闲格全被同色龙占着，`pushDragon` 会写入 `freeCells[-1]` 幽灵索引，那条龙会无声消失，回归测试见 `engine.test.ts`）。落地后 commit，龙堆在锁定格无缝出现。

### 5.5 胜利判定 (`isWin`)

```text
all foundations[color].length == 9  // 所有终局槽满
  && flowerSlot != null              // 花牌已归位
  && dragonsOnBoard(state) == 0      // 无残余龙牌
```

### 5.6 撤销 / 重做

- 仅支持撤销（Undo），不支持重做（Redo）
- **以 unit 为单位**：`beginUnit` 时调用 `snapshot(state)` 深拷贝当前状态推入栈（一次覆盖整个 unit：user step + 全部级联 / 整次收龙）；hint 路径的 leading 收敛与 user step 共享同一快照——一次撤销撤回整个提示动作
- 撤销时 `restoreSnapshot(state)` 弹出栈顶并覆盖当前状态；成功时引擎同时闭合任何遗留的打开 unit（防下一次 `beginUnit` 复用旧快照）
- history 栈上限 300，超出时 shift 最旧记录

---

## 6. 渲染与交互

### 6.1 渲染策略

- **声明式渲染**：`App.vue` 按 `state.value`（shallowRef）渲染整块棋盘；引擎原地修改后由 `publish()`（浅拷贝顶层对象重赋值）触发重渲染
- **DOM 键控**：牌元素以 `data-id` 为 key，Vue 复用/移动节点；FLIP 动画在 `publish` 前后分别取 rect
- **性能考量**：40 张牌 + 固定 slot 数量，重渲染毫秒级完成

### 6.2 拖拽系统

- **真牌跟随（无 ghost 克隆）**：拖拽时把 REAL 牌直接加 `translate(dx, dy)` 内联变换（`transition: none`，逐帧即时）——`is-dragging` 类只做 z-index 抬升 + `will-change: transform` 独立合成层
- **目标检测**：落点候选点 = 头牌几何中心（抓取时锚点 + (dx,dy)，纯算术），**非指针位置**；`slotAtPoint()` 手动几何命中（**不用** `elementFromPoint`，见 memories/drag-hit-test-zoom.md）；拖动中禁止滚动（wheel preventDefault + `touch-action: none`）
- **合法释放**：`moveCard` 校验 + 开 unit + 提交（引擎只做 user step）；commit 后牌保持释放点（parked transform），Vue 将其渲染到目标槽位后，用一条 `FLIP_SETTLE_MS`（250ms）`cubic-bezier(0.2,0.8,0.2,1)` CSS transition 从释放点滑到最终位置（归位滑动）；有级联时 250ms 后由 `consumeUnit` 接管逐张飞行，无级联时不设 busy 锁（允许快速连招）
- **非法释放**：先强制 recalc 提交 parked transform，再过渡回原位（250ms 同曲线）+ `error` 音效
- **高亮反馈**：合法目标添加 `drop-ok` 类（绿色边框发光），非法目标无反馈

### 6.3 视觉设计

- **配色**：深色玉纹背景（`#0d2b1a`），金色装饰，配合复古终端风格
- **字体**：等宽字体（DejaVu Sans Mono / Consolas / Menlo），呼应终端美学
- **牌面**：圆角卡片，数字牌显示数字，龙牌显示「龙」字，花牌显示 ✿
- **响应式**：CSS Grid + Flexbox，适配桌面和移动端

**胜利展示**（`WinCard.vue`，无遮罩弹窗，直接浮在空 tableau 区域中央，纯 keyframes，无 `@property` / 渐变 `var()`，iOS 13 安全）：

- **3D 翻转卡**（`WinCard.vue` 内联结构，替换原 🃏 emoji）：`.win-scene`（perspective 根，**600px**）→ `.win-card`（`transform-style:preserve-3d`，`rotateY` 翻转）→ 双面 `.face`（`backface-visibility:hidden`）
  - **背面** `.face.back`（`rotateY(180deg)`）：共享扑克牌背 `<img src="/images/card-back.svg">`（与锁定龙牌堆同一文件，蓝底圆环纹 + 花环边框 + 中央徽章，`object-fit:contain`）
  - **正面** `.face.front`（`rotateY(0)`）：`/images/2.gif`（原生 200×150 横向 4:3 动图）`object-fit:contain` + **`padding:10%` + `box-sizing:border-box`**（gif 与纸面边缘留出 ~10% 宽的 margin，随响应式缩放），纸色米白底（`#efe9d8`）+ 金描边
  - 尺寸：桌面 `var(--win-card-w/h,140/165)`（比例≈0.85），`max-width:560px` 缩到 108×127
- `win-breathe` **2.8s `drop-shadow` 呼吸**挂在 `.win-emblem` 外层包装——`text-shadow` 对 `<img>` 无效（原 🃏 emoji 用 text-shadow，已废），故胜利发光改用 `filter: drop-shadow` 金光（0.35/10px ↔ 0.95/22px）
- 入场 **0.55s 外层缩放回弹 + 1.1s 翻转**：外层 `win-enter-scale`（`scale 0→1`，回弹 `cubic-bezier(0.34,1.56,0.64,1)` 承载呼吸）+ `.win-card` 跑 `win-coin-spin`（`rotateY 180°→720°` 并叠加 **`rotateX ±5°` 俯仰摆动**——像被抛起的硬币晃动，`cubic-bezier(0.22,1,0.36,1)`）——始露背面、落正面，途中 360°/540° 正反交替；一个元素无法对同一 transform 挂两条缓动（`@property` iOS 13 不可用），故拆两层 DOM
- 按钮「再来一局」沿用 `.overlay-card button` 视觉（金底黑字），入场完成后 **0.2s 淡入**（`win-btn-in`，delay 0.55s + `both` 填充）
- 点击按钮 → **1.0s 加速翻飞 + 线性缩小**：`.win-card` 跑 `win-exit-coin`（`rotateY` 分段加速 `720°→2520°`）+ `.win-emblem` 跑 `win-exit-scale` 全程线性 `1→0` → 动画结束后 `game.newGame()` 进入发牌阶段；`onUnmounted` 清退出 timer，防 undo/新局竞态重复发牌
- `prefers-reduced-motion`：`win-coin-spin` 保留（翻转即胜利揭示，产品决策），仅 transient UI（dialog/toast）跳过动画；龙牌堆俯仰同样保留（翻面即收龙封存揭示）

### 6.4 z-index 分层设计

所有层级分两**带**：**牌动画带**（5000~9000，由 composables 以 inline style 动态设置）与**固定浮层带**（10000+，静态 CSS）。两带之间刻意留出 1000 的间隙，保证**浮层永远盖住飞行中的牌**。

| z-index | 用途 | 归属 | 设置位置 |
| --- | --- | --- | --- |
| `auto` | 棋盘 / 牌面的自然层叠（列内按 DOM 序） | 静态 | CSS 默认 |
| `5000~` | 发牌动画 snap 等待期（后发的叠上层） | 动态 | `useDealing.ts` |
| `9000` | 飞行中的牌（级联 / 收龙 / 发牌 / 拖拽 `.is-dragging`）——`IN_FLIGHT_Z` 单一值，落地立即清空 | 动态 | `animateAutoMoves.ts` / `useDealing.ts` / `index.css` |
| `10000` | `.overlay` 全屏遮罩（新局确认） | 静态 | `index.css` |
| `10050` | `.win-stage` 胜利翻转卡展示（tableau 区域锚定，`pointer-events:none` + 按钮 auto） | 静态 | `index.css` |
| `10100` | `.overlay.newgame-overlay` 新局确认（防御：须在确认弹窗之上） | 静态 | `index.css` |
| `10110` | `.dialog-content` 确认弹窗内容（reka-ui portal 兄弟节点） | 静态 | `index.css` |
| `10200` | `.toasts` 成就提示（`pointer-events: none`） | 静态 | `index.css` |

#### 核心原则

1. **只在飞行瞬间抬升、落地清除**：z-index 在 `flip()` 内设置（`IN_FLIGHT_Z`），落地用 `setTimeout` 清回 `''`（auto）。等待起飞的牌保持自然层叠，否则会干扰列内叠放（曾出现"等待牌一次性抬升 → 列内层级反转"的 bug）。
2. **级联单飞单落**：`consumeUnit` 一次只让一张牌在空中（320ms 飞行 / 200ms 交错 = 相邻两张短暂重叠），`IN_FLIGHT_Z` 统一高于所有静止牌，后起飞的天然盖住先起飞的（追尾效果合理）。
3. **浮层带永远最高**：胜利 WinCard 的显示时机保证所有牌已落地（`flushWinIfIdle` 在 `busy` 释放后），但 z 仍取浮层带值（10050），防御任何残留飞行牌/后发动画盖住它。
4. **弹窗互不叠加**：胜利展示不再有全屏 overlay，`askNewGame()` 在 `won` 时直接 `newGame()`（跳过确认弹窗）的行为层兜底保留，杜绝确认弹窗与胜利 UI 同时出现。

#### 胜利展示的时机（飞牌动画完成后显示）

引擎 `onWin` 回调会**先记胜局数**（`wins` +1 并持久化），但 `won`（WinCard 开关）的置位由 `flushWinIfIdle()` 统一控制：

- **普通移动触发胜利**（最后一张牌手动放上终局）：无飞行单位在跑 → 移动路径直接调用 `flushWinIfIdle()`，`won` 立即置位，WinCard 马上出现
- **收牌动画途中触发胜利**（最后一张数字牌自动收向终局即是胜利）：`busy === true` → 只置 `pendingWin` 不置 `won`；`consumeUnit` 的 `finally` 中所有牌落地后才调用 `flushWinIfIdle()` 释放 `won`——保证翻转卡 不会在飞行中的牌上方弹出

相关状态：`pendingWin`（`useSolitaireGame.ts` 模块级私有标志）。`newGame()` 清 `won`/`pendingWin`；`undo()` 成功时也清 `won`（棋盘撤回非胜利态 → WinCard 卸载）。胜利音效不延迟（`onSound('win')` 随引擎立即播放）。WinCard 存活期间棋盘**无遮罩、可交互**（终局槽牌不可拖，可点撤销或 toolbar 新局直接重开）。

#### 自动收牌动画的节奏（所有场景统一）

所有"牌自动飞向终局/花槽/龙堆"的动画共用同一套慢节奏——**320ms 飞行 + 200ms 起飞间隔，一次一张**，统一由 **`consumeUnit` 执行器**驱动（`FLY_MS` / `STAGGER_MS`，`animateAutoMoves.ts`）：

| 触发场景 | 实现位置 | 说明 |
| --- | --- | --- |
| 收龙（🐉 收按钮） | `useSolitaireGame.consumeUnit`（dragon unit） | 空闲格龙先飞、列顶龙后飞，随后进入级联 |
| 发牌后的自动归位 | `useDealing.ts` `settleAfterDeal` → `consumeUnit` | 与发牌动画本体（45ms 快节奏）区分 |
| 移动一张牌后的级联收牌 | `useSolitaireGame.moveCard` → `consumeUnit` | 玩家拖牌 commit 后 250ms settle，再由执行器逐张飞 |
| 提示路径的 run 飞行 | `moveCardAnimated`（`flyCardHome`） | run 逐张 FLIP 到目标列后进入同一执行器 |

**移动后级联收牌的实现**：`moveCard` 先 `beginUnit('move')`（拍 undo 快照）→ `engine.move` 只执行 user step → `publish()` 渲染落子 → 若有级联则 `busy = true`，`FLIP_SETTLE_MS` 后启动 `consumeUnit`：循环 `stepUnit()`（引擎逐步生成并应用），每步 `publish → nextTick → flyCardTo` 单卡 FLIP（320ms 飞行 / 200ms 交错），落地后 `endUnit`（判胜）+ 持久化一次 + 释放 `busy`。玩家移动的那张牌由拖拽控制器做 250ms 归位滑动（CSS transition 从释放点滑到最终位置），不参与级联飞行。

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
| 棋局存档 | **每 unit 一次**（`consumeUnit` finally / `afterChange`） | 完整棋盘（不含 history） |
| 胜局计数 | 每次胜利（`onWin`） | 累计整数 |
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
├── index.html              # 单页 HTML（preload 胜利 gif）
├── src/
│   ├── main.ts             # 入口：创建 Vue 应用
│   ├── App.vue             # 组装 composable + 渲染棋盘 / 工具栏 / Dialog / WinCard
│   ├── index.css           # 全部样式（CSS Variables + Flexbox + Grid + Tailwind 指令）
│   ├── game/
│   │   ├── engine.ts       # SolitaireEngine：状态变更唯一入口 + unit 生命周期
│   │   ├── rules.ts        # 纯规则函数（无副作用）
│   │   ├── state.ts        # 牌组 / 洗牌 / 发牌 / 快照 / 撤销
│   │   ├── types.ts        # Card / DestDescriptor / MoveResult 等类型
│   │   ├── constants.ts    # 全局常量 + 成就定义
│   │   ├── solverAdapter.ts# GameState ↔ SolverState 适配
│   │   └── achievements.ts # 成就检测
│   ├── composables/
│   │   ├── useSolitaireGame.ts   # 控制器 + consumeUnit 执行器 + busy 锁
│   │   ├── useDealing.ts         # 发牌飞入动画 + settle
│   │   ├── useDragController.ts  # 拖拽交互（真牌跟随 + slotAtPoint）
│   │   ├── useHint.ts            # 提示（worker 求解 + 缓存 + 逐步执行）
│   │   ├── useAudio.ts           # Web Audio 合成音效
│   │   └── useAchievements.ts    # 成就 UI 桥接（toast）
│   ├── components/
│   │   ├── Card.vue / CardBack.vue / WinCard.vue
│   │   └── Toaster.vue / GlyphIcon.vue
│   ├── lib/toaster.ts    # reka-ui toast 命令式封装
│   └── worker/solver.worker.ts   # 求解器 worker（压缩失败时 raw 兜底）
├── tools/solver/         # 求解器（rules.js / solver.js / compress.js，node 脚本）
├── docs/
│   ├── rules.md          # 游戏规则文档
│   ├── design.md         # 本文件
│   ├── glossary.md       # 术语表（与代码对齐）
│   └── solver.md         # 求解器文档
└── src/game/engine.test.ts   # vitest 引擎单测（unit 顺序模型）
```

---

## 10. 测试

### 单元测试

`vitest`（`vitest.config.ts` 注册 `@solitaire` alias，`environment: 'node'`）。引擎单测位于 `src/game/engine.test.ts`——**钉死 unit 顺序模型**（`beginUnit → stepUnit* → endUnit` 的精确出步顺序）：

**已覆盖**：

- move unit：user step 不在序列中；花牌先飞、数字按 rank 升序
- 跨列同 rank 按列号顺序（非按色分组）
- 同列级联收敛，在首个不安全牌处停止
- `stepUnit` 在无 unit / endUnit 后返回 null；`abortUnit` 弹快照
- 最后一张自动收触发 `onWin` 恰好一次（`_winAwarded` 防重复）
- dragon unit：空闲格龙先收、列顶龙后收、随后级联
- **全空闲格被同色龙占满时收列顶龙**（幽灵索引 `freeCells[-1]` 回归）
- 龙未全暴露时收龙被拒

### 集成测试

- 完整游戏流程：发牌 → 移动 → 收龙 → 胜利（Playwright 冒烟脚本见 `temp/`）
- 撤销多步后状态一致性
- 存档/读档往返一致性

---

## 11. 设计决策记录

| 决策 | 理由 |
| --- | --- |
| Vue 3 组合式 API + Vite 8 | 声明式渲染 + HMR；`plugin-legacy` 产出 modern + nomodule 双包，兼容 iOS 13 |
| 引擎与 UI 解耦（SolitaireEngine 同步 API） | 状态变更单一入口，规则可独立单测；动画层（composable）消费引擎步骤 |
| Action-unit 模型（beginUnit → stepUnit* → endUnit） | 引擎逐步"生成并应用"，动画逐步消费——数据与画面锁步，undo/持久化以 unit 原子化 |
| 纯函数规则模块（rules.ts） | 便于测试、推理、复用 |
| 引擎原地修改 + shallowRef publish | 避免深响应开销；每次 publish 新顶层对象触发重渲染 |
| 快照撤销（非命令模式） | 实现简单，状态不可变保证正确性；一 unit 一快照 |
| FLIP 动画（无 motion-v） | 单卡 rect 差值 + CSS transform，可控性强且避免与手动飞行抢 transform 通道 |
| Web Audio 合成音效 | 无需外部资源文件，chip 风格契合游戏主题 |
| reka-ui Dialog / Toast | 焦点陷阱 + aria 默认齐全；`data-state` CSS 动画，iOS 13 安全 |
| busy 锁 + 15s watchdog | 防止 unit 消费异常滞留；watchdog 强制释放兜底 |
