// Burn Rate layoff targeting (port of layoff-consultant-probe): a seeded
// 2-player save where the player holds a layoff action card and employs an
// HR VP + a consultant. Playing the card must target BOTH employees (the
// consultant included — the original bug missed it), and clicking the
// consultant actually fires them.
import { expect, test } from '@playwright/test';
import { watchConsoleErrors } from './helpers/console';

const SAVE = {
  format: 2,
  difficulties: ['normal'],
  state: {
    deck: [],
    discard: [],
    turn: 1,
    currentPlayer: 0,
    gameOver: false,
    winner: null,
    pending: null,
    log: [],
    players: [
      {
        cash: 100,
        hand: [
          {
            id: 'layoff-0',
            name: '裁员',
            kind: 'action',
            act: 'layoff',
            desc: '解雇一名自己的员工/VP/顾问（需 HR VP 支持）',
          },
        ],
        company: [
          { id: 'hrVP-0', name: 'HR 副总裁', kind: 'vp', dept: 'hr', salary: 4, desc: '允许裁员；保护员工不被挖角/辞职；可清除顾问' },
          { id: 'consultant-1', name: '顾问', kind: 'consultant', salary: 3, desc: '高价顾问，每轮索要薪水' },
        ],
        projects: [],
        auditThisTurn: false,
        alive: true,
      },
      {
        cash: 100,
        hand: [],
        company: [],
        projects: [],
        auditThisTurn: false,
        alive: true,
      },
    ],
  },
};

test.describe('burn rate layoff', () => {
  let assertNoErrors: () => Promise<void>;

  test.beforeEach(async ({ page }) => {
    assertNoErrors = watchConsoleErrors(page);
    await page.addInitScript((saveJson) => {
      localStorage.clear();
      localStorage.setItem('burnrate.save', saveJson);
    }, JSON.stringify(SAVE));
    await page.goto('/games/burnrate/');
    await page.locator('.continue-btn').click();
    await expect(page.locator('.game-wrapper')).toBeVisible({ timeout: 10_000 });
  });

  test.afterEach(async () => {
    await assertNoErrors();
  });

  test('layoff targets the consultant too and fires it on click', async ({ page }) => {
    // My company thumb cards live in the hand-board row (OA layout).
    const myCards = page.locator('#hand-board .thumb-row .card-thumb');
    await expect(myCards).toHaveCount(2);
    const names = await myCards.allTextContents();
    expect(names.some((t) => t.includes('HR 副总裁'))).toBe(true);
    expect(names.some((t) => t.includes('顾问'))).toBe(true);

    // Play the layoff card.
    await page.locator('#hand-cards .game-card').first().click();
    await expect(page.locator('.modal-title', { hasText: '裁员' })).toBeVisible();
    const execBtn = page.locator('.modal-card .btn-primary');
    await expect(execBtn).toBeEnabled(); // requires the HR VP
    await execBtn.click();

    // Targeting hint + BOTH employees highlighted (the consultant included).
    await expect
      .poll(async () => (await page.locator('.bottom-bar .hint').textContent()) ?? '')
      .toContain('高亮目标');
    await expect(page.locator('#hand-board .thumb-row .card-thumb.is-target')).toHaveCount(2);
    const tNames = await page.locator('#hand-board .thumb-row .card-thumb.is-target').allTextContents();
    expect(tNames.some((t) => t.includes('顾问'))).toBe(true);

    // Click the consultant → it gets fired (company left with 1 thumb).
    const texts = await myCards.allTextContents();
    const idx = texts.findIndex((t) => t.includes('顾问'));
    await myCards.nth(idx).click();
    const after = await myCards.allTextContents();
    expect(after.length).toBe(1);
    expect(after.some((t) => t.includes('顾问'))).toBe(false);
  });
});
