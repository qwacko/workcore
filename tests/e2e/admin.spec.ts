import { expect, test } from '@playwright/test';
import { superjsonCodec } from '../../packages/codec-superjson/src/index.js';
import type { WorkcoreManifest } from '../../packages/client/src/index.js';

const testCodec = superjsonCodec();
function decodeWire(value: unknown): any {
  const envelope = value as { workcoreCodec?: string; payload?: never };
  return envelope?.workcoreCodec === testCodec.id ? testCodec.decode(envelope.payload!) : value;
}
function encodeWire(value: unknown) { return JSON.stringify({ workcoreCodec: testCodec.id, payload: testCodec.encode(value) }); }
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

async function login(page: import('@playwright/test').Page, username: string, password = `${username}-demo-pass`) {
  await page.goto('/login');
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Operations', exact: true })).toBeVisible();
}

test('admin supports editing and streams the update to another authorized client', async ({ browser, baseURL }) => {
  const aliceContext = await browser.newContext();
  const bobContext = await browser.newContext();
  const alice = await aliceContext.newPage();
  const bob = await bobContext.newPage();
  await login(alice, 'alice');
  await login(bob, 'bob');

  await alice.getByLabel('Workspace').selectOption('team');
  await bob.getByLabel('Workspace').selectOption('team');
  await alice.locator('.operation-row').filter({ hasText: 'Activities' }).click();
  await bob.locator('.operation-row').filter({ hasText: 'Activities' }).click();
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
  await login(page, 'alice');
  await page.getByLabel('Application').selectOption('notes');
  await expect(page.getByRole('heading', { name: 'Notebook' })).toBeVisible();
  await expect(page.getByText('Write the second app example')).toBeVisible();
});

test('the admin renders configured custom pages from operation metadata', async ({ page }) => {
  await login(page, 'alice');
  await page.getByRole('button', { name: /Activity dashboard/ }).click();
  await expect(page.getByRole('heading', { name: 'Activity dashboard', exact: true })).toBeVisible();
  await expect(page.getByRole('table')).toBeVisible();
  await page.getByText('Query input (JSON)').click();
  await page.getByLabel('Input for activities').fill(JSON.stringify({ limit: 1 }, null, 2));
  await page.getByRole('button', { name: 'Run query' }).click();
  await expect(page.getByRole('table').getByRole('row')).toHaveCount(2);
  await expect(page.getByRole('button', { name: 'Open form' })).toBeVisible();
  await page.getByRole('button', { name: 'Task runs' }).click();
  await expect(page.getByRole('heading', { name: 'Task runs', exact: true })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('heading', { name: 'Activity dashboard', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Edit activity' }).first().click();
  await expect(page.getByRole('heading', { name: 'Edit activity' })).toBeVisible();
});

test('agent-run inspection appears only for actors with the run capability', async ({ browser }) => {
  const owner = await browser.newPage();
  await login(owner, 'alice');
  await owner.getByLabel('Workspace').selectOption('team');
  await owner.getByRole('button', { name: 'Agent runs' }).click();
  await expect(owner.getByRole('heading', { name: 'Agent runs', exact: true })).toBeVisible();
  await expect(owner.getByText('No agent runs')).toBeVisible();

  const viewer = await browser.newPage();
  await login(viewer, 'bob');
  await viewer.getByLabel('Workspace').selectOption('team');
  await expect(viewer.getByRole('button', { name: 'Agent runs' })).toHaveCount(0);
  await owner.close();
  await viewer.close();
});

test('Milo chat sends a message to a queued personality agent and displays the saved reply', async ({ page }) => {
  await login(page, 'alice');
  await page.getByLabel('Workspace').selectOption('team');
  await page.locator('.sidebar nav').getByRole('button', { name: /Milo's Campfire/ }).click();
  await expect(page.locator('.page-heading h1', { hasText: "Milo's Campfire" })).toBeVisible();
  await page.getByLabel('Message').fill('Who are you, and what can you help me with?');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.locator('.chat-message.user-message')).toContainText('Who are you', { timeout: 8_000 });
  const assistantMessage = page.locator('.chat-message').filter({ hasText: 'assistant' }).last();
  await expect(assistantMessage).toContainText('I’m Milo', { timeout: 8_000 });
  // The queued state can complete before the first post-send query returns; assert the stable terminal UI.
  await expect(assistantMessage).toContainText('complete');
  const transcript = await page.locator('.chat-messages').elementHandle();
  await transcript?.evaluate((element) => {
    element.style.height = '80px';
    element.style.maxHeight = '80px';
    element.scrollTop = 25;
  });
  await page.getByLabel('Message').fill('What is a campfire?');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.locator('.chat-message')).toHaveCount(4);
  expect(await transcript?.evaluate((element) => element.isConnected)).toBe(true);
  expect(await transcript?.evaluate((element) => element.scrollTop)).toBeGreaterThanOrEqual(25);
  await expect(page.locator('.chat-message').last()).toContainText('good question', { timeout: 8_000 });
  await expect(page.locator('.chat-message-heading strong').allTextContents()).resolves.toEqual(['user', 'assistant', 'user', 'assistant']);
});

test('chat timeline follows same-message content growth when the reader is at the bottom', async ({ page }) => {
  await login(page, 'alice');
  await page.getByLabel('Workspace').selectOption('team');
  await page.locator('.sidebar nav').getByRole('button', { name: /Milo's Campfire/ }).click();
  await page.getByLabel('Message').fill('Who are you?');
  await page.getByRole('button', { name: 'Send message' }).click();
  const lastMessage = page.locator('.chat-message').last();
  await expect(lastMessage).toContainText('I’m Milo', { timeout: 8_000 });
  const timeline = page.locator('.chat-messages');
  await timeline.evaluate((element) => {
    (element as HTMLElement).style.height = '110px';
    (element as HTMLElement).style.maxHeight = '110px';
    (element as HTMLElement).scrollTop = (element as HTMLElement).scrollHeight;
  });
  await page.waitForTimeout(100);
  const messageId = await lastMessage.getAttribute('data-message-id');
  await lastMessage.locator('.chat-text').first().evaluate((element) => {
    element.textContent = `${element.textContent}\n${'expanded message content '.repeat(100)}`;
  });
  await expect.poll(() => timeline.evaluate((element) => {
    const node = element as HTMLElement;
    return Math.abs(node.scrollHeight - node.clientHeight - node.scrollTop);
  })).toBeLessThan(4);
  await expect(lastMessage).toHaveAttribute('data-message-id', messageId ?? '');
});

test('mobile navigation keeps an obvious page selector available while scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, 'alice');
  const pageSelect = page.getByLabel('Admin page');
  await expect(pageSelect).toBeVisible();
  await pageSelect.selectOption('tasks');
  await expect(page.getByRole('heading', { name: 'Task runs', exact: true })).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect(pageSelect).toBeVisible();
  await pageSelect.selectOption('operations');
  await expect(page.getByRole('heading', { name: 'Operations', exact: true })).toBeVisible();
});

for (const view of ['Operations', 'custom page'] as const) test(`${view} chat stays usable after navigating away during a send`, async ({ page }) => {
  await login(page, 'alice');
  if (view === 'Operations') await page.locator('.operation-row').filter({ hasText: "Milo's Campfire" }).click();
  else await page.locator('.sidebar nav').getByRole('button', { name: /Milo's Campfire/ }).click();
  await expect(page.getByLabel('Message')).toBeEnabled();
  const entered = deferred();
  const release = deferred();
  await page.route('**/api/mutate', async (route) => {
    const response = await route.fetch();
    entered.resolve();
    await release.promise;
    await route.fulfill({ response });
  });
  try {
    await page.getByLabel('Message').fill('A pending Operations turn');
    await page.getByRole('button', { name: 'Send message' }).click();
    await entered.promise;
    await page.locator('.sidebar nav').getByRole('button', { name: /Task runs/ }).click();
    await page.locator('.sidebar nav').getByRole('button', { name: view === 'Operations' ? /Operations/ : /Milo's Campfire/ }).click();
    await expect(page.getByLabel('Message')).toBeEnabled();
    release.resolve();
    await page.getByLabel('Message').fill('Another turn');
    await expect(page.getByRole('button', { name: 'Send message' })).toBeEnabled();
  } finally { release.resolve(); }
});

test('a custom chat send survives its own live invalidation and pins the conversation', async ({ page }) => {
  await login(page, 'alice');
  await page.locator('.sidebar nav').getByRole('button', { name: /Milo's Campfire/ }).click();
  const release = deferred();
  const entered = deferred();
  let conversationId: string | undefined;
  await page.route('**/api/mutate', async (route) => {
    const response = await route.fetch();
    conversationId = decodeWire(await response.json()).result.conversationId;
    entered.resolve();
    await release.promise;
    await route.fulfill({ response });
  });
  const text = `Live invalidation ${Date.now()}`;
  try {
    await page.getByLabel('Message').fill(text);
    await page.getByRole('button', { name: 'Send message' }).click();
    await entered.promise;
    // The server's mutation event refreshes the timeline while its HTTP response is held.
    await expect(page.locator('.user-message').last()).toContainText(text);
    const pinnedQuery = page.waitForRequest((request) => request.url().endsWith('/api/query') && decodeWire(request.postDataJSON()).input?.conversationId === conversationId);
    release.resolve();
    await pinnedQuery;
    await expect(page.getByLabel('Message')).toBeEnabled();
  } finally { release.resolve(); }
});

test('custom query responses from a previous workspace visit cannot overwrite current results', async ({ page }) => {
  await login(page, 'alice');
  await page.getByRole('button', { name: /Activity dashboard/ }).click();
  const entered = deferred();
  const release = deferred();
  let matchingRequests = 0;
  await page.route('**/api/query', async (route) => {
    const input = decodeWire(route.request().postDataJSON());
    if (input.operation !== 'activities' || input.workspaceId !== 'personal-alice' || input.input.limit !== 1) return route.continue();
    const old = matchingRequests++ === 0;
    if (old) { entered.resolve(); await release.promise; }
    await route.fulfill({ contentType: 'application/json', body: encodeWire({ result: { rows: [{ id: 'regression', title: old ? 'STALE_WORKSPACE_RESULT' : 'CURRENT_WORKSPACE_RESULT', status: 'planned', updatedAt: new Date() }], nextCursor: null } }) });
  });
  try {
    await page.getByText('Query input (JSON)').click();
    await page.getByLabel('Input for activities').fill('{"limit":1}');
    await page.getByRole('button', { name: 'Run query', exact: true }).click();
    await entered.promise;
    await page.getByLabel('Workspace').selectOption('team');
    await expect(page.getByRole('table')).toBeVisible();
    await page.getByLabel('Workspace').selectOption('personal-alice');
    await expect(page.getByRole('table')).toBeVisible();
    await page.getByText('Query input (JSON)').click();
    await page.getByLabel('Input for activities').fill('{"limit":1}');
    await page.getByRole('button', { name: 'Run query', exact: true }).click();
    await expect(page.getByRole('table')).toContainText('CURRENT_WORKSPACE_RESULT');
    const staleResponse = page.waitForResponse(async (response) => response.url().endsWith('/api/query') && (await response.text()).includes('STALE_WORKSPACE_RESULT'));
    release.resolve();
    await staleResponse;
    await expect(page.getByRole('table')).toContainText('CURRENT_WORKSPACE_RESULT');
    await expect(page.getByRole('table')).not.toContainText('STALE_WORKSPACE_RESULT');
  } finally { release.resolve(); }
});

test('custom launchers distinguish query, mutation and task operations with the same name', async ({ page }) => {
  await page.route('**/api/manifest?**', async (route) => {
    const response = await route.fetch();
    const manifest = decodeWire(await response.json()) as WorkcoreManifest;
    const input = { type: 'object', properties: {} };
    manifest.operations.push(
      { kind: 'mutation', name: 'activities', input, output: input, ui: { default: 'form', variants: { form: { title: 'Same-name mutation', renderer: 'form' } } } },
      { kind: 'task', name: 'activities', input, output: input, ui: { default: 'form', variants: { form: { title: 'Same-name task', renderer: 'form' } } } },
    );
    manifest.pages!.push({ id: 'namespace-test', title: 'Namespace test', blocks: [{ id: 'mutation', type: 'mutation-form', operation: 'activities' }, { id: 'task', type: 'task-launcher', operation: 'activities' }] });
    await route.fulfill({ contentType: 'application/json', body: encodeWire(manifest) });
  });
  await login(page, 'alice');
  await page.getByRole('button', { name: /Namespace test/ }).click();
  await page.getByRole('button', { name: 'Open form' }).click();
  await expect(page.getByRole('heading', { name: 'Same-name mutation' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Run mutation', exact: true })).toBeVisible();
  await page.getByRole('button', { name: /Namespace test/ }).click();
  await page.getByRole('button', { name: 'Launch task', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Same-name task' })).toBeVisible();
  await page.locator('.operation-row').filter({ hasText: 'Same-name mutation' }).click();
  await expect(page.getByRole('heading', { name: 'Same-name mutation' })).toBeVisible();
});

test('the admin wire codec preserves Date values across a query round trip', async ({ page }) => {
  await login(page, 'alice');
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
  await login(page, 'alice');
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
  await page.getByRole('button', { name: 'Task runs' }).click();
  await page.getByRole('button', { name: 'Schedules' }).click();
  await expect(page.getByLabel('Cron for refreshSummary')).toHaveValue('30 8 * * *');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByLabel('Cron for refreshSummary')).toHaveValue('30 8 * * *');
  await page.getByRole('button', { name: 'Disable' }).click();
  await expect(page.getByRole('button', { name: 'Enable' })).toBeVisible();
  await page.getByRole('button', { name: 'Remove' }).click();
});

test('Better Auth-backed identity workspace is admin-only and lists persistent users', async ({ browser, baseURL }) => {
  const signup = await browser.newPage();
  const blockedSignup = await signup.request.post(`${baseURL}/api/auth/sign-up/email`, {
    data: { email: 'public@example.test', name: 'Public Signup', password: 'not-a-demo-account' },
  });
  expect(blockedSignup.status()).toBe(403);
  await signup.close();

  const adminContext = await browser.newContext();
  const aliceContext = await browser.newContext();
  const admin = await adminContext.newPage();
  const alice = await aliceContext.newPage();
  await login(admin, 'admin');
  await login(alice, 'alice');

  const result = await admin.request.post(`${baseURL}/workcore/api/query`, {
    data: { applicationId: 'identity', workspaceId: 'directory', operation: 'users', input: {} },
  });
  expect(result.ok()).toBeTruthy();
  const users = await result.json() as { result: { rows: Array<{ id: string; username: string; role: string }> } };
  expect(users.result.rows.map(({ username }) => username).sort()).toEqual(['admin', 'alice', 'bob']);
  expect(users.result.rows.find(({ username }) => username === 'admin')?.role).toBe('admin');
  const adminUser = users.result.rows.find(({ username }) => username === 'admin')!;
  const demoteLastAdmin = await admin.request.post(`${baseURL}/workcore/api/mutate`, {
    data: { applicationId: 'identity', workspaceId: 'directory', operation: 'setUserRole', input: { id: adminUser.id, role: 'user' } },
  });
  expect(demoteLastAdmin.ok()).toBeFalsy();
  const bob = users.result.rows.find(({ username }) => username === 'bob')!;
  const promote = await admin.request.post(`${baseURL}/workcore/api/mutate`, {
    data: { applicationId: 'identity', workspaceId: 'directory', operation: 'setUserRole', input: { id: bob.id, role: 'admin' } },
  });
  expect(promote.ok()).toBeTruthy();
  expect((await promote.json() as { result: { role: string } }).result.role).toBe('admin');
  const restore = await admin.request.post(`${baseURL}/workcore/api/mutate`, {
    data: { applicationId: 'identity', workspaceId: 'directory', operation: 'setUserRole', input: { id: bob.id, role: 'user' } },
  });
  expect(restore.ok()).toBeTruthy();
  const rename = await admin.request.post(`${baseURL}/workcore/api/mutate`, {
    data: { applicationId: 'identity', workspaceId: 'directory', operation: 'setUserName', input: { id: bob.id, name: 'Bob Demo Renamed' } },
  });
  expect(rename.ok()).toBeTruthy();
  expect((await rename.json() as { result: { name: string } }).result.name).toBe('Bob Demo Renamed');
  const restoreName = await admin.request.post(`${baseURL}/workcore/api/mutate`, {
    data: { applicationId: 'identity', workspaceId: 'directory', operation: 'setUserName', input: { id: bob.id, name: 'Bob Example' } },
  });
  expect(restoreName.ok()).toBeTruthy();

  await admin.getByLabel('Application').selectOption('identity');
  const bobRow = admin.getByRole('row').filter({ hasText: 'bob' });
  await bobRow.getByRole('button', { name: 'Change name' }).click();
  await expect(admin.locator('.generated-form input[type="text"]').nth(1)).toHaveValue('Bob Example');
  await admin.getByRole('button', { name: 'Users' }).click();
  await bobRow.getByRole('button', { name: 'Change role' }).click();
  await expect(admin.locator('.generated-form select')).toHaveValue('user');

  const denied = await alice.request.post(`${baseURL}/workcore/api/query`, {
    data: { applicationId: 'identity', workspaceId: 'directory', operation: 'users', input: {} },
  });
  expect(denied.status()).toBe(403);
  await adminContext.close();
  await aliceContext.close();
});
