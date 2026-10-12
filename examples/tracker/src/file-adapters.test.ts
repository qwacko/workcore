import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createFileState } from '@workcore/adapters/file';

let directory = '';
afterEach(async () => { if (directory) await rm(directory, { recursive: true, force: true }); directory = ''; });

describe('local durable adapter', () => {
  it('isolates state by application/workspace and keeps tasks across adapter restarts', async () => {
    directory = await mkdtemp(join(tmpdir(), 'workcore-state-'));
    const path = join(directory, 'state.json');
    const configuration = { path, workspaces: [{ applicationId: 'app', id: 'one', name: 'One', actors: ['alice'] }] };
    const first = createFileState(configuration);
    const payload = { id: 'run-1', applicationId: 'app', workspaceId: 'one', operation: 'refresh', input: {}, actorId: 'alice', correlationId: 'corr-1', createdAt: new Date().toISOString() };
    await first.tasks.enqueue(payload);
    await first.tasks.claim(); // Simulate a worker dying after claiming but before completing.
    await first.kv.set({ applicationId: 'app', workspaceId: 'one' }, 'value', { count: 1 });

    const restarted = createFileState(configuration);
    const recovered = await restarted.tasks.claim();
    expect(recovered?.id).toBe('run-1');
    expect(await restarted.kv.get({ applicationId: 'app', workspaceId: 'one' }, 'value')).toEqual({ count: 1 });
    expect(await restarted.kv.get({ applicationId: 'app', workspaceId: 'two' }, 'value')).toBeUndefined();
    await restarted.tasks.complete('run-1', { ok: true });
    expect((await restarted.tasks.list({ applicationId: 'app', workspaceId: 'one' }, 10))[0]?.status).toBe('succeeded');
  });

  it('uses collision-free scope tuples for file-backed KV and event routing', async () => {
    directory = await mkdtemp(join(tmpdir(), 'workcore-scope-'));
    const services = createFileState({ path: join(directory, 'state.json'), workspaces: [
      { applicationId: 'a:b', id: 'c', name: 'First', actors: ['alice'] },
      { applicationId: 'a', id: 'b:c', name: 'Second', actors: ['alice'] },
    ] });
    const first = { applicationId: 'a:b', workspaceId: 'c' };
    const second = { applicationId: 'a', workspaceId: 'b:c' };
    await services.kv.set(first, 'value', 'first-scope');
    expect(await services.kv.get(second, 'value')).toBeUndefined();
    let secondScopeEvents = 0;
    services.events.subscribe(second, () => { secondScopeEvents++; });
    await services.events.publish({ id: 'e1', type: 'mutation.succeeded', applicationId: first.applicationId, workspaceId: first.workspaceId, executionId: 'x', actorId: 'alice', correlationId: 'c', createdAt: new Date().toISOString() });
    expect(secondScopeEvents).toBe(0);
  });

  it('keeps due schedule reservations persisted until claimed bookkeeping completes', async () => {
    directory = await mkdtemp(join(tmpdir(), 'workcore-schedule-'));
    const services = createFileState({ path: join(directory, 'state.json'), workspaces: [{ applicationId: 'app', id: 'one', name: 'One', actors: ['alice'] }] });
    const now = new Date();
    await services.schedules.create({
      id: 'schedule-1', scope: { applicationId: 'app', workspaceId: 'one' }, operation: 'refresh', input: {}, actorId: 'alice', timezone: 'UTC',
      kind: 'once', enabled: true, runAt: new Date(now.getTime() - 1_000).toISOString(), nextRunAt: new Date(now.getTime() - 1_000).toISOString(), createdAt: now.toISOString(),
    });
    const [first, competing] = await Promise.all([
      services.schedules.claimDue(now, 'worker-a', 60_000),
      services.schedules.claimDue(now, 'worker-b', 60_000),
    ]);
    expect(first.length + competing.length).toBe(1);
    const claim = first[0] ?? competing[0]!;
    expect(claim.claimToken).toBe(first.length ? 'worker-a' : 'worker-b');
    expect(await services.schedules.renewClaim(claim.id, claim.claimToken!, new Date(Date.now() + 60_000).toISOString())).toBe(true);
    expect(await services.schedules.claimDue(now, 'worker-c', 60_000)).toHaveLength(0);
    expect(await services.schedules.updateClaimed({ ...claim, enabled: false }, claim.claimToken!)).toBe(true);
    const persisted = await services.schedules.get(claim.id);
    expect(persisted?.enabled).toBe(false);
    expect(persisted?.claimToken).toBeUndefined();
  });

  it('preserves edits and reserved run IDs across restart, and deduplicates enqueue', async () => {
    directory = await mkdtemp(join(tmpdir(), 'workcore-recovery-'));
    const configuration = { path: join(directory, 'state.json'), workspaces: [{ applicationId: 'app', id: 'one', name: 'One', actors: ['alice'] }] };
    const scope = { applicationId: 'app', workspaceId: 'one' };
    const services = createFileState(configuration);
    const now = new Date();
    await services.schedules.create({ id: 'reserved', scope, operation: 'refresh', input: {}, actorId: 'alice', timezone: 'UTC', kind: 'once', enabled: true, createdAt: now.toISOString(), nextRunAt: now.toISOString() });
    const [claim] = await services.schedules.claimDue(now, 'worker-a', 60_000);
    expect(await services.schedules.reserveRun(claim!, 'worker-a', 'stable-run')).toBe(true);
    const payload = { id: 'stable-run', ...scope, operation: 'refresh', input: {}, actorId: 'alice', correlationId: 'c', createdAt: now.toISOString(), scheduleId: 'reserved' };
    await services.tasks.enqueue(payload);
    await services.schedules.releaseClaim('reserved', 'worker-a');
    const restarted = createFileState(configuration);
    expect((await restarted.schedules.get('reserved'))?.pendingRunId).toBe('stable-run');
    await restarted.tasks.enqueue(payload);
    expect(await restarted.tasks.list(scope, 10)).toHaveLength(1);
    expect((await restarted.tasks.claim())?.id).toBe('stable-run');
    await restarted.tasks.complete('stable-run', {});
    await restarted.tasks.enqueue(payload);
    expect(await restarted.tasks.claim()).toBeUndefined();
    const [recovery] = await restarted.schedules.claimDue(new Date(), 'worker-b', 60_000);
    const current = (await restarted.schedules.get('reserved'))!;
    expect(await restarted.schedules.update({ ...current, enabled: false })).toBe(true);
    expect(await restarted.schedules.reserveRun(recovery!, 'worker-b', 'stable-run')).toBe(false);
    expect(await restarted.schedules.updateClaimed({ ...recovery!, enabled: true }, 'worker-b')).toBe(false);
    expect(await restarted.schedules.removeClaimed('reserved', 'worker-b', recovery!.revision ?? 0)).toBe(false);
    expect((await restarted.schedules.get('reserved'))?.enabled).toBe(false);
    await restarted.schedules.releaseClaim('reserved', 'worker-b');
    // Disabling after durable reservation doesn't cancel that in-flight occurrence.
    const [disabledRecovery] = await restarted.schedules.claimDue(new Date(), 'worker-c', 60_000);
    expect(disabledRecovery?.enabled).toBe(false);
    expect(disabledRecovery?.pendingRunId).toBe('stable-run');
    expect(await restarted.schedules.reserveRun(disabledRecovery!, 'worker-c', 'stable-run')).toBe(true);
  });
});
