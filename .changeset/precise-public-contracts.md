---
'@workcore/core': minor
'@workcore/client': minor
---

Strengthen execution contracts, configuration validation, and client diagnostics.

- Align handler and authorization-resolver types with schema transformations, preserving validated caller/checker outputs.
- Add the compatible `defineApplication` alias and exclude statically internal operations from inferred browser clients.
- Fix complete admin mount precedence; validate platform limits and worker prerequisites early; support separate interactive/background handler deadlines.
- Preserve structured validation issues and correlation IDs; add opt-in detailed client responses and injectable HTTP headers/SSE sources. Reject malformed operation success responses instead of treating them as empty results.
- Fail closed on incompatible persisted task, agent, and schedule input versions.
- Add executable integration examples and configuration, authorization, HTTP/SSE, upgrade, and retry references.

### Migration notes

- Handlers with transforming output schemas return the schema's input type, not its already-transformed output. Authorization-context resolvers likewise return raw schema input; checkers receive validated output.
- Browser clients reject statically internal operation names. Creating a worker requires `auth.resolveActor`.
- Incompatible persisted input changes require an operation/agent version bump and a drain/migration procedure. Legacy payloads default to version 1; version checks do not provide mixed-version worker routing.
- Mount-level admin settings replace the entire legacy platform fallback descriptor.
- Fetch/SSE credential policies now align. Cross-origin cookie-based subscriptions require `credentials: 'include'`; `credentials: 'omit'` requires a custom subscription source because native EventSource cannot omit same-origin cookies.
