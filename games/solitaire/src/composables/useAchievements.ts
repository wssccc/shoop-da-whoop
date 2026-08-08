// Achievement tracking UI bridge.
//
// Watches the win counter from `useSolitaireGame`, runs the milestone check,
// and pushes "unlocked" toasts through the imperative toast store
// (lib/toaster.ts, rendered by <Toaster/>). Exposes the persisted-but-still-
// locked state for an achievements badge.

import { checkAchievements } from '@solitaire/game/achievements';
import { ACHIEVEMENTS } from '@solitaire/game/constants';
import { toast } from '@solitaire/lib/toaster';
import { Storage } from '@solitaire/storage';
import { computed, ref, watch, type Ref } from 'vue';

export function useAchievements(wins: Ref<number>) {
  const unlockedMap = ref<Record<string, boolean>>({ ...Storage.getAchievements() });

  const unlockedCount = computed(
    () => Object.values(unlockedMap.value).filter(Boolean).length,
  );

  // Check on every win-count change (fires once after engine.onWin bumps it).
  watch(wins, (w) => {
    const newly = checkAchievements(w, (a) => toast({ title: a.name }));
    if (newly.length) {
      unlockedMap.value = { ...Storage.getAchievements() };
    }
  });

  return {
    /** All achievement definitions (for an eventual list view). */
    all: ACHIEVEMENTS,
    unlockedMap,
    unlockedCount,
  };
}

export type AchievementsApi = ReturnType<typeof useAchievements>;
