import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createFileState } from '@workcore/adapters/file';
import { migrateTrackerCompositionFile, migrateTrackerCompositionState } from './migrate-composition.js';

let directory: string | undefined;
afterEach(async () => { if (directory) await rm(directory, { recursive: true, force: true }); directory = undefined; });

describe('tracker composition upgrade', () => {
  it('renames only compatible pending tracker identities and preserves inputs, IDs and audit history', () => {
    const scope = { applicationId: 'tracker', workspaceId: 'team' };
    const payload = { id: 'task-1', ...scope, operation: 'refreshSummary', input: { serialized: 'unchanged' }, codecId: 'custom-v1', operationVersion: 1 };
    const input = {
      tasks: [payload, { ...payload, id: 'notes', applicationId: 'notes' }],
      processing: [{ ...payload, id: 'agent-1', operation: '@workcore/agent/milo' }],
      taskDedupe: ['task-1', 'agent-1'],
      runs: [{ id: 'task-1', scope, operation: 'refreshSummary', status: 'queued' }, { id: 'past', scope, operation: 'refreshSummary', status: 'succeeded' }],
      schedules: [{ id: 'schedule-1', scope, operation: 'refreshSummary', pendingRunId: 'reserved-run', revision: 7, input: {}, enabled: false }],
      agentRuns: [{ id: 'agent-1', scope, agent: 'milo', status: 'running' }, { id: 'past', scope, agent: 'milo', status: 'succeeded' }],
      history: [{ scope, operation: 'refreshSummary', status: 'succeeded' }],
      agentEvents: [{ runId: 'agent-1', data: { name: 'mutation.saveAssistantReply' } }],
      custom: { keep: true },
    };
    const { state, changed } = migrateTrackerCompositionState(input);
    expect(changed).toBe(true);
    expect(state.tasks).toEqual([{ ...payload, operation: 'activities.refreshSummary' }, input.tasks[1]]);
    expect(state.processing).toEqual([{ ...input.processing[0], operation: '@workcore/agent/assistant.milo' }]);
    expect(state.runs).toEqual([{ ...input.runs[0], operation: 'activities.refreshSummary' }, input.runs[1]]);
    expect(state.schedules).toEqual([{ ...input.schedules[0], operation: 'activities.refreshSummary' }]);
    expect(state.agentRuns).toEqual([{ ...input.agentRuns[0], agent: 'assistant.milo' }, input.agentRuns[1]]);
    expect(state.history).toEqual(input.history);
    expect(state.agentEvents).toEqual(input.agentEvents);
    expect(state.taskDedupe).toEqual(input.taskDedupe);
    expect(state.custom).toEqual(input.custom);
    expect(input.tasks[0]?.operation).toBe('refreshSummary');
    expect(migrateTrackerCompositionState(state).changed).toBe(false);
  });

  it('copies legacy scoped summary KV without dropping it or overwriting newer module data', () => {
    const old = JSON.stringify(['tracker', 'team', 'activity-summary']);
    const namespaced = JSON.stringify(['tracker', 'team', '@workcore/module/["activities","activity-summary"]']);
    const migrated = migrateTrackerCompositionState({ kv: { [old]: { total: 2 }, unknown: 1 } });
    expect(migrated.state.kv).toEqual({ [old]: { total: 2 }, [namespaced]: { total: 2 }, unknown: 1 });
    const existing = { kv: { [old]: { total: 2 }, [namespaced]: { total: 3 } } };
    expect(migrateTrackerCompositionState(existing)).toEqual({ state: existing, changed: false });
  });

  it('backs up exactly once and lets file-adapter recovery retain claimed run identities', async () => {
    directory = await mkdtemp('/tmp/opencode/tracker-composition-');
    const path = join(directory, 'state.json');
    const now = new Date().toISOString();
    const scope = { applicationId: 'tracker', workspaceId: 'team' };
    const payload = { id: 'claimed', ...scope, operation: 'refreshSummary', input: {}, actorId: 'alice', correlationId: 'original', createdAt: now };
    const original = JSON.stringify({ processing: [payload], tasks: [], runs: [{ id: 'claimed', runId: 'claimed', scope, operation: 'refreshSummary', kind: 'task', status: 'running', startedAt: now }], taskDedupe: ['claimed'] }, null, 2);
    await writeFile(path, original);
    const backup = await migrateTrackerCompositionFile(path);
    expect(backup).toBeDefined();
    expect(await readFile(backup!, 'utf8')).toBe(original);
    expect(await migrateTrackerCompositionFile(path)).toBeUndefined();
    expect((await readdir(directory)).filter((file) => file.endsWith('.bak'))).toHaveLength(1);
    const state = createFileState({ path, workspaces: [] });
    expect(await state.tasks.claim()).toEqual({ ...payload, operation: 'activities.refreshSummary' });
    expect((await state.tasks.list(scope, 10))[0]?.runId).toBe('claimed');
  });

  it('does not create a missing file and refuses malformed state without overwriting it', async () => {
    directory = await mkdtemp('/tmp/opencode/tracker-composition-invalid-');
    const path = join(directory, 'state.json');
    expect(await migrateTrackerCompositionFile(path)).toBeUndefined();
    await writeFile(path, '{"tasks":42}');
    await expect(migrateTrackerCompositionFile(path)).rejects.toThrow('array of records');
    expect(await readFile(path, 'utf8')).toBe('{"tasks":42}');
    expect(await readdir(directory)).toEqual(['state.json']);
  });
});
