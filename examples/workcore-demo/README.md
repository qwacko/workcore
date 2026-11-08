# workcore-demo

A SvelteKit single-page workspace, served by a Cloudflare Worker. The tasks and notes interfaces use typed `@workcore/client` live subscriptions; tasks can be filtered to your own or everyone's shared work. Notes are private. The default Workcore console is available at `/admin/demo` and `/admin/notes`. Tasks and notes are separate Durable Objects; Better Auth uses D1 for accounts.

## Local development

Copy `.env.example` to `.env` in this directory and set `BETTER_AUTH_URL` to the exact browser origin. `pnpm dev` at the repository root builds both static frontends and starts Vite and Wrangler. Create an account to get started. Local D1 and Durable Object data are persisted by Wrangler. `DEMO_MODE=true` permits a development-only auth secret if none is set; never use it in production.

The SPA subscribes to bounded live datasets (up to 500 tasks in the inbox and 200 notes per list). Shared task visibility is enforced on the server, not by the Mine/Everyone filter. Task changes and note edits use revisions to avoid silently overwriting concurrent changes.

## Administrator access

Accounts have ordinary application access by default. To grant an existing, trusted account access to administrator operations in **both** workspaces:

1. Create the account first and confirm its identity out of band. Better Auth user IDs are generated IDs, not email addresses. For local development, inspect the local D1 database:

   ```sh
   pnpm --filter workcore-demo exec wrangler d1 execute AUTH_DB --local --env local --command 'SELECT id, email FROM user'
   ```

2. Copy the exact `id` into `WORKCORE_ADMIN_IDS` in `examples/workcore-demo/.env` (comma-separated for multiple administrators), then restart `pnpm dev`. Do not use names or email addresses: the demo does not verify email ownership. An empty or absent list grants no configured administrators.
3. Open the Admin link again. Administrator operations include raw table access, which can expose **all users' private tasks and notes**, as well as run and schedule controls. Grant it only to trusted operators.

For a deployed Worker, inspect the production database with `wrangler d1 execute AUTH_DB --remote --env='' --command 'SELECT id, email FROM user'`, then set `WORKCORE_ADMIN_IDS` as a Worker secret (`wrangler secret put WORKCORE_ADMIN_IDS --env=''`) or as a Worker variable and deploy. To revoke configured access, remove the ID and redeploy/restart the Worker. The tracker also retains its pre-existing per-workspace `members.role = 'admin'` authorization; if an operator has manually granted that role in a workspace database, remove it there too. Never put administrator IDs into client-controlled headers or use an unverified email as an authorization rule.

## Cloudflare deployment

Deploying this application to Cloudflare does **not** publish the library packages to npm. The app stays private; the reusable `@workcore/*` packages have a separate [publication procedure](../../docs/publishing.md).

1. Install the repo dependencies and authenticate Wrangler to the intended Cloudflare account:

   ```sh
   pnpm install --frozen-lockfile
   pnpm exec wrangler login
   pnpm exec wrangler whoami
   ```

2. Create the application's production resources (these commands create real resources):

   ```sh
   pnpm --filter workcore-demo exec wrangler d1 create workcore-auth --env=''
   pnpm --filter workcore-demo exec wrangler r2 bucket create workcore-files --env=''
   ```

   Replace the production `AUTH_DB.database_id` placeholder in `wrangler.jsonc` with the returned D1 ID. Keep the R2 bucket name in sync if you choose a different name. The `WORKSPACES` and `NOTES` bindings and `new_sqlite_classes` class migrations are already configured; Wrangler provisions those Durable Object namespaces during deployment. Application SQL migrations are bundled separately and applied by Workcore; Better Auth initializes its D1 schema through the example's auth setup.

3. Configure production secrets using the default environment (`--env=''`), **not** the local demo environment:

```sh
pnpm --filter workcore-demo exec wrangler secret put BETTER_AUTH_SECRET --env=''
pnpm --filter workcore-demo exec wrangler secret put BETTER_AUTH_URL --env=''
```

   Enter a unique random auth secret of at least 32 characters and the exact public HTTPS origin you intend to use, without a path. Local `.env` values are not a production secret deployment mechanism. Leave production `DEMO_MODE=false`. Optional model-provider secrets must also be installed as Worker secrets if you enable model inference.

4. Verify the application artifact without deploying:

   ```sh
   pnpm typecheck
   pnpm test
   pnpm build
   pnpm test:packages
   ```

   `pnpm build` compiles the app/admin assets and runs Wrangler with `--dry-run`. `pnpm test:packages` packs the five libraries, checks the documented usage, and builds a temporary copy of **this same example** against their published exports. It uses installed third-party dependencies, not a registry installation, and makes no remote changes.

5. Deploy explicitly when ready:

   ```sh
   pnpm deploy
   ```

   The command rebuilds, performs a dry run and then deploys the Worker/static assets. Open the configured public origin, sign up/sign in, create a todo and a note, and verify updates across two tabs. Grant administrator inspection using the earlier instructions only to a trusted account. Check the Files page and a scheduled job if using those capabilities.

This sample permits account creation without email verification; choose the appropriate authentication policy before exposing it publicly. Rehearse [backup and recovery](../../docs/recovery.md) before putting important data into it.

The example's access rules are intentionally small: shared or private todos, owner-only task changes, private notes, and explicitly granted administrator inspection. There is no team setup or enrollment flow. See [application permissions](../../docs/multi-user.md) for the boundary between host authentication, operation access and record-level checks.

## Custom frontend and chat

The frontend uses shadcn-svelte, Tailwind and ordinary typed Workcore subscriptions. Tasks and notes share application components with chat attachments. There is no dependency on an over-the-wire UI layout protocol. Add components with `pnpm dlx shadcn-svelte@latest add <component>` from this directory.

Chat has a 40-message live tail, cursor-based older history, anchored scrolling, multiline composition, Markdown, copying, run progress and cancellation. Configured models stream transient inference text through bounded run progress; the terminating reply tool persists final replies. Without a model, demo mode supports task/note creation and live lists through a deterministic application fallback.

Old message text remains readable. Known task/note display references are translated into data attachments. Saved-page authoring and the Pages section have been removed; historical migrations remain and no old saved-page rows are deleted. See [Custom frontends and chat](../../docs/custom-frontends.md) for the library/application boundary.
