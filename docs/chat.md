# Chat query contracts

Chat data and permissions remain application-owned. Workcore supplies reusable output types, query-definition helpers, renderer metadata, and an optional Zod 4 schema adapter. These helpers do not search storage, generate cursors, or grant access.

## Build spreadable input and output schemas

Install `@workcore/schema-zod` alongside Zod 4. The message type schema is reused for returned message types and the query's `types` filter. Extension schemas are attached to explicit `data` fields; application-specific filters are supplied separately.

```ts
import { chatSchemaHelper } from '@workcore/schema-zod';
import { z } from 'zod';

const chat = chatSchemaHelper({
  messageType: z.enum(['message', 'prompt', 'approval']),
  messageData: z.object({ ticketId: z.string().optional() }),
  sectionData: z.object({ emphasis: z.enum(['normal', 'important']).optional() }),
  pageData: z.object({ matchedCount: z.number().int() }),
  filters: z.object({ participantId: z.string().optional() }),
});
```

Use one chat-message query contract for read-only timelines and composer-enabled conversations. `chatSchemaHelper` supplies paging, search, thread/conversation selectors, extensible message schemas, optional conversation/thread context, and metadata such as active runs. Its only page collection is `items`; handlers adapt stored records into that shape. `chatMessageZodQuery` provides a default timeline view and retains authored view types:

```ts
const chatSchemas = chatSchemaHelper({
  messageType: z.enum(['message', 'prompt', 'approval']),
  messageStatus: z.enum(['complete', 'streaming', 'failed']),
  conversation: z.object({ id: z.string(), title: z.string() }),
  activeRuns: z.array(z.object({ runId: z.string(), status: z.string() })),
  filters: z.object({ ownerId: z.string().optional() }),
});

chatMessages: chatMessageZodQuery<AppContext>()({
  ...chatSchemas,
  views: {
    default: 'chat',
    variants: {
      timeline: { title: 'Messages', renderer: 'chat-messages' },
      chat: { title: 'Conversation', renderer: 'chat', chat: {
        sendMutation: 'sendMessage', messageInput: 'message', conversationQueryInput: 'conversationId',
        placeholder: 'Ask a question…', submitLabel: 'Send', rows: 4,
        inputBindings: { channel: { fromConversation: 'conversation.channel' } },
      } },
    },
  },
  permission: 'chat.read',
  api: true,
  handler: ({ ctx, input }) => ctx.app.chat.searchMessages(ctx.scope, input),
}),
```

For lower-level composition, spread the `{ input, output }` from `chatSchemaHelper()` into a regular query and use `chatMessageQuery()` to require the message-page output contract:

```ts
chatMessages: chatMessageQuery({
  ...chat,
  permission: 'chat.read',
  api: true,
  views: {
    default: 'timeline',
    variants: {
      timeline: {
        title: 'Messages',
        renderer: 'chat-messages',
      },
    },
  },
  handler: ({ ctx, input }) => ctx.app.chat.searchMessages(ctx.scope, input),
}),
```

The canonical output is a cursor page with `items`, optional conversation/thread context, `nextCursor`, optional `previousCursor`, `totalCount`, typed `data`, and optional `activeRuns`. There is no parallel `messages` or `threads` result field. A thread-detail response uses this same envelope with `thread` plus message `items`. The composer is shown only when the selected view declares `chat.sendMutation` and `chat.messageInput`; extra mutation inputs may bind to values from the conversation/thread result or be static JSON. Sending and other actions remain normal authorized mutations. For timelines, return pages in stable oldest-to-newest order and use `previousCursor` for the older-page cursor.

Messages support senders, custom types/status, grouped `sections`, and text/image/file/link/tool/navigation content. External links and attachment URLs allow only HTTP(S), mailto, or same-origin relative paths; raw HTML is escaped in Markdown. Use a `navigation` part for in-app navigation rather than encoding admin routes in URLs. It names a manifest page and may set only that page's declared state fields; select values are checked against the page options before navigation.

A `queryView` part refers to a named Workcore query/view and JSON input; the admin fetches it separately through the standard query route and renders its JSON/table/chart presentation. Results are cached independently with a short TTL under an app-provided cache namespace. The namespace rotates on workspace changes and live invalidation. Hosts that change the authenticated actor/session in place should dispatch `workcore:auth-scope-change` on `window` (optionally with `{ detail: { namespace: '<new-opaque-scope>' } }`) so the admin clears the old namespace and refetches under the new one. Query names are resolved against the actor-visible manifest and the server still performs normal authorization and input validation. A `customLayout` part is versioned declarative JSON (stack/grid with text, metric, table, and chart blocks), never executable code; unsupported layout forms fail closed.

Use `chatThreadSchemaHelper()` for an independently searchable/filterable thread list. Its renderer includes search, cursor paging, and thread selection. Configure `chatList.threadQuery`, `threadIdInput`, and optionally `detailVariant` to open a selected thread through a named, visible query. That detail query uses `chatSchemaHelper()` with a `thread` schema and returns the thread context with cursor-paged message `items`.

The core exports validator-agnostic typed query helpers; `@workcore/schema-zod` exports `chatMessageZodQuery<App>()(options)` for the extensible chat schema and a default `chat-messages` view. Application handlers still own filtering, stable ordering, cursors, and access checks.

## Rendering and actions

The admin supports timeline messages and thread views, including grouped sections, safe external links, images, files, custom type/status labels, basic Markdown, in-app navigation, and declarative custom layouts. It loads older pages near the top, auto-follows new messages and same-message content growth when already near the bottom, and offers a jump-to-latest button if the reader is elsewhere. Attachment URLs must be authorized by the application; the admin does not provide an upload or file-storage service. The stock composer is text-based; applications needing upload, voice, or other specialized input should provide their own presentation while keeping sends on authorized mutations.

An action has an application-defined ID, label, and JSON input. Trusted view metadata maps arbitrary action IDs to named Workcore mutations and input bindings. Message-provided action data is not executable code and does not authorize a mutation; the server continues to validate inputs and permissions. This supports application-defined actions such as edit, archive, retry, and fork without baking those semantics into the protocol.
