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

Spread the returned `{ input, output }` into a regular query (or use `chatMessageQuery()` to require the message-page output contract):

```ts
chatMessages: chatMessageQuery({
  ...chat,
  permission: 'chat.read',
  api: true,
  ui: {
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

The output is a cursor page with `items`, `nextCursor`, optional `previousCursor`, `totalCount`, and page-level `data`. For timeline queries, return each page in stable oldest-to-newest order and use `previousCursor` for the page before the current (older) page. The admin sends that opaque cursor with `direction: 'backward'`, prepends and deduplicates the results, then preserves the first visible message's screen position. The handler remains responsible for interpreting the cursor and returning the next older cursor.

Messages support senders, custom types, status, grouped `sections` containing text/image/file/link/tool or schema-defined parts, mutation-backed action descriptions, and message-level `data`. Unknown custom data should be rendered as JSON by generic admin views.

Use `chatThreadSchemaHelper()` for an independent searchable/filterable thread list. It provides the same cursor envelope and a thread shape with participants, status, last-message preview, counts, actions, and extensible data. `chatThreadDetailSchemaHelper({ thread, message })` composes application-defined schemas into a thread plus cursor-paged messages; `chatThreadDetailQuery()` provides the corresponding query-definition convenience.

The core also exports `tableQuery()`, `chatMessageQuery()`, `chatThreadQuery()`, and `chatThreadDetailQuery()`. These are typed contract helpers over the ordinary query execution pipeline. Validation still comes from the declared Standard Schema, and all database filtering, stable ordering, cursor generation, and authorization remain the application's responsibility. Zod is optional and isolated to `@workcore/schema-zod`.

## Rendering and actions

The admin supports timeline messages and thread views, including grouped sections, safe external links, images, files, custom type/status labels, and expandable JSON for extension data. It loads older pages near the top, auto-follows new messages and same-message content growth when already near the bottom, and offers a jump-to-latest button if the reader is elsewhere. Attachment URLs must be authorized by the application; the admin does not provide an upload or file-storage service.

An action references a named Workcore mutation. Message-provided action data is not executable code and does not authorize a mutation. Mutation mappings belong in trusted UI metadata and the server continues to validate inputs and permissions. Existing generic mutation forms and table actions remain available for editing or deleting chat data.
