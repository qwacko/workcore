import { drizzle } from 'drizzle-orm/durable-sqlite';
import type { DrizzleSqliteDODatabase } from 'drizzle-orm/durable-sqlite';
import type { Tables, MigrationBundle, Json } from './definitions.js';
import { encode, WorkcoreError } from './json.js';
import { builtinTriggers } from './triggers.js';

export type SqlValue = string | number | null | ArrayBuffer;
export interface Sql {
  exec<T extends Record<string, SqlValue>>(query: string, ...bindings: SqlValue[]): Iterable<T> & { toArray(): T[] };
}
export type Storage = { sql: Sql; transactionSync<T>(callback: () => T): T };
export type Run = {
  id: string; job: string; kind: 'task' | 'agent'; actor: { id: string }; input: Json;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'interrupted' | 'cancelled';
  attempt: number; due: number; createdAt: number; updatedAt: number; result?: Json; error?: string;
  cancelRequested?: boolean; scheduleId?: string; progress?: Json; retryOf?: string;
};
export type Schedule = {
  id: string; job: string; actor: { id: string }; input: Json; at: number; everyMs?: number;
  enabled: boolean; createdAt: number; lastError?: string; lastRunId?: string;
};

/** Apply Kit-ingested SQL migrations synchronously before any workspace request. */
export function applyMigrations(storage: Storage, bundle: MigrationBundle): void {
  storage.sql.exec('CREATE TABLE IF NOT EXISTS __drizzle_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, hash TEXT NOT NULL, created_at INTEGER NOT NULL)');
  for (const entry of bundle.journal.entries) {
    const migration = bundle.migrations[`m${entry.idx.toString().padStart(4, '0')}`];
    if (typeof migration !== 'string') throw new Error(`Missing bundled database migration: ${entry.tag}`);
    const applied = storage.sql.exec<{ created_at: number }>('SELECT created_at FROM __drizzle_migrations ORDER BY created_at DESC LIMIT 1').toArray()[0]?.created_at;
    if (applied !== undefined && applied >= entry.when) continue;
    const statements = migration.split('--> statement-breakpoint').map(sql => sql.trim()).filter(Boolean);
    storage.transactionSync(() => {
      for (const statement of statements) storage.sql.exec(statement);
      storage.sql.exec('INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)', '', entry.when);
    });
  }
}

/** A transaction-scoped Drizzle capability; query builders expire with their operation. */
export class Store<S extends Tables = Tables> {
  readonly changed = new Set<string>();
  readonly db: DrizzleSqliteDODatabase<S>;
  readonly kv = {
    get: (key: string): Json | null => {
      this.check();
      const row = this.storage.sql.exec<{ value: string }>('SELECT value FROM wc_kv WHERE key = ?', key).toArray()[0];
      return row ? JSON.parse(row.value) as Json : null;
    },
    set: (key: string, value: Json): void => {
      this.check(true); this.storage.sql.exec('INSERT OR REPLACE INTO wc_kv (key, value) VALUES (?, ?)', key, encode(value, 262_144)); this.changed.add(builtinTriggers.kv);
    },
    delete: (key: string): void => { this.check(true); this.storage.sql.exec('DELETE FROM wc_kv WHERE key = ?', key); this.changed.add(builtinTriggers.kv); },
  };
  private active = true;
  constructor(private storage: Storage, schema: S, readonly revision: number, private writable: boolean) {
    // Guard execution too: raw SQL, relational queries and retained sessions must
    // obey the same lifetime/read-only rules as ordinary query builders.
    const sql = { exec: (query: string, ...bindings: SqlValue[]) => {
      this.check();
      if (this.writable) return storage.sql.exec(query, ...bindings);
      const statement = query.replace(/'(?:''|[^'])*'|"(?:""|[^"])*"|`(?:``|[^`])*`|\[[^\]]*\]|--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\//g, token => token.startsWith('--') || token.startsWith('/*') ? ' ' : ' literal ').trim();
      if (!/^(?:select|with|explain)\b/i.test(statement) || /;\s*\S/.test(statement)) throw new WorkcoreError('READ_ONLY', 'Reads require a single read-only SQL statement');
      return storage.transactionSync(() => {
        const cursor = storage.sql.exec(query, ...bindings) as ReturnType<Sql['exec']> & { rowsWritten: number; raw(): { toArray(): SqlValue[][] }; columnNames: string[] };
        const columns = cursor.columnNames;
        const rows = cursor.raw().toArray();
        if (cursor.rowsWritten !== 0) throw new WorkcoreError('READ_ONLY', 'Reads cannot change state');
        const records = rows.map(row => Object.fromEntries(columns.map((column, index) => [column, row[index]])));
        const iterator = records[Symbol.iterator]();
        return Object.assign(iterator, { toArray: () => records, raw: () => ({ toArray: () => rows }) });
      });
    } };
    const raw = drizzle({ sql, transactionSync: (callback: () => unknown) => { this.check(true); return storage.transactionSync(callback); } } as any, { schema, logger: false }) as DrizzleSqliteDODatabase<S>;
    this.db = this.guard(raw) as DrizzleSqliteDODatabase<S>;
  }
  close(): void { this.active = false; }
  assertWritable(): void { this.check(true); }
  private check(write = false): void {
    if (!this.active) throw new WorkcoreError('EXPIRED_CONTEXT', 'Database context is no longer active');
    if (write && !this.writable) throw new WorkcoreError('READ_ONLY', 'Reads cannot change state');
  }
  private guard<T extends object>(target: T, writeQuery = false): T {
    const store = this;
    return new Proxy(target, {
      get(object, property) {
        if (property === '$client') return undefined;
        const value = Reflect.get(object, property, object);
        if (typeof value !== 'function') return value;
        return (...args: unknown[]) => {
          const method = String(property);
          const startsWrite = ['insert', 'update', 'delete'].includes(method);
          store.check(writeQuery || startsWrite || ['run', 'execute', 'transaction', 'rollback'].includes(method));
          const result = Reflect.apply(value, object, args);
          return result && typeof result === 'object' && !Array.isArray(result) && Object.getPrototypeOf(result) !== Object.prototype
            ? store.guard(result, writeQuery || startsWrite)
            : result;
        };
      },
    });
  }
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
