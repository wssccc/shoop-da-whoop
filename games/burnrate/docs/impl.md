# Burn Rate — 架构文档

多人卡牌对战游戏（1 人类 + 1-4 AI）：让所有对手公司现金烧到破产。
本文件描述 `src/` 下的正式实现（Vue 3 + TypeScript）。玩法规则见
[`rules.md`](rules.md)。

## 技术栈

| 层 | 选择 |
| --- | --- |
| 框架 | Vue 3（Composition API + `<script setup>`） |
| 语言 | TypeScript 5.9（strict, bundler 模式） |
| 构建 | Vite 8（monorepo 多页构建，从仓库根 `npm run dev`） |
| CSS | 原生 CSS + CSS 变量，`shared/styles/reset.css` |
| 动画 | motion-v（layout FLIP）+ 手写 DOM 动画 |
| AI | random / 启发式 / IS-MCTS（classic Web Worker） |
| 测试 | Vitest（`src/game/**/*.test.ts`） |
| 兼容 | iOS 13 / Safari 13（@vitejs/plugin-legacy 双包 + classic worker） |

## 目录结构

```text
src/
├── main.ts                # 入口：createApp(App).mount('#root')
├── App.vue                # 根布局 + 全部模态框/overlay（结算、观战、选目标玩家）
├── index.css              # 全局样式
├── components/
│   ├── Card.vue           # 单卡渲染（motion-v layout FLIP、牌背模式、交互态）
│   ├── CardModal.vue      # 统一卡牌详情弹窗（手牌操作 / 场上详情 / 对手只读三合一，
│   │                      #   含坏项目自救：止损/画大饼 + 通用弃牌按钮）
│   ├── DiceRollOverlay.vue / LogModal.vue / OpponentPanel.vue / PlayerInfoPanel.vue /
│   │   ResultOverlay.vue / ThumbCard.vue
│   ├── StartScreen.vue   # 开局弹窗：主界面常驻，弹窗覆盖其上（无独立 start page）
│   │                      #   主体 = 新游戏/继续游戏；人数/强度在可展开设置面板
│   ├── ui/                # BaseButton / BaseBadge（自研最小 UI 基件）
├── composables/
│   ├── useBurnRateGame.ts # 中心编排：engine 接线、AI worker 桥、自动存档、
│   │                      #   观战模式、目标选择（含"选目标玩家"）
│   ├── useAiTurn.ts       # 任意 AI 玩家的回合逐张表演（观战加速）
│   ├── useAchievements.ts # 终局成就检测 → toast
│   ├── useDrawAnimations.ts # 发牌/抽牌飞行动画
│   └── useAudio.ts        # Web Audio 音效（iOS 挂起恢复，见下）
├── game/                  # 纯 TS 游戏逻辑（零 DOM 依赖，可单测）
│   ├── types.ts           # 判别联合卡牌模型 + GameState（纯数据，可序列化）
│   ├── constants.ts       # 牌堆构成、薪水范围、AI 等级预算、MAX_LOG、House Rules 数值
│   ├── cards.ts           # buildDeck(rng)：确定性 156 张牌堆构建
│   ├── rng.ts             # mulberry32 种子随机（可注入 → 引擎可确定化）
│   ├── shuffle.ts         # Fisher-Yates
│   ├── state.ts           # 初始 GameState 工厂
│   ├── rules.ts           # 纯规则函数（opponents/nextAlive/calcBurn/多玩家目标验证）
│   ├── engine.ts          # BurnRateEngine：多人回合循环、破产出局、回调
│   ├── achievements.ts    # 终局成就检测（15 项）
│   ├── ai.ts              # AI 适配器统一入口（工厂 + 上下文 + 完成贪婪通道）
│   ├── ai/adapter.ts      # 难度 → (random|heuristic|mcts) × 预算
│   ├── ai/random.ts       # 随机合法动作（简单难度）
│   ├── ai/heuristic.ts    # 启发式阶梯（专打最弱对手；贪心完成通道共用）
│   ├── ai/mcts/           # IS-MCTS：world 采样 / legal / eval / search / worker
│   └── bench-mass.test.ts # 4 人全启发式批量自对弈（BENCH_MASS=1 门控，10k 局基线/A-B）
├── lib/
│   ├── card-meta.ts       # 卡牌展示元数据（中文名/描述/颜色）
│   └── utils.ts           # 通用工具
├── storage.ts             # 版本化存档（format=2，旧 1v1 格式作废）
└── (测试)                 # engine/rules/cards/rng/ai/smoke/bench 的 *.test.ts
```

## 核心设计

### 数据模型（`game/types.ts`）

- **玩家**：`players` 数组，按 `PlayerId` 索引（**0 = 人类**，1..n-1 = AI 槽位）；
  `currentPlayer` / `winner` 都是索引。**开局先手由掷骰决定**（每局随机），
  轮转顺序不变——`currentPlayer` 已随存档持久化，续局无需额外字段。
- **卡牌**：判别联合类型 —— `vp` / `staff` / `project`（tech|bad|market）/ `action`，
  全部为纯可序列化数据（无函数、无 DOM）。
- **状态流转**：引擎**原地修改** `GameState`，UI 层每次变更后重新发布一个新顶层
  对象（浅展开）触发 `shallowRef` + v-for/computed 重算。
- **随机性**：`Rng = () => number` 可注入（生产用 `defaultRng`，测试用种子
  `mulberry32`），使整局可确定化、可单测。

### 引擎（`game/engine.ts`，600+ 行）

`BurnRateEngine` 是与框架无关的控制器：

- 持有 `GameState` + 注入的 `Rng` + 两个可赋值回调 `onLog` / `onGameOver`；
  无 DOM、无定时器、无 UI 类型 —— Vue 层像 solitaire 的 `SolitaireEngine` 一样接线。
- **多人回合循环**：`currentPlayer` 依次推进，破产玩家 `alive=false` 后
  `nextAlive` 跳过；最后存活者胜。
- **开局掷骰**：`rollFirst(playerCount)` 用注入 RNG 预掷——每位玩家一枚 d6，
  唯一最高者先手，并列最高者重掷（上限 10 轮防退化 RNG 死循环），返回
  `DiceRollOutcome`（winner + 全部轮次）。UI 先预掷、再演骰子动画到既定结果，
  最后 `newGame(n, { firstPlayer })` 开局；缺省 firstPlayer 时人类先手
  （兼容旧测试）。
- **需要选目标的行动**：审计 / 顾问 / 烂尾工程（选对手）、poach / resign / layoff /
  release（选卡片）、`layoffFeud` 高层内斗（选 1 VP + 1 顾问，pickCount 2）。只剩一个
  对手时部分行动自动结算（1v1 旧流程）；多对手时暂存 pending target choice 交 UI。
- **破产后继任补牌（bug 修复）**：`endTurn` 的破产分支原先跳过 `drawToSix` +
  `autoCompleteProjects`，导致继任玩家少牌开轮——已并入 `prepareNextTurn` 统一处理。
- **玩法扩展方法**：`abandonBad`（现金止损阀）、`burnoutBad`（画大饼）、
  `discardCard`（每回合 1 次免费弃牌）、`discardToCap`（手牌上限 8，人类先选弃、
  引擎按 `cardDiscardValue` 自动补弃）、`startFeudLayoff`（高层内斗：1 VP + 1 顾问
  同归于尽，无需 HR VP）。
- 每步返回 `OkResult` 与日志，供 UI 层驱动动画与持久化。

### AI（`game/ai/`）

- 目标选择改为**弱点+复仇加权采样**（`sampleFoeByWeakPoint`）：给每个对手打
  weak-point 分（cash 流失 + 板面强度 + 负债，仅公开信息）+ 复仇加成（被该对手
  攻击过的次数×0.85 指数衰减，读时懒计算），softmax(T=50) 采样。消除"全场集火
  最低现金位"的死亡螺旋，且 AI 会优先报复攻击过自己的玩家。攻击记录存于
  `PlayerState.attackers`，由 engine 在 audit/consultant/烂尾/挖角/辞职时写入。
  MCTS(hard/expert) 的 root 选择另加 λ=0.15 的复仇微调（visits×(1+λ×grudgeNorm)）。
- 启发式阶梯（按优先级）：①雇 VP ②审计最弱（现金 <50）③塞烂尾 ④顾问（70% rng）
  ⑤挖角（`validPoachTargets` 驱动：HR 挡箭牌先挖 HR VP、现金余量 $35M 门槛）
  ⑥雇员工 ⑦⑧启动市场/技术项目（无 VP 门槛）⑨坏项目自救（画大饼优先于现金止损）
  ⑩弃重复 VP（每回合 1 次免费弃牌）。
- **Fin VP 特权**：`runAiTurn` 末尾用弃牌重抽交换死卡（行动卡/重复 VP，最多 2 张）。
- 开局免攻击期（前 4 轮不出审计/烂尾/顾问/辞职）只作用于 AI，规则对人不改。
- `ai/mcts/legal.ts` 暴露 `abandonBad` / `burnoutBad`（线性贪心子集，非 2^n）、
  `discard`（重复 VP）与 poach（复用 `validPoachTargets`，含挡箭牌与费用过滤）。

### 规则（`game/rules.ts`）

纯函数，基线以 [`rules.md`](rules.md) 为准，并修正了旧原型实现的若干 bug
（见下文"历史沿革"）。要点：

- `calcBurn`：VP 薪水 + 员工薪水 + 顾问薪水 + 未完成项目运维费；审计下无
  Finance VP 时薪水部分 ×2；`burnBreakdown` 拆 salary/ops/floor/panic 四项
  （UI 烧钱构成只显示非零项，含"最低运营"与"市场恐慌"标签）。
- **House Rules 数值**（rules.md §四，全部集中在 `constants.ts`）：
  - `MIN_BURN`：每轮烧钱下限 $2M（消除 0 烧钱永生死锁）；
  - `DUEL_BURN_EXTRA`：仅剩 2 人时每轮 +$2M（尾局市场恐慌，保证有限时内结束）；
  - `BAILOUT_BASE / BAILOUT_PER_FIN_SKILL`：每人一次的紧急融资 $10M + 财务技能 ×$2M（`checkBankrupt` 中触发，`PlayerState.bailoutUsed` 记录）；
  - `HAND_CAP`：回合结束手牌上限 8（`discardToCap`，人类先显式选弃、引擎按最低价值自动补弃）；
  - `ABANDON_BAD_MULTIPLIER`：现金止损阀（`abandonBad`，付 2×烧钱废弃自己的烂尾项目）；
  - `BURNOUT_DISCOUNT_PER_FIN / FLOOR`：画大饼折扣（`burnoutBad`，每点财务技能 −10%、下限 50%，牺牲工程师与坏项目同归于尽）；
  - `VP_REWARD_BONUS`：对应 VP 完成奖励 ×1.5（Eng→技术、Sales→市场，`projectReward`）；
  - `AI_NO_ATTACK_ROUNDS`：AI 开局 4 轮免攻击（仅 AI 行为）；
  - `discardCard` / `canDiscard`：每回合 1 次免费弃牌（`PlayerState.discardedThisTurn` 在 `prepareNextTurn` 重置；AI 与 MCTS 仅对重复 VP 暴露该动作）。
- 落后补牌：`drawToSix` 中现金严格唯一最低者多补 1 张（`isStrictLowestCash`），并置 `wasStrictLowest` 供成就/遥测。
- **项目无 VP 门槛**（House Rule 8）：`canPlayCard` 对项目恒 true，`assignProjectAs`
  不再校验 VP——启动/完成都不依赖 VP；Eng VP 让技术项目烧钱减半（`projectBurnOf`，
  floor 最低 $1M，坏项目不适用），对应 VP 让完成奖励 +50%（`projectReward`）。
- 项目自动完成（引擎 `autoCompleteProjects`）：技能达标的项目在雇佣/挖角后
  及每位玩家的行动阶段开始时自动结算，无需手动点击。
- **目标合法性**：poach/resign 走"HR 挡箭牌"——对手有 HR VP 时只能作用其 HR VP，
  且挖 HR VP 后**作废**（进弃牌堆、不进入挖角方、无需部门空位，`poachCost` 费用
  员工 $1M/点、VP $4M）；`feudFeasible`/`startFeudLayoff` 提供裁员的高层内斗模式。
- VP 限制：每个部门最多 1 位 VP。

### 批量自对弈基准（`bench-mass.test.ts`）

`BENCH_MASS=1 vitest run games/burnrate/src/game/bench-mass.test.ts`（或
`npm run bench:burnrate:mass`）跑 4 人全启发式固定种子对局（默认 1 万局），
输出：座位/先手胜率、轮数分布（均值/中位/p90）、首破产时点分布、翻盘率
（曾全场最低者最终获胜比例）、aborted 数（>400 轮未终局 = 死锁）。
同一文件不改代码跑两套规则 = A/B 对比。

基线（10k 局）→ 机制包后（10k 局，含最新 HR 平衡调整）：

| 指标 | 基线 | 机制包后 |
| --- | --- | --- |
| 死锁率 | 5.2% | **0%** |
| 座位胜率 | 14.6/26.2/28.2/25.5 | **~25/25/25/25**（HR 平衡后 3k 局 26.2/26.8/24.7/22.3） |
| 先手胜率 | 18.8% | **~24%** |
| 轮数均值/中位/p90 | 8/7/12 | **7.4/7/9**（挖角收费后 AI 现金流失加速；人机局明显更长） |
| 首破产轮均值 | 4.9 | **~6** |
| 胜者曾为最低 | 53.8% | **~76%** |

节奏目标 12-18 轮：机制包前期达标（均值 10.8），挖角收费/挡箭牌后全 AI 局
均值降至 7.4（AI 花钱挖角→现金流失加速）；人机局（人类理性控钱）会明显更长。
如需回调可调 `AI_NO_ATTACK_ROUNDS` / AI 挖角余量 / `DUEL_BURN_EXTRA`。

### 牌堆（`game/cards.ts`）

`buildDeck(rng)` 用注入的 RNG 确定性构建 **156 张**（构成镜像 rules.md §1）：

- 16 VP（hr/fin/sales/eng 各 4，薪水 $4M）
- 40 员工（工程师 16 / 营销 10 / HR 7 / 财务 7，薪水 = 技能等级）
- 40 项目（技术 20 / 烂尾 12 / 市场 8，属性在 rules.md 范围内随机生成）
- 60 行动（layoff 12 / poach 10 / consultant 10 / headhunter 8 / release 8 /
  audit 6 / resign 6）

## AI 架构

统一抽象：`AiAdapter = { kind, difficulty, chooseAction, chooseCompletions }`，
由 `createAiAdapter(difficulty)` 工厂按 `AI_LEVELS` 映射：

| 难度 | kind | 预算 |
| --- | --- | --- |
| 简单 | random | — |
| 普通 | heuristic | — |
| 困难 | mcts | 300 迭代 |
| 专家 | mcts | 1200 迭代 |

- **启发式（heuristic.ts）**：对旧原型 AI 的忠实纯逻辑移植并多人化
  —— 专打现金最少的对手；贪心完成通道 `chooseAiCompletions` 被所有适配器共用。
- **IS-MCTS（ai/mcts/）**：
  - `world.ts` 每模拟采样一个确定性世界（对手手牌/牌堆从当前 deck 洗牌重切）；
  - `search.ts` 树节点 = 单张打牌决策（每步重搜），rollout 深度截断 +
    启发式 eval（现金/公司/手牌/项目差分）；
  - `legal.ts` 只扩展合法动作；
  - `mcts.worker.ts` classic worker 异步执行不卡 UI，超时回退结束回合；
  - rollout 内对手一律用启发式。
- **目标选择**：`AiAction` 带 `target`（玩家索引）；多人下 AI 侧启发式专打
  现金最少者，MCTS 把目标纳入动作空间；人类侧由 UI 弹目标选择。

## 多人流程与观战

- 人类破产即判输并弹结算，可"观战剩余 AI"（`useAiTurn` 逐张表演 + 间隔压缩，
  可退出）；终局显示最终赢家。
- 只有最终存活者算胜场（`storage.ts` 持久化 win count）。

## 存档（`storage.ts`）

- localStorage 键：`burnrate.save`（对局）、`burnrate.wins`（胜场）、
  `burnrate.achievements`（成就）、`burnrate.muted`（静音）。
  `burnrate.settings`（开局设置：人数/强度/设置面板展开态，由 StartScreen 读写，
  跨会话保留，首次进入设置面板自动展开一次）。
- **版本化**：`format: 2` = 多人 players 数组 + 每个 AI 槽位难度；任何旧 1v1
  存档或损坏存档验证失败即丢弃，游戏重新开始。
- 每步持久化（engine `afterChange` 挂钩），刷新后"继续对局"恢复。

## 开局流程（App.vue + StartScreen.vue）

- **主界面常驻**：`game-stage` 始终渲染；开局弹窗（`.full-overlay`）覆盖其上，
  不再有整页 start page 的 v-if/v-else 切换。
- **弹窗主体**：只有两个动作——🔥 新游戏（按当前设置开局）与 🕹️ 继续游戏
  （有存档时）；人数/强度收纳在可展开的 ⚙ 设置面板（首次自动展开，之后记住
  展开态与选择，localStorage `burnrate.settings`）。
- **可关闭性**：`closable = gameStarted`（用户已真正开局）——首次进入/有待决
  存档时不可关闭，必须二选一；游戏中经顶栏 ✕ 打开后可关闭（关闭即返回对局）。
- **新游戏确认**：进行中（`gameStarted && !gameOver`）先弹"开始新局？"确认；
  首进与对局结束后直接掷骰。确认/开局后弹窗保持打开，直到 `onDiceDone` 掷骰
  完成才关闭；取消掷骰仅清空 overlay，弹窗/结算留在原地。
- **重开入口**：结算弹窗"再来一局"用 `lastSetup`（最近一次开局配置）直接重开，
  不弹设置；"返回菜单"打开开局弹窗。

## UI / 动画

- **motion-v**：卡牌 layout FLIP（打牌/移动）；发牌/抽牌用 `useDrawAnimations`
  飞行动画；AI 回合逐张表演（MCTS 思考指示）。
- **开局骰子（DiceRollOverlay.vue）**：3D CSS 立方体骰子（preserve-3d，iOS 13
  可用），JS rAF 补间把每枚骰子从随机起始角滚到「目标面角 + 2~3 整圈余量」
  （360° 倍数不改变落面，只增翻滚感），easeOut 落定；逐轮演出平局重掷
  （仅并列者再滚），停定后金圈高亮先手 + 「先手：xxx」揭晓。**预掷定结果**：
  结果来自引擎注入 RNG，点「快进」只是把演出直接定格到最终结果，结果不变。
- **观战加速**：`useAiTurn` 把 AI 回合切成单张表演，间隔可压缩。
- **音效（useAudio.ts）**：单例 AudioContext + master gain → limiter；针对
  iOS Safari 挂起做了健壮恢复（非 running 状态尝试 resume、visibilitychange
  自动恢复、挂起时不下发 oscillator 防止节点泄漏）。

## 兼容性

- iOS 13 / Safari 13：`@vitejs/plugin-legacy` 产出 modern ESM + `nomodule`
  legacy 双包（Babel 降级 ES5）；Web Worker 用 classic 形式；CSS 避免在渐变
  参数中使用自定义属性（老 Safari 解析失败导致透明）。

## 测试策略

- `src/game/**/*.test.ts`（Vitest，70+ 用例）：
  - `engine.test.ts`：多人回合/破产/目标原语/审计翻倍；
  - `rules.test.ts` / `cards.test.ts`：规则函数与 156 张牌构成（对照 rules.md）；
  - `ai.test.ts` + `smoke.test.ts`：全 AI 冒烟对局（各难度自对弈到终局）；
  - `mcts/mcts.test.ts`：IS-MCTS 单测；
  - `bench.test.ts`：MCTS vs 启发式对打基准（`BENCH_GAMES`/`BENCH_ITER` 可调，
    `npm run bench:burnrate`）。
- 种子 RNG 注入使所有引擎测试可复现。

## 历史沿革

- **最早原型**：单文件 HTML 实现（1v1），玩法逻辑已整体移植进 `src/`，
  原型文件已移除。
- **多人化**：`players` 数组 + 目标选择取代了原型的硬编码敌人。
- 正式实现相对原型修正的规则 bug：
  - **目标合法性**：poach/resign 按 rules.md 走"HR 挡箭牌"——对手有 HR VP 时只能
    作用其 HR VP（原型完全忽略保护）；挖 HR VP 后作废（不进挖角方）；
  - **VP 前置条件**：layoff/release 必须满足对应 VP（原型可绕过）；
  - **审计语义**：无 Finance VP 才翻倍薪水，且顾问/项目不受审计影响；
  - **确定性牌堆**：`buildDeck(rng)` 取代原型的固定优先级队列；
  - **多目标**：audit/consultant/烂尾工程可指定任意存活对手（1v1 硬编码敌人）。
- **可玩性 House Rules**：落后补牌 / 紧急融资 / 固定开销与尾局恐慌 / 手牌上限 /
  通用弃牌 / 烂尾自救（止损+画大饼）/ 项目无 VP 门槛 + 对应 VP 加成 / HR 挡箭牌 +
  挖角费用 + HR VP 作废 / 高层内斗（详见 `rules.md` §四，全部集中在 `constants.ts`）。
- **掷骰定先手**：开局由 `rollFirst` 预掷决定先手（原先硬编码人类先手），
  `newGame` 接受 `firstPlayer`；AI 首回合由 `phase` 同步触发，无需改轮转逻辑。
