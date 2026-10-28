# File storage

`@workcore/files` is an optional R2-backed file feature. Add its predefined Drizzle `fileTable` to the schema passed to `defineSchema`, and set the definition's `files` capability explicitly. Include the table in your Drizzle Kit schema so its SQL migration is bundled with the application.

```ts
import { defineSchema, workspace } from '@workcore/core';
import { fileStorage, fileTable } from '@workcore/files';

const tables = defineSchema({ users: userTable, files: fileTable });
const app = workspace(tables, migrations);

const definition = app.define({
  // views, mutations, jobs, admin and authorize are application-owned
  files: fileStorage<Env>({ bucket: env => env.FILES_BUCKET, maxSize: 25 * 1024 * 1024 }),
  authorize: ({ db, actor }, action) => {
    const member = db.select().from(userTable).where(eq(userTable.id, actor.id)).get();
    if (!member) return false;
    if (action === '$admin') return member?.role === 'admin';
    return true; // file access still enforces owner-only access unless admin
  },
});
```

Bind a Cloudflare R2 bucket as `FILES_BUCKET`. Use the authenticated Workcore worker routes `POST /api/workspaces/:workspace/files`, `GET /files`, `GET /files/:id` and `DELETE /files/:id`. The client exposes matching `client.files.upload(file)`, `list()`, `download(id)` and `remove(id)` helpers. Upload bodies are streamed; file bytes never enter SQLite.

Each metadata row gets a server-generated file ID and contains owner, filename, content type, size and lifecycle timestamps. Clients never supply storage keys. Operations require the `file:upload`, `file:list`, `file:download` and `file:delete` authorization actions; downloads and deletes are owner-scoped unless the actor is a `$admin`. Keep file relationships such as task attachments in application-owned tables referencing file IDs.

SQLite and R2 do not share a transaction. Uploads are first recorded as `pending`, bytes are stored and size-verified, then the row becomes `ready`. Deletions become `deleting` before R2 removal. The Durable Object alarm retries deleting objects and removes pending uploads after 24 hours. A failed object operation can therefore leave a visible pending/deleting row until cleanup succeeds.

The admin console adds a Files page when the definition includes file storage and the actor is authorized to list files. It supports upload, metadata inspection, download and deletion, while raw R2 keys are not exposed. Set the maximum size appropriate to the workload; this initial API requires a known `Content-Length` and does not implement multipart/resumable uploads.
