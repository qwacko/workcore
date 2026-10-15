import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient } from 'redis';
import { Pool } from 'pg';
import { createPostgresState, migratePostgres } from './postgres/index.js';
import { createRedisEvents } from './redis/index.js';

const postgresUrl = process.env.WORKCORE_POSTGRES_URL;
const redisUrl = process.env.WORKCORE_REDIS_URL;
const integration = describe.skipIf(!postgresUrl || !redisUrl);

integration('PostgreSQL and Redis adapter contracts', () => {
  const pool = new Pool({ connectionString: postgresUrl });
  const publisher = createClient({ url: redisUrl! });
  const subscriber = publisher.duplicate();
  const workspaceId = `contract-${process.pid}-${Date.now()}`;
  const scope = { applicationId: 'adapter-contract', workspaceId };

  beforeAll(async () => {
    await Promise.all([publisher.connect(), subscriber.connect()]);
    await migratePostgres(pool);
    await pool.query('INSERT INTO workcore_workspaces(application_id,id,name) VALUES($1,$2,$3)', [scope.applicationId, workspaceId, 'Contract test']);
    await pool.query('INSERT INTO workcore_workspace_members(application_id,workspace_id,actor_id) VALUES($1,$2,$3)', [scope.applicationId, workspaceId, 'actor-1']);
  });
  afterAll(async () => {
    await pool.query('DELETE FROM workcore_agent_runs WHERE application_id=$1 AND workspace_id=$2', [scope.applicationId, workspaceId]);
    await pool.query('DELETE FROM workcore_history WHERE application_id=$1 AND workspace_id=$2', [scope.applicationId, workspaceId]);
    await pool.query('DELETE FROM workcore_tasks WHERE application_id=$1 AND workspace_id=$2', [scope.applicationId, workspaceId]);
    await pool.query("DELETE FROM workcore_task_dedupe WHERE id='task-contract'");
    await pool.query("DELETE FROM workcore_task_dedupe WHERE id='task-contract-newer'");
    await pool.query('DELETE FROM workcore_schedules WHERE application_id=$1 AND workspace_id=$2', [scope.applicationId, workspaceId]);
    await pool.query('DELETE FROM workcore_kv WHERE application_id=$1 AND workspace_id=$2', [scope.applicationId, workspaceId]);
    await pool.query('DELETE FROM workcore_workspaces WHERE application_id=$1 AND id=$2', [scope.applicationId, workspaceId]);
    await Promise.all([publisher.quit(), subscriber.quit(), pool.end()]);
  });

  it('keeps agent-run cursors stable when the cursor run leaves its status filter', async () => {
    const state = createPostgresState({ pool });
    const base = { scope, actorId: 'actor-1', agent: 'cursor-agent', status: 'queued' as const, correlationId: 'corr' };
    const newer = { ...base, id: `${workspaceId}-new`, createdAt: '2026-10-15T10:01:00.000Z' };
    const older = { ...base, id: `${workspaceId}-old`, createdAt: '2026-10-15T10:00:00.000Z' };
    await state.agentRuns!.create(newer);
    await state.agentRuns!.create(older);
    const first = await state.agentRuns!.list(scope, { limit: 1, agent: base.agent, status: 'queued' });
    await state.agentRuns!.update({ ...newer, status: 'succeeded' });
    const second = await state.agentRuns!.list(scope, { limit: 1, agent: base.agent, status: 'queued', cursor: first.nextCursor! });
    expect(first.runs.map((run) => run.id)).toEqual([newer.id]);
    expect(second.runs.map((run) => run.id)).toEqual([older.id]);
  });

  it('provides durable scoped state, task claiming, and schedule reservations', async () => {
    const state = createPostgresState({ pool, taskRunLimit: 1, maxKVValueBytes: 32 });
    expect(await state.workspaces.canAccess({ id: 'actor-1' }, scope)).toBe(true);
    expect(await state.workspaces.canAccess({ id: 'outsider' }, scope)).toBe(false);
    await state.kv.set(scope, 'key', { value: 7 });
    expect(await state.kv.get(scope, 'key')).toEqual({ value: 7 });
    await expect(state.kv.set(scope, 'too-large', 'x'.repeat(100))).rejects.toThrow(/byte limit/);

    await state.history.append({ id: 'history-contract', scope, actorId: 'actor-1', kind: 'query', operation: 'read', status: 'succeeded', startedAt: new Date().toISOString() });
    expect((await state.history.list(scope, 10))[0]?.id).toBe('history-contract');

    await state.agentRuns!.create({ id: 'agent-contract', scope, actorId: 'actor-1', agent: 'summarize', status: 'queued', createdAt: new Date().toISOString(), correlationId: 'corr' });
    await state.agentRuns!.appendEvent({ id: 'agent-event-contract', runId: 'agent-contract', sequence: 1, createdAt: new Date().toISOString(), type: 'run.started', data: { model: 'test' } });
    expect(await state.agentRuns!.get(scope, 'agent-contract')).toMatchObject({ status: 'queued', agent: 'summarize' });
    expect((await state.agentRuns!.list(scope, { limit: 10, status: 'queued' })).runs.map((run) => run.id)).toContain('agent-contract');
    expect(await state.agentRuns!.listEvents(scope, 'agent-contract', 0, 10)).toMatchObject([{ sequence: 1, type: 'run.started' }]);

    const payload = { id: 'task-contract', ...scope, operation: 'run', input: {}, actorId: 'actor-1', correlationId: 'corr', createdAt: new Date().toISOString() };
    await state.tasks.enqueue(payload);
    await state.tasks.enqueue(payload);
    const claims = await Promise.all([state.tasks.claim(), state.tasks.claim()]);
    expect(claims.filter(Boolean).map((claim) => claim?.id)).toEqual([payload.id]);
    await state.tasks.heartbeat?.(payload.id);
    await state.tasks.complete(payload.id, { answer: 42 });
    expect((await state.tasks.list(scope, 10))[0]).toMatchObject({ status: 'succeeded', result: { answer: 42 } });
    const newer = { ...payload, id: 'task-contract-newer' };
    await state.tasks.enqueue(newer);
    expect((await state.tasks.claim())?.id).toBe(newer.id);
    await state.tasks.release(newer.id);
    expect((await state.tasks.claim())?.id).toBe(newer.id);
    await state.tasks.complete(newer.id, {});
    await state.tasks.enqueue(payload); // A pruned result must not make the old enqueue executable again.
    expect(await state.tasks.claim()).toBeUndefined();
    expect((await state.tasks.list(scope, 10)).map((run) => run.runId)).toEqual([newer.id]);

    const schedule = { id: 'schedule-contract', scope, operation: 'run', input: {}, actorId: 'actor-1', timezone: 'UTC', kind: 'once' as const, runAt: new Date(Date.now() - 1_000).toISOString(), enabled: true, nextRunAt: new Date(Date.now() - 1_000).toISOString(), createdAt: new Date().toISOString() };
    await state.schedules.create(schedule);
    const [claimed] = await state.schedules.claimDue(new Date(), 'contract-claim', 5_000);
    expect(claimed?.id).toBe(schedule.id);
    expect(await state.schedules.reserveRun(claimed!, 'contract-claim', 'schedule-run-contract')).toBe(true);
    expect((await state.schedules.get(schedule.id))?.pendingRunId).toBe('schedule-run-contract');
    expect(await state.schedules.updateClaimed({ ...claimed!, activeRunId: 'schedule-run-contract' }, 'contract-claim')).toBe(true);
    expect((await state.schedules.get(schedule.id))?.activeRunId).toBe('schedule-run-contract');
    await state.schedules.clearActiveRun(schedule.id, 'schedule-run-contract');
    expect((await state.schedules.get(schedule.id))?.activeRunId).toBeUndefined();
  });

  it('publishes scoped events across independent Redis connections', async () => {
    const eventsA = createRedisEvents({ publisher, subscriber });
    const eventsB = createRedisEvents({ publisher, subscriber });
    const received = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Redis event not received')), 2_000);
      const stop = eventsB.subscribe(scope, (event) => {
        if (event.id === 'redis-contract') { clearTimeout(timeout); stop(); resolve(); }
      });
    });
    await eventsA.publish({ id: 'redis-contract', type: 'mutation.succeeded', ...scope, operation: 'write', executionId: 'execution', actorId: 'actor-1', correlationId: 'corr', createdAt: new Date().toISOString() });
    await received;
  });
});
