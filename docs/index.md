# Workcore

An opinionated kit for live workspace applications on Cloudflare. One workspace is one SQLite-backed Durable Object. Drizzle defines application tables; Zod validates operations; mutations own writes; authorised views supply live client datasets.

## Start locally

```sh
pnpm install
cp examples/workcore-demo/.env.example examples/workcore-demo/.env
# Set BETTER_AUTH_URL in .env to the exact origin you will open, then:
pnpm dev
```

Open the local URL printed by `pnpm dev` and create an account. Use the custom shadcn-svelte frontend to manage tasks, private notes and chat. Open another window to see live updates. A separate account cannot receive your private records.

Do not overwrite an existing `.env`. See the [example README](https://github.com/qwacko/workcore/tree/main/examples/workcore-demo) for the complete local/Cloudflare configuration. Deploying that example and publishing the reusable npm packages are separate actions.

## Use it in another app

The initial npm release target is `0.1.0`. Once published, install `@workcore/core` and `@workcore/client` with Drizzle/Zod, then follow [getting started](./getting-started). Optional packages provide prebuilt admin assets, R2 files and AI SDK integration. There is no umbrella `workcore` package or required Svelte frontend.

The core package includes `AGENTS.example.md`; copy/merge it into a consuming app's `AGENTS.md` to give coding agents the library's actual APIs and development rules. The [publication guide](./publishing) covers package validation, tarballs and npm commands.

The optional SvelteKit admin console reads display documents from the runtime manifest. It generates forms from annotated schemas and renders table, list, record, JSON, safe Markdown and private chat presentations. Row actions bind record IDs and application-defined versions without making users copy them. Execution timelines, schedule controls, history and bounded read-only raw-table inspection remain server-authorised. It deliberately does not provide raw database editing or an arbitrary UI/template language.

The tracker includes a scheduled task and an AI SDK assistant. Without a selected model it uses a deterministic application fallback for task/note creation and live lists. With `WORKCORE_AGENT_MODEL` and provider credentials it uses tracked multi-turn calls, checked tools and optional cross-provider fallback. See [AI SDK agents](./ai).

## Read next

- [Getting started](./getting-started): installation, file layout, migrations, hosting and client usage.
- [Architecture](./architecture): ownership, transaction boundaries and deployment.
- [Authoring](./authoring): tables, mutations, queries, migrations and the typed client.
- [Custom frontends and chat](./custom-frontends): typed subscriptions, application-owned attachments, pagination and streaming progress.
- [Optional admin metadata](./admin): typed field hints, display documents, actions and client state.
- [Admin display protocol v3](./display-protocol): wire contract, bindings, lifecycle, compatibility, limits, and conformance fixtures.
- [Sync](./sync): bounded live views, personalised results and larger datasets.
- [File storage](./files): optional R2-backed files, metadata and lifecycle.
- [Execution](./execution): tasks, schedules, agent tools and interruption.
- [Security](./security): authentication, authorisation, limits and unsupported features.
- [Publishing](./publishing): validate the existing example against packed libraries and publish the initial packages.

## A fresh implementation

This replaces the previous portable runtime, not extends it. No old adapters, APIs, rich-value codecs, application composition framework or old-data migrations are retained. The previous implementation is preserved in Git history at `7c2c092`.

The root workspace and example remain private; the five library packages are prepared for public `0.1.0` publication. The API is intentionally early. Deployment still requires real host authentication, application permissions and appropriate operational limits.
