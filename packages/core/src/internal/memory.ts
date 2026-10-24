import type { AgentRun, AgentTraceEvent, HistoryEntry, PlatformServices, ScheduleEntry, Scope, TaskPayload, TaskRun, WorkcoreEvent } from '../index.js';
import { consoleLogger } from './lifecycle.js';
import { nextScheduleOccurrence } from './schedule.js';
import { jsonWireCodec } from './wire.js';

const sameScope = (a: Scope, b: Scope) => a.applicationId === b.applicationId && a.workspaceId === b.workspaceId;
function encodeCursor(createdAt: string, id: string) { return encodeURIComponent(`${createdAt}\u0000${id}`); }
function decodeCursor(cursor: string) {
  try {
    const [createdAt, id, extra] = decodeURIComponent(cursor).split('\u0000');
    if (!createdAt || !id || extra !== undefined || !Number.isFinite(Date.parse(createdAt))) throw new TypeError();
    return [createdAt, id] as const;
  } catch { throw new TypeError('Invalid agent run cursor'); }
}

/** Test/demo storage. Snapshot boundaries match the durable adapters; no cross-process guarantees. */
export function createMemoryState(options: { workspaces?: Array<{ applicationId: string; id: string; name: string; actors: string[] }> } = {}): PlatformServices {
  const workspaceRows = options.workspaces ?? [];
  const eventListeners = new Map<string, Set<(event: WorkcoreEvent) => void>>();
  const taskQueue: TaskPayload[] = [];
  const processing = new Map<string, TaskPayload>();
  const taskRuns = new Map<string, TaskRun>();
  const agentRuns = new Map<string, AgentRun>();
  const agentEvents = new Map<string, AgentTraceEvent[]>();
  const historyRows = new Map<string, HistoryEntry[]>();
  const scheduleRows = new Map<string, ScheduleEntry>();
  const kvRows = new Map<string, unknown>();
  const waiters = new Set<() => void>();
  const scopeKey = (scope: Scope) => JSON.stringify([scope.applicationId, scope.workspaceId]);
  const kvKey = (scope: Scope, key: string) => JSON.stringify([scope.applicationId, scope.workspaceId, key]);
  return {
    workspaces: {
      canAccess: (actor, scope) => workspaceRows.some((workspace) => workspace.applicationId === scope.applicationId && workspace.id === scope.workspaceId && workspace.actors.includes(actor.id)),
      list: async (actor, applicationId) => workspaceRows.filter((workspace) => workspace.applicationId === applicationId && workspace.actors.includes(actor.id)).map(({ id, name }) => ({ id, name })),
    },
    events: {
      publish: async (event) => { for (const listener of eventListeners.get(scopeKey(event)) ?? []) listener(event); },
      subscribe: (scope, listener) => { const key = scopeKey(scope); const listeners = eventListeners.get(key) ?? new Set(); listeners.add(listener); eventListeners.set(key, listeners); return () => { listeners.delete(listener); if (!listeners.size) eventListeners.delete(key); }; },
    },
    history: {
      append: async (entry) => { const key = scopeKey(entry.scope); const entries = historyRows.get(key) ?? []; entries.unshift(structuredClone(entry)); historyRows.set(key, entries); },
      list: async (scope, limit) => structuredClone((historyRows.get(scopeKey(scope)) ?? []).slice(0, limit)),
    },
    tasks: {
      enqueue: async (payload) => {
        if (taskRuns.has(payload.id)) return;
        taskQueue.push(structuredClone(payload));
        taskRuns.set(payload.id, { id: payload.id, runId: payload.id, scope: { applicationId: payload.applicationId, workspaceId: payload.workspaceId }, actorId: payload.actorId, kind: 'task', operation: payload.operation, status: 'queued', startedAt: payload.createdAt, ...(payload.codecId ? { codecId: payload.codecId } : {}) });
        for (const wake of waiters) wake();
      },
      claim: async () => { const item = taskQueue.shift(); if (item) { processing.set(item.id, item); const run = taskRuns.get(item.id); if (run) { run.status = 'running'; run.startedAt = new Date().toISOString(); } } return structuredClone(item); },
      release: async (id) => { const run = taskRuns.get(id); if (!run || run.status !== 'running') return; run.status = 'queued'; delete run.finishedAt; const item = processing.get(id); if (item) { processing.delete(id); taskQueue.unshift(item); for (const wake of waiters) wake(); } },
      complete: async (id, result) => { processing.delete(id); const run = taskRuns.get(id); if (run) { run.status = 'succeeded'; run.finishedAt = new Date().toISOString(); run.result = structuredClone(result); } },
      fail: async (id, error) => { processing.delete(id); const run = taskRuns.get(id); if (run) { run.status = 'failed'; run.finishedAt = new Date().toISOString(); run.error = structuredClone(error); } },
      progress: async (id, progress) => { const run = taskRuns.get(id); if (run) run.progress = Math.max(0, Math.min(100, progress)); },
      list: async (scope, limit) => structuredClone([...taskRuns.values()].reverse().filter((run) => sameScope(run.scope, scope)).slice(0, limit)),
      waitForWork: (signal) => new Promise((resolve) => {
        if (signal.aborted || taskQueue.length) return resolve();
        const wake = () => { waiters.delete(wake); signal.removeEventListener('abort', wake); resolve(); };
        waiters.add(wake); signal.addEventListener('abort', wake, { once: true });
      }),
    },
    agentRuns: {
      create: async (run) => { if (agentRuns.has(run.id)) throw new Error(`Duplicate agent run '${run.id}'`); agentRuns.set(run.id, structuredClone(run)); agentEvents.set(run.id, []); },
      get: async (scope, runId) => { const run = agentRuns.get(runId); return run && sameScope(run.scope, scope) ? structuredClone(run) : undefined; },
      list: async (scope, filter) => {
        let rows = [...agentRuns.values()].filter((run) => sameScope(run.scope, scope)
          && (!filter.agent || run.agent === filter.agent) && (!filter.status || run.status === filter.status)
          && (!filter.actorId || run.actorId === filter.actorId) && (!filter.conversationId || run.conversationId === filter.conversationId))
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
        if (filter.cursor) {
          const [createdAt, id] = decodeCursor(filter.cursor);
          rows = rows.filter((run) => run.createdAt < createdAt || (run.createdAt === createdAt && run.id < id));
        }
        const page = rows.slice(0, filter.limit);
        const last = page.at(-1);
        return { runs: structuredClone(page), nextCursor: rows.length > page.length && last ? encodeCursor(last.createdAt, last.id) : null };
      },
      update: async (run) => { const existing = agentRuns.get(run.id); if (!existing || !sameScope(existing.scope, run.scope)) throw new Error(`Unknown agent run '${run.id}'`); agentRuns.set(run.id, structuredClone(run)); },
      appendEvent: async (event) => { if (!agentRuns.has(event.runId)) throw new Error(`Unknown agent run '${event.runId}'`); const rows = agentEvents.get(event.runId) ?? []; if (rows.some((item) => item.sequence === event.sequence)) return; rows.push(structuredClone(event)); agentEvents.set(event.runId, rows); },
      listEvents: async (scope, runId, afterSequence, limit) => { const run = agentRuns.get(runId); if (!run || !sameScope(run.scope, scope)) return []; return structuredClone((agentEvents.get(runId) ?? []).filter((event) => event.sequence > afterSequence).sort((a, b) => a.sequence - b.sequence).slice(0, limit)); },
    },
    schedules: {
      create: async (schedule) => { if (scheduleRows.has(schedule.id)) throw new Error(`Duplicate schedule '${schedule.id}'`); scheduleRows.set(schedule.id, structuredClone(schedule)); },
      list: async (scope) => structuredClone([...scheduleRows.values()].filter((schedule) => sameScope(schedule.scope, scope))),
      get: async (id) => structuredClone(scheduleRows.get(id)),
      update: async (schedule) => {
        const current = scheduleRows.get(schedule.id);
        if (!current || !sameScope(current.scope, schedule.scope) || (current.revision ?? 0) !== (schedule.revision ?? 0)) return false;
        const { claimToken: _token, claimUntil: _until, activeRunId: _active, pendingRunId: _pending, ...fields } = schedule;
        scheduleRows.set(schedule.id, structuredClone({ ...current, ...fields, revision: (current.revision ?? 0) + 1 }));
        return true;
      },
      remove: async (id) => { scheduleRows.delete(id); },
      claimDue: async (now, claimToken, leaseMs) => {
        const due: ScheduleEntry[] = [];
        for (const schedule of scheduleRows.values()) {
          if (!schedule.pendingRunId && (!schedule.enabled || !schedule.nextRunAt || Date.parse(schedule.nextRunAt) > now.getTime())) continue;
          if (schedule.claimToken && schedule.claimUntil && Date.parse(schedule.claimUntil) > now.getTime()) continue;
          if (!schedule.pendingRunId && schedule.activeRunId) {
            const run = taskRuns.get(schedule.activeRunId);
            if (run?.status === 'queued' || run?.status === 'running') {
              schedule.lastSkipReason = 'Skipped because the previous scheduled run is still active';
              if (schedule.kind === 'recurring') schedule.nextRunAt = nextScheduleOccurrence(schedule.cron!, now, schedule.timezone).toISOString();
              continue;
            }
            delete schedule.activeRunId;
          }
          schedule.claimToken = claimToken;
          schedule.claimUntil = new Date(now.getTime() + leaseMs).toISOString();
          due.push(structuredClone(schedule));
        }
        return due;
      },
      renewClaim: async (id, claimToken, claimUntil) => { const schedule = scheduleRows.get(id); if (!schedule || schedule.claimToken !== claimToken) return false; schedule.claimUntil = claimUntil; return true; },
      reserveRun: async (schedule, claimToken, runId) => {
        const current = scheduleRows.get(schedule.id);
        if (!current || (!current.enabled && !current.pendingRunId) || current.claimToken !== claimToken || (current.revision ?? 0) !== (schedule.revision ?? 0)
          || !current.claimUntil || Date.parse(current.claimUntil) <= Date.now()) return false;
        current.pendingRunId = runId;
        return true;
      },
      clearActiveRun: async (id, runId) => { const current = scheduleRows.get(id); if (current?.activeRunId === runId) delete current.activeRunId; },
      updateClaimed: async (schedule, claimToken) => {
        const current = scheduleRows.get(schedule.id);
        if (!current || !sameScope(current.scope, schedule.scope) || current.claimToken !== claimToken || (current.revision ?? 0) !== (schedule.revision ?? 0)) return false;
        const updated = structuredClone({ ...schedule, revision: (current.revision ?? 0) + 1 });
        delete updated.claimToken; delete updated.claimUntil; delete updated.pendingRunId;
        scheduleRows.set(updated.id, updated);
        return true;
      },
      removeClaimed: async (id, claimToken, revision = 0) => { const current = scheduleRows.get(id); if (!current || current.claimToken !== claimToken || (current.revision ?? 0) !== revision) return false; scheduleRows.delete(id); return true; },
      releaseClaim: async (id, claimToken) => { const schedule = scheduleRows.get(id); if (schedule?.claimToken !== claimToken) return; delete schedule.claimToken; delete schedule.claimUntil; },
    },
    kv: {
      get: async (scope, key) => structuredClone(kvRows.get(kvKey(scope, key))),
      set: async (scope, key, value) => { kvRows.set(kvKey(scope, key), structuredClone(jsonWireCodec.encode(value))); },
      delete: async (scope, key) => { kvRows.delete(kvKey(scope, key)); },
    },
    logger: consoleLogger,
  };
}
