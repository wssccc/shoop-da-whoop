# KeyFlow — 设计文档

## 1. 项目目标

实现一款**单用户**打字训练应用：首次运行引导建档，之后直接进入主菜单；
提供课程练习、测试、进度报告、速度/准确率图表与选项设置。使用 **Vue 3 +
TypeScript** 实现，保留键盘驱动的交互模型与本地存储的数据语义；视觉采用
**98.css**（Windows 98 复古桌面风），交互现代化（模态、通知、转场、表单语义、
可访问性），并纳入 Shoop Da Whoop 的 MPA 单仓构建体系。本应用不含游戏、教师模式
与多学生管理。

### 设计原则

| 原则 | 说明 |
| --- | --- |
| **交互优先** | 菜单结构、课程流程、统计口径（5 字符 = 1 词）保持不变 |
| **框架统一** | Vue 3 Composition API + `<script setup lang="ts">`，与 othello/burnrate/solitaire 对齐 |
| **引擎纯净** | `src/game/` 为纯 TS 逻辑层，零 Vue/DOM 依赖，便于单测 |
| **离线可用** | 所有资源本地，数据存 localStorage |
| **键盘驱动** | 键盘交互为主（方向键导航、Enter 确认、Esc 返回/结束），鼠标/Tab 为双通道补充 |
| **语义化** | 98.css 要求语义化 HTML：真 `<button>`/`<form>`/`<label>`，焦点与 aria 管理 |

## 2. 总体架构

```text
┌───────────────────────────────────────────────────────────┐
│                       src/main.ts                         │
│     createApp(App).mount('#root') + 98.css/主题样式 import  │
├───────────────────────────────────────────────────────────┤
│                        src/App.vue                         │
│       provide(useKeyFlow) + 桌面/窗口外壳 + 屏幕分发 + Toast │
├──────────┬──────────────────────────────┬─────────────────┤
│composables│    components/screens/*      │  components/*   │
│ useKeyFlow│   Boot/Setup/Intro/...       │ BaseModal/...   │
│ useTyping │   (19 屏幕组件)               │ KeyFlowMenu     │
│ useChart  │                              │ KeyboardGraphic │
├──────────┴──────────┬───────────────────┴─────────────────┤
│  storage.ts (localStorage 单档案 keyflow_profile_v2)        │
├───────────────────────────────────────────────────────────┤
│                    src/game/ (纯 TS 引擎)                    │
│      constants | lesson | student | types                  │
└───────────────────────────────────────────────────────────┘
```

### 2.1 分层职责

| 层 | 目录 | 职责 |
| --- | --- | --- |
| 引擎层 | `src/game/` | 纯 TS 逻辑：常量、课程生成、统计、档案域（日期/目标/周索引/会话更新）。无 Vue/DOM/副作用，可直接被 vitest 单测 |
| 数据层 | `src/storage.ts` | localStorage 读写：单档案 `keyflow_profile_v2` 的 load/save/clear + 归一化 |
| 编排层 | `src/composables/useKeyFlow.ts` | 中心状态机：持有全部应用状态（单档案/当前视图/待展示总结），通过 `go(view)` 切换屏幕，封装所有导航与数据动作，经 provide/inject 下发 |
| UI 层 | `src/components/` | 屏幕组件与可复用组件（`KeyFlowMenu`、`BaseModal`），通过 `inject(KeyFlowKey)` 访问编排层 |
| 入口层 | `src/main.ts`、`src/App.vue` | 挂载根实例；App.vue 提供编排层、桌面/窗口外壳（98.css `.window`/`.title-bar`）、屏幕转场与全局通知 |

### 2.2 依赖方向

```text
main.ts → App.vue → useKeyFlow (provide) → 各屏幕组件 (inject)
                    └─> storage.ts → localStorage
                    └─> game/* (纯函数)
KeyFlowMenu/BaseModal ← 屏幕组件
useSessionChart → canvas
```

依赖方向单向无环：**引擎层不 import 任何 Vue/UI**，编排层只依赖引擎层与数据层，
UI 层只依赖编排层提供的接口。

## 3. 视图状态机

视图由 `ViewName` 联合类型表达，`App.vue` 将 `screens[api.view.value]` 映射为屏幕组件。

```text
boot ─▶ setup ─▶ intro ─▶ initialTest ─▶ typing ─▶ summary ─┐
 │        │  ▲        │           │          │       │      │
 │        ▼  │        ▼           ▼          ▼       ▼      │
 │    (编辑档案)   (跳过)    welcomeBack ─▶ mainMenu ◀──┴───────┘
 │              (Retake)     │  │  │  │                     │
 │                           ▼  ▼  ▼  ▼                     │
 │                     lessons  tests reports options       │
 │                     │        │      │      │             │
 │                     ▼        ▼      ▼      ▼             │
 │                   typing ◀──┘      report  input(弹层)   │
 │                   (keypadIntro)    (help)         reset  │
 └──────────────────────────────────────────────────────────┘
```

说明：

- `setup` 双用途：无档案时建档（`setupMode:'setup'`），Options → Edit profile 时
  编辑（`setupMode:'edit'`）；`introDone` 标记引导是否完成。
- `start()`：无档案 → `setup`；有档案且 `introDone` → `welcomeBack`（登录进度报告）→ `mainMenu`；否则 → `intro`。
- `initialTest` 可从 Options → Retake initial test 重跑；跳过时仍标记 `introDone`。
- 菜单结构：Main = `Lessons/Tests/Reports/Options/Help/Quit`，
  子菜单无 "Return" 项，Esc 返回上一屏；`help` 屏为菜单说明文本（可翻页）。

### 视图分发

`App.vue` 维护 `Record<ViewName, Component>`，`<component :is="screens[api.view.value]" />`
渲染，并用 `<Transition name="screen">` 做屏间转场。因 `api.view` 是 `ref`，
模板中需显式读取 `.value` 以保持响应性。

## 4. 数据模型

### 4.1 用户档案 `ProfileRecord`

```ts
{
  name: string;          // 姓名（≤39 字符）
  date: string;          // 上次练习日期 MM-DD-YY
  experience: Experience; // 经验水平（beginner/two-finger/touch）
  speedGoal: number;     // 速度目标 WPM
  practiceGoal: number;  // 练习目标 分钟/周
  accuracyGoal: number;  // 准确率目标 %
  drills: number;        // 课程 drills 数（每课行数）
  wpm: number;           // 当前速度
  acc: number;           // 当前准确率 %
  totalMin: number;      // 累计练习分钟
  totalWeeks: number;    // 累计周数
  weeklyWpm: number[];   // [52] 每周速度
  weeklyAcc: number[];   // [52] 每周准确率
  weeklyMinutes: number[]; // [52] 每周练习分钟
  keyStats: KeyStats[];  // [64] 每键统计（索引 = LESSON_KEY_ORDER 位置）
  sessionLog: SessionLogEntry[]; // 会话日志（最近 200 条）
  currentKeyIndex: number; // 当前课程键索引（0-63）
  shiftIntroDone: boolean; // Shift 说明屏是否已看过
  created: number;       // 创建时间戳
  lastSession: number;   // 上次会话时间戳
  introDone: boolean;    // 首次引导（intro + initial test）是否完成
}
```

字段语义见 §9.1：`experience` 由注册向导选择、`accuracyGoal` 默认 90、
`drills` 为每课行数（5 的倍数）、`weeklyMinutes` 驱动周目标对比、
`keyStats[64]` 索引即 `LESSON_KEY_ORDER` 位置（终身累计）、`sessionLog` 保留最近 200 条。

### 4.2 持久化

| Key | 内容 |
| --- | --- |
| `keyflow_profile_v2` | 单档案对象 JSON（当前版本） |
| `keyflow_profile_v1` | **不读取**（无兼容层） |

`storage.ts` 的 `normalizeProfile()` 用默认值合并 + 浅校验，坏档安全降级（返回 null）。
档案版本策略：只读写 v2；遇 v1 直接重新建档（单用户工具，维护兼容层不划算）。

### 4.3 周索引算法

```ts
function getWeekIndex(): number {
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 1); // 当年 1 月 1 日
  const days = Math.floor((now - start) / 86400000);
  return Math.min(51, Math.floor(days / 7)); // 0..51
}
```

## 5. 课程引擎设计

### 5.1 课程文本来源（无位流压缩）

课程文本**运行时生成、不落盘**：`genLessonText` 返回 `string[]`（每行一项），直接交给
打字会话按行推进；档案只保存统计与进度，不保存文本。

### 5.2 课程文本生成（`lesson.ts`）—— 自适应生成器

课程文本**运行时生成**（无词表，参考语义）：

```ts
genLessonText(keyIndex, drills, freq, opts?):
  1. 键集 = LESSON_KEY_ORDER 前缀（课程键集）
  2. 每行 = 3 字符组 + 空格，直到 ~28 字符（7 词，可见宽度 ~28 列）
  3. 组内字符按频率表加权选择（权重 = freq + 1），无重复，组内洗牌
  4. 大写模式（keyIndex ≥ 8）：行中约 30% 字母随机大写
  5. 返回行数组（每行独立，打字会话按行推进）
```

- **频率表**（`updateFrequency`，参考语义）：正确 `freq = (freq>>5)+freq+1`（缓慢增长）；
  错误 `freq = (2040/wpm)×3 + (freq>>2)`（大幅提升 → 薄弱键更多出现）。
  **参考实现**：文本一次性生成、无法会话内逐行回灌，运行时不再调用（见 §9.3）
- **会话频率表初始化**（`initFreq`）：由终身每键统计的错键数加权（错键 ×10，cap 0xFF）
- **PRNG**：`createRng(seed)` mulberry32，测试可注入种子复现

### 5.3 打字会话（`useTypingSession.ts`）—— 按行推进

```text
状态: lineIdx / posInLine / errors / total / typed / keyDeltas (全部 ref)
事件: window keydown (onMounted 注册, onUnmounted 移除)
  - Escape → finish()
  - Backspace → 只回退当前行内指针（清 UI 标红），不撤销已记录统计（参考语义）
  - 单字符键 → 与当前行 lines[lineIdx][posInLine] 比较
      ├─ 匹配 → posInLine++，typed 追加，keyDeltas[ch].correct++
      │    └─ 行内完成（posInLine ≥ 行长）→ 自动切下一行（整行完成才切换）
      └─ 不匹配 → errors++，keyDeltas[ch].errors++，pendingChar 记录打错的字符
  - 最后一行完成 → 自动 finish()

finish():
  elapsed = (now - startTime) / 60000
  wpm = round((correct + errors - 2×lines) / 5 / elapsed)   // 参考公式
  acc = round(correct / (correct + errors) × 100)
  → onDone({wpm, acc, minutes, total, correct, errors, lines, bestKeys, weakKeys, keysAbove, keyDeltas})
```

**双行显示**（TypingScreen）：上方为当前行引导文本（done/current/err 分段 + 指针），
下方为实际输入行（`typed` 已通过字符 + `pendingChar` 打错字符红显，空格显示为 `·`）。
行号指示 `Line X/Y`；进度 = (已完成字符 + 行内 pos) / 总字符。

**练习页布局**：

```text
Line 1/10
┌──────────────────────────────────────┐
│  as sa as sa as sa ...              │  ← 引导行
│  ▲                                  │  ← 指针
│  ────────────────────────────────    │
│  as·sa·as                            │  ← 实际输入行（空格显示 ·，打错的字符在此红显）
└──────────────────────────────────────┘
Reach for 'a' with the little finger of the left hand.  ← 指法提示行
[内嵌键盘图：课程键高亮 + 焦点键高亮]（keypad 课显示 4 5 6 / 7 8 9 / 1 2 3 0 . +）
Type the line above. ...  ← 首行指令框（第一行显示，之后显示实时统计）
```

### 5.4 按键分析（per-key WPM）

```ts
analyzeKeys(keyDeltas, elapsedMs): 按每键 WPM 降序（同 WPM 时按准确率降序）
  bestKeys = 每键 WPM 最高的 3 个键（Best Keys）
  weakKeys = 每键 WPM 最低的 3 个键（Keys to Work on）
  keysAbove = 每键 WPM ≥ 15 的键数（Keys Above N WPM）
```

> 同 WPM 需按准确率次序：WPM 公式把错误也算作字符，「全对但少按」与「一半错误」会同分，
> 没有这层次序时 Best/Weak Keys 会把高错键排进 Best。

### 5.5 课程推进与掌握判定（参考语义）

```text
掌握（isMastered）：尝试 ≥ 30 且准确率 ≥ 80% 且每键 WPM ≥ 15（会话+终身双查）
推进（shouldAdvance）：键集中未掌握键 < 4 → currentKeyIndex + 1（引入新键）
焦点键（pickFocusKey）：优先 home 键中未掌握的，否则课程中第一个未掌握的
流程：startLesson → 推进检查 → 新键引入屏（可跳过）→ Shift 屏（首次）→ 打字
```

### 5.6 欢迎屏与报告

- **欢迎屏**（`welcomeBack`）：登录后显示多段进度报告（`welcomeMessage` 返回数组）：
  欢迎语 / 久未练习提示 / 周练习量（7 周滚动 `weekHours7`）/ 目标达成对比 / 平均速度与准确率 / 结尾提示；任意键继续。
- **报告四屏**（Reports 菜单 = Progress/Speed/Accuracy/Help）：
  - Progress：Overall（当前速度/目标/周对比）+ 键类 Breakdown（`keyClassBreakdown`：Letter/Number/Symbol 每键 WPM 均值 + Keys Above N）
  - Speed / Accuracy：平均/最后/最大/目标 + 会话历史列表 + 按会话柱状图（`drawSessionChart`，最多 40 根，Y 轴刻度 + 目标线）
  - Help：菜单说明文本屏

## 6. 编排层与事件管理（关键设计决策）

### 6.1 中心编排 `useKeyFlow`

`useKeyFlow()` 是所有状态与动作的唯一来源，`App.vue` 调用一次并 `provide`，
各屏幕组件 `inject(KeyFlowKey)` 获取。主要动作如下：

| 动作 | 说明 |
| --- | --- |
| `go(view)` | 切换视图 |
| `start()` | boot 后进入：无档案 → setup；有档案且 introDone → 主菜单（含欢迎文案） |
| `setupProfile(name, date, experience)` | 建档（含经验水平选择） |
| `startLesson()` | 顺序课程：推进检查 → 新键引入屏 / Shift 屏 → 打字 |
| `startSpecialLesson(kind)` | 特殊课程：keypad / all-keys / finger（指法说明屏） |
| `startTest(testId)` | 测试：practice 用当前键集生成（摘要屏入口） |
| `completeInitialTest(result)` | 初始测试结果 → 按经验水平设目标 + 记录 + 主菜单 |
| `completeSession(result, title, kind)` | 课程/测试结果 → 每键统计累加 + 记录 + 展示总结 |
| `continueLessons()` / `takeTest()` / `endLesson()` | 摘要三选一 |
| `startSession(title, text, lines, kind)` | 进入打字会话（设 session ref） |
| `openReport(kind)` / `openInput(cfg)` | 进入报告 / 数字输入弹层 |

### 6.2 键盘监听生命周期

每个需要键盘交互的组件在 `onMounted` 注册 `window.addEventListener('keydown', ...)`，
在 `onBeforeUnmount` 移除（结构化防泄漏）：

| 组件 | 注册 | 移除 | 备注 |
| --- | --- | --- | --- |
| `App.vue`（全局） | onMounted | onBeforeUnmount | `Alt+←` 返回上一屏、`Alt+Home` 回主菜单 |
| `BootScreen` | `{ once: true }` | 触发后自移除 | 任意键开始 |
| `KeyFlowMenu` | onMounted | onBeforeUnmount | 方向键/Enter/Esc + 点击 |
| `useTypingSession` | onMounted | onBeforeUnmount | 打字输入 + Escape 结束会话 |
| `BaseModal` | onMounted | onBeforeUnmount | Esc 关闭模态 |
| `WelcomeBackScreen` | onMounted（`{ once: true }`） | onBeforeUnmount | 任意键继续（点 `Continue` 离开也不再残留监听） |

> **模态期间底层菜单必须惰性**：`BaseModal` 渲染在宿主屏内部（如 `OptionsMenuScreen`），
> `KeyFlowMenu` 并不会卸载；两个监听器都挂在 `window` 上，不设闸门就会双双触发 ——
> ↑↓ 会改被遮住的选中项、Enter 会触发被遮住的菜单项、Esc 会直接离屏。
> 因此 `KeyFlowMenu` 提供 `disabled` prop，宿主屏传 `:disabled="<模态开关>"`。

## 7. UI 设计

### 7.1 视觉外壳（98.css）

```text
┌─ .desktop（#008080 青色铺满视口，内容居中）───────────────────┐
│ ┌─ .window.keyflow-window（min(860px, 100vw - 48px)）─────┐ │
│ │ .title-bar：KeyFlow — {SCREEN_TITLES[view]}（右侧 3 禁用按钮）│ │
│ ├─ .toolbar：◀ Back / ⌂ Main Menu（boot/typing/input 隐藏） │ │
│ ├─ .window-body > .screen（<Transition name="screen"> 装载）│ │
│ └────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────┘
.toast（底部居中提示，role="status"，2.5 s 自动消失）
```

- **主题**：98.css 负责窗口/标题栏/按钮/输入框/进度条等 Win98 观感；`src/index.css` 只补布局与打字区（`.panel` 透明化，边框交给窗口）
- **字体**：外壳用 98.css 的 `'Pixelated MS Sans Serif', Tahoma`；打字区/统计/报告数值用等宽 `var(--mono)`（Consolas → Courier New）
- **导航**：工具栏 `◀ Back`（`api.back()`，跳过 typing/input）与 `⌂ Main Menu`，快捷键 `Alt+←` / `Alt+Home`；主菜单下两个按钮禁用

### 7.2 打字区

| 元素 | 类名 / 表现 |
| --- | --- |
| 行号 | `.line-indicator` → `Line X/Y` |
| 引导行 | `.lesson-text`（白底等宽）：`.done` 灰 `#9a9a9a` / `.current` 蓝底 `#000080` 白字反白 / `.err` 红底 `#c00`（标记**打错的那一格** `posInLine - 1`，与输入行红显同格） |
| 指针 | `.lesson-pointer`：红色 `▲` 绝对定位到下一字符（`offsetTop/offsetLeft`，折行不漂移，80 ms 过渡） |
| 输入行 | `.typed-line`：与引导行逐字符对齐（空格占位），`.typed` 正常 / `.err` 红底白字 |
| 光标 | `.blink-block`：半透明蓝块（`rgba(0,0,128,.35)`）定位到第 `posInLine` 个字符，`kf-blink` 闪烁 |
| 指法提示 | `.finger-hint`（`fingerText(focusKey)`，蓝色居中） |
| 指令框 / 统计 | `.instruction-box`（浅黄 `#ffffcc`，仅第一行显示）→ 之后 `.stats-row` |
| 进度 | `.progress` 分段蓝填充（`repeating-linear-gradient`）+ `.progress-label` 百分比 |
| 键盘图 | 内嵌 `KeyboardGraphic`：课程键高亮 + 焦点键高亮（keypad 课切 4 5 6 / 7 8 9 / 1 2 3 0 . +） |

```text
Line 1/10
┌──────────────────────────────────────┐
│  as sa as sa as sa ...              │  ← 引导行（done 灰 / current 反白）
│  ▲                                  │  ← 指针（字符 DOM 对齐）
│  ────────────────────────────────    │
│  as·sa·as                            │  ← 输入行（空格显示 ·，打错的字符红显）
└──────────────────────────────────────┘
Use the little finger of the left hand to strike the 'a' key.  ← 指法提示
Type the line above. ...  ← 指令框（之后转为实时统计）
[内嵌键盘图]  [进度条 + 百分比]
```

### 7.3 其他屏幕与响应式

- **菜单**：`.menu` + `.menu-item.selected`（蓝底反白）+ `.menu-desc` 说明行；键盘高亮与鼠标 hover 同步
- **摘要 / 报告**：`.summary-body` / `.report-body` 点线分隔的「标签 — 数值」行；速度/准确率屏附 `<canvas>` 按会话柱状图
- **长文本**（介绍 / 帮助 / 欢迎屏）：`.scroll-text` 白底可滚动，逐段渲染
- **模态 / 提示**：`.modal-overlay` + `.modal-window`（`BaseModal`，Esc 或按钮关闭）；`.toast`（底部居中淡入，`aria-live="polite"`）
- **键盘图**（`KeyboardGraphic`）：默认 `tabindex="-1"`（装饰性，避免 60+ 个按钮进 Tab 序），指法屏（`show-finger`）可聚焦并带 `aria-label`（键位 + 手指），外层 `role="group"` + `aria-label`
- **响应式**：桌面优先；`@media (max-width: 640px)` 只减小桌面 padding、窗口占满宽度、缩小打字字体与统计间距（防溢出，不重排布局）
- Canvas 图表按容器宽度自适应（CSS `width:100%; height:auto`）；backing store = CSS 宽 × `devicePixelRatio`（上限 2），绘制坐标仍用 CSS px（`setTransform`），HiDPI 下不模糊

## 8. 设计差异

| 常见做法 | 本实现 | 原因 |
| --- | --- | --- |
| 二进制历史文件 | localStorage JSON 单档案 | 浏览器无文件系统 |
| 79 字节紧凑记录 | JSON 对象 | 可读性 / 可扩展性 |
| 单色 / 彩色文本模式 | 98.css Win98 桌面风格（浅色主题） | 现代显示环境下的复古观感 |
| IIFE 全局单例 | provide/inject + 纯 TS 引擎层 | Vue 3 组合式统一架构 |
| 静态词表课程 | 运行时频率表生成器（参考语义） | 自适应薄弱键加权 |
| 平行 7 门课程 | 64 键顺序课程 + 掌握推进（参考语义） | 教学验证过的引入序列 |
| 以分钟计时长 | drills 数（5/10/15/20） | 以「每课几行」表达练习量 |

以下机制**有意不支持**（多学生、教师模式、游戏等），见 §9.3。

## 9. 机制说明（实现落点）

> 本章记录课程引擎各机制的用途与代码落点，不依赖外部资料即可维护。

### 9.1 引擎机制

| 机制 | 实现落点 | 说明 |
| --- | --- | --- |
| 64 键引入顺序 | `constants.ts` `LESSON_KEY_ORDER` | 顺序完全一致：`asdfjkl;eit.nro,hcpumygwvbxqz'":?!()-4738291056=$+%&*#@<>/[]{}^_` |
| 课程键集 = 顺序前缀 | `lessonKeys(keyIndex)` | 课程 N 的键集 = 前缀（含本课新键） |
| 小键盘顺序 | `KEYPAD_ORDER` | `4567891230.+` |
| 频率表更新 | `lesson.ts` `updateFrequency` | 正确 `(freq >> 5) + freq + 1`（缓慢增长）；错误 `(2040 / wpm) * 3 + (freq >> 2)`（大幅提升）。**参考实现、运行时未调用**（见 §9.3） |
| 会话频率表初始化 | `useKeyFlow.ts` `initFreq` | 由终身每键错键数加权（错键 × 10，cap `0xff`）→ 薄弱键更多出现 |
| 文本生成器 | `genLessonText` | 3 字符组（加权、组内无重复、组内洗牌）+ 空格，每行 ~28 字符（7 组） |
| 大写模式 | `UPPERCASE_FROM = 8` + `ShiftIntroScreen` | 课程 ≥ 9 启用（`keyIndex >= 8`）；行内约 30% 字母随机大写 |
| 新键引入屏 | `NewKeyIntroScreen` + `KeyboardGraphic` | 键位高亮 + 指法文字，可跳过 |
| 指法属性表 | `FINGER_ATTR` + `fingerText` | 键 → 手/手指（touch typing 标准指法） |
| Finger Positioning Lesson | `FingerIntroScreen` | 指法说明屏（非打字课） |
| 打字循环 | `useTypingSession` | 按行推进；打错前进并标红；Backspace 只回退、不撤销统计 |
| 每键统计 | `KeyStats`（64 项，索引 = 引入顺序） | attempts / correct / errors / elapsedMs，终身累计 |
| 掌握判定 | `isMastered` + `masteredSet` | 尝试 ≥ 30、准确率 ≥ 80%、每键 WPM ≥ 15（会话与终身双查） |
| 课程推进 | `shouldAdvance` + `startLesson` | 键集内未掌握键 < 4 → 引入新键（`currentKeyIndex + 1`） |
| 焦点键 | `pickFocusKey` | 优先 home 键中未掌握者，否则课程内第一个未掌握者 |
| 会话 WPM | `computeWpm` | `(correct + errors − 2×lines) / 5 / 分钟` |
| 终身平均 WPM | `computeLifetimeWpm` | `(totalChars + totalCorrect − 2×totalErrors) / 5 / 总分钟`（惩罚错误）。**公式已实现但 UI 未使用**：档案未存 totalChars / totalCorrect，欢迎屏用周均值 `avgWpm` |
| 准确率 | `computeAccuracy` | `correct / (correct + errors) × 100` |
| Best Keys / Keys to Work on | `analyzeKeys` | 按每键 WPM 排序取 Top 3 / Bottom 3（会话增量驱动） |
| Keys Above N WPM | `analyzeKeys.keysAbove`、`keyClassBreakdown.keysAbove` | 每键 WPM ≥ 15 的计数 |
| 课程摘要六项 + 三选一 | `SummaryScreen` | Speed / Accuracy / Keys Above N / Best Keys / Keys to Work on / 焦点键；Continue lessons / Take a practice test / End of Lesson |
| 注册向导 | `SetupScreen` + `InitialTestScreen` | 姓名 → 日期 → 经验水平（Beginner / Two-finger / Touch typist） |
| 初始目标 | `student.ts` `initialGoal` + Options | 速度 `clamp(20, 120, wpm + 10)`；练习按经验 30 / 45 / 60 分钟每周；准确率 90 |
| 周目标对比 | `weekHours7` + `welcomeMessage` + `MainMenuScreen` | 7 周滚动窗口累计分钟 vs `practiceGoal` |
| 会话日志 | `sessionLog`（`MAX_LOG = 200`） | date / kind(lesson, test, initial) / wpm / acc / minutes |
| 登录进度报告 | `WelcomeBackScreen` + `welcomeMessage` | 逐段展示，任意键继续 |
| 进度报告 | `ReportScreen`（`kind = 'progress'`） | 当前速度 / 目标 / 本周练习量 + 键类 Breakdown |
| 速度 / 准确率分析 | `useSessionChart.drawSessionChart` | 按会话柱状图（最多 40 根，Y 轴刻度 + 目标线）；平均 / 最后 / 最大 / 目标 + 会话历史列表 |
| drills 数（5 的倍数） | `DRILL_CHOICES = [5, 10, 15, 20]` | 默认 `DEFAULT_DRILLS = 10` |

### 9.2 界面文案与交互对齐

| 界面要素 | KeyFlow 实现 | 说明 |
| --- | --- | --- |
| 菜单结构 | 保留垂直菜单（`KeyFlowMenu`） | Main = Lessons / Tests / Reports / Options / Help / Quit；子菜单无 Return；Esc 返回 |
| Help 项 | `HelpScreen`（`HELP_PAGES` 翻页） | 菜单说明文本 |
| 选择器 / 文本输入屏 | `KeyFlowMenu` / 各屏 `<form>` | 交互等价（↑↓ / Enter / Esc，鼠标与 Tab 为第二通道） |
| 练习页键盘图 | `TypingScreen` 内嵌 `KeyboardGraphic` | 课程键高亮 + 焦点键高亮 |
| 练习页指法提示行 | `.finger-hint`（`fingerText(focusKey)`） | 焦点键的标准指法文案 |
| 练习页指令框 | `.instruction-box` | 首行显示指令，之后显示实时统计 |
| 欢迎屏进度报告 | `WelcomeBackScreen` | 多段文案（见 §9.1） |
| End of Lesson 横幅 | `SummaryScreen` 标题切换 | 全部 64 键掌握时标题改为 End of Lesson |
| 小键盘课 | `KeyboardGraphic` keypad 模式 + `KeypadIntroScreen` | 键盘图 4 5 6 / 7 8 9 / 1 2 3 0 . + |
| 报告四屏 | Reports = Progress / Speed / Accuracy / Help | |
| 按会话图 | `drawSessionChart` | 按会话柱状图（最多 40 根，Y 轴刻度 + 目标线） |
| 速度 Breakdown | `keyClassBreakdown` | Letter / Number / Symbol 每键 WPM 均值 + Keys Above N |

### 9.3 有意不支持

| 候选功能 | 决策 | 理由 |
| --- | --- | --- |
| 8 学生注册与多学生档案 | 保持单用户 | 应用即档案；无多学生/汇总需求 |
| 教师模式（密码门 / 教师菜单 / 课程文件加密） | 不支持 | 无教学管理场景；自定义测试文件（Disk Test）同理 |
| Letter Invaders 街机游戏 | 不支持 | 定位为练习工具；设计稿仅作留档，不进路线图 |
| 词库（游戏用） | 不引入 | 无游戏即无词库需求；课程文本由生成器产出 |
| 会话内逐行自适应（频率表跨行回灌） | 用「会话频率表由终身错键初始化」代替 | 文本一次性生成、无法逐行反馈；以「薄弱键更多出现」实现同等价值 |
| 每键 WPM 阈值按课程缩放 | 固定 15 WPM | 复杂度/收益比低；后续需要时可再缩放 |
| 双人模式 | 不支持 | 单用户 |
| 声音（PC 喇叭蜂鸣） | 不支持 | 浏览器自动播放策略；产品保持静默 |

### 9.4 验证

引擎语义的回归靠三组检查（命令见 `implementation.md` §4）：

| 检查 | 覆盖 |
| --- | --- |
| `npx vitest run games/keyflow` | `lesson.test.ts`：WPM/准确率公式、掌握边界、生成器键集与频率加权、推进判定、键类 Breakdown；`student.test.ts`：经验水平目标、周索引、`weekHours7`、欢迎文案 |
| `npx playwright test games/keyflow/e2e` | 首次运行引导、种子直进主菜单、课程流程、整行推进、报告、重置确认、模态键盘通道隔离、焦点键隔离 |
| `npx vue-tsc --noEmit -p games/keyflow/tsconfig.app.json` | 类型收窄（`ViewName` 19 屏、`ReportKind` 三类） |
