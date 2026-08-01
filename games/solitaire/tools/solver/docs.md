# 纸牌接龙解搜索器 · 技术文档

本目录（`games/solitaire/tools/solver/`）是纸牌接龙（Solitaire）的解搜索工具：
输入一个 40 张牌的初始布局，输出可复现的中文解法步骤（含自动归位与 ★ 关键步标记），
并做重放校验。**零第三方依赖**，纯 Node ESM，规则 1:1 移植自游戏源码
`games/solitaire/src/game/`（rules.ts / engine.ts / types.ts / deck.ts / constants.ts）。

```text
solve.js ── CLI 入口（求解 → 压缩 → 格式化 → 校验）
   │
   ├─ search.js    DFS + 转置表 + 前瞻启发式 + beam 迭代搜索
   ├─ compress.js  输出前压缩：四通道去重（环/停车/逆对/单步可逆）到不动点，逐次重放验证
   ├─ format.js    中文步骤格式化 + ★关键步标记 + 重放校验
   │
   └─ rules.js     规则引擎（纯函数，无副作用）
       parse.js    布局文本解析（方向约定 + 40 张牌完整性校验）

   layout.txt      当前布局输入（8 行 × 5 token）
   *.test.js       规则 / 压缩 / 关键步 单测（node --test）
```

---

## 1. 数据模型

与 `src/game/types.ts` 的 `Board` 完全一致：

```js
// 牌对象
{ id, type: 'number', color: 'red'|'black'|'green', rank: 1..9 }   // 数字牌
{ id, type: 'dragon', color }                                      // 龙牌（w=黑萬 f=绿發 z=红中）
{ id: 'flower', type: 'flower' }                                   // 花牌

// 状态（不可变语义：搜索/压缩中每次改动前 cloneState 深拷贝）
{
  tableau:     Card[][],        // 8 列；col[last] = 列顶（可抓取牌）
  freeCells:   (Card | DragonPile | null)[],   // 3 个空闲格
  foundations: { red: Card[], black: Card[], green: Card[] },  // 终局槽（rank 升序）
  flowerSlot:  Card | null,     // 花牌位
}
// DragonPile（收龙后的锁定龙堆，永久占用一个空闲格）
{ type: 'dragonpile', locked: true, color, cards: DragonCard[] }
```

### 布局方向约定（重要，曾被指正两次）

`layout.txt` 中**每行 = 一列，从左到右 = 从牌堆底（最先发出、画面里该列最上方）
到牌堆顶（可抓取的"最外层"牌，画面里该列最下方、露出整张）**。
**行最右边的 token 是这一列玩家能抓到的牌**，直接对应游戏内部数组顺序
（`deck.deal()` 的 push 顺序：`col[0]` = 先发的牌 = 画面顶部），**解析时不反转**。

例：第 8 行 `z g7 g2 b2 f` → 牌堆底 `z`（红中）→ 绿7 → 绿2 → 黑2 → 牌堆顶 `f`（绿发，
可抓取）；"黑2 的外面（更外层）"正是这张发。

token 语法：`rN/bN/gN` = 红/黑/绿数字牌；`w` = 黑龍（萬）、`f` = 绿龍（發）、
`z` = 红龍（中）、`h` = 花。另兼容无颜色旧格式（每个 rank 按出现顺序分配 r/b/g）。

---

## 2. 规则引擎 `rules.js`

纯函数，与 `src/game/rules.ts` 1:1 对应：

| 函数 | 说明 |
| --- | --- |
| `canStack(moving, target)` | 可叠放：数字牌、`target.rank === moving.rank + 1`、颜色不同 |
| `isValidRun(cards)` | 递减 + 颜色交替的合法连牌序列 |
| `validDropTargets(state, run, src)` | 合法落点：列（空列 / 顶非龙可叠）、空闲格（仅单张）、终局槽（单张且 rank-1 已就位）、花牌位 |
| `topRunStart(col)` | 列顶最长合法连牌起点（整叠移动容量不限，无需空闲格中转） |
| `isSafeNumber(state, card)` | "安全"：本色槽到 rank-1 且**其他两色槽都 ≥ rank-1**（自动入槽不会阻断牌序） |
| `nextAutoMove(state)` | 下一个自动归位：花先飞；再取 rank 最小的安全数字入槽 |
| `runAutoMoves(state)` | 自动归位收敛（flower → 花牌位、safe → 终局槽），返回动作列表 |
| `allDragonsOfColorExposed` / `canCollectDragons` | 某色 4 龙全暴露（列顶或空闲格）且有槽位（空槽或同色龙槽可合并） |
| `commitUserMove` / `commitCollect` | 应用用户动作（移动 / 收龙），假定已通过合法性检查 |
| `stateKey(state)` | 状态键：**同色龙视为可互换**（`d+color`），用于转置表去重 |
| `isWin(state)` | 三色终局槽各 1..9 全满 + 花入位 + 场上无龙（龙堆不算） |
| `genUserMoves(state)` | 生成全部候选用户动作并按启发式排序（见 §4） |

关键语义（与引擎一致）：**每次用户动作后强制收敛自动归位**（`runAutoMoves`），
即搜索图的每个节点 = 一个用户动作 + 其自动归位级联后的状态。

---

## 3. 搜索 `search.js`

### 状态图

- 节点：`(棋盘 + 自动归位已收敛)` 的完整状态；边的标签 = 用户动作（移动/收龙）。
- **visited 转置表**：以 `stateKey` 去重。状态的完整后继集是确定性的，
  因此"首次访问即足以找到任一胜利路径"；环与重复状态被剪枝。
- ⚠️ **关键实现细节**：显式栈 DFS 在**入栈前必须 `visited.add(ch.k)`**。
  曾因漏加导致同一子树被反复重走、节点预算耗尽也无法收敛（27M 节点无解），
  修复后 30 秒内出解——教训已固化在代码注释中。

### 移动生成与启发式排序（`genUserMoves` + `buildChildren`）

- 动作集：每列顶部的**最长合法连牌整体**、各子后缀（单张抓取）、空闲格单张、收龙；
  已自动归位可覆盖的候选（安全入槽、花飞花位）不再生成，避免冗余分支。
- 剪枝：整列移到空列 = 纯列名换标（对称性），永远无益，直接剪掉。
- 排序（`buildChildren` 对每个候选做**一阶前瞻**）：
  - 基础分来自 `scoreMove`（收龙 0 > 入槽 1 > 整叠叠放 2 > 单张叠放 3 > 空列 2/6 > 空闲格停车 7）
  - 减去 `自动归位数量 × 40`（触发入槽/飞花 ≈ 必然进展）
  - 减去 `收龙 15`、`新暴露龙数 × 12`（龙是最大路障，暴露它优先）

### beam 迭代 + 随机重启（`DEFAULT_ATTEMPTS`）

```js
[ { beam: 8,  ...60s }, { beam: 24, ...120s }, { beam: 0, ...240s },   // 全量兜底
  { beam: 12, random: true, ...120s }, { beam: 12, random: true, ...120s } ]
```

窄 beam 先快速找解；失败则加宽，最终全量遍历保证不因 beam 截断永久漏解；
随机重启（对 beam 内候选取乱序）提供路径多样性。预算：节点数 + 墙钟时间，
超预算返回 `{ ok:false, reason:'budget' }`，附 `bestProgress`（终局槽数 + 收龙色数×12 + 花×5，上限 68）供诊断。

### 定制目标（`goal` 选项）

`solve(initial, { goal: (state) => bool })` 可改判目标，用于可达性探针
（例如"能否收集任意龙色"、"终局槽 ≥ 15"）——求解必要条件的快速验证。

---

## 4. 输出前压缩 `compress.js`

beam-DFS 的"任意解"路径必然含绕路（停车再取、来回倒腾）。输出前做**四通道
压缩**，每次改写都先重放验证合法且终局胜利（`replayCheck`：逐
`validDropTargets` 校验 + `isWin`），静态推理漏掉的交互由全量重放兜底；
`removeCycles` 与 `compactDetours` **交替循环到总不动点**（任一通道的删除
可能解锁另一通道），并带不动点自检（输出后重跑全部通道断言零改动，失败回退
原始解、退出码 3）。

1. **`removeCycles` 状态环删除**：重放并记录每个步骤后的 `stateKey`；
   当某步落回已见过的状态，中间整段是"绕一圈回原点"的环，截断删除。
   ⚠️ 删除环后**必须继续处理环后的剩余步骤**（不能 break 重扫，否则环后
   步骤全丢），并同步清理 seen 中失效条目。
2. **`compactDetours` 绕路合并**（三通道，restart 到不动点）：
   - Case 1「停车再走」：`X→D` + 稍后 `X→目标`（中间无步骤触碰 D）→
     合并为 `X→目标` 直达；
   - Case 2「逆对删除」：`X→D` + `X→回原列`（位置互换 + run 内容逐张
     相等双重判定，中间不碰 D 与源位）→ 两步成对删除；
   - Case 3「单步可逆删除」：`isReversibleStep` 判定逆操作合法且其后无人
     触碰 D → 单删；若删除丢失自动级联进展（如移开牌才能让安全牌自动
     入槽）`replayCheck` 会拒绝。
3. **自动归位重建**：压缩后的用户步骤序列重新跑 `runAutoMoves`，
   输出里的"自动"行与实际行为严格一致；开局自动（`user:null` 记录）保留。

**可逆性理论**（完整规格见 `games/solitaire/docs/solver.md` 文末附录）：
操作 a 可逆 ⇔ 逆操作在移动后收敛状态
合法（`rules.js` 的 `isReversibleStep`）。压缩的目标是把解压成**局部最优
关键解**（无可删除的可逆绕路）；剩余的可逆步是必要绕路，由 CLI 的
"残留可逆步"指标量化。

实测：本局 beam 12 单档原始 56 步 → 压缩后 46 步（启发式惩罚见 §7）。

---

## 5. 格式化与 ★关键步 `format.js`

- `formatSteps(steps, snapshots, keySet)`：输出中文步骤（`[n] 移动 X（列c（顶/顶部k张））→ 目标`），
  目标带实际接收牌（如"叠在 黑7 上"），自动步缩进显示。
- `keyStepIndices`：重放解，追踪**每张牌最后一次被玩家移动**的步骤（**自动入槽不算
  "再次移动"**——否则中间的落定步永远标不出来），标记两类不可逆关键步（行首 ★）：
  1. 规则级不可逆：收龙 / 进终局槽 / 花入位（手动与自动）；
  2. **落定移动**：该步之后，被移动的牌不再被玩家移动（已放定，将随整叠归位）。
- `replay(initial, steps, {commit})`：逐步重放 + 合法性校验（`--verify` 用），
  同时产出每步前的棋盘快照供格式化引用。

---

## 6. CLI `solve.js`

```bash
node games/solitaire/tools/solver/solve.js            # 求解 + 压缩 + ★标记 + 打印
node games/solitaire/tools/solver/solve.js --verify   # 追加重放校验（失败退出码 3）
node games/solitaire/tools/solver/solve.js --json     # 输出 JSON（{ok, steps, nodes, keySize, elapsedMs}）
node games/solitaire/tools/solver/solve.js --input 其它布局.txt
node games/solitaire/tools/solver/solve.js --no-compress   # 跳过压缩
node --test "games/solitaire/tools/solver/*.test.js"  # 全部单测
```

流程：`parseLayout` → `solve`（多档 beam 迭代）→ `compressSteps`（失败回退原始解并退出码 3）
→ `replay` + `keyStepIndices` → `formatSteps` 打印。压缩行附带
"｜残留可逆步：Y"（必要绕路数，见 §4）。

环境变量：`SOLVER_MAX_DEPTH`（默认 500）。

---

## 7. 性能与经验

| 项 | 值 |
| --- | --- |
| 本局求解（beam 12 单档，确定性） | ~34s，56 步原始 → 46 步压缩（+2 可逆性惩罚启发式） |
| 无惩罚对照（旧启发式） | ~32s，379 步原始 → 259 步压缩；残留可逆步 234 vs 新 21 |
| 节点吞吐 | ~15-20 万节点/s（克隆 + 状态键字符串） |
| 随机局可解率 | ~10-30%（该游戏随机发牌、无解保证，正常现象） |
| 单测 | 25/25（rules 14 + compress 8 + format 3） |

- **确定性**：`beam 12` 单档（非 random）结果每次运行一致（排序稳定 + 无随机数），
  适合文档/CI 复现；随机档用于多样性。
- 搜索预算耗尽 ≠ 不可解（只说明预算内未找到）；"确认无解"仅在最后全量档穷尽时返回
  `reason:'no-solution'`。轻量可达性探针（`goal` 选项 + BFS 变体）可辅助判断死局，
  但**浅层 BFS（d≤14）无进展 ≠ 死局**（本局 d=21 才能收第一色龙，曾因此误判）。

## 8. 限制

- 搜索时间随布局难度波动较大；极难局面可能需要多档（最长约 11 分钟）或 `--no-compress` 调试。
- 同色龙在 `stateKey` 中视为可互换（求解正确性不受影响；输出步不区分同色 4 龙）。
- 压缩保证的是**局部最优关键解**（无可删除的可逆绕路，规格见
  `games/solitaire/docs/solver.md` 文末附录）：
  必要停车等可逆步可能残留（CLI"残留可逆步"指标量化）；贪心删除顺序也可能
  漏掉个别等价改写。严格理论版"无相邻等价状态"与"最短关键解"不可达/未实现。
- headless 浏览器中页面 `visibilityState='hidden'` 会暂停 rAF，无法用 Playwright 模拟
  游戏拖拽做 UI 级验证；引擎级重放校验（`--verify`）为最终正确性依据。
