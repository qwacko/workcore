import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { nextScheduleOccurrence, type EventAdapter, type HistoryEntry, type PlatformServices, type ScheduleEntry, type Scope, type TaskPayload, type TaskRun, type WorkcoreEvent } from '@workcore/core';

type DurableFileState = {
  tasks: TaskPayload[];
  processing: TaskPayload[];
  runs: TaskRun[];
  history: HistoryEntry[];
  schedules: ScheduleEntry[];
  kv: Record<string, unknown>;
};

const emptyState = (): DurableFileState => ({ tasks: [], processing: [], runs: [], history: [], schedules: [], kv: {} });
const scopeKey = (scope: Scope) => JSON.stringify([scope.applicationId, scope.workspaceId]);
const kvKey = (scope: Scope, key: string) => JSON.stringify([scope.applicationId, scope.workspaceId, key]);
const sameScope = (left: Scope, right: Scope) => left.applicationId === right.applicationId && left.workspaceId === right.workspaceId;

/** Single-process local/demo adapter. Production multi-process deployments should use shared database/queue adapters. */
function createFileAdapterState(options: {
  path: string;
  workspaces: Array<{ applicationId: string; id: string; name: string; actors: string[] }>;
}): PlatformServices {
  let serial: Promise<void> = Promise.resolve();
  let recovered = false;
  const listeners = new Map<string, Set<(event: WorkcoreEvent) => void>>();
  const waiters = new Set<() => void>();

  async function read(): Promise<DurableFileState> {
    try {
      const parsed = JSON.parse(await readFile(options.path, 'utf8')) as Partial<DurableFileState>;
      return { ...emptyState(), ...parsed, processing: parsed.processing ?? [] };
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return emptyState();
      throw error;
    }
  }
  async function update<T>(fn: (state: DurableFileState) => T | Promise<T>): Promise<T> {
    let result!: T;
    const operation = serial.then(async () => {
      const state = await read();
      if (!recovered) {
        recovered = true;
        for (const payload of state.processing) {
          state.tasks.unshift(payload);
          const run = state.runs.find((candidate) => candidate.runId === payload.id);
          if (run) run.status = 'queued';
        }
        state.processing = [];
      }
      result = await fn(state);
      await mkdir(dirname(options.path), { recursive: true });
      const temporary = `${options.path}.${process.pid}.tmp`;
      await writeFile(temporary, JSON.stringify(state, null, 2));
      await rename(temporary, options.path);
    });
    serial = operation.catch(() => undefined);
    await operation;
    return result;
  }
  const eventAdapter: EventAdapter = {
    publish: async (event) => { for (const listener of listeners.get(scopeKey(event)) ?? []) listener(event); },
    subscribe: (scope, listener) => {
      const key = scopeKey(scope);
      const set = listeners.get(key) ?? new Set();
      set.add(listener);
      listeners.set(key, set);
      return () => { set.delete(listener); if (!set.size) listeners.delete(key); };
    },
  };

  return {
    workspaces: {
      canAccess: (actor, scope) => options.workspaces.some((workspace) => workspace.applicationId === scope.applicationId && workspace.id === scope.workspaceId && workspace.actors.includes(actor.id)),
      list: async (actor, applicationId) => options.workspaces.filter((workspace) => workspace.applicationId === applicationId && workspace.actors.includes(actor.id)).map(({ id, name }) => ({ id, name })),
    },
    events: eventAdapter,
    history: {
      append: (entry) => update((state) => { state.history.unshift(entry); }),
      list: async (scope, limit) => (await read()).history.filter((entry) => sameScope(entry.scope, scope)).slice(0, limit),
    },
    tasks: {
      enqueue: async (payload) => {
        await update((state) => {
          if (state.runs.some((run) => run.runId === payload.id)) return;
          state.tasks.push(payload);
          state.runs.unshift({ id: payload.id, runId: payload.id, scope: { applicationId: payload.applicationId, workspaceId: payload.workspaceId }, actorId: payload.actorId, kind: 'task', operation: payload.operation, status: 'queued', startedAt: payload.createdAt, ...(payload.codecId ? { codecId: payload.codecId } : {}) });
        });
        for (const wake of waiters) wake();
      },
      claim: () => update((state) => {
        const payload = state.tasks.shift();
        if (!payload) return undefined;
        state.processing.push(payload);
        const run = state.runs.find((candidate) => candidate.runId === payload.id);
        if (run) { run.status = 'running'; run.startedAt = new Date().toISOString(); }
        return payload;
      }),
      release: (runId) => update((state) => {
        const index = state.processing.findIndex((payload) => payload.id === runId);
        if (index < 0) return;
        const [payload] = state.processing.splice(index, 1);
        if (!payload) return;
        state.tasks.unshift(payload);
        const run = state.runs.find((candidate) => candidate.runId === runId);
        if (run) { run.status = 'queued'; delete run.finishedAt; }
      }).then(() => { for (const wake of waiters) wake(); }),
      complete: (runId, result) => update((state) => { state.processing = state.processing.filter((payload) => payload.id !== runId); const run = state.runs.find((candidate) => candidate.runId === runId); if (run) { run.status = 'succeeded'; run.result = result; run.finishedAt = new Date().toISOString(); } }),
      fail: (runId, error) => update((state) => { state.processing = state.processing.filter((payload) => payload.id !== runId); const run = state.runs.find((candidate) => candidate.runId === runId); if (run) { run.status = 'failed'; run.error = error; run.finishedAt = new Date().toISOString(); } }),
      progress: (runId, progress) => update((state) => { const run = state.runs.find((candidate) => candidate.runId === runId); if (run) run.progress = Math.max(0, Math.min(100, progress)); }),
      list: async (scope, limit) => (await read()).runs.filter((run) => sameScope(run.scope, scope)).slice(0, limit),
      waitForWork: (signal) => new Promise((resolve) => {
        if (signal.aborted) return resolve();
        const wake = () => { waiters.delete(wake); signal.removeEventListener('abort', wake); resolve(); };
        waiters.add(wake);
        signal.addEventListener('abort', wake, { once: true });
      }),
    },
    schedules: {
      create: (schedule) => update((state) => { state.schedules.push(schedule); }),
      list: async (scope) => (await read()).schedules.filter((schedule) => sameScope(schedule.scope, scope)),
      get: async (id) => (await read()).schedules.find((schedule) => schedule.id === id),
      update: (schedule) => update((state) => {
        const index = state.schedules.findIndex((candidate) => candidate.id === schedule.id);
        const current = state.schedules[index];
        if (!current || (current.revision ?? 0) !== (schedule.revision ?? 0)) return false;
        const { claimToken: _token, claimUntil: _until, activeRunId: _active, pendingRunId: _pending, ...fields } = schedule;
        state.schedules[index] = { ...current, ...fields, revision: (current.revision ?? 0) + 1 };
        return true;
      }),
      remove: (id) => update((state) => { state.schedules = state.schedules.filter((schedule) => schedule.id !== id); }),
      claimDue: (now, claimToken, leaseMs) => update((state) => {
        const due: ScheduleEntry[] = [];
        for (const schedule of state.schedules) {
          if (!schedule.pendingRunId && (!schedule.enabled || !schedule.nextRunAt || Date.parse(schedule.nextRunAt) > now.getTime())) continue;
          if (schedule.claimToken && schedule.claimUntil && Date.parse(schedule.claimUntil) > now.getTime()) continue;
          if (!schedule.pendingRunId && schedule.activeRunId) {
            const run = state.runs.find((candidate) => candidate.runId === schedule.activeRunId);
            if (run?.status === 'queued' || run?.status === 'running') {
              schedule.lastSkipReason = 'Skipped because the previous scheduled run is still active';
              if (schedule.kind === 'recurring') schedule.nextRunAt = nextScheduleOccurrence(schedule.cron!, now, schedule.timezone).toISOString();
              continue;
            }
            delete schedule.activeRunId;
          }
          schedule.claimToken = claimToken;
          schedule.claimUntil = new Date(now.getTime() + leaseMs).toISOString();
          due.push({ ...schedule });
        }
        return due;
      }),
      renewClaim: async (id, claimToken, claimUntil) => {
        let renewed = false;
        await update((state) => {
          const schedule = state.schedules.find((candidate) => candidate.id === id);
          if (!schedule || schedule.claimToken !== claimToken) return;
          schedule.claimUntil = claimUntil;
          renewed = true;
        });
        return renewed;
      },
      updateClaimed: async (schedule, claimToken) => {
        let updated = false;
        await update((state) => {
          const current = state.schedules.find((candidate) => candidate.id === schedule.id);
          if (!current || current.claimToken !== claimToken || (current.revision ?? 0) !== (schedule.revision ?? 0)) return;
          const replacement = { ...schedule, revision: (current.revision ?? 0) + 1 };
          delete replacement.claimToken;
          delete replacement.claimUntil;
          delete replacement.pendingRunId;
          state.schedules[state.schedules.indexOf(current)] = replacement;
          updated = true;
        });
        return updated;
      },
      reserveRun: (schedule, claimToken, runId) => update((state) => {
        const current = state.schedules.find((candidate) => candidate.id === schedule.id);
        if (!current || (!current.enabled && !current.pendingRunId) || current.claimToken !== claimToken || (current.revision ?? 0) !== (schedule.revision ?? 0)
          || !current.claimUntil || Date.parse(current.claimUntil) <= Date.now()) return false;
        current.pendingRunId = runId;
        return true;
      }),
      clearActiveRun: (id, runId) => update((state) => {
        const current = state.schedules.find((candidate) => candidate.id === id);
        if (current?.activeRunId === runId) delete current.activeRunId;
      }),
      removeClaimed: async (id, claimToken, revision = 0) => {
        let removed = false;
        await update((state) => {
          const index = state.schedules.findIndex((candidate) => candidate.id === id && candidate.claimToken === claimToken && (candidate.revision ?? 0) === revision);
          if (index < 0) return;
          state.schedules.splice(index, 1);
          removed = true;
        });
        return removed;
      },
      releaseClaim: (id, claimToken) => update((state) => {
        const schedule = state.schedules.find((candidate) => candidate.id === id);
        if (schedule?.claimToken !== claimToken) return;
        delete schedule.claimToken;
        delete schedule.claimUntil;
      }),
    },
    kv: {
      get: async (scope, key) => {
        const values = (await read()).kv;
        const storageKey = kvKey(scope, key);
        if (Object.hasOwn(values, storageKey)) return values[storageKey];
        const legacyKey = `${scope.applicationId}:${scope.workspaceId}:${key}`;
        const matchingScopes = options.workspaces.filter((workspace) => legacyKey.startsWith(`${workspace.applicationId}:${workspace.id}:`));
        if (matchingScopes.length === 1 && matchingScopes[0]?.applicationId === scope.applicationId && matchingScopes[0]?.id === scope.workspaceId) return values[legacyKey];
        return undefined;
      },
      set: (scope, key, value) => update((state) => { state.kv[kvKey(scope, key)] = value; }),
      delete: (scope, key) => update((state) => { delete state.kv[kvKey(scope, key)]; }),
    },
    logger: {
      debug: (message, fields) => console.debug(message, fields), info: (message, fields) => console.info(message, fields),
      warn: (message, fields) => console.warn(message, fields), error: (message, fields) => console.error(message, fields),
    },
  };
}

export type FileAdapterState = ReturnType<typeof createFileAdapterState>;

export function createFileState(options: Parameters<typeof createFileAdapterState>[0]): FileAdapterState {
  return createFileAdapterState(options);
}

export const createFileWorkspaces = (state: FileAdapterState) => state.workspaces;
export const createFileEvents = (state: FileAdapterState) => state.events;
export const createFileHistory = (state: FileAdapterState) => state.history;
export const createFileTasks = (state: FileAdapterState) => state.tasks;
export const createFileSchedules = (state: FileAdapterState) => state.schedules;
export const createFileKV = (state: FileAdapterState) => state.kv;
export const createFileLogger = (state: FileAdapterState): NonNullable<FileAdapterState['logger']> => state.logger!;
