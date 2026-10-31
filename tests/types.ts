import { createClient } from '../packages/client/src/index.js';
import type { tracker } from '../examples/workcore-demo/src/app.js';
import { defineSchema, field, ui, workspace } from '../packages/core/src/index.js';
import { z } from 'zod';

const client = createClient<typeof tracker>({ baseUrl: 'http://localhost/api/workspaces/demo' });
// These declarations are compiled, not executed.
function checkTypes() {
  client.mutate('createTask', { title: 'Typed' }).then(result => {
    const title: string = result.data.title;
    // @ts-expect-error Title is not a number.
    const wrong: number = title;
    return wrong;
  });
  client.query('myTaskPage', { limit: 10 });
  client.display('project', { projectId: 'inbox' });
  // @ts-expect-error Dynamic display input is inferred from its schema.
  client.display('project', { projectId: 10 });
  client.subscribe('tasks', {}, state => { const done: boolean | undefined = state.data?.[0]?.done; return done; });
  // @ts-expect-error Unknown mutation name.
  client.mutate('missing', {});
  // @ts-expect-error Required title input.
  client.mutate('createTask', {});
  // @ts-expect-error Wrong input type.
  client.query('myTaskPage', { limit: 'ten' });
  // @ts-expect-error Paginated queries are not live views.
  client.subscribe('myTaskPage', {}, () => {});
  // @ts-expect-error Unknown job.
  client.enqueue('missing', {});
}
void checkTypes;

const definitions = workspace(defineSchema({}), { journal: { entries: [] }, migrations: {} });
const triggered = workspace(defineSchema({}), { journal: { entries: [] }, migrations: {} }, { triggerKeys: ['notes', 'audit'] });
triggered.view({ input: z.object({}), output: z.null(), dependsOn: ['notes'], handler: () => null });
// @ts-expect-error View dependencies are restricted to configured or built-in trigger keys.
triggered.view({ input: z.object({}), output: z.null(), dependsOn: ['unknown'], handler: () => null });
triggered.mutation({
  input: z.object({}), output: z.null(), triggers: ['notes'],
  handler: ({ trigger }) => {
    trigger('audit');
    // @ts-expect-error Dynamic invalidations use the same configured key type.
    trigger('unknown');
    return null;
  },
});
const list = definitions.view({ input: z.object({}), output: z.array(z.object({ id: z.string(), revision: z.number() })), dependsOn: [], handler: () => [] });
const edit = definitions.mutation({ input: z.object({ id: z.string(), revision: z.number() }), output: z.null(), handler: () => null });
const details = definitions.view({ input: z.object({ taskId: z.string() }), output: z.object({ id: z.string() }), dependsOn: [], handler: () => ({ id: 'one' }) });
const numberDetails = definitions.view({ input: z.object({ taskId: z.number() }), output: z.object({ id: z.string() }), dependsOn: [], handler: () => ({ id: 'one' }) });
function checkUI() {
  field(z.string(), { label: 'Name', control: 'textarea' });
  // @ts-expect-error Unknown control types are rejected.
  field(z.string(), { control: 'magic' });
  // @ts-expect-error A checkbox is not a numeric control.
  field(z.number(), { control: 'checkbox' });
  ui.collection(list, ({ form }) => ({ id: 'valid-rows', actions: [form(edit, { label: 'Edit', bind: { id: 'id', revision: 'revision' } })] }));
  ui.collection(list, ({ form }) => ({ id: 'invalid-path-rows', actions: [form(edit, { label: 'Edit', bind: {
    // @ts-expect-error Source path does not exist.
    id: 'missing',
  } })] }));
  ui.collection(list, ({ form }) => ({ id: 'incompatible-rows', actions: [form(edit, { label: 'Edit', bind: {
    // @ts-expect-error A string source cannot bind to a numeric destination.
    revision: 'id',
  } })] }));
  ui.collection(list, () => ({ id: 'invalid-column-rows', columns: [
    // @ts-expect-error Invalid column path.
    { path: 'missing' },
  ] }));
  ui.combined.masterDetail(list, details, { id: 'tasks', title: 'Tasks', key: 'id', detailInput: 'taskId' });
  ui.combined.masterDetail(list, numberDetails, { id: 'bad-tasks', title: 'Bad tasks',
    // @ts-expect-error Selected string row IDs cannot bind to a numeric source input.
    key: 'id', detailInput: 'taskId',
  });
  const dynamicDisplay = definitions.display({
    input: z.object({ slug: z.string() }), metadata: { title: 'Detail' },
    handler: (_context, input) => {
      const slug: string = input.slug;
      // @ts-expect-error Display input is inferred and checked from its Zod schema.
      const wrong: number = input.slug;
      void wrong;
      void slug;
      return ui.document({ blocks: [] });
    },
  });
  void dynamicDisplay;
}
void checkUI;
