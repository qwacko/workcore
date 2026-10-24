---
'@workcore/core': minor
---

Add optional `defineModule`/`composeApplication` authoring for reusable local operation catalogs.

- Wire modules through execution-bound typed synchronous dependency factories and optional awaited callbacks, with required dependency checks.
- Namespace operations and KV, enrich scoped logs with module metadata, and preserve validation, authorization, actor/scope, cancellation, and history through checked local/cross-module calls.
- Compose admin pages, views, collection actions/editors, chat references, mutation triggers, and agent tools into the existing runtime and wire protocol. Qualified presentation reference types match their compiled values.
- Preserve inferred client exposure and operation input/output types. Existing single-definition APIs and event infrastructure remain unchanged.
- Include a small executable composition example and refactor the main tracker into activities/assistant modules with real capability wiring and a combined overview page.

The tracker demo now uses qualified operation identifiers. Startup backs up and migrates known compatible pending local task/schedule/agent state; custom clients must update their operation names. Callback failures do not roll back prior writes, and composition does not introduce shared transactions or actor-style serialization.
