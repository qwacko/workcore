import { createClient } from '../packages/client/src/index.js';
import type { tracker } from '../examples/tracker/src/app.js';
import { field, ui, workspace } from '../packages/core/src/index.js';
import { z } from 'zod';

const client = createClient<typeof tracker>({ baseUrl: 'http://localhost/api/workspaces/demo' });
// These declarations are compiled, not executed.
function checkTypes() {
  client.mutate('createTask', { title: 'Typed' }).then(result => {
    const title: string = result.data.data.title;
    // @ts-expect-error Title is not a number.
    const wrong: number = title;
    return wrong;
  });
  client.query('myTaskPage', { limit: 10 });
  client.subscribe('tasks', {}, state => { const done: boolean | undefined = state.data?.[0]?.data.done; return done; });
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

const definitions = workspace({});
const list = definitions.view({ input: z.object({}), output: z.array(z.object({ id: z.string(), revision: z.number() })), dependsOn: [], handler: () => [] });
const edit = definitions.mutation({ input: z.object({ id: z.string(), revision: z.number() }), output: z.null(), handler: () => null });
function checkUI() {
  field(z.string(), { label: 'Name', control: 'textarea' });
  // @ts-expect-error Unknown control types are rejected.
  field(z.string(), { control: 'magic' });
  // @ts-expect-error A checkbox is not a numeric control.
  field(z.number(), { control: 'checkbox' });
  ui.collection(list, ({ form }) => ({ actions: [form(edit, { label: 'Edit', bind: { id: 'id', revision: 'revision' } })] }));
  ui.collection(list, ({ form }) => ({ actions: [form(edit, { label: 'Edit', bind: {
    // @ts-expect-error Source path does not exist.
    id: 'missing',
  } })] }));
  ui.collection(list, ({ form }) => ({ actions: [form(edit, { label: 'Edit', bind: {
    // @ts-expect-error A string source cannot bind to a numeric destination.
    revision: 'id',
  } })] }));
  ui.collection(list, () => ({ columns: [
    // @ts-expect-error Invalid column path.
    { path: 'missing' },
  ] }));
}
void checkUI;
