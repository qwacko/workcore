# Display protocol v3

The display protocol is the framework-neutral, server-authored UI contract. `manifest.protocol` versions the whole runtime manifest; `manifest.displayProtocol` versions display documents and renderer semantics independently. V3 is `displayProtocol: 3`. It adds recursive composition, layout/action nodes, and typed collection-selection bindings. A client must reject an unsupported version rather than guessing. The review fixtures in `tests/fixtures/display-protocol/` are the conformance examples for the current contract.

## Wire contract

- A display has metadata, an optional Zod input schema, and exactly one of a static document or a resolver. Listing a display returns metadata and input schema; it does not execute a resolver.
- A document is an ordered list of nodes with stable, unique IDs. V3 node kinds are `collection`, `record`, `json`, `markdown`, `form`, `button`, `chat`, `system`, `custom`, `section`, `columns`, and `dialog`. The recursive discriminated schema rejects incomplete nodes before rendering. `section`, `columns`, and `dialog` contain child nodes; custom nodes may also provide children.
- Source nodes refer to registered `view` or `query` names. Each source receives a JSON input object validated by its own endpoint. Every read, action, and display is independently authorised when called; inclusion in a document grants no authority.
- `ui.bind.property(path)` maps a validated display input property into a declared source input. A selectable collection may declare a row key; `ui.bind.selection(nodeId)` maps its selected key into another source's declared input. These bindings are finite tagged data, not strings interpreted as expressions. Arbitrary source-result, actor, or action-result bindings are not part of v3.
- Actions refer to registered mutations/jobs and carry fixed values, row bindings, conditions, and optional validated success navigation/effects. Effects use a finite vocabulary (`state.set/reset`, `form.reset`, `dialog.close`, `source.refresh`, and `navigate`); they carry no callbacks or executable code. Mutations enforce authorization and input validation regardless of rendered affordances.
- Custom nodes carry a namespaced component name, positive version, and JSON props. Component schemas are validated server-side; implementations are selected only from a host-local renderer registry. An unsupported local renderer yields a diagnostic.
- Each wire node kind has a focused renderer. Layout nodes arrange semantic children, while the host owns visual styling. V3 layout is deliberately limited to card/plain sections, up to four responsive columns, dialogs, and declared action buttons; it does not transmit CSS or arbitrary templates. Selection state is local to one mounted display instance and contains only a key, not row authority.
- Chat parts are typed text or display references. Live display parts resolve and authorize at read time; snapshot/live semantics are explicit. Stored display content is still subject to application authorization and should not be treated as an authorization cache.

## Lifecycle and state

- The display document and its source data are separate subscriptions. A source subscription gets one initial snapshot; a commit rechecks authorization and refreshes affected views, while dynamic displays are re-resolved after commits because handlers may read application tables beyond view dependency metadata.
- Equal source kind/name/input values share the client source lifecycle. Unmounted nodes unsubscribe. Late messages for disposed subscription IDs are ignored.
- Loading, live, reconnecting, and error are distinct source states. A closed/expired session is not silently treated as live data; the host must reauthenticate before reconnecting.
- Declared display state is typed and instance-scoped. Only fields explicitly marked for URL persistence are serialized; collection-local filter/sort/presentation keys follow their own renderer policy. Selection, forms, and component-local interactions remain in memory. There is no implicit localStorage/offline persistence or cross-browser state synchronization.
- Back links are constrained to the current workspace route. Detail and create-to-detail navigation serialize only declared input values; secrets must not be put into route state.

## Bounds and compatibility

- Documents are JSON-only, limited to 200 nodes across the tree, 12 nesting levels, and 512 KiB. Display names and node IDs are bounded and validated; node IDs are unique across a whole document. Display-reference nodes may embed other authorized displays; mounted instances enforce ancestry/depth checks and a shared active-embed reservation budget to prevent cycles and runaway subscriptions.
- Built-in node kinds are covered by the protocol schema. Components are separately versioned; an incompatible component version is rejected during compilation. Unknown or malformed node kinds do not silently disappear.
- Changes to node shape or shared renderer semantics require a new display protocol version. Additive metadata may be optional within the same version. Applications may instead use the headless client or a local custom page when the standard renderer is insufficient.

## Deliberate v3 boundaries

The optional `@workcore/saved-displays` package stores JSON display documents in an application-registered table. It validates the protocol document and explicit source/action/component allowlists before create, update, publish, and resolution. Drafts are private by default; publishing and cross-user reads require explicit policy callbacks. Referenced endpoints continue to enforce their own authorization. This optional capability is separate from the core protocol and does not add executable code or grant authority through composition.

The shared Svelte application renderer is exported from `@workcore/admin/renderer`. It accepts a runtime client, authorized manifest, display/input, local renderer registry, and host adapter; the consuming application owns its route, branding, and URL base. It is not tied to the console's `/admin` route prefix.
