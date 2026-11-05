import { expect, test, type Page } from '@playwright/test';

async function signup(page: Page) {
  const result = await page.request.post('/api/auth/sign-up/email', {
    headers: { origin: 'http://localhost:8788' },
    data: {
      name: 'Demo user',
      email: `demo-${crypto.randomUUID()}@example.com`,
      password: 'test-password-123',
    },
  });
  expect(result.ok(), await result.text()).toBeTruthy();
  await page.goto('/');
  await expect(page.getByRole('region', { name: 'Workspace chat' })).toBeVisible();
}
async function send(page: Page, text: string) {
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill(text);
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Stop assistant' })).toHaveCount(0, {
    timeout: 15000,
  });
}
async function mutate(page: Page, workspace: string, name: string, input: unknown) {
  const result = await page.request.post(`/api/workspaces/${workspace}/mutate`, {
    data: { name, input, requestId: crypto.randomUUID() },
  });
  expect(result.ok(), await result.text()).toBeTruthy();
  return (await result.json()).data;
}

test('custom shadcn chat creates an interactive task card, and task changes stay live across sections', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await signup(page);
  await send(page, 'Create a task to verify the typed chat');
  const card = page.getByRole('region', { name: 'Live tasks' }).last();
  await expect(card).toContainText('verify the typed chat');
  await expect(card.locator('[data-slot="checkbox"]')).toBeVisible();
  await card.getByRole('checkbox', { name: 'Complete verify the typed chat' }).click();
  await expect(card.getByRole('checkbox', { name: 'Reopen verify the typed chat' })).toBeChecked();
  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('button', { name: 'Tasks', exact: true })
    .click();
  await page.getByRole('tab', { name: 'Completed', exact: true }).click();
  await expect(
    page.locator('.task-item').filter({ hasText: 'verify the typed chat' }),
  ).toBeVisible();
  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('button', { name: 'Chat', exact: true })
    .click();
  await expect(card.getByRole('checkbox', { name: 'Reopen verify the typed chat' })).toBeChecked();
  await page.reload();
  await expect(card).toContainText('verify the typed chat');
  expect(errors).toEqual([]);
});

test('notes use the same card and editor in chat and workspace, with independent live filters', async ({
  page,
}) => {
  await signup(page);
  const first = await mutate(page, 'notes', 'create', {
    title: 'Launch notes',
    body: 'Prepare the release checklist',
  });
  await mutate(page, 'notes', 'create', {
    title: 'Research notes',
    body: 'Read the reference material',
  });
  await send(page, 'Show my notes');
  const firstList = page.getByRole('region', { name: 'Live notes' }).first();
  await expect(firstList).toContainText('Launch notes');
  await send(page, 'Show my notes');
  const secondList = page.getByRole('region', { name: 'Live notes' }).last();
  await secondList.getByRole('searchbox', { name: 'Filter attached notes' }).fill('Launch');
  await expect(secondList.locator('.note-card')).toHaveCount(1);
  await firstList.scrollIntoViewIfNeeded();
  await expect(firstList.locator('.note-card')).toHaveCount(2);
  await secondList.scrollIntoViewIfNeeded();
  await secondList.getByRole('button', { name: 'Actions for Launch notes' }).click();
  await page.getByRole('menuitem', { name: 'Edit', exact: true }).click();
  const editor = page.getByRole('dialog');
  await editor
    .getByRole('textbox', { name: 'Note', exact: true })
    .fill('Updated in the shared note editor');
  await editor.getByRole('button', { name: 'Save note', exact: true }).click();
  await expect(editor).toHaveCount(0);
  await expect(secondList).toContainText('Updated in the shared note editor');
  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('button', { name: 'Notes', exact: true })
    .click();
  const note = page
    .getByRole('region', { name: 'Notes workspace' })
    .locator(`[data-note-id="${first.id}"]`);
  await expect(note).toContainText('Updated in the shared note editor');
  await note.getByRole('button', { name: 'Star note', exact: true }).click();
  await expect(note.getByRole('button', { name: 'Unstar note', exact: true })).toBeVisible();
  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('button', { name: 'Chat', exact: true })
    .click();
  await expect(
    page
      .getByRole('region', { name: 'Live notes' })
      .last()
      .getByRole('button', { name: 'Unstar note', exact: true }),
  ).toBeVisible();
});

test('older history paginates without moving the reader and messages survive reload', async ({
  page,
}) => {
  await signup(page);
  for (let i = 0; i < 85; i++)
    await mutate(page, 'demo', 'appendChatTurn', {
      role: i % 2 ? 'assistant' : 'user',
      content: `History message ${String(i).padStart(3, '0')}`,
    });
  await page.reload();
  const viewport = page.locator('[data-slot="message-scroller-viewport"]');
  await expect(page.locator('.chat-message')).toHaveCount(40);
  await expect(page.getByText('History message 084', { exact: true })).toBeInViewport();
  await viewport.hover();
  await page.mouse.wheel(0, -20000);
  await expect(page.getByText('History message 045', { exact: true })).toBeInViewport();
  const load = page.getByRole('button', { name: 'Load older messages' });
  await load.click();
  await expect(page.locator('.chat-message')).toHaveCount(80);
  await expect(page.getByText('History message 045', { exact: true })).toBeInViewport();
  await viewport.hover();
  await page.mouse.wheel(0, -20000);
  await load.click();
  await expect(page.locator('.chat-message')).toHaveCount(85);
  await expect(load).toHaveCount(0);
  await viewport.hover();
  await page.mouse.wheel(0, -20000);
  await expect(page.getByText('History message 000', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.locator('.chat-message')).toHaveCount(40);
  await expect(page.getByText('History message 084', { exact: true })).toBeVisible();
});

test('the compact frontend works on mobile and preserves multiline drafts', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signup(page);
  const input = page.getByRole('textbox', { name: 'Message', exact: true });
  await input.fill('Show my');
  await input.press('Shift+Enter');
  await input.press('t');
  await expect(input).toHaveValue('Show my\nt');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('button', { name: 'Notes', exact: true })
    .click();
  await page.getByRole('button', { name: 'New note', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test('the chat agent creates a private note through the typed Notes workspace adapter', async ({
  page,
}) => {
  await signup(page);
  await send(page, 'Create a note about the typed Notes bridge');
  const attachment = page.getByRole('region', { name: 'Live notes' }).last();
  await expect(attachment).toContainText('the typed Notes bridge');
  await sectionNotes();
  await expect(
    page.locator('.note-card').filter({ hasText: 'the typed Notes bridge' }),
  ).toBeVisible();
  async function sectionNotes() {
    await page
      .getByRole('navigation', { name: 'Main navigation' })
      .getByRole('button', { name: 'Notes', exact: true })
      .click();
  }
});

test('live client and task creation work when secure-context randomUUID is unavailable', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(crypto, 'randomUUID', { value: undefined, configurable: true });
  });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await signup(page);
  await send(page, 'Create a task to verify LAN HTTP support');
  const attachment = page.getByRole('region', { name: 'Live tasks' }).last();
  await expect(attachment).toContainText('verify LAN HTTP support');
  await attachment.getByRole('checkbox', { name: 'Complete verify LAN HTTP support' }).click();
  await expect(
    attachment.getByRole('checkbox', { name: 'Reopen verify LAN HTTP support' }),
  ).toBeChecked();
  expect(errors).toEqual([]);
});

test('mobile workspaces prioritize note previews and task rows over chrome', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await signup(page);
  const body = Array.from(
    { length: 20 },
    (_, index) => `Important detail ${index}: this belongs in the full note, not a scrolling card.`,
  ).join('\n');
  await mutate(page, 'notes', 'create', { title: 'Long note', body });
  await mutate(page, 'notes', 'create', {
    title: 'Another note',
    body: 'A second note should fit on the same small screen.',
  });
  const nav = page.getByRole('navigation', { name: 'Main navigation' });
  await nav.getByRole('button', { name: 'Notes', exact: true }).click();
  const cards = page.locator('.note-card');
  await expect(cards).toHaveCount(2);
  for (const card of await cards.all()) {
    await expect(card).toBeInViewport({ ratio: 1 });
    const bounds = await card.boundingBox();
    expect(bounds!.height).toBeLessThan(125);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(360);
  await page.getByRole('button', { name: 'Read Long note', exact: true }).click();
  const reader = page.getByRole('dialog');
  await expect(reader).toContainText('Important detail 19');
  await reader.getByRole('button', { name: 'Edit note', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Note', exact: true })).toHaveValue(body);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'Search notes', exact: true }).click();
  await page.getByRole('searchbox', { name: 'Search notes', exact: true }).fill('Another');
  await expect(cards).toHaveCount(1);
  await page.getByRole('button', { name: 'Search notes', exact: true }).click();
  await expect(cards).toHaveCount(2);
  for (let i = 0; i < 8; i++)
    await mutate(page, 'demo', 'createTask', { title: `Useful task ${i}`, private: true });
  await nav.getByRole('button', { name: 'Tasks', exact: true }).click();
  await page.getByRole('button', { name: 'Everyone', exact: true }).click();
  const tasks = page.locator('.task-item');
  await expect(tasks).toHaveCount(8);
  await expect(tasks.nth(7)).toBeInViewport({ ratio: 1 });
  expect((await tasks.first().boundingBox())!.y).toBeLessThan(130);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(360);
  await page.getByRole('button', { name: 'Workspace menu', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: 'Admin', exact: true })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Sign out', exact: true })).toBeVisible();
});

test('identical chat attachments share a live query and stay mounted across message and viewport updates', async ({
  page,
}) => {
  const frames: any[] = [];
  page.on('websocket', (socket) =>
    socket.on('framesent', (event) => {
      try {
        frames.push(JSON.parse(String(event.payload)));
      } catch {
        /* Non-JSON frames are irrelevant. */
      }
    }),
  );
  await signup(page);
  const note = await mutate(page, 'notes', 'create', {
    title: 'Steady live note',
    body: 'Keep this card mounted',
  });
  await send(page, 'Show my notes');
  await expect(page.getByRole('region', { name: 'Live notes' }).first()).toContainText(
    'Steady live note',
  );
  await send(page, 'Show my notes');
  const attachments = page.getByRole('region', { name: 'Live notes' });
  await expect(attachments).toHaveCount(2);
  await expect(attachments.last()).toContainText('Steady live note');
  expect(
    frames.filter(
      (frame) => frame.type === 'subscribe' && frame.kind === 'view' && frame.name === 'matching',
    ),
  ).toHaveLength(1);
  await page.evaluate(() => {
    const cards = [...document.querySelectorAll('.chat-attachment .note-card')];
    const state = { cards, removed: 0, loading: 0 };
    (window as any).__attachmentCheck = state;
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.removedNodes)
          if (cards.some((card) => node === card || node.contains(card))) state.removed++;
        for (const node of record.addedNodes)
          if (node.textContent?.includes('Loading live data')) state.loading++;
      }
    });
    observer.observe(document.querySelector('[aria-label="Workspace chat"]')!, {
      childList: true,
      subtree: true,
    });
    (window as any).__attachmentObserver = observer;
  });
  for (let i = 0; i < 6; i++)
    await mutate(page, 'demo', 'appendChatTurn', {
      role: 'user',
      content: `Unrelated message ${i}`,
    });
  await expect(page.getByText('Unrelated message 5', { exact: true })).toBeVisible();
  await mutate(page, 'notes', 'update', {
    id: note.id,
    expectedRevision: note.version,
    title: note.title,
    body: 'A fresh live update',
    starred: false,
    archived: false,
  });
  await attachments.first().scrollIntoViewIfNeeded();
  await expect(attachments.first()).toContainText('A fresh live update');
  expect(
    await page.evaluate(() => {
      const state = (window as any).__attachmentCheck;
      (window as any).__attachmentObserver.disconnect();
      return {
        removed: state.removed,
        loading: state.loading,
        connected: state.cards.every((card: Element) => card.isConnected),
      };
    }),
  ).toEqual({ removed: 0, loading: 0, connected: true });
});

test('a deleted live note attachment becomes unavailable instead of loading forever', async ({
  page,
}) => {
  await signup(page);
  await send(page, 'Create a note about an ephemeral attachment');
  const attachment = page.getByRole('region', { name: 'Live notes' }).last();
  await expect(attachment).toContainText('an ephemeral attachment');
  const id = await attachment.locator('.note-card').getAttribute('data-note-id');
  await mutate(page, 'notes', 'remove', { id, expectedRevision: 1 });
  await expect(attachment).toContainText('This note is unavailable.');
  await expect(attachment).not.toContainText('Loading live data');
});
