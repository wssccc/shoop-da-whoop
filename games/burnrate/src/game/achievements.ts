// Achievement definitions + pure milestone detection.
//
// Detection is driven by a per-game stats snapshot (assembled by the UI layer
// from engine.onLog counters + end-of-game results) plus the cumulative win
// count. Mirrors solitaire's `game/achievements.ts` pattern: pure function +
// injected unlock callback; persistence lives in `storage.ts`.

import { Storage } from '../storage';

export interface Achievement {
  id: string;
  name: string;
  desc: string;
  icon: string;
}

export const ACHIEVEMENTS: Achievement[] = [
  { id: 'first-win', name: '第一桶金', desc: '赢得第一场对局', icon: '🪙' },
  { id: 'wins-10', name: '行业新贵', desc: '累计赢得 10 场对局', icon: '📈' },
  { id: 'wins-50', name: '独角兽猎手', desc: '累计赢得 50 场对局', icon: '🦄' },
  { id: 'wins-100', name: '并购之王', desc: '累计赢得 100 场对局', icon: '👑' },
  { id: 'bad-bomb', name: '烂尾大亨', desc: '一局内把 3 个烂尾项目塞给对手', icon: '💣' },
  { id: 'project-master', name: '项目收割机', desc: '一局内完成 5 个项目', icon: '🏗️' },
  { id: 'audit-kill', name: '审计风暴', desc: '用审计让对手当回合破产', icon: '⚡' },
  { id: 'rich-win', name: '现金奶牛', desc: '胜利时自己仍有 150M 现金', icon: '🐄' },
  { id: 'hr-massacre', name: '裁员滚滚', desc: '一局内裁员 3 次', icon: '✂️' },
  { id: 'headhunter-x', name: '猎头之王', desc: '一局内使用 3 次猎头', icon: '🎯' },
  { id: 'vp-quad', name: '完整董事会', desc: '一局内集齐全部 4 位 VP', icon: '🏛️' },
  { id: 'poach-king', name: '挖角狂魔', desc: '一局内挖角 3 次', icon: '🦹' },
  { id: 'phoenix', name: '涅槃', desc: '触发紧急融资续命后最终获胜', icon: '🚑' },
  { id: 'pie-master', name: '画饼大师', desc: '一局内用画大饼废弃 2 个烂尾项目', icon: '🥧' },
  { id: 'underdog', name: '咸鱼翻身', desc: '曾成为全场现金最低的玩家，最终翻盘获胜', icon: '🐟' },
];

/** Per-game stats assembled by the UI layer at game end. */
export interface GameStats {
  /** Cumulative win count (persisted across sessions). */
  wins: number;
  /** Whether this game ended in a human win. */
  won: boolean;
  /** Human cash at game end (bankrupt = 0 or less). */
  finalCash: number;
  badAssigned: number;
  projectsCompleted: number;
  layoffs: number;
  headhunters: number;
  consultantsSent: number;
  /** Human won because the foe was Audited and went bankrupt same turn. */
  auditKill: boolean;
  vpsHired: number;
  poaches: number;
  /** Human triggered the one-time emergency bailout this game. */
  bailoutUsed: boolean;
  /** 画大饼 burnouts performed by the human this game. */
  burnouts: number;
  /** Human was ever the strictly-lowest cash player (comeback flag). */
  wasStrictLowest: boolean;
}

/**
 * Check milestone conditions against `stats`. Calls `onUnlock(achv)` for each
 * newly unlocked one and persists. Returns the newly unlocked list.
 */
export function checkAchievements(
  stats: GameStats,
  onUnlock: (achv: Achievement) => void = () => {},
): Achievement[] {
  const unlocked = Storage.getAchievements();
  const newly: Achievement[] = [];
  const maybe = (id: string, cond: boolean) => {
    if (!cond || unlocked[id]) return;
    unlocked[id] = true;
    const a = ACHIEVEMENTS.find((x) => x.id === id);
    if (a) newly.push(a);
  };

  maybe('first-win', stats.wins >= 1);
  maybe('wins-10', stats.wins >= 10);
  maybe('wins-50', stats.wins >= 50);
  maybe('wins-100', stats.wins >= 100);
  maybe('bad-bomb', stats.badAssigned >= 3);
  maybe('project-master', stats.projectsCompleted >= 5);
  maybe('audit-kill', stats.auditKill);
  maybe('rich-win', stats.won && stats.finalCash >= 150);
  maybe('hr-massacre', stats.layoffs >= 3);
  maybe('headhunter-x', stats.headhunters >= 3);
  maybe('vp-quad', stats.vpsHired >= 4);
  maybe('poach-king', stats.poaches >= 3);
  maybe('phoenix', stats.won && stats.bailoutUsed);
  maybe('pie-master', stats.burnouts >= 2);
  maybe('underdog', stats.won && stats.wasStrictLowest);

  if (newly.length) Storage.setAchievements(unlocked);
  newly.forEach(onUnlock);
  return newly;
}
