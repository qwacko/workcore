import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { Pool } from 'pg';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMemoryState, type PlatformServices, type ScheduleEntry, type TaskPayload } from '@workcore/core';
import { createFileState } from './file/index.js';
import { createPostgresState, migratePostgres } from './postgres/index.js';

const scope = { applicationId: 'app', workspaceId: 'one' };
const other = { applicationId: 'app', workspaceId: 'two' };
const workspaces = [scope, other].map((item) => ({ applicationId: item.applicationId, id: item.workspaceId, name: item.workspaceId, actors: ['alice'] }));
type Services = Omit<PlatformServices, 'events'>;
type Fixture = { services: Services; close(): Promise<void> };

async function fixture(kind: 'memory' | 'file' | 'postgres'): Promise<Fixture> {
  if (kind === 'memory') return { services: createMemoryState({ workspaces }), close: async () => {} };
  if (kind === 'file') {
    await mkdir('/tmp/opencode', { recursive: true });
    const directory = await mkdtemp('/tmp/opencode/workcore-contract-');
    return { services: createFileState({ path: join(directory, 'state.json'), workspaces }), close: () => rm(directory, { recursive: true }) };
  }
  // Each test owns its database: queue claims and global retention must not touch another suite's work.
  const admin = new Pool({ connectionString: process.env.WORKCORE_POSTGRES_URL! });
  const database = `workcore_contract_${crypto.randomUUID().replaceAll('-', '')}`;
  try { await admin.query(`CREATE DATABASE ${database}`); }
  catch (error) { await admin.end(); throw error; }
  const connection = new URL(process.env.WORKCORE_POSTGRES_URL!);
  connection.pathname = `/${database}`;
  const pool = new Pool({ connectionString: connection.href });
  const close = async () => { await pool.end(); await admin.query(`DROP DATABASE ${database}`); await admin.end(); };
  try {
    await migratePostgres(pool);
    for (const item of workspaces) {
      await pool.query('INSERT INTO workcore_workspaces(application_id,id,name) VALUES($1,$2,$3)', [item.applicationId, item.id, item.name]);
      await pool.query('INSERT INTO workcore_workspace_members(application_id,workspace_id,actor_id) VALUES($1,$2,$3)', [item.applicationId, item.id, 'alice']);
    }
    return { services: createPostgresState({ pool }), close };
  } catch (error) { await close(); throw error; }
}

function task(id = 'task', createdAt = '2026-01-01T00:00:00.000Z'): TaskPayload {
  return { id, ...scope, operation: 'run', operationVersion: 2, input: { nested: { value: 1 } }, codecId: 'json', actorId: 'alice', correlationId: 'correlation', createdAt };
}
function schedule(id = 'schedule'): ScheduleEntry {
  return { id, scope, operation: 'run', input: {}, actorId: 'alice', kind: 'recurring', cron: '* * * * *', timezone: 'UTC', enabled: true, nextRunAt: '2026-01-01T00:00:00.000Z', createdAt: '2026-01-01T00:00:00.000Z' };
}

for (const kind of ['memory', 'file', 'postgres'] as const) {
  describe.skipIf(kind === 'postgres' && !process.env.WORKCORE_POSTGRES_URL)(`${kind} shared adapter contracts`, () => {
    let current: Fixture | undefined;
    let services: Services;
    beforeEach(async () => { current = undefined; current = await fixture(kind); services = current.services; });
    afterEach(async () => { await current?.close(); });

    it('isolates workspace membership and key/value state', async () => {
      expect(await services.workspaces.canAccess({ id: 'alice' }, scope)).toBe(true);
      expect(await services.workspaces.canAccess({ id: 'outsider' }, scope)).toBe(false);
      await services.kv.set(scope, 'key', { value: 1 });
      expect(await services.kv.get(other, 'key')).toBeUndefined();
      await services.kv.delete(other, 'key');
      expect(await services.kv.get(scope, 'key')).toEqual({ value: 1 });
    });

    it('persists JSON values as snapshots rather than application-owned object references', async () => {
      const value = { nested: { value: 1 } };
      await services.kv.set(scope, 'key', value);
      value.nested.value = 2;
      const read = await services.kv.get(scope, 'key') as typeof value;
      expect(read.nested.value).toBe(1);
      read.nested.value = 3;
      expect(await services.kv.get(scope, 'key')).toEqual({ nested: { value: 1 } });
      await expect(services.kv.set(scope, 'date', new Date())).rejects.toThrow();
    });

    it('claims once, preserves encoded payloads, and deduplicates terminal runs', async () => {
      const payload = task();
      await services.tasks.enqueue(payload);
      await services.tasks.enqueue(payload);
      const claims = await Promise.all([services.tasks.claim(), services.tasks.claim()]);
      expect(claims.filter(Boolean)).toEqual([payload]);
      await services.tasks.complete(payload.id, { answer: 42 });
      await services.tasks.enqueue(payload);
      expect(await services.tasks.claim()).toBeUndefined();
      expect(await services.tasks.list(scope, 10)).toMatchObject([{ status: 'succeeded', result: { answer: 42 }, codecId: 'json' }]);
    });

    it('isolates enqueued and inspected task objects from application mutation', async () => {
      const payload = task();
      await services.tasks.enqueue(payload);
      payload.operation = 'changed';
      expect((await services.tasks.claim())?.operation).toBe('run');
      const [run] = await services.tasks.list(scope, 10);
      run!.status = 'failed';
      expect((await services.tasks.list(scope, 10))[0]?.status).toBe('running');
    });

    it('lists newest task runs first and scopes inspection', async () => {
      await services.tasks.enqueue(task('older'));
      await services.tasks.enqueue(task('newer', '2026-01-02T00:00:00.000Z'));
      expect((await services.tasks.list(scope, 1)).map((run) => run.runId)).toEqual(['newer']);
      expect(await services.tasks.list(other, 10)).toEqual([]);
    });

    it('releases active runs but never resurrects a terminal run', async () => {
      await services.tasks.enqueue(task());
      await services.tasks.claim();
      await services.tasks.release('task');
      expect((await services.tasks.claim())?.id).toBe('task');
      await services.tasks.complete('task', {});
      await services.tasks.release('task');
      expect(await services.tasks.claim()).toBeUndefined();
    });

    it('does not miss work enqueued between an empty claim and waiting', async () => {
      expect(await services.tasks.claim()).toBeUndefined();
      await services.tasks.enqueue(task());
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 1500);
      try {
        await services.tasks.waitForWork(controller.signal);
        expect(controller.signal.aborted).toBe(false);
      } finally { clearTimeout(timeout); controller.abort(); }
    });

    it('aborts an idle wait promptly', async () => {
      const controller = new AbortController();
      const waiting = services.tasks.waitForWork(controller.signal);
      controller.abort();
      await waiting;
    });

    it('rejects duplicate schedules and compares revisions on user edits', async () => {
      await services.schedules.create(schedule());
      await expect(services.schedules.create(schedule())).rejects.toThrow();
      const first = (await services.schedules.get('schedule'))!;
      expect(await services.schedules.update({ ...first, enabled: false })).toBe(true);
      expect(await services.schedules.update({ ...first, enabled: true })).toBe(false);
      expect(await services.schedules.get('schedule')).toMatchObject({ enabled: false, revision: 1 });
    });

    it('does not let a schedule edit move state into another workspace', async () => {
      await services.schedules.create(schedule());
      expect(await services.schedules.update({ ...schedule(), scope: other })).toBe(false);
      expect(await services.schedules.list(other)).toEqual([]);
    });

    it('preserves dispatch reservations across stale user snapshots', async () => {
      await services.schedules.create(schedule());
      const snapshot = (await services.schedules.get('schedule'))!;
      const [claimed] = await services.schedules.claimDue(new Date(), 'owner', 30_000);
      expect(await services.schedules.reserveRun(claimed!, 'owner', 'reserved')).toBe(true);
      expect(await services.schedules.update({ ...snapshot, enabled: false, pendingRunId: 'stale', activeRunId: 'stale', claimToken: 'stale', claimUntil: 'stale' })).toBe(true);
      expect(await services.schedules.get('schedule')).toMatchObject({ enabled: false, pendingRunId: 'reserved' });
      expect((await services.schedules.get('schedule'))?.activeRunId).toBeUndefined();
      expect(await services.schedules.updateClaimed(claimed!, 'owner')).toBe(false);
      await services.schedules.releaseClaim('schedule', 'owner');
      const [recovered] = await services.schedules.claimDue(new Date(), 'recovery', 30_000);
      expect(recovered).toMatchObject({ enabled: false, pendingRunId: 'reserved' });
    });

    it('rejects wrong or expired reservations and only clears the matching active run', async () => {
      await services.schedules.create(schedule());
      const [claimed] = await services.schedules.claimDue(new Date(), 'owner', 30_000);
      expect(await services.schedules.reserveRun(claimed!, 'other', 'run')).toBe(false);
      expect(await services.schedules.updateClaimed({ ...claimed!, activeRunId: 'run' }, 'owner')).toBe(true);
      await services.schedules.clearActiveRun('schedule', 'wrong');
      expect((await services.schedules.get('schedule'))?.activeRunId).toBe('run');
      await services.schedules.clearActiveRun('schedule', 'run');
      expect((await services.schedules.get('schedule'))?.activeRunId).toBeUndefined();
      const [expired] = await services.schedules.claimDue(new Date(), 'expired', 1);
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(await services.schedules.reserveRun(expired!, 'expired', 'run')).toBe(false);
    });

    it('skips overlapping recurring occurrences rather than dispatching them later', async () => {
      await services.tasks.enqueue(task());
      await services.schedules.create({ ...schedule(), activeRunId: 'task' });
      const now = new Date();
      expect(await services.schedules.claimDue(now, 'owner', 30_000)).toEqual([]);
      const skipped = (await services.schedules.get('schedule'))!;
      expect(Date.parse(skipped.nextRunAt!)).toBeGreaterThan(now.getTime());
      expect(skipped.lastSkipReason).toContain('previous scheduled run');
    });

    it('orders agent traces by sequence and scopes access', async () => {
      const runs = services.agentRuns!;
      await runs.create({ id: 'agent', scope, actorId: 'alice', agent: 'assistant', status: 'queued', correlationId: 'correlation', createdAt: '2026-01-01T00:00:00.000Z' });
      for (const sequence of [3, 1, 2, 2]) await runs.appendEvent({ id: `event-${sequence}`, runId: 'agent', sequence, createdAt: '2026-01-01T00:00:00.000Z', type: 'step.completed' });
      expect((await runs.listEvents(scope, 'agent', 0, 2)).map((event) => event.sequence)).toEqual([1, 2]);
      expect((await runs.listEvents(scope, 'agent', 2, 10)).map((event) => event.sequence)).toEqual([3]);
      expect(await runs.listEvents(other, 'agent', 0, 10)).toEqual([]);
      expect(await runs.get(other, 'agent')).toBeUndefined();
    });
  });
}
