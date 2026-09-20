import { ref, type InjectionKey } from 'vue';
import {
    DEFAULT_DRILLS,
    LESSON_KEY_ORDER,
    TESTS,
    UPPERCASE_FROM,
    lessonName,
} from '../game/constants';
import {
    genLessonText,
    keyIndex,
    masteredSet,
    pickFocusKey,
    shouldAdvance,
} from '../game/lesson';
import { initialGoal, practiceGoalFor, sessionUpdate, todayStr, validateDate } from '../game/student';
import type { Experience, ProfileRecord, ReportKind, SessionResult, ViewName } from '../game/types';
import * as Store from '../storage';

export interface InputConfig {
  title: string;
  prompt: string;
  value: string;
  min?: number;
  max?: number;
  type?: 'text' | 'password';
  onSubmit: (v: string) => void;
  onCancel: () => void;
}

/** 会话类型：lesson 课程 / test 测试 / initial 初始测试（驱动日志 kind）。 */
export type SessionKind = 'lesson' | 'test' | 'initial';

/**
 * 中心编排 composable —— 单用户模式的状态机（单档案版）。
 * 持有全部应用状态（单个档案 / 当前视图 / 待展示总结 / 课程推进状态），
 * 通过 `go(view)` 切换屏幕，并封装所有导航与数据动作。
 * App.vue 调用一次并 provide，各屏幕组件 inject。
 */
export function useKeyFlow() {
  const profile = ref<ProfileRecord | null>(null);
  const view = ref<ViewName>('boot');
  const pendingSummary = ref<SessionResult | null>(null);
  const pendingSummaryTitle = ref('');
  const session = ref<{ title: string; lines: string[]; kind: SessionKind } | null>(null);
  const reportKind = ref<ReportKind>('progress');
  const inputConfig = ref<InputConfig | null>(null);
  const notice = ref('');
  const setupMode = ref<'setup' | 'edit'>('setup');
  /** 导航历史栈（工具栏 Back 用）。 */
  const history = ref<ViewName[]>([]);
  /** 会话频率表（课程开始时由终身每键统计初始化，驱动生成器加权）。 */
  const freqTable = ref<number[]>([]);
  /** 新键引入信息（newKeyIntro 屏显示）。 */
  const newKeyInfo = ref<{ key: string; lesson: number } | null>(null);
  /** 当前焦点键（摘要 Current Focus Keys 显示）。 */
  const focusKey = ref<string | null>(null);

  function refresh() {
    profile.value = Store.loadProfile();
  }
  function go(v: ViewName) {
    if (view.value !== v) {
      history.value.push(view.value);
      if (history.value.length > 30) history.value.shift();
    }
    view.value = v;
  }
  function back() {
    while (history.value.length > 0) {
      const prev = history.value.pop()!;
      if (prev === 'typing' || prev === 'input') continue;
      view.value = prev;
      return;
    }
    view.value = 'mainMenu';
  }
  function goMainMenu() {
    go('mainMenu');
  }
  function today(): string {
    return todayStr();
  }

  // ── 建档 / 编辑档案 ──
  function openSetup(mode: 'setup' | 'edit') {
    setupMode.value = mode;
    go('setup');
  }

  // ── boot / 流程入口 ──
  // 无档案 → 首次设置；有档案且未完成引导 → intro；已完成 → 欢迎屏 → 主菜单。
  function start() {
    refresh();
    if (!profile.value) {
      openSetup('setup');
      return;
    }
    go(profile.value.introDone ? 'welcomeBack' : 'intro');
  }

  function setupProfile(name: string, date: string, experience: Experience): string | null {
    const trimmed = name.trim();
    if (!trimmed) return 'Enter a name to continue';
    if (!validateDate(date)) return 'Use MM-DD-YY for today\'s date';
    const rec = Store.blankProfile({
      name: trimmed,
      date: date || todayStr(),
      experience,
      practiceGoal: practiceGoalFor(experience),
      created: Date.now(),
    });
    Store.saveProfile(rec);
    profile.value = rec;
    return null;
  }
  function editProfile(name: string, date: string): string | null {
    if (!profile.value) return null;
    const trimmed = name.trim();
    if (!trimmed) return 'Enter a name to continue';
    if (!validateDate(date)) return 'Use MM-DD-YY for today\'s date';
    profile.value.name = trimmed;
    profile.value.date = date || todayStr();
    Store.saveProfile(profile.value);
    return null;
  }

  // ── 课程推进（参考语义）──
  function mastered(): Set<string> {
    return profile.value ? masteredSet(profile.value.keyStats) : new Set();
  }

  /** 会话频率表：由终身每键统计初始化（错键权重高 → 薄弱键更多出现）。 */
  function initFreq(): number[] {
    const freq = new Array<number>(LESSON_KEY_ORDER.length).fill(0);
    if (profile.value) {
      profile.value.keyStats.forEach((s, i) => {
        if (s.errors > 0) freq[i] = Math.min(0xff, s.errors * 10);
      });
    }
    return freq;
  }

  /** 开始顺序课程：检查推进 → 新键引入屏 / Shift 屏 → 打字。 */
  function startLesson() {
    if (!profile.value) return;
    const ki = profile.value.currentKeyIndex;
    const m = mastered();
    // 推进：键集中未掌握键 < 4 且未到最后一键（规则：count < 4 → 引入新键）
    if (shouldAdvance(ki, m) && ki < LESSON_KEY_ORDER.length - 1) {
      profile.value.currentKeyIndex = ki + 1;
      newKeyInfo.value = { key: LESSON_KEY_ORDER[ki + 1], lesson: ki + 2 };
      Store.saveProfile(profile.value);
      go('newKeyIntro');
      return;
    }
    // Shift 说明屏：首次进入大写课程时只显示一次
    if (ki >= UPPERCASE_FROM && !profile.value.shiftIntroDone) {
      profile.value.shiftIntroDone = true;
      Store.saveProfile(profile.value);
      go('shiftIntro');
      return;
    }
    beginTyping('lesson');
  }

  /** 新键引入屏 / Shift 屏确认后开始打字。 */
  function beginAfterIntro() {
    beginTyping('lesson');
  }

  /** 开始打字会话（顺序课程）。 */
  function beginTyping(kind: SessionKind) {
    if (!profile.value) return;
    const ki = profile.value.currentKeyIndex;
    focusKey.value = pickFocusKey(ki, mastered());
    freqTable.value = initFreq();
    const lines = genLessonText(ki, profile.value.drills, freqTable.value);
    session.value = { title: lessonName(ki), lines, kind };
    go('typing');
  }

  /** 特殊课程：keypad / all-keys / finger（指法说明屏）。 */
  function startSpecialLesson(kind: 'keypad' | 'all' | 'finger') {
    if (kind === 'finger') {
      go('fingerIntro');
      return;
    }
    if (kind === 'keypad') {
      go('keypadIntro');
      return;
    }
    if (!profile.value) return;
    freqTable.value = initFreq();
    focusKey.value = null; // 非顺序课程：不继承上一课的焦点键
    const lines = genLessonText(LESSON_KEY_ORDER.length - 1, profile.value.drills, freqTable.value, { uppercase: true });
    session.value = { title: 'All-keys', lines, kind: 'lesson' };
    go('typing');
  }

  /** keypad 说明屏确认后开始 keypad 打字。 */
  function beginKeypadLesson() {
    if (!profile.value) return;
    freqTable.value = initFreq();
    focusKey.value = null; // 小键盘课不属于顺序课程：无焦点键
    const lines = genLessonText(profile.value.currentKeyIndex, profile.value.drills, freqTable.value, { keypad: true });
    session.value = { title: 'Keypad Lesson', lines, kind: 'lesson' };
    go('typing');
  }

  /** 测试：practice 用当前键集生成（摘要屏的 Practice test 入口）；
   *  keypad 用小键盘顺序生成；其余取 `TESTS` 的固定文本。
   *  测试一律不设焦点键（不属于顺序课程）。 */
  function startTest(testId: string) {
    if (!profile.value) return;
    focusKey.value = null;
    const ki = profile.value.currentKeyIndex;
    const fixed = TESTS.find((t) => t.id === testId);
    if (fixed) {
      session.value = { title: fixed.name, lines: [fixed.text], kind: 'test' };
    } else {
      const keypad = testId === 'keypad';
      freqTable.value = initFreq();
      const lines = genLessonText(
        ki,
        profile.value.drills,
        freqTable.value,
        keypad ? { keypad: true } : {},
      );
      session.value = { title: keypad ? 'Keypad Test' : 'Practice Test', lines, kind: 'test' };
    }
    go('typing');
  }

  // ── 会话记录（课程/测试/初始测试共用）──
  function recordSession(result: SessionResult, kind: SessionKind) {
    if (!profile.value) return;
    // 终身每键统计累加（终身累计，跨会话保留）
    const ks = profile.value.keyStats.slice();
    for (const [ch, d] of Object.entries(result.keyDeltas)) {
      const idx = keyIndex(ch);
      if (idx < 0) continue;
      const s = ks[idx];
      ks[idx] = {
        attempts: s.attempts + d.correct + d.errors,
        correct: s.correct + d.correct,
        errors: s.errors + d.errors,
        elapsedMs: s.elapsedMs + result.minutes * 60000,
      };
    }
    profile.value.keyStats = ks;
    // 周/日志/总量更新
    const patch = sessionUpdate(profile.value, result.wpm, result.acc, result.minutes, kind);
    Object.assign(profile.value, patch);
    Store.saveProfile(profile.value);
  }

  // 初始测试完成 → 设目标（按经验水平）+ 记录会话 + 标记引导完成 → 主菜单
  function completeInitialTest(result: SessionResult) {
    if (!profile.value) return;
    profile.value.wpm = result.wpm;
    profile.value.acc = result.acc;
    const { speedGoal, practiceGoal, accuracyGoal } = initialGoal(result.wpm, profile.value.experience);
    profile.value.speedGoal = speedGoal;
    profile.value.practiceGoal = practiceGoal;
    profile.value.accuracyGoal = accuracyGoal;
    recordSession(result, 'initial');
    profile.value.introDone = true;
    Store.saveProfile(profile.value);
    go('mainMenu');
  }
  // 跳过初始测试 → 仍标记引导完成，下次直接进主菜单
  function skipInitialTest() {
    if (profile.value) {
      profile.value.introDone = true;
      Store.saveProfile(profile.value);
    }
    go('mainMenu');
  }
  function retakeInitialTest() {
    go('initialTest');
  }

  // 重置档案（清空并重新走首次引导）
  function resetProfile() {
    Store.clearProfile();
    profile.value = null;
    openSetup('setup');
  }

  // 课程/测试完成 → 记录会话 → 展示总结
  function completeSession(result: SessionResult, title: string, kind: SessionKind) {
    recordSession(result, kind);
    pendingSummary.value = result;
    pendingSummaryTitle.value = title;
    go('summary');
  }
  function clearSummary() {
    pendingSummary.value = null;
    pendingSummaryTitle.value = '';
  }
  function summaryValue(): SessionResult | null {
    return pendingSummary.value;
  }
  function summaryTitle(): string {
    return pendingSummaryTitle.value;
  }

  // ── 摘要三选一（Keyboard Lesson Summary）──
  function continueLessons() {
    clearSummary();
    startLesson();
  }
  function takeTest() {
    clearSummary();
    startTest('practice');
  }
  function endLesson() {
    clearSummary();
    go('mainMenu');
  }

  // ── 选项 ──
  function persist() {
    if (profile.value) Store.saveProfile(profile.value);
  }
  function setSpeedGoal(v: number) {
    if (profile.value) {
      profile.value.speedGoal = v;
      persist();
    }
  }
  function setPracticeGoal(v: number) {
    if (profile.value) {
      profile.value.practiceGoal = v;
      persist();
    }
  }
  function setAccuracyGoal(v: number) {
    if (profile.value) {
      profile.value.accuracyGoal = v;
      persist();
    }
  }
  function setDrills(v: number) {
    if (profile.value) {
      profile.value.drills = v;
      persist();
    }
  }
  function reviewIntro() {
    go('intro');
  }

  // ── 退出 ──
  function exit() {
    persist();
    go('boot');
  }

  function currentDrills(): number {
    return profile.value?.drills ?? DEFAULT_DRILLS;
  }

  // ── 会话（打字练习/测试）──
  function startSession(title: string, lines: string[], kind: SessionKind) {
    focusKey.value = null; // 自由会话（如初始测试）：无焦点键
    session.value = { title, lines, kind };
    go('typing');
  }

  // ── 报告 ──
  function openReport(kind: ReportKind) {
    reportKind.value = kind;
    go('report');
  }

  // ── 数值/文本输入 ──
  function openInput(cfg: InputConfig) {
    inputConfig.value = cfg;
    go('input');
  }
  function closeInput() {
    inputConfig.value = null;
  }

  // ── 短暂提示（替代 alert）──
  function notify(msg: string) {
    notice.value = msg;
    setTimeout(() => { notice.value = ''; }, 2500);
  }

  return {
    profile,
    view,
    session,
    reportKind,
    inputConfig,
    notice,
    setupMode,
    newKeyInfo,
    focusKey,
    go,
    back,
    goMainMenu,
    start,
    today,
    openSetup,
    setupProfile,
    editProfile,
    completeInitialTest,
    skipInitialTest,
    retakeInitialTest,
    completeSession,
    clearSummary,
    summaryValue,
    summaryTitle,
    continueLessons,
    takeTest,
    endLesson,
    startLesson,
    beginAfterIntro,
    startSpecialLesson,
    beginKeypadLesson,
    startTest,
    startSession,
    openReport,
    openInput,
    closeInput,
    notify,
    setSpeedGoal,
    setPracticeGoal,
    setAccuracyGoal,
    setDrills,
    reviewIntro,
    resetProfile,
    exit,
    currentDrills,
  };
}

export type KeyFlowApi = ReturnType<typeof useKeyFlow>;

/** provide/inject 令牌：App.vue 注入，各屏幕组件消费。 */
export const KeyFlowKey: InjectionKey<KeyFlowApi> = Symbol('keyflow');
