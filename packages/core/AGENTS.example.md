# Developing an application with Workcore

Copy or merge this file into the consuming application's `AGENTS.md`. Adapt the
file paths and commands to that app. This is guidance for coding agents, not
runtime model instructions. Read existing project instructions before changing code.

## Read first

- Check `package.json` and the installed `@workcore/*` versions; this guide targets 0.1.x.
- Read the existing schema, migration bundle, application definition, host Worker and client setup.
- Public documentation: https://qwacko.github.io/workcore/getting-started and https://qwacko.github.io/workcore/authoring
- Use installed declarations and existing application code as the authority if documentation differs.
- Do not invent APIs such as `app.table()`, a database adapter, a client-side SQL API, or automatic migration generation at runtime.

## Packages and boundaries

- `@workcore/core`: `defineSchema`, `workspace`, operation definitions, JSON/error and concurrency helpers.
- `@workcore/core/schema`: internal Drizzle table exports for Drizzle Kit.
- `@workcore/core/cloudflare`: `Workspace`, `routeWorkspace`, and host `Session` type. Server-only.
- `@workcore/client`: `createClient<typeof application>()`. Import the application with `import type`, never bundle its server implementation into a browser.
- Optional: `@workcore/files` for R2 files, `@workcore/ai` for AI SDK agents.
- Optional: `@workcore/admin/server` serves the prebuilt console; `@workcore/admin/assets` copies its assets in Node build tooling, not Worker code.
- One workspace is one SQLite Durable Object/storage boundary. Do not introduce teams, organizations or a role schema unless the app actually requires them.

## Schema and migrations

- Use ordinary Drizzle SQLite tables. Pass `defineSchema({ ...applicationTables })` to `workspace(schema, migrations, options)`.
- Export the internal tables from `@workcore/core/schema` alongside application tables in the schema file used by Drizzle Kit. A nested `schema` object alone is not a replacement for those exports.
- Run the app's Drizzle generation and migration-ingestion scripts after schema changes. Commit SQL, snapshots, journal and the generated migration bundle together.
- Never rewrite an already-applied migration, reset a database or delete user data to make a schema change pass.
- Workcore applies bundled migrations synchronously at DO startup. Durable Object class migrations in Wrangler are a separate configuration concern.

## Operations and permissions

- Define `app.view`, `app.query`, `app.mutation`, `app.task` or `app.agent`, then register them in `app.define({ views, queries, mutations, jobs, authorize })`.
- Define Zod input and output schemas. Wire values must be plain JSON: no Date, bigint, undefined, non-finite numbers, custom classes or cycles. Use epoch milliseconds for dates.
- View/query/mutation handlers and `authorize` must be synchronous. No fetch, model call, timers or other external effects inside them. Do not retain database contexts/builders for later use.
- Mutations atomically commit SQL, internal KV, queued jobs and schedules. Use `ctx.enqueue` and `ctx.schedule` when work must be committed with data changes.
- The host owns authentication. `routeWorkspace.authenticate` returns a verified `{ actor: { id }, expiresAt }` session or null; never derive authority from browser-supplied IDs/roles.
- `authorize` checks operation-level access (`view:name`, `query:name`, `mutation:name`, `job:name`, `$connect`, `$runs`, `$admin`, and configured file actions). Handlers still enforce row/field permissions and write ownership.
- Filter private records on the server. Browser filters are presentation only. `$admin` exposes powerful all-user inspection; do not grant it just to show a page.
- For edits/deletes, use an ownership predicate plus `versionMatch(column, expectedVersion)` in the same SQL statement; increment the version and call `requireChanged` on the returned row. Handle 409 conflicts without automatically overwriting another edit.

## Live reads and client lifecycle

- Declare invalidation keys with `workspace(..., { triggerKeys: [...] as const })`; use matching mutation `triggers` and view `dependsOn` arrays. Emit dynamic keys with `ctx.trigger(...)`.
- Omitted triggers/dependencies use safe wildcard behavior. Empty arrays deliberately opt out of static invalidation; never use them accidentally.
- If permission data changes a view's row/field projection, include its key in dependencies and emit it when that policy changes.
- Array live views default to 500 rows, maximum 1,000; fetch one extra row so an oversized result fails instead of silently truncating. Large collections need indexed, cursor-paginated queries.
- SQL queries need explicit bounds; `.all()` is not an automatic SQL LIMIT.
- `client.query` is a one-shot read. `client.subscribe` provides live state; handle loading/reconnecting/error states and clear displayed private data on denial.
- Use `subscription.whenRevision(result.revision)` when a UI must wait for an accepted write to appear. Release subscriptions and close the client on teardown or identity changes.
- Mutations/enqueues use bounded request-ID deduplication. Preserve an ID for an identical retry after an uncertain network result; a new ID is a new submission.

## Jobs, agents and external effects

- Jobs access data through registered read/mutation operations. Agent tools must also be explicitly allowlisted.
- Route external work through `ctx.step`, pass `ctx.signal` to cooperative clients, and keep sensitive step results small. Default maxSteps is 20, hard maximum 100; step results are limited to 32 KiB.
- External effects are not exactly-once. Only enable task retries when effects are idempotent. Agents do not automatically retry; interrupted runs require inspection before explicit retry.
- Optional task `timeoutMs` aborts cooperatively. It cannot kill arbitrary application code. Timeouts interrupt the run rather than automatically replay uncertain effects.
- Do not call private `/inspect` or `/system` operations as a shortcut around application authorization.

## Verification and release safety

- Run the app's typechecks/tests/build after changes. Cover unauthorized reads/writes, private data, stale edits and live updates when changing permissions or mutations.
- Use Wrangler local development and a deployment dry run before a real deploy. Check DO bindings/class exports, SQLite class migrations, asset paths and any R2/auth bindings.
- Keep secrets in server bindings; never put them into browser environment variables, logs, committed files or agent prompts.
- Backup/restore helpers from `@workcore/core/backup` are trusted operator APIs. They require host-enforced maintenance mode, exact schema compatibility and separate file recovery; never expose them to normal clients or model tools.
- Do not publish npm packages, deploy to Cloudflare, alter production resources or perform destructive recovery without explicit authorization.
