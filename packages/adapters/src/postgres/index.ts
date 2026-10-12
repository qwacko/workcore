import { jsonWireCodec, type HistoryEntry, type KeyValueAdapter, type PlatformServices, type ScheduleAdapter, type ScheduleEntry, type Scope, type TaskAdapter, type TaskPayload, type TaskRun, type WorkspaceAdapter } from '@workcore/core';

/** Minimal pg Pool/PoolClient shape; pass a `pg.Pool` without adding pg to Workcore's dependency tree. */
export interface PostgresPool {
  query<T = Record<string, unknown>>(text: string, values?: readonly unknown[]): Promise<{ rows: T[]; rowCount?: number | null }>;
  connect(): Promise<PostgresClient>;
}
export interface PostgresClient {
  query<T = Record<string, unknown>>(text: string, values?: readonly unknown[]): Promise<{ rows: T[]; rowCount?: number | null }>;
  release(): void;
}

export const POSTGRES_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS workcore_workspaces (
  application_id text NOT NULL, id text NOT NULL, name text NOT NULL,
  PRIMARY KEY (application_id, id)
);
CREATE TABLE IF NOT EXISTS workcore_workspace_members (
  application_id text NOT NULL, workspace_id text NOT NULL, actor_id text NOT NULL,
  PRIMARY KEY (application_id, workspace_id, actor_id),
  FOREIGN KEY (application_id, workspace_id) REFERENCES workcore_workspaces(application_id, id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS workcore_history (
  id text PRIMARY KEY, application_id text NOT NULL, workspace_id text NOT NULL,
  entry jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS workcore_history_scope_idx ON workcore_history(application_id, workspace_id, created_at DESC);
CREATE TABLE IF NOT EXISTS workcore_tasks (
  id text PRIMARY KEY, application_id text NOT NULL, workspace_id text NOT NULL,
  actor_id text NOT NULL, operation text NOT NULL, status text NOT NULL,
  payload jsonb NOT NULL, run jsonb NOT NULL, lease_until timestamptz,
  created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS workcore_tasks_claim_idx ON workcore_tasks(status, lease_until, created_at);
CREATE INDEX IF NOT EXISTS workcore_tasks_scope_idx ON workcore_tasks(application_id, workspace_id, created_at DESC);
-- Retain enqueue idempotency markers independently from inspectable run/result retention.
CREATE TABLE IF NOT EXISTS workcore_task_dedupe (
  id text PRIMARY KEY, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS workcore_schedules (
  id text PRIMARY KEY, application_id text NOT NULL, workspace_id text NOT NULL,
  enabled boolean NOT NULL, next_run_at timestamptz, revision integer NOT NULL DEFAULT 0,
  claim_token text, claim_until timestamptz, pending_run_id text, body jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS workcore_schedules_due_idx ON workcore_schedules(enabled, next_run_at);
CREATE TABLE IF NOT EXISTS workcore_kv (
  application_id text NOT NULL, workspace_id text NOT NULL, key text NOT NULL, value jsonb NOT NULL,
  PRIMARY KEY (application_id, workspace_id, key)
);
`;

export async function migratePostgres(pool: PostgresPool): Promise<void> { await pool.query(POSTGRES_SCHEMA_SQL); }

export function createPostgresState(options: { pool: PostgresPool; historyLimit?: number; taskRunLimit?: number; taskLeaseMs?: number; maxKVValueBytes?: number }): Omit<PlatformServices, 'events'> {
  const { pool } = options;
  const historyLimit = positiveInteger(options.historyLimit ?? 5_000, 'historyLimit');
  const taskRunLimit = positiveInteger(options.taskRunLimit ?? 1_000, 'taskRunLimit');
  const taskLeaseMs = positiveInteger(options.taskLeaseMs ?? 30_000, 'taskLeaseMs');
  const maxKVValueBytes = positiveInteger(options.maxKVValueBytes ?? 1_048_576, 'maxKVValueBytes');
  if (taskLeaseMs < 30_000) throw new TypeError('taskLeaseMs must be at least 30 seconds to allow worker heartbeats');
  const transaction = async <T>(work: (client: PostgresClient) => Promise<T>): Promise<T> => {
    const client = await pool.connect();
    try { await client.query('BEGIN'); const result = await work(client); await client.query('COMMIT'); return result; }
    catch (error) { await client.query('ROLLBACK').catch(() => undefined); throw error; }
    finally { client.release(); }
  };
  const workspaces: WorkspaceAdapter = {
    canAccess: async (actor, scope) => {
      const result = await pool.query('SELECT 1 FROM workcore_workspace_members m JOIN workcore_workspaces w ON w.application_id=m.application_id AND w.id=m.workspace_id WHERE m.application_id=$1 AND m.workspace_id=$2 AND m.actor_id=$3', [scope.applicationId, scope.workspaceId, actor.id]);
      return result.rows.length > 0;
    },
    list: async (actor, applicationId) => {
      const result = await pool.query<{ id: string; name: string }>('SELECT w.id,w.name FROM workcore_workspaces w JOIN workcore_workspace_members m ON m.application_id=w.application_id AND m.workspace_id=w.id WHERE w.application_id=$1 AND m.actor_id=$2 ORDER BY w.name,w.id', [applicationId, actor.id]);
      return result.rows;
    },
  };
  const tasks: TaskAdapter = {
    enqueue: async (payload) => {
      const scope = { applicationId: payload.applicationId, workspaceId: payload.workspaceId };
      const run: TaskRun = { id: payload.id, runId: payload.id, scope, actorId: payload.actorId, kind: 'task', operation: payload.operation, status: 'queued', startedAt: payload.createdAt, ...(payload.codecId ? { codecId: payload.codecId } : {}) };
      await transaction(async (client) => {
        const inserted = await client.query('INSERT INTO workcore_task_dedupe(id,created_at) VALUES($1,$2) ON CONFLICT(id) DO NOTHING RETURNING id', [payload.id, payload.createdAt]);
        if (!inserted.rows.length) return;
        await client.query('INSERT INTO workcore_tasks(id,application_id,workspace_id,actor_id,operation,status,payload,run,created_at) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9)', [payload.id, payload.applicationId, payload.workspaceId, payload.actorId, payload.operation, 'queued', JSON.stringify(payload), JSON.stringify(run), payload.createdAt]);
      });
    },
    claim: () => transaction(async (client) => {
      const selected = await client.query<{ id: string; payload: TaskPayload; run: TaskRun }>(`SELECT id,payload,run FROM workcore_tasks WHERE status='queued' OR (status='running' AND lease_until < now()) ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1`);
      const item = selected.rows[0];
      if (!item) return undefined;
      const payload = jsonValue<TaskPayload>(item.payload);
      const run = jsonValue<TaskRun>(item.run);
      run.status = 'running'; run.startedAt = new Date().toISOString();
      await client.query("UPDATE workcore_tasks SET status='running',lease_until=now()+($2::text||' milliseconds')::interval,run=$3::jsonb,updated_at=now() WHERE id=$1", [item.id, taskLeaseMs, JSON.stringify(run)]);
      return payload;
    }),
    heartbeat: async (runId) => {
      const result = await pool.query("UPDATE workcore_tasks SET lease_until=now()+($2::text||' milliseconds')::interval,updated_at=now() WHERE id=$1 AND status='running'", [runId, taskLeaseMs]);
      if (result.rowCount !== 1) throw new Error(`Task lease for '${runId}' is no longer owned by this worker`);
    },
    release: async (runId) => { await pool.query("UPDATE workcore_tasks SET status='queued',lease_until=NULL,run=jsonb_set(run,'{status}','\"queued\"'::jsonb),updated_at=now() WHERE id=$1 AND status='running'", [runId]); },
    complete: async (runId, result) => {
      await pool.query("UPDATE workcore_tasks SET status='succeeded',lease_until=NULL,run=run || jsonb_build_object('status','succeeded','result',$2::jsonb,'finishedAt',now()),updated_at=now() WHERE id=$1", [runId, JSON.stringify(result)]);
      await pruneTaskRuns(pool, taskRunLimit);
    },
    fail: async (runId, error) => {
      await pool.query("UPDATE workcore_tasks SET status='failed',lease_until=NULL,run=run || jsonb_build_object('status','failed','error',$2::jsonb,'finishedAt',now()),updated_at=now() WHERE id=$1", [runId, JSON.stringify(error)]);
      await pruneTaskRuns(pool, taskRunLimit);
    },
    progress: async (runId, percent) => { await pool.query("UPDATE workcore_tasks SET run=jsonb_set(run,'{progress}',to_jsonb($2::numeric)),updated_at=now() WHERE id=$1 AND status='running'", [runId, Math.max(0, Math.min(100, percent))]); },
    list: async (scope, limit) => {
      const result = await pool.query<{ run: TaskRun }>('SELECT run FROM workcore_tasks WHERE application_id=$1 AND workspace_id=$2 ORDER BY created_at DESC,id DESC LIMIT $3', [scope.applicationId, scope.workspaceId, limit]);
      return result.rows.map((row) => jsonValue<TaskRun>(row.run));
    },
    waitForWork: (signal) => new Promise((resolve) => {
      if (signal.aborted) return resolve();
      const timer = setTimeout(done, 500);
      function done() { clearTimeout(timer); signal.removeEventListener('abort', done); resolve(); }
      signal.addEventListener('abort', done, { once: true });
    }),
  };
  const schedules: ScheduleAdapter = {
    create: async (schedule) => { await pool.query('INSERT INTO workcore_schedules(id,application_id,workspace_id,enabled,next_run_at,revision,body) VALUES($1,$2,$3,$4,$5,0,$6::jsonb)', [schedule.id, schedule.scope.applicationId, schedule.scope.workspaceId, schedule.enabled, schedule.nextRunAt ?? null, JSON.stringify(schedule)]); },
    list: async (scope) => (await pool.query<{ body: ScheduleEntry }>('SELECT body FROM workcore_schedules WHERE application_id=$1 AND workspace_id=$2 ORDER BY id', [scope.applicationId, scope.workspaceId])).rows.map((row) => jsonValue<ScheduleEntry>(row.body)),
    get: async (id) => { const row = (await pool.query<{ body: ScheduleEntry }>('SELECT body FROM workcore_schedules WHERE id=$1', [id])).rows[0]; return row ? jsonValue<ScheduleEntry>(row.body) : undefined; },
    update: (schedule) => transaction(async (client) => {
      const result = await client.query<{ revision: number; body: ScheduleEntry }>('SELECT revision,body FROM workcore_schedules WHERE id=$1 FOR UPDATE', [schedule.id]);
      const current = result.rows[0];
      if (!current || Number(current.revision) !== (schedule.revision ?? 0)) return false;
      const body = { ...jsonValue<ScheduleEntry>(current.body), ...schedule, revision: Number(current.revision) + 1 };
      await client.query('UPDATE workcore_schedules SET enabled=$2,next_run_at=$3,revision=$4,body=$5::jsonb WHERE id=$1', [schedule.id, body.enabled, body.nextRunAt ?? null, body.revision, JSON.stringify(body)]);
      return true;
    }),
    remove: async (id) => { await pool.query('DELETE FROM workcore_schedules WHERE id=$1', [id]); },
    claimDue: (now, claimToken, leaseMs) => transaction(async (client) => {
      const found = await client.query<{ id: string; body: ScheduleEntry; revision: number }>(`SELECT id,body,revision FROM workcore_schedules WHERE (pending_run_id IS NOT NULL OR (enabled AND next_run_at <= $1)) AND (claim_until IS NULL OR claim_until <= now()) ORDER BY next_run_at FOR UPDATE SKIP LOCKED`, [now]);
      const due: ScheduleEntry[] = [];
      for (const row of found.rows) {
        const schedule = jsonValue<ScheduleEntry>(row.body);
        if (schedule.activeRunId && !schedule.pendingRunId) {
          const active = await client.query<{ status: string }>('SELECT status FROM workcore_tasks WHERE id=$1', [schedule.activeRunId]);
          if (active.rows[0]?.status === 'queued' || active.rows[0]?.status === 'running') continue;
        }
        const claim = await client.query<{ claim_until: Date | string }>("UPDATE workcore_schedules SET claim_token=$2,claim_until=now()+($3::text||' milliseconds')::interval WHERE id=$1 RETURNING claim_until", [row.id, claimToken, leaseMs]);
        const claimUntil = new Date(claim.rows[0]!.claim_until).toISOString();
        due.push({ ...schedule, revision: Number(row.revision), claimToken, claimUntil });
      }
      return due;
    }),
    renewClaim: async (id, claimToken, claimUntil) => {
      const leaseMs = Math.max(1, Date.parse(claimUntil) - Date.now());
      return (await pool.query("UPDATE workcore_schedules SET claim_until=now()+($3::text||' milliseconds')::interval WHERE id=$1 AND claim_token=$2", [id, claimToken, leaseMs])).rowCount === 1;
    },
    reserveRun: async (schedule, claimToken, runId) => (await pool.query("UPDATE workcore_schedules SET pending_run_id=$3,body=jsonb_set(body,'{pendingRunId}',to_jsonb($3::text)) WHERE id=$1 AND claim_token=$2 AND revision=$4 AND (enabled OR pending_run_id IS NOT NULL) AND claim_until>now()", [schedule.id, claimToken, runId, schedule.revision ?? 0])).rowCount === 1,
    clearActiveRun: async (id, runId) => { await pool.query("UPDATE workcore_schedules SET body=body-'activeRunId' WHERE id=$1 AND body->>'activeRunId'=$2", [id, runId]); },
    updateClaimed: async (schedule, claimToken) => transaction(async (client) => {
      const found = await client.query<{ body: ScheduleEntry; revision: number }>('SELECT body,revision FROM workcore_schedules WHERE id=$1 AND claim_token=$2 FOR UPDATE', [schedule.id, claimToken]);
      const row = found.rows[0];
      if (!row || Number(row.revision) !== (schedule.revision ?? 0)) return false;
      const current = jsonValue<ScheduleEntry>(row.body);
      const next = { ...current, ...schedule, revision: Number(row.revision) + 1 };
      delete next.claimToken; delete next.claimUntil; delete next.pendingRunId;
      await client.query('UPDATE workcore_schedules SET enabled=$2,next_run_at=$3,revision=$4,claim_token=NULL,claim_until=NULL,pending_run_id=NULL,body=$5::jsonb WHERE id=$1', [schedule.id, next.enabled, next.nextRunAt ?? null, next.revision, JSON.stringify(next)]);
      return true;
    }),
    removeClaimed: async (id, claimToken, revision = 0) => (await pool.query('DELETE FROM workcore_schedules WHERE id=$1 AND claim_token=$2 AND revision=$3', [id, claimToken, revision])).rowCount === 1,
    releaseClaim: async (id, claimToken) => { await pool.query('UPDATE workcore_schedules SET claim_token=NULL,claim_until=NULL WHERE id=$1 AND claim_token=$2', [id, claimToken]); },
  };
  const history = {
    append: async (entry: HistoryEntry) => {
      await pool.query('INSERT INTO workcore_history(id,application_id,workspace_id,entry,created_at) VALUES($1,$2,$3,$4::jsonb,now()) ON CONFLICT(id) DO UPDATE SET entry=excluded.entry', [entry.id, entry.scope.applicationId, entry.scope.workspaceId, JSON.stringify(entry)]);
      await pool.query('DELETE FROM workcore_history WHERE id IN (SELECT id FROM workcore_history WHERE application_id=$1 AND workspace_id=$2 ORDER BY created_at DESC OFFSET $3)', [entry.scope.applicationId, entry.scope.workspaceId, historyLimit]);
    },
    list: async (scope: Scope, limit: number) => (await pool.query<{ entry: HistoryEntry }>('SELECT entry FROM workcore_history WHERE application_id=$1 AND workspace_id=$2 ORDER BY created_at DESC LIMIT $3', [scope.applicationId, scope.workspaceId, limit])).rows.map((row) => jsonValue<HistoryEntry>(row.entry)),
  };
  const kv: KeyValueAdapter = {
    get: async (scope, key) => { const row = (await pool.query<{ value: unknown }>('SELECT value FROM workcore_kv WHERE application_id=$1 AND workspace_id=$2 AND key=$3', [scope.applicationId, scope.workspaceId, key])).rows[0]; return row?.value; },
    set: async (scope, key, value) => {
      const encoded = jsonWireCodec.encode(value);
      const json = JSON.stringify(encoded);
      if (new TextEncoder().encode(json).byteLength > maxKVValueBytes) throw new RangeError(`KV value exceeds the ${maxKVValueBytes}-byte limit`);
      await pool.query('INSERT INTO workcore_kv(application_id,workspace_id,key,value) VALUES($1,$2,$3,$4::jsonb) ON CONFLICT(application_id,workspace_id,key) DO UPDATE SET value=excluded.value', [scope.applicationId, scope.workspaceId, key, json]);
    },
    delete: async (scope, key) => { await pool.query('DELETE FROM workcore_kv WHERE application_id=$1 AND workspace_id=$2 AND key=$3', [scope.applicationId, scope.workspaceId, key]); },
  };
  return { workspaces, history, tasks, schedules, kv };
}

async function pruneTaskRuns(pool: PostgresPool, limit: number) {
  await pool.query("DELETE FROM workcore_tasks WHERE id IN (SELECT id FROM workcore_tasks WHERE status IN ('succeeded','failed') ORDER BY created_at DESC,id DESC OFFSET $1)", [limit]);
}
function positiveInteger(value: number, name: string) { if (!Number.isInteger(value) || value < 1) throw new TypeError(`${name} must be a positive integer`); return value; }
function jsonValue<T>(value: T | string): T { return typeof value === 'string' ? JSON.parse(value) as T : value; }
