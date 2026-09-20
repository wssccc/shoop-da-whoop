import {
    HOME_KEYS,
    KEYPAD_ORDER,
    LESSON_KEY_ORDER,
    MASTER_ACC,
    MASTER_ATTEMPTS,
    MASTER_WPM,
    UPPERCASE_FROM,
    WORDS_PER_WPM,
    lessonKeys,
} from './constants';
import type { KeyStats } from './types';

/** 可注入的随机源（默认 Math.random）。 */
export type Rng = () => number;

/** 确定性 PRNG（mulberry32）—— 测试可注入种子复现。 */
export function createRng(seed: number): Rng {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 键 → 频率表索引（LESSON_KEY_ORDER 位置；不在表中返回 -1）。 */
export function keyIndex(key: string): number {
  return LESSON_KEY_ORDER.indexOf(key.toLowerCase());
}

/** 洗牌（Fisher-Yates）。 */
function shuffle<T>(arr: T[], rng: Rng): T[] {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** 构建 3 字符组（无重复，加权选择，组内洗牌）—— 参考语义。 */
function buildGroup(keys: string, freq: number[], rng: Rng): string {
  const chosen: string[] = [];
  const pool = keys.split('');
  while (chosen.length < 3 && pool.length > 0) {
    const weights = pool.map(k => (freq[keyIndex(k)] ?? 0) + 1);
    const total = weights.reduce((a, b) => a + b, 0);
    let r = rng() * total;
    let idx = 0;
    for (let i = 0; i < pool.length; i++) {
      r -= weights[i];
      if (r <= 0) { idx = i; break; }
    }
    chosen.push(pool.splice(idx, 1)[0]);
  }
  return shuffle(chosen, rng).join('');
}

/** 大写模式：行中约 30% 的字母随机大写（大写课语义）。 */
function randomUppercase(line: string, rng: Rng): string {
  return line
    .split('')
    .map(ch => (/[a-z]/.test(ch) && rng() < 0.3 ? ch.toUpperCase() : ch))
    .join('');
}

/** 每行目标字符数：7 个 3 字符组 + 空格 ≈ 28 字符（可见宽度 ~28 列）。 */
const LINE_CHARS = 28;

/** 构建一行：3 字符组 + 空格，直到 ~28 字符 —— 参考语义。 */
function buildLine(keys: string, freq: number[], rng: Rng, uppercase: boolean): string {
  const groups: string[] = [];
  let len = 0;
  while (len < LINE_CHARS) {
    const g = buildGroup(keys, freq, rng);
    groups.push(g);
    len += g.length + 1;
  }
  let line = groups.join(' ');
  if (uppercase) line = randomUppercase(line, rng);
  return line;
}

export interface GenOptions {
  rng?: Rng;
  /** 大写模式（课程 ≥ UPPERCASE_FROM 时启用） */
  uppercase?: boolean;
  /** 小键盘模式（用 KEYPAD_ORDER） */
  keypad?: boolean;
}

/**
 * 生成课程文本：drills 行，每行由频率表加权生成的 3 字符组 + 空格组成。
 * 返回行数组（每行独立，打字会话按行推进）。
 */
export function genLessonText(
  keyIndex: number,
  drills: number,
  freq: number[],
  opts: GenOptions = {},
): string[] {
  const rng = opts.rng ?? Math.random;
  const keys = opts.keypad ? KEYPAD_ORDER : lessonKeys(keyIndex);
  const uppercase = opts.uppercase ?? keyIndex >= UPPERCASE_FROM;
  const lines: string[] = [];
  for (let d = 0; d < Math.max(1, drills); d++) {
    lines.push(buildLine(keys, freq, rng, uppercase));
  }
  return lines;
}

/**
 * 频率表更新（参考语义）：
 * - 正确：freq = (freq >> 5) + freq + 1（缓慢增长）
 * - 错误：freq = (2040 / wpm) * 3 + (freq >> 2)（大幅提升 → 下次出现更多）
 *
 * @remarks 参考实现（未接入运行时）：课程文本一次性生成，会话内无法逐行回灌频率表，
 * 因此运行时**不调用**本函数 —— 会话频率表由 `useKeyFlow.initFreq()` 按终身
 * 错键数初始化（「薄弱键更多出现」的等效替代，见 docs/design.md §9.3）。
 * 保留实现与单测作为算法参考。
 */
export function updateFrequency(freq: number[], key: string, correct: boolean, wpm: number): void {
  const idx = keyIndex(key);
  if (idx < 0) return;
  if (correct) {
    freq[idx] = (freq[idx] >> 5) + freq[idx] + 1;
  } else {
    freq[idx] = Math.floor((2040 / Math.max(1, wpm)) * 3) + (freq[idx] >> 2);
  }
}

/** 每键准确率 %。 */
export function keyAcc(s: KeyStats): number {
  const total = s.correct + s.errors;
  if (total <= 0) return 100;
  return Math.round((s.correct / total) * 100);
}

/** 每键 WPM（correct 字符 / 5 / 分钟）。 */
export function keyWpm(s: KeyStats): number {
  const mins = s.elapsedMs / 60000;
  if (mins <= 0) return 0;
  return Math.round(s.correct / WORDS_PER_WPM / mins);
}

/**
 * 掌握判定（参考语义）：尝试 ≥ 30 且准确率 ≥ 80% 且每键 WPM ≥ 阈值。
 * 会话与终身记录都需达标（调用方分别检查）。
 */
export function isMastered(s: KeyStats, threshold: number = MASTER_WPM): boolean {
  return s.attempts >= MASTER_ATTEMPTS && keyAcc(s) >= MASTER_ACC && keyWpm(s) >= threshold;
}

/**
 * 焦点键选择（参考语义）：
 * 优先 home 键中未掌握的；否则课程键集中第一个未掌握的；全部掌握返回 null。
 */
export function pickFocusKey(keyIndex: number, mastered: Set<string>): string | null {
  const keys = lessonKeys(keyIndex);
  for (const k of HOME_KEYS) {
    if (keys.includes(k) && !mastered.has(k)) return k;
  }
  for (const k of keys) {
    if (!mastered.has(k)) return k;
  }
  return null;
}

/** 课程推进判定（参考语义）：键集中未掌握键 < 4 时推进。 */
export function shouldAdvance(keyIndex: number, mastered: Set<string>): boolean {
  const keys = lessonKeys(keyIndex);
  let unmastered = 0;
  for (const k of keys) {
    if (!mastered.has(k)) unmastered++;
  }
  return unmastered < 4;
}

/** 从终身每键统计推导掌握集合。 */
export function masteredSet(keyStats: KeyStats[], threshold: number = MASTER_WPM): Set<string> {
  const out = new Set<string>();
  keyStats.forEach((s, i) => {
    if (i < LESSON_KEY_ORDER.length && isMastered(s, threshold)) {
      out.add(LESSON_KEY_ORDER[i]);
    }
  });
  return out;
}

/** WPM（参考公式）：(correct + errors - 2×lines) / 5 / 分钟。 */
export function computeWpm(correct: number, errors: number, lines: number, elapsedMs: number): number {
  const elapsed = elapsedMs / 60000;
  if (elapsed <= 0) return 0;
  const chars = correct + errors - 2 * lines;
  return Math.round(Math.max(0, chars) / WORDS_PER_WPM / elapsed);
}

/** 终身平均 WPM（参考公式）：(totalChars + totalCorrect - 2×totalErrors) / 5 / totalMinutes —— 惩罚错误。
 *
 * @remarks 公式已实现并有单测，但当前 UI **未使用**：档案只存 `totalMin`，
 * 未存 totalChars / totalCorrect（无法喂入），欢迎屏改用 `avgWpm`（有记录的周均值）。
 */
export function computeLifetimeWpm(
  totalChars: number,
  totalCorrect: number,
  totalErrors: number,
  totalMin: number,
): number {
  if (totalMin <= 0) return 0;
  const chars = totalChars + totalCorrect - 2 * totalErrors;
  return Math.round(Math.max(0, chars) / WORDS_PER_WPM / totalMin);
}

/** Accuracy% = correct / (correct + errors) × 100；未输入时 100。 */
export function computeAccuracy(correct: number, errors: number): number {
  const total = correct + errors;
  if (total <= 0) return 100;
  return Math.round((correct / total) * 100);
}

/**
 * 按键分析（基于每键 WPM：Best Keys / Keys to Work on / Keys Above N）：
 * 会话增量 deltas → Top3 / Bottom3 / Keys Above MASTER_WPM 计数。
 */
export function analyzeKeys(
  deltas: Record<string, { correct: number; errors: number }>,
  elapsedMs: number,
): { bestKeys: string; weakKeys: string; keysAbove: number } {
  const entries = Object.entries(deltas).filter(([, d]) => d.correct + d.errors > 0);
  const withWpm = entries.map(([key, d]) => ({
    key,
    wpm: computeWpm(d.correct, d.errors, 0, elapsedMs),
    // WPM 公式把错误也算作字符 → 「全对」与「一半错误」会同分，
    // 故同 WPM 时按准确率降序，Best/Weak Keys 才有区分度。
    acc: Math.round((d.correct / (d.correct + d.errors)) * 100),
  }));
  withWpm.sort((a, b) => b.wpm - a.wpm || b.acc - a.acc);
  const best = withWpm.slice(0, 3).map(e => e.key).join(' ');
  const weak = withWpm.slice(-3).map(e => e.key).join(' ');
  const keysAbove = withWpm.filter(e => e.wpm >= MASTER_WPM).length;
  return { bestKeys: best, weakKeys: weak, keysAbove };
}
/** 键类：Letter / Number / Symbol（Progress Report 速度分组）。 */
export function keyClass(ch: string): 'letter' | 'number' | 'symbol' {
  if (/[a-z]/i.test(ch)) return 'letter';
  if (/[0-9]/.test(ch)) return 'number';
  return 'symbol';
}

/**
 * 键类 Breakdown（Progress Report 速度分组）：每类（Letter/Number/Symbol）每键 WPM 均值
 * + Keys Above N WPM 计数。仅统计有尝试记录的键。
 */
export function keyClassBreakdown(
  keyStats: KeyStats[],
  threshold: number = MASTER_WPM,
): { letter: number; number: number; symbol: number; keysAbove: number } {
  const classes: Record<'letter' | 'number' | 'symbol', { wpm: number; count: number }> = {
    letter: { wpm: 0, count: 0 },
    number: { wpm: 0, count: 0 },
    symbol: { wpm: 0, count: 0 },
  };
  let keysAbove = 0;
  keyStats.forEach((s, i) => {
    if (i >= LESSON_KEY_ORDER.length || s.attempts <= 0) return;
    const w = keyWpm(s);
    const cls = keyClass(LESSON_KEY_ORDER[i]);
    classes[cls].wpm += w;
    classes[cls].count++;
    if (w >= threshold) keysAbove++;
  });
  return {
    letter: classes.letter.count ? Math.round(classes.letter.wpm / classes.letter.count) : 0,
    number: classes.number.count ? Math.round(classes.number.wpm / classes.number.count) : 0,
    symbol: classes.symbol.count ? Math.round(classes.symbol.wpm / classes.symbol.count) : 0,
    keysAbove,
  };
}