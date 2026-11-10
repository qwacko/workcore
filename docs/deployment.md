# Example and Cloudflare deployment

This runbook deploys the existing todo/notes/chat app, not the npm libraries. It assumes Node.js 22.17+, the repository's pinned pnpm version, and access to the intended Cloudflare account. A consuming app follows [Getting started](./getting-started) with its own resources.

## Local example

From the repository root:

```sh
pnpm install --frozen-lockfile
# If absent, copy examples/workcore-demo/.env.example to
# examples/workcore-demo/.env; do not overwrite existing secrets.
pnpm dev
```

Set `BETTER_AUTH_URL` to the exact origin you open (normally `http://127.0.0.1:8787`). The local environment has `DEMO_MODE=true` and permits a development-only fallback secret; never expose that environment publicly. Root `.env`, example `.env`, then shell variables supply configuration in increasing precedence. Restart local development after changes.

The launcher builds both SPAs and starts Vite with a private Wrangler backend, including WebSocket proxying and persisted local storage. The frontend opens to Chat and includes Tasks and private Notes. Without a selected model it has deterministic application responses; [AI configuration](./ai) is optional. Application accounts/identities use D1; workspace data uses separate task and notes SQLite Durable Objects.

## Production resources

Choose one Git checkout and use it consistently. A worktree and `/home/.../dev/workcore` have independent local configuration changes; verify the current directory before editing or deploying.

```sh
pnpm exec wrangler login
pnpm exec wrangler whoami
pnpm --filter workcore-demo exec wrangler d1 create workcore-auth --env=''
pnpm --filter workcore-demo exec wrangler r2 bucket create workcore-files --env=''
```

These create real resources. Enable R2 in the account if required. If resources already exist, reuse them rather than recreating them.

Edit **`examples/workcore-demo/wrangler.jsonc` in that checkout**:

- Replace the top-level `AUTH_DB.database_id` placeholder with the actual D1 ID. Keep binding name `AUTH_DB`—adding a separate `workcore_auth` binding does not fix the original placeholder.
- Keep `FILES_BUCKET` pointing to the real bucket. Do not add an unnecessary duplicate lowercase binding.
- Preserve the `WORKSPACES`/`NOTES` bindings, exported DO class names and deployed `new_sqlite_classes` migration history.
- Leave production `DEMO_MODE` as `"false"`; do not modify `env.local` to configure production.

Database IDs and bucket names identify resources; they are not access credentials and may be committed. API tokens, auth secrets, provider keys, `.env` and `.dev.vars` must not be committed. Other repository users must provision their own resources and change the IDs.

## Production authentication

```sh
pnpm --filter workcore-demo exec wrangler secret put BETTER_AUTH_SECRET --env=''
pnpm --filter workcore-demo exec wrangler secret put BETTER_AUTH_URL --env=''
```

Use a unique random secret of at least 32 characters and the exact canonical public HTTPS origin without a path. Wrangler may offer to create the named Worker when adding its first secret; confirm only for the intended account/name. You do not need to upload files or create a Pages project in the dashboard.

Worker secrets remain in Cloudflare and are not uploaded from the local `.env`. Better Auth initializes its D1 schema on the app's auth path; Workcore applies its bundled SQL migrations in the Durable Objects. The example permits signup without email verification—choose appropriate access/registration policy before exposing sensitive data.

## Validate and deploy

```sh
pnpm typecheck
pnpm test
pnpm build
pnpm test:packages
pnpm run deploy
```

The first four commands do not deploy remotely. **Use `pnpm run deploy`, not `pnpm deploy`**, which invokes pnpm's built-in package deployment command. The repository script rebuilds and deploys the example to the default production environment. Alternatively, explicitly use `pnpm --filter workcore-demo run deploy`.

Confirm the resulting URL matches `BETTER_AUTH_URL`. Smoke-test signup/sign-in/sign-out, shared/private tasks, private notes, files, two-tab updates, a second account's denied writes and a scheduled job. Refresh old browser tabs after changing compiled frontend code. For logs:

```sh
pnpm --filter workcore-demo exec wrangler tail --env=''
```

Administrator access is explicit. Inspect account IDs with `wrangler d1 execute AUTH_DB --remote --env='' --command 'SELECT id, email FROM user'` from the example directory, then set `WORKCORE_ADMIN_IDS` as a Worker secret. Use verified generated user IDs, not email addresses. Admin inspection can expose all users' private data; see [example administrator instructions](https://github.com/qwacko/workcore/tree/main/examples/workcore-demo#administrator-access).

## Automatic deployment with Workers Builds

After a manual deployment works, connect the **existing** Worker to GitHub using Cloudflare Workers Builds. Do not create a second Worker just to enable Git deployment.

| Setting | Value |
| --- | --- |
| Repository | Your fork or `qwacko/workcore` |
| Production branch | `main` |
| Root directory | Repository root (`/`) |
| Build command | `pnpm install --frozen-lockfile && pnpm build` |
| Deploy command | `pnpm --filter workcore-demo exec wrangler deploy --env=""` |

Use Node.js 22.17+ and the pinned pnpm version in the build environment. Commit the actual resource configuration. Existing runtime Worker secrets stay in Cloudflare; they do not need to become browser build variables. Use one automatic deployment mechanism: if Workers Builds owns deployment, do not also enable a GitHub Actions deploy for the same push. Leave branch previews disabled until their resource and secret isolation is deliberately configured.

Pushing to `main` should build and update the same Worker, URL, databases and bucket. Confirm the deployment's commit and a visible UI change. A build deployment is not a gate on unrelated GitHub CI checks unless explicitly configured; the build command above performs the workspace build/dry run, not the full test suite. Add appropriate tests to your build policy before depending on that gate.

If Cloudflare says the project is disconnected from Git, verify the Cloudflare GitHub App installation still has repository access and reconnect the repository on the existing Worker. Reconnecting Git does not require deleting the Worker or its data.

## Common failures

| Symptom | Check |
| --- | --- |
| `ERR_PNPM_NOTHING_TO_DEPLOY` | Use explicit `pnpm run deploy`; ensure the root script also uses `run` for the filtered example |
| D1 ID is all zeros | Correct the top-level `AUTH_DB` entry in the checkout actually being built; confirm account with `wrangler whoami` and database ID with `wrangler d1 list` |
| Sign-out returns 415 | Auth JSON requests need `Content-Type: application/json` and a JSON body; rebuild/reload old frontend tabs |
| Auth origin denied | `BETTER_AUTH_URL` must match the browser's canonical public HTTPS origin; do not weaken origin checks |
| Local works, hosted build fails | Check committed resource IDs, Node/pnpm versions, workspace root and build output paths; local uncommitted files are not in Git builds |

Before important data, rehearse [backup/recovery](./recovery). Do not delete/recreate resource bindings, rewrite applied migrations or reset databases to resolve a routine deployment problem. Application deployment does not publish `@workcore/*`; [npm publication](./publishing) is a separate workflow.
