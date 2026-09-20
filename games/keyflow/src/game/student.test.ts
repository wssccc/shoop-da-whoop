import { describe, expect, it } from 'vitest';
import { blankProfile } from '../storage';
import {
    avgAcc,
    avgWpm,
    daysSinceLast,
    getWeekIndex,
    initialGoal,
    practiceGoalFor,
    sessionUpdate,
    todayStr,
    validateDate,
    weekHours7,
    weekMinutes,
    welcomeMessage,
} from './student';

describe('student', () => {
  it('todayStr is MM-DD-YY', () => {
    expect(todayStr()).toMatch(/^\d{2}-\d{2}-\d{2}$/);
  });

  it('validateDate accepts real dates and rejects garbage', () => {
    expect(validateDate('08-23-26')).toBe(true);
    expect(validateDate('13-01-26')).toBe(false);
    expect(validateDate('01-32-26')).toBe(false);
    expect(validateDate('nope')).toBe(false);
  });

  it('practiceGoalFor scales with experience', () => {
    expect(practiceGoalFor('beginner')).toBe(30);
    expect(practiceGoalFor('two-finger')).toBe(45);
    expect(practiceGoalFor('touch')).toBe(60);
  });

  it('initialGoal clamps speed and sets goals by experience', () => {
    const g = initialGoal(50, 'touch');
    expect(g.speedGoal).toBe(60); // clamped ≤ 120
    expect(g.practiceGoal).toBe(60); // touch → 60 min
    expect(g.accuracyGoal).toBe(90);
    const b = initialGoal(10, 'beginner');
    expect(b.speedGoal).toBe(20); // clamped ≥ 20
    expect(b.practiceGoal).toBe(30); // beginner → 30 min
  });

  it('getWeekIndex is within 0..51', () => {
    const w = getWeekIndex();
    expect(w).toBeGreaterThanOrEqual(0);
    expect(w).toBeLessThanOrEqual(51);
  });

  it('sessionUpdate writes the current week and appends log', () => {
    const s = blankProfile({ name: 'Alice' });
    const patch = sessionUpdate(s, 30, 95, 5, 'lesson');
    expect(patch.wpm).toBe(30);
    expect(patch.acc).toBe(95);
    const week = getWeekIndex();
    expect(patch.weeklyWpm?.[week]).toBe(30);
    expect(patch.weeklyMinutes?.[week]).toBe(5);
    expect(patch.totalWeeks).toBe(1); // first practice this week
    expect(patch.date).toBe(todayStr());
    expect(patch.sessionLog?.length).toBe(1);
    expect(patch.sessionLog?.[0]).toMatchObject({ kind: 'lesson', wpm: 30, acc: 95, minutes: 5 });
  });

  it('sessionUpdate does not double-count weeks', () => {
    const s = blankProfile({ name: 'Alice' });
    const week = getWeekIndex();
    s.weeklyMinutes[week] = 10;
    const patch = sessionUpdate(s, 30, 95, 5, 'lesson');
    expect(patch.totalWeeks).toBeUndefined(); // already practiced this week
    expect(patch.weeklyMinutes?.[week]).toBe(15);
  });

  it('weekMinutes aggregates the current week', () => {
    const s = blankProfile({ name: 'Alice' });
    const week = getWeekIndex();
    s.weeklyMinutes[week] = 25;
    expect(weekMinutes(s)).toBe(25);
  });

  it('welcomeMessage returns multi-paragraph progress report', () => {
    const s = blankProfile({ name: 'Alice', practiceGoal: 30 });
    const paras = welcomeMessage(s);
    expect(paras[0]).toContain('Welcome back');
    expect(paras.join('\n')).toContain('was a while ago');
    expect(paras[paras.length - 1]).toContain('Options');
    // 有练习记录：周目标对比 + 速度目标段落
    const week = getWeekIndex();
    s.weeklyMinutes[week] = 30;
    s.weeklyWpm[week] = 40;
    s.speedGoal = 30;
    const paras2 = welcomeMessage(s);
    expect(paras2.join('\n')).toContain('weekly target of');
    expect(paras2.join('\n')).toContain('WPM goal');
  });

  it('weekHours7 sums the rolling 7-week window', () => {
    const s = blankProfile({ name: 'Alice' });
    const week = getWeekIndex();
    s.weeklyMinutes[week] = 60;
    s.weeklyMinutes[(week - 1 + 52) % 52] = 120;
    expect(weekHours7(s)).toBe(3); // (60+120)/60
  });

  it('avgWpm / avgAcc average only weeks with data', () => {
    const s = blankProfile({ name: 'Alice' });
    const week = getWeekIndex();
    s.weeklyWpm[week] = 30;
    s.weeklyWpm[(week - 1 + 52) % 52] = 50;
    s.weeklyAcc[week] = 90;
    expect(avgWpm(s)).toBe(40);
    expect(avgAcc(s)).toBe(90);
  });

  it('daysSinceLast is Infinity without a session', () => {
    const s = blankProfile({ name: 'Alice' });
    expect(daysSinceLast(s)).toBe(Infinity);
    s.lastSession = Date.now();
    expect(daysSinceLast(s)).toBe(0);
  });
});
