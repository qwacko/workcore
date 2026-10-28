# Workcore

An opinionated kit for live workspace applications on Cloudflare. One workspace is one SQLite-backed Durable Object. Drizzle defines application tables; Zod validates operations; mutations own writes; authorised views supply live client datasets.

## Start locally

```sh
pnpm install
pnpm dev
```

Open the local URL printed by `pnpm dev`. Choose Alice (admin) or Bob (member), follow the workspace overview, and create a task in a second window. The task list updates live; Alice's private row is not sent to Bob.

The SvelteKit console reads its pages from the runtime manifest. It generates forms from annotated schemas and renders table, list, record, JSON, safe Markdown and private chat presentations. Row actions bind record IDs and application-defined versions without making users copy them. Execution timelines, schedule controls, history and bounded read-only raw-table inspection remain server-authorised. It deliberately does not provide raw database editing or an arbitrary UI/template language.

The tracker includes a scheduled task and an AI SDK assistant. Without a selected model it produces an explicitly labelled deterministic demo summary. With `WORKCORE_AGENT_MODEL` and provider credentials it uses tracked multi-turn calls, checked tools and optional cross-provider fallback. See [AI SDK agents](./ai).

## Read next

- [Architecture](./architecture): ownership, transaction boundaries and deployment.
- [Authoring](./authoring): tables, mutations, queries, migrations and the typed client.
- [Admin authoring](./admin): typed field hints, semantic pages, actions and client state.
- [Sync](./sync): bounded live views, personalised results and larger datasets.
- [File storage](./files): optional R2-backed files, metadata and lifecycle.
- [Execution](./execution): tasks, schedules, agent tools and interruption.
- [Security](./security): authentication, authorisation, limits and unsupported features.

## A fresh implementation

This replaces the previous portable runtime, not extends it. No old adapters, APIs, rich-value codecs, application composition framework or old-data migrations are retained. The previous implementation is preserved in Git history at `7c2c092`.

The packages are private and the API is intentionally early. Deployment is not production-ready until the host supplies real authentication and the application defines its access policies and operational limits.
