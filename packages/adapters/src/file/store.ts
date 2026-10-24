import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { AgentRun, AgentTraceEvent, HistoryEntry, ScheduleEntry, TaskPayload, TaskRun } from '@workcore/core';

export type FileWorkspaces = Array<{ applicationId: string; id: string; name: string; actors: string[] }>;
export type DurableFileState = {
  formatVersion: number;
  tasks: TaskPayload[];
  taskDedupe: string[];
  processing: TaskPayload[];
  runs: TaskRun[];
  history: HistoryEntry[];
  schedules: ScheduleEntry[];
  kv: Record<string, unknown>;
  agentRuns: AgentRun[];
  agentEvents: AgentTraceEvent[];
};

const emptyState = (): DurableFileState => ({ formatVersion: 1, tasks: [], taskDedupe: [], processing: [], runs: [], history: [], schedules: [], kv: {}, agentRuns: [], agentEvents: [] });

function migrate(state: DurableFileState, workspaces: FileWorkspaces) {
  if (!Number.isSafeInteger(state.formatVersion) || state.formatVersion < 0 || state.formatVersion > 1) throw new Error(`Unsupported Workcore file state version '${state.formatVersion}'`);
  if (state.formatVersion === 1) return;
  for (const [key, value] of Object.entries(state.kv)) {
    const matches = workspaces.filter((workspace) => key.startsWith(`${workspace.applicationId}:${workspace.id}:`));
    if (matches.length !== 1) continue; // Preserve ambiguous/unmapped data for an explicit application migration.
    const workspace = matches[0]!;
    const name = key.slice(`${workspace.applicationId}:${workspace.id}:`.length);
    const target = JSON.stringify([workspace.applicationId, workspace.id, name]);
    if (!Object.hasOwn(state.kv, target)) state.kv[target] = value;
    delete state.kv[key];
  }
  state.formatVersion = 1;
}

/** One serialized read/modify/write boundary. Only changed state is written atomically. */
export function createFileStore(options: { path: string; workspaces: FileWorkspaces }) {
  let serial: Promise<unknown> = Promise.resolve();
  let recovered = false;

  async function load(): Promise<DurableFileState> {
    try {
      const parsed = JSON.parse(await readFile(options.path, 'utf8')) as Partial<DurableFileState>;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new TypeError('Workcore file state must be an object');
      return { ...emptyState(), ...parsed, formatVersion: parsed.formatVersion ?? 0, taskDedupe: parsed.taskDedupe ?? parsed.runs?.map((run) => run.runId) ?? [] };
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return emptyState();
      throw error;
    }
  }

  function update<T>(fn: (state: DurableFileState) => T): Promise<T> {
    const operation = serial.then(async () => {
      const state = await load();
      const before = JSON.stringify(state);
      migrate(state, options.workspaces);
      if (!recovered) {
        const pending = state.processing.filter((payload) => {
          const run = state.runs.find((item) => item.runId === payload.id);
          if (run?.status === 'succeeded' || run?.status === 'failed') return false;
          if (run) run.status = 'queued';
          return true;
        });
        state.tasks.unshift(...pending);
        state.processing = [];
      }
      const result = fn(state);
      if (JSON.stringify(state) !== before) {
        await mkdir(dirname(options.path), { recursive: true });
        const temporary = `${options.path}.${crypto.randomUUID()}.tmp`;
        try {
          await writeFile(temporary, JSON.stringify(state, null, 2));
          await rename(temporary, options.path);
        } finally { await unlink(temporary).catch(() => undefined); }
      }
      // Recovery is committed only after the operation and persistence succeed.
      recovered = true;
      return result;
    });
    serial = operation.catch(() => undefined);
    return operation;
  }

  return { update, read: () => update((state) => state) };
}
