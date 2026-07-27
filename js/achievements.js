// Achievement tracking driven by the cumulative win count.

import { ACHIEVEMENTS } from './constants.js';
import { Storage } from './storage.js';

// Check win-count milestones. Calls `onUnlock(achv)` for each newly unlocked one.
export function checkAchievements(wins, onUnlock = () => {}) {
  const unlocked = Storage.getAchievements();
  const newly = [];
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

export function unlockedList() { return Storage.getAchievements(); }
