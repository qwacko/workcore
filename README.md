# Workcore

**Build live, data-driven applications on Cloudflare without assembling a database, realtime server, job queue and scheduler.**

Define ordinary Drizzle SQLite tables and typed operations. Workcore runs them inside SQLite-backed Durable Objects and supplies a browser client, authorized live views and durable background execution. Your application owns authentication, permissions and its frontend.

## Why use it?

- **One coordination boundary:** each workspace owns its database, live subscriptions, jobs and schedules in one Durable Object.
- **Transactional application logic:** commit SQL changes, internal KV, job enqueues and schedules together.
- **Typed frontend/server contract:** infer operation inputs and results with `@workcore/client`; keep server implementation out of the browser bundle.
- **Live authorized data:** subscribe to bounded views, with dependency-based refresh, reconnects and revision tracking. Keep private rows on the server.
- **Inspectable background work:** persisted runs, steps, cooperative cancellation, schedules and explicit retry semantics.
- **Optional capabilities:** a prebuilt admin console, R2-backed files, and AI SDK agents with checked application tools.

Use it for applications whose data and workflows fit explicit workspace boundaries. Workcore is Cloudflare-specific: there are no cross-workspace transactions, offline writes or exactly-once external effects. Authentication and record permissions are application-owned. The API is early (`0.1.x`) and may change.

## Start here

**[Documentation](https://qwacko.github.io/workcore/)** is the primary manual, including setup, guides, API reference and operations.

- **Building an application:** [Getting started](https://qwacko.github.io/workcore/getting-started).
- **Using a coding agent:** [Agent reading map](https://qwacko.github.io/workcore/coding-agents). Merge the packaged `@workcore/core/AGENTS.example.md` into your application's instructions.
- **Finding an API:** [Public API index](https://qwacko.github.io/workcore/reference).
- **Working on this repository:** [Contributor guide](docs/contributing.md) and [repository instructions](AGENTS.md).

There is no umbrella `workcore` npm package. Use `@workcore/core` and `@workcore/client`, plus optional `@workcore/admin`, `@workcore/files` and `@workcore/ai`. Packages ship ESM and TypeScript declarations. Use coordinated versions; the [installation guide](https://qwacko.github.io/workcore/getting-started#1-install-the-packages) has the commands.

## Try the existing example

The todo/notes/chat application demonstrates live updates, private/shared data, background work and optional AI integration. It uses D1 for Better Auth identities; Workcore's application data lives in SQLite Durable Objects, not D1.

From the repository root, using Node.js 22.17+ and the pinned pnpm version:

```sh
pnpm install --frozen-lockfile
# If it does not already exist, copy examples/workcore-demo/.env.example
# to examples/workcore-demo/.env and configure its public local origin.
pnpm dev
```

See the [example setup and deployment guide](https://qwacko.github.io/workcore/deployment). Deploying an application and [publishing the libraries](https://qwacko.github.io/workcore/publishing) are separate operations.

## Contributing and verification

Feature/API changes must include VitePress documentation and relevant tests in the same change. The [contributor guide](docs/contributing.md) describes the documentation hierarchy and verification commands. `pnpm docs:dev` previews the manual locally; `pnpm docs:build` checks its production build.
