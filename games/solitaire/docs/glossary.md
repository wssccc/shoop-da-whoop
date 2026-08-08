# 纸牌接龙 · 术语表（Glossary）

本表汇总代码、文档、提交记录里反复出现的术语，按主题分组。每条给出**中英对照**、
**一句话定义**、以及**在源码中的典型出处**（文件:行 或 标识符），便于实现/讨论时对齐。

> 相关文档：
>
> - 规则玩法：[`rules.md`](./rules.md)
> - 技术设计：[`design.md`](./design.md)
> - 求解器：[`solver.md`](./solver.md)

---

## 1. 棋盘结构（Board Layout）

| 术语 | 中文 | 含义 | 出处 |
| --- | --- | --- | --- |
| **tableau** | 牌列 / 主牌区 | 8 列摊开的牌区，主战场。每列是数组，`col[col.length - 1]` 为栈顶（画面里最下方、可抓取的那张） | `state.tableau` |
| **freecell / free cell** | 空闲格 | 单张暂存位，空时能放任意一张牌；也会被"已收齐的龙牌堆"占用 | `state.freeCells` |
| **foundation** | 花色堆 | 三色（`red` / `black` / `green`）按 1→9 升序收齐的终点堆 | `state.foundations` |
| **flower slot** | 花牌槽 | 单格，放唯一的那张花牌 | `state.flowerSlot` |
| **dragon pile** | 龙牌堆 | 同色四条龙集齐被"收龙"后锁进某空闲格的产物，`locked: true`，无法再被取走 | `freeCells[].type === 'dragonpile'` |
| **exposed (card)** | 暴露牌 | 列顶 + 空闲格（非龙堆）里的牌；自动收牌的候选池 | `Rules.nextAutoMove` |
| **zone** | 区域枚举 | 标识一张牌所在的位置类型：`tableau` / `freecell` | `Rules.findCard` |
| **DestDescriptor** | 目的描述 | 合法落点的统一表达：`{ type: 'column' \| 'freecell' \| 'foundation' \| 'flower', ... }` | `src/game/types.ts` |

---

## 2. 走子与引擎动作（Engine / Moves）

| 术语 | 中文 | 含义 | 出处 |
| --- | --- | --- | --- |
| **user step** | 玩家一步 | 玩家主动的走子（拖拽落子 / 提示执行 / 收龙开端）。**一个 unit 只允许一个 user step** | `engine.move` |
| **auto-move** | 自动收牌 | user step 之后引擎自检为"安全"并自动收上 foundation / 花槽的牌 | `Rules.nextAutoMove` |
| **cascade** | 自动收牌级联 | user step 之后**逐张**自动收牌的连续动作串。auto-move 一格一格串起来即 cascade | `consumeUnit` + `engine.stepUnit` 循环 |
| **unit / action unit** | 动作单元 | **一次完整的玩家动作 = 1 user step + 0~N cascade 步**，原子化打包：共享一个 undo 快照、settle 后统一判胜 + 持久化一次 | `engine.beginUnit` … `engine.endUnit` |
| **beginUnit** | 开 unit | 拍 undo 快照，登记 unit 类型（`move` 或 `dragon`） | `engine.beginUnit` |
| **stepUnit** | 推进一步 | 生成并应用 unit 的**下一格**（先收龙步骤，再 auto-move 级联）；返回 `null` 表示 unit 跑完 | `engine.stepUnit` |
| **endUnit** | 结束 unit | 收尾：`checkWin` + 让调用方持久化 | `engine.endUnit` |
| **abortUnit** | 中止 unit | unit 在没有任何步子被应用前撤销，弹回 undo 快照 | `engine.abortUnit` |
| **routeAutoMove** | 路由自动牌 | 引擎内：把一张 auto-move 候选牌真正搬到目标位 + 触发音效 | `engine.routeAutoMove` |
| **collectDragons** | 收龙 | 同色四龙全暴露时，玩家一次性把四条龙收成并锁进空闲格。本身也是 unit（`kind: 'dragon'`） | `engine.collectDragons` |
| **isValidRun** | 合法 run | tableau 里能否把一段连续牌当作整体抓起（颜色/点数连续合法） | `Rules.isValidRun` |
| **isSafeNumber** | 安全点数 | 这张点数牌**现在**入 foundation 不会后悔（同胞前 N-1 已齐 + 另两色 foundation 也够高），才会被 auto-move 选走 | `Rules.isSafeNumber` |
| **validDropTargets** | 合法落点集 | 给一段 run，列出当前棋盘所有合法落点；拖拽高亮与 `engine.move` 验证共用 | `Rules.validDropTargets` |
| **sameDest** | 目的等价 | 两个 DestDescriptor 是否描述同一落点 | `Rules.sameDest` |

---

## 3. 求解器与提示（Solver / Hint）

| 术语 | 中文 | 含义 | 出处 |
| --- | --- | --- | --- |
| **solver** | 求解器 | 在 worker 内穷举搜索整个棋局的最优解路径 | `tools/solver/`、`src/worker/solver.worker.ts` |
| **SolverState** | 求解器状态 | solver 用的**位置型**棋局表示，**无 card id**，只有行列与花色/点数 | `src/game/solverAdapter.ts` |
| **SolverCard** | 求解器牌 | solver 内的牌对象，只有 `type/color/rank`，不带 id | `solverAdapter.ts` |
| **SolverUserStep** | 求解器用户步 | solver 输出的一手：`{ kind: 'move' }` 或 `{ kind: 'collect' }`，**位置型**而非 id 型 | `solverAdapter.ts` |
| **SolverStepRecord** | 求解器步记录 | `{ user, auto }` —— 一手 user action + 它触发的 forced auto cascade；前端只串接 `user !== null` 的记录 | `solverAdapter.ts` |
| **toSolverState** | 状态适配 | 游戏 `GameState`（带 id） → solver `SolverState`（无 id） | `solverAdapter.ts` |
| **stateKey / canonicalization** | 状态规范化键 | 对 `SolverState` 做规范化后得到的稳定字符串，用作 hint 缓存的 key | `tools/solver/rules.js` 的 `stateKey` |
| **compress** | 解法压缩 | solver 的原始路径经重写去环、合并绕路、删可逆对，输出最短/最干净的"用户可见步序列" | `tools/solver/compress.js` |
| **hint cache** | 提示缓存 | `Map<stateKey, { steps, pos }>`，LRU（≤10 条）。命中时连点不重算，未命中才唤醒 worker | `src/composables/useHint.ts` |

---

## 4. 动画与时序（Animation / Timing）

| 术语 | 中文 | 含义 | 出处 |
| --- | --- | --- | --- |
| **FLIP** | FLIP 技术 | 前端动画套路：**F**irst（记旧 rect）→ **L**ast（渲染到新位）→ **I**nvert（用 transform 假装拽回旧位）→ **P**lay（清 transform，加 transition 飞回去） | `animateAutoMoves.ts` 的 `flip` |
| **flyCardTo** | 飞向目标槽 | 把一张牌 FLIP **到指定目标槽的中心** rect。级联（cascade）用这条 | `animateAutoMoves.flyCardTo` |
| **flyCardHome** | 飞回自己位 | 把一张牌 FLIP **到它自己当前渲染位**（常用于 tableau 内整 run 移动，目标不是槽中心而是堆叠点）。提示路径（`moveCardAnimated`）用这条 | `animateAutoMoves.flyCardHome` |
| **FLIP_SETTLE_MS** | 落地 tween 时长（250ms，单一真源） | 拖拽落子后那张牌"落地"tween 的时长。**同时**也是拖拽走子后启动 `consumeUnit` 的延迟，避免新飞的牌与落地 settle 抢同一 transform 通道 | `animateAutoMoves.ts` |
| **FLY_MS** | 单飞总时长（320ms） | 任意飞行 tween 的总时长 | `animateAutoMoves.ts` |
| **STAGGER_MS** | 起飞间隔（200ms） | 级联里相邻两张起飞的发车间隔，让多张同时在天上 | `animateAutoMoves.ts` |
| **IN_FLIGHT_Z** | 飞行 z-index（9000） | 飞行中临时 z-index，高于整块棋盘，低于遮罩；落地立即清空 | `animateAutoMoves.ts` |
| **settle / 落定** | 落定 | 动画全部跑完、`busy` 翻回 `false` 的那个时间点。hint cache 重 key、win 弹窗都等它 | `consumeUnit` 的 finally |

---

## 5. 锁与状态（Locks / Reactivity）

| 术语 | 中文 | 含义 | 出处 |
| --- | --- | --- | --- |
| **busy** | 忙碌锁 | unit 在消费期间（cascade/收龙在飞、发牌后收尾）为 `true`，期间拖拽 / undo / hint 全部拒绝输入 | `useSolitaireGame.busy` |
| **justDealt** | 刚发牌 | 新局刚发牌、正在播 fly-in 动画期间为 `true`；动画完触发 post-deal settle（也是一个 unit） | `useSolitaireGame.justDealt` |
| **pendingWin** | 待弹胜场 | unit 消费**过程中**引擎判出赢了，但不立即弹窗，先挂这个 flag；`busy=false` 后由 `flushWinIfIdle` 弹出 | `useSolitaireGame.pendingWin` |
| **consumeCanceled** | 取消消费 | `newGame()` 在 unit 半路被打断时置位，让正在跑的 `consumeUnit` 跳过 `endUnit`/持久化（牌盘都换掉了，再 settle 就是脏数据） | `useSolitaireGame.consumeCanceled` |
| **consumePromise** | 消费 promise | `consumeUnit` 的重入保护：同一时刻只允许一个消费循环，后到的调用自动 await 同一个 promise | `useSolitaireGame.consumePromise` |
| **publish()** | 重发布 | `state.value = { ...engine.getState() }` 浅拷贝再赋值，强制 shallowRef 触发重渲染（因为引擎是原地改） | `useSolitaireGame.publish` |
| **persist()** | 持久化 | 写入 `localStorage`。unit 只 persist 一次，中途刷新会回滚到 unit 之前 | `useSolitaireGame.persist` |
| **afterChange()** | 变更钩子 | `publish() + persist()` 的组合，boot/restore/undo 等"立即合成"路径用 | `useSolitaireGame.afterChange` |
| **shallowRef** | 浅响应 ref | Vue 仅对顶层引用变化敏感的 ref；配合"引擎原地改 + 每次 publish 新对象"使用 | `useSolitaireGame` |
| **nextTick** | 下一渲染帧 | Vue 下一帧。`consumeUnit` 每步 `publish()` 后 await 一次，确保 DOM 已把牌渲染进目标槽，再读新 rect 做 FLIP | `consumeUnit` 内 `await nextTick()` |

---

## 6. 易混对照（Disambiguation）

| 对照 | 区别 |
| --- | --- |
| **user step** vs **cascade** | user step = 玩家手点的那一步；cascade = 引擎自带的连锁收牌。两者合起来就是一个 **unit**。 |
| **flyCardTo** vs **flyCardHome** | `to` = 飞去**目标槽的中心**；`home` = 飞去**自己的新渲染位**（tableau 堆叠点，非槽中心）。 |
| **FLIP_SETTLE_MS** vs **FLY_MS** vs **STAGGER_MS** | settle = 拖拽落地那张牌的 tween 时长（也是启动 cascade 的延迟）；fly = 任意飞行 tween 的总时长；stagger = 级联里多张交错起飞的发车间隔。 |
| **GameState** vs **SolverState** | GameState 带卡 id、可渲染；SolverState 无 id、位置型，做求解/缓存键用。两者经 `toSolverState` 转换。 |
| **stateKey** vs GameState | stateKey 是 SolverState 的规范化哈希串，直接当 hint cache 的 key；GameState 是完整可渲染状态。 |
| **auto-move** vs `applyAutoMoves()` | `applyAutoMoves()` 是 **boot/restore 用的无动画同步收敛**；auto-move（单步概念）→ 在 unit 里由 `stepUnit` 一张一张消费、带动画。 |
| **moveCard** vs **moveCardAnimated** | 前者拖拽路径，落子只播 settle；后者提示路径，从源槽 FLIP 飞到目标槽。两者之后的 cascade 完全一致（同走 `consumeUnit`）。 |
| **unit 'move'** vs **unit 'dragon'** | kind=`move` 的 unit = user step + 级联；kind=`dragon` 的 unit = 收龙步骤 + 随后的级联。生命周期 API 相同。 |
| **hintOnce（cache 命中）** vs **hintOnce（cache 未命中）** | 命中 → 直接 `advance` 执行下一步；未命中 → 注意 worker 求解，worker 回来后 `cachePut` 并执行第一步。 |

---

## 7. 输入与交互（Input）

| 术语 | 中文 | 含义 | 出处 |
| --- | --- | --- | --- |
| **run** | 抓取序列 | 玩家从 tableau 一次性抓起的整段连续牌（受 `isValidRun` 约束） | `Rules.grabRunFromTableau` |
| **drag controller** | 拖拽控制器 | 处理 pointer down/move/up 与落点命中、阴影 ghost 跟随、落定后调用 `moveCard` | `useDragController.ts` |
| **ghost** | 拖拽残影 | 跟随指针的卡牌浮层；用 `position: absolute` + document 坐标，pinch-zoom 下也对齐 | `useDragController` 内 `.card.ghost` |
| **slotAtPoint** | 几何落点命中 | 用 `getBoundingClientRect` 手动做几何命中，替换 `elementFromPoint`（后者在 CSS zoom/transform 下漂移） | `useDragController.slotAtPoint` |
| **shake** | 抖动反馈 | 非法落点被拒时给卡牌一个短暂的 shake 动画 | `useDragController` 内 `.shake` |
| **hint** | 提示一步 | 当前局面有解时，自动执行 solver 解的第一步（user step + 其 cascade） | `useHint.hintOnce` |
| **toast** | 浮层提示 | reka-ui 风格的瞬态消息（无解 / 求解失败 / 收龙失败等），单条 `id` 替换、自动消失 | `lib/toaster.ts` |
