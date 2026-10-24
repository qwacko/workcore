# Workcore

An opinionated kit for live workspace applications on Cloudflare. One workspace is one SQLite-backed Durable Object. Zod defines records and operations; mutations own writes; authorised views supply live client datasets.

## Start locally

```sh
pnpm install
pnpm dev
```

Open Wrangler's local URL. Choose Alice (admin) or Bob (member), subscribe to `tasks` with `{}`, and create a task in a second window. Alice's private row is not sent to Bob.

The console can execute typed operations using validated JSON inputs, inspect live results, launch jobs, browse run traces, and manage schedules. It deliberately does not provide raw database editing or a general UI component framework.

The tracker includes a scheduled task and an assistant. Without a Workers AI binding the assistant produces an explicitly labelled deterministic demo summary. With a binding named `AI`, it calls a model inside a recorded execution step.

## Read next

- [Architecture](./architecture): ownership, transaction boundaries and deployment.
- [Authoring](./authoring): tables, mutations, queries, migrations and the typed client.
- [Sync](./sync): bounded live views, personalised results and larger datasets.
- [Execution](./execution): tasks, schedules, agent tools and interruption.
- [Security](./security): authentication, authorisation, limits and unsupported features.

## A fresh implementation

This replaces the previous portable runtime, not extends it. No old adapters, APIs, rich-value codecs, application composition framework or old-data migrations are retained. The previous implementation is preserved in Git history at `7c2c092`.

The packages are private and the API is intentionally early. Deployment is not production-ready until the host supplies real authentication and the application defines its access policies and operational limits.
