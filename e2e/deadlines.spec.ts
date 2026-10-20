import { expect, go, row, rows, test } from './demo';
import type { Page } from '@playwright/test';

/* Fork feature: deadlines on every plan, the Deadlines page, and rollover.
   All on the demo account, which never reaches Todoist. */

/** A day from today, as `yyyy-MM-dd` in local time. */
const isoIn = (days: number): string => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

async function addTask(page: Page, name: string) {
  await page.keyboard.press('q');
  await page.locator('.composer-name').fill(name);
  await page.keyboard.press('ControlOrMeta+Enter');
  await expect(page.locator('.composerbox')).toHaveCount(0);
}

test('a deadline typed in braces is read, shown with a countdown and listed on the Deadlines page', async ({ demo: page }) => {
  await page.keyboard.press('q');
  await page.locator('.composer-name').fill(`Lab report today {${isoIn(2)}}`);
  await expect(page.locator('.namefield .nmark.deadline')).toHaveCount(1);
  await page.keyboard.press('ControlOrMeta+Enter');
  await expect(page.locator('.composerbox')).toHaveCount(0);

  const created = row(page, 'Lab report');
  await expect(created.locator('.deadline')).toHaveClass(/dl-soon/);
  await expect(created.locator('.deadline .dl-count')).toHaveText('2d left');

  await go(page, '#/deadlines');
  await expect(page.locator('.screen.active h1, .screen.active .pagetitle').first()).toContainText('Deadlines');
  await expect(row(page, 'Lab report')).toBeVisible();
  await expect(page.locator('.screen.active')).toContainText('This week' );
});

test('with deadlines kept in the description, the line is written there and hidden from it', async ({ demo: page }) => {
  await go(page, '#/settings');
  await page.getByRole('button', { name: 'Where deadlines are kept' }).click();
  await page.getByRole('option', { name: 'Description line' }).click();

  await go(page, '#/week');
  await addTask(page, `Essay plan today {${isoIn(9)}}`);
  await row(page, 'Essay plan').locator('.ttitle').click();
  const panel = page.locator('.prop[data-prop="deadline"]');
  await expect(panel).toContainText('In the description');
  await expect(page.locator('.descview')).not.toContainText('Deadline:');
});

test('a late task with a deadline rolls to today, and Undo puts it back', async ({ demo: page }) => {
  // The demo's first late task, given a deadline next week from its panel.
  const late = rows(page).filter({ has: page.locator('.meta .late') }).first();
  const title = (await late.locator('.ttitle').innerText()).trim();
  await late.locator('.ttitle').click();
  await page.locator('.prop[data-prop="deadline"] button').first().click();
  await page.getByPlaceholder('Tomorrow, next Sunday, 12 April…').fill(isoIn(6));
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');

  await expect(page.getByText('Moved 1 late task to today')).toBeVisible();
  await expect(row(page, title).locator('.meta .late')).toHaveCount(0);

  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(row(page, title).locator('.meta .late')).toHaveCount(1);
});
