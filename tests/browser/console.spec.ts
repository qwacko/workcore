import { expect, test } from '@playwright/test';

test('run inspection explains structured tool completion without a fabricated answer', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Open as Alice' }).click();
  await expect(page.getByRole('heading', { name: 'Workspace overview' })).toBeVisible();
  await page.route('**/api/workspaces/demo/inspect', route => {
    if (route.request().postDataJSON()?.resource !== 'run:terminal-ui-test') return route.continue();
    return route.fulfill({ json: {
      id: 'terminal-ui-test', job: 'assistant', kind: 'agent', status: 'completed', actor: { id: 'alice' }, input: {}, attempt: 1,
      createdAt: 1000, updatedAt: 2000,
      result: { finishReason: 'tool', tool: { name: 'submitReport', result: { reportId: 'report-1' } }, text: '' },
      progress: { phase: 'completed', turn: 1, completionMode: 'tool-required', completion: { kind: 'tool', tool: 'submitReport' } },
    } });
  });
  await page.route('**/api/workspaces/demo/trace', route => {
    if (route.request().postDataJSON()?.runId !== 'terminal-ui-test') return route.continue();
    return route.fulfill({ json: { rows: [], nextCursor: null } });
  });
  await page.goto('/admin/demo/runs/terminal-ui-test');
  await expect(page.getByLabel('Agent progress')).toContainText(/completed\s+via submitReport/);
  await expect(page.getByLabel('Agent progress')).toContainText('Terminating tool required');
  await expect(page.locator('section').filter({ has: page.getByRole('heading', { name: 'Result', exact: true }) })).toContainText('report-1');
});

test('file administration uploads, downloads and deletes R2-backed files', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await page.getByRole('button', { name: 'Open as Alice' }).click();
  await page.getByRole('link', { name: 'Files', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Files', exact: true })).toBeVisible();
  await page.getByLabel('Upload a file').setInputFiles({ name: 'admin-note.txt', mimeType: 'text/plain', buffer: Buffer.from('stored in R2') });
  const fileRow = page.getByRole('row').filter({ hasText: 'admin-note.txt' });
  await expect(fileRow).toContainText('ready');
  await expect(fileRow).toContainText('alice');
  const download = page.waitForEvent('download');
  await fileRow.getByRole('button', { name: 'Download' }).click();
  expect((await download).suggestedFilename()).toBe('admin-note.txt');
  page.once('dialog', dialog => dialog.accept());
  await fileRow.getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByText('No files found')).toBeVisible();
  expect(errors).toEqual([]);
});

test('guided pages, generated forms, row actions, local filters and deep links', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await page.getByRole('button', { name: 'Open as Alice' }).click();
  await expect(page.getByRole('heading', { name: 'Workspace overview' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'One workspace, live everywhere' })).toBeVisible();
  const title = `Guided task ${Date.now()}`;
  const form = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Add something to do' }) });
  await form.getByLabel('Task title', { exact: false }).fill(title);
  await form.getByRole('button', { name: 'Create task', exact: true }).click();
  const row = page.getByRole('row').filter({ hasText: title });
  await expect(row).toBeVisible();

  await row.getByRole('button', { name: 'Edit task', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('id', { exact: true })).toHaveCount(0);
  await dialog.getByLabel('Task title', { exact: false }).fill(title + ' edited');
  await dialog.getByRole('button', { name: 'Edit task', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('row').filter({ hasText: title + ' edited' })).toBeVisible();

  const queries: string[] = [];
  page.on('request', request => { if (request.url().endsWith('/query')) queries.push(request.url()); });
  await page.getByRole('searchbox', { name: 'Search Project tasks' }).fill(title);
  await expect(page.getByRole('row').filter({ hasText: 'Open this workspace in two browser windows' })).toHaveCount(0);
  expect(queries).toHaveLength(0);
  await expect(page).toHaveURL(/filter\./);
  await page.reload();
  await expect(page.getByRole('searchbox', { name: 'Search Project tasks' })).toHaveValue(title);
  await page.getByRole('button', { name: 'List', exact: true }).click();
  await expect(page.locator('.record-list')).toContainText(title + ' edited');
  await page.getByRole('button', { name: 'Table', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Table', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByLabel('Completion', { exact: true }).selectOption('false');
  await page.getByRole('row').filter({ hasText: title }).getByRole('button', { name: 'Complete', exact: true }).click();
  await expect(page.getByRole('row').filter({ hasText: title })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('live updates, private projections, server scope and responsive navigation', async ({ page, browser }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Open as Alice' }).click();
  const bobContext = await browser.newContext();
  const bob = await bobContext.newPage();
  await bob.goto('http://localhost:8788/');
  await bob.getByRole('button', { name: 'Open as Bob' }).click();
  await expect(bob.getByRole('heading', { name: 'Workspace overview' })).toBeVisible();
  await expect(bob.getByText('Alice’s private task', { exact: false })).toHaveCount(0);
  await expect(bob.getByRole('link', { name: 'Tables', exact: false })).toHaveCount(0);

  const title = `Live task ${Date.now()}`;
  await page.getByLabel('Task title', { exact: false }).fill(title);
  await page.getByRole('button', { name: 'Create task', exact: true }).click();
  await expect(bob.getByRole('row').filter({ hasText: title })).toBeVisible();
  await expect(bob.getByRole('row').filter({ hasText: title }).getByRole('button')).toHaveCount(0);
  await page.getByRole('row').filter({ hasText: title }).getByRole('button', { name: 'Edit task', exact: true }).click();
  await page.getByRole('dialog').getByRole('checkbox').check();
  await page.getByRole('dialog').getByRole('button', { name: 'Edit task', exact: true }).click();
  await expect(bob.getByRole('row').filter({ hasText: title })).toHaveCount(0);

  await page.getByRole('link', { name: 'Tasks', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Tasks', exact: true })).toBeVisible();
  await page.locator('.scope summary').click();
  await page.locator('.scope').getByLabel('Project', { exact: false }).fill('another-project');
  await page.getByRole('button', { name: 'Apply server scope', exact: true }).click();
  await expect(page.getByText('Nothing here yet', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText('Nothing here yet', { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Toggle navigation' }).click();
  await page.getByRole('link', { name: 'Overview', exact: false }).click();
  await expect(page.getByRole('heading', { name: 'Workspace overview' })).toBeVisible();
  await page.screenshot({ path: '/tmp/opencode/workcore-admin-mobile.png', fullPage: true });
  await bobContext.close();
});

test('private persisted chat, run timelines and scheduled execution', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await page.getByRole('button', { name: 'Open as Alice' }).click();
  await page.getByRole('link', { name: 'Assistant', exact: false }).click();
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill('Summarise my tasks. <img src=x onerror=alert(1)>');
  const sent = page.waitForResponse(response => response.url().endsWith('/mutate') && response.request().postDataJSON()?.name === 'sendMessage');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  const runId = (await (await sent).json()).data.runId as string;
  await expect(page.getByRole('log', { name: 'Conversation' })).toContainText('Demo assistant', { timeout: 15_000 });
  await expect(page.locator('.chat-thread img')).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('log', { name: 'Conversation' })).toContainText('Demo assistant');
  await expect(page.getByLabel('Agent progress')).toContainText('Offline demo');
  await page.getByRole('link', { name: 'Inspect run', exact: false }).click();
  await expect(page).toHaveURL(new RegExp('/runs/' + runId));
  await expect(page.getByRole('heading', { name: 'Execution timeline' })).toBeVisible();
  await expect(page.getByLabel('Agent progress')).toContainText('Turn 1');
  await expect(page.getByText('Summarise the first page of my tasks', { exact: true })).toBeVisible();
  await page.getByText('Step result', { exact: true }).click();
  await expect(page.locator('.timeline').getByText('Demo assistant:', { exact: false })).toBeVisible();

  await page.getByRole('link', { name: 'Tasks', exact: true }).click();
  const title = `Scheduled task ${Date.now()}`;
  await page.getByLabel('Task title', { exact: false }).fill(title);
  await page.getByRole('button', { name: 'Create task', exact: true }).click();
  await page.getByRole('row').filter({ hasText: title }).getByRole('button', { name: 'Schedule', exact: true }).click();
  await page.getByRole('dialog').getByLabel('Delay in seconds', { exact: false }).fill('1');
  const scheduled = page.waitForResponse(response => response.url().endsWith('/mutate') && response.request().postDataJSON()?.name === 'scheduleCompletion');
  await page.getByRole('dialog').getByRole('button', { name: 'Schedule', exact: true }).click();
  const scheduleId = (await (await scheduled).json()).data.scheduleId as string;
  await page.getByRole('link', { name: 'Schedules', exact: false }).click();
  const schedule = page.getByRole('row').filter({ hasText: scheduleId.slice(0, 8) });
  await expect(schedule.getByRole('link', { name: 'Inspect run', exact: false })).toBeVisible({ timeout: 15_000 });
  await page.screenshot({ path: '/tmp/opencode/workcore-admin-schedules.png', fullPage: true });
  await page.getByRole('link', { name: 'Overview', exact: false }).click();
  await expect(page.getByRole('heading', { name: 'Workspace overview' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Project tasks', exact: true })).toBeVisible();
  await page.screenshot({ path: '/tmp/opencode/workcore-admin-overview.png', fullPage: true });
  expect(errors).toEqual([]);
});

test('operation explorer, validation, JSON fallback and unavailable deep links', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await page.getByRole('button', { name: 'Open as Alice' }).click();
  await expect(page.getByRole('heading', { name: 'Workspace overview' })).toBeVisible();
  await page.goto('/admin/demo/operations/mutation/createTask');
  await expect(page.getByRole('heading', { name: 'Create task', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Create task', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Please check the form' })).toBeVisible();
  await page.getByRole('button', { name: 'Advanced JSON', exact: true }).click();
  const title = `JSON task ${Date.now()}`;
  await page.getByRole('textbox', { name: 'Operation input JSON' }).fill(JSON.stringify({ title, projectId: 'inbox', private: false }));
  await page.getByRole('button', { name: 'Create task', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Accepted' })).toBeVisible();
  await page.getByRole('link', { name: 'Tables', exact: true }).click();
  await page.getByRole('link').filter({ hasText: 'Tasks' }).filter({ hasText: 'Browse records' }).click();
  await expect(page.getByRole('table')).toContainText(title);
  await page.getByRole('link', { name: 'History', exact: true }).click();
  await expect(page.getByRole('table')).toContainText('mutation:createTask');
  await page.goto('/admin/demo/pages/toString');
  await expect(page.getByRole('heading', { name: 'Page unavailable' })).toBeVisible();
  await page.goto('/admin/demo/operations/mutation/constructor');
  await expect(page.getByRole('heading', { name: 'Operation unavailable' })).toBeVisible();
  expect(errors).toEqual([]);
});
