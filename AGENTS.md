# Working on Workcore

These instructions apply to this repository and its packages, example, scripts and
documentation. Consumer applications use `packages/core/AGENTS.example.md` instead.

## Documentation is part of every feature

- `docs/` (VitePress) is the primary manual. Read `docs/index.md`,
  `docs/reference.md` and `docs/contributing.md` before changing public behavior.
- Update the relevant guide **and** API reference in the same change as a feature,
  option, exported function/type, client method, permission, limit, error, lifecycle
  or operational behavior. New public APIs need examples, inputs/results, defaults,
  authorization, failure semantics, limitations and links—not just a name in a list.
- Maintain the public entry-point inventory in `docs/reference.md`. Add a new page
  to the grouped sidebar and agent reading map where appropriate. Keep existing
  URLs/anchors working or provide explicit migration links.
- Do not turn README.md or the consumer agent template into parallel manuals.
  README explains fit/features and links to docs; the template gives a reading map
  and essential safety rules. Detailed contracts and examples belong in VitePress.
- Documentation must describe implemented behavior, not planned APIs. Verify source,
  tests and installed declarations; identify unreleased versus published behavior.
- Follow the documentation structure and change checklist in `docs/contributing.md`.

## Safety and verification

- Preserve application-owned authentication/permissions; do not invent a required
  teams/organization framework or trust client-supplied identity/roles.
- Keep synchronous SQLite operations separate from external effects. Preserve live
  authorization, bounded snapshots, migration history and partial-release safety.
- Inspect existing changes before editing. Never overwrite user configuration,
  secrets or applied migrations. Do not deploy, publish, push, change production
  resources or perform destructive recovery without authorization.
- At minimum run `pnpm test:docs` and `pnpm docs:build` for documentation changes.
  Public code changes also need appropriate type/runtime/browser tests.
- `pnpm test:packages` compiles the actual getting-started files extracted from
  VitePress against packed libraries and builds the existing example with them.
  Run it when changing setup examples, package exports or distribution behavior.
  Do not move those examples back to the README or bypass checks when they fail.

Use `pnpm run deploy`, not `pnpm deploy`, if explicitly authorized to deploy the
example. The latter is pnpm's built-in package deployment command.
