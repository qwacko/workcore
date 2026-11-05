import { expect, test, type Page } from '@playwright/test';

async function signIn(page: Page, role: 'admin' | 'member' = 'admin') {
  // Register through Better Auth; only the test host can provision an admin role.
  await page.request.post('/api/auth/sign-out', { headers: { origin: 'http://localhost:8788' } });
  const signup = await page.request.post('/api/auth/sign-up/email', { headers: { origin: 'http://localhost:8788' }, data: { name: role, email: `${role}-${crypto.randomUUID()}@example.com`, password: 'test-password-123' } });
  expect(signup.ok(), await signup.text()).toBeTruthy();
  if (role === 'admin') {
    expect((await page.request.post('/__test/provision-admin')).status()).toBe(204);
    const created = await page.request.post('/api/workspaces/demo/mutate', { data: { name: 'createTask', input: { title: 'Alice’s private task — Bob cannot sync this row', private: true }, requestId: crypto.randomUUID() } });
    expect(created.ok()).toBeTruthy();
  }
  await page.goto('/admin/demo');
  await expect(page.getByRole('heading', { name: 'Workspace overview' })).toBeVisible();
}


test('run inspection explains structured tool completion without a fabricated answer', async ({ page }) => {
  await signIn(page);
  await expect(page.getByRole('heading', { name: 'Workspace overview' })).toBeVisible();
  const queued = await page.request.post('/api/workspaces/demo/enqueue', { data: { name: 'assistant', input: {}, requestId: crypto.randomUUID() } });
  expect(queued.ok()).toBeTruthy();
  const runId = (await queued.json()).data as string;
  await expect.poll(async () => {
    const result = await page.request.post('/api/workspaces/demo/system', { data: { name: 'runs.inspect', input: { runId } } });
    return (await result.json()).status;
  }, { timeout: 15000 }).toBe('completed');
  expect((await page.request.post('/__test/fixture-run', { data: { id: runId } })).status()).toBe(204);
  await page.goto(`/admin/demo/displays/systemRunDetail?runId=${encodeURIComponent(runId)}`);
  await expect(page.getByLabel('Agent progress')).toContainText(/completed\s+via submitReport/);
  await expect(page.getByLabel('Agent progress')).toContainText('Terminating tool required');
  await expect(page.locator('section').filter({ has: page.getByRole('heading', { name: 'Result', exact: true }) })).toContainText('report-1');
});

test('file administration uploads, downloads and deletes R2-backed files', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await signIn(page);
  await page.getByRole('link', { name: 'Files', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Files', exact: true })).toBeVisible();
  await page.getByLabel('Upload a file').setInputFiles({ name: 'admin-note.txt', mimeType: 'text/plain', buffer: Buffer.from('stored in R2') });
  const fileRow = page.getByRole('row').filter({ hasText: 'admin-note.txt' });
  await expect(fileRow).toContainText('ready');
  await expect(fileRow).toContainText('ready');
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
  await signIn(page);
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

test('live updates, private projections, server scope and responsive navigation', async ({ page, browser }, testInfo) => {
  await signIn(page);
  const bobContext = await browser.newContext();
  const bob = await bobContext.newPage();
  await signIn(bob, 'member');
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

  await page.locator('a[href="/admin/demo/displays/tasks"]').click();
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
  await page.screenshot({ path: testInfo.outputPath('workcore-admin-mobile.png'), fullPage: true });
  await bobContext.close();
});

test('private persisted chat, run timelines and scheduled execution', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await signIn(page);
  await page.getByRole('link', { name: 'Assistant', exact: false }).click();
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill('Summarise my tasks. <img src=x onerror=alert(1)>');
  const sent = page.waitForResponse(response => response.url().endsWith('/mutate') && response.request().postDataJSON()?.name === 'sendMessage');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  const runId = (await (await sent).json()).data.runId as string;
  await expect(page.getByRole('log', { name: 'Conversation' })).toContainText('tasks', { timeout: 15_000 });
  await expect(page.locator('.chat-thread img')).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('log', { name: 'Conversation' })).toContainText('tasks');
  await expect(page.getByLabel('Agent progress')).toContainText('Offline demo');
  await page.getByRole('link', { name: 'Inspect run', exact: false }).click();
   await expect(page).toHaveURL(new RegExp('/displays/systemRunDetail\\?runId=' + runId));
  await expect(page.getByRole('heading', { name: 'Execution timeline' })).toBeVisible();
  await expect(page.getByLabel('Agent progress')).toContainText('Turn 1');
  await expect(page.getByText('Handle the demo request', { exact: true })).toBeVisible();
  await page.getByText('Step result', { exact: true }).click();
  await expect(page.locator('.timeline').getByText('Here are your', { exact: false })).toBeVisible();

  await page.locator('a[href="/admin/demo/displays/tasks"]').click();
  const title = `Scheduled task ${Date.now()}`;
  await page.getByLabel('Task title', { exact: false }).fill(title);
  await page.getByRole('button', { name: 'Create task', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Task details' })).toBeVisible();
  await page.getByRole('link', { name: '← Back to results' }).click();
  await page.getByRole('row').filter({ hasText: title }).getByRole('button', { name: 'Schedule', exact: true }).click();
  await page.getByRole('dialog').getByLabel('Delay in seconds', { exact: false }).fill('1');
  const scheduled = page.waitForResponse(response => response.url().endsWith('/mutate') && response.request().postDataJSON()?.name === 'scheduleCompletion');
  await page.getByRole('dialog').getByRole('button', { name: 'Schedule', exact: true }).click();
  const scheduleId = (await (await scheduled).json()).data.scheduleId as string;
  await page.getByRole('link', { name: 'Schedules', exact: false }).click();
  const schedule = page.getByRole('row').filter({ hasText: scheduleId.slice(0, 8) });
  await expect(schedule.getByRole('link', { name: 'Inspect run', exact: false })).toBeVisible({ timeout: 15_000 });
  await page.screenshot({ path: testInfo.outputPath('workcore-admin-schedules.png'), fullPage: true });
  await page.getByRole('link', { name: 'Overview', exact: false }).click();
  await expect(page.getByRole('heading', { name: 'Workspace overview' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Project tasks', exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('workcore-admin-overview.png'), fullPage: true });
  expect(errors).toEqual([]);
});

test('operation explorer, validation, JSON fallback and unavailable deep links', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await signIn(page);
  await expect(page.getByRole('heading', { name: 'Workspace overview' })).toBeVisible();
  await page.goto('/admin/demo/displays/systemOperation?kind=mutation&name=createTask');
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
  await expect(page).toHaveURL(/systemHistory/);
  await expect(page.getByRole('table')).toContainText('mutation:createTask');
  await page.goto('/admin/demo/displays/toString');
  await expect(page.getByRole('heading', { name: 'Display unavailable' })).toBeVisible();
  await page.goto('/admin/demo/displays/systemOperation?kind=mutation&name=constructor');
  await expect(page.getByText('Operation unavailable')).toBeVisible();
  expect(errors).toEqual([]);
});

test('a parameterized display resolves only its declared route inputs', async ({ page }) => {
  await signIn(page);
  await page.goto('/admin/demo/displays/project?projectId=inbox&privateToken=not-forwarded');
  await expect(page.getByRole('heading', { name: 'Project detail' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Project summary' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Project tasks' })).toBeVisible();
});

test('embedded displays receive declared properties and keep sibling filters isolated', async ({ page }) => {
  await signIn(page);
  await page.goto('/admin/demo/displays/embedDemo');
  const embeds = page.locator('.display-embed');
  await expect(embeds).toHaveCount(2);
  const first = embeds.nth(0);
  const second = embeds.nth(1);
  await expect(first.getByRole('heading', { name: 'Project tasks' })).toBeVisible();
  await expect(second.getByRole('heading', { name: 'Project tasks' })).toBeVisible();
  await expect(first.getByRole('row').filter({ hasText: 'Open this workspace in two browser windows' })).toBeVisible();
  await first.getByRole('searchbox', { name: 'Search Project tasks' }).fill('no such task');
  await expect(first.getByText('No matches', { exact: false })).toBeVisible();
  await expect(second.getByRole('row').filter({ hasText: 'Open this workspace in two browser windows' })).toBeVisible();
});

test('typed display state drives multiple sources and persists only when declared', async ({ page }) => {
  await signIn(page);
  await page.goto('/admin/demo/displays/statefulProject?projectId=%22inbox%22');
  const status = page.getByLabel('Shared task status');
  await expect(status).toHaveValue('"open"');
  const summary = page.locator('.panel').filter({ has: page.getByRole('heading', { name: 'Matching tasks' }) });
  await expect(summary).toContainText('Count');
  await status.selectOption('"done"');
  await expect(page).toHaveURL(/__state\.statefulProject\.status=%22done%22/);
  await expect(page.getByRole('heading', { name: 'Tasks in selected state' })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Shared task status')).toHaveValue('"done"');
  await page.getByRole('button', { name: 'Apply all-task filter', exact: true }).click();
  await expect(page.getByLabel('Shared task status')).toHaveValue('"all"');
  await expect(page).toHaveURL(/__state\.statefulProject\.status=%22all%22/);

  const commandRow = page.getByRole('row').filter({ hasText: 'Alice’s private task — Bob cannot sync this row' });
  await commandRow.getByRole('button', { name: 'Complete, filter done and open', exact: true }).click();
  await expect(page).toHaveURL(/\/displays\/taskDetail\?taskId=/);
  const back = new URL(page.url()).searchParams.get('__back');
  expect(back).toContain('__state.statefulProject.status=%22done%22');
});

test('an identical live document snapshot preserves an open edit dialog and its unsaved draft', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await signIn(page);
  await page.goto('/admin/demo/displays/editReconciliationDemo?projectId=%22inbox%22');
  const editableRow = page.getByRole('row').filter({ has: page.getByRole('button', { name: 'Edit task', exact: true }) }).first();
  await editableRow.getByRole('button', { name: 'Edit task', exact: true }).click();
  const dialog = page.getByRole('dialog');
  const draft = `Unsubmitted ${Date.now()}`;
  await dialog.getByLabel('Task title', { exact: false }).fill(draft);

  const other = await page.context().newPage();
  await other.goto('/admin/demo/displays/tasks');
  const create = other.locator('section').filter({ has: other.getByRole('heading', { name: 'Create task', exact: true }) });
  await create.getByLabel('Task title', { exact: false }).fill(`Refresh trigger ${Date.now()}`);
  await create.getByRole('button', { name: 'Create task', exact: true }).click();

  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('Task title', { exact: false })).toHaveValue(draft);
  expect(errors).toEqual([]);
  await other.close();
});

test('embed budget rejects the 21st active instance and releases reservations on teardown', async ({ page }) => {
  await signIn(page);
  await page.goto('/admin/demo/displays/embedBudgetDemo');
  await page.getByRole('button', { name: 'Open 21 embedded displays' }).click();
  const modal = page.getByRole('dialog', { name: 'Open 21 embedded displays' });
  const embeds = modal.locator('.display-embed');
  await expect(embeds).toHaveCount(21);
  await expect(embeds.nth(0).getByRole('heading', { name: 'Project tasks' })).toBeVisible({ timeout: 10_000 });
  await expect(embeds.nth(20)).toContainText('The embedded display resource budget has been reached.');
  await modal.getByRole('button', { name: 'Close dialog' }).click();
  await expect(modal).toHaveCount(0);
  await page.getByRole('button', { name: 'Open 21 embedded displays' }).click();
  const reopened = page.getByRole('dialog', { name: 'Open 21 embedded displays' });
  await expect(reopened.locator('.display-embed').nth(0).getByRole('heading', { name: 'Project tasks' })).toBeVisible({ timeout: 10_000 });
  await expect(reopened.locator('.display-embed').nth(20)).toContainText('The embedded display resource budget has been reached.');
});

test('recursive layouts render columns and dialogs and submit a declared action button', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await signIn(page);
  await page.goto('/admin/demo/displays/layouts');
  await expect(page.getByRole('heading', { name: 'Layout example' })).toBeVisible();
  await expect(page.locator('.display-columns > .display-column')).toHaveCount(2);
  await page.getByRole('button', { name: 'Open layout dialog' }).click();
  const dialog = page.getByRole('dialog', { name: 'Helpful details' });
  await expect(dialog.getByRole('heading', { name: 'Dialog content' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Close dialog' }).click();

  await page.getByRole('button', { name: 'Create task from layout' }).click();
  const actionDialog = page.getByRole('dialog', { name: 'Create task from layout' });
  const title = `Layout action ${Date.now()}`;
  await actionDialog.getByLabel('Task title', { exact: false }).fill(title);
  const response = page.waitForResponse(result => result.url().endsWith('/mutate') && result.request().postDataJSON()?.name === 'createTask');
  await actionDialog.getByRole('button', { name: 'Create task from layout', exact: true }).click();
  expect((await response).ok()).toBe(true);
  await expect(actionDialog).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('a collection selection drives a separately loaded and authorized record source', async ({ page }) => {
  await signIn(page);
  await page.goto('/admin/demo/displays/selection');
  await expect(page.getByText('Select a row in the related collection to load this result.')).toBeVisible();
  const row = page.getByRole('row').nth(1);
  const selectedTitle = await row.locator('td').first().innerText();
  await row.getByRole('button', { name: 'Select', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Selected task', exact: true })).toBeVisible();
  await expect(page.locator('.panel').filter({ has: page.getByRole('heading', { name: 'Selected task', exact: true }) })).toContainText(selectedTitle);
  await row.getByRole('button', { name: 'Selected', exact: true }).click();
  await expect(page.getByText('Select a row in the related collection to load this result.')).toBeVisible();
});

test('relationship lookups, property-bound detail displays and back navigation preserve collection state', async ({ page }) => {
  await signIn(page);
  await page.goto('/admin/demo/displays/tasks');
  await expect(page.getByRole('combobox', { name: 'Project', exact: true })).toContainText('Roadmap');
  await page.getByRole('combobox', { name: 'Project', exact: true }).selectOption('"roadmap"');
  await page.getByRole('textbox', { name: 'Task title' }).fill('Relationship detail fixture');
  await page.getByRole('button', { name: 'Create task', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Task details' })).toBeVisible();
  await expect(page.getByText('Relationship detail fixture', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: '← Back to results' }).click();

  await page.goto('/admin/demo/displays/project?projectId=%22roadmap%22');
  await expect(page.getByRole('heading', { name: 'Project tasks' })).toBeVisible();
  await expect(page.locator('.source-status').filter({ hasText: 'Connecting…' })).toHaveCount(0, { timeout: 10_000 });
  const row = page.getByRole('row').filter({ hasText: 'Relationship detail fixture' });
  await expect(row).toBeVisible();
  await page.getByRole('searchbox', { name: 'Search Project tasks' }).fill('Relationship detail fixture');
  await row.getByRole('link', { name: 'Details' }).click();
  await expect(page.getByRole('heading', { name: 'Task details' })).toBeVisible();
  await expect(page.getByText('Relationship detail fixture', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: '← Back to results' }).click();
  await expect(page).toHaveURL(/filter\.project-tasks\.search=/);
  await expect(page.getByRole('searchbox', { name: 'Search Project tasks' })).toHaveValue('Relationship detail fixture');
  await expect(page.getByRole('row').filter({ hasText: 'Relationship detail fixture' })).toBeVisible();
});

test('a registered custom task-board renderer loads its authorized live source', async ({ page }) => {
  await signIn(page);
  await page.goto('/admin/demo/displays/board');
  await expect(page.getByRole('heading', { name: 'Component demo' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Tasks grouped by status' })).toBeVisible();
  await expect(page.locator('.task-lane').filter({ hasText: 'Open this workspace in two browser windows' })).toContainText('Open this workspace in two browser windows');
});
