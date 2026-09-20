# KeyFlow — 实现文档

> 架构与设计意图见 `design.md`，产品功能见 `product.md`，机制说明见 `design.md` §9。

## 1. 技术栈

- **框架**：Vue 3.5（Composition API，`<script setup lang="ts">`）
- **语言**：TypeScript 5.9（strict 模式）
- **构建**：Vite（MPA 多页应用），`@vitejs/plugin-vue` + `@vitejs/plugin-legacy`
- **样式**：**98.css**（Windows 98 复古设计系统，纯 CSS、语义化 HTML；npm 依赖 + `main.ts` 导入）+ `src/index.css`（布局/打字区/键盘图/转场等自定义部分）。Vite 8 的 lightningcss 无法解析 98.css 的 `@media (not(hover))`（MQ Level 5），构建配置 `build.cssMinify: 'esbuild'`（依赖 `esbuild`）
- **渲染**：Vue 响应式渲染 + Canvas 2D（按会话图表，`useSessionChart.drawSessionChart`）
- **持久化**：localStorage（`keyflow_profile_v2` 单档案 JSON）
- **测试**：Vitest（引擎单测 35 用例：`lesson.test.ts` 23 / `student.test.ts` 12）+ Playwright（e2e 12 用例：`e2e/keyflow-flow.spec.ts`）
- **类型检查**：`vue-tsc --noEmit -p games/keyflow/tsconfig.app.json`

## 2. 文件清单

```text
games/keyflow/
├── index.html               Vue 入口页（#root + module src/main.ts）
├── tsconfig.json            TS solution 根
├── tsconfig.app.json        应用编译配置（strict、bundler、@keyflow/* 路径）
├── src/
│   ├── main.ts              入口：createApp(App).mount('#root') + 98.css/样式导入
│   ├── App.vue              provide(useKeyFlow) + 桌面/窗口外壳 + 工具栏 + 屏幕分发 + Toast
│   ├── index.css            布局/打字区/键盘图/转场样式（98.css 之外的自定义部分）
│   ├── storage.ts           localStorage 单档案数据层（keyflow_profile_v2）
│   ├── composables/
│   │   ├── useKeyFlow.ts         中心编排状态机（单档案 + 导航历史 + 会话/总结/输入弹层）
│   │   ├── useTypingSession.ts   打字会话运行时（按行推进 + 每键增量 + 参考公式）
│   │   └── useSessionChart.ts    按会话柱状图绘制（canvas，最多 40 根 + 目标线）
│   ├── components/
│   │   ├── KeyFlowMenu.vue  通用菜单（真 <button role="menuitem"> + 焦点管理）
│   │   ├── BaseModal.vue    98 风格模态对话框（替代原生 confirm）
│   │   ├── KeyboardGraphic.vue 键盘图（课程键/新键/焦点键高亮 + 指法悬停；含 keypad 模式）
│   │   └── screens/*.vue    19 个屏幕组件
│   └── game/                （纯 TS 引擎层，无 Vue/DOM）
│       ├── types.ts         共享类型：ProfileRecord/SessionResult/KeyStats/ViewName/ReportKind
│       ├── constants.ts     静态数据：LESSON_KEY_ORDER/FINGER_ATTR/LESSONS/TESTS/阈值/菜单项等
│       ├── lesson.ts        频率表生成器（可注入 RNG）+ 参考公式 + 掌握推进 + 按键分析
│       └── student.ts       档案域：日期/目标/周索引/会话更新/欢迎文案
├── e2e/
│   ├── keyflow-flow.spec.ts 12 用例：种子直进 / 首运引导 / 课程 / 整行推进 / 帮助 / keypad / 报告×2 / 重置 / 工具栏 / 模态键盘通道 / 焦点键隔离
│   └── helpers/             save-state.ts（keyflow_profile_v2 注入）、console.ts（错误哨兵）
└── docs/                     design.md / implementation.md / product.md
```

## 3. 模块实现细节

### 3.1 数据层 — `storage.ts`

```ts
// 单档案 key（存储键；旧格式不读取）
const KEY = 'keyflow_profile_v2';

export function blankProfile(overrides?: Partial<ProfileRecord>): ProfileRecord; // 默认档案（64 项 keyStats / 52 周数组）
export function loadProfile(): ProfileRecord | null;  // localStorage → JSON.parse → normalizeProfile
export function saveProfile(p: ProfileRecord): void;
export function clearProfile(): void;                 // 重置 / 重新引导
```

**关键点**：

- `normalizeProfile()`（模块内私有）：`name` 非空字符串才通过，其余字段一律兜底 —— `num()` 数值、`weeks()` 补齐 52 项、`keyStatsArr()` 补齐 64 项（对应 `LESSON_KEY_ORDER`）、`sessionLogArr()` 过滤非法项并 `slice(-MAX_LOG)`
- `experience` 非 `two-finger` / `touch` 一律回落 `beginner`；`currentKeyIndex` 夹取到 `[0, 63]`
- `loadProfile()` 全程 try/catch：JSON 解析失败或坏档返回 `null`，应用退回首次引导
- `saveProfile()` / `clearProfile()` 同样 try/catch：隐私模式 / 配额超限时 `setItem` 会抛异常，落盘失败不能中断打字会话（内存中的档案继续工作，本次不落盘）
- 无学生数组 / 教师密码 / 最高分；`introDone` 为引导完成标记

### 3.2 引擎层 — `game/student.ts`

| 函数 | 实现要点 |
| --- | --- |
| `todayStr()` | `MM-DD-YY` 格式，月/日补零，年份取后两位 |
| `validateDate(s)` | 正则 + 月 1-12 / 日 1-31 校验 |
| `practiceGoalFor(exp)` | 周练习目标：beginner 30 / two-finger 45 / touch 60（分钟） |
| `initialGoal(wpm, exp)` | 速度目标 `clamp(20, 120, wpm + 10)`；练习目标取 `practiceGoalFor(exp)`；准确率目标 90 |
| `getWeekIndex()` | 当年第几周（0-51），见设计文档 §4.3 |
| `weekMinutes(s)` | 本周累计练习分钟（`weeklyMinutes[week]`） |
| `weekHours7(s)` | 最近 7 周滚动窗口求和 ÷ 60（欢迎屏/主菜单周对比） |
| `avgWpm(s)` / `avgAcc(s)` | 仅对有记录的周取平均（无数据返回 0） |
| `daysSinceLast(s)` | 距上次会话天数（无记录返回 `Infinity`） |
| `welcomeMessage(s)` | 多段文案数组：欢迎语 / 久未练习提醒 / 周练习量 vs 目标 / 平均速度与准确率 / 提示语 |
| `sessionUpdate(s, wpm, acc, minutes, kind)` | 返回增量 patch：`wpm`/`acc`/`totalMin`/`lastSession`/`date`；`weeklyWpm[week]` 取历史最大、`weeklyAcc[week]` 覆盖、`weeklyMinutes[week]` 累加；本周首练才 `totalWeeks + 1`；`sessionLog` 追加并截断到 `MAX_LOG` |

### 3.3 引擎层 — `game/lesson.ts`

**生成器（参考频率表语义）**：

- `createRng(seed)`：mulberry32 确定性随机源，`GenOptions.rng` 可注入（默认 `Math.random`），测试/e2e 可复现
- `keyIndex(key)`：键 → `LESSON_KEY_ORDER` 下标（不命中返回 -1）
- 内部 `buildGroup`：3 字符组 —— 权重 `freq + 1` 无重复抽取 + 组内洗牌；`buildLine`：组 + 空格拼到 `LINE_CHARS = 28`，大写模式下行内约 30% 字母转大写（`randomUppercase`）
- `genLessonText(keyIndex, drills, freq, opts?)` → `string[]`（每行一项）；`opts.keypad` 换用 `KEYPAD_ORDER`

**公式与判定**：

| 函数 | 公式 / 语义 |
| --- | --- |
| `updateFrequency(freq, key, correct, wpm)` | 正确 `(f >> 5) + f + 1`；错误 `floor((2040 / max(1, wpm)) * 3) + (f >> 2)`。**参考实现：运行时未调用**（文本一次性生成，频率表由 `initFreq` 初始化，见 design.md §9.3），保留实现与单测作为算法参考 |
| `keyAcc(s)` / `keyWpm(s)` | 每键准确率 % / 每键 WPM（`correct / 5 / 分钟`） |
| `isMastered(s, threshold = 15)` | `attempts >= 30 && keyAcc >= 80 && keyWpm >= threshold` |
| `masteredSet(keyStats, threshold)` | 由终身统计推导已掌握键集合（索引 → `LESSON_KEY_ORDER`） |
| `shouldAdvance(keyIndex, mastered)` | 键集内未掌握键 < 4 |
| `pickFocusKey(keyIndex, mastered)` | 优先 home 键未掌握者，否则课程内第一个未掌握者 |
| `computeWpm(correct, errors, lines, elapsedMs)` | `max(0, correct + errors − 2×lines) / 5 / 分钟` |
| `computeLifetimeWpm(totalChars, totalCorrect, totalErrors, totalMin)` | `(chars + correct − 2×errors) / 5 / 分钟`（惩罚错误）。**公式已实现但 UI 未使用**：档案只存 `totalMin`，未存 totalChars / totalCorrect；欢迎屏用 `avgWpm` |
| `computeAccuracy(correct, errors)` | `correct / (correct + errors) × 100`（无输入 100） |
| `analyzeKeys(deltas, elapsedMs)` | 每键 WPM 降序（同 WPM 时按准确率降序：WPM 公式把错误也算作字符，否则「全对」与「半错」同分）→ `bestKeys`(Top 3) / `weakKeys`(Bottom 3) / `keysAbove`(≥ 15 计数) |
| `keyClass(ch)` / `keyClassBreakdown(keyStats, threshold)` | Letter / Number / Symbol 每键 WPM 均值 + `keysAbove`（仅统计有尝试的键） |

### 3.4 编排层 — `composables/useKeyFlow.ts`

状态单一来源：`profile` / `view` / `history`（导航栈，最多 30 条）/ `session`（标题 + 行数组 + kind）/
`pendingSummary(+Title)` / `reportKind` / `inputConfig` / `notice` / `setupMode` / `freqTable` /
`newKeyInfo` / `focusKey`。`go(v)` 记录历史，`back()` 跳过 `typing`/`input` 回退、栈空则回主菜单。

`focusKey` **只由顺序课程赋值**（`beginTyping()` → `pickFocusKey`）；`startSpecialLesson` /
`beginKeypadLesson` / `startTest` / `startSession` 一律置 `null` —— 否则特殊课与测试会沿用上一课的指法提示行、键盘图红标与摘要的 Current Focus Keys。

| 动作组 | 方法 |
| --- | --- |
| 流程 | `start()`：无档案 → setup；未完成引导 → intro；否则 → welcomeBack。`exit()` 落盘后回 boot |
| 档案 | `openSetup(mode)` / `setupProfile(name, date, experience)` / `editProfile(name, date)` / `resetProfile()` / `retakeInitialTest()` / `skipInitialTest()` / `reviewIntro()` |
| 课程 | `startLesson()`（推进判定 → newKeyIntro / shiftIntro / typing）、`beginAfterIntro()`、`startSpecialLesson(kind)`、`beginKeypadLesson()` |
| 测试 | `startTest(id)`：`practice` 用当前键集生成、`keypad` 用 `KEYPAD_ORDER`、其余取 `TESTS` 的固定文本（文本单源，不再内联） |
| 会话 | `startSession(title, lines, kind)`、`completeSession(result, title, kind)`、`completeInitialTest(result)`（按经验水平设目标 → 记录 → 主菜单） |
| 摘要 | `continueLessons()` / `takeTest()` / `endLesson()`（三选一） |
| 设置 | `setSpeedGoal` / `setPracticeGoal` / `setAccuracyGoal` / `setDrills`（立即落盘） |
| 报告/输入/提示 | `openReport(kind)`、`openInput(cfg)` / `closeInput()`、`notify(msg)`（2.5 s 自动清除） |

**会话记录 `recordSession()`**：先把 `result.keyDeltas` 逐键累加进终身 `keyStats`
（`keyIndex()` 解析下标，跳过不在 64 键表中的字符），再套用 `sessionUpdate()` 的 patch，最后落盘。

**会话频率表 `initFreq()`**：以终身每键**错键数 × 10**（cap `0xff`）作为初始权重，
使薄弱键在下一课出现更多（文本一次性生成，无法会话内逐行反馈的替代方案）。

### 3.5 打字会话 — `composables/useTypingSession.ts`

状态（均为 `ref`）：`lineIdx` / `posInLine` / `errors` / `total` / `typed`（`{ ch, err }[]`）/
`pendingChar` / `pendingError` / `msg` / `now`；派生：`currentLine` / `elapsedMs` / `wpm` / `acc` /
`progressPct` / `isComplete`。

键盘处理（`onMounted` 注册 `window keydown`，`onBeforeUnmount` 移除并清定时器）：

| 键 | 行为 |
| --- | --- |
| `Escape` | `finish()` |
| `Backspace` | 只回退行内指针 + 清标红，**不撤销已记录统计**（防刷分，参考语义） |
| 单字符（匹配） | `typed.push({ ch, err: false })`、`keyDeltas[期望键].correct++`、指针前进 |
| 单字符（不匹配） | `errors++`、`keyDeltas[期望键].errors++`、`typed.push({ ch, err: true })` + `msg` 提示；**打错不卡住，指针继续前进** |

行满 → `advanceLine()`（整行完成才换行）；最后一行完成 → 置 `finishing` 并 300 ms 后 `finish()`——
收尾窗口内忽略按键（否则收尾期的多按键会以 `expected === undefined` 被记成错误）。
`finish()` 用 `analyzeKeys(keyDeltas, elapsed)` 汇总，产出 `SessionResult`（`minutes` 下限 0.1）交给编排层。

> 注意：错误计入**期望键**而非误按的键（否则每键薄弱分析会被误按键污染）。

### 3.6 屏幕组件 — `components/screens/*`

19 个屏幕组件，每个 `inject(KeyFlowKey)` 取编排层接口并渲染 UI；`App.vue` 用
`screens: Record<ViewName, Component>` 装载，`<component :is="screens[api.view.value]" :key="api.view.value">`
配合 `<Transition name="screen">` 切换，窗口标题由 `SCREEN_TITLES` 映射。

屏幕清单：`boot` / `setup` / `intro` / `initialTest` / `typing` / `summary` / `mainMenu` /
`lessonsMenu` / `testsMenu` / `reportsMenu` / `optionsMenu` / `input` / `report` / `newKeyIntro` /
`shiftIntro` / `fingerIntro` / `help` / `welcomeBack` / `keypadIntro`。

键盘监听生命周期见 `design.md` §6.2（`BootScreen` 与 `WelcomeBackScreen` 均 `{ once: true }` 注册、
并在 `onBeforeUnmount` 移除）。`input` 为窗口式模态弹层，`optionsMenu` 内含 `BaseModal`（重置确认）。

### 3.7 图表 — `composables/useSessionChart.ts`

`drawSessionChart(canvas, kind, log, goal)`：取 `sessionLog.slice(-40)`，画 4 段网格 + Y 轴刻度、
红色虚线目标线（标注 `goal N`）、柱体（speed 深蓝 `#000080` / acc 绿 `#008000`）、每 5 根标注数值；
无会话时显示 `No sessions yet`。`kind` 与报告屏 `ReportKind` 的 `speed` / `acc` 对应。

## 4. 构建与运行

项目位于 Shoop Da Whoop 单仓，由根 `vite.config.js` 的 MPA 配置驱动：

```bash
npm run dev            # 开发服务器：http://localhost:5173/games/keyflow/
npm run build          # 生产构建（含 legacy 双包）
npm run preview        # 预览构建产物
npm run typecheck      # vue-tsc（根脚本串联各游戏）
npm run lint           # eslint（含 compat 浏览器兼容检查）
npm run test           # vitest 单测（src/**/*.test.ts）
npm run test:e2e       # playwright e2e（games/*/e2e/*.spec.ts）
```

只跑 keyflow 时可用聚焦命令：`npx vitest run games/keyflow`、`npx playwright test games/keyflow/e2e`、
`npx vue-tsc --noEmit -p games/keyflow/tsconfig.app.json`。

### 验证基线

| 检查 | 结果 |
| --- | --- |
| `npm run typecheck`（四个游戏串联） | 通过 |
| `npx vitest run games/keyflow` | 2 文件 / 35 用例通过 |
| `npx vitest run games/burnrate/src/game/ai` | 2 文件 / 28 用例通过 |
| `npx playwright test games/keyflow/e2e` | 12 用例通过 |
| `npx eslint games/keyflow` | 干净 |

**e2e 确定性**：课程文本由 `genLessonText` + 可注入 RNG 生成，但 e2e **不需要**注入种子 ——
「整行推进」用例从 DOM 读出引导行后逐字符输入，其余用例以短会话 + `Escape` 结束，不依赖具体文本。
需要确定性文本时用 `createRng(seed)`（单测已覆盖）。

### 根配置接线

- `vite.config.js`：`resolve.alias['@keyflow']` → `games/keyflow/src`；`rollupOptions.input['keyflow']` → `games/keyflow/index.html`
- `package.json`：`typecheck` 追加 `&& vue-tsc --noEmit -p games/keyflow/tsconfig.app.json`
- `vitest.config.ts`：追加 `@keyflow` 别名 + `games/keyflow/src/**/*.test.ts` 到 include
- `index.html`：导航 `<a href="games/keyflow/">Keyflow</a>`

## 5. 实现约定与易错点

- **视图分发**：`api.view` 是 `ref`，模板必须写 `screens[api.view.value]`，否则屏幕不切换。
- **打字指针定位**：必须读目标字符 span 的 `offsetTop/offsetLeft`（`TypingScreen.updatePointer`，watch `posInLine`/`lineIdx`/`pendingError`），不要用固定字符宽 —— 否则折行后指针漂移。
- **输入行与引导行逐字符对齐**：`typed` 按整行占位（未输入部分补空格），使两行字符数一致；e2e 用两行字符 span 的 `getBoundingClientRect().left` 差 < 1px 校验。
- **打错不卡住**：打错时记录错误并让指针继续前进，`Backspace` 只回退行内指针、不作废已记录统计（防刷分，参考语义）。
- **错误归因到期望键**：`recordKey(expected, false)` —— 错误计入**该键**而非误按的键，否则 Best/Weak Keys 与频率表会被误按键污染。
- **引导行红标与输入行同格**：打错时 `posInLine` 已前进（打错不卡住），`.err` 判定必须用 `i === posInLine - 1`，写成 `i === posInLine` 会红标到**下一个**字符、与输入行红显错位一格。
- **模态打开时底层菜单必须惰性**：`BaseModal` 渲染在 `OptionsMenuScreen` 内部，`KeyFlowMenu` 不会卸载 —— 必须传 `:disabled="showReset"`（组件内 `onKey` 首行返回），否则 Enter/Esc/↑↓ 会穿透遮罩去操作被遮住的菜单项（Esc 还会直接离屏）。
- **焦点键只在顺序课程设置**：`focusKey` 仅由 `beginTyping()` 赋值，其余会话入口置 `null`（见 §3.4）。
- **`totalWeeks` 递增**：只有「本周首次练习」才 +1（判断 `weeklyMinutes[week] > 0`）。
- **键盘监听成对**：`onMounted` 注册 + `onBeforeUnmount` 移除；用 `{ once: true }` 也要移除，否则鼠标点按钮离开屏幕后残留监听会劫持下一次按键（如 `WelcomeBackScreen`）。
- **提示统一走 Toast**：`notify()` 由 `App.vue` 全局渲染，不要在屏幕组件内渲染。
- **表单 Enter 提交**：`<form>` + `@submit.prevent`，Enter 与按钮等价（如 `SetupScreen` / `NumberInputScreen`）。
- **e2e 选择器**：工具栏 `◀ Back` 与屏内 `Back` 按钮重名 → 用 `getByRole('button', { name: 'Back', exact: true })`；Progress 屏有两个 `.report-body`（主表 + 键类 Breakdown）→ 用 `.first()` / `.nth(1)`。
- **e2e 鼠标 hover 会改写菜单选中项**：点击屏内按钮离开该屏后，鼠标停在原位，新屏出现在指针下的 `.menu-item` 会触发 `mouseenter` → `sel` 被静默改成该行。切屏后还要用键盘导航时，改用工具栏按钮离开，或直接断言 `.menu-item.selected` 的文本（本套件两个用例已这么做）。
- **markdownlint**：表格分隔行写 `| --- |`（紧凑写法报 MD060）；代码栅栏必须带语言（ASCII 图用 `text`，报 MD040）。

## 6. 扩展指南

- **新增顺序课程**：无需改代码 —— 课程键集由 `LESSON_KEY_ORDER` 前缀动态生成（`lessonKeys(keyIndex)`），是否引入新键由 `shouldAdvance` 判定。
- **新增特殊课程**：`constants.ts` 的 `LESSONS` 加一项（`kind: 'keypad' | 'all' | 'finger'`），并在 `useKeyFlow.startSpecialLesson` 加分支（如需要说明屏，则补 `ViewName` 项 + 屏幕组件 + `screens` 映射）。
- **新增测试**：`useKeyFlow.startTest` 加分支（`practice` 用当前课程键集生成、`keypad` 用 `KEYPAD_ORDER`、其余用固定文本）。
- **新增屏幕**：三处必须同步 —— `game/types.ts` 的 `ViewName`、`App.vue` 的 `screens` 与 `SCREEN_TITLES`（漏项会在 `vue-tsc` 阶段报错）。
- **调整掌握阈值**：`constants.ts` 的 `MASTER_ACC` / `MASTER_ATTEMPTS` / `MASTER_WPM`（同时影响 `isMastered`、`analyzeKeys.keysAbove`、`keyClassBreakdown`）。
- **调整每课行数**：`DRILL_CHOICES`（Options 可选值）与 `DEFAULT_DRILLS`；生成器行长常量 `LINE_CHARS = 28`（≈7 组）。
- **接入声音**：`useTypingSession` 的匹配/错误分支可接音频（参考 burnrate/solitaire 的 `AudioContext` 封装）；iOS 需用户手势后再 resume。
