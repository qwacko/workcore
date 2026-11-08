import { env } from 'cloudflare:workers';
import { runInDurableObject } from 'cloudflare:test';
import { asc, eq, sql } from 'drizzle-orm';
import { blob, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { builtinTriggers, defineSchema, shouldRefreshView, workspace, WorkcoreError } from '../packages/core/src/index.js';
import { Engine } from '../packages/core/src/engine.js';
import type { MigrationBundle } from '../packages/core/src/index.js';
import { copyBackupFiles, exportWorkspace, restoreWorkspace } from '../packages/core/src/backup.js';
import type { WorkspaceBackup } from '../packages/core/src/backup.js';

const bindings = env as unknown as { TEST: DurableObjectNamespace };
const alice = { id: 'alice' };
const notes = sqliteTable('notes', {
  id: text('id').primaryKey(), title: text('title').notNull(), ownerId: text('owner_id').notNull(), done: integer('done', { mode: 'boolean' }).notNull().default(false),
});
const tables = defineSchema({ notes });
const initial: MigrationBundle = { journal: { entries: [{ idx: 0, when: 1, tag: '0000_initial', breakpoints: true }] }, migrations: { m0000: [
  'CREATE TABLE `wc_meta` (`key` text PRIMARY KEY NOT NULL, `value` text NOT NULL);',
  'CREATE TABLE `wc_kv` (`key` text PRIMARY KEY NOT NULL, `value` text NOT NULL);',
  'CREATE TABLE `wc_runs` (`id` text PRIMARY KEY NOT NULL, `status` text NOT NULL, `due` integer NOT NULL, `data` text NOT NULL);',
  'CREATE TABLE `wc_schedules` (`id` text PRIMARY KEY NOT NULL, `enabled` integer NOT NULL, `at` integer NOT NULL, `data` text NOT NULL);',
  'CREATE TABLE `wc_steps` (`run_id` text NOT NULL, `sequence` integer NOT NULL, `data` text NOT NULL, PRIMARY KEY(`run_id`, `sequence`));',
  'CREATE TABLE `wc_history` (`id` text PRIMARY KEY NOT NULL, `data` text NOT NULL);',
  'CREATE TABLE `wc_requests` (`id` text PRIMARY KEY NOT NULL, `fingerprint` text NOT NULL, `response` text NOT NULL);',
  'CREATE TABLE `notes` (`id` text PRIMARY KEY NOT NULL, `title` text NOT NULL, `owner_id` text NOT NULL, `done` integer DEFAULT false NOT NULL);',
].join('\n--> statement-breakpoint\n') } };
const app = workspace(tables, initial, { triggerKeys: ['notes', 'audit'] as const });
const add = app.mutation({
  input: z.object({ id: z.string(), title: z.string() }),
  output: z.string(),
  handler: ({ db, actor }, input) => { db.insert(notes).values({ ...input, ownerId: actor.id }).run(); return input.id; },
});
function definition(overrides: any = {}) {
  return app.define({
    views: { mine: app.view({ input: z.object({}), output: z.array(z.string()), dependsOn: ['notes'], maxRows: 2,
      handler: ({ db, actor }) => db.select({ title: notes.title }).from(notes).where(eq(notes.ownerId, actor.id)).orderBy(asc(notes.id)).all().map(row => row.title) }) },
    queries: {}, mutations: { add }, jobs: {}, authorize: ({ actor }) => actor.id === 'alice', ...overrides,
  });
}
async function withEngine(callback: (engine: Engine, state: DurableObjectState) => Promise<void> | void, appDefinition = definition()) {
  const stub = bindings.TEST.get(bindings.TEST.idFromName(crypto.randomUUID()));
  await runInDurableObject(stub, async (_instance, state) => {
    const engine = new Engine(state.storage, appDefinition, {});
    await callback(engine, state);
  });
}

describe('Drizzle workspace storage', () => {
  it('guards raw SQL, CTE writes, relational reads, and retained database sessions', async () => {
    let escaped: (() => unknown) | undefined;
    const raw = app.query({ input: z.object({}), output: z.null(), handler: ({ db }) => {
      expect(() => db.get(sql`INSERT INTO wc_kv (key, value) VALUES ('raw', 'true') RETURNING key`)).toThrow();
      expect(() => db.all(sql`WITH a AS (SELECT 1) INSERT INTO wc_kv (key, value) VALUES ('cte', 'true') RETURNING key`)).toThrow();
      expect(() => db.get(sql`CREATE TABLE escaped (id text)`)).toThrow();
      expect(() => db.all(sql`SELECT 1; DELETE FROM notes;`)).toThrow();
      expect(db.get(sql`SELECT 'a;b' AS value;`)).toEqual({ value: 'a;b' });
      expect(db.get(sql`WITH a AS (SELECT 1 AS n) SELECT n FROM a`)).toEqual({ n: 1 });
      const query = db.query.notes.findMany();
      expect(query.sync()).toEqual([]);
      escaped = () => query.sync();
      return null;
    } });
    await withEngine((engine, state) => {
      const revision = engine.revision;
      engine.query(alice, 'raw', {});
      expect(engine.revision).toBe(revision);
      expect(state.storage.sql.exec('SELECT * FROM wc_kv').toArray()).toEqual([]);
      expect(escaped).toThrow();
    }, definition({ queries: { raw } }));
  });

  it('does not give authorization callbacks a writable context during mutations', async () => {
    await withEngine((engine, state) => {
      expect(() => engine.mutate(alice, 'add', { id: 'x', title: 'No' }, 'one')).toThrow();
      expect(state.storage.sql.exec('SELECT * FROM notes').toArray()).toEqual([]);
    }, definition({ authorize: ({ db }: any) => { db.insert(notes).values({ id: 'bad', title: 'No', ownerId: 'alice' }).run(); return true; } }));
  });

  it('returns retry lineage, filters failed runs, and reports bounded health', async () => {
    const broken = app.task({ input: z.object({}), output: z.null(), handler: async () => { throw new WorkcoreError('EXPECTED', 'Expected'); } });
    await withEngine(async engine => {
      const first = engine.enqueue(alice, 'broken', {}, 'one').data as string;
      await engine.executeNext();
      expect(engine.system(alice, 'runs.list', { status: 'failed' })).toMatchObject({ rows: [{ id: first }] });
      expect(engine.system(alice, 'runs.list', { status: 'queued' })).toMatchObject({ rows: [] });
      const retry = engine.system(alice, 'runs.retry', { runId: first }) as { runId: string };
      expect(retry.runId).not.toBe(first);
      expect(engine.inspect(alice, `run:${retry.runId}`)).toMatchObject({ retryOf: first, actor: alice, status: 'queued' });
      expect(engine.system(alice, 'health.inspect', {})).toMatchObject({ runs: { failed: 1, queued: 1 }, migration: 1, files: {} });
      expect(() => engine.system({ id: 'bob' }, 'health.inspect', {})).toThrow('Access denied');
    }, definition({ jobs: { broken } }));
  });

  it('expires timed-out task tools without retrying uncertain external effects', async () => {
    let signal: AbortSignal | undefined;
    let late: (() => unknown) | undefined;
    const slow = app.task({ input: z.object({}), output: z.null(), timeoutMs: 10, maxAttempts: 3, handler: async ctx => {
      signal = ctx.signal;
      late = () => ctx.mutate(add, { id: 'late', title: 'No' });
      await new Promise(resolve => ctx.signal.addEventListener('abort', resolve, { once: true }));
      return null;
    } });
    await withEngine(async engine => {
      const id = engine.enqueue(alice, 'slow', {}, 'one').data as string;
      await engine.executeNext();
      expect(signal?.aborted).toBe(true);
      expect(engine.inspect(alice, `run:${id}`)).toMatchObject({ status: 'interrupted', error: 'RUN_TIMEOUT', attempt: 1 });
      expect(late).toThrow('no longer active');
      expect(engine.nextDue()).toBeNull();
    }, definition({ jobs: { slow } }));
  });

  it('exports/restores atomic data, rejects mismatches, and never replays jobs/schedules', async () => {
    const noop = app.task({ input: z.object({}), output: z.null(), handler: async () => null });
    const schedule = app.mutation({ input: z.object({}), output: z.string(), handler: ctx => ctx.schedule(noop, {}, { at: ctx.now + 1000 }) });
    const def = definition({ jobs: { noop }, mutations: { add, schedule } });
    await withEngine((engine, state) => {
      engine.mutate(alice, 'add', { id: 'a', title: 'Before' }, 'add');
      const id = engine.enqueue(alice, 'noop', {}, 'job').data as string;
      const scheduleId = engine.mutate(alice, 'schedule', {}, 'schedule').data as string;
      const backup = exportWorkspace(state.storage, def, { maintenance: true });
      state.storage.sql.exec("UPDATE notes SET title = 'After'");
      const current = engine.revision;
      expect(() => restoreWorkspace(state.storage, def, backup, { maintenance: true, confirm: 'replace-workspace', expectedRevision: current - 1 })).toThrow('changed');
      expect(() => restoreWorkspace(state.storage, def, { ...backup, schema: 'wrong' }, { maintenance: true, confirm: 'replace-workspace', expectedRevision: current })).toThrow('Schema');
      const malformed = structuredClone(backup);
      malformed.tables.find(table => table.name === 'notes')!.rows.push(['a', 'Duplicate', 'alice', 0]);
      expect(() => restoreWorkspace(state.storage, def, malformed, { maintenance: true, confirm: 'replace-workspace', expectedRevision: current })).toThrow();
      expect(engine.query(alice, 'mine', {}).data).toEqual(['After']);
      expect(restoreWorkspace(state.storage, def, JSON.parse(JSON.stringify(backup)), { maintenance: true, confirm: 'replace-workspace', expectedRevision: current })).toBeGreaterThan(current);
      expect(engine.query(alice, 'mine', {}).data).toEqual(['Before']);
      expect(engine.inspect(alice, `run:${id}`)).toMatchObject({ status: 'interrupted' });
      expect(engine.inspect(alice, `schedule:${scheduleId}`)).toMatchObject({ enabled: false });
      expect(state.storage.sql.exec('SELECT * FROM wc_requests').toArray()).toEqual([]);
    }, def);
  });

  it('copies and size-verifies file bytes in both backup and restore directions', async () => {
    const binding = env as unknown as { FILES_BUCKET: R2Bucket };
    const key = `workcore/files/${crypto.randomUUID()}`;
    await binding.FILES_BUCKET.put(key, 'backup bytes');
    const objects = new Map<string, Uint8Array>();
    const archive = {
      async put(key: string, body: any) { objects.set(key, new Uint8Array(await new Response(body).arrayBuffer())); },
      async head(key: string) { return objects.has(key) ? { size: objects.get(key)!.length } : null; },
      async get(key: string) { const bytes = objects.get(key); return bytes ? { size: bytes.length, body: new Blob([Uint8Array.from(bytes).buffer]).stream() } : null; },
      async delete(key: string) { objects.delete(key); },
    };
    const backup = { format: 1 as const, createdAt: Date.now(), revision: 1, schema: '', tables: [], files: [{ key, size: 12 }] };
    await copyBackupFiles(backup, binding.FILES_BUCKET, archive);
    await binding.FILES_BUCKET.delete(key);
    await copyBackupFiles(backup, archive, binding.FILES_BUCKET);
    expect(await (await binding.FILES_BUCKET.get(key))!.text()).toBe('backup bytes');
    await expect(copyBackupFiles({ ...backup, files: [{ key, size: 13 }] }, archive, binding.FILES_BUCKET)).rejects.toThrow('Missing or changed');
  });

  it('round-trips binary values and foreign keys, and rolls back corrupt foreign-key restores', async () => {
    const attachments = sqliteTable('attachments', { id: text('id').primaryKey(), noteId: text('note_id').notNull().references(() => notes.id), bytes: blob('bytes').notNull() });
    const bundle = { journal: { entries: [...initial.journal.entries, { idx: 1, when: 2, tag: 'attachments', breakpoints: true }] }, migrations: { ...initial.migrations, m0001: 'CREATE TABLE attachments (id text PRIMARY KEY NOT NULL, note_id text NOT NULL REFERENCES notes(id), bytes blob NOT NULL);' } };
    const def = definition({ tables: defineSchema({ notes, attachments }), migrations: bundle });
    await withEngine((engine, state) => {
      engine.mutate(alice, 'add', { id: 'parent', title: 'Parent' }, 'one');
      state.storage.sql.exec('INSERT INTO attachments (id, note_id, bytes) VALUES (?, ?, ?)', 'a', 'parent', Uint8Array.from([0, 255, 1, 127]).buffer);
      const backup = JSON.parse(JSON.stringify(exportWorkspace(state.storage, def, { maintenance: true })));
      const options = { maintenance: true as const, confirm: 'replace-workspace' as const, expectedRevision: engine.revision };
      restoreWorkspace(state.storage, def, backup, options);
      const row = state.storage.sql.exec<{ bytes: ArrayBuffer }>('SELECT bytes FROM attachments').toArray()[0]!;
      expect([...new Uint8Array(row.bytes)]).toEqual([0, 255, 1, 127]);
      const corrupted = structuredClone(backup);
      const table = corrupted.tables.find((table: any) => table.name === 'attachments');
      table.rows[0][table.columns.indexOf('note_id')] = 'missing';
      expect(() => restoreWorkspace(state.storage, def, corrupted, { ...options, expectedRevision: engine.revision })).toThrow();
      expect(state.storage.sql.exec('SELECT note_id FROM attachments').toArray()).toEqual([{ note_id: 'parent' }]);
      expect(() => exportWorkspace(state.storage, def, { maintenance: true, maxBytes: 10 })).toThrow();
    }, def);
  });

  it('rejects backup schemas whose trigger effects or unregistered dependents cannot be restored faithfully', async () => {
    await withEngine((_engine, state) => {
      state.storage.sql.exec('CREATE TABLE legacy (note_id text REFERENCES notes(id) ON DELETE CASCADE)');
      expect(() => exportWorkspace(state.storage, definition(), { maintenance: true })).toThrow('unregistered');
      state.storage.sql.exec('DROP TABLE legacy');
      state.storage.sql.exec("CREATE TRIGGER audit_note AFTER INSERT ON notes BEGIN INSERT INTO wc_kv (key, value) VALUES (new.id, 'true'); END");
      expect(() => exportWorkspace(state.storage, definition(), { maintenance: true })).toThrow('triggers');
    });
  });

  it('restores a serialized snapshot into a separately initialized workspace', async () => {
    let backup: WorkspaceBackup;
    await withEngine((engine, state) => {
      engine.mutate(alice, 'add', { id: 'source', title: 'Source record' }, 'one');
      state.storage.sql.exec('INSERT INTO wc_kv (key, value) VALUES (?, ?)', 'private-setting', '{"enabled":true}');
      backup = JSON.parse(JSON.stringify(exportWorkspace(state.storage, definition(), { maintenance: true })));
    });
    await withEngine((engine, state) => {
      engine.mutate(alice, 'add', { id: 'target', title: 'Replaced record' }, 'two');
      const next = restoreWorkspace(state.storage, definition(), backup!, { maintenance: true, confirm: 'replace-workspace', expectedRevision: engine.revision });
      expect(engine.revision).toBe(next);
      expect(engine.query(alice, 'mine', {}).data).toEqual(['Source record']);
      expect(state.storage.sql.exec('SELECT value FROM wc_kv WHERE key = ?', 'private-setting').toArray()).toEqual([{ value: '{"enabled":true}' }]);
      expect(() => engine.query({ id: 'bob' }, 'mine', {})).toThrow('Access denied');
    });
  });
  it('matches wildcard, empty, and keyed view dependencies', () => {
    const changed = new Set(['notes', builtinTriggers.history]);
    expect(shouldRefreshView(undefined, changed)).toBe(true);
    expect(shouldRefreshView([], changed)).toBe(false);
    expect(shouldRefreshView(['audit'], changed)).toBe(false);
    expect(shouldRefreshView(['notes', 'audit'], changed)).toBe(true);
    expect(shouldRefreshView(['*'], changed)).toBe(true);
    expect(shouldRefreshView(['audit'], new Set(['*']))).toBe(true);
  });

  it('rejects application schema names that collide with framework SQL tables', () => {
    const collision = sqliteTable('wc_meta', { id: text('id').primaryKey() });
    expect(() => defineSchema({ collision })).toThrow('conflicts with Workcore internal table');
  });

  it('runs bundled migrations, performs typed SQL writes, and invalidates dependent views', async () => {
    await withEngine(engine => {
      expect(engine.mutate(alice, 'add', { id: 'a', title: 'First' }, 'one').data).toBe('a');
      expect(engine.query(alice, 'mine', {}).data).toEqual(['First']);
      expect(engine.inspect(alice, 'table:notes')).toMatchObject({ rows: [{ id: 'a', title: 'First', owner_id: 'alice' }] });
      expect(engine.inspect(alice, 'tables')).toHaveProperty('notes.columns');
      expect(engine.inspect(alice, 'tables')).not.toHaveProperty('wc_runs');
    });
  });

  it('publishes static and dynamic triggers only after a successful mutation commit', async () => {
    const selective = app.mutation({
      input: z.object({ id: z.string(), title: z.string() }), output: z.string(), triggers: ['notes'],
      handler: ({ db, trigger, actor }, input) => {
        db.insert(notes).values({ ...input, ownerId: actor.id }).run();
        trigger('audit');
        return input.id;
      },
    });
    const conditional = app.mutation({
      input: z.object({}), output: z.null(), triggers: [],
      handler: ({ trigger }) => { trigger('notes'); return null; },
    });
    let escapedTrigger: ((key: 'notes' | 'audit') => void) | undefined;
    const capture = app.mutation({
      input: z.object({}), output: z.null(), triggers: [],
      handler: ({ trigger }) => { escapedTrigger = trigger; return null; },
    });

    await withEngine(engine => {
      const commits: Set<string>[] = [];
      engine.onCommit = commit => commits.push(commit.changed);
      engine.mutate(alice, 'add', { id: 'default', title: 'Wildcard' }, 'wildcard');
      expect(commits[0]).toContain('*'); // omitted triggers preserve the safe default

      engine.mutate(alice, 'selective', { id: 'selective', title: 'Selective' }, 'selective');
      expect(commits[1]).toEqual(new Set(['notes', 'audit', builtinTriggers.history]));
      expect(shouldRefreshView(['notes'], commits[1]!)).toBe(true);
      expect(shouldRefreshView(['audit'], commits[1]!)).toBe(true);
      expect(shouldRefreshView(['other'], commits[1]!)).toBe(false);

      engine.mutate(alice, 'conditional', {}, 'conditional');
      expect(commits[2]).toEqual(new Set(['notes', builtinTriggers.history]));
      engine.mutate(alice, 'capture', {}, 'capture-trigger');
      expect(() => escapedTrigger?.('notes')).toThrow('no longer active');
    }, definition({ mutations: { add, selective, conditional, capture } }));
  });

  it('emits framework keys for KV writes, enqueues, and scheduled dispatch', async () => {
    const noop = app.task({ input: z.object({}), output: z.null(), handler: async () => null });
    const setValue = app.mutation({
      input: z.object({}), output: z.null(), triggers: [],
      handler: ({ kv }) => { kv.set('example', 'value'); return null; },
    });
    const addSchedule = app.mutation({
      input: z.object({}), output: z.string(), triggers: [],
      handler: ({ schedule, now }) => schedule(noop, {}, { at: now }),
    });
    await withEngine(engine => {
      const commits: Set<string>[] = [];
      engine.onCommit = commit => commits.push(commit.changed);
      engine.mutate(alice, 'setValue', {}, 'set-value');
      expect(commits[0]).toContain(builtinTriggers.kv);

      const scheduleId = engine.mutate(alice, 'addSchedule', {}, 'add-schedule').data as string;
      expect(commits[1]).toContain(builtinTriggers.schedules);
      engine.dispatchSchedules(Date.now() + 10);
      expect(commits[2]).toContain(builtinTriggers.runs);
      expect(commits[2]).toContain(builtinTriggers.schedules);
      expect(engine.inspect(alice, `schedule:${scheduleId}`)).toMatchObject({ enabled: false });
    }, definition({ mutations: { add, setValue, addSchedule }, jobs: { noop } }));
  });

  it('rejects runtime trigger keys outside the workspace registry and rolls back the mutation', async () => {
    const invalid = app.mutation({
      input: z.object({}), output: z.null(), triggers: [],
      handler: ({ db, trigger }) => {
        db.insert(notes).values({ id: 'invalid-trigger', title: 'No commit', ownerId: 'alice' }).run();
        trigger('undeclared' as any);
        return null;
      },
    });
    await withEngine((engine, state) => {
      const commits: unknown[] = [];
      engine.onCommit = commit => commits.push(commit);
      expect(() => engine.mutate(alice, 'invalid', {}, 'invalid-trigger')).toThrow('Unknown trigger key undeclared');
      expect(state.storage.sql.exec('SELECT id FROM notes WHERE id = ?', 'invalid-trigger').toArray()).toHaveLength(0);
      expect(commits).toEqual([]);
    }, definition({ mutations: { add, invalid } }));
  });

  it('keeps mutation writes, KV, queue state, and revisions atomic on validation failure', async () => {
    const broken = app.mutation({
      input: z.object({}), output: z.string(),
      handler: ({ db, kv }) => { db.insert(notes).values({ id: 'rollback', title: 'No', ownerId: 'alice' }).run(); kv.set('rollback', true); return 42 as any; },
    });
    await withEngine((engine, state) => {
      const revision = engine.revision;
      const commits: unknown[] = [];
      engine.onCommit = commit => commits.push(commit);
      expect(() => engine.mutate(alice, 'broken', {}, 'broken')).toThrow();
      expect(state.storage.sql.exec('SELECT * FROM notes').toArray()).toHaveLength(0);
      expect(state.storage.sql.exec('SELECT * FROM wc_kv').toArray()).toHaveLength(0);
      expect(engine.revision).toBe(revision);
      expect(commits).toEqual([]);
    }, definition({ mutations: { broken } }));
  });

  it('blocks writes from query contexts and expires captured Drizzle query builders', async () => {
    let escaped: (() => unknown) | undefined;
    const capture = app.mutation({ input: z.object({}), output: z.null(), handler: ({ db }) => { const builder = db.select().from(notes); escaped = () => builder.all(); return null; } });
    const illegal = app.query({ input: z.object({}), output: z.null(), handler: ({ db }) => { (db as any).insert(notes).values({ id: 'bad', title: 'No', ownerId: 'alice' }).run(); return null; } });
    await withEngine(engine => {
      expect(() => engine.query(alice, 'illegal', {})).toThrow('Reads cannot change state');
      engine.mutate(alice, 'capture', {}, 'capture');
      expect(escaped).toBeDefined();
      expect(escaped).toThrow('no longer active');
    }, definition({ mutations: { capture }, queries: { illegal } }));
  });

  it('deduplicates writes and rejects stale request IDs', async () => {
    await withEngine(engine => {
      const first = engine.mutate(alice, 'add', { id: 'a', title: 'First' }, 'request');
      expect(engine.mutate(alice, 'add', { id: 'a', title: 'First' }, 'request')).toEqual(first);
      expect(() => engine.mutate(alice, 'add', { id: 'a', title: 'Other' }, 'request')).toThrow('different operation');
      expect(engine.query(alice, 'mine', {}).data).toEqual(['First']);
    });
  });

  it('supports later ingested SQL migrations and rolls back a failed migration', async () => {
    await withEngine((engine, state) => {
      engine.mutate(alice, 'add', { id: 'a', title: 'First' }, 'one');
      const nextMigrations: MigrationBundle = { journal: { entries: [...initial.journal.entries, { idx: 1, when: 2, tag: '0001_add_flag', breakpoints: true }] }, migrations: { ...initial.migrations, m0001: 'ALTER TABLE notes ADD COLUMN archived integer NOT NULL DEFAULT 0;' } };
      new Engine(state.storage, app.define({ ...definition(), migrations: nextMigrations } as any), {});
      expect(state.storage.sql.exec('SELECT archived FROM notes WHERE id = ?', 'a').one().archived).toBe(0);
      const bad: MigrationBundle = { journal: { entries: [...nextMigrations.journal.entries, { idx: 2, when: 3, tag: '0002_bad', breakpoints: true }] }, migrations: { ...nextMigrations.migrations, m0002: 'ALTER TABLE missing_table ADD COLUMN fail INTEGER;' } };
      expect(() => new Engine(state.storage, app.define({ ...definition(), migrations: bad } as any), {})).toThrow();
      expect(state.storage.sql.exec('PRAGMA table_info(notes)').toArray().map((column: any) => column.name)).not.toContain('fail');
    });
  });

  it('enforces query authorization and uses ordinary SQLite constraints', async () => {
    await withEngine(engine => {
      expect(() => engine.query({ id: 'bob' }, 'mine', {})).toThrow('Access denied');
      expect(() => engine.mutate(alice, 'add', { id: 'duplicate', title: 'One' }, 'first')).not.toThrow();
      expect(() => engine.mutate(alice, 'add', { id: 'duplicate', title: 'Two' }, 'second')).toThrow();
    });
  });
});
