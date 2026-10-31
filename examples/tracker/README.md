# Workcore example

The example has three distinct surfaces: the sign-in and workspace landing page, a small notes frontend at `/notes`, and the generic Workcore admin at `/admin/<workspace>`. Tasks use the `WORKSPACES` Durable Object namespace; notes use `NOTES`, addressed as the `notes` workspace. The public Worker authenticates with Better Auth and routes Workcore requests using the authenticated user ID.

## Local development

Copy `.env.example` to `.env` and set `BETTER_AUTH_URL` to the exact origin used in the browser. For local development, `DEMO_MODE=true` uses a fixed development-only Better Auth secret when `BETTER_AUTH_SECRET` is unset. Never deploy with that fallback. Local D1 data is stored by Wrangler.

Run `pnpm dev` from the repository root. Create an account from the landing page, then open Tasks, Notes, or Admin. The first Better Auth request applies Better Auth's built-in D1 schema migrations.

## Cloudflare deployment

Create a D1 database and replace the `database_id` for `AUTH_DB` in `wrangler.jsonc` with its ID. Create the configured R2 bucket, then set the Better Auth credentials as Worker secrets:

```sh
wrangler d1 create workcore-auth
wrangler secret put BETTER_AUTH_SECRET
wrangler secret put BETTER_AUTH_URL
```

Set `BETTER_AUTH_URL` to the canonical HTTPS origin. Configure both Durable Object namespaces and the R2 bucket in the Cloudflare account before deploying. The placeholder D1 ID in the checked-in config is for local Wrangler only and must be replaced for a deployed Worker.
