import { env } from 'cloudflare:workers';
import { runInDurableObject } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { table, workspace, WorkcoreError } from '../packages/core/src/index.js';
import { Engine } from '../packages/core/src/engine.js';
import { encode } from '../packages/core/src/json.js';
import type { Definition } from '../packages/core/src/index.js';
import type { Run } from '../packages/core/src/store.js';

const bindings = env as unknown as { TEST: DurableObjectNamespace };
const alice = { id: 'alice' };
const tables = { notes: table(z.object({ title: z.string(), ownerId: z.string() }), { indexes: { owner: 'ownerId' } }) };
const app = workspace(tables);
const empty = z.object({});
const add = app.mutation({
  input: z.object({ id: z.string(), title: z.string() }), output: z.string(),
  handler: ({ db, actor }, input) => { db.put('notes', input.id, { title: input.title, ownerId: actor.id }); return input.id; },
});
function definition(overrides: Partial<Definition> = {}): Definition {
  return app.define({
    views: {
      mine: app.view({ input: empty, output: z.array(z.string()), dependsOn: ['notes'], maxRows: 2, handler: ({ db, actor }) => db.page('notes', { index: { name: 'owner', value: actor.id } }).rows.map(row => row.data.title) }),
    },
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

describe('workspace storage and execution', () => {
  it('persists JSON rows, indexed pages and complete live views', async () => {
    await withEngine(engine => {
      engine.mutate(alice, 'add', { id: 'a', title: 'First' }, 'one');
      engine.mutate(alice, 'add', { id: 'b', title: 'Second' }, 'two');
      expect(engine.query(alice, 'mine', {})).toEqual({ data: ['First', 'Second'], revision: 3 });
      engine.mutate(alice, 'add', { id: 'c', title: 'Third' }, 'three');
      expect(() => engine.query(alice, 'mine', {}, true)).toThrow('Narrow the view');
      expect(engine.inspect(alice, 'table:notes')).toMatchObject({ rows: expect.arrayContaining([expect.objectContaining({ id: 'a', schemaVersion: 1, revision: 2 })]) });
    });
  });
  it('deduplicates writes and rejects reusing request IDs for different inputs', async () => {
    await withEngine(engine => {
      const first = engine.mutate(alice, 'add', { id: 'a', title: 'First' }, 'request');
      expect(engine.mutate(alice, 'add', { id: 'a', title: 'First' }, 'request')).toEqual(first);
      expect(() => engine.mutate(alice, 'add', { id: 'a', title: 'Other' }, 'request')).toThrow('different operation');
      expect(engine.query(alice, 'mine', {}).data).toEqual(['First']);
    });
  });
  it('rolls back records, KV, schedules and queue entries together on invalid output', async () => {
    const job = app.task({ input: empty, output: z.null(), handler: async () => null });
    const broken = app.mutation({
      input: empty, output: z.string(),
      handler: ctx => {
        ctx.db.put('notes', 'rollback', { title: 'No', ownerId: 'alice' });
        ctx.db.kv.set('rollback', true);
        ctx.enqueue(job, {});
        ctx.schedule(job, {}, { at: Date.now() });
        return 42 as unknown as string;
      },
    });
    await withEngine((engine, state) => {
      const prior = engine.revision;
      expect(() => engine.mutate(alice, 'broken', {}, 'request')).toThrow();
      for (const name of ['wc_records', 'wc_kv', 'wc_runs', 'wc_schedules']) {
        expect(state.storage.sql.exec(`SELECT * FROM ${name}`).toArray()).toHaveLength(0);
      }
      expect(engine.revision).toBe(prior);
    }, definition({ mutations: { broken }, jobs: { job } }));
  });
  it('enforces readonly queries, synchronous mutations and expired contexts', async () => {
    let escaped: (() => void) | undefined;
    const capture = app.mutation({ input: empty, output: z.null(), handler: ({ db }) => { escaped = () => db.kv.set('late', true); return null; } });
    const illegal = app.query({ input: empty, output: z.null(), handler: ({ db }) => { (db as any).kv.set('bad', true); return null; } });
    const asyncWrite = app.mutation({ input: empty, output: z.null(), handler: (async () => null) as any });
    await withEngine(engine => {
      engine.mutate(alice, 'capture', {}, 'capture');
      expect(escaped).toBeDefined();
      expect(escaped).toThrow('no longer active');
      expect(() => engine.query(alice, 'illegal', {})).toThrow('Reads cannot');
      expect(() => engine.mutate(alice, 'asyncWrite', {}, 'async')).toThrow('synchronous');
    }, definition({ mutations: { capture, asyncWrite }, queries: { illegal } }));
  });
  it('rejects stale record edits and unauthorised execution', async () => {
    const edit = app.mutation({
      input: z.object({ revision: z.number() }), output: z.null(),
      handler: ({ db }, input) => { db.put('notes', 'a', { title: 'Changed', ownerId: 'alice' }, { expectedRevision: input.revision }); return null; },
    });
    await withEngine(engine => {
      const result = engine.mutate(alice, 'add', { id: 'a', title: 'First' }, 'one');
      engine.mutate(alice, 'edit', { revision: result.revision }, 'two');
      expect(() => engine.mutate(alice, 'edit', { revision: result.revision }, 'three')).toThrow('Record has changed');
      expect(() => engine.mutate({ id: 'bob' }, 'add', { id: 'b', title: 'No' }, 'bob')).toThrow('Access denied');
    }, definition({ mutations: { add, edit } }));
  });
  it('migrates all JSON rows transactionally and refuses downgrade', async () => {
    await withEngine((engine, state) => {
      engine.mutate(alice, 'add', { id: 'a', title: 'First' }, 'one');
      const updated = definition({ tables: {
        notes: table(z.object({ title: z.string(), ownerId: z.string(), done: z.boolean() }), {
          version: 2, migrations: { 2: data => ({ ...(data as Record<string, any>), done: false }) },
        }),
      } });
      const next = new Engine(state.storage, updated, {});
      expect(next.inspect(alice, 'table:notes')).toMatchObject({ rows: [{ schemaVersion: 2, data: { done: false } }] });
      expect(() => new Engine(state.storage, definition(), {})).toThrow('downgrade');
    });
  });
  it('rolls back a failed schema migration', async () => {
    await withEngine((engine, state) => {
      engine.mutate(alice, 'add', { id: 'a', title: 'First' }, 'one');
      expect(() => new Engine(state.storage, definition({ tables: {
        notes: table(z.object({ count: z.number() }), { version: 2, migrations: { 2: () => ({ count: 'wrong' }) } }),
      } }), {})).toThrow();
      expect(engine.inspect(alice, 'table:notes')).toMatchObject({ rows: [{ schemaVersion: 1, data: { title: 'First' } }] });
    });
  });
  it('enforces agent tool allowlists and persists steps and outcomes', async () => {
    const agent = app.agent({ input: empty, output: z.string(), tools: [add], handler: async ctx => {
      const result = await ctx.step('Local planning', async () => 'planned');
      ctx.mutate(add, { id: 'agent', title: result });
      return result;
    } });
    const denied = app.agent({ input: empty, output: z.string(), tools: [], handler: async ctx => ctx.mutate(add, { id: 'denied', title: 'No' }) });
    await withEngine(async engine => {
      const run = engine.enqueue(alice, 'agent', {}, 'agent');
      expect(await engine.executeNext()).toBe(true);
      expect(engine.trace(alice, run.data as string)).toMatchObject({ rows: [expect.objectContaining({ status: 'completed', result: 'planned' }), expect.objectContaining({ kind: 'tool', operation: 'mutation:add' })] });
      engine.enqueue(alice, 'denied', {}, 'denied');
      await engine.executeNext();
      expect(engine.query(alice, 'mine', {}).data).toEqual(['planned']);
      expect(engine.inspect(alice, 'runs')).toMatchObject({ rows: expect.arrayContaining([expect.objectContaining({ job: 'denied', status: 'failed', error: 'TOOL_DENIED' })]) });
    }, definition({ jobs: { agent, denied } }));
  });
  it('persists bounded task retries but does not replay interrupted runs on startup', async () => {
    const job = app.task({ input: empty, output: z.null(), maxAttempts: 2, handler: async () => { throw new WorkcoreError('EXTERNAL_FAILURE', 'Failed'); } });
    await withEngine(async (engine, state) => {
      const result = engine.enqueue(alice, 'job', {}, 'retry');
      await engine.executeNext();
      const row = state.storage.sql.exec<{ data: string }>('SELECT data FROM wc_runs WHERE id = ?', result.data as string).one();
      const run = JSON.parse(row.data) as Run;
      expect(run).toMatchObject({ status: 'queued', attempt: 1 });
      run.status = 'running';
      state.storage.sql.exec("UPDATE wc_runs SET status = 'running', data = ? WHERE id = ?", encode(run), run.id);
      const restarted = new Engine(state.storage, engine.definition, {});
      expect(restarted.inspect(alice, 'runs')).toMatchObject({ rows: [expect.objectContaining({ status: 'interrupted' })] });
    }, definition({ jobs: { job } }));
  });
  it('coalesces missed schedules, avoids overlap and supports cancellation', async () => {
    const job = app.task({ input: empty, output: z.null(), handler: async () => null });
    const schedule = app.mutation({ input: empty, output: z.string(), handler: ctx => ctx.schedule(job, {}, { at: 1000, everyMs: 1000 }) });
    await withEngine(async engine => {
      const result = engine.mutate(alice, 'schedule', {}, 'schedule');
      engine.dispatchSchedules(10_500);
      expect(engine.inspect(alice, 'schedules')).toMatchObject({ rows: [{ at: 11_000 }] });
      engine.dispatchSchedules(12_500);
      expect(engine.inspect(alice, 'runs')).toMatchObject({ rows: [expect.objectContaining({ status: 'queued' })] });
      engine.control(alice, 'schedule', result.data as string, 'disable');
      await engine.executeNext();
      expect(engine.inspect(alice, 'runs')).toMatchObject({ rows: [expect.objectContaining({ status: 'completed' })] });
    }, definition({ mutations: { schedule }, jobs: { job } }));
  });
  it('rejects lossy JSON instead of silently changing values', () => {
    for (const value of [undefined, new Date(), { value: NaN }, { value: undefined }, 1n, Array(2)]) expect(() => encode(value)).toThrow();
    expect(encode({ valid: [1, 'two', true, null] })).toBe('{"valid":[1,"two",true,null]}');
  });
  it('bounds record pages by bytes without losing the continuation cursor', async () => {
    await withEngine(engine => {
      for (const id of ['a', 'b']) engine.mutate(alice, 'add', { id, title: 'x'.repeat(220_000) }, id);
      const first = engine.inspect(alice, 'table:notes') as any;
      expect(first.rows).toHaveLength(1);
      expect(first.nextCursor).toBe('a');
      const second = engine.inspect(alice, 'table:notes', first.nextCursor) as any;
      expect(second.rows).toHaveLength(1);
      expect(second.rows[0].id).toBe('b');
      expect(second.nextCursor).toBeNull();
    });
  });
  it('keeps large run payloads out of lists but allows authorised detail inspection', async () => {
    const job = app.task({ input: z.string(), output: z.string(), handler: async () => 'r'.repeat(400_000) });
    await withEngine(async engine => {
      const run = engine.enqueue(alice, 'job', 'i'.repeat(100_000), 'large');
      await engine.executeNext();
      const list = engine.inspect(alice, 'runs') as any;
      expect(list.rows[0].result).toBeUndefined();
      expect(list.rows[0].input).toBeUndefined();
      expect((engine.inspect(alice, 'run:' + run.data) as any).result).toHaveLength(400_000);
      expect(() => engine.inspect({ id: 'bob' }, 'run:' + run.data)).toThrow('Access denied');
    }, definition({ jobs: { job } }));
  });
  it('records completed external effects honestly when cancellation arrives during execution', async () => {
    let finish: (() => void) | undefined;
    let late: (() => void) | undefined;
    const external = new Promise<string>(resolve => { finish = () => resolve('sent'); });
    const job = app.task({ input: empty, output: z.string(), handler: async ctx => {
      late = () => { ctx.mutate(add, { id: 'late', title: 'No' }); };
      return ctx.step('External effect', () => external);
    } });
    await withEngine(async engine => {
      const run = engine.enqueue(alice, 'job', {}, 'cancel');
      const execution = engine.executeNext();
      engine.control(alice, 'run', run.data as string, 'cancel');
      finish!();
      await execution;
      expect(engine.inspect(alice, 'runs')).toMatchObject({ rows: [expect.objectContaining({ status: 'cancelled' })] });
      expect(engine.trace(alice, run.data as string)).toMatchObject({ rows: [expect.objectContaining({ status: 'completed', result: 'sent' })] });
      expect(late).toThrow('no longer active');
    }, definition({ jobs: { job } }));
  });
  it('pages traces and applies the step budget to tools as well as external steps', async () => {
    const job = app.task({ input: empty, output: z.null(), maxSteps: 12, handler: async ctx => {
      for (let index = 0; index < 12; index++) await ctx.step('Step ' + index, async () => index);
      return null;
    } });
    const bounded = app.agent({ input: empty, output: z.null(), tools: [add], maxSteps: 1, handler: async ctx => {
      ctx.mutate(add, { id: 'first', title: 'Allowed' });
      ctx.mutate(add, { id: 'second', title: 'Too many' });
      return null;
    } });
    await withEngine(async engine => {
      const run = engine.enqueue(alice, 'job', {}, 'pages');
      await engine.executeNext();
      const first = engine.trace(alice, run.data as string) as any;
      expect(first.rows).toHaveLength(10);
      const second = engine.trace(alice, run.data as string, first.nextCursor) as any;
      expect(second.rows).toHaveLength(2);
      expect(second.nextCursor).toBeNull();
      engine.enqueue(alice, 'bounded', {}, 'bounded');
      await engine.executeNext();
      expect(engine.query(alice, 'mine', {}).data).toEqual(['Allowed']);
    }, definition({ jobs: { job, bounded } }));
  });
});
