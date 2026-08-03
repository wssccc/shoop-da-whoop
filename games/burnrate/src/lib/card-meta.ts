/**
 * card-meta — shared UI metadata for card kinds (OA label pills + names).
 * Mirrors burn-rate.html's six-colour tag system:
 *   行动紫 / 技术绿 / 员工蓝 / 财务黄(VP) / 坏项目红 / 市场橙 / 顾问粉
 */
import type { Card, ProjectSubtype } from '@burnrate/game/types';

export interface KindMeta {
  tag: string;
  name: string;
  icon: string;
}

const PROJECT_SUB: Record<ProjectSubtype, KindMeta> = {
  tech: { tag: 'tag-tech', name: '技术', icon: '🔧' },
  bad: { tag: 'tag-bad', name: '烂尾', icon: '☠️' },
  market: { tag: 'tag-market', name: '市场', icon: '📢' },
};

/** OA label pill class + display name for any card. */
export function kindMeta(card: Card): KindMeta {
  switch (card.kind) {
    case 'vp':
      return { tag: 'tag-finance', name: 'VP', icon: '🎩' };
    case 'staff':
      return { tag: 'tag-staff', name: '员工', icon: '👤' };
    case 'project':
      return PROJECT_SUB[card.subtype];
    case 'action':
      return { tag: 'tag-action', name: '行动', icon: '⚡' };
    case 'consultant':
      return { tag: 'tag-consultant', name: '顾问', icon: '💼' };
  }
}

/** 卡面短名：项目卡名称尾部的括号描述（如 `(2技能)`、`(烧$5M/轮)`、
 *  `(奖$13M)`）与卡面角标/badge 重复，卡面上只保留名称主体；
 *  完整名称仍用于详情弹窗与 hover 提示。 */
export function shortName(card: Card): string {
  return card.kind === 'project' ? card.name.replace(/\s*\([^)]*\)\s*$/, '') : card.name;
}
