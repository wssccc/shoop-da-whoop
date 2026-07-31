// Achievement tracking driven by the cumulative win count.

import { Storage } from '../storage';
import { ACHIEVEMENTS, type Achievement } from './constants';

/**
 * Check win-count milestones. Calls `onUnlock(achv)` for each newly unlocked one.
 * Returns the list of newly unlocked achievements.
 */
export function checkAchievements(
  wins: number,
  onUnlock: (achv: Achievement) => void = () => {},
): Achievement[] {
  const unlocked = Storage.getAchievements();
  const newly: Achievement[] = [];
  for (const a of ACHIEVEMENTS) {
    if (wins >= a.threshold && !unlocked[a.id]) {
      unlocked[a.id] = true;
      newly.push(a);
    }
  }
  if (newly.length) Storage.setAchievements(unlocked);
  newly.forEach(onUnlock);
  return newly;
}

export function unlockedList() {
  return Storage.getAchievements();
}
