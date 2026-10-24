---
"@workcore/core": patch
---

Consolidate HTTP and internal execution into a shared runtime boundary, also used for queued task handlers. Compile manifest schemas and default presentations at setup, and project visibility using a fresh request-local authorization snapshot. Preserve public APIs, wire responses, and task/schedule recovery contracts; record internal context-creation failures in execution history.
