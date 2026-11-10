# Contributing and documentation

This page is for changes to **Workcore itself**. For a consuming app, use [Getting started](./getting-started) and the [coding-agent reading map](./coding-agents). Repository-wide agent instructions live in the root `AGENTS.md`; the packaged consumer template has a different audience.

## Documentation architecture

VitePress is the primary manual. README explains the product's purpose, fit and basic features, then links here. `AGENTS.example.md` is a short bootstrap/checklist, not another API manual.

| Layer | Question answered | Contents |
| --- | --- | --- |
| Start/tutorial | How do I get a working integration? | Ordered, complete files and commands; prerequisites, expected outcomes, next steps |
| Application guide | How do I solve a particular problem? | Recommended patterns, examples, security/lifecycle rationale and tradeoffs |
| API reference | What does this symbol/method actually do? | Entry point, signature/options, input/output, defaults, errors, permissions and limits |
| Operations/runbook | How do I deploy, diagnose or recover? | Environment/resource assumptions, safe commands, verification, retry/rollback boundaries |

Keep conceptual guides separate from lookup reference. Link between them rather than duplicating long examples. Preserve existing page URLs and useful anchors. Add new pages to the appropriate sidebar group and the public reference/agent maps. Local site search and heading navigation complement this hierarchy; they do not replace it.

## Required feature-change checklist

A feature is not complete until its documentation is included in the same change:

1. Identify the affected public package entry points, methods, types and existing behavior.
2. Update the relevant reference and task guide. Include exact names, inputs/results, defaults, state transitions, authorization, failure/retry semantics and limits. Mark application pseudocode as a fragment; do not present it as a complete runnable file.
3. Explain what the feature **does not** do, especially transaction boundaries, identity/context propagation, live privacy, retries and external effects. Distinguish framework behavior from an example application's policy.
4. Add a realistic code example and regression tests. For changes to setup, update the tested `// filename` blocks in `getting-started.md` instead of creating a second starter in README.
5. Update `reference.md` for exported symbols and entry points. For a client method update `client-api.md`; for host integration update `hosting.md`. Maintain the sidebar and agent task map for new capabilities.
6. Update changelog/release notes where appropriate. The live site follows repository code; never imply that an unreleased API exists in an older npm package. Installed declarations and release-tag source are the version-specific authority.
7. Run the checks below and report which ones passed. Do not claim successful rendering or symbol coverage proves semantic correctness.

Use task-oriented titles, a short purpose/prerequisite paragraph, focused headings, and explicit next/reference links. Prefer tables for options and results and ordinary Markdown/TypeScript blocks for agent readability. Avoid unexplained feature lists, historical implementation diaries and speculative API names.

## Verification commands

From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm test:docs       # Public runtime-export/reference coverage and local documentation links
pnpm docs:build      # VitePress links and production rendering
pnpm typecheck
pnpm test           # Script tests and Workers/SQLite runtime tests
pnpm build          # Packages/example plus deployment dry run; no remote deploy
pnpm test:packages  # Actual documented setup and example against packed packages
pnpm exec playwright install chromium
pnpm test:e2e
```

`pnpm docs:dev` starts the manual locally. The CI workflow already runs script tests, package smoke checks and the site build. The documentation tests require a reference-index entry for each public runtime export; this catches newly exposed APIs without an index entry, not incomplete explanations or undocumented changes to an existing function's behavior. Those still require review using the checklist.

The package smoke check extracts schema, application, migration helper, auth stub, Worker and browser client code directly from the tutorial, generates migrations, typechecks and runs a Wrangler dry run. Auth is intentionally fail-closed until the consuming app installs its real verifier. No smoke check publishes or deploys remotely.

## Repository map

| Path | Responsibility |
| --- | --- |
| `packages/core` | Definitions, synchronous runtime, SQLite state, jobs and Cloudflare host |
| `packages/client` | Browser transport, shared subscriptions, sources and action submission |
| `packages/admin` | Prebuilt SPA, display rendering, asset helper and server routing |
| `packages/ai` | AI SDK model/tool loop and provider configuration |
| `packages/files` | File schema/capability helpers; core hosts authorized lifecycle endpoints |
| `examples/workcore-demo` | Executable todo/notes/chat reference with host-owned authentication |
| `tests` | Runtime, browser, type and protocol regression coverage |
| `scripts` | Development, documentation/package verification and release tooling |
| `docs` | Primary consumer/reference/operations manual |

## Release and production safety

Application deployment is separate from npm publication. See [deployment](./deployment), [publishing](./publishing) and [recovery](./recovery) before remote actions. Keep secrets out of commits, preserve applied migrations, and do not reset data or move release tags to make a check pass. The old portable runtime is historical source, not a supported adapter or migration path for the current implementation.
