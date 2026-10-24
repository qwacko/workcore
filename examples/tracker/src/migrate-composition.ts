import { randomUUID } from 'node:crypto';
import { readFile, rename, unlink, writeFile } from 'node:fs/promises';

type Row = Record<string, unknown>;
const record = (value: unknown): value is Row => !!value && typeof value === 'object' && !Array.isArray(value);
const trackerScope = (value: unknown) => record(value) && value.applicationId === 'tracker';
const operationNames: Record<string, string> = { refreshSummary: 'activities.refreshSummary', '@workcore/agent/milo': '@workcore/agent/assistant.milo' };

/** Rename only known compatible tracker execution identities; never reinterpret encoded inputs or audit history. */
export function migrateTrackerCompositionState(input: unknown): { state: Row; changed: boolean } {
  if (!record(input)) throw new Error('Tracker state must be a JSON object');
  const state = structuredClone(input);
  let changed = false;
  for (const field of ['tasks', 'processing', 'runs', 'schedules', 'agentRuns'] as const) {
    const rows = state[field];
    if (rows === undefined) continue;
    if (!Array.isArray(rows) || rows.some((row) => !record(row))) throw new Error(`Tracker state '${field}' must be an array of records`);
    for (const row of rows as Row[]) {
      const inTracker = field === 'tasks' || field === 'processing' ? row.applicationId === 'tracker' : trackerScope(row.scope);
      if (!inTracker) continue;
      if ((field === 'runs' || field === 'agentRuns') && row.status !== 'queued' && row.status !== 'running') continue;
      if (field === 'agentRuns') {
        if (row.agent === 'milo') { row.agent = 'assistant.milo'; changed = true; }
      } else if (typeof row.operation === 'string' && Object.hasOwn(operationNames, row.operation)) {
        row.operation = operationNames[row.operation]!;
        changed = true;
      }
    }
  }
  if (state.kv !== undefined) {
    if (!record(state.kv)) throw new Error('Tracker state KV must be a record');
    for (const [key, value] of Object.entries(state.kv)) {
      let tuple: unknown;
      try { tuple = JSON.parse(key); } catch { continue; }
      if (!Array.isArray(tuple) || tuple.length !== 3 || tuple[0] !== 'tracker' || typeof tuple[1] !== 'string' || tuple[2] !== 'activity-summary') continue;
      const qualified = JSON.stringify([tuple[0], tuple[1], `@workcore/module/${JSON.stringify(['activities', 'activity-summary'])}`]);
      // Preserve the old key for inspection and never overwrite a newer module cache.
      if (!Object.hasOwn(state.kv, qualified)) { state.kv[qualified] = value; changed = true; }
    }
  }
  return { state, changed };
}

/** Local single-process demo only: run before creating adapters, serving requests or starting workers. */
export async function migrateTrackerCompositionFile(path: string): Promise<string | undefined> {
  let original: string;
  try { original = await readFile(path, 'utf8'); }
  catch (error) { if (record(error) && error.code === 'ENOENT') return; throw error; }
  const migrated = migrateTrackerCompositionState(JSON.parse(original));
  if (!migrated.changed) return;
  const suffix = randomUUID();
  const backup = `${path}.pre-module-composition-${suffix}.bak`;
  const temporary = `${path}.module-composition-${suffix}.tmp`;
  await writeFile(backup, original, { flag: 'wx', mode: 0o600 });
  try {
    await writeFile(temporary, JSON.stringify(migrated.state, null, 2), { flag: 'wx', mode: 0o600 });
    await rename(temporary, path);
  } finally {
    await unlink(temporary).catch((error: unknown) => { if (!record(error) || error.code !== 'ENOENT') throw error; });
  }
  return backup;
}
