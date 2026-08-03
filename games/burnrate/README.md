# 烧钱计划 Burn Rate

多人卡牌对战游戏（1 人类 + 1-4 AI）：让所有对手公司现金烧到破产。

## 运行

```bash
npm run dev            # http://localhost:8000/games/burnrate/
npm run typecheck      # vue-tsc 类型检查（含本游戏）
npm test               # 游戏逻辑单元测试（src/game/**/*.test.ts）
npm run bench:burnrate # MCTS vs 启发式对打基准（BENCH_GAMES/BENCH_ITER 可调）
npm run bench:burnrate:mass # 4 人全启发式批量自对弈（默认 1 万局，可设 BENCH_GAMES）
```

## 文档

| 文档 | 内容 |
| --- | --- |
| [`docs/rules.md`](docs/rules.md) | 玩法规则书：156 张牌构成、回合流程、结算、可玩性 House Rules（代码以此为基线） |
| [`docs/impl.md`](docs/impl.md) | 架构：目录结构、数据模型、引擎、AI、成就、基准、兼容性 |

## 特点

- 全量动画：发牌/抽牌飞行、打牌 motion FLIP、AI 逐张表演（MCTS 思考指示）
- 自动存档：版本化，每步持久化，刷新后"继续对局"恢复（含 AI 难度配置）
- 成就系统：15 项成就（多人下仍以人类视角结算）
- 可玩性 House Rules：落后补牌 / 紧急融资 / 固定开销与尾局加速 / 手牌上限 / 烂尾自救（止损+画大饼）/ 通用弃牌 / 项目无 VP 门槛 + 对应 VP 加成 / HR 挡箭牌 + 挖角费用（HR VP 被挖即作废）/ 裁员高层内斗
- 测试：`src/game/**/*.test.ts`（Vitest，109 用例，含全 AI 冒烟对局、MCTS 单测与批量自对弈基准）
- iOS 13 / Safari 13 兼容（@vitejs/plugin-legacy 双包 + classic worker + 硬化 CSS）

## 一句话架构

纯 TS 游戏内核（`src/game/`，零 DOM）由 `useBurnRateGame` 编排、接 Vue 层；
`BurnRateEngine` 原地改 `GameState`（`players` 数组，0=人类），每步经
`afterChange` 重发布 + 持久化；AI 经 `createAiAdapter(difficulty)` 工厂映射
random / 启发式 / IS-MCTS，MCTS 跑 classic worker。详见
[`docs/impl.md`](docs/impl.md)。
