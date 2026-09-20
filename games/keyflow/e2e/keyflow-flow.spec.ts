// KeyFlow single-user flow. Exercises the seeded-profile path
// (boot → welcome back → main menu, intro already done) and the first-run path
// (boot → Profile Setup → intro → initial test → typing → main menu).
// Typing sessions are short-circuited with Esc so the suite stays fast:
// Esc calls finish() → completeInitialTest().
import { expect, test, type Page } from '@playwright/test';
import { watchConsoleErrors } from './helpers/console';
import { pressKey, seedSave } from './helpers/save-state';

const btn = (page: Page, text: string | RegExp) =>
  page.locator('button', { hasText: text });

/** Vue 的 <Transition> 会先插入新屏、下一帧才移除旧屏（enter 类持续 150 ms），
 *  所以快速连按导航时两个面板会短时共存 —— `.menu-item.selected` / `.scroll-text`
 *  这类选择器会同时命中两个屏，Playwright 严格模式直接报错。
 *  导航后用本函数等 DOM 收敏（`.screen` 下只剩一个子节点）再断言。 */
async function screenSettled(page: Page): Promise<void> {
  await expect(page.locator('.screen > *')).toHaveCount(1);
}

/** 种子档案：boot → 欢迎屏 → 主菜单。 */
async function toMainMenu(page: Page) {
  await pressKey(page, 'Enter'); // boot → welcome back (seed profile)
  await expect(page.getByRole('heading', { level: 2, name: 'Welcome Back' })).toBeVisible();
  await pressKey(page, 'Enter'); // any key → main menu
  await expect(page.getByRole('heading', { level: 2, name: 'Main Menu' })).toBeVisible();
  await screenSettled(page);
}

test.describe('keyflow flow', () => {
  let assertNoErrors: () => Promise<void>;

  test.beforeEach(async ({ page }) => {
    assertNoErrors = watchConsoleErrors(page);
    await seedSave(page); // seeds profile "Zoe" with introDone
    await page.goto('/games/keyflow/');
  });

  test.afterEach(async () => {
    await assertNoErrors();
  });

  test('seed: boot → welcome back → main menu', async ({ page }) => {
    // Boot screen: any key begins.
    await expect(page.locator('.boot-box .title')).toHaveText('KeyFlow');
    await pressKey(page, 'Enter'); // start() → profile exists & introDone → welcome back
    await expect(page.getByRole('heading', { level: 2, name: 'Welcome Back' })).toBeVisible();
    await expect(page.locator('.scroll-text')).toContainText('Welcome back to KeyFlow!');
    await pressKey(page, 'Enter'); // any key → main menu
    await expect(page.getByRole('heading', { level: 2, name: 'Main Menu' })).toBeVisible();
    await expect(page.locator('.menu-item', { hasText: 'Lessons' })).toBeVisible();
    await expect(page.locator('.menu-item', { hasText: 'Help' })).toBeVisible();
  });

  test('first run: empty save → setup → intro → initial test → typing → main menu', async ({ page }) => {
    await seedSave(page, { empty: true });
    await page.goto('/games/keyflow/');

    await pressKey(page, 'Enter'); // start() → no profile → Profile Setup
    await expect(page.getByRole('heading', { level: 2, name: 'Profile Setup' })).toBeVisible();

    // Name is filled; date is prefilled with today; experience defaults to
    // Beginner → OK advances to intro.
    await page.locator('input[type="text"]').nth(0).fill('Zed');
    await btn(page, 'OK').click();
    await expect(page.getByRole('heading', { level: 2, name: 'Introduction' })).toBeVisible();
    await btn(page, 'Skip introduction').click();

    await expect(page.getByRole('heading', { level: 2, name: 'Initial Test' })).toBeVisible();
    await btn(page, 'begin test').click();

    // Typing screen: Esc finishes the initial test → main menu.
    await expect(page.locator('.typing-panel')).toBeVisible();
    await expect(page.locator('.typing-panel h2')).toHaveText('Initial Test');
    await pressKey(page, 'Escape');
    await expect(page.getByRole('heading', { level: 2, name: 'Main Menu' })).toBeVisible();
    await expect(page.locator('.menu-item', { hasText: 'Lessons' })).toBeVisible();
  });

  test('lesson flow: current lesson → typing with keyboard graphic → summary', async ({ page }) => {
    await toMainMenu(page);
    await pressKey(page, 'Enter'); // → Lessons
    await expect(page.getByRole('heading', { level: 2, name: 'Practice Lesson' })).toBeVisible();
    // First item is the current sequential lesson (Lesson 8 for seed).
    await expect(page.locator('.menu-item').first()).toHaveText('Lesson 8');
    await pressKey(page, 'Enter'); // start current lesson → typing
    await expect(page.locator('.typing-panel')).toBeVisible();
    // Practice page: embedded keyboard graphic + finger hint + instruction box.
    await expect(page.locator('.kb-wrap')).toBeVisible();
    await expect(page.locator('.instruction-box')).toContainText('Type the line above');
    await pressKey(page, 'Escape'); // finish → summary
    await expect(page.getByRole('heading', { level: 2, name: 'Keyboard Lesson Summary' })).toBeVisible();
    await expect(page.locator('.summary-body')).toContainText('Keys Above 15 WPM');
    await expect(page.locator('.summary-body')).toContainText('Current Focus Keys');
    await btn(page, 'End of Lesson').click();
    await expect(page.getByRole('heading', { level: 2, name: 'Main Menu' })).toBeVisible();
  });

  test('help: main menu Help shows the info screen', async ({ page }) => {
    await toMainMenu(page);
    await pressKey(page, 'ArrowDown'); // → Tests
    await pressKey(page, 'ArrowDown'); // → Reports
    await pressKey(page, 'ArrowDown'); // → Options
    await pressKey(page, 'ArrowDown'); // → Help
    await pressKey(page, 'Enter');
    await expect(page.getByRole('heading', { level: 2, name: 'Help' })).toBeVisible();
    await expect(page.locator('.scroll-text')).toContainText('five sections');
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await expect(page.getByRole('heading', { level: 2, name: 'Main Menu' })).toBeVisible();
  });

  test('keypad: intro screen then lesson', async ({ page }) => {
    await toMainMenu(page);
    await pressKey(page, 'Enter'); // → Lessons
    await expect(page.getByRole('heading', { level: 2, name: 'Practice Lesson' })).toBeVisible();
    await pressKey(page, 'ArrowDown'); // → Keypad Lesson
    await pressKey(page, 'Enter');
    await expect(page.getByRole('heading', { level: 2, name: 'Keypad Lesson' })).toBeVisible();
    await screenSettled(page);
    await expect(page.locator('.scroll-text')).toContainText('Rest three fingers on 4, 5 and 6');
    await btn(page, 'Begin lesson').click();
    await expect(page.locator('.typing-panel')).toBeVisible();
    await expect(page.locator('.typing-panel h2')).toHaveText('Keypad Lesson');
    await pressKey(page, 'Escape'); // finish → summary
    await expect(page.getByRole('heading', { level: 2, name: 'Keyboard Lesson Summary' })).toBeVisible();
  });

  test('typing: whole line completes then advances to next line', async ({ page }) => {
    await toMainMenu(page);
    await pressKey(page, 'Enter'); // → Lessons
    await expect(page.getByRole('heading', { level: 2, name: 'Practice Lesson' })).toBeVisible();
    await pressKey(page, 'Enter'); // start current lesson → typing
    await expect(page.locator('.typing-panel')).toBeVisible();
    await expect(page.locator('.line-indicator')).toHaveText('Line 1/10');

    // Type the whole first line char by char (spaces via Space key).
    const guide = page.locator('.lesson-text');
    const line1 = await guide.evaluate((el) =>
      Array.from(el.querySelectorAll('span'))
        .filter((s) => !s.classList.contains('lesson-pointer'))
        .map((s) => s.textContent ?? '')
        .join(''),
    );
    expect(line1.length).toBeGreaterThan(10);
    // Type a few chars → the typed line below shows what was actually typed
    // (spaces render as ·).
    for (const ch of line1.slice(0, 5)) {
      await page.keyboard.press(ch === ' ' ? 'Space' : ch);
    }
    await expect(page.locator('.typed-line')).toContainText(line1.slice(0, 5).replace(/ /g, '·'));

    // Wrong key: does not block — pos advances, the wrong char shows in the
    // typed line, and typing the correct char continues.
    const wrong = line1[5] === 'a' ? 'z' : 'a';
    await page.keyboard.press(wrong);
    await expect(page.locator('.typed-line')).toContainText(wrong);
    await page.keyboard.press(line1[5] === ' ' ? 'Space' : line1[5]);

    // Typed line spans the whole line width (empty slots pad with spaces),
    // so it aligns char-by-char with the guide line.
    const typedSpans = await page.locator('.typed-line span:not(.blink-block)').count();
    const guideSpans = await page.locator('.lesson-text span:not(.lesson-pointer)').count();
    expect(typedSpans).toBe(guideSpans);

    // Type the rest of the line → whole line complete → auto-advance to line 2.
    for (const ch of line1.slice(6)) {
      await page.keyboard.press(ch === ' ' ? 'Space' : ch);
    }
    await expect(page.locator('.line-indicator')).toHaveText('Line 2/10');
    await pressKey(page, 'Escape'); // finish → summary
    await expect(page.getByRole('heading', { level: 2, name: 'Keyboard Lesson Summary' })).toBeVisible();
  });

  test('reports: speed report renders stats, chart and history', async ({ page }) => {
    await toMainMenu(page);
    await pressKey(page, 'ArrowDown'); // Main: → Tests
    await pressKey(page, 'ArrowDown'); // → Reports
    await pressKey(page, 'Enter');
    await expect(page.getByRole('heading', { level: 2, name: 'Reports' })).toBeVisible();

    await pressKey(page, 'ArrowDown'); // Reports: → Speed
    await pressKey(page, 'Enter');
    await expect(page.getByRole('heading', { level: 2, name: 'Speed Report' })).toBeVisible();
    await expect(page.locator('.report-body')).toContainText('Average');
    await expect(page.locator('.report-body')).toContainText('Max');
    await expect(page.locator('#report-chart')).toBeVisible();
    await expect(page.locator('.log-table')).toContainText('08-22-26');
  });

  test('reports: progress report shows key breakdown', async ({ page }) => {
    await toMainMenu(page);
    await pressKey(page, 'ArrowDown'); // Main: → Tests
    await pressKey(page, 'ArrowDown'); // → Reports
    await pressKey(page, 'Enter');
    await expect(page.getByRole('heading', { level: 2, name: 'Reports' })).toBeVisible();
    await pressKey(page, 'Enter'); // → Progress
    await expect(page.getByRole('heading', { level: 2, name: 'Progress Report' })).toBeVisible();
    await expect(page.locator('.report-body').first()).toContainText('This Week');
    await expect(page.locator('.report-body').nth(1)).toContainText('Keys Above 15 WPM');
    await expect(page.locator('.report-body').nth(1)).toContainText('Letter Speed');
  });

  test('options: reset profile via modal confirm', async ({ page }) => {
    await toMainMenu(page);
    await pressKey(page, 'ArrowDown'); // → Tests
    await pressKey(page, 'ArrowDown'); // → Reports
    await pressKey(page, 'ArrowDown'); // → Options
    await pressKey(page, 'Enter');
    await expect(page.getByRole('heading', { level: 2, name: 'Options Menu' })).toBeVisible();

    await pressKey(page, 'ArrowDown'); // → practice goal
    await pressKey(page, 'ArrowDown'); // → accuracy goal
    await pressKey(page, 'ArrowDown'); // → drills
    await pressKey(page, 'ArrowDown'); // → edit profile
    await pressKey(page, 'ArrowDown'); // → reset profile
    await pressKey(page, 'Enter');
    await expect(page.locator('.modal-window')).toBeVisible();
    await page.locator('.modal-window button', { hasText: 'Reset' }).click();
    await expect(page.getByRole('heading', { level: 2, name: 'Profile Setup' })).toBeVisible();
  });

  test('toolbar: back and main menu buttons', async ({ page }) => {
    const toolbarBtn = (text: string | RegExp) => page.locator('.toolbar button', { hasText: text });

    await toMainMenu(page);

    // Keyboard into Reports, then toolbar Back → Main Menu.
    await pressKey(page, 'ArrowDown'); // → Tests
    await pressKey(page, 'ArrowDown'); // → Reports
    await pressKey(page, 'Enter');
    await expect(page.getByRole('heading', { level: 2, name: 'Reports' })).toBeVisible();
    await toolbarBtn('Back').click();
    await expect(page.getByRole('heading', { level: 2, name: 'Main Menu' })).toBeVisible();

    // Into Options, then toolbar Main Menu → Main Menu.
    await pressKey(page, 'ArrowDown'); // → Tests
    await pressKey(page, 'ArrowDown'); // → Reports
    await pressKey(page, 'ArrowDown'); // → Options
    await pressKey(page, 'Enter');
    await expect(page.getByRole('heading', { level: 2, name: 'Options Menu' })).toBeVisible();
    await toolbarBtn('Main Menu').click();
    await expect(page.getByRole('heading', { level: 2, name: 'Main Menu' })).toBeVisible();
  });

  // Regression: the reset-confirm BaseModal is rendered inside OptionsMenuScreen,
  // so KeyFlowMenu stays mounted. Its window keydown listener used to fire
  // through the overlay: ↓ moved the hidden selection and Esc navigated away.
  test('modal: reset confirm owns the keyboard while it is open', async ({ page }) => {
    await toMainMenu(page);
    await pressKey(page, 'ArrowDown'); // → Tests
    await pressKey(page, 'ArrowDown'); // → Reports
    await pressKey(page, 'ArrowDown'); // → Options
    await pressKey(page, 'Enter');
    await expect(page.getByRole('heading', { level: 2, name: 'Options Menu' })).toBeVisible();
    await screenSettled(page);

    for (let i = 0; i < 5; i++) await pressKey(page, 'ArrowDown'); // → Reset profile
    await expect(page.locator('.menu-item.selected')).toHaveText('Reset profile');
    await pressKey(page, 'Enter');
    await expect(page.locator('.modal-window')).toBeVisible();

    // Arrows must not reach the menu behind the overlay.
    await pressKey(page, 'ArrowDown');
    await expect(page.locator('.menu-item.selected')).toHaveText('Reset profile');

    // Esc dismisses the dialog only — it must not navigate away.
    await pressKey(page, 'Escape');
    await expect(page.locator('.modal-window')).toHaveCount(0);
    await expect(page.getByRole('heading', { level: 2, name: 'Options Menu' })).toBeVisible();

    // Once the dialog is gone the menu is live again (selection resumes from 5).
    await pressKey(page, 'ArrowDown');
    await expect(page.locator('.menu-item.selected')).toHaveText('Retake initial test');
  });

  // Regression: focusKey was only ever assigned by startLesson → beginTyping, so
  // special lessons / tests kept showing the previous lesson's finger hint and
  // red keyboard highlight.
  test('keypad test does not inherit the lesson focus key', async ({ page }) => {
    await toMainMenu(page);
    await pressKey(page, 'Enter'); // → Lessons
    await expect(page.getByRole('heading', { level: 2, name: 'Practice Lesson' })).toBeVisible();
    await pressKey(page, 'Enter'); // start current lesson → typing
    await expect(page.locator('.typing-panel')).toBeVisible();
    await expect(page.locator('.finger-hint')).toHaveText(/Reach for '.+' with the/);
    await pressKey(page, 'Escape'); // finish → summary
    await expect(page.getByRole('heading', { level: 2, name: 'Keyboard Lesson Summary' })).toBeVisible();

    // Leave via the toolbar: a click on the in-screen buttons would park the mouse
    // over the Main Menu that replaces this screen and its mouseenter would
    // silently re-select that item before the assertions below run.
    await page.locator('.toolbar button', { hasText: 'Main Menu' }).click();
    await expect(page.getByRole('heading', { level: 2, name: 'Main Menu' })).toBeVisible();
    await screenSettled(page);
    await expect(page.locator('.menu-item.selected')).toHaveText('Lessons');

    await pressKey(page, 'ArrowDown'); // → Tests
    await screenSettled(page);
    await expect(page.locator('.menu-item.selected')).toHaveText('Tests');
    await pressKey(page, 'Enter');
    await expect(page.getByRole('heading', { level: 2, name: 'Practice Test' })).toBeVisible();
    await pressKey(page, 'ArrowDown');
    await pressKey(page, 'ArrowDown'); // → Keypad Test
    await screenSettled(page);
    await expect(page.locator('.menu-item.selected')).toHaveText('Keypad Test');
    await pressKey(page, 'Enter');

    await expect(page.locator('.typing-panel h2')).toHaveText('Keypad Test');
    // No stale focus key from the lesson above.
    await expect(page.locator('.finger-hint')).toHaveCount(0);
    await expect(page.locator('.kb-key.newkey')).toHaveCount(0);
  });
});
