// Achievement tracking. Two flavours, both driven by constants.ACHIEVEMENTS:
//   type 'count'   → cumulative finished games (`stats.games`) ≥ threshold
//   type 'guesses' → a single game won in `guesses` ≤ threshold
// Extends solitaire's count-only achievements.js with a per-game "skill" axis.

import { ACHIEVEMENTS } from './constants.js';
import { Storage } from './storage.js';

/**
 * Check achievements against the current stats and the guesses it took to win
 * the just-finished game.
 *
 * @param {{games:number, total:number, best:number|null}} stats
 * @param {number|null} guesses  guesses used in the just-won game (null if not a win)
 * @param {(achv: object) => void} onUnlock  called for each newly-unlocked one
 * @returns {object[]} the list of newly-unlocked achievements
 */
export function checkAchievements(stats, guesses, onUnlock = () => {}) {
  const unlocked = Storage.getAchievements();
  const newly = [];

  for (const a of ACHIEVEMENTS) {
    if (unlocked[a.id]) continue;

    let achieved = false;
    if (a.type === 'count') {
      achieved = stats.games >= a.threshold;
    } else if (a.type === 'guesses') {
      achieved = guesses != null && guesses <= a.threshold;
    }

    if (achieved) {
      unlocked[a.id] = true;
      newly.push(a);
    }
  }

  if (newly.length) Storage.setAchievements(unlocked);
  newly.forEach(onUnlock);
  return newly;
}

/** Full definition list (for any future viewer page). */
export function allAchievements() { return ACHIEVEMENTS; }

/** Map of currently-unlocked achievement ids → true. */
export function unlockedList() { return Storage.getAchievements(); }
