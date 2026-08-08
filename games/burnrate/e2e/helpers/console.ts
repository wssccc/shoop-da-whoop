// Burn Rate UI smoke helpers (console-error sentinel, shared by the specs).
import { expect, type Page } from '@playwright/test';

export function watchConsoleErrors(
  page: Page,
  whitelist: RegExp[] = [],
): () => Promise<void> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`);
  });
  return async () => {
    const real = errors.filter((e) => !whitelist.some((re) => re.test(e)));
    expect(real, 'unexpected page/console errors:\n' + real.join('\n')).toEqual([]);
  };
}
