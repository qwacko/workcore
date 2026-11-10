# Custom frontends and chat

Workcore supplies typed operations, authorized live queries, durable storage and background execution. Applications own their routes, components, local state and appearance. A custom frontend does not need an admin manifest, registered UI components, display documents or a layout protocol.

## Use the typed client

Install `@workcore/client` alongside the matching server package version. Create one client per active authenticated session and workspace URL; multiple components may share that instance. The frontend framework is your choice. The API and frontend should share an origin: HTTP requests use same-origin cookies, and the WebSocket handshake is authenticated by the host Worker.

| Method | Purpose | Result/lifetime |
| --- | --- | --- |
| `client.query(name, input)` | Read a registered view or query once | Promise of `{ data, revision }`; does not subscribe or automatically refresh |
| `client.mutate(name, input)` | Call a registered mutation | Promise of `{ data, revision }`; dependent live views update independently |
| `client.subscribe(name, input, listener)` | Observe a registered view | Returns a subscription with `unsubscribe()`, `state` and `whenRevision(...)` |
| `client.subscribeSystem(name, input, listener)` | Observe supported system resources such as run progress | Same lifecycle; system authorization still applies |
| `client.close()` | End a session/workspace client | Closes transport, clears retained data and prevents further use; create a new instance to reconnect as another actor |

Names and input/output shapes are inferred from the application definition. Do not use `query` to call an arbitrary SQL query or assume a registered one-shot query can be subscribed to as a view.

```ts
import { createClient } from '@workcore/client';
import type { tracker } from './server-definition';

const client = createClient<typeof tracker>({ baseUrl: '/api/workspaces/demo' });
const subscription = client.subscribe('tasks', { projectId: 'inbox' }, state => {
  // Render loading/error explicitly; replace the displayed result with state.data.
  // If reconnecting with data, identify it as stale rather than current.
  // Do not preserve a previous user's private data when state.data is absent.
});
const result = await client.mutate('createTask', { title: 'Review the release', private: true });
await subscription.whenRevision(result.revision);
// Dispose subscriptions when their consumer unmounts; close the client on logout.
subscription.unsubscribe();
client.close();
```

Create authenticated clients per session. Changes to the authenticated actor require a new client; changing UI metadata does not reauthenticate an open socket. A successful mutation triggers the declared dependent views. The server independently authorizes every read and write; UI affordances and record IDs grant no additional authority.

Create subscriptions in your framework's mount/effect lifecycle, not on every render. When inputs change, unsubscribe the old consumer and subscribe with the new values. On logout/account switching, close the old client and clear the application's own component state too. A server-side authorization error is not just a cosmetic warning: stop displaying denied data.

`LiveState<T>` has `status: 'loading' | 'live' | 'reconnecting' | 'error'`, optional `data`, a numeric `revision`, and an optional `{ code, message }` error. Callback snapshots replace previous results; they are not patches to merge into a growing list. HTTP calls reject with `ClientError` on failure. An accepted mutation's revision and a record's edit version are different concepts: use the former for observing writes, the latter for optimistic concurrency.

`whenRevision` confirms that the subscription has observed at least that workspace revision. It is not a guarantee that a future job finished or that a mutation emitted all the keys it should have. Handle a failed wait without resubmitting an already accepted write.

Queries return finite results. Use explicit cursor inputs/outputs for history and large datasets. A live working set and older paginated history can be combined in the application: keep a bounded live tail, merge older pages by stable record ID, and preserve the reader's scroll position. Use an indexed `(timestamp, id)` cursor so equal timestamps cannot skip or duplicate messages. There is no special chat table or infinite-scroll protocol in the library.

For all method signatures/results, request IDs, system inspection, files and renderer helpers, see the [client API reference](./client-api). For host verification and namespace routing, see the [Worker reference](./hosting).

## Shared reads and retained live data

Sharing is built into `createClient`, independent of a frontend framework or admin renderer. Equivalent live subscriptions (resource kind, operation name and canonical JSON input) on the same client share one server subscription. Each consumer has its own listener, cleanup and revision waiters; releasing one does not interrupt the others. New consumers receive the current result synchronously.

The defaults retain the server subscription for one second after its last consumer leaves, preventing unsubscribe/subscribe churn during component handoffs. After that, the client retains up to 64 inactive snapshots for 30 seconds. A cached snapshot is delivered with `status: 'reconnecting'`, and a fresh server snapshot confirms it before it becomes `live`. Views continue to update normally while subscribed; this is not a permanent result cache.

```ts
const client = createClient<typeof tracker>({
  baseUrl: '/api/workspaces/demo',
  subscriptions: { keepAliveMs: 1000, cacheTimeMs: 30_000, maxCached: 64 },
});
```

Set `keepAliveMs: 0` for immediate server unsubscribe, and `cacheTimeMs: 0` or `maxCached: 0` to disable inactive snapshot retention. Closing the client clears snapshots and timers and rejects further requests. Policy errors clear affected live data; an access-expiry close clears inactive previews as well. All sharing is in memory and scoped to the client instance: no localStorage, cross-user cache or cache shared solely by URL. Treat delivered data as read-only.

Concurrent identical `query()` calls also share their HTTP request. Completed one-shot results are not retained. Starting or completing a write clears in-flight query sharing, so a subsequent read does not reuse a request started before the write. The server continues to authorize every read and write.

UI subscriptions should depend on stable query values rather than the identity of a new message object. The demo keeps attachment components and local filters mounted when conversation snapshots arrive, pauses off-screen consumers without discarding their rendered content, and restores shared live data when they return. Source changes still select a distinct resource; errors remain visible rather than disguising revoked data as current.

## Application-owned chat attachments

An application can define its own validated message parts:

```ts
type Attachment =
  | { type: 'task'; taskId: string }
  | { type: 'task-list'; projectId: string; status: 'all' | 'open' | 'done' }
  | { type: 'note'; noteId: string }
  | { type: 'note-list'; query: string; starredOnly: boolean };
```

Expose typed operations to the agent using `operationTool`. A final reply tool persists text and these parts. The frontend maps each part to an ordinary component. A task card subscribes to task details; a task list subscribes to project tasks and applies its own interaction state. The same task/note components can appear in a standalone workspace. No UI schema or executable HTML travels in the message.

Persist references and filters in attachments. Message prose records what was said at the time; an attached component resolves current data under the viewer's authority. If a record disappears or becomes inaccessible, show an unavailable state. Keep subscriptions bounded: the demo activates attachments near the viewport rather than subscribing to every historic message's data.

Cross-workspace access is explicit. The demo creates separately authenticated task and Notes clients. Its agent uses an application adapter carrying the current actor to the Notes Durable Object. This is not a generic federation layer or a cross-workspace transaction.

## Progress, streaming and durability

`createAI().run` accepts an optional `onTextDelta(delta, turn)` callback. Supplying it uses SDK streaming while retaining the existing budgets, cancellation and checked tool loop. Applications decide how to deliver transient inference text. The demo throttles a bounded preview into run progress, observed through `subscribeSystem('runs.inspect', { runId }, listener)`. It is intended for progress feedback; complete messages are written by the terminating reply tool. Intermediate inference prose is not the persisted final answer.

Use `client.control('run', runId, 'cancel')` for explicit cancellation. Completed mutations remain committed. Cancellation does not roll back earlier tools. Losing a browser connection does not cancel a durable run; reconnecting retrieves persisted messages and current run progress. Streaming is not automatic resumption of an interrupted model request or replay of lost deltas.

## Demo frontend

The SvelteKit demo uses [shadcn-svelte](https://www.shadcn-svelte.com/docs) components copied into `src/lib/components/ui`, Tailwind and application-owned Svelte components. Its conversation uses MessageScroller for auto-follow, jump-to-end and prepend preservation; messages use Message/Bubble; tasks and notes reuse the same controls and editors in chat and their workspaces.

Add components from the demo directory with `pnpm dlx shadcn-svelte@latest add <component>`. `components.json` records the style and aliases. Workcore’s core, client and AI packages do not depend on shadcn-svelte, Svelte or these application message-part types.

The optional admin console still uses operation metadata and its internal display renderer. Existing compiled admin pages remain supported. The public custom-frontend renderer, saved display authoring capability and persisted wire-document resolver have been removed. Historical database migrations are retained, so upgrading does not delete old saved-page data; it is no longer exposed or executed. Legacy chat task/note references are translated into the new application parts, while old page attachments are omitted and their message text remains readable.
