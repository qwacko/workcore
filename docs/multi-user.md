# Application permissions

Workcore does not prescribe teams, organizations, roles or a membership schema. An application decides what each authenticated user may read or change. A workspace is a Durable Object/storage boundary, not necessarily a group of people.

## The todo and notes example

The existing demo illustrates the main boundaries without a separate team model:

- **Todos:** authenticated users can see shared tasks and their own private tasks. Only the owner can edit or complete a task; making it visible to another user does not grant that user write access.
- **Notes:** each user can read and edit their own notes. Other users do not receive those notes through the application views.
- **Administration:** explicitly trusted users can inspect tables and execution state. `$admin` inspection is more powerful than normal task/note views and can expose all users' private records; it should not be granted just to show a dashboard.

See `examples/workcore-demo/src/app.ts` and `notes.ts` for the server-side policies. The Mine/Everyone filter and other browser controls only change presentation of data the server already authorized.

## Authentication, operations and records

1. The host authenticates requests and supplies a stable user ID through `routeWorkspace.authenticate`. Do not trust an identity or permission flag supplied by the browser.
2. The definition's `authorize` callback decides whether that user may invoke an operation or connect to live updates. Use current trusted policy data; a permission system can be as simple as an owner check or an application-defined access flag.
3. View/query handlers select the permitted rows and fields. Mutation handlers check ownership or other write rules in the same SQL statement that updates/deletes a record. Permission to call an operation is not permission to access every record it could handle.

If an application also restricts which workspace keys a user may address, the optional `routeWorkspace.authorizeWorkspace(session, workspaceId, request)` hook can perform a host-owned check before contacting the DO. This does not require a workspace directory, enrollment workflow or role system. Workspace names are identifiers, not credentials, and current operation/record checks still belong in the application.

## Permission changes and live privacy

Views whose **row or field projection** depends on permission data should list that data's trigger key in `dependsOn`. A user can remain permitted to call a view while becoming permitted to see fewer rows. Mutations that change such permissions must emit the corresponding key. Omitting `dependsOn` remains the safe wildcard default.

All subscription refreshes recheck `$connect`; revoking connection access closes the socket and clears client data. System subscriptions reauthorize and reproject on every commit, including all-runs versus own-runs inspection. Existing downloads cannot be retracted, and external cookie/session revocation must be reflected in current application policy or wait for the bounded socket session expiry. Dispose/recreate the client when switching signed-in identities.

## Concurrent editing

Use a per-record `versionColumn()`, not the workspace revision, as the optimistic concurrency token. In the **same SQL update/delete** include identity, ownership, and `versionMatch(table.version, expectedVersion)`. Increment the version on success, then call `requireChanged(returnedRow)` on the `.returning().get()` result. It returns HTTP 409 `CONFLICT` without disclosing whether a row changed, disappeared or belongs to another actor.

Keep the editor draft on conflict, offer reload/compare, and let the user explicitly reapply changes. Never automatically retry an obsolete edit with the new version. Request IDs prevent duplicate submissions; they do not replace version checks.

The todo and notes applications use these helpers. Tests cover private/shared task visibility, private notes, cross-user writes, stale edits, separate workspace storage, and live permission revocation. Extra policy controls used to test revocation are test-only, not features added to the example app.
