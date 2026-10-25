import { env } from 'cloudflare:workers';
import { runInDurableObject } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { field, ui, workspace, manifestSchema } from '../packages/core/src/index.js';
import type { JsonSchema } from '../packages/core/src/index.js';
import { Engine } from '../packages/core/src/engine.js';
import { actionValues, defaults, readPath, validation } from '../packages/admin/src/lib/data.js';

const app = workspace({});
const rows = app.view({ input: z.object({}), output: z.array(z.object({ id: z.string(), revision: z.number(), title: z.string() })), dependsOn: [], handler: () => [] });
const edit = app.mutation({ input: z.object({ id: z.string(), revision: z.number(), title: z.string().min(1) }), output: z.null(), handler: () => null });
const definition = app.define({
  views: { rows }, queries: {}, mutations: { edit }, jobs: {},
  authorize: ({ actor }, action) => action === 'view:rows' || actor.id === 'admin',
  admin: { title: 'Test application', pages: {
    overview: ui.page({ title: 'Overview', blocks: [ui.collection(rows, ({ form }) => ({ columns: [{ path: 'title' }], actions: [form(edit, { label: 'Edit', bind: { id: 'id', revision: 'revision' }, initial: { title: 'title' } })] }))] }),
    writes: ui.page({ title: 'Write-only page', blocks: [ui.form(edit, { label: 'Edit' })] }),
  } },
});

describe('typed metadata and authorised UI manifests', () => {
  it('preserves Zod validation and exports field hints', () => {
    const schema = field(z.string().min(3), { label: 'Title', description: 'Choose a title', control: 'textarea', placeholder: 'A useful name' });
    expect(schema.safeParse('no').success).toBe(false);
    expect(z.toJSONSchema(schema)).toMatchObject({ type: 'string', title: 'Title', description: 'Choose a title', minLength: 3, 'x-workcore': { control: 'textarea', placeholder: 'A useful name' } });
  });
  it('projects pages, sources and actions without exposing handlers', async () => {
    const bindings = env as unknown as { TEST: DurableObjectNamespace };
    const stub = bindings.TEST.get(bindings.TEST.idFromName(crypto.randomUUID()));
    await runInDurableObject(stub, (_instance, state) => {
      const engine = new Engine(state.storage, definition, {});
      const admin = manifestSchema.parse(engine.manifest({ id: 'admin' }));
      expect(admin.ui.pages.overview!.blocks[0]!.actions![0]).toMatchObject({ operation: { kind: 'mutation', name: 'edit' }, bind: { id: 'id' } });
      expect(admin.ui.pages.overview!.blocks[0]!.source).toEqual({ kind: 'view', name: 'rows' });
      const member = manifestSchema.parse(engine.manifest({ id: 'member' }));
      expect(member.mutation).toEqual({});
      expect(member.ui.pages.writes).toBeUndefined();
      expect(member.ui.pages.overview!.blocks[0]!.actions).toEqual([]);
      expect(JSON.stringify(admin)).not.toContain('handler');
    });
  });
  it('rejects unregistered actions and invalid data paths at setup', async () => {
    const bindings = env as unknown as { TEST: DurableObjectNamespace };
    const stub = bindings.TEST.get(bindings.TEST.idFromName(crypto.randomUUID()));
    await runInDurableObject(stub, (_instance, state) => {
      expect(() => new Engine(state.storage, { ...definition, mutations: {} }, {})).toThrow('unregistered');
      expect(() => new Engine(state.storage, { ...definition, admin: { pages: { bad: { title: 'Bad', blocks: [{ kind: 'collection', source: rows, columns: [{ path: 'missing' }] }] } } } }, {})).toThrow('Unknown UI data path');
      expect(() => new Engine(state.storage, { ...definition, admin: { pages: { bad: ui.page({ title: 'Bad', blocks: [ui.collection(rows, ({ command }) => ({ actions: [command(edit, { label: 'Missing inputs' })] }))] }) } } }, {})).toThrow('Command requires a binding');
      const markdown = app.query({ input: z.object({}), output: z.string().nullable(), handler: () => null });
      expect(() => new Engine(state.storage, { ...definition, queries: { markdown }, admin: { pages: { content: ui.page({ title: 'Content', blocks: [ui.markdown(markdown)] }) } } }, {})).not.toThrow();
    });
  });
  it('builds form defaults, validates without eval and resolves bound versus editable fields', () => {
    const schema = JSON.parse(JSON.stringify(z.toJSONSchema(edit.input, { io: 'input' }))) as JsonSchema;
    expect(defaults(schema)).toEqual({ id: '', revision: 0, title: '' });
    expect(Object.keys(validation(schema, { id: 'a', revision: 2, title: '' })).length).toBeGreaterThan(0);
    expect(validation(schema, { id: 'a', revision: 2, title: 'Valid' })).toEqual({});
    const block = definition.admin!.pages.overview!.blocks[0]!;
    if (block.kind !== 'collection') throw new Error('Expected collection');
    const action = block.actions![0]!;
    expect(actionValues({ ...action, operation: { kind: 'mutation', name: 'edit' } }, { id: 'a', revision: 8, title: 'Editable' }, schema)).toEqual({ id: 'a', revision: 8, title: 'Editable' });
    expect(readPath({}, '__proto__.polluted')).toBeUndefined();
  });
  it('keeps an authorised chat read-only when sending is denied', async () => {
    const conversation = app.view({ input: z.object({}), output: z.object({ messages: z.array(z.object({ id: z.string(), role: z.string(), content: z.string() })) }), dependsOn: [], handler: () => ({ messages: [] }) });
    const send = app.mutation({ input: z.object({ message: z.string() }), output: z.null(), handler: () => null });
    const readOnly = app.define({
      views: { conversation }, queries: {}, mutations: { send }, jobs: {}, authorize: (_ctx, action) => action.startsWith('view:'),
      admin: { pages: { chat: ui.page({ title: 'Chat', blocks: [ui.chat(conversation, send, { messages: 'messages', message: { id: 'id', role: 'role', content: 'content' }, promptField: 'message' })] }) } },
    });
    const bindings = env as unknown as { TEST: DurableObjectNamespace };
    const stub = bindings.TEST.get(bindings.TEST.idFromName(crypto.randomUUID()));
    await runInDurableObject(stub, (_instance, state) => {
      const manifest = manifestSchema.parse(new Engine(state.storage, readOnly, {}).manifest({ id: 'member' }));
      expect(manifest.ui.pages.chat!.blocks[0]!.source).toEqual({ kind: 'view', name: 'conversation' });
      expect(manifest.ui.pages.chat!.blocks[0]!.send).toBeUndefined();
    });
  });
});
