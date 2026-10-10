# Workcore

A TypeScript workspace application runtime for quickly building full-stack apps, with clear authoring patterns for developers and AI coding agents.

Define queries, mutations and background tasks once, then reuse their validation, permissions, live updates and generated admin UI. Applications own their domain data and repositories; Workcore supplies checked execution and pluggable infrastructure capabilities.

## Status

Design stage; implementation has not started. See the [implementation brief](workspace-framework-implementation-brief.md) for the proposed API, agreed decisions, delivery order and completion checks.

## Planned foundation

- pnpm monorepo with framework-independent core and typed client.
- Standard Schema validation and JSON Schema-backed UI metadata.
- Workspace-scoped access checks and capability/custom permission policies.
- HTTP calls and SSE live queries.
- Background tasks, persistent history and one-off/recurring schedules.
- Optional prebuilt admin UI, served on a host route without a consumer frontend build.
- Reference PostgreSQL, Redis/BullMQ and Better Auth adapters.
- TypeScript 7 where supported, without making UI toolchain compatibility a blocker.

Start with type-inference tests and one end-to-end query/edit/live-update example. Framework-managed transactions/outbox, configurable task retries, agents and custom views remain roadmap items.

Documentation lives in Markdown initially; a static documentation site can follow as the API becomes executable.
