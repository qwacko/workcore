# Backup, restore and operations

## Trusted maintenance APIs

`@workcore/core/backup` exports `exportWorkspace`, `restoreWorkspace`, `copyBackupFiles`, and the versioned `backupSchema`. These are server/operator APIs, intentionally absent from the public client and HTTP router. Do not expose database backups to ordinary users or models: they contain other users' data, permission data, internal KV, jobs and traces.

Snapshots include every **registered** SQLite table (application and Workcore internals), SQL values including binary blobs, a physical-schema/migration signature, and ready-file storage keys/sizes. They do not include unregistered legacy tables, host identities in D1, Worker secrets, or R2 bytes. Back up those separately. The default encoded snapshot limit is 16 MiB; this is a small-workspace maintenance API, not a streaming database dump. For larger workspaces use Cloudflare's platform recovery/export facilities.

The helpers reject SQL triggers and foreign keys from unregistered tables into snapshot tables, rather than silently replaying trigger effects or cascading into data outside the snapshot. Register all related application tables, or use platform-level recovery for schemas outside these boundaries.

## Backup procedure

1. Enter host-enforced maintenance mode: reject writes/new work, pause dispatch, close active sockets and drain handlers. `maintenance: true` is a required operator acknowledgment, **not** an automatically installed traffic lock. The helper rejects running jobs and pending/deleting uploads, but the host must prevent requests from racing the database/R2 copy.
2. Inside trusted DO code, take a synchronous, transactional snapshot:

   ```ts
   import { exportWorkspace, copyBackupFiles } from '@workcore/core/backup';

   const backup = exportWorkspace(this.ctx.storage, definition, { maintenance: true });
   await copyBackupFiles(backup, env.FILES_BUCKET, archiveBucket);
   // Only now persist the JSON manifest in your private archive.
   ```

   Use a distinct archive bucket or a prefix-scoped bucket adapter for **each immutable snapshot**. `copyBackupFiles` preserves object keys, streams bytes and verifies sizes; it must not point at the live source bucket. Size checks are not cryptographic integrity checks: use provider checksums or hashes in your archive tooling if required.
3. Store the manifest, application release identifier, workspace identity and original definition/migrations together. Restrict archive access and apply appropriate encryption/retention policies. Only publish a manifest after all object copies succeed. Archive the host auth/directory databases through their own supported backup paths.
4. Test restoring a snapshot to an isolated environment before relying on it, then resume traffic.

## Restore procedure

1. Provision an isolated target with the exact original definition and migrations. Do not combine restore with a schema upgrade or point it at the source's live R2 bucket.
2. Keep the target in maintenance mode. Copy archived objects to its dedicated target bucket using `copyBackupFiles(backup, archiveBucket, targetBucket)` and verify success **before** restoring metadata. A failed copy leaves the target offline; retry or discard that isolated target.
3. Restore SQLite atomically:

   ```ts
   import { restoreWorkspace } from '@workcore/core/backup';

   const revision = restoreWorkspace(this.ctx.storage, definition, backup, {
     maintenance: true,
     confirm: 'replace-workspace',
     expectedRevision: this.engine.revision,
   });
   ```

   This explicitly replaces registered-table data. Schema/table/column mismatches, changed target revisions, invalid rows and foreign-key violations fail without partially replacing SQLite. SQL from the snapshot is never executed. A successful restore advances the revision, clears old request-ID responses, converts queued/running work to interrupted, and disables schedules. Inspect effects before explicitly retrying runs or re-enabling schedules.
4. Close/reconnect clients and rearm the workspace alarm (for example `await this.ctx.storage.setAlarm(Date.now() + 1000)`) before leaving maintenance. Compare known records, permissions, private projections, file downloads and execution state. Reconcile host identities and any host-owned access data separately. Upgrade through normal migrations only after validating the original-version restore.

For production, also understand and rehearse Cloudflare SQLite Durable Object point-in-time recovery and R2 recovery/retention. Database recovery and R2 are not one atomic snapshot; a database-only rollback cannot resurrect deleted objects. Keep an operator runbook and never rehearse destructive recovery against the only copy of real data.

## Diagnostics and recovery controls

Administrators can open **Workspace health** in the console or call `client.system('health.inspect', {})`. It reports revision, migration timestamp, run counts by status, oldest queued creation time, next work deadline, next schedule time and file lifecycle counts. `nextWorkDue` is the desired work deadline, not a claim about the persisted alarm; inspect `ctx.storage.getAlarm()` in trusted operator tooling to compare the actual alarm. Socket expiry can also make the actual alarm earlier.

Use the Runs status filter to find failed/interrupted work. Retrying creates a new run, records `retryOf`, returns its ID, and navigates to that run. It may repeat external effects. Use idempotency keys at external providers where supported. A cooperative `timeoutMs` aborts the signal and prevents further checked tools, but cannot kill arbitrary JavaScript.
