import { describe, expect, it } from 'vitest';
import { createComposedExample } from './composed.js';

describe('documented synchronous module composition', () => {
  it('wires required settings and an awaited optional cross-module callback', async () => {
    const { client, services } = createComposedExample();
    const one = client('one');
    expect(await one.query('todos.timezone', {})).toBe('UTC');
    const todo = await one.mutate('todos.create', { title: 'Ship composition' });
    expect(await one.mutate('todos.complete', { id: todo.id })).toMatchObject({ id: todo.id, completed: true });
    expect(await one.query('calendar.entries', {})).toEqual(['Ship composition']);
    expect(await client('two').query('todos.list', {})).toEqual([]);
    expect(await client('two').query('calendar.entries', {})).toEqual([]);
    const history = await services.history.list({ applicationId: 'composed', workspaceId: 'one' }, 100);
    expect(history.filter((entry) => entry.kind === 'mutation').map((entry) => entry.operation)).toEqual(expect.arrayContaining(['todos.create', 'todos.complete', 'calendar.record']));
  });

  it('projects qualified module pages into the unchanged manifest and hides internal operations', async () => {
    const { transport, handle } = createComposedExample();
    const manifest = await transport.manifest('composed', 'one');
    expect(manifest.operations.map((operation) => operation.name)).toContain('todos.complete');
    expect(manifest.operations.map((operation) => operation.name)).not.toContain('calendar.record');
    expect(manifest.interface.defaultPage).toBe('todos.overview');
    expect(manifest.interface.pages.find((page) => page.id === 'todos.overview')?.blocks).toContainEqual(expect.objectContaining({ type: 'query', operation: 'todos.list', variant: 'json' }));
    const denied = await handle(new Request('http://localhost/workcore/api/mutate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ applicationId: 'composed', workspaceId: 'one', operation: 'calendar.record', input: { title: 'Bypass' } }) }));
    expect(denied.status).toBe(404);
  });

  it('rechecks target authorization and does not pretend a failing callback rolls back prior writes', async () => {
    const { client } = createComposedExample({ calendarWrites: false });
    const one = client('one');
    const todo = await one.mutate('todos.create', { title: 'Still completed' });
    await expect(one.mutate('todos.complete', { id: todo.id })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(await one.query('todos.list', {})).toEqual([{ ...todo, completed: true }]);
    expect(await one.query('calendar.entries', {})).toEqual([]);
  });
});
