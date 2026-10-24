import { createClient } from '../packages/client/src/index.js';
import type { tracker } from '../examples/tracker/src/app.js';

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
