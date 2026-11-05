import { env } from 'cloudflare:workers';
import { runInDurableObject } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { field, ui, workspace, manifestSchema, displayDocumentSchema } from '../packages/core/src/index.js';
import validDisplayFixture from './fixtures/display-protocol/v3-basic.json' with { type: 'json' };
import malformedDisplayFixture from './fixtures/display-protocol/v3-malformed-missing-source.json' with { type: 'json' };
import nestedDisplayFixture from './fixtures/display-protocol/v3-layout-tree.json' with { type: 'json' };
import type { JsonSchema, ManifestAction } from '../packages/core/src/index.js';
import { Engine } from '../packages/core/src/engine.js';
import { actionValues, defaults, readPath, validation } from '../packages/admin/src/lib/data.js';
import type { DisplayContext } from '../packages/admin/src/lib/display-context.svelte.js';
import { resetDisplayState } from '../packages/admin/src/lib/display-state.js';
import { runSuccessEffects } from '../packages/admin/src/lib/success-effects.js';
import type { RendererHost } from '../packages/admin/src/lib/host-context.svelte.js';
import { createEmbedBudget, displayIdentity } from '../packages/admin/src/lib/embed-context.svelte.js';

const app = workspace((await import('../examples/workcore-demo/src/schema.js')).schema, (await import('../examples/workcore-demo/src/migrations.js')).default);
const rows = app.view({ input: z.object({}), output: z.array(z.object({ id: z.string(), revision: z.number(), title: z.string() })), dependsOn: [], handler: () => [] });
const edit = app.mutation({ input: z.object({ id: z.string(), revision: z.number(), title: z.string().min(1) }), output: z.null(), handler: () => null });
const definition = app.define({
  views: { rows }, queries: {}, mutations: { edit }, jobs: {},
  authorize: ({ actor }, action) => action === 'view:rows' || action === 'display:overview' || actor.id === 'admin',
  displays: { title: 'Test application', displays: {
    overview: ui.display({ metadata: { title: 'Overview', route: { path: '/', listed: true } }, document: ui.document({ blocks: [ui.collection(rows, ({ form }) => ({ id: 'rows', columns: [{ path: 'title' }], actions: [form(edit, { label: 'Edit', bind: { id: 'id', revision: 'revision' }, initial: { title: 'title' } })] }))] }) }),
    writes: ui.display({ metadata: { title: 'Write-only page' }, document: ui.document({ blocks: [ui.form(edit, { id: 'write', label: 'Edit' })] }) }),
  } },
});

describe('typed metadata and authorised UI manifests', () => {
  it('identifies embedded displays by workspace and parameters, independent of object-key order', () => {
    expect(displayIdentity('tasks', 'page', { id: 'a', status: 'open' })).toBe(displayIdentity('tasks', 'page', { status: 'open', id: 'a' }));
    expect(displayIdentity('tasks', 'page', { id: 'a' })).not.toBe(displayIdentity('notes', 'page', { id: 'a' }));
    expect(displayIdentity('tasks', 'page', { id: 'a' })).not.toBe(displayIdentity('tasks', 'page', { id: 'b' }));
  });
  it('reserves active embed slots synchronously and releases them for later siblings', () => {
    const budget = createEmbedBudget(2);
    const first = Symbol('first'); const second = Symbol('second'); const third = Symbol('third');
    expect(budget.reserve(first)).toBe(true);
    expect(budget.reserve(second)).toBe(true);
    expect(budget.reserve(third)).toBe(false);
    expect(budget.count).toBe(2);
    budget.release(first);
    expect(budget.count).toBe(1);
    expect(budget.reserve(third)).toBe(true);
    budget.release(first);
    expect(budget.count).toBe(2);
  });
  it('accepts and rejects the reviewable display-protocol v3 fixtures', () => {
    expect(displayDocumentSchema.safeParse(validDisplayFixture).success).toBe(true);
    expect(displayDocumentSchema.safeParse(nestedDisplayFixture).success).toBe(true);
    expect(displayDocumentSchema.safeParse(malformedDisplayFixture).success).toBe(false);
  });
  it('validates state effects against the declared Zod schema, including integer state', async () => {
    const stateDefinition = app.define({
      views: { rows }, queries: {}, mutations: { edit }, jobs: {}, authorize: () => true,
      displays: { displays: { counter: ui.display({ metadata: { title: 'Counter' }, document: ui.document({
        state: { count: ui.state(z.number().int().min(0), { default: 0 }) },
        blocks: [ui.form(edit, { id: 'set-count', label: 'Set count', effects: [ui.effect.setState('count', 1)] })],
      }) }) } },
    });
    const bindings = env as unknown as { TEST: DurableObjectNamespace };
    const stub = bindings.TEST.get(bindings.TEST.idFromName(crypto.randomUUID()));
    await runInDurableObject(stub, (_instance, state) => {
      expect(() => new Engine(state.storage, stateDefinition, {}).manifest({ id: 'admin' })).not.toThrow();
      const invalid = app.define({
        views: { rows }, queries: {}, mutations: { edit }, jobs: {}, authorize: () => true,
        displays: { displays: { counter: ui.display({ metadata: { title: 'Counter' }, document: ui.document({
          state: { count: ui.state(z.number().int().min(0), { default: 0 }) },
          blocks: [ui.form(edit, { id: 'set-count', label: 'Set count', effects: [ui.effect.setState('count', 1.5)] })],
        }) }) } },
      });
      expect(() => new Engine(state.storage, invalid, {})).toThrow('Invalid state effect value for count');
    });
  });
  it('waits for URL state reset persistence before navigating after success', async () => {
    let current = new URL('https://example.test/admin/demo/displays/stateful?__state.instance.status=%22done%22');
    const events: string[] = [];
    let releasePersistence!: () => void;
    const persistenceGate = new Promise<void>(resolve => { releasePersistence = resolve; });
    const host: RendererHost = {
      location: () => new URL(current.href),
      navigate: async href => {
        const destination = new URL(href);
        if (destination.pathname === current.pathname) {
          events.push('reset-persist-start');
          await persistenceGate;
          current = destination;
          events.push('reset-persist-complete');
          return;
        }
        events.push('destination-navigation');
        current = destination;
      },
      displayHref: (display, input = {}) => {
        const destination = new URL(`/admin/demo/displays/${display}`, current);
        for (const [key, value] of Object.entries(input)) destination.searchParams.set(key, JSON.stringify(value));
        destination.searchParams.set('__back', `${current.pathname}${current.search}`);
        return destination.href;
      },
    };
    const definitions = { status: { schema: { type: 'string', enum: ['open', 'done'] }, default: 'open', persistence: 'url' as const } };
    const displayContext = {
      dispatchEffect: async (effect: ManifestAction['effects'] extends (infer E)[] | undefined ? E : never) => {
        if (effect.type === 'state.reset') await resetDisplayState(effect.name, definitions, async () => {
          const persisted = new URL(current.href);
          persisted.searchParams.delete('__state.instance.status');
          await host.navigate(persisted.href, { replace: true });
        });
      },
    } as unknown as DisplayContext;
    const action: ManifestAction = {
      kind: 'command', operation: { kind: 'mutation', name: 'complete' }, label: 'Complete',
      effects: [
        { type: 'state.reset', name: 'status' },
        { type: 'navigate', display: 'taskDetail', bind: {} },
      ],
    };
    const navigation = runSuccessEffects(action, null, { displayContext, host, refreshSources() {}, resetForm() {} });
    expect(events).toEqual(['reset-persist-start']);
    releasePersistence();
    await navigation;
    expect(events).toEqual(['reset-persist-start', 'reset-persist-complete', 'destination-navigation']);
    const back = new URLSearchParams(current.search).get('__back');
    expect(back).not.toContain('__state.instance.status');
  });
  it('preserves Zod validation and exports field hints', () => {
    const schema = field(z.string().min(3), { label: 'Title', description: 'Choose a title', control: 'textarea', placeholder: 'A useful name' });
    expect(schema.safeParse('no').success).toBe(false);
    expect(z.toJSONSchema(schema)).toMatchObject({ type: 'string', title: 'Title', description: 'Choose a title', minLength: 3, 'x-workcore': { control: 'textarea', placeholder: 'A useful name' } });
    expect(z.toJSONSchema(field(z.enum(['open', 'done']), { enumLabels: { open: 'In progress', done: 'Complete' } }))).toMatchObject({ 'x-workcore': { enumLabels: { open: 'In progress', done: 'Complete' } } });
    expect(z.toJSONSchema(field(z.array(z.string()).max(4), { label: 'Tags' }))).toMatchObject({ type: 'array', maxItems: 4, items: { type: 'string' } });
  });
  it('projects pages, sources and actions without exposing handlers', async () => {
    const bindings = env as unknown as { TEST: DurableObjectNamespace };
    const stub = bindings.TEST.get(bindings.TEST.idFromName(crypto.randomUUID()));
    await runInDurableObject(stub, (_instance, state) => {
      const engine = new Engine(state.storage, definition, {});
      const admin = manifestSchema.parse(engine.manifest({ id: 'admin' }));
      expect(admin.protocol).toBe(3);
      expect(admin.displayProtocol).toBe(3);
      const adminBlock = admin.ui.displays.overview!.document!.blocks[0]!;
      if (adminBlock.kind !== 'collection') throw new Error('Expected collection');
      expect(adminBlock.actions![0]).toMatchObject({ operation: { kind: 'mutation', name: 'edit' }, bind: { id: 'id' } });
      expect(adminBlock.source).toEqual({ kind: 'view', name: 'rows' });
      const member = manifestSchema.parse(engine.manifest({ id: 'member' }));
      expect(member.mutation).toEqual({});
      expect(member.ui.displays.writes).toBeUndefined();
      const memberBlock = member.ui.displays.overview!.document!.blocks[0]!;
      if (memberBlock.kind !== 'collection') throw new Error('Expected collection');
      expect(memberBlock.actions).toEqual([]);
      expect(JSON.stringify(admin)).not.toContain('handler');
    });
  });
  it('recursively compiles authorized descendants and omits independently denied sources and actions', async () => {
    const secretRows = app.view({ input: z.object({}), output: z.array(z.object({ title: z.string() })), dependsOn: [], handler: () => [] });
    const nested = ui.display({
      metadata: { title: 'Nested', route: { path: '/nested' } },
      document: ui.document({ blocks: [ui.section({ id: 'root', children: [
        ui.columns({ id: 'split', columns: [
          { id: 'public', children: [ui.json(rows, { id: 'public-rows' })] },
          { id: 'private', children: [ui.json(secretRows, { id: 'secret-rows' }), ui.button(edit, { id: 'edit-button', label: 'Edit', values: { title: 'fixed' } })] },
        ] }),
      ] })] }),
    });
    const nestedDefinition = app.define({
      views: { rows, secretRows }, queries: {}, mutations: { edit }, jobs: {}, displays: { displays: { nested } },
      authorize: (_ctx, permission) => permission === 'display:nested' || permission === 'view:rows',
    });
    const bindings = env as unknown as { TEST: DurableObjectNamespace };
    const stub = bindings.TEST.get(bindings.TEST.idFromName(crypto.randomUUID()));
    await runInDurableObject(stub, (_instance, state) => {
      const engine = new Engine(state.storage, nestedDefinition, {});
      const manifest = manifestSchema.parse(engine.manifest({ id: 'member' }));
      expect(manifest.ui.displays.nested?.document?.blocks).toMatchObject([{
        kind: 'section', id: 'root', children: [{ kind: 'columns', columns: [
          { id: 'public', children: [{ kind: 'json', source: { kind: 'view', name: 'rows' } }] },
          { id: 'private', children: [] },
        ] }],
      }]);
    });
  });
  it('rejects duplicate IDs and excessive depth inside recursive layouts', () => {
    const duplicate = { blocks: [{ id: 'root', kind: 'section', children: [
      { id: 'same', kind: 'json', source: { kind: 'view', name: 'rows' } },
      { id: 'same', kind: 'json', source: { kind: 'view', name: 'rows' } },
    ] }] };
    expect(displayDocumentSchema.safeParse(duplicate).success).toBe(false);
    let child: Record<string, unknown> = { id: 'leaf', kind: 'json', source: { kind: 'view', name: 'rows' } };
    for (let depth = 0; depth < 13; depth++) child = { id: `section-${depth}`, kind: 'section', children: [child] };
    expect(displayDocumentSchema.safeParse({ blocks: [child] }).success).toBe(false);
  });
  it('type-checks selection bindings and publishes them for selected-record sources', async () => {
    const selectedDetail = app.view({ input: z.object({ id: z.string() }), output: z.object({ title: z.string() }), dependsOn: [], handler: () => ({ title: 'selected' }) });
    const combined = ui.combined.masterDetail(rows, selectedDetail, { id: 'picker', title: 'Choose a row', key: 'id', detailInput: 'id', columns: [{ path: 'title' }], detailFields: [{ path: 'title' }] });
    const selectionDisplay = ui.display({ metadata: { title: 'Selection' }, document: ui.document({ blocks: [combined] }) });
    const selectionDefinition = app.define({ views: { rows, selectedDetail }, queries: {}, mutations: {}, jobs: {}, displays: { displays: { selectionDisplay } }, authorize: () => true });
    const bindings = env as unknown as { TEST: DurableObjectNamespace };
    const stub = bindings.TEST.get(bindings.TEST.idFromName(crypto.randomUUID()));
    await runInDurableObject(stub, (_instance, state) => {
      const manifest = manifestSchema.parse(new Engine(state.storage, selectionDefinition, {}).manifest({ id: 'admin' }));
      const blocks = manifest.ui.displays.selectionDisplay!.document!.blocks;
      expect(blocks[0]).toMatchObject({ kind: 'section', id: 'picker', children: [{ kind: 'columns', columns: [
        { children: [{ id: 'picker-list', kind: 'collection', selection: { key: 'id' } }] },
        { children: [{ id: 'picker-detail', kind: 'record', input: { id: { $workcoreBinding: { kind: 'selection', node: 'picker-list' } } } }] },
      ] }] });
      const invalid = ui.display({ metadata: { title: 'Invalid selection' }, document: ui.document({ blocks: [
        ui.record(selectedDetail, { id: 'detail', input: { id: ui.bind.selection('missing') } }),
      ] }) });
      expect(() => new Engine(state.storage, { ...selectionDefinition, displays: { displays: { invalid } } }, {})).toThrow('Unknown or non-selectable collection node');
    });
  });
  it('rejects the prior manifest version and unstable or oversized display documents', async () => {
    expect(manifestSchema.safeParse({ protocol: 2 }).success).toBe(false);
    const bindings = env as unknown as { TEST: DurableObjectNamespace };
    const stub = bindings.TEST.get(bindings.TEST.idFromName(crypto.randomUUID()));
    await runInDurableObject(stub, (_instance, state) => {
      const duplicate = ui.display({ metadata: { title: 'Duplicate IDs' }, document: ui.document({ blocks: [
        { id: 'same', kind: 'json', source: rows }, { id: 'same', kind: 'json', source: rows },
      ] }) });
      expect(() => new Engine(state.storage, { ...definition, displays: { displays: { duplicate } } }, {})).toThrow('duplicate node ID');
      const unsafeRoute = ui.display({ metadata: { title: 'Unsafe route', route: { path: '/../secrets' } }, document: ui.document({ blocks: [ui.json(rows, { id: 'rows' })] }) });
      expect(() => new Engine(state.storage, { ...definition, displays: { displays: { unsafeRoute } } }, {})).toThrow('Invalid route path');
      const tooMany = ui.display({ metadata: { title: 'Too many nodes' }, document: ui.document({ blocks: Array.from({ length: 201 }, (_, index) => ui.json(rows, { id: `row-${index}` })) }) });
      expect(() => new Engine(state.storage, { ...definition, displays: { displays: { tooMany } } }, {})).toThrow('200-node limit');
    });
  });
  it('lists dynamic displays without running handlers and resolves them with validated, independent inputs', async () => {
    const dynamic = app.display({
      input: z.object({ heading: z.string().min(1) }),
      metadata: { title: 'Generated display', route: { path: '/generated/:heading', listed: false } },
      handler: (_ctx, input) => ui.document({ blocks: [ui.json(rows, { id: 'heading', title: input.heading })] }),
    });
    const dynamicDefinition = app.define({
      views: { rows }, queries: {}, mutations: {}, jobs: {},
      displays: { displays: { generated: dynamic } },
      authorize: ({ actor }, action) => action === 'view:rows' || action === 'display:generated' && actor.id === 'admin',
    });
    const bindings = env as unknown as { TEST: DurableObjectNamespace };
    const stub = bindings.TEST.get(bindings.TEST.idFromName(crypto.randomUUID()));
    await runInDurableObject(stub, (_instance, state) => {
      const engine = new Engine(state.storage, dynamicDefinition, {});
      const manifest = manifestSchema.parse(engine.manifest({ id: 'admin' }));
      expect(manifest.ui.displays.generated?.document).toBeUndefined();
      expect(manifest.ui.displays.generated?.metadata.route?.listed).toBe(false);
      expect(manifest.ui.displays.generated?.input).toMatchObject({ required: ['heading'] });
      expect(engine.resolveDisplay({ id: 'admin' }, 'generated', { heading: 'Reports' })).toMatchObject({ blocks: [{ id: 'heading', title: 'Reports' }] });
      expect(() => engine.resolveDisplay({ id: 'admin' }, 'generated', { heading: '' })).toThrow();
      expect(() => engine.resolveDisplay({ id: 'member' }, 'generated', { heading: 'Reports' })).toThrow('Access denied');
      expect(manifestSchema.parse(engine.manifest({ id: 'member' })).ui.displays.generated).toBeUndefined();
    });
  });
  it('validates finite property bindings from display inputs into registered source inputs', async () => {
    const byHeading = app.view({ input: z.object({ heading: z.string() }), output: z.array(z.object({ title: z.string() })), dependsOn: [], handler: () => [] });
    const bound = ui.display({
      input: z.object({ heading: z.string().min(1) }), metadata: { title: 'Bound source', route: { path: '/bound/:heading', listed: false } },
      document: ui.document({ blocks: [ui.json(byHeading, { id: 'rows', input: { heading: ui.bind.property('heading') } })] }),
    });
    const definitionWithBinding = app.define({
      views: { byHeading }, queries: {}, mutations: {}, jobs: {}, displays: { displays: { bound } },
      authorize: (_ctx, action) => action === 'view:byHeading' || action === 'display:bound',
    });
    const bindings = env as unknown as { TEST: DurableObjectNamespace };
    const stub = bindings.TEST.get(bindings.TEST.idFromName(crypto.randomUUID()));
    await runInDurableObject(stub, (_instance, state) => {
      const engine = new Engine(state.storage, definitionWithBinding, {});
      expect(engine.resolveDisplay({ id: 'admin' }, 'bound', { heading: 'Roadmap' })).toMatchObject({
        blocks: [{
          input: {
            heading: { $workcoreBinding: { kind: 'property', path: 'heading' } },
          },
        }],
      });
      const invalid = ui.display({
        input: z.object({ heading: z.string() }), metadata: { title: 'Bad binding' },
        document: ui.document({ blocks: [ui.json(byHeading, { id: 'rows', input: { heading: ui.bind.property('unknown') } })] }),
      });
      expect(() => new Engine(state.storage, { ...definitionWithBinding, displays: { displays: { invalid } } }, {})).toThrow('Unknown UI data path');
    });
  });
  it('validates namespaced custom node props and publishes browser-safe component contracts', async () => {
    const custom = ui.display({ metadata: { title: 'Custom display' }, document: ui.document({ blocks: [ui.custom('acme.task-board', 2, { groupBy: 'done' }, { id: 'board' })] }) });
    const customDefinition = app.define({
      views: {}, queries: {}, mutations: {}, jobs: {}, authorize: (_ctx, action) => action === 'display:custom',
      displays: { components: { 'acme.task-board': { version: 2, props: z.object({ groupBy: z.enum(['done', 'owner']) }) } }, displays: { custom } },
    });
    const bindings = env as unknown as { TEST: DurableObjectNamespace };
    const stub = bindings.TEST.get(bindings.TEST.idFromName(crypto.randomUUID()));
    await runInDurableObject(stub, (_instance, state) => {
      const engine = new Engine(state.storage, customDefinition, {});
      const manifest = manifestSchema.parse(engine.manifest({ id: 'admin' }));
      expect(manifest.ui.components['acme.task-board']).toMatchObject({ version: 2, props: { properties: { groupBy: { enum: ['done', 'owner'] } } } });
      expect(engine.resolveDisplay({ id: 'admin' }, 'custom', {})).toMatchObject({ blocks: [{ kind: 'custom', component: 'acme.task-board', version: 2, props: { groupBy: 'done' } }] });
      const bad = ui.display({ metadata: { title: 'Bad' }, document: ui.document({ blocks: [ui.custom('acme.task-board', 2, { groupBy: 'other' }, { id: 'bad' })] }) });
      expect(() => new Engine(state.storage, { ...customDefinition, displays: { ...customDefinition.displays!, displays: { bad } } }, {})).toThrow();
    });
  });
  it('normalizes custom component props with schema defaults', async () => {
    const normalized = ui.display({ metadata: { title: 'Defaults' }, document: ui.document({ blocks: [ui.custom('acme.board', 1, {}, { id: 'board' })] }) });
    const customDefinition = app.define({
      views: { rows }, queries: {}, mutations: {}, jobs: {},
      displays: { components: { 'acme.board': { version: 1, props: z.object({ title: z.string().default('Default board') }) } }, displays: { normalized } },
      authorize: () => true,
    });
    const bindings = env as unknown as { TEST: DurableObjectNamespace };
    const stub = bindings.TEST.get(bindings.TEST.idFromName(crypto.randomUUID()));
    await runInDurableObject(stub, (_instance, state) => {
      expect(new Engine(state.storage, customDefinition, {}).resolveDisplay({ id: 'admin' }, 'normalized', {})).toMatchObject({ blocks: [{ props: { title: 'Default board' } }] });
    });
  });
  it('validates nested property bindings and compiles general display references', async () => {
    const nestedSource = app.view({ input: z.object({ filter: z.object({ ownerId: z.string() }) }), output: z.array(z.object({ title: z.string() })), dependsOn: [], handler: () => [] });
    const target = ui.display({ input: z.object({ ownerId: z.string() }), metadata: { title: 'Target' }, document: ui.document({ blocks: [ui.json(rows, { id: 'rows' })] }) });
    const parent = ui.display({
      input: z.object({ ownerId: z.string() }), metadata: { title: 'Parent' }, document: ui.document({ blocks: [
        ui.json(nestedSource, { id: 'nested', input: { filter: { ownerId: ui.bind.property('ownerId') } } }),
        ui.displayReference('target', { id: 'target-ref', input: { ownerId: ui.bind.property('ownerId') } }),
      ] }),
    });
    const nestedDefinition = app.define({ views: { rows, nestedSource }, queries: {}, mutations: {}, jobs: {}, displays: { displays: { parent, target } }, authorize: () => true });
    const bindings = env as unknown as { TEST: DurableObjectNamespace };
    const stub = bindings.TEST.get(bindings.TEST.idFromName(crypto.randomUUID()));
    await runInDurableObject(stub, (_instance, state) => {
      const engine = new Engine(state.storage, nestedDefinition, {});
      expect(manifestSchema.parse(engine.manifest({ id: 'admin' })).ui.displays.parent?.document?.blocks[1]).toMatchObject({ kind: 'display', display: 'target' });
      const invalid = ui.display({ input: z.object({ ownerId: z.string() }), metadata: { title: 'Invalid nested binding' }, document: ui.document({ blocks: [ui.json(nestedSource, { id: 'bad', input: { filter: { ownerId: ui.bind.property('missingOwner') } } })] }) });
      expect(() => new Engine(state.storage, { ...nestedDefinition, displays: { displays: { invalid, target } } }, {})).toThrow('Unknown UI data path: missingOwner');
    });
  });
  it('validates local renderer placement for cell and field escape hatches', async () => {
    const cell = app.view({ input: z.object({}), output: z.array(z.object({ title: z.string() })), dependsOn: [], handler: () => [] });
    const fieldMutation = app.mutation({ input: z.object({ title: field(z.string(), { renderer: 'acme.title-editor', relationship: { source: 'cell', valuePath: 'title', labelPath: 'title' } }) }), output: z.null(), handler: () => null });
    const definitionWithRenderers = app.define({
      views: { cell }, queries: {}, mutations: { fieldMutation }, jobs: {},
      authorize: (_ctx, action) => action === 'view:cell' || action === 'display:renderers' || action === 'mutation:fieldMutation',
      displays: {
        components: {
          'acme.title-editor': { version: 1, placement: 'field', props: z.object({}) },
          'acme.title-cell': { version: 1, placement: 'cell', props: z.object({}) },
        },
        displays: {
          renderers: ui.display({
            metadata: { title: 'Renderer fixtures' },
            document: ui.document({ blocks: [
              ui.collection(cell, () => ({ id: 'rows', columns: [{ path: 'title', renderer: 'acme.title-cell' }] })),
              ui.form(fieldMutation, { id: 'edit', label: 'Edit title' }),
            ] }),
          }),
        },
      },
    });
    const bindings = env as unknown as { TEST: DurableObjectNamespace };
    const stub = bindings.TEST.get(bindings.TEST.idFromName(crypto.randomUUID()));
    await runInDurableObject(stub, (_instance, state) => {
      const engine = new Engine(state.storage, definitionWithRenderers, {});
      const manifest = manifestSchema.parse(engine.manifest({ id: 'admin' }));
      expect(manifest.ui.components['acme.title-cell']).toMatchObject({ placement: 'cell', version: 1 });
      expect(manifest.ui.displays.renderers?.document?.blocks[0]).toMatchObject({ columns: [{ renderer: 'acme.title-cell' }] });
      expect(manifest.mutation.fieldMutation?.input.properties?.title?.['x-workcore']?.relationship).toEqual({ source: 'cell', valuePath: 'title', labelPath: 'title' });
      const wrongPlacement = ui.display({ metadata: { title: 'Wrong placement' }, document: ui.document({ blocks: [
        ui.collection(cell, () => ({ id: 'rows', columns: [{ path: 'title', renderer: 'acme.title-editor' }] })),
      ] }) });
      const invalid = { ...definitionWithRenderers, displays: { ...definitionWithRenderers.displays!, displays: { wrongPlacement } } };
      expect(() => new Engine(state.storage, invalid, {})).toThrow('not cell');
      const unrelated = app.mutation({ input: z.object({ title: field(z.string(), { relationship: { source: 'missing', valuePath: 'id', labelPath: 'name' } }) }), output: z.null(), handler: () => null });
      const invalidLookup = { ...definitionWithRenderers, mutations: { unrelated }, displays: { ...definitionWithRenderers.displays!, displays: { edit: ui.display({ metadata: { title: 'Invalid lookup' }, document: ui.document({ blocks: [ui.form(unrelated, { id: 'edit', label: 'Edit' })] }) }) } } };
      expect(() => new Engine(state.storage, invalidLookup, {})).toThrow('registered view');
    });
  });
  it('rejects unregistered actions and invalid data paths at setup', async () => {
    const bindings = env as unknown as { TEST: DurableObjectNamespace };
    const stub = bindings.TEST.get(bindings.TEST.idFromName(crypto.randomUUID()));
    await runInDurableObject(stub, (_instance, state) => {
      expect(() => new Engine(state.storage, { ...definition, mutations: {} }, {})).toThrow('unregistered');
      const invalidPath = { ...definition, displays: { displays: { bad: ui.display({ metadata: { title: 'Bad' }, document: ui.document({ blocks: [{ id: 'rows', kind: 'collection', source: rows, columns: [{ path: 'missing' }] }] }) }) } } };
      expect(() => new Engine(state.storage, invalidPath, {})).toThrow('Unknown UI data path');
      const invalidCommand = { ...definition, displays: { displays: { bad: ui.display({ metadata: { title: 'Bad' }, document: ui.document({ blocks: [ui.collection(rows, ({ command }) => ({ id: 'rows', actions: [command(edit, { label: 'Missing inputs' })] }))] }) }) } } };
      expect(() => new Engine(state.storage, invalidCommand, {})).toThrow('Command requires a binding');
      const markdown = app.query({ input: z.object({}), output: z.string().nullable(), handler: () => null });
       const markdownDefinition = { ...definition, queries: { markdown }, displays: { displays: { content: ui.display({ metadata: { title: 'Content' }, document: ui.document({ blocks: [ui.markdown(markdown, { id: 'content' })] }) }) } } };
       expect(() => new Engine(state.storage, markdownDefinition, {})).not.toThrow();
    });
  });
  it('builds form defaults, validates without eval and resolves bound versus editable fields', () => {
    const schema = JSON.parse(JSON.stringify(z.toJSONSchema(edit.input, { io: 'input' }))) as JsonSchema;
    expect(defaults(schema)).toEqual({ id: '', revision: 0, title: '' });
    expect(Object.keys(validation(schema, { id: 'a', revision: 2, title: '' })).length).toBeGreaterThan(0);
    expect(validation(schema, { id: 'a', revision: 2, title: 'Valid' })).toEqual({});
    const block = definition.displays!.displays.overview!.document!.blocks[0]!;
    if (block.kind !== 'collection') throw new Error('Expected collection');
    const action = block.actions![0]!;
    expect(actionValues({ ...action, operation: { kind: 'mutation', name: 'edit' } }, { id: 'a', revision: 8, title: 'Editable' }, schema)).toEqual({ id: 'a', revision: 8, title: 'Editable' });
    expect(readPath({}, '__proto__.polluted')).toBeUndefined();
  });
  it('keeps an authorised chat read-only when sending is denied', async () => {
    const conversation = app.view({ input: z.object({}), output: z.object({ messages: z.array(z.object({ id: z.string(), role: z.string(), content: z.string() })) }), dependsOn: [], handler: () => ({ messages: [] }) });
    const send = app.mutation({ input: z.object({ message: z.string() }), output: z.null(), handler: () => null });
    const readOnly = app.define({
      views: { conversation }, queries: {}, mutations: { send }, jobs: {}, authorize: (_ctx, action) => action === 'display:chat' || action.startsWith('view:'),
      displays: { displays: { chat: ui.display({ metadata: { title: 'Chat' }, document: ui.document({ blocks: [ui.chat(conversation, send, { id: 'chat', messages: 'messages', message: { id: 'id', role: 'role', content: 'content' }, promptField: 'message' })] }) }) } },
    });
    const bindings = env as unknown as { TEST: DurableObjectNamespace };
    const stub = bindings.TEST.get(bindings.TEST.idFromName(crypto.randomUUID()));
    await runInDurableObject(stub, (_instance, state) => {
      const manifest = manifestSchema.parse(new Engine(state.storage, readOnly, {}).manifest({ id: 'member' }));
      const block = manifest.ui.displays.chat!.document!.blocks[0]!;
      if (block.kind !== 'chat') throw new Error('Expected chat block');
      expect(block.source).toEqual({ kind: 'view', name: 'conversation' });
      expect(block.send).toBeUndefined();
    });
  });
});
