# workcore-demo

A SvelteKit single-page workspace, served by a Cloudflare Worker. The tasks and notes interfaces use typed `@workcore/client` live subscriptions; tasks default to your own, with an option to see everyone's shared work. Notes are private. The default Workcore console is available at `/admin/demo` and `/admin/notes`. Tasks and notes are separate Durable Objects; Better Auth uses D1 for accounts.

## Local development

Copy `.env.example` to `.env` in this directory and set `BETTER_AUTH_URL` to the exact browser origin. `pnpm dev` at the repository root builds both static frontends and starts Vite and Wrangler. Create an account to get started. Local D1 and Durable Object data are persisted by Wrangler. `DEMO_MODE=true` permits a development-only auth secret if none is set; never use it in production.

The SPA subscribes to bounded live datasets (up to 500 tasks in the inbox and 200 notes per list). Shared task visibility is enforced on the server, not by the Mine/Everyone filter. Task changes and note edits use revisions to avoid silently overwriting concurrent changes.

## Administrator access

Accounts are ordinary members by default. To grant an existing, trusted account access to administrator operations in **both** workspaces:

1. Create the account first and confirm its identity out of band. Better Auth user IDs are generated IDs, not email addresses. For local development, inspect the local D1 database:

   ```sh
   pnpm --filter workcore-demo exec wrangler d1 execute AUTH_DB --local --env local --command 'SELECT id, email FROM user'
   ```

2. Copy the exact `id` into `WORKCORE_ADMIN_IDS` in `examples/workcore-demo/.env` (comma-separated for multiple administrators), then restart `pnpm dev`. Do not use names or email addresses: the demo does not verify email ownership. An empty or absent list grants no configured administrators.
3. Open the Admin link again. Administrator operations include raw table access, which can expose **all users' private tasks and notes**, as well as run and schedule controls. Grant it only to trusted operators.

For a deployed Worker, inspect the production database with `wrangler d1 execute AUTH_DB --remote --env='' --command 'SELECT id, email FROM user'`, then set `WORKCORE_ADMIN_IDS` as a Worker secret (`wrangler secret put WORKCORE_ADMIN_IDS --env=''`) or as a Worker variable and deploy. To revoke configured access, remove the ID and redeploy/restart the Worker. The tracker also retains its pre-existing per-workspace `members.role = 'admin'` authorization; if an operator has manually granted that role in a workspace database, remove it there too. Never put administrator IDs into client-controlled headers or use an unverified email as an authorization rule.

## Cloudflare deployment

Create a D1 database and replace `AUTH_DB`'s placeholder `database_id` in `wrangler.jsonc`; create the configured R2 bucket. Set a unique secret and the canonical HTTPS origin:

```sh
pnpm --filter workcore-demo exec wrangler secret put BETTER_AUTH_SECRET --env=''
pnpm --filter workcore-demo exec wrangler secret put BETTER_AUTH_URL --env=''
pnpm deploy
```

The build compiles the demo and the default admin into one assets directory and performs a Wrangler dry-run before deployment. Configure both Durable Object namespaces and the R2 bucket in the Cloudflare account. This sample permits account creation without email verification and should be hardened for a public deployment.
