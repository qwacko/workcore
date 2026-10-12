# Getting started

## Try the local example

Requirements: Node.js 22+ and pnpm 10+.

```sh
pnpm install
pnpm build
pnpm dev
```

Open <http://127.100.0.10:3000> and choose Alice or Bob. The tracker demo shows personal and shared workspaces, generated tables and forms, live updates, tasks, schedules, and history. Its login routes and file adapters are local-development fixtures only.

## Add Workcore to an application

Install only the packages you need:

```sh
pnpm add @workcore/core @workcore/client
```

Define a workspace catalog with schemas and handlers, register a context factory, then mount `platform.httpHandler()` in your existing Request/Response host. The [authoring guide](/authoring) introduces that flow; the [production guide](/production-deployment) covers shared adapters and workers.

The application supplies authentication, repositories, and domain data. Workcore validates and authorizes operations but does not automatically scope an unrestricted database connection—handlers/repositories must use the operation's workspace scope.

## Optional packages

- `@workcore/admin` provides a prebuilt route-mounted console.
- `@workcore/adapters/postgres` and `@workcore/adapters/redis` provide shared deployment adapters. Install `pg` and `redis` in your host application.
- `@workcore/codec-superjson` or `@workcore/codec-devalue` preserve supported rich values across the wire. The default protocol is strict JSON.

See the repository [README](https://github.com/qwacko/workcore#readme) for package details, tests, and the full demo overview.
