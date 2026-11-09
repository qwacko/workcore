# Changelog

## 0.1.1 — 2026-11-09

- Coordinated patch release of all five packages for the first automated npm publication through GitHub Actions trusted publishing.
- No runtime API changes from 0.1.0.

## 0.1.0 — 2026-11-09

Initial Cloudflare-first release, intended first for applications authored by the maintainer. The 0.x public API may change.

- Typed Drizzle SQLite schemas, transactional mutations, authorized views/queries, live browser subscriptions and revision tracking.
- Durable Object hosting, persisted task/agent runs, schedules, cooperative cancellation/deadlines, inspection and explicit retry lineage.
- Optional prebuilt admin console, R2 file storage and AI SDK integration.
- Todo/notes reference application with server-side privacy and owner-scoped, version-checked edits.
- Trusted maintenance backup/restore helpers and operational diagnostics.
- Compiled ESM/declaration packages, consumer setup documentation and a copyable coding-agent guide.

This implementation does not migrate data from the earlier portable runtime. Authentication and application-specific permissions remain host/application-owned; external effects are not exactly-once.
