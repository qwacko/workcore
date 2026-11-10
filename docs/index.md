# Workcore documentation

Workcore is a Cloudflare-first kit for live workspace applications. Define Drizzle SQLite tables and validated operations; Workcore supplies transactional storage, authorized live snapshots and durable background execution. Your application owns its authentication, permission model and frontend.

## Choose a starting point

| Goal | Start here | Result |
| --- | --- | --- |
| Decide whether Workcore fits | [Architecture and boundaries](./architecture) | Understand one-workspace/one-Durable-Object ownership and its tradeoffs |
| Build an application in another repo | [Getting started](./getting-started) | A schema, migrations, registered operations, authenticated Worker and typed client |
| Instruct a coding agent | [Agent reading map](./coding-agents) | A task-oriented reading order and implementation/acceptance checklist |
| Run or deploy the existing example | [Example and deployment](./deployment) | Local setup, Cloudflare resources, secrets and automatic deployment |
| Find a symbol or method | [Public API index](./reference) | Package entry points, purpose, boundaries and links to detailed contracts |
| Change Workcore itself | [Contributing and documentation](./contributing) | Repository workflow, required documentation updates and verification |

## How this manual is organized

1. **Start:** installation and the minimum end-to-end tutorial. Follow this before composing optional features.
2. **Build an application:** task-oriented guides explaining the supported design patterns and their security/lifecycle implications.
3. **API reference:** symbol/method lookup and contracts. Reference pages link back to recipes rather than hiding prerequisites in large examples.
4. **Operate and maintain:** deployment, diagnostics, recovery, package publishing and contributing.

The sidebar follows this hierarchy. Pages use stable URLs so applications can link to specific guides; headings provide the next level of navigation. Prefer the reference index when searching by function name and the agent reading map when searching by task.

## Core concepts

| Concept | Meaning | Guide |
| --- | --- | --- |
| Workspace | One SQLite-backed Durable Object, not necessarily a team or organization | [Architecture](./architecture) |
| Mutation | Synchronous transaction for SQL, KV, job enqueues and schedules | [Authoring](./authoring) |
| View | Bounded read-only result eligible for live subscription | [Live data](./sync) |
| Query | One-shot read, including application-defined pagination | [Client integration](./custom-frontends) |
| Trigger key | Post-commit invalidation label, not an event payload or automatic SQL dependency | [Invalidation](./authoring#trigger-keys-and-view-invalidation) |
| Actor | Verified initiating identity; permissions remain application-defined | [Context](./context) and [permissions](./multi-user) |
| Task/agent | Persisted background run; external effects are not exactly-once | [Execution](./execution) |
| Admin console | Optional prebuilt client for operations and privileged inspection | [Administration](./admin) |

## Version and environment

The current package line is `0.1.x`. Use coordinated installed package versions and check their declarations: this site follows the repository and can describe unreleased changes. The matching [release tag and changelog](https://github.com/qwacko/workcore/releases) identify a published version. No compatibility with the previous portable runtime at Git revision `7c2c092` is implied.

Core persistence requires Cloudflare SQLite Durable Objects, **not D1**. The example uses D1 only for host authentication. The browser client is framework-independent; neither Svelte nor the optional admin rendering protocol is required in a consuming app. There is no umbrella `workcore` package.

This is an early implementation, not a claim of exhaustive production validation. Read [security and limits](./security), use explicit application permissions, and rehearse [backup/recovery](./recovery) before storing important data.
