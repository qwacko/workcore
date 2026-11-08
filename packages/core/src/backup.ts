import { getTableName } from 'drizzle-orm';
import type { SQLiteTable } from 'drizzle-orm/sqlite-core';
import { z } from 'zod';
import type { Definition, FileBucket } from './definitions.js';
import type { SqlValue, Storage } from './store.js';
import { encode, WorkcoreError } from './json.js';

const cell = z.union([z.string(), z.number().finite(), z.null(), z.object({ blob: z.string().regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/) }).strict()]);
export const backupSchema = z.object({
  format: z.literal(1), createdAt: z.number().int(), revision: z.number().int().nonnegative(),
  schema: z.string(),
  tables: z.array(z.object({ name: z.string(), columns: z.array(z.string()), rows: z.array(z.array(cell)) }).strict()),
  files: z.array(z.object({ key: z.string(), size: z.number().int().nonnegative() }).strict()),
}).strict();
export type WorkspaceBackup = z.infer<typeof backupSchema>;
const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;
function fail(message: string): never { throw new WorkcoreError('INVALID_BACKUP', message); }

function names(definition: Definition): string[] {
  return [...new Set(Object.values(definition.tables as Record<string, SQLiteTable>).map(table => getTableName(table)))].sort();
}
function signature(storage: Storage, definition: Definition): string {
  // Include migration content and physical schema. Never execute SQL from a backup.
  const schema = storage.sql.exec<{ name: string; sql: string }>("SELECT name, sql FROM sqlite_master WHERE type IN ('table', 'index', 'trigger') AND sql IS NOT NULL ORDER BY name").toArray();
  return JSON.stringify({ migrations: definition.migrations, schema });
}
function checkRestorable(storage: Storage, definition: Definition): void {
  const registered = new Set(names(definition));
  // Trigger replay and cascades outside the snapshot cannot be restored faithfully.
  if (storage.sql.exec("SELECT name FROM sqlite_master WHERE type = 'trigger' LIMIT 1").toArray().length) fail('SQL triggers require platform-level backup/restore');
  const tables = storage.sql.exec<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'").toArray();
  for (const table of tables) {
    if (registered.has(table.name)) continue;
    const references = storage.sql.exec<{ table: string }>(`PRAGMA foreign_key_list(${quote(table.name)})`).toArray();
    if (references.some(reference => registered.has(reference.table))) fail('An unregistered table references snapshot data; register it before backup');
  }
}
function revision(storage: Storage): number {
  return Number(storage.sql.exec<{ value: string }>("SELECT value FROM wc_meta WHERE key = 'revision'").toArray()[0]?.value ?? 0);
}
function pack(value: SqlValue): z.infer<typeof cell> {
  if (!(value instanceof ArrayBuffer)) return value;
  let binary = '';
  for (const byte of new Uint8Array(value)) binary += String.fromCharCode(byte);
  return { blob: btoa(binary) };
}
function unpack(value: z.infer<typeof cell>): SqlValue {
  if (value === null || typeof value !== 'object') return value;
  return Uint8Array.from(atob(value.blob), character => character.charCodeAt(0)).buffer;
}

/** Trusted operator API, deliberately NOT exposed over HTTP. Stop traffic and drain jobs first. */
export function exportWorkspace(storage: Storage, definition: Definition, options: { maintenance: true; maxBytes?: number }): WorkspaceBackup {
  if (options.maintenance !== true) fail('Maintenance mode must be acknowledged');
  return storage.transactionSync(() => {
    checkRestorable(storage, definition);
    if (storage.sql.exec("SELECT id FROM wc_runs WHERE status = 'running' LIMIT 1").toArray().length) fail('Drain running jobs before backup');
    const maxBytes = options.maxBytes ?? 16 * 1024 * 1024;
    let bytes = 0;
    const tables = names(definition).map(name => {
      const columns = storage.sql.exec<{ name: string }>(`PRAGMA table_info(${quote(name)})`).toArray().map(column => column.name);
      const rows: WorkspaceBackup['tables'][number]['rows'] = [];
      for (const row of storage.sql.exec(`SELECT * FROM ${quote(name)}`)) {
        const values = columns.map(column => pack(row[column]!));
        bytes += new TextEncoder().encode(encode(values, maxBytes)).length;
        if (bytes > maxBytes) throw new WorkcoreError('TOO_LARGE', 'Workspace exceeds the configured backup limit', 413);
        rows.push(values);
      }
      return { name, columns, rows };
    });
    const files: WorkspaceBackup['files'] = [];
    if (definition.files) {
      const table = tables.find(table => table.name === getTableName(definition.tables[definition.files!.table]!))!;
      for (const row of table.rows) {
        if (row[table.columns.indexOf('status')] !== 'ready') fail('Finish or clean pending/deleting files before backup');
        files.push({ key: `workcore/files/${row[table.columns.indexOf('id')]}`, size: Number(row[table.columns.indexOf('size')]) });
      }
    }
    const backup: WorkspaceBackup = { format: 1, createdAt: Date.now(), revision: revision(storage), schema: signature(storage, definition), tables, files };
    encode(backup, maxBytes);
    return backup;
  });
}

/** Copy bytes to a dedicated backup bucket. Publish/store the JSON manifest only AFTER this succeeds. */
export async function copyBackupFiles(backup: WorkspaceBackup, source: FileBucket, destination: FileBucket): Promise<void> {
  const parsed = backupSchema.parse(backup);
  for (const file of parsed.files) {
    if (!/^workcore\/files\/[a-f0-9-]{36}$/.test(file.key)) fail('Invalid file storage key');
    const object = await source.get(file.key);
    if (!object || object.size !== file.size) fail(`Missing or changed file: ${file.key}`);
    await destination.put(file.key, object.body);
    if ((await destination.head(file.key))?.size !== file.size) fail(`File copy failed verification: ${file.key}`);
  }
}

/** Restore into a maintenance workspace using the EXACT same definition/migrations.
 * Copy files to the target bucket first. Never point the restored workspace at a live source bucket.
 */
export function restoreWorkspace(storage: Storage, definition: Definition, input: unknown, options: { maintenance: true; confirm: 'replace-workspace'; expectedRevision: number; maxBytes?: number }): number {
  if (options.maintenance !== true || options.confirm !== 'replace-workspace') fail('Explicit replacement confirmation is required');
  encode(input, options.maxBytes ?? 16 * 1024 * 1024);
  const backup = backupSchema.parse(input);
  return storage.transactionSync(() => {
    checkRestorable(storage, definition);
    if (revision(storage) !== options.expectedRevision) throw new WorkcoreError('CONFLICT', 'Workspace changed since restore was prepared', 409);
    if (storage.sql.exec("SELECT id FROM wc_runs WHERE status = 'running' LIMIT 1").toArray().length) fail('Drain running jobs before restore');
    if (backup.schema !== signature(storage, definition)) fail('Schema/migrations differ; restore with the original application version first');
    const expected = names(definition);
    if (JSON.stringify(backup.tables.map(table => table.name).sort()) !== JSON.stringify(expected)) fail('Backup table set does not match');
    for (const table of backup.tables) {
      const columns = storage.sql.exec<{ name: string }>(`PRAGMA table_info(${quote(table.name)})`).toArray().map(column => column.name);
      if (JSON.stringify(columns) !== JSON.stringify(table.columns) || table.rows.some(row => row.length !== columns.length)) fail('Backup columns do not match');
    }
    // Deferred checks allow arbitrary FK dependency order; all rows still commit atomically.
    storage.sql.exec('PRAGMA defer_foreign_keys = ON');
    for (const name of expected) storage.sql.exec(`DELETE FROM ${quote(name)}`);
    for (const table of backup.tables) for (const row of table.rows) {
      storage.sql.exec(`INSERT INTO ${quote(table.name)} (${table.columns.map(quote).join(',')}) VALUES (${table.columns.map(() => '?').join(',')})`, ...row.map(unpack));
    }
    // Restoring data must never implicitly replay external effects or re-enable schedules.
    storage.sql.exec("UPDATE wc_runs SET status = 'interrupted', data = json_set(data, '$.status', 'interrupted', '$.error', 'Restored backup; inspect effects before retrying') WHERE status IN ('queued', 'running')");
    storage.sql.exec("UPDATE wc_schedules SET enabled = 0, data = json_set(data, '$.enabled', json('false'))");
    // Request IDs may refer to side effects in a different deployment; do not reuse them.
    storage.sql.exec('DELETE FROM wc_requests');
    const next = Math.max(options.expectedRevision, backup.revision) + 1;
    storage.sql.exec("INSERT OR REPLACE INTO wc_meta (key, value) VALUES ('revision', ?)", String(next));
    if (storage.sql.exec('PRAGMA foreign_key_check').toArray().length) fail('Restored data violates foreign keys');
    return next;
  });
}
