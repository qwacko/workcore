import { expect, test } from '@playwright/test';

test('live results, mutations, private views and operational UI', async ({ page, browser }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await page.getByRole('button', { name: 'Open as Alice' }).click();
  await page.getByRole('button', { name: 'tasks', exact: true }).click();
  await page.getByRole('button', { name: 'Subscribe', exact: true }).click();
  await expect(page.getByText('Live · revision')).toBeVisible();
  await expect(page.getByText('Alice’s private task', { exact: false })).toBeVisible();

  const editor = await page.context().newPage();
  await editor.goto('/workspace');
  await editor.getByRole('button', { name: 'createTask', exact: true }).click();
  const title = `Live task ${Date.now()}`;
  await editor.getByRole('textbox', { name: 'Operation input JSON' }).fill(JSON.stringify({ title }));
  await editor.getByRole('button', { name: 'Execute', exact: true }).click();
  await expect(page.getByText(title, { exact: false })).toBeVisible();

  await editor.getByRole('button', { name: 'assistant', exact: true }).click();
  const launched = editor.waitForResponse(response => response.url().endsWith('/enqueue'));
  await editor.getByRole('button', { name: 'Launch run', exact: true }).click();
  const runId = (await (await launched).json()).data as string;
  await editor.getByRole('button', { name: 'Runs', exact: true }).click();
  const run = editor.getByRole('row').filter({ hasText: runId });
  await expect(run.getByText('completed', { exact: true })).toBeVisible({ timeout: 15_000 });
  await run.getByRole('button', { name: 'Trace', exact: true }).click();
  await expect(editor.getByText('Summarise the first page', { exact: false })).toBeVisible();

  const bobContext = await browser.newContext();
  const bob = await bobContext.newPage();
  await bob.goto('http://localhost:8788/');
  await bob.getByRole('button', { name: 'Open as Bob' }).click();
  await bob.getByRole('button', { name: 'tasks', exact: true }).click();
  await bob.getByRole('button', { name: 'Subscribe', exact: true }).click();
  await expect(bob.getByText('Live · revision')).toBeVisible();
  await expect(bob.getByText(title, { exact: false })).toBeVisible();
  await expect(bob.getByText('Alice’s private task', { exact: false })).toHaveCount(0);
  await expect(bob.getByRole('button', { name: 'tables', exact: true })).toHaveCount(0);
  await page.screenshot({ path: '/tmp/opencode/workcore-console.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(errors).toEqual([]);
  await bobContext.close();
  await editor.close();
});
