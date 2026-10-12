# Authoring operations

Define queries, mutations, and tasks together. Schemas drive inferred handler/client types and server validation; `api: true` opts an operation into external calls. UI metadata is presentation only and never grants access.

```ts
import { defineWorkspace } from '@workcore/core';
import { z } from 'zod';

type AppContext = { activities: {
  list(scope: { applicationId: string; workspaceId: string }, input: { limit: number }): Promise<{ rows: Array<{ id: string; title: string }>; nextCursor: null }>;
} };

export const tracker = defineWorkspace<AppContext>()({
  id: 'tracker',
  queries: {
    activities: {
      input: z.object({ limit: z.number().int().min(1).max(100) }),
      output: z.object({ rows: z.array(z.object({ id: z.string(), title: z.string() })), nextCursor: z.null() }),
      permission: 'activities.read',
      api: true,
      handler: ({ ctx, input }) => ctx.app.activities.list(ctx.scope, input),
    },
  },
});
```

Register the definition with the host's trusted authentication and context factory, then mount `platform.httpHandler()` in the host. The [tracker example](https://github.com/qwacko/workcore/tree/main/examples/tracker/src) contains a complete query/mutation/task catalog, authorization context, and typed client use.

## Operation guidance

- Queries should be read-only; live clients may refetch them automatically.
- Mutations are not automatically transactional. A timeout or output-validation error can occur after side effects; it does not mean rollback.
- Tasks are queued and may execute more than once after recovery. Make side effects idempotent where practical.
- Permissions default to deny. Check workspace access independently, and use `api: true` only for intended external operations.
- Generated manifests/forms need Standard JSON Schema in addition to Standard Schema validation. Unsupported shapes use the JSON editor.

See [architecture and security](/versions/0.1.0/architecture) for execution contracts and [production deployment](/versions/0.1.0/production-deployment) for PostgreSQL/Redis composition.
