import { expect, test } from '@playwright/test';

test('admin supports editing and streams the update to another authorized client', async ({ browser, baseURL }) => {
  const aliceContext = await browser.newContext();
  const bobContext = await browser.newContext();
  const alice = await aliceContext.newPage();
  const bob = await bobContext.newPage();
  await alice.goto('/login/alice');
  await bob.goto('/login/bob');
  await expect(alice.getByRole('heading', { name: 'Operations', exact: true })).toBeVisible();
  await expect(bob.getByRole('heading', { name: 'Operations', exact: true })).toBeVisible();

  await alice.getByLabel('Workspace').selectOption('team');
  await bob.getByLabel('Workspace').selectOption('team');
  await expect(alice.getByRole('table')).toBeVisible();
  await expect(bob.getByRole('table')).toBeVisible();

  const statusFilter = alice.locator('.generated-form select');
  await statusFilter.selectOption('complete');
  await alice.getByRole('button', { name: 'Run query' }).click();
  await expect(alice.getByRole('table').getByText('Shared trail cleanup')).toBeVisible();
  await expect(alice.getByRole('table').getByText('Plan group hike')).toHaveCount(0);
  await statusFilter.selectOption('');
  await alice.getByRole('button', { name: 'Run query' }).click();
  await expect(alice.getByRole('table').getByText('Plan group hike')).toBeVisible();

  await alice.locator('.row-actions button').first().click();
  const titleInput = alice.locator('.generated-form input[type="text"]').nth(1);
  const updatedTitle = `Live update ${Date.now()}`;
  await titleInput.fill(updatedTitle);
  await alice.getByRole('button', { name: 'Run mutation' }).click();
  await expect(alice.getByText(updatedTitle)).toBeVisible();
  await expect(bob.getByText(updatedTitle)).toBeVisible({ timeout: 8_000 });

  const denied = await bob.request.post(`${baseURL}/workcore/api/query`, {
    data: { applicationId: 'tracker', workspaceId: 'personal-alice', operation: 'activities', input: {} },
  });
  expect(denied.status()).toBe(403);
  await aliceContext.close();
  await bobContext.close();
});

test('the admin can execute a generic JSON query in a second application', async ({ page }) => {
  await page.goto('/login/alice');
  await page.getByLabel('Application').selectOption('notes');
  await expect(page.getByRole('heading', { name: 'Notebook' })).toBeVisible();
  await expect(page.getByText('Write the second app example')).toBeVisible();
});

test('the admin wire codec preserves Date values across a query round trip', async ({ page }) => {
  await page.goto('/login/alice');
  await page.getByRole('button', { name: /Date round trip/ }).click();
  const value = '2026-10-12T10:30:00.000Z';
  await page.getByLabel('Input').fill(JSON.stringify({ at: value }, null, 2));
  await page.getByRole('button', { name: 'Run query' }).click();
  await expect(page.locator('.result')).toContainText(value);

  await page.getByRole('button', { name: /Date-time text/ }).click();
  await page.getByRole('button', { name: 'Run query' }).click();
  await expect(page.locator('.result')).toContainText('2026-10-12T10:00:00.000Z');

  await page.getByRole('button', { name: /Rich value viewer/ }).click();
  await page.getByRole('button', { name: 'Run query' }).click();
  await expect(page.locator('.result')).toContainText('42n');
  await expect(page.locator('.result')).toContainText('"$type": "Map"');
  await expect(page.locator('.result')).toContainText('"$type": "Set"');
  await expect(page.locator('.result')).toContainText('[Circular reference]');
});

test('tasks run once in the worker and schedules can be managed', async ({ page, baseURL }) => {
  await page.goto('/login/alice');
  await page.getByRole('button', { name: /Refresh summary/ }).click();
  const taskCount = async () => {
    const response = await page.request.get(`${baseURL}/workcore/api/tasks?applicationId=tracker&workspaceId=personal-alice`);
    expect(response.ok()).toBeTruthy();
    return (await response.json() as { runs: unknown[] }).runs.length;
  };
  const before = await taskCount();
  await page.getByRole('button', { name: 'Launch task' }).click();
  await expect(page.getByText('Launch result')).toBeVisible();
  await page.getByRole('button', { name: /Task runs/ }).click();
  await expect(page.getByText('succeeded').first()).toBeVisible({ timeout: 8_000 });
  await expect.poll(taskCount).toBe(before + 1);

  await page.getByRole('button', { name: /Operations/ }).click();
  await page.getByRole('button', { name: /Refresh summary/ }).click();
  await page.getByRole('button', { name: 'Schedule task' }).click();
  await page.getByRole('button', { name: 'Create schedule' }).click();
  await expect(page.getByRole('heading', { name: 'Schedules', exact: true })).toBeVisible();
  const cron = page.getByLabel('Cron for refreshSummary');
  await expect(cron).toHaveValue('0 9 * * *');
  await cron.fill('30 8 * * *');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByLabel('Cron for refreshSummary')).toHaveValue('30 8 * * *');
  await page.getByRole('button', { name: 'Disable' }).click();
  await expect(page.getByRole('button', { name: 'Enable' })).toBeVisible();
  await page.getByRole('button', { name: 'Remove' }).click();
});
