// Achievement tracking UI bridge.
//
// Watches the win counter from `useSolitaireGame`, runs the milestone check,
// pushes live "unlocked" toasts (rendered by <Toaster/> via AnimatePresence),
// and exposes the persisted-but-still-locked-state for an achievements badge.

import { checkAchievements } from '@solitaire/game/achievements';
import { ACHIEVEMENTS, type Achievement } from '@solitaire/game/constants';
import { Storage } from '@solitaire/storage';
import { computed, ref, watch, type Ref } from 'vue';

export interface AchievementToast {
  /** Unique key for `<Transition>` / `AnimatePresence` tracking. */
  key: string;
  achievement: Achievement;
}

export function useAchievements(wins: Ref<number>) {
  const unlockedMap = ref<Record<string, boolean>>({ ...Storage.getAchievements() });
  const toasts = ref<AchievementToast[]>([]);

  const unlockedCount = computed(
    () => Object.values(unlockedMap.value).filter(Boolean).length,
  );

  function pushToast(achievement: Achievement): void {
    const key = `${achievement.id}-${Date.now()}`;
    toasts.value.push({ key, achievement });
    // Auto-dismiss after ~3.2s (mirrors original CSS toast-out animation duration).
    setTimeout(() => dismissToast(key), 3200);
  }

  function dismissToast(key: string): void {
    toasts.value = toasts.value.filter((t) => t.key !== key);
  }

  // Check on every win-count change (fires once after engine.onWin bumps it).
  watch(wins, (w) => {
    const newly = checkAchievements(w, pushToast);
    if (newly.length) {
      unlockedMap.value = { ...Storage.getAchievements() };
    }
  });

  return {
    /** All achievement definitions (for an eventual list view). */
    all: ACHIEVEMENTS,
    unlockedMap,
    unlockedCount,
    toasts,
    dismissToast,
  };
}

export type AchievementsApi = ReturnType<typeof useAchievements>;
