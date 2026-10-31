import { test, expect } from '@playwright/test';

test('signs up and keeps tasks and notes in sync across tabs', async ({ page, context }) => {
  const email = `demo-${Date.now()}@example.com`;
  await page.goto('/');
  await page.getByRole('button', { name: 'New here? Create an account' }).click();
  await page.getByLabel('Name', { exact: true }).fill('Demo User');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('a-long-password');
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page.getByText('Live and in sync')).toBeVisible();
  const second = await context.newPage();
  await second.goto('/');
  await expect(second.getByText('Live and in sync')).toBeVisible();
  await page.getByLabel('Task title').fill('Plan the launch');
  await page.getByRole('button', { name: /Add task/ }).click();
  await expect(second.getByText('Plan the launch')).toBeVisible();
  await second.getByRole('button', { name: 'Complete Plan the launch' }).click();
  await expect(page.getByRole('button', { name: 'Reopen Plan the launch' })).toBeVisible();
  await page.getByRole('button', { name: 'Board' }).click();
  await expect(page.getByRole('button', { name: /Reopen/ })).toBeVisible();
  await page.getByRole('button', { name: 'Notes', exact: true }).first().click();
  await page.getByLabel('Title', { exact: true }).fill('Launch notes');
  await page.getByLabel('Note', { exact: true }).fill('A useful idea');
  await page.getByRole('button', { name: 'Save note' }).click();
  await second.getByRole('button', { name: 'Notes', exact: true }).first().click();
  await expect(second.getByText('Launch notes')).toBeVisible();
  await page.getByRole('button', { name: 'Archive', exact: true }).last().click();
  await second.getByRole('button', { name: 'Archive', exact: true }).first().click();
  await expect(second.getByText('Launch notes')).toBeVisible();
  await page.goto('/admin/demo');
  await expect(page.getByText('Start here', { exact: true }).first()).toBeVisible();
  await expect(page).toHaveURL(/\/admin\/demo/);
});

test('defaults to my tasks and never sends another user’s private data', async ({ browser }) => {
  const a = await browser.newContext();
  const b = await browser.newContext();
  try {
    const alice = await a.newPage();
    const bob = await b.newPage();
    for (const [page, who] of [[alice, 'Alice'], [bob, 'Bob']] as const) {
      await page.goto('/');
      await page.getByRole('button', { name: 'New here? Create an account' }).click();
      await page.getByLabel('Name', { exact: true }).fill(who);
      await page.getByLabel('Email').fill(`${who.toLowerCase()}-${Date.now()}@example.com`);
      await page.getByLabel('Password').fill('a-long-password');
      await page.getByRole('button', { name: 'Create account', exact: true }).click();
      await expect(page.getByText('Live and in sync')).toBeVisible();
    }
    await alice.getByLabel('Task title').fill('Shared project');
    await alice.getByRole('button', { name: /Add task/ }).click();
    await expect(alice.getByText('Shared project')).toBeVisible();
    await alice.getByLabel('Task title').fill('Private reminder');
    await alice.getByLabel('Private to me').check();
    await alice.getByRole('button', { name: /Add task/ }).click();
    await expect(alice.getByText('Private reminder')).toBeVisible();
    await expect(bob.getByText('Shared project')).not.toBeVisible();
    await bob.getByRole('button', { name: 'Everyone' }).click();
    await expect(bob.getByText('Shared project')).toBeVisible();
    await expect(bob.getByText('Private reminder')).not.toBeVisible();
    const response = await bob.request.post('/api/workspaces/demo/query', { data: { name: 'tasks', input: { projectId: 'inbox' } } });
    expect(JSON.stringify(await response.json())).not.toContain('Private reminder');
  } finally { await a.close(); await b.close(); }
});
