// Executable/typechecked authoring examples; no server implementation enters the browser bundle.
import { createClient } from '@workcore/client';
import type { tracker } from './app.js';

export function connectTracker(baseUrl: string) {
  const client = createClient<typeof tracker>({ baseUrl });
  const subscription = client.subscribe('tasks', { projectId: 'inbox' }, state => {
    if (state.status === 'live') console.log(state.data?.filter(row => !row.done));
  });
  return {
    async create(title: string) {
      const result = await client.mutate('createTask', { title });
      await subscription.whenRevision(result.revision);
      return result.data;
    },
    firstPage: () => client.query('myTaskPage', { limit: 25 }),
    assistant: () => client.enqueue('assistant', {}),
    close: () => client.close(),
  };
}
