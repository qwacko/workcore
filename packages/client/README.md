# @workcore/client

Browser-safe typed HTTP/WebSocket client for Workcore applications. Includes live subscriptions, revision tracking, reconnects, shared reactive sources, and action retry IDs.

Once 0.1.0 is published, install with `pnpm add @workcore/client@0.1.0`. It uses the server definition for inferred operation types:

```ts
import { createClient } from '@workcore/client';
import type { application } from './app.js';

const client = createClient<typeof application>({ baseUrl: '/api/workspaces/demo' });
const subscription = client.subscribe('myTodos', {}, state => {
  if (state.status === 'live') console.log(state.data);
});
// Release the subscription and close the client on app teardown/identity change.
```

The operation name above comes from the [getting-started example](https://qwacko.github.io/workcore/getting-started); use your application's registered view names. Import the definition with `import type` to keep server code out of the browser. The API and browser frontend must be same-origin.

See [Workcore](https://qwacko.github.io/workcore/) and the [custom frontend guide](https://qwacko.github.io/workcore/custom-frontends). ESM JavaScript and TypeScript declarations are included.
