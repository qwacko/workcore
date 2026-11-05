import { test, expect, type Page } from '@playwright/test';

async function register(page: Page, name: string) {
  await page.goto('/');
  await page.getByRole('button', { name: 'New here? Create an account' }).click();
  await page.getByLabel('Name', { exact: true }).fill(name);
  await page.getByLabel('Email').fill(`${name.replace(/\s/g, '-')}-${crypto.randomUUID()}@example.com`);
  await page.getByLabel('Password').fill('a-long-password');
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Workspace chat' })).toBeVisible();
}
const section = (page: Page, name: string) =>
  page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('button', { name, exact: true })
    .click();

test('signs up and keeps tasks and notes in sync across tabs', async ({ page, context }) => {
  await register(page, 'Demo user');
  const second = await context.newPage();
  await second.goto('/');
  await section(page, 'Tasks');
  await section(second, 'Tasks');
  await page.getByLabel('Task title').fill('Plan the launch');
  await page.getByRole('button', { name: 'Add task', exact: true }).click();
  await expect(second.getByText('Plan the launch', { exact: true })).toBeVisible();
  await second.getByRole('checkbox', { name: 'Complete Plan the launch' }).click();
  await page.getByRole('tab', { name: 'Completed', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: 'Reopen Plan the launch' })).toBeVisible();
  await page.getByRole('button', { name: 'Board view' }).click();
  await expect(page.getByRole('checkbox', { name: 'Reopen Plan the launch' })).toBeVisible();
  await section(page, 'Notes');
  await page.getByRole('button', { name: 'New note', exact: true }).click();
  await page.getByLabel('Title', { exact: true }).fill('Launch notes');
  await page.getByLabel('Note', { exact: true }).fill('A useful idea');
  await page.getByRole('button', { name: 'Save note', exact: true }).click();
  await section(second, 'Notes');
  await expect(second.getByText('Launch notes', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Actions for Launch notes' }).click();
  await page.getByRole('menuitem', { name: 'Archive', exact: true }).click();
  await second.getByRole('tab', { name: 'Archive', exact: true }).click();
  await expect(second.getByText('Launch notes', { exact: true })).toBeVisible();
  await page.goto('/admin/demo');
  await expect(page.getByText('Start here', { exact: true }).first()).toBeVisible();
});

test('client filters never expose another user’s private data', async ({ browser }) => {
  const a = await browser.newContext(),
    b = await browser.newContext();
  try {
    const alice = await a.newPage(),
      bob = await b.newPage();
    await register(alice, 'Alice');
    await register(bob, 'Bob');
    await section(alice, 'Tasks');
    await section(bob, 'Tasks');
    await alice.getByLabel('Task title').fill('Shared project');
    await alice.getByRole('checkbox', { name: 'Private task', exact: true }).uncheck();
    await alice.getByRole('button', { name: 'Add task', exact: true }).click();
    await expect(bob.getByText('Shared project', { exact: true })).toBeVisible();
    await bob.getByRole('button', { name: 'Everyone', exact: true }).click();
    await expect(bob.getByText('Shared project', { exact: true })).toHaveCount(0);
    await bob.getByRole('button', { name: 'My tasks', exact: true }).click();
    await alice.getByLabel('Task title').fill('Private reminder');
    await alice.getByRole('checkbox', { name: 'Private task', exact: true }).check();
    await alice.getByRole('button', { name: 'Add task', exact: true }).click();
    await expect(alice.getByText('Private reminder', { exact: true })).toBeVisible();
    await expect(bob.getByText('Private reminder', { exact: true })).toHaveCount(0);
    const response = await bob.request.post('/api/workspaces/demo/query', {
      data: { name: 'tasks', input: { projectId: 'inbox' } },
    });
    expect(JSON.stringify(await response.json())).not.toContain('Private reminder');
  } finally {
    await a.close();
    await b.close();
  }
});
