/** 经验水平（注册向导：Beginner / Two finger / Touch typist）。 */
export type Experience = 'beginner' | 'two-finger' | 'touch';

/** 每键统计（会话或终身记录，索引 = LESSON_KEY_ORDER 位置）。 */
export interface KeyStats {
  attempts: number;
  correct: number;
  errors: number;
  elapsedMs: number;
}

/** 会话日志条目（date, kind, WPM, accuracy）。 */
export interface SessionLogEntry {
  /** MM-DD-YY */
  date: string;
  kind: 'lesson' | 'test' | 'initial';
  wpm: number;
  acc: number;
  minutes: number;
}

/** 单用户档案 —— 单个对象持久化到 `keyflow_profile_v2`。 */
export interface ProfileRecord {
  name: string;
  /** 上次练习日期 MM-DD-YY */
  date: string;
  /** 经验水平（注册向导选择） */
  experience: Experience;
  /** 速度目标 WPM */
  speedGoal: number;
  /** 练习目标 分钟/周 */
  practiceGoal: number;
  /** 准确率目标 %（默认 90） */
  accuracyGoal: number;
  /** 课程 drills 数（每课行数，5 的倍数） */
  drills: number;
  /** 当前速度 WPM */
  wpm: number;
  /** 当前准确率 % */
  acc: number;
  /** 累计练习分钟 */
  totalMin: number;
  /** 累计练习周数 */
  totalWeeks: number;
  /** 每周速度记录（52 项） */
  weeklyWpm: number[];
  /** 每周准确率记录（52 项） */
  weeklyAcc: number[];
  /** 每周练习分钟（52 项，驱动周目标对比） */
  weeklyMinutes: number[];
  /** 每键统计（64 项，索引 = LESSON_KEY_ORDER 位置；终身累计） */
  keyStats: KeyStats[];
  /** 会话日志（最近 MAX_LOG 条） */
  sessionLog: SessionLogEntry[];
  /** 当前课程键索引（0-63） */
  currentKeyIndex: number;
  /** Shift 说明屏是否已看过 */
  shiftIntroDone: boolean;
  /** 创建时间戳 */
  created: number;
  /** 上次会话时间戳 */
  lastSession: number;
  /** 首次引导（intro + initial test）是否已完成 —— 完成后每次启动直进主菜单 */
  introDone: boolean;
}

/** 一次打字会话的结果。 */
export interface SessionResult {
  wpm: number;
  acc: number;
  minutes: number;
  total: number;
  correct: number;
  errors: number;
  /** 行数（WPM 参考公式的 -2×lines 项用） */
  lines: number;
  bestKeys: string;
  weakKeys: string;
  /** Keys Above N WPM 计数 */
  keysAbove: number;
  /** 每键增量（correct/errors），驱动频率表与每键统计 */
  keyDeltas: Record<string, { correct: number; errors: number }>;
}

/** 课程定义：特殊课程（不参与顺序推进）。顺序课程由 lessonKeys(keyIndex) 动态生成。 */
export interface Lesson {
  id: string;
  name: string;
  desc: string;
  kind: 'keypad' | 'all' | 'finger';
}

export interface TestDef {
  /** 测试 id（`useKeyFlow.startTest` 按此取用固定文本）。 */
  id: string;
  name: string;
  text: string;
}

/** 报告类型：progress 进度（含键类 Breakdown）/ speed 速度报告 / acc 准确率报告。 */
export type ReportKind = 'progress' | 'speed' | 'acc';

/** 屏幕视图名 —— 对应 App.vue 的动态组件切换。 */
export type ViewName =
  | 'boot'
  | 'setup'
  | 'intro'
  | 'initialTest'
  | 'typing'
  | 'summary'
  | 'mainMenu'
  | 'lessonsMenu'
  | 'testsMenu'
  | 'reportsMenu'
  | 'optionsMenu'
  | 'input'
  | 'report'
  | 'newKeyIntro'
  | 'shiftIntro'
  | 'fingerIntro'
  | 'help'
  | 'welcomeBack'
  | 'keypadIntro';
