// Burn Rate battle-console UI smoke (port of burnrate-ui-smoke): start
// modal → settings → new game → console layout → hand-card modal → report
// modal → submit → AI turn → back to player → rules modal. Pure UI flow,
// no save injection (the dice roll decides who starts — AI-first turns are
// waited out).
import { expect, test } from '@playwright/test';
import { watchConsoleErrors } from './helpers/console';

const phaseTag = (page: import('@playwright/test').Page) => page.locator('#phase-tag');
const waitPhase = (page: import('@playwright/test').Page, text: string, timeout = 60_000) =>
  expect
    .poll(async () => (await phaseTag(page).textContent()) ?? '', { timeout })
    .toContain(text);

test.describe('burn rate battle console', () => {
  let assertNoErrors: () => Promise<void>;

  test.beforeEach(async ({ page }) => {
    assertNoErrors = watchConsoleErrors(page);
    await page.goto('/games/burnrate/');
  });

  test.afterEach(async () => {
    await assertNoErrors();
  });

  test('start → settings → new game → console → submit → AI turn → back', async ({ page }) => {
    // 1. Start modal (main UI already rendered behind it, no close button).
    await expect(page.locator('h2', { hasText: '烧钱计划' })).toBeVisible();
    await expect(page.locator('.game-wrapper')).toBeVisible();
    await expect(page.locator('.start-card .modal-close')).toHaveCount(0);
    const startBtn = page.locator('.start-btn');
    await expect(startBtn).toBeEnabled();

    // 2. Settings: 2-5 players, 4 difficulty tiers; pick 3 players.
    const toggle = page.locator('.settings-toggle');
    if (!(await page.locator('.settings-panel').isVisible().catch(() => false))) {
      await toggle.click();
    }
    await expect(page.locator('.settings-panel')).toBeVisible();
    await expect(page.locator('.p-opt')).toHaveCount(4);
    await expect(page.locator('.diff-opt')).toHaveCount(4);
    await page.locator('.p-opt').nth(1).click(); // 3 players
    await expect(page.locator('.p-opt.selected')).toHaveText('3');

    // 3. New game → dice roll → console (modal closes only after the deal).
    await startBtn.click();
    await expect(page.locator('.start-card')).toHaveCount(0, { timeout: 15_000 });
    await expect(page.locator('.top-bar')).toBeVisible();

    // 4. Console layout (AI-first games: wait out the AI turn).
    await waitPhase(page, '你的回合', 90_000);
    await expect(page.locator('.opp-panel')).toHaveCount(2);
    await expect(page.locator('#alive-count')).toHaveText(/3\/3/);
    await expect(page.locator('.player-info')).toBeVisible();
    await expect(page.locator('#hand-count')).toHaveText(/6\/6/);
    const handCards = page.locator('#hand-cards .game-card');
    await expect(handCards).toHaveCount(6);
    await expect(page.locator('#btn-submit')).toBeEnabled();

    // 5. Hand-card detail modal opens and closes.
    await handCards.first().click();
    await expect(page.locator('.modal-card')).toBeVisible();
    await page.locator('.modal-close').first().click();
    await expect(page.locator('.modal-card')).toHaveCount(0);

    // 6. Battle-report modal opens and closes.
    await page.locator('.icon-btn[title="战报"]').click();
    await expect(page.locator('.modal-title', { hasText: '战报' })).toBeVisible();
    await page.locator('.modal-close').first().click();

    // 7. Submit → confirm → AI turn (submit disabled while AI thinks).
    await page.locator('#btn-submit').click();
    await expect(page.locator('.modal-title', { hasText: '提交确认' })).toBeVisible();
    await page.locator('.modal-actions .btn-primary').click();
    await waitPhase(page, '思考中', 10_000);
    await expect(page.locator('#btn-submit')).toBeDisabled();

    // 8. Back to the player's turn with a fresh 6-card hand.
    await waitPhase(page, '你的回合', 90_000);
    const round = (await page.locator('#round-num').textContent())?.trim() ?? '0';
    expect(parseInt(round, 10)).toBeGreaterThan(1);
    await expect(page.locator('#hand-count')).toHaveText(/6\/6/);

    // 9. Rules modal opens (section headers — count is content detail).
    await page.locator('.icon-btn[title="游戏规则"]').click();
    await expect(page.locator('.modal-h').first()).toBeVisible({ timeout: 5_000 });
    expect(await page.locator('.modal-h').count()).toBeGreaterThanOrEqual(5);
    await page.locator('.modal-close').first().click();
  });
});
