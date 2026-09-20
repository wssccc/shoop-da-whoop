# KeyFlow — 打字训练应用

纯静态网页实现的**单用户**打字训练应用：首次运行引导建档，之后"练习课程、测试、
进度报告、速度/准确率图表、选项设置"。UI 采用 **Windows 98 复古桌面风格（98.css）**，
交互现代化（模态对话框、全局通知、屏幕转场、表单语义与键盘/鼠标双通道导航）。
基于 **Vue 3 + TypeScript** 实现，纳入 Shoop Da Whoop 的 MPA 单仓构建体系。

## 文档

| 文档 | 内容 |
| --- | --- |
| `docs/design.md` | 设计文档（Vue 架构、视图状态机、数据模型、课程引擎、事件管理、UI、机制说明） |
| `docs/implementation.md` | 实现文档（模块细节、算法、构建接线、验证基线、调试记录、扩展指南） |
| `docs/product.md` | 产品文档（功能清单、使用指南、FAQ、已知限制） |

## 运行

项目位于 Shoop Da Whoop 单仓，从仓库根目录运行：

```bash
npm run dev            # 开发：http://localhost:5173/games/keyflow/
npm run build          # 生产构建（含 plugin-legacy 双包）
npm run typecheck      # vue-tsc 类型检查
npm run test           # vitest 引擎单测
npm run test:e2e       # playwright e2e 冒烟
```

## 技术栈

- **Vue 3.5**（Composition API，`<script setup lang="ts">`）
- **TypeScript 5.9**（strict）
- **Vite**（MPA 多页应用，`@vitejs/plugin-legacy` 产出 legacy 双包）
- **98.css**（Windows 98 复古桌面设计系统，纯 CSS、语义化 HTML；npm 依赖，`main.ts` 导入）
- **Vitest**（引擎单测）+ **Playwright**（e2e）

## 目录结构

```text
games/keyflow/
├── index.html                Vue 入口页
├── src/
│   ├── main.ts               入口：createApp(App).mount('#root') + 98.css 样式导入
│   ├── App.vue               provide(useKeyFlow) + 桌面/窗口外壳 + 屏幕分发
│   ├── storage.ts            localStorage 数据层（单档案 keyflow_profile_v2）
│   ├── composables/          useKeyFlow / useTypingSession / useSessionChart
│   ├── components/
│   │   ├── BaseModal.vue     98 风格模态对话框（替代原生 confirm）
│   │   ├── KeyFlowMenu.vue   通用菜单（真 <button> + 焦点管理）
│   │   ├── KeyboardGraphic.vue 键盘图（课程键高亮/新键/指法悬停）
│   │   └── screens/*         19 个屏幕组件
│   └── game/                 （纯 TS 引擎层，无 Vue/DOM，可单测）
├── e2e/                      Playwright 冒烟测试
└── docs/                     设计 / 实现 / 产品 / 任务文档
```
