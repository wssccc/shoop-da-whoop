// Card definitions + the 156-card deck builder.
//
// `buildDeck(rng)` replaces the original HTML prototype's `buildDeck()` fixed-priority
// queue:
// every source of randomness (project stat rolls, shuffle) now flows through
// the injected `rng`, so a test can pin the exact deck (bug fix #5). Card ids
// are deterministic per build (`<key>-<seq>`), unique within a deck.

import { DECK_COUNTS, VP_SALARY, type ActionAct } from './constants';
import { defaultRng } from './rng';
import { shuffle } from './shuffle';
import type {
    ActionCard,
    Card,
    Dept,
    ProjectCard,
    Rng,
    Role,
    StaffCard,
    VPCard,
} from './types';

// ---- VP archetypes --------------------------------------------------------

const VP_ARCHETYPES: Record<Dept, { name: string; desc: string }> = {
  hr: { name: 'HR 副总裁', desc: '允许裁员；HR 挡箭牌——被挖/辞时先倒下；可清除顾问' },
  fin: { name: 'Finance 副总裁', desc: '回合末可弃牌重抽；免疫审计攻击' },
  sales: { name: 'Sales 副总裁', desc: '市场项目完成奖励+50%；项目变现为现金' },
  eng: { name: 'Engineering 副总裁', desc: '技术项目烧钱减半、完成奖励+50%；可废弃烂尾项目' },
};

const VP_DEPTS: Dept[] = ['hr', 'fin', 'sales', 'eng'];

// (key, name, role, skill) — salary equals skill for all staff (rules.md §1.2).
const STAFF_ARCHETYPES: {
  key: keyof typeof DECK_COUNTS.staff;
  name: string;
  role: Role;
  skill: number;
}[] = [
  { key: 'eng1', name: '初级工程师', role: 'eng', skill: 1 },
  { key: 'eng2', name: '中级工程师', role: 'eng', skill: 2 },
  { key: 'eng3', name: '高级工程师', role: 'eng', skill: 3 },
  { key: 'mkt1', name: '初级营销', role: 'mkt', skill: 1 },
  { key: 'mkt2', name: '中级营销', role: 'mkt', skill: 2 },
  { key: 'mkt3', name: '营销总监', role: 'mkt', skill: 3 },
  { key: 'hr1', name: 'HR 专员', role: 'hr', skill: 1 },
  { key: 'hr2', name: 'HR 经理', role: 'hr', skill: 2 },
  { key: 'fin1', name: '财务专员', role: 'fin', skill: 1 },
  { key: 'fin2', name: '财务经理', role: 'fin', skill: 2 },
];

const ACTION_DEFS: { act: ActionAct; count: number; name: string; desc: string }[] = [
  { act: 'layoff', count: DECK_COUNTS.action.layoff, name: '裁员', desc: '解雇自己的员工/VP/顾问（需 HR VP；或高层内斗：1 VP+1 顾问同归于尽）' },
  { act: 'poach', count: DECK_COUNTS.action.poach, name: '挖角', desc: '花现金挖走对手一名员工/VP（对方 HR VP 需先被挖掉）' },
  { act: 'consultant', count: DECK_COUNTS.action.consultant, name: '高价顾问', desc: '塞给对手一名顾问，每轮索要 $3M-$5M 巨额薪水' },
  { act: 'headhunter', count: DECK_COUNTS.action.headhunter, name: '猎头', desc: '定向搜寻牌堆/弃牌堆，招募一名所需的 VP 或员工' },
  { act: 'release', count: DECK_COUNTS.action.release, name: '项目重组', desc: '废弃一个项目（自己需 Eng VP 或 Sales VP）' },
  { act: 'audit', count: DECK_COUNTS.action.audit, name: '财务审计', desc: '对手本轮薪水翻倍（对方无 Fin VP 才生效）' },
  { act: 'resign', count: DECK_COUNTS.action.resign, name: '强制辞职', desc: '强制对手一名员工/VP 离职（对方 HR VP 需先被辞掉）' },
];

export interface BuildDeckOptions {
  rng?: Rng;
}

/** Build the full shuffled 156-card deck. Passing the same `rng` yields the
 *  same card sequence (stat rolls included) and the same ids. */
export function buildDeck({ rng = defaultRng }: BuildDeckOptions = {}): Card[] {
  const deck: Card[] = [];
  let seq = 0;
  const id = (key: string) => `${key}-${seq++}`;

  // 16 VP
  for (const dept of VP_DEPTS) {
    const arch = VP_ARCHETYPES[dept];
    for (let i = 0; i < DECK_COUNTS.vp[dept]; i++) {
      const card: VPCard = {
        id: id(dept + 'VP'),
        name: arch.name,
        kind: 'vp',
        dept,
        salary: VP_SALARY,
        desc: arch.desc,
      };
      deck.push(card);
    }
  }

  // 40 staff (salary == skill)
  for (const arch of STAFF_ARCHETYPES) {
    const count = DECK_COUNTS.staff[arch.key];
    for (let i = 0; i < count; i++) {
      const card: StaffCard = {
        id: id(arch.key),
        name: arch.name,
        kind: 'staff',
        role: arch.role,
        skill: arch.skill,
        salary: arch.skill,
        desc: `${roleLabel(arch.role)}技能 +${arch.skill}`,
      };
      deck.push(card);
    }
  }

  // 40 projects
  buildProjects(deck, id, rng);

  // 60 actions
  for (const def of ACTION_DEFS) {
    for (let i = 0; i < def.count; i++) {
      const card: ActionCard = {
        id: id(def.act),
        name: def.name,
        kind: 'action',
        act: def.act,
        desc: def.desc,
      };
      deck.push(card);
    }
  }

  return shuffle(deck, rng);
}

function roleLabel(role: Role): string {
  switch (role) {
    case 'eng': return '工程';
    case 'mkt': return '营销';
    case 'hr': return 'HR';
    case 'fin': return '财务';
  }
}

function buildProjects(deck: Card[], id: (k: string) => string, rng: Rng): void {
  // Tech (20): needs 2-6 engineer skill, burns $1M-$3M, gives a small reward.
  for (let i = 0; i < DECK_COUNTS.project.tech; i++) {
    const reqSkill = 2 + Math.floor(rng() * 5); // 2..6
    const burn = 1 + Math.floor((reqSkill - 2) / 2); // 1..3 (monotone req→burn)
    const reward = reqSkill * 3 + Math.floor(rng() * 5);
    const card: ProjectCard = {
      id: id('tech'),
      name: `技术项目 (${reqSkill}技能)`,
      kind: 'project',
      subtype: 'tech',
      target: 'self',
      reqSkill,
      burn,
      reward,
      desc: `需 ${reqSkill} 点工程师技能，完成奖励 $${reward}M`,
    };
    deck.push(card);
  }

  // Bad (12): the signature attack — hard to clear, burns $3M-$6M/round.
  for (let i = 0; i < DECK_COUNTS.project.bad; i++) {
    const reqSkill = 8 + Math.floor(rng() * 3); // 8..10
    const burn = 3 + Math.floor(rng() * 4); // 3..6
    const card: ProjectCard = {
      id: id('bad'),
      name: `烂尾工程 (烧$${burn}M/轮)`,
      kind: 'project',
      subtype: 'bad',
      target: 'enemy',
      reqSkill,
      burn,
      reward: 0,
      desc: `巨额烧钱！需 ${reqSkill} 工程技能，专攻对手`,
    };
    deck.push(card);
  }

  // Market (8): needs 2-4 marketing skill, burns $1M-$2M, completes for $5M-$15M.
  for (let i = 0; i < DECK_COUNTS.project.market; i++) {
    const reqSkill = 2 + Math.floor(rng() * 3); // 2..4
    const burn = 1 + Math.floor(rng() * 2); // 1..2
    const reward = 5 + Math.floor(rng() * 11); // 5..15
    const card: ProjectCard = {
      id: id('market'),
      name: `市场项目 (奖$${reward}M)`,
      kind: 'project',
      subtype: 'market',
      target: 'self',
      reqSkill,
      burn,
      reward,
      desc: `需 ${reqSkill} 点营销技能，完成获 $${reward}M`,
    };
    deck.push(card);
  }
}
