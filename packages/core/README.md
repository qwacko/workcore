# @workcore/core

Cloudflare Durable Object/SQLite runtime for typed, transactional, live workspace applications.

Install with `drizzle-orm` and `zod`. Export your workspace class from `@workcore/core/cloudflare`; use `@workcore/core/schema` in Drizzle Kit. Trusted maintenance code can use `@workcore/core/backup` for bounded database snapshots and file-copy/restore helpers.

## Install and use

Once 0.1.0 is published:

```sh
pnpm add @workcore/core@0.1.0 drizzle-orm@^0.45.4 zod@^4.6.7
```

Define SQLite tables with Drizzle, compose them with `defineSchema`, generate/bundle migrations, define typed operations with `workspace(schema, migrations)`, and host the definition using `Workspace` and `routeWorkspace` from `@workcore/core/cloudflare`. Authentication and record permissions are application-owned; mutations are synchronous and transactional.

Start with the [complete setup guide](https://qwacko.github.io/workcore/getting-started) and [todo/notes example](https://github.com/qwacko/workcore/tree/main/examples/workcore-demo). Add `@workcore/client` for browser subscriptions, and optional admin/files/AI packages as needed.

## Coding agents

This package includes an `AGENTS.example.md` template. Copy it to your app root as `AGENTS.md`, or merge it with existing instructions. It describes how to develop with Workcore, not how to prompt a runtime AI agent:

```sh
cp node_modules/@workcore/core/AGENTS.example.md ./AGENTS.md
```

See the [authoring guide](https://qwacko.github.io/workcore/authoring), [application permissions](https://qwacko.github.io/workcore/multi-user), and [recovery guide](https://qwacko.github.io/workcore/recovery). ESM JavaScript and TypeScript declarations are included. This is an early 0.x API, not an exactly-once execution system.
