import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { TaskPayload } from '@workcore/core';
import { createFileState } from './file/index.js';

const scope = { applicationId: 'app', workspaceId: 'one' };
const workspaces = [{ applicationId: 'app', id: 'one', name: 'One', actors: ['alice'] }];
const payload = (id: string): TaskPayload => ({ id, ...scope, operation: 'run', input: {}, actorId: 'alice', correlationId: 'correlation', createdAt: new Date().toISOString() });

describe('local file persistence', () => {
  let directory: string;
  let path: string;
  beforeEach(async () => { await mkdir('/tmp/opencode', { recursive: true }); directory = await mkdtemp('/tmp/opencode/workcore-file-'); path = join(directory, 'state.json'); });
  afterEach(async () => { await rm(directory, { recursive: true }); });

  it('migrates legacy KV once, preserving newer values without resurrecting deleted data', async () => {
    await writeFile(path, JSON.stringify({ kv: { 'app:one:key': 'old', 'app:one:other': 'legacy', '["app","one","key"]': 'new' } }));
    const state = createFileState({ path, workspaces });
    expect(await state.kv.get(scope, 'key')).toBe('new');
    expect(await state.kv.get(scope, 'other')).toBe('legacy');
    await state.kv.delete(scope, 'key');
    await state.kv.delete(scope, 'other');
    const reopened = createFileState({ path, workspaces });
    expect(await reopened.kv.get(scope, 'key')).toBeUndefined();
    expect(await reopened.kv.get(scope, 'other')).toBeUndefined();
    const saved = JSON.parse(await readFile(path, 'utf8'));
    expect(saved.formatVersion).toBe(1);
    expect(saved.kv).toEqual({});
  });

  it('preserves ambiguous legacy keys rather than guessing their workspace', async () => {
    const ambiguous = [
      { applicationId: 'a:b', id: 'c', name: 'One', actors: ['alice'] },
      { applicationId: 'a', id: 'b:c', name: 'Two', actors: ['alice'] },
    ];
    await writeFile(path, JSON.stringify({ kv: { 'a:b:c:key': 'ambiguous' } }));
    const state = createFileState({ path, workspaces: ambiguous });
    expect(await state.kv.get({ applicationId: 'a:b', workspaceId: 'c' }, 'key')).toBeUndefined();
    expect(await state.kv.get({ applicationId: 'a', workspaceId: 'b:c' }, 'key')).toBeUndefined();
    expect(JSON.parse(await readFile(path, 'utf8')).kv).toEqual({ 'a:b:c:key': 'ambiguous' });
  });

  it('does not rewrite unchanged state on idle polling or inspection', async () => {
    const state = createFileState({ path, workspaces });
    await state.kv.set(scope, 'key', { value: 1 });
    const before = await stat(path, { bigint: true });
    await state.tasks.claim();
    await state.schedules.claimDue(new Date(), 'idle', 30_000);
    await state.history.list(scope, 10);
    await state.kv.set(scope, 'key', { value: 1 });
    const after = await stat(path, { bigint: true });
    expect(after.ino).toBe(before.ino);
    expect(after.mtimeNs).toBe(before.mtimeNs);
  });

  it('recovers processing tasks in order even if the first startup operation fails', async () => {
    const first = createFileState({ path, workspaces });
    await first.tasks.enqueue(payload('first'));
    await first.tasks.enqueue(payload('second'));
    await first.tasks.claim();
    await first.tasks.claim();
    await first.schedules.create({ id: 'existing', scope, operation: 'run', input: {}, actorId: 'alice', timezone: 'UTC', kind: 'once', enabled: false, createdAt: new Date().toISOString() });
    const reopened = createFileState({ path, workspaces });
    await expect(reopened.schedules.create({ id: 'existing', scope, operation: 'run', input: {}, actorId: 'alice', timezone: 'UTC', kind: 'once', enabled: false, createdAt: new Date().toISOString() })).rejects.toThrow('Duplicate');
    expect((await reopened.tasks.claim())?.id).toBe('first');
    expect((await reopened.tasks.claim())?.id).toBe('second');
  });

  it('does not recover terminal runs as executable work', async () => {
    const state = createFileState({ path, workspaces });
    await state.tasks.enqueue(payload('terminal'));
    await state.tasks.claim();
    await state.tasks.complete('terminal', {});
    const saved = JSON.parse(await readFile(path, 'utf8'));
    saved.processing.push(payload('terminal'));
    await writeFile(path, JSON.stringify(saved));
    const reopened = createFileState({ path, workspaces });
    expect(await reopened.tasks.claim()).toBeUndefined();
    expect((await reopened.tasks.list(scope, 10))[0]?.status).toBe('succeeded');
  });

  it('prunes terminal task records after completion while preserving active work and deduplication', async () => {
    const state = createFileState({ path, workspaces, retention: { taskRunLimit: 1 } });
    for (const id of ['old', 'new', 'active']) await state.tasks.enqueue(payload(id));
    expect((await state.tasks.claim())?.id).toBe('old');
    await state.tasks.complete('old', {});
    expect((await state.tasks.claim())?.id).toBe('new');
    await state.tasks.complete('new', {});
    expect((await state.tasks.list(scope, 10)).map((run) => run.runId)).toEqual(['active', 'new']);
    const reopened = createFileState({ path, workspaces, retention: { taskRunLimit: 1 } });
    await reopened.tasks.enqueue(payload('old'));
    expect((await reopened.tasks.claim())?.id).toBe('active');
    expect(await reopened.tasks.claim()).toBeUndefined();
  });

  it('never overwrites unsupported future state formats', async () => {
    const contents = JSON.stringify({ formatVersion: 99, kv: { preserved: true } });
    await writeFile(path, contents);
    const state = createFileState({ path, workspaces });
    await expect(state.kv.set(scope, 'key', 1)).rejects.toThrow('Unsupported');
    expect(await readFile(path, 'utf8')).toBe(contents);
  });
});
