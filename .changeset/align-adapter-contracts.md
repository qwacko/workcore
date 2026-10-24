---
"@workcore/core": patch
"@workcore/adapters": patch
"@workcore/client": patch
"@workcore/admin": patch
"@workcore/schema-zod": patch
"@workcore/ai-sdk": patch
---

Align memory/file/PostgreSQL adapter behavior under shared contract tests: isolate mutable state snapshots, prevent missed queue wake-ups and cross-workspace schedule edits, preserve dispatch reservations, and skip overlapping recurring runs consistently. Separate file persistence and one-time KV migration from service behavior, avoid unchanged-state writes, and enforce terminal task retention. Preserve public memory exports while extracting their implementation from the runtime.

Make Redis and client subscription disposal safe across replacement/late notifications, share safe admin field-path resolution, validate pagination configuration consistently, and simplify AI SDK cancellation/tool bookkeeping without changing its completion contract.
