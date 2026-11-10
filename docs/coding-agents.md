# Building applications with a coding agent

Use this page as the entry point for a coding agent working in a **separate application repository**. Workcore provides typed server operations, live clients, SQLite Durable Objects and durable jobs. It is not an authentication provider, a prescribed membership model, or a required frontend framework.

`@workcore/core/AGENTS.example.md` is a copyable safety checklist and reading map, not a complete API manual. Merge it into the consuming application's `AGENTS.md`; do not overwrite existing instructions. This site provides the explanations and examples behind that checklist.

## Version and authority

Check the application's installed `@workcore/*` versions and lockfile first. This site follows the repository's current documentation and can be newer than a published package. Installed TypeScript declarations are the authority for the version in use. For reproducible investigation, consult the source at the matching [release tag](https://github.com/qwacko/workcore/tags), not just `main`.

The copied agent guide does not update when a dependency updates. Review it alongside library upgrades. Changes to this website also do not change a guide already shipped in an npm tarball.

## Read in this order

| Task | Read | What to implement |
| --- | --- | --- |
| Start an external consumer | [Getting started](./getting-started) | Published packages, SQL schema, migration bundle, Worker class, verified authentication and Wrangler bindings |
| Look up a symbol or method | [API index](./reference), [client methods](./client-api), [host options](./hosting) | Exact entry points, inputs/results, defaults and failure/lifecycle contracts |
| Understand the storage boundary | [Architecture](./architecture) | One workspace key maps to a Durable Object; separate workspaces are not a shared transaction |
| Define reads and writes | [Authoring](./authoring) | Zod schemas, synchronous queries/views/mutations, operation registration and SQL migrations |
| Pass identity and context | [Context and identity](./context) | Distinguish browser input, verified actor, synchronous database context, environment bindings and job input |
| Build the browser UI | [Custom frontends and typed client](./custom-frontends#use-the-typed-client) | `createClient`, one-shot reads, mutations, live state and cleanup; no admin renderer required |
| Wire update notifications | [Live views](./sync) and [trigger keys](./authoring#trigger-keys-and-view-invalidation) | Mutation keys invalidate dependent views after commit; these are not payload channels |
| Enforce privacy and editing rules | [Application permissions](./multi-user) and [security](./security) | Authentication, operation allowlists, row/field filters, ownership, version checks and live revocation |
| Add the optional console | [Admin setup](./admin#install-and-serve-the-optional-console) | Copy prebuilt assets, serve them through the Worker and independently authorize operations and inspection |
| Run background work | [Execution](./execution) | Enqueue/schedule atomically, checked data access, cancellation, retry and uncertain external effects |
| Give an AI agent tools/context | [AI SDK agents](./ai) | Application-owned prompts/history, checked tools, model credentials and bounded execution |
| Add files or operations tooling | [Files](./files) and [backup/operations](./recovery) | Authorized object access, separate database/object recovery and trusted maintenance boundaries |
| Deploy or contribute | [Deployment](./deployment) and [contributing](./contributing) | Cloudflare runbook, Git builds and documentation requirements for library changes |

## End-to-end mental model

1. The browser authenticates with the host application, then creates a client for a same-origin workspace API URL.
2. The public Worker verifies the session and routes the request to the appropriate workspace. The trusted session carries an actor ID and bounded expiry, not a client-supplied permission snapshot.
3. The workspace validates the operation input and calls the current application authorization policy. Handlers still enforce row ownership, visibility and permitted fields.
4. A mutation commits SQL and associated framework state atomically, advances the workspace revision and publishes invalidation keys.
5. Live views whose dependencies match rerun under their subscribers' actors. Clients receive replacement snapshots, not arbitrary database access or row-diff events. Other subscriptions receive revision acknowledgements; authorization is rechecked regardless of key matching.
6. A durable job performs external work separately from the synchronous transaction, using checked registered operations for data access. A browser disconnect does not cancel it.

## A useful implementation brief

Paste this into the consuming repository and add the application's actual requirements:

```text
Build this application using the installed @workcore/* packages.
Read AGENTS.md, inspect the installed versions/declarations, and use
https://qwacko.github.io/workcore/coding-agents as the documentation map.
Follow getting-started for schema/migrations and Worker integration; read
context, custom-frontends, sync and multi-user before designing the client
or permissions. Use admin, execution, ai and files only where required.

Use application-defined permissions, not an invented team framework.
Keep browser input separate from trusted identity and server configuration.
Use bounded live views, explicit invalidation dependencies, owner/version
checks for edits, and client cleanup on identity changes.
If a requested capability is not in the installed API, identify the gap
rather than inventing an API or bypassing the authorization boundary.
Do not deploy, publish or change production resources without approval.
```

## Acceptance checks for a new consumer

- Install published packages in the external repository; do not rely on monorepo source aliases or workspace links.
- Typecheck and build the Worker and browser bundles. Keep the server definition out of the browser using `import type`.
- Generate and commit SQL migrations and their bundle; test startup with existing data as well as an empty database.
- Exercise two accounts: shared/private reads, denied cross-user writes, stale edit conflicts and permission changes while subscribed.
- Exercise live updates across tabs, reconnects, switching view inputs, logout and switching accounts. Stale data must not masquerade as current authorized data.
- Verify the deployment artifact locally and smoke-test Cloudflare separately. Automated local tests do not establish production load capacity or a complete security review.
- For important data, rehearse backup/restore, including separate file recovery. Report reproducible library failures upstream and add regression tests.
