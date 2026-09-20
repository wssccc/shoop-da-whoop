import { DEFAULT_DRILLS, LESSON_KEY_ORDER, MAX_LOG, WEEKS } from './game/constants';
import type { Experience, KeyStats, ProfileRecord, SessionLogEntry } from './game/types';

/**
 * 数据存储层 —— 单用户模式：整个档案存为 `keyflow_profile_v2` 单对象。
 * v2：新增 keyStats/sessionLog/weeklyMinutes/experience/accuracyGoal/drills/currentKeyIndex。
 * 旧 v1 档案作废（不读取，用户明确决策）。
 * load 时归一化：合并默认值 + 浅校验，坏档安全降级（返回 null）。
 */
const KEY = 'keyflow_profile_v2';

function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}
function weeks(v: unknown, fallback: (i: number) => number): number[] {
  const arr = Array.isArray(v) ? v : [];
  return Array.from({ length: WEEKS }, (_, i) => num(arr[i], fallback(i)));
}
function blankKeyStats(): KeyStats {
  return { attempts: 0, correct: 0, errors: 0, elapsedMs: 0 };
}
function keyStatsArr(v: unknown): KeyStats[] {
  const arr = Array.isArray(v) ? v : [];
  return Array.from({ length: LESSON_KEY_ORDER.length }, (_, i) => {
    const r = arr[i] as Partial<KeyStats> | undefined;
    return {
      attempts: num(r?.attempts, 0),
      correct: num(r?.correct, 0),
      errors: num(r?.errors, 0),
      elapsedMs: num(r?.elapsedMs, 0),
    };
  });
}
function sessionLogArr(v: unknown): SessionLogEntry[] {
  const arr = Array.isArray(v) ? v : [];
  return arr
    .filter((e): e is SessionLogEntry => typeof e === 'object' && e !== null && typeof (e as SessionLogEntry).wpm === 'number')
    .slice(-MAX_LOG);
}

/** 生成默认档案。 */
export function blankProfile(overrides: Partial<ProfileRecord> = {}): ProfileRecord {
  return {
    name: '',
    date: '',
    experience: 'beginner',
    speedGoal: 40,
    practiceGoal: 30,
    accuracyGoal: 90,
    drills: DEFAULT_DRILLS,
    wpm: 0,
    acc: 100,
    totalMin: 0,
    totalWeeks: 0,
    weeklyWpm: new Array(WEEKS).fill(0),
    weeklyAcc: new Array(WEEKS).fill(0),
    weeklyMinutes: new Array(WEEKS).fill(0),
    keyStats: Array.from({ length: LESSON_KEY_ORDER.length }, blankKeyStats),
    sessionLog: [],
    currentKeyIndex: 0,
    shiftIntroDone: false,
    created: Date.now(),
    lastSession: 0,
    introDone: false,
    ...overrides,
  };
}

function normalizeProfile(raw: unknown): ProfileRecord | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Partial<ProfileRecord>;
  if (typeof r.name !== 'string' || !r.name) return null;
  const exp: Experience =
    r.experience === 'two-finger' || r.experience === 'touch' ? r.experience : 'beginner';
  return blankProfile({
    name: r.name,
    date: typeof r.date === 'string' ? r.date : '',
    experience: exp,
    speedGoal: num(r.speedGoal, 40),
    practiceGoal: num(r.practiceGoal, 30),
    accuracyGoal: num(r.accuracyGoal, 90),
    drills: num(r.drills, DEFAULT_DRILLS),
    wpm: num(r.wpm, 0),
    acc: num(r.acc, 100),
    totalMin: num(r.totalMin, 0),
    totalWeeks: num(r.totalWeeks, 0),
    weeklyWpm: weeks(r.weeklyWpm, () => 0),
    weeklyAcc: weeks(r.weeklyAcc, () => 0),
    weeklyMinutes: weeks(r.weeklyMinutes, () => 0),
    keyStats: keyStatsArr(r.keyStats),
    sessionLog: sessionLogArr(r.sessionLog),
    currentKeyIndex: Math.max(0, Math.min(LESSON_KEY_ORDER.length - 1, num(r.currentKeyIndex, 0))),
    shiftIntroDone: r.shiftIntroDone === true,
    created: num(r.created, Date.now()),
    lastSession: num(r.lastSession, 0),
    introDone: r.introDone === true,
  });
}

export function loadProfile(): ProfileRecord | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    return normalizeProfile(JSON.parse(raw));
  } catch {
    return null;
  }
}

/** 落盘。localStorage 在隐私模式/配额超限时会抛异常，这里必须吞掉：
 *  会话结束时（`recordSession`/`completeSession`）的写入失败不能中断交互。 */
export function saveProfile(p: ProfileRecord): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* 存储不可用：内存中的档案继续工作，本次不落盘 */
  }
}

/** 清空当前档案（重置/重新引导用）。 */
export function clearProfile(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* 存储不可用：忽略 */
  }
}
