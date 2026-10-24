# Authorization

Authentication, workspace access, operation permission, and external exposure are independent checks. UI visibility is not an authorization boundary.

## The gates

1. `auth.authenticate(request)` resolves a trusted actor. Never accept actor IDs from operation input.
2. `services.workspaces.canAccess(actor, scope)` checks membership/access. `workspaces.list` must list only accessible instances; discovery does not provision membership.
3. Workcore validates input before evaluating the operation's permission.
4. HTTP operations additionally require `api: true`. Internal calls need not be externally exposed, but still enforce access and permission.

| Operation `permission` | Meaning |
| --- | --- |
| Missing | Deny |
| `[]` | Explicitly require no named capability; authentication and workspace access still apply |
| `'records.read'` | Require that named capability |
| `['records.read', 'records.export']` | Require **every** named capability |
| Callback | Evaluate validated input and return a boolean; use `access.has()` for named capability checks |

## Workspace authorization context

```ts
const definition = defineApplication()({
  id: 'records',
  authorization: {
    context: z.object({ role: z.enum(['owner', 'viewer']) }),
    check: ({ auth, permission }) => permission === 'records.read'
      || (permission === 'records.write' && auth.role === 'owner'),
  },
  // queries/mutations/tasks...
});
const registration = definition.registerApplication({
  createAppContext: () => repositories,
  resolveAuthorization: async ({ actor, scope }) => ({ role: await membershipRole(actor.id, scope) }),
});
```

The host resolves trusted authorization context; Workcore validates it. Named capabilities require at least one configured authorizer. If both workspace `authorization.check` and platform `authorise` are configured, **both must allow**. An absent authorizer does not grant named permissions. A callback permission is itself a policy and is not automatically subjected to an additional named global gate; call `access.has(capability)` inside it when needed.

## Built-in capabilities

- `workcore.tasks.read`
- `workcore.history.read`
- `workcore.schedules.read`, `workcore.schedules.manage`
- `workcore.agents.runs.read`, `workcore.agents.runs.read.all`
- `workcore.agents.results.read`, `workcore.agents.messages.read`
- `workcore.agents.tools.read`, `workcore.agents.toolPayloads.read`

Handle these in the same authorizer as domain capabilities; hiding built-in pages is not sufficient. Schedule creation also checks the selected task's permission. Agent runs are actor-scoped unless the requester has workspace-wide run access; trace/result capabilities independently filter sensitive content.

## Manifests and rechecks

Manifests hide statically denied operations and filter page/action references. Input-dependent callback policies remain discoverable without being pre-evaluated. A visible operation can still be denied for a particular input. Authorizers can receive `input: undefined` during manifest/built-in checks; do not assume an operation input shape.

Queued/scheduled work resolves the actor again and rechecks workspace access and operation permission. Persisted inputs have already been transformed; version checks prevent incompatible handler changes without applying transformations twice. SSE rechecks workspace access during invalidations and periodic refresh; actual refetches authenticate and authorize again. The open SSE connection does not re-authenticate the original session on every heartbeat, so a host requiring immediate session revocation should enforce connection lifetime/revocation too.

Always scope domain repositories themselves. Passing an unrestricted database alongside `ctx.scope` does not enforce tenant isolation. See [authentication integration](/authentication), [tasks](/tasks), and [security notes](/architecture).
