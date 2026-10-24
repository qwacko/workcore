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
  await alice.locator('.operation-row').filter({ hasText: 'activities.list' }).click();
  await bob.locator('.operation-row').filter({ hasText: 'activities.list' }).click();
  await expect(alice.getByRole('table')).toBeVisible();
  await expect(bob.getByRole('table')).toBeVisible();

  const statusFilter = alice.locator('.collection-filters select');
  await statusFilter.selectOption('complete');
  await alice.getByRole('button', { name: 'Run query' }).click();
  await expect(alice.getByRole('table').getByText('Shared trail cleanup')).toBeVisible();
  await expect(alice.getByRole('table').getByText('Plan group hike')).toHaveCount(0);
  await statusFilter.selectOption('');
  await alice.getByRole('button', { name: 'Run query' }).click();
  await expect(alice.getByRole('table').getByText('Plan group hike')).toBeVisible();

  await alice.locator('.row-actions button[aria-label^="Edit title"]').first().click();
  const titleInput = alice.locator('.collection-editor .generated-form input[type="text"]').last();
  const updatedTitle = `Live update ${Date.now()}`;
  await titleInput.fill(updatedTitle);
  await alice.getByRole('button', { name: 'Save changes' }).click();
  await expect(alice.getByRole('table').getByText(updatedTitle)).toBeVisible();
  await expect(bob.getByRole('table').getByText(updatedTitle)).toBeVisible({ timeout: 8_000 });

  const denied = await bob.request.post(`${baseURL}/workcore/api/query`, {
    data: { applicationId: 'tracker', workspaceId: 'personal-alice', operation: 'activities.list', input: {} },
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
  await page.getByLabel('Input for activities.list').fill(JSON.stringify({ limit: 1 }, null, 2));
  await page.getByRole('button', { name: 'Run query' }).click();
  await expect(page.getByRole('table').getByRole('row')).toHaveCount(2);
  await expect(page.getByRole('button', { name: 'Submit mutation' })).toBeVisible();
  await page.getByLabel('Input for activities.list').fill(JSON.stringify({ limit: 10 }, null, 2));
  await page.getByRole('button', { name: 'Run query' }).click();
  await page.locator('.row-actions button[aria-label^="Edit title"]').first().click();
  await expect(page.getByRole('heading', { name: 'Edit record' })).toBeVisible();
  const inlineTitle = page.locator('.collection-editor .generated-form input[type="text"]').last();
  await inlineTitle.fill(`Semantic edit ${Date.now()}`);
  const savedTitle = await inlineTitle.inputValue();
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('table').getByText(savedTitle)).toBeVisible();
  await page.getByRole('button', { name: 'Task runs' }).click();
  await expect(page.getByRole('heading', { name: 'Task runs', level: 1 })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('heading', { name: 'Activity dashboard', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Edit activity' }).first().click();
  await expect(page.getByRole('heading', { name: 'Edit activity' })).toBeVisible();
});

test('the tracker composes activity updates and live summaries into Milo on a shared overview page', async ({ page }) => {
  await login(page, 'alice');
  const call = async (path: string, operation: string, input: unknown) => {
    const response = await page.request.post(`/workcore/api/${path}`, {
      headers: { 'x-workcore-codec': testCodec.id },
      data: JSON.parse(encodeWire({ applicationId: 'tracker', workspaceId: 'personal-alice', operation, input })),
    });
    expect(response.ok()).toBeTruthy();
    return decodeWire(await response.json()).result;
  };
  const activities = (await call('query', 'activities.list', { limit: 100 })).rows as Array<{ id: string; title: string; status: string }>;
  const first = activities[0]!;
  const title = `Composed trail update ${Date.now()}`;
  await call('mutate', 'activities.edit', { id: first.id, title, status: first.status });
  await page.getByRole('button', { name: /Workspace overview/ }).click();
  await expect(page.getByRole('table')).toContainText(title);
  await page.getByLabel('Message').fill('What changed?');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.locator('.chat-message:not(.user-message)').last()).toContainText(title, { timeout: 8000 });
  await page.getByLabel('Message').fill('How are my activities looking?');
  await page.getByRole('button', { name: 'Send message' }).click();
  const complete = activities.filter((activity) => activity.status === 'complete').length;
  await expect(page.locator('.chat-message:not(.user-message)').last()).toContainText(`${activities.length} activities: ${complete} complete and ${activities.length - complete} planned`, { timeout: 8000 });
});

test('page mutation forms submit through the authorized operation and refresh their query', async ({ page }) => {
  await login(page, 'alice');
  await page.getByRole('button', { name: /Activity dashboard/ }).click();
  await page.getByRole('button', { name: 'Run query' }).click();
  const form = page.locator('.inline-mutation-form');
  const fields = form.locator('.generated-form input');
  const updatedTitle = `Inline mutation ${Date.now()}`;
  await fields.nth(0).fill('ride-002');
  await fields.nth(1).fill(updatedTitle);
  await form.locator('.generated-form select').selectOption('complete');
  await form.getByRole('button', { name: 'Submit mutation' }).click();
  await expect(form.getByRole('status')).toHaveText('Mutation completed.');
  await expect(page.getByRole('table').getByText(updatedTitle)).toBeVisible();
});

test('operation default view uses its query-owned collection configuration', async ({ page }) => {
  await login(page, 'alice');
  await page.locator('.operation-row').filter({ hasText: 'activities.list' }).click();
  await expect(page.getByRole('button', { name: 'Manage activities', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Run query' }).click();
  await expect(page.getByLabel('Filter title')).toBeVisible();
  const editFirstRow = page.locator('.row-actions button[aria-label^="Edit title"]').first();
  await expect(editFirstRow).toBeVisible();
  await expect(editFirstRow).toHaveAccessibleName(/title/i);
  await editFirstRow.click();
  await expect(page.getByRole('heading', { name: 'Edit record' })).toBeVisible();
});

test('authored JSON variant renders JSON without adding inferred picker variants', async ({ page }) => {
  await login(page, 'alice');
  await page.locator('.operation-row').filter({ hasText: 'activities.list' }).click();
  await page.getByRole('button', { name: 'Activity data', exact: true }).click();
  await page.getByRole('button', { name: 'Run query' }).click();
  await expect(page.locator('.result')).toContainText('rows');
});

test('linked mutation actions prefill matching row fields by schema', async ({ page }) => {
  await login(page, 'alice');
  await page.locator('.operation-row').filter({ hasText: 'activities.list' }).click();
  await page.getByRole('button', { name: 'Run query' }).click();
  await page.locator('.row-actions').getByRole('button', { name: /Edit activity:/ }).first().click();
  await expect(page.getByRole('heading', { name: 'Edit activity', exact: true })).toBeVisible();
  const input = (name: string) => page.locator('.generated-form label').filter({ hasText: name }).locator('input');
  await expect(input('id')).not.toHaveValue('');
  await expect(input('title')).not.toHaveValue('');
  await expect(page.locator('.generated-form label').filter({ hasText: 'status' }).locator('select')).toHaveValue(/planned|complete/);
});

test('Operations exposes authored named views in its variant picker', async ({ page }) => {
  await login(page, 'alice');
  await page.locator('.operation-row').filter({ hasText: 'activities.list' }).click();
  await page.getByRole('button', { name: 'Manage activities', exact: true }).click();
  await page.getByRole('button', { name: 'Run query' }).click();
  await expect(page.getByLabel('Filter title')).toBeVisible();
  await expect(page.locator('.row-actions button[aria-label^="Edit title"]').first()).toBeVisible();
});

test('collection filter changes confirm and discard dirty editor drafts', async ({ page }) => {
  await login(page, 'alice');
  await page.locator('.operation-row').filter({ hasText: 'activities.list' }).click();
  await page.locator('.row-actions button[aria-label^="Edit title"]').first().click();
  const title = page.locator('.collection-editor .generated-form input[type="text"]').last();
  await title.fill('Unsaved activity draft');

  page.once('dialog', (dialog) => void dialog.dismiss());
  await page.locator('.collection-filters select').selectOption('complete');
  await expect(page.locator('.collection-editor')).toBeVisible();
  await expect(title).toHaveValue('Unsaved activity draft');
  await expect(page.locator('.collection-filters select')).toHaveValue('');

  page.once('dialog', (dialog) => void dialog.accept());
  await page.locator('.collection-filters select').selectOption('planned');
  await expect(page.locator('.collection-editor')).toHaveCount(0);
  const statuses = page.getByRole('table').locator('tbody tr td:nth-child(2)');
  await expect(statuses).not.toHaveCount(0);
  for (const cell of await statuses.all()) await expect(cell).toHaveText('planned');
});

test('page navigation confirms before discarding a dirty collection editor', async ({ page }) => {
  await login(page, 'alice');
  await page.locator('.operation-row').filter({ hasText: 'activities.list' }).click();
  await page.locator('.row-actions button[aria-label^="Edit title"]').first().click();
  const title = page.locator('.collection-editor .generated-form input[type="text"]').last();
  await title.fill('Draft preserved on canceled navigation');

  page.once('dialog', (dialog) => void dialog.dismiss());
  await page.getByRole('button', { name: /Activity dashboard/ }).click();
  await expect(page.getByRole('heading', { name: 'Operations', exact: true })).toBeVisible();
  await expect(title).toHaveValue('Draft preserved on canceled navigation');

  page.once('dialog', (dialog) => void dialog.accept());
  await page.getByRole('button', { name: /Activity dashboard/ }).click();
  await expect(page.getByRole('heading', { name: 'Activity dashboard', exact: true })).toBeVisible();
});

test('browser back confirms before discarding a dirty page editor', async ({ page }) => {
  await login(page, 'alice');
  await page.getByRole('button', { name: 'Activity dashboard' }).click();
  await page.locator('.row-actions button[aria-label^="Edit title"]').first().click();
  const title = page.locator('.collection-editor .generated-form input[type="text"]').last();
  await title.fill('Keep this draft while canceling back');

  page.once('dialog', (dialog) => void dialog.dismiss());
  await page.goBack();
  await expect(page.getByRole('heading', { name: 'Activity dashboard', exact: true })).toBeVisible();
  await expect(title).toHaveValue('Keep this draft while canceling back');

  page.once('dialog', (dialog) => void dialog.accept());
  await page.goBack();
  await expect(page.getByRole('heading', { name: 'Operations', exact: true })).toBeVisible();
});

test('semantic collections render as selectable cards on narrow screens', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, 'alice');
  await page.getByLabel('Admin page').selectOption('activityDashboard');
  await expect(page.locator('.mobile-collection')).toBeVisible();
  await expect(page.getByRole('table')).toBeHidden();
  await expect(page.locator('.collection-card')).not.toHaveCount(0);
  await expect(page.locator('.collection-card').first().locator('.collection-card-heading strong')).not.toBeEmpty();
  await page.locator('.collection-card').first().locator('button[aria-label^="Edit title"]').click();
  await expect(page.getByRole('heading', { name: 'Edit record' })).toBeVisible();
});

test('application-authored resource blocks load through the authorized history adapter', async ({ page }) => {
  await login(page, 'alice');
  await page.getByRole('button', { name: 'Workspace history' }).click();
  await expect(page.getByRole('heading', { name: 'Workspace history', exact: true })).toBeVisible();
  await expect(page.locator('.custom-block').getByRole('heading', { name: 'Recent activity' })).toBeVisible();
  await expect(page.locator('.custom-block').getByText(/No history records|operation/).first()).toBeVisible();
});

test('application-authored operation catalog and executor use checked manifest operations', async ({ page }) => {
  await login(page, 'alice');
  await page.getByRole('button', { name: 'Operation workbench' }).click();
  await expect(page.getByRole('heading', { name: 'Operation workbench', exact: true })).toBeVisible();
  await page.locator('.operation-row').filter({ hasText: 'activities.list' }).click();
  await page.getByRole('button', { name: 'Run query' }).click();
  await expect(page.getByRole('table')).toBeVisible();
});

test('custom component descriptors render a safe placeholder without loading manifest code', async ({ page }) => {
  await login(page, 'alice');
  await page.getByRole('button', { name: 'Renderer extension' }).click();
  await expect(page.getByRole('heading', { name: 'Renderer extension', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Activity summary', exact: true })).toBeVisible();
  await expect(page.locator('.custom-component-placeholder code')).toHaveText('tracker/activity-summary@1');
  await expect(page.getByText('A custom renderer can replace this placeholder with an activity summary.')).toBeVisible();
});

test('page-owned state binds into a child query source', async ({ page }) => {
  await login(page, 'alice');
  await page.getByRole('button', { name: 'Activity search' }).click();
  await expect(page.getByRole('heading', { name: 'Activity search', exact: true })).toBeVisible();
  const search = page.getByRole('searchbox', { name: 'Search activities' });
  const resultRows = page.locator('.custom-block table tbody tr');
  await expect(resultRows).not.toHaveCount(0);
  const status = page.getByLabel('Activity status');
  await status.selectOption('complete');
  const statusCells = page.getByRole('table').locator('tbody tr td:nth-child(2)');
  await expect(statusCells).not.toHaveCount(0);
  await expect.poll(async () => {
    const statuses = await statusCells.allTextContents();
    return statuses.length > 0 && statuses.every((value) => value === 'complete');
  }).toBe(true);
  await status.selectOption('planned');
  await expect(statusCells).not.toHaveCount(0);
  const plannedCount = await statusCells.count();
  await expect.poll(async () => {
    const statuses = await statusCells.allTextContents();
    return statuses.length > 0 && statuses.every((value) => value === 'planned');
  }).toBe(true);
  await status.selectOption('');
  await expect.poll(() => statusCells.count()).toBeGreaterThan(plannedCount);
  await search.fill('no-match-expected-9f8e7d');
  await search.press('Enter');
  await expect(resultRows).toHaveCount(0);
  await search.fill('');
  await search.press('Enter');
  await expect(resultRows).not.toHaveCount(0);
});

test('semantic collections remain readable without exposing an unauthorized editor', async ({ page }) => {
  await login(page, 'bob');
  await page.getByRole('button', { name: /Activity dashboard/ }).click();
  await expect(page.getByRole('table')).toBeVisible();
  await expect(page.getByRole('button', { name: /^Edit/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Edit activity' })).toHaveCount(0);
});

test('agent-run inspection appears only for actors with the run capability', async ({ browser }) => {
  const owner = await browser.newPage();
  await login(owner, 'alice');
  await owner.getByLabel('Workspace').selectOption('team');
  await owner.getByRole('button', { name: 'Agent runs' }).click();
  await expect(owner.locator('h1', { hasText: 'Agent runs' })).toBeVisible();
  await expect(owner.getByText('No agent runs')).toBeVisible();

  const viewer = await browser.newPage();
  await login(viewer, 'bob');
  await viewer.getByLabel('Workspace').selectOption('team');
  await expect(viewer.getByRole('button', { name: 'Agent runs' })).toHaveCount(0);
  await owner.close();
  await viewer.close();
});

test('semantic agent resource filters, selects a run, and renders its authorized trace', async ({ page }) => {
  const runFilters: string[] = [];
  await page.route('**/workcore/api/agent-runs**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/events')) {
      await route.fulfill({ contentType: 'application/json', body: encodeWire({ events: [{ id: 'event-1', runId: 'run-semantic', sequence: 1, createdAt: '2026-10-15T12:00:00.000Z', type: 'run.started', data: { phase: 'started' } }], nextCursor: null }) });
      return;
    }
    runFilters.push(url.searchParams.get('agent') ?? '');
    const runs = url.searchParams.has('cursor')
      ? [{ id: 'run-semantic-2', scope: { applicationId: 'tracker', workspaceId: 'team' }, actorId: 'alice', agent: 'Trail helper', status: 'failed', createdAt: '2026-10-15T12:01:00.000Z', correlationId: 'correlation-2' }]
      : [{ id: 'run-semantic', scope: { applicationId: 'tracker', workspaceId: 'team' }, actorId: 'alice', agent: 'Trail helper', status: 'succeeded', createdAt: '2026-10-15T12:00:00.000Z', correlationId: 'correlation-1', result: { ok: true } }];
    await route.fulfill({ contentType: 'application/json', body: encodeWire({ runs, nextCursor: url.searchParams.has('cursor') ? null : 'cursor-next' }) });
  });
  await login(page, 'alice');
  await page.getByLabel('Workspace').selectOption('team');
  await page.getByRole('button', { name: 'Agent runs' }).click();
  await expect(page.getByRole('button', { name: /Trail helper/ })).toBeVisible();
  await page.getByLabel('Agent', { exact: true }).fill('Trail helper');
  await page.getByRole('button', { name: 'Filter' }).click();
  await expect.poll(() => runFilters.at(-1)).toBe('Trail helper');
  await page.getByRole('button', { name: /Trail helper/ }).click();
  await expect(page.getByText('run.started')).toBeVisible();
  await expect(page.getByText('correlation-1')).toHaveCount(0);
  await expect(page.getByText('Final result')).toBeVisible();
  await page.getByRole('button', { name: 'Load more runs' }).click();
  await expect(page.locator('.agent-run-row')).toHaveCount(2);
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
  await expect(page.getByRole('heading', { name: 'Task runs', level: 1 })).toBeVisible();
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
    if (input.operation !== 'activities.list' || input.workspaceId !== 'personal-alice' || input.input.limit !== 1) return route.continue();
    const old = matchingRequests++ === 0;
    if (old) { entered.resolve(); await release.promise; }
    await route.fulfill({ contentType: 'application/json', body: encodeWire({ executionId: old ? 'stale-execution' : 'current-execution', result: { rows: [{ id: 'regression', title: old ? 'STALE_WORKSPACE_RESULT' : 'CURRENT_WORKSPACE_RESULT', status: 'planned', updatedAt: new Date() }], nextCursor: null } }) });
  });
  try {
    await page.getByText('Query input (JSON)').click();
    await page.getByLabel('Input for activities.list').fill('{"limit":1}');
    await page.getByRole('button', { name: 'Run query', exact: true }).click();
    await entered.promise;
    await page.getByLabel('Workspace').selectOption('team');
    await expect(page.getByRole('table')).toBeVisible();
    await page.getByLabel('Workspace').selectOption('personal-alice');
    await expect(page.getByRole('table')).toBeVisible();
    await page.getByText('Query input (JSON)').click();
    await page.getByLabel('Input for activities.list').fill('{"limit":1}');
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
      { kind: 'mutation', name: 'activities.list', input, output: input },
      { kind: 'task', name: 'activities.list', input, output: input },
    );
    manifest.interface.operationViews.push(
      { operation: 'activities.list', kind: 'mutation', default: 'form', variants: { form: { title: 'Same-name mutation', renderer: 'form' } } },
      { operation: 'activities.list', kind: 'task', default: 'form', variants: { form: { title: 'Same-name task', renderer: 'form' } } },
    );
    manifest.interface.pages.push({ id: 'namespace-test', title: 'Namespace test', blocks: [{ id: 'mutation', type: 'mutation-form', operation: 'activities.list' }, { id: 'task', type: 'task-launcher', operation: 'activities.list' }] });
    await route.fulfill({ contentType: 'application/json', body: encodeWire(manifest) });
  });
  await login(page, 'alice');
  await page.getByRole('button', { name: /Namespace test/ }).click();
  await expect(page.getByRole('button', { name: 'Submit mutation' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Same-name mutation' })).toBeVisible();
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
  await expect(page.getByRole('heading', { name: 'Schedules', level: 1 })).toBeVisible();
  const cron = page.getByLabel('Cron for activities.refreshSummary');
  await expect(cron).toHaveValue('0 9 * * *');
  await cron.fill('30 8 * * *');
  await page.getByRole('button', { name: 'Task runs' }).click();
  await page.getByRole('button', { name: 'Schedules' }).click();
  await expect(page.getByLabel('Cron for activities.refreshSummary')).toHaveValue('30 8 * * *');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByLabel('Cron for activities.refreshSummary')).toHaveValue('30 8 * * *');
  await page.getByRole('button', { name: 'Disable' }).click();
  await expect(page.getByRole('button', { name: 'Enable' })).toBeVisible();
  await page.getByRole('button', { name: 'Remove' }).click();
  await page.getByRole('button', { name: 'Create schedule' }).click();
  await expect(page.getByRole('dialog').getByLabel('Task')).toHaveValue('activities.refreshSummary');
  await page.getByRole('dialog').getByRole('button', { name: 'Create schedule' }).click();
  await expect(page.locator('.schedule-resource-card')).toHaveCount(1);
  await page.locator('.schedule-resource-card').getByRole('button', { name: 'Remove' }).click();
});

test('schedule resource blocks project read-only access without management controls', async ({ page }) => {
  await login(page, 'bob');
  await page.getByRole('button', { name: 'Schedules' }).click();
  await expect(page.getByRole('heading', { name: 'Schedules', level: 1 })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create schedule' })).toHaveCount(0);
  await expect(page.getByLabel(/Cron for/)).toHaveCount(0);
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
