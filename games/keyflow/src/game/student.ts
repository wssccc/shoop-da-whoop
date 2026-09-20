import { MAX_LOG, WEEKS } from './constants';
import type { Experience, ProfileRecord, SessionLogEntry } from './types';

/** MM-DD-YY 格式，月/日补零，年份取后两位。 */
export function todayStr(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const yy = String(d.getFullYear()).slice(2);
  return `${mm}-${dd}-${yy}`;
}

/** 校验 MM-DD-YY：正则 + 月 1-12 / 日 1-31。 */
export function validateDate(s: string): boolean {
  const m = /^(\d{2})-(\d{2})-(\d{2})$/.exec(s.trim());
  if (!m) return false;
  const mo = parseInt(m[1], 10);
  const da = parseInt(m[2], 10);
  return mo >= 1 && mo <= 12 && da >= 1 && da <= 31;
}

/** 经验水平 → 默认练习目标（分钟/周）：Beginner 30 / Two-finger 45 / Touch 60。 */
export function practiceGoalFor(exp: Experience): number {
  return exp === 'beginner' ? 30 : exp === 'two-finger' ? 45 : 60;
}

/**
 * 初始测试后设置目标（注册向导语义）：
 * 速度 = clamp(20,120,wpm+10)；练习目标按经验水平；准确率目标默认 90。
 */
export function initialGoal(
  wpm: number,
  experience: Experience = 'beginner',
): { speedGoal: number; practiceGoal: number; accuracyGoal: number } {
  return {
    speedGoal: Math.max(20, Math.min(120, wpm + 10)),
    practiceGoal: practiceGoalFor(experience),
    accuracyGoal: 90,
  };
}

/** 当年第几周（0-51）。 */
export function getWeekIndex(): number {
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 1);
  const days = Math.floor((now.getTime() - start.getTime()) / 86400000);
  return Math.min(51, Math.floor(days / 7));
}

/** 本周累计练习分钟（从 weeklyMinutes 聚合）。 */
export function weekMinutes(s: ProfileRecord): number {
  const week = getWeekIndex();
  return s.weeklyMinutes[week] ?? 0;
}

/** 最近 7 周累计练习分钟（滚动 7 周窗口）。 */
export function weekHours7(s: ProfileRecord): number {
  const week = getWeekIndex();
  let total = 0;
  for (let i = 0; i < 7; i++) {
    total += s.weeklyMinutes[(week - i + WEEKS) % WEEKS] ?? 0;
  }
  return total / 60;
}

/** 平均速度（有记录的周）。 */
export function avgWpm(s: ProfileRecord): number {
  const withData = s.weeklyWpm.filter(v => v > 0);
  if (withData.length === 0) return 0;
  return Math.round(withData.reduce((a, b) => a + b, 0) / withData.length);
}

/** 平均准确率（有记录的周）。 */
export function avgAcc(s: ProfileRecord): number {
  const withData = s.weeklyAcc.filter(v => v > 0);
  if (withData.length === 0) return 0;
  return Math.round(withData.reduce((a, b) => a + b, 0) / withData.length);
}

/** 距上次会话的天数（无记录返回 Infinity）。 */
export function daysSinceLast(s: ProfileRecord): number {
  if (!s.lastSession) return Infinity;
  return Math.floor((Date.now() - s.lastSession) / 86400000);
}

/**
 * 欢迎/进度报告多段文案：按「距上次练习 / 本周练习量 vs 目标 / 平均速度 vs 速度目标」
 * 三个条件各自增段，每段独立成行（WelcomeBackScreen 逐段显示）。
 */
export function welcomeMessage(s: ProfileRecord): string[] {
  const out: string[] = [];
  out.push('Welcome back to KeyFlow!');
  if (daysSinceLast(s) > 3) {
    out.push(
      'Your last session was a while ago, and starting again is the part that counts. Today is a good day to begin.',
    );
  }
  out.push('A few minutes at the keyboard on most days goes further than one long session every so often.');
  const hours = weekHours7(s);
  if (hours > 0) {
    out.push(`Last week you put in ${hours.toFixed(1)} hours of typing.`);
    const goalHours = s.practiceGoal / 60;
    if (hours >= goalHours) {
      out.push(
        `Your weekly target of ${goalHours} hours is met. Time on the keyboard is what turns into speed.`,
      );
    } else {
      out.push(
        `Another ${(goalHours - hours).toFixed(1)} hours this week would reach your ${goalHours} hour target.`,
      );
    }
  }
  const avg = avgWpm(s);
  if (avg > 0) {
    out.push(`Average speed ${avg} WPM at ${avgAcc(s)}% accuracy.`);
    if (avg >= s.speedGoal) {
      out.push(`That is at or above the ${s.speedGoal} WPM goal you set.`);
    } else {
      out.push(`Your ${s.speedGoal} WPM goal is still ahead of you - keep the sessions coming.`);
    }
  }
  out.push('Goals can be changed at any time from the Options menu.');
  return out;
}

/** 记录一次练习会话：返回要应用到档案上的更新字段。 */
export function sessionUpdate(
  s: ProfileRecord,
  wpm: number,
  acc: number,
  minutes: number,
  kind: SessionLogEntry['kind'],
): Partial<ProfileRecord> {
  const week = getWeekIndex();
  const patch: Partial<ProfileRecord> = {
    wpm,
    acc,
    totalMin: s.totalMin + minutes,
    lastSession: Date.now(),
    date: todayStr(),
    weeklyWpm: s.weeklyWpm.slice(),
    weeklyAcc: s.weeklyAcc.slice(),
    weeklyMinutes: s.weeklyMinutes.slice(),
    sessionLog: s.sessionLog.slice(),
  };
  if (patch.weeklyWpm) patch.weeklyWpm[week] = Math.max(patch.weeklyWpm[week], wpm);
  if (patch.weeklyAcc) patch.weeklyAcc[week] = acc;
  if (patch.weeklyMinutes) patch.weeklyMinutes[week] = (patch.weeklyMinutes[week] ?? 0) + minutes;
  // 周数：本周首次练习才 +1（修复原 totalWeeks 从不递增的 bug）
  const wasPracticed = (s.weeklyMinutes[week] ?? 0) > 0;
  if (!wasPracticed) patch.totalWeeks = s.totalWeeks + 1;
  // 会话日志：追加并截断到 MAX_LOG
  if (patch.sessionLog) {
    patch.sessionLog.push({ date: todayStr(), kind, wpm, acc, minutes });
    if (patch.sessionLog.length > MAX_LOG) patch.sessionLog = patch.sessionLog.slice(-MAX_LOG);
  }
  return patch;
}
