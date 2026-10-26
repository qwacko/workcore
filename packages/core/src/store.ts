import type { Json, PageInput, Row, Tables, Writer } from './definitions.js';
import { checkName, encode, WorkcoreError } from './json.js';

export type SqlValue = string | number | null | ArrayBuffer;
export interface Sql {
  exec<T extends Record<string, SqlValue>>(query: string, ...bindings: SqlValue[]): Iterable<T> & { toArray(): T[] };
}
export interface Storage {
  sql: Sql;
  transactionSync<T>(callback: () => T): T;
}
export type Run = {
  id: string;
  job: string;
  kind: 'task' | 'agent';
  actor: { id: string };
  input: Json;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'interrupted' | 'cancelled';
  attempt: number;
  due: number;
  createdAt: number;
  updatedAt: number;
  result?: Json;
  error?: string;
  cancelRequested?: boolean;
  scheduleId?: string;
  progress?: Json;
};
export type Schedule = {
  id: string;
  job: string;
  actor: { id: string };
  input: Json;
  at: number;
  everyMs?: number;
  enabled: boolean;
  createdAt: number;
  lastError?: string;
  lastRunId?: string;
};
type RecordData = { id: string; revision: number; schema_version: number; data: string };
function unpack(row: RecordData): Row<Json> {
  return { id: row.id, revision: row.revision, schemaVersion: row.schema_version, data: JSON.parse(row.data) as Json };
}
function key(value: string): string {
  if (!value || value.length > 200) throw new WorkcoreError('INVALID_KEY', 'Keys must contain 1–200 characters');
  return value;
}
function indexPath(path: string): string {
  if (!/^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z][a-zA-Z0-9_]*)*$/.test(path)) throw new WorkcoreError('INVALID_INDEX', `Invalid index path: ${path}`);
  return `$.${path}`;
}

export function initialize(storage: Storage, tables: Tables): void {
  const sql = storage.sql;
  sql.exec(`
    CREATE TABLE IF NOT EXISTS wc_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS wc_records (
      table_name TEXT NOT NULL, id TEXT NOT NULL, revision INTEGER NOT NULL,
      schema_version INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY (table_name, id)
    );
    CREATE TABLE IF NOT EXISTS wc_kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS wc_runs (id TEXT PRIMARY KEY, status TEXT NOT NULL, due INTEGER NOT NULL, data TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS wc_runs_due ON wc_runs (status, due);
    CREATE INDEX IF NOT EXISTS wc_runs_actor ON wc_runs (json_extract(data, '$.actor.id'), id);
    CREATE TABLE IF NOT EXISTS wc_schedules (id TEXT PRIMARY KEY, enabled INTEGER NOT NULL, at INTEGER NOT NULL, data TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS wc_schedules_due ON wc_schedules (enabled, at);
    CREATE TABLE IF NOT EXISTS wc_steps (run_id TEXT NOT NULL, sequence INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY(run_id, sequence));
    CREATE TABLE IF NOT EXISTS wc_history (id TEXT PRIMARY KEY, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS wc_requests (id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, response TEXT NOT NULL);
  `);
  for (const [name, table] of Object.entries(tables)) {
    checkName(name);
    if (!Number.isSafeInteger(table.version) || table.version < 1) throw new WorkcoreError('INVALID_VERSION', `Invalid version for ${name}`);
    const saved = sql.exec<{ value: string }>('SELECT value FROM wc_meta WHERE key = ?', `table:${name}`).toArray()[0];
    const prior = saved ? Number(saved.value) : 1;
    if (prior > table.version) throw new WorkcoreError('SCHEMA_DOWNGRADE', `Cannot downgrade ${name}`);
    if (prior < table.version) {
      const rows = sql.exec<RecordData>('SELECT id, revision, schema_version, data FROM wc_records WHERE table_name = ?', name).toArray();
      for (const row of rows) {
        let data: Json = JSON.parse(row.data) as Json;
        for (let version = row.schema_version + 1; version <= table.version; version++) {
          const migration = table.migrations[version];
          if (!migration) throw new WorkcoreError('MISSING_MIGRATION', `${name} requires migration to version ${version}`);
          data = migration(data);
          encode(data);
        }
        const validated = table.schema.parse(data);
        sql.exec('UPDATE wc_records SET data = ?, schema_version = ? WHERE table_name = ? AND id = ?', encode(validated, 262_144), table.version, name, row.id);
      }
    }
    sql.exec('INSERT OR REPLACE INTO wc_meta (key, value) VALUES (?, ?)', `table:${name}`, String(table.version));
    for (const [index, path] of Object.entries(table.indexes)) {
      checkName(index);
      const validated = indexPath(path);
      const metaKey = `index:${name}:${index}`;
      const existing = sql.exec<{ value: string }>('SELECT value FROM wc_meta WHERE key = ?', metaKey).toArray()[0]?.value;
      if (existing === validated) continue;
      // Names and paths are constrained above; all user values still use bindings.
      sql.exec(`DROP INDEX IF EXISTS wc_idx_${name}_${index}`);
      sql.exec(`CREATE INDEX wc_idx_${name}_${index} ON wc_records (json_extract(data, '${validated}'), id) WHERE table_name = '${name}'`);
      sql.exec('INSERT OR REPLACE INTO wc_meta (key, value) VALUES (?, ?)', metaKey, validated);
    }
  }
}

/** A transaction-scoped capability. Retaining it beyond the callback is an error. */
export class Store<T extends Tables> implements Writer<T> {
  readonly changed = new Set<string>();
  private active = true;
  constructor(readonly sql: Sql, readonly tables: T, readonly revision: number, private writable: boolean) {}
  close(): void { this.active = false; }
  assertWritable(): void { this.check(true); }
  private check(write = false): void {
    if (!this.active) throw new WorkcoreError('EXPIRED_CONTEXT', 'Database context is no longer active');
    if (write && !this.writable) throw new WorkcoreError('READ_ONLY', 'Reads cannot change state');
  }
  private table(name: keyof T & string) {
    this.check();
    if (!Object.hasOwn(this.tables, name)) throw new WorkcoreError('UNKNOWN_TABLE', `Unknown table: ${name}`);
    const table = this.tables[name]!;
    return table;
  }
  get<K extends keyof T & string>(name: K, id: string): Row<any> | null {
    this.table(name);
    const row = this.sql.exec<RecordData>('SELECT id, revision, schema_version, data FROM wc_records WHERE table_name = ? AND id = ?', name, key(id)).toArray()[0];
    return row ? unpack(row) : null;
  }
  page<K extends keyof T & string>(name: K, input: PageInput = {}): { rows: Row<any>[]; nextCursor: string | null } {
    const table = this.table(name);
    const limit = input.limit ?? 100;
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new WorkcoreError('INVALID_LIMIT', 'Page limit must be between 1 and 1000');
    const values: SqlValue[] = [name, input.after ?? ''];
    let where = 'table_name = ? AND id > ?';
    if (input.index) {
      const path = table.indexes[input.index.name];
      if (!path) throw new WorkcoreError('UNKNOWN_INDEX', `Unknown index: ${input.index.name}`);
      where += ` AND json_extract(data, '${indexPath(path)}') IS ?`;
      values.push(typeof input.index.value === 'boolean' ? Number(input.index.value) : input.index.value);
    }
    const rows: Row<Json>[] = [];
    let bytes = 0;
    let more = false;
    for (const row of this.sql.exec<RecordData>(`SELECT id, revision, schema_version, data FROM wc_records WHERE ${where} ORDER BY id LIMIT ?`, ...values, limit + 1)) {
      const size = new TextEncoder().encode(row.data).length + 400;
      // Bound memory and leave headroom for the response envelope. A page may be shorter than limit.
      if (rows.length >= limit || (rows.length > 0 && bytes + size > 400_000)) { more = true; break; }
      rows.push(unpack(row)); bytes += size;
    }
    return { rows, nextCursor: more ? rows.at(-1)!.id : null };
  }
  all<K extends keyof T & string>(name: K): Row<any>[] {
    const page = this.page(name, { limit: 1000 });
    if (page.nextCursor !== null) throw new WorkcoreError('DATASET_TOO_LARGE', 'Use an indexed, bounded query instead of all()');
    return page.rows;
  }
  put<K extends keyof T & string>(name: K, id: string, data: any, options: { expectedRevision?: number } = {}): Row<any> {
    this.check(true);
    const table = this.table(name);
    const current = this.get(name, id);
    if (options.expectedRevision !== undefined && (current?.revision ?? 0) !== options.expectedRevision) {
      throw new WorkcoreError('CONFLICT', 'Record has changed', 409);
    }
    const validated = table.schema.parse(data);
    this.sql.exec('INSERT OR REPLACE INTO wc_records (table_name, id, revision, schema_version, data) VALUES (?, ?, ?, ?, ?)', name, key(id), this.revision, table.version, encode(validated, 262_144));
    this.changed.add(name);
    return { id, data: validated, revision: this.revision, schemaVersion: table.version };
  }
  delete<K extends keyof T & string>(name: K, id: string, options: { expectedRevision?: number } = {}): void {
    this.check(true);
    const current = this.get(name, id);
    if (options.expectedRevision !== undefined && (current?.revision ?? 0) !== options.expectedRevision) throw new WorkcoreError('CONFLICT', 'Record has changed', 409);
    this.sql.exec('DELETE FROM wc_records WHERE table_name = ? AND id = ?', name, key(id));
    this.changed.add(name);
  }
  kv = {
    get: (name: string): Json | null => {
      this.check();
      const row = this.sql.exec<{ value: string }>('SELECT value FROM wc_kv WHERE key = ?', key(name)).toArray()[0];
      return row ? JSON.parse(row.value) as Json : null;
    },
    set: (name: string, value: Json): void => {
      this.check(true);
      this.sql.exec('INSERT OR REPLACE INTO wc_kv (key, value) VALUES (?, ?)', key(name), encode(value, 262_144));
      this.changed.add('$kv');
    },
    delete: (name: string): void => {
      this.check(true);
      this.sql.exec('DELETE FROM wc_kv WHERE key = ?', key(name));
      this.changed.add('$kv');
    },
  };
}

export function getJson<T>(sql: Sql, table: 'wc_runs' | 'wc_schedules', id: string): T | null {
  const row = sql.exec<{ data: string }>(`SELECT data FROM ${table} WHERE id = ?`, id).toArray()[0];
  return row ? JSON.parse(row.data) as T : null;
}
export function saveRun(sql: Sql, run: Run): void {
  sql.exec('INSERT OR REPLACE INTO wc_runs (id, status, due, data) VALUES (?, ?, ?, ?)', run.id, run.status, run.due, encode(run, 786_432));
}
export function saveSchedule(sql: Sql, schedule: Schedule): void {
  sql.exec('INSERT OR REPLACE INTO wc_schedules (id, enabled, at, data) VALUES (?, ?, ?, ?)', schedule.id, Number(schedule.enabled), schedule.at, encode(schedule));
}
