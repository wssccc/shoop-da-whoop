// Achievement tracking UI bridge — watches the end-of-game payload from
// `useBurnRateGame`, runs the milestone check, pushes live "unlocked" toasts
// (rendered via AnimatePresence), and exposes the persisted unlock map.

import { ACHIEVEMENTS, checkAchievements, type Achievement } from '@burnrate/game/achievements';
import { Storage } from '@burnrate/storage';
import { computed, ref, watch } from 'vue';
import type { BurnRateGameApi } from './useBurnRateGame';

export interface AchievementToast {
  key: string;
  achievement: Achievement;
}

export function useAchievements(game: BurnRateGameApi) {
  const unlockedMap = ref<Record<string, boolean>>({ ...Storage.getAchievements() });
  const toasts = ref<AchievementToast[]>([]);

  const unlockedCount = computed(
    () => Object.values(unlockedMap.value).filter(Boolean).length,
  );

  function pushToast(achievement: Achievement): void {
    const key = `${achievement.id}-${Date.now()}`;
    toasts.value.push({ key, achievement });
    setTimeout(() => dismissToast(key), 3400);
  }

  function dismissToast(key: string): void {
    toasts.value = toasts.value.filter((t) => t.key !== key);
  }

  watch(
    () => game.lastGameOver.value,
    (g) => {
      if (!g) return;
      const newly = checkAchievements(g.stats, pushToast);
      if (newly.length) {
        unlockedMap.value = { ...Storage.getAchievements() };
      }
    },
  );

  return {
    all: ACHIEVEMENTS,
    unlockedMap,
    unlockedCount,
    toasts,
    dismissToast,
  };
}

export type AchievementsApi = ReturnType<typeof useAchievements>;
