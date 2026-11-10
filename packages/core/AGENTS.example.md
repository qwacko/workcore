# Developing an application with Workcore

Merge this into the consuming application's `AGENTS.md`; adapt paths and commands
without overwriting existing instructions. This is guidance for **coding agents**,
not a runtime AI prompt or a substitute for the manual.

## Documentation first

- Reading map: https://qwacko.github.io/workcore/coding-agents
- Complete setup: https://qwacko.github.io/workcore/getting-started
- Public API index: https://qwacko.github.io/workcore/reference
- Read the relevant guides before implementing client, live data, context,
  permissions, jobs, AI, files or admin features; the reading map links each one.
- Check installed versions and declarations. The website tracks the repository
  and may be newer than the installed package; consult the matching release tag.
  Review this copied file when upgrading dependencies. Do not invent missing APIs.

## Non-negotiable boundaries

- Import the server application with `import type` in browser code. Use the typed
  client, not client-side SQL. Close clients and clear UI state on identity changes.
- Authentication belongs to the host. Only verified identity is authority; domain
  inputs, workspace names, browser filters and hidden UI fields do not grant access.
  Enforce operation access plus row/field permissions and owner/version write checks.
- Views, queries, mutations and authorization are synchronous. External work belongs
  in jobs; never retain transaction contexts. Mutations atomically commit local
  data, internal KV, enqueues and schedules—not external effects.
- Live views are bounded authorized snapshots. Trigger keys invalidate dependent
  views after commit; they are not payload channels. Include policy dependencies
  where visibility changes. Jobs and checked tools retain the initiating actor.
- Commit generated SQL, snapshots, journal and migration bundle together. Never
  rewrite applied migrations or delete real data to make a schema change pass.
- Admin inspection and backup/restore are privileged; never expose them to ordinary
  users or model tools as a shortcut. Keep secrets in server bindings, not prompts,
  browser variables, logs or committed files.

## Verify before handing back

Run the application's typechecks, tests and build. Cover private data, denied writes,
stale edits, live updates, reconnects and account switching. Use a Wrangler dry run
before deployment. External effects are not exactly-once; inspect interrupted runs
before retrying. Do not publish, deploy, change production resources or perform
destructive recovery without explicit authorization.
