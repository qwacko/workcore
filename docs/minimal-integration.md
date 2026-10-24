# Minimal integration

This is a complete, typechecked integration, independent of the tracker's SQLite, Better Auth, or admin UI. It uses memory adapters and a private bearer token for a single local example actor. Production applications should use their own trusted authentication and durable repositories.

```sh
pnpm add @workcore/core @workcore/client zod
```

Save the following as `minimal.ts`. The repository executes this exact source in an integration test:

<<< ../examples/tracker/src/minimal.ts

## Run without a network server

```ts
import { createMinimalExample } from './minimal.js';

const { client } = createMinimalExample(process.env.DEMO_API_TOKEN!);
console.log(await client.query('count', {})); // 0
console.log(await client.mutate('add', { amount: 2 })); // 2
console.log(await client.queryDetailed('count', {})); // result + execution/correlation IDs
```

Use a TypeScript runner or compile with your project's TypeScript setup. A non-empty private token is required; do not embed it in a public browser bundle. The injected fetch adapter routes requests through the actual HTTP handler, including authentication, membership, authorization, schema validation, and serialization.

## Mount in a host

The same `handle` accepts a Web `Request` and returns a `Response`. Mount it in your existing server, or use a small Node host:

```sh
pnpm add @hono/node-server
```

```ts
import { serve } from '@hono/node-server';
import { createMinimalExample } from './minimal.js';

const { handle } = createMinimalExample(process.env.DEMO_API_TOKEN!);
serve({ fetch: handle, hostname: '127.0.0.1', port: 3000 });
```

For a network client, remove the injected `fetch` from `createFetchTransport` and set the real `baseUrl`. For browser subscriptions, prefer same-origin secure session cookies; native EventSource cannot inherit bearer headers. See [transport configuration](/configuration#client-and-transport).

No worker is needed for this query/mutation-only example. To add background execution, supply `auth.resolveActor` and start a worker; see [tasks](/tasks). To add the optional prebuilt console, see [admin mounting](/configuration#http-and-admin-mounting).
