import { z } from 'zod';
import { compileAdmin, manifestSchema } from './ui.js';
import type { Actor, Definition, Job, Json, MutationContext, Operation, ReadContext, RunContext } from './definitions.js';
import { assertSync, checkName, encode, json, WorkcoreError } from './json.js';
import { getJson, initialize, saveRun, saveSchedule, Store } from './store.js';
import type { Run, Schedule, Storage } from './store.js';

export type Result = { data: Json; revision: number };
export type Commit = { revision: number; changed: Set<string> };

export class Engine {
  private readonly controllers = new Map<string, AbortController>();
  onCommit: (commit: Commit) => void = () => {};
  constructor(readonly storage: Storage, readonly definition: Definition, readonly env: unknown) {
    for (const name of Object.keys(definition.views)) {
      if (Object.hasOwn(definition.queries, name)) throw new Error(`Views and queries cannot share the name ${name}`);
    }
    for (const [group, operations] of Object.entries({ view: definition.views, query: definition.queries, mutation: definition.mutations, job: definition.jobs })) {
      for (const [name, operation] of Object.entries(operations)) {
        checkName(name);
        z.toJSONSchema(operation.input, { io: 'input' });
        z.toJSONSchema(operation.output);
        if (group === 'view') {
          const view = definition.views[name]!;
          if (!Number.isInteger(view.maxRows ?? 500) || (view.maxRows ?? 500) < 1 || (view.maxRows ?? 500) > 1000) throw new Error(`Invalid maxRows for ${name}`);
          for (const dependency of view.dependsOn) {
            if (!(dependency in definition.tables) && dependency !== '$kv') throw new Error(`Unknown dependency ${dependency}`);
          }
        }
      }
    }
    for (const table of Object.values(definition.tables)) z.toJSONSchema(table.schema);
    // Resolve references at startup, even if no actor will be allowed to see them.
    compileAdmin(definition, () => true);
    storage.transactionSync(() => {
      initialize(storage, definition.tables);
      if (!this.meta('initialized')) {
        const db = new Store(storage.sql, definition.tables, 1, true);
        try { assertSync(definition.initialize?.(db)); } finally { db.close(); }
        this.setMeta('initialized', 'true');
        this.setMeta('revision', '1');
      }
      // Never blindly replay a model/tool/external effect whose outcome is unknown.
      for (const row of storage.sql.exec<{ data: string }>("SELECT data FROM wc_runs WHERE status = 'running'").toArray()) {
        const run = JSON.parse(row.data) as Run;
        saveRun(storage.sql, { ...run, status: 'interrupted', updatedAt: Date.now(), error: 'Execution interrupted; inspect effects before explicitly retrying' });
      }
    });
  }
  private meta(key: string): string | null {
    return this.storage.sql.exec<{ value: string }>('SELECT value FROM wc_meta WHERE key = ?', key).toArray()[0]?.value ?? null;
  }
  private setMeta(key: string, value: string): void {
    this.storage.sql.exec('INSERT OR REPLACE INTO wc_meta (key, value) VALUES (?, ?)', key, value);
  }
  get revision(): number { return Number(this.meta('revision') ?? '0'); }
  private read<T>(callback: (db: Store<any>) => T): T {
    const db = new Store(this.storage.sql, this.definition.tables, this.revision, false);
    try { return callback(db); } finally { db.close(); }
  }
  private write<T>(callback: (db: Store<any>) => T): T {
    let commit: Commit | undefined;
    const value = this.storage.transactionSync(() => {
      const db = new Store(this.storage.sql, this.definition.tables, this.revision + 1, true);
      try {
        const result = callback(db);
        assertSync(result);
        this.setMeta('revision', String(db.revision));
        commit = { revision: db.revision, changed: db.changed };
        return result;
      } finally { db.close(); }
    });
    // Publication is recoverable through full snapshots on reconnect/heartbeat.
    if (commit) { try { this.onCommit(commit); } catch (error) { console.error('View publication failed', error); } }
    return value;
  }
  private allowed(db: Store<any>, actor: Actor, action: string): boolean {
    const result = this.definition.authorize({ db, actor, now: Date.now() }, action);
    assertSync(result);
    return result === true;
  }
  private authorize(db: Store<any>, actor: Actor, action: string): void {
    if (!this.allowed(db, actor, action)) throw new WorkcoreError('FORBIDDEN', 'Access denied', 403);
  }
  private fileConfig() {
    const files = this.definition.files;
    if (!files || !Object.hasOwn(this.definition.tables, files.table)) throw new WorkcoreError('FILES_DISABLED', 'File storage is not configured', 404);
    return files;
  }
  private fileRow(db: Store<any>, id: string): any {
    const row = db.get(this.fileConfig().table, id);
    if (!row) throw new WorkcoreError('NOT_FOUND', 'File not found', 404);
    return row;
  }
  private canAccessFile(db: Store<any>, actor: Actor, row: any): void {
    if (row.data.ownerId !== actor.id && !this.allowed(db, actor, '$admin')) throw new WorkcoreError('FORBIDDEN', 'Access denied', 403);
  }
  createFile(actor: Actor, input: { filename: string; contentType: string; size: number }): { id: string; status: string } {
    return this.write(db => {
      this.authorize(db, actor, 'file:upload');
      const files = this.fileConfig();
      if (!Number.isSafeInteger(input.size) || input.size < 0 || input.size > files.maxSize) throw new WorkcoreError('FILE_TOO_LARGE', 'File size is outside the configured limit', 413);
      const id = crypto.randomUUID();
      const filename = input.filename.normalize('NFC').replace(/[\/\0-\x1f\x7f]/g, '_').slice(0, 255) || 'file';
      const contentType = /^[\w.+-]+\/[\w.+-]+$/.test(input.contentType) ? input.contentType.slice(0, 255) : 'application/octet-stream';
      db.put(files.table, id, { ownerId: actor.id, filename, contentType, size: input.size, status: 'pending', createdAt: Date.now(), uploadedAt: null });
      return { id, status: 'pending' };
    });
  }
  finishFileUpload(actor: Actor, id: string, size: number): void {
    this.write(db => {
      this.authorize(db, actor, 'file:upload');
      const row = this.fileRow(db, id);
      if (row.data.ownerId !== actor.id || row.data.status !== 'pending' || row.data.size !== size) throw new WorkcoreError('INVALID_FILE_STATE', 'Upload cannot be finalized', 409);
      db.put(this.fileConfig().table, id, { ...row.data, status: 'ready', uploadedAt: Date.now() }, { expectedRevision: row.revision });
    });
  }
  getFile(actor: Actor, id: string): any {
    return this.read(db => {
      this.authorize(db, actor, 'file:download');
      const row = this.fileRow(db, id);
      this.canAccessFile(db, actor, row);
      if (row.data.status !== 'ready') throw new WorkcoreError('FILE_NOT_READY', 'File is not available', 404);
      return row;
    });
  }
  listFiles(actor: Actor, after = ''): { rows: unknown[]; nextCursor: string | null } {
    return this.read(db => {
      this.authorize(db, actor, 'file:list');
      const admin = this.allowed(db, actor, '$admin');
      return db.page(this.fileConfig().table, { limit: 100, after, ...(!admin ? { index: { name: 'owner', value: actor.id } } : {}) });
    });
  }
  beginFileDelete(actor: Actor, id: string): any {
    return this.write(db => {
      this.authorize(db, actor, 'file:delete');
      const row = this.fileRow(db, id);
      this.canAccessFile(db, actor, row);
      if (row.data.status !== 'deleting') db.put(this.fileConfig().table, id, { ...row.data, status: 'deleting' }, { expectedRevision: row.revision });
      return row;
    });
  }
  finishFileDelete(actor: Actor, id: string): void {
    this.write(db => {
      this.authorize(db, actor, 'file:delete');
      const row = this.fileRow(db, id);
      this.canAccessFile(db, actor, row);
      if (row.data.status !== 'deleting') throw new WorkcoreError('INVALID_FILE_STATE', 'File deletion is not pending', 409);
      db.delete(this.fileConfig().table, id, { expectedRevision: row.revision });
    });
  }
  fileCleanupCandidates(now = Date.now()): { id: string; ownerId: string; status: string; createdAt: number }[] {
    const table = this.definition.files?.table;
    if (!table) return [];
    return this.read(db => db.page(table, { limit: 1000 }).rows
      .filter(row => row.data.status === 'deleting' || row.data.status === 'pending' && Number(row.data.createdAt) < now - 86_400_000)
      .map(row => ({ id: row.id, ownerId: String(row.data.ownerId), status: String(row.data.status), createdAt: Number(row.data.createdAt) })));
  }
  completeFileCleanup(id: string): void {
    this.write(db => {
      const table = this.definition.files?.table;
      if (!table) return;
      const row = db.get(table, id);
      if (row && (row.data.status === 'deleting' || row.data.status === 'pending' && Number(row.data.createdAt) < Date.now() - 86_400_000)) {
        db.delete(table, id, { expectedRevision: row.revision });
      }
    });
  }
  can(actor: Actor, action: string): boolean { return this.read(db => this.allowed(db, actor, action)); }
  private lookup<T>(map: Record<string, T>, name: string): T {
    if (!Object.hasOwn(map, name)) throw new WorkcoreError('NOT_FOUND', 'Unknown operation', 404);
    return map[name]!;
  }
  private output(operation: Operation | Job, value: unknown): Json {
    assertSync(value);
    return json(operation.output.parse(value));
  }
  query(actor: Actor, name: string, input: unknown, live = false): Result {
    return this.read(db => {
      const isView = Object.hasOwn(this.definition.views, name);
      const operation = live || isView ? this.lookup(this.definition.views, name) : this.lookup(this.definition.queries, name);
      this.authorize(db, actor, `${isView || live ? 'view' : 'query'}:${name}`);
      const data = this.output(operation, operation.handler({ db, actor, now: Date.now() }, operation.input.parse(input)));
      if ((live || isView) && Array.isArray(data) && data.length > (this.definition.views[name]!.maxRows ?? 500)) {
        throw new WorkcoreError('VIEW_TOO_LARGE', 'Narrow the view scope; complete live views cannot be truncated');
      }
      return { data, revision: db.revision };
    });
  }
  private nameOf(map: Record<string, unknown>, operation: unknown): string {
    const entry = Object.entries(map).find(([, value]) => value === operation);
    if (!entry) throw new WorkcoreError('UNREGISTERED_OPERATION', 'Operation must be registered in this workspace');
    return entry[0];
  }
  private queue(db: Store<any>, actor: Actor, job: Job, input: unknown, scheduleId?: string, id = crypto.randomUUID()): string {
    db.assertWritable();
    const name = this.nameOf(this.definition.jobs, job);
    this.authorize(db, actor, `job:${name}`);
    job.input.parse(input);
    const now = Date.now();
    const run: Run = { id, job: name, kind: job.kind, actor, input: json(input), status: 'queued', attempt: 0, due: now, createdAt: now, updatedAt: now };
    if (scheduleId) run.scheduleId = scheduleId;
    saveRun(this.storage.sql, run);
    db.changed.add('$runs');
    return id;
  }
  private context(db: Store<any>, actor: Actor): MutationContext<any> {
    return {
      db, actor, now: Date.now(),
      enqueue: (job, input) => this.queue(db, actor, job, input),
      schedule: (job, input, options) => {
        db.assertWritable();
        const name = this.nameOf(this.definition.jobs, job);
        this.authorize(db, actor, `job:${name}`);
        job.input.parse(input);
        if (!Number.isSafeInteger(options.at) || options.at < 0 || (options.everyMs !== undefined && (!Number.isSafeInteger(options.everyMs) || options.everyMs < 1000))) {
          throw new WorkcoreError('INVALID_SCHEDULE', 'Use an epoch-millisecond timestamp and an optional interval of at least 1000ms');
        }
        const schedule: Schedule = { id: crypto.randomUUID(), job: name, actor, input: json(input), at: options.at, enabled: true, createdAt: Date.now() };
        if (options.everyMs !== undefined) schedule.everyMs = options.everyMs;
        saveSchedule(this.storage.sql, schedule);
        db.changed.add('$schedules');
        return schedule.id;
      },
      cancelSchedule: id => {
        db.assertWritable();
        const schedule = getJson<Schedule>(this.storage.sql, 'wc_schedules', id);
        if (!schedule) throw new WorkcoreError('NOT_FOUND', 'Unknown schedule', 404);
        if (schedule.actor.id !== actor.id) this.authorize(db, actor, '$admin');
        saveSchedule(this.storage.sql, { ...schedule, enabled: false });
        db.changed.add('$schedules');
      },
    };
  }
  private deduplicate(db: Store<any>, actor: Actor, requestId: string, fingerprint: string, execute: () => Json): Result {
    if (!requestId || requestId.length > 200) throw new WorkcoreError('INVALID_REQUEST_ID', 'Supply a requestId of 1–200 characters');
    const id = encode([actor.id, requestId]);
    const prior = this.storage.sql.exec<{ fingerprint: string; response: string }>('SELECT fingerprint, response FROM wc_requests WHERE id = ?', id).toArray()[0];
    if (prior) {
      if (prior.fingerprint !== fingerprint) throw new WorkcoreError('REQUEST_ID_REUSED', 'Request ID was already used for a different operation', 409);
      return JSON.parse(prior.response) as Result;
    }
    const response: Result = { data: execute(), revision: db.revision };
    this.storage.sql.exec('INSERT INTO wc_requests (id, fingerprint, response) VALUES (?, ?, ?)', id, fingerprint, encode(response));
    this.storage.sql.exec('DELETE FROM wc_requests WHERE rowid NOT IN (SELECT rowid FROM wc_requests ORDER BY rowid DESC LIMIT 1000)');
    return response;
  }
  private history(db: Store<any>, actor: Actor, operation: string, runId?: string): void {
    const entry: Record<string, Json> = { actorId: actor.id, operation, at: Date.now(), revision: db.revision };
    if (runId) entry.runId = runId;
    this.storage.sql.exec('INSERT INTO wc_history (id, data) VALUES (?, ?)', crypto.randomUUID(), encode(entry));
    this.storage.sql.exec('DELETE FROM wc_history WHERE rowid NOT IN (SELECT rowid FROM wc_history ORDER BY rowid DESC LIMIT 1000)');
  }
  private executeMutation(db: Store<any>, actor: Actor, name: string, input: unknown, runId?: string): Json {
    const operation = this.lookup(this.definition.mutations, name);
    this.authorize(db, actor, `mutation:${name}`);
    const data = this.output(operation, operation.handler(this.context(db, actor), operation.input.parse(input)));
    this.history(db, actor, `mutation:${name}`, runId);
    return data;
  }
  mutate(actor: Actor, name: string, input: unknown, requestId: string): Result {
    return this.write(db => {
      this.authorize(db, actor, `mutation:${name}`);
      return this.deduplicate(db, actor, requestId, encode(['mutation', name, input]), () => this.executeMutation(db, actor, name, input));
    });
  }
  enqueue(actor: Actor, name: string, input: unknown, requestId: string): Result {
    return this.write(db => {
      this.authorize(db, actor, `job:${name}`);
      return this.deduplicate(db, actor, requestId, encode(['job', name, input]), () => this.queue(db, actor, this.lookup(this.definition.jobs, name), input));
    });
  }
  manifest(actor: Actor): Json {
    return this.read(db => {
      const manifest: Record<string, Json> = { protocol: 2, actor: { id: actor.id }, admin: this.allowed(db, actor, '$admin'), runs: this.allowed(db, actor, '$runs'), files: {
        enabled: !!this.definition.files,
        upload: !!this.definition.files && this.allowed(db, actor, 'file:upload'),
        list: !!this.definition.files && this.allowed(db, actor, 'file:list'),
        download: !!this.definition.files && this.allowed(db, actor, 'file:download'),
        delete: !!this.definition.files && this.allowed(db, actor, 'file:delete'),
      } };
      for (const [kind, operations] of Object.entries({ view: this.definition.views, query: this.definition.queries, mutation: this.definition.mutations, job: this.definition.jobs })) {
        manifest[kind] = Object.fromEntries(Object.entries(operations).filter(([name]) => this.allowed(db, actor, `${kind}:${name}`)).map(([name, operation]) => [name, {
          // Zod annotates schema objects with non-enumerable Standard Schema methods.
          input: JSON.parse(JSON.stringify(z.toJSONSchema(operation.input, { io: 'input' }))) as Json,
          output: JSON.parse(JSON.stringify(z.toJSONSchema(operation.output))) as Json,
          ...(operation.ui ? { ui: json(operation.ui) } : {}),
        }]));
      }
      manifest.ui = json(compileAdmin(this.definition, (kind, name) => this.allowed(db, actor, `${kind}:${name}`)));
      return json(manifestSchema.parse(manifest));
    });
  }
  inspect(actor: Actor, resource: string, after = ''): Json {
    return this.read(db => {
      if (resource.startsWith('run:')) {
        this.authorize(db, actor, '$runs');
        const run = getJson<Run>(this.storage.sql, 'wc_runs', resource.slice(4));
        if (!run || (run.actor.id !== actor.id && !this.allowed(db, actor, '$admin'))) throw new WorkcoreError('FORBIDDEN', 'Access denied', 403);
        return JSON.parse(encode(run, 786_432)) as Json;
      }
      if (resource !== 'runs') this.authorize(db, actor, '$admin');
      else this.authorize(db, actor, '$runs');
      if (resource.startsWith('schedule:')) {
        const schedule = getJson<Schedule>(this.storage.sql, 'wc_schedules', resource.slice(9));
        if (!schedule) throw new WorkcoreError('NOT_FOUND', 'Unknown schedule', 404);
        return json(schedule);
      }
      if (resource === 'tables') return json(Object.fromEntries(Object.keys(this.definition.tables).map(name => [name, this.definition.tables[name]!.version])));
      if (resource.startsWith('table:')) return json(db.page(resource.slice(6), { limit: 100, after }));
      const resources: Record<string, string> = { runs: 'wc_runs', schedules: 'wc_schedules', history: 'wc_history' };
      if (!Object.hasOwn(resources, resource)) throw new WorkcoreError('NOT_FOUND', 'Unknown resource', 404);
      const table = resources[resource]!;
      const projection = resource === 'runs' ? "json_remove(data, '$.input', '$.result')" : resource === 'schedules' ? "json_remove(data, '$.input')" : 'data';
      const ownRuns = resource === 'runs' && !this.allowed(db, actor, '$admin');
      const scope = ownRuns ? " AND json_extract(data, '$.actor.id') = ?" : '';
      const rows = this.storage.sql.exec<{ data: string; id: string }>(`SELECT id, ${projection} AS data FROM ${table} WHERE id > ?${scope} ORDER BY id LIMIT 101`, after, ...(ownRuns ? [actor.id] : [])).toArray();
      const visible = rows.slice(0, 100).map(row => JSON.parse(row.data) as Record<string, Json>);
      return json({ rows: visible, nextCursor: rows.length > 100 ? rows[99]!.id : null });
    });
  }
  trace(actor: Actor, runId: string, after = 0): Json {
    return this.read(db => {
      this.authorize(db, actor, '$runs');
      const run = getJson<Run>(this.storage.sql, 'wc_runs', runId);
      if (!run || (run.actor.id !== actor.id && !this.allowed(db, actor, '$admin'))) throw new WorkcoreError('FORBIDDEN', 'Access denied', 403);
      const rows = this.storage.sql.exec<{ data: string; sequence: number }>('SELECT sequence, data FROM wc_steps WHERE run_id = ? AND sequence > ? ORDER BY sequence LIMIT 11', runId, after).toArray();
      return json({ rows: rows.slice(0, 10).map(row => ({ sequence: row.sequence, ...JSON.parse(row.data) as object })), nextCursor: rows.length > 10 ? rows[9]!.sequence : null });
    });
  }
  control(actor: Actor, resource: 'run' | 'schedule', id: string, action: string): void {
    this.write(db => {
      this.authorize(db, actor, '$admin');
      if (resource === 'schedule') {
        const schedule = getJson<Schedule>(this.storage.sql, 'wc_schedules', id);
        if (!schedule) throw new WorkcoreError('NOT_FOUND', 'Unknown schedule', 404);
        if (action !== 'enable' && action !== 'disable') throw new WorkcoreError('INVALID_ACTION', 'Use enable or disable');
        saveSchedule(this.storage.sql, { ...schedule, enabled: action === 'enable' });
        db.changed.add('$schedules');
      } else {
        const run = getJson<Run>(this.storage.sql, 'wc_runs', id);
        if (!run) throw new WorkcoreError('NOT_FOUND', 'Unknown run', 404);
        if (action === 'retry') {
          if (!['failed', 'interrupted', 'cancelled'].includes(run.status)) throw new WorkcoreError('INVALID_STATE', 'Only failed, interrupted or cancelled runs can be retried');
          this.queue(db, run.actor, this.lookup(this.definition.jobs, run.job), run.input);
        } else if (action === 'cancel') {
          if (run.status === 'running') run.cancelRequested = true;
          else if (run.status === 'queued') run.status = 'cancelled';
          run.updatedAt = Date.now();
          saveRun(this.storage.sql, run);
        } else throw new WorkcoreError('INVALID_ACTION', 'Use retry or cancel');
        db.changed.add('$runs');
      }
      this.history(db, actor, `${resource}:${action}`);
    });
    if (resource === 'run' && action === 'cancel') this.controllers.get(id)?.abort();
  }
  nextDue(): number | null {
    const values = [
      this.storage.sql.exec<{ due: number | null }>("SELECT min(due) AS due FROM wc_runs WHERE status = 'queued'").toArray()[0]?.due,
      this.storage.sql.exec<{ due: number | null }>('SELECT min(at) AS due FROM wc_schedules WHERE enabled = 1').toArray()[0]?.due,
    ].filter((value): value is number => typeof value === 'number');
    for (const file of this.fileCleanupCandidates()) values.push(file.status === 'deleting' ? Date.now() + 60_000 : file.createdAt + 86_400_000);
    return values.length ? Math.min(...values) : null;
  }
  dispatchSchedules(now = Date.now()): void {
    this.write(db => {
      const due = this.storage.sql.exec<{ data: string }>('SELECT data FROM wc_schedules WHERE enabled = 1 AND at <= ? ORDER BY at LIMIT 25', now).toArray();
      for (const row of due) {
        const schedule = JSON.parse(row.data) as Schedule;
        try {
          // Interval policy: coalesce missed occurrences; skip while the previous run is active.
          const active = this.storage.sql.exec<{ id: string }>("SELECT id FROM wc_runs WHERE status IN ('queued', 'running') AND json_extract(data, '$.scheduleId') = ? LIMIT 1", schedule.id).toArray().length > 0;
          if (!active) schedule.lastRunId = this.queue(db, schedule.actor, this.lookup(this.definition.jobs, schedule.job), schedule.input, schedule.id);
          delete schedule.lastError;
          if (schedule.everyMs) schedule.at += (Math.floor((now - schedule.at) / schedule.everyMs) + 1) * schedule.everyMs;
          else schedule.enabled = false;
        } catch (error) {
          schedule.enabled = false;
          schedule.lastError = error instanceof WorkcoreError ? error.code : error instanceof z.ZodError ? 'VALIDATION_FAILED' : 'DISPATCH_FAILED';
          this.history(db, schedule.actor, `schedule:disabled:${schedule.job}`);
          console.error('Schedule dispatch denied or invalid', error);
        }
        saveSchedule(this.storage.sql, schedule);
        db.changed.add('$schedules');
      }
    });
  }
  async executeNext(): Promise<boolean> {
    const row = this.storage.sql.exec<{ data: string }>("SELECT data FROM wc_runs WHERE status = 'queued' AND due <= ? ORDER BY due LIMIT 1", Date.now()).toArray()[0];
    if (!row) return false;
    const run = JSON.parse(row.data) as Run;
    const job = this.definition.jobs[run.job];
    this.write(db => {
      run.status = 'running'; run.attempt++; run.updatedAt = Date.now();
      saveRun(this.storage.sql, run); db.changed.add('$runs');
    });
    let steps = 0;
    let active = true;
    const controller = new AbortController();
    this.controllers.set(run.id, controller);
    const current = () => {
      if (!active) throw new WorkcoreError('EXPIRED_CONTEXT', 'Run context is no longer active');
      const saved = getJson<Run>(this.storage.sql, 'wc_runs', run.id)!;
      if (saved.cancelRequested || saved.status === 'cancelled') throw new WorkcoreError('CANCELLED', 'Cancellation requested');
      if (saved.status !== 'running') throw new WorkcoreError('EXPIRED_CONTEXT', 'Run is no longer executing');
      if (!job || !this.can(run.actor, `job:${run.job}`)) throw new WorkcoreError('FORBIDDEN', 'Job access denied');
    };
    const checkTool = (operation: Operation) => {
      current();
      if (job?.kind === 'agent' && !job.tools?.includes(operation)) throw new WorkcoreError('TOOL_DENIED', 'Tool is not allowlisted for this agent');
    };
    const allocateStep = () => {
      current();
      const maximum = Math.min(100, Math.max(1, job?.maxSteps ?? 20));
      if (++steps > maximum) throw new WorkcoreError('STEP_LIMIT', 'Agent/task step limit reached');
      return this.storage.sql.exec<{ sequence: number }>('SELECT coalesce(max(sequence), 0) + 1 AS sequence FROM wc_steps WHERE run_id = ?', run.id).toArray()[0]!.sequence;
    };
    const record = (db: Store<any>, sequence: number, data: Json) => {
      this.storage.sql.exec('INSERT OR REPLACE INTO wc_steps (run_id, sequence, data) VALUES (?, ?, ?)', run.id, sequence, encode(data));
      db.changed.add('$runs');
    };
    const context: RunContext<any, unknown> = {
      actor: run.actor, env: this.env, runId: run.id, signal: controller.signal,
      progress: value => {
        current();
        encode(value, 8192);
        this.write(db => {
          const saved = getJson<Run>(this.storage.sql, 'wc_runs', run.id)!;
          saved.progress = json(value); saved.updatedAt = Date.now();
          saveRun(this.storage.sql, saved); db.changed.add('$runs');
        });
      },
      read: (operation, input) => {
        checkTool(operation);
        const views = Object.values(this.definition.views).some(op => (op as unknown) === operation);
        const name = this.nameOf(views ? this.definition.views : this.definition.queries, operation);
        const sequence = allocateStep();
        const result = this.query(run.actor, name, input).data;
        this.write(db => record(db, sequence, { kind: 'tool', operation: `${views ? 'view' : 'query'}:${name}`, status: 'completed', at: Date.now() }));
        return result as any;
      },
      mutate: (operation, input) => {
        checkTool(operation);
        const name = this.nameOf(this.definition.mutations, operation);
        const sequence = allocateStep();
        return this.write(db => {
          const result = this.executeMutation(db, run.actor, name, input, run.id);
          record(db, sequence, { kind: 'tool', operation: `mutation:${name}`, status: 'completed', at: Date.now() });
          return result;
        }) as any;
      },
      step: async (label, execute) => {
        const sequence = allocateStep();
        const startedAt = Date.now();
        label = label.slice(0, 200);
        const recordStep = (data: Json) => {
          if (!active) throw new WorkcoreError('EXPIRED_CONTEXT', 'Run context is no longer active');
          return this.write(db => record(db, sequence, data));
        };
        recordStep({ kind: 'step', label, status: 'running', at: startedAt, startedAt });
        let result;
        try {
          result = await execute();
          encode(result, 32_768);
          recordStep({ kind: 'step', label, status: 'completed', at: Date.now(), startedAt, durationMs: Date.now() - startedAt, result: json(result) });
        } catch (error) {
          recordStep({ kind: 'step', label, status: 'failed', at: Date.now(), startedAt, durationMs: Date.now() - startedAt, error: error instanceof WorkcoreError ? error.code : 'STEP_FAILED' });
          throw error;
        }
        // Cancellation does not rewrite a completed external effect as a failed step.
        current();
        return result;
      },
    };
    try {
      current();
      const result = this.output(job!, await job!.handler(context, job!.input.parse(run.input)));
      current();
      run.status = 'completed'; run.result = result; delete run.error;
    } catch (error) {
      const cancelled = controller.signal.aborted || !!getJson<Run>(this.storage.sql, 'wc_runs', run.id)?.cancelRequested || error instanceof WorkcoreError && error.code === 'CANCELLED';
      const terminal = error instanceof z.ZodError || (error instanceof WorkcoreError && ['FORBIDDEN', 'TOOL_DENIED', 'STEP_LIMIT', 'NOT_FOUND', 'UNREGISTERED_OPERATION'].includes(error.code));
      const retry = !cancelled && !terminal && job?.kind === 'task' && run.attempt < Math.min(10, job.maxAttempts ?? 1);
      run.status = cancelled ? 'cancelled' : retry ? 'queued' : 'failed';
      run.error = error instanceof WorkcoreError ? error.code : 'EXECUTION_FAILED';
      run.due = Date.now() + Math.max(1000, job?.retryDelayMs ?? 5000);
      console.error(`Run ${run.id} ${run.status}`, error);
    }
    active = false;
    this.controllers.delete(run.id);
    this.write(db => {
      const saved = getJson<Run>(this.storage.sql, 'wc_runs', run.id)!;
      if (saved.progress !== undefined) run.progress = saved.progress;
      if (saved.cancelRequested) run.cancelRequested = true;
      run.updatedAt = Date.now(); saveRun(this.storage.sql, run); db.changed.add('$runs');
      // Retain the latest 1000 terminal runs and their traces; active runs are never pruned.
      this.storage.sql.exec("DELETE FROM wc_runs WHERE status NOT IN ('queued', 'running') AND rowid NOT IN (SELECT rowid FROM wc_runs WHERE status NOT IN ('queued', 'running') ORDER BY rowid DESC LIMIT 1000)");
      this.storage.sql.exec('DELETE FROM wc_steps WHERE run_id NOT IN (SELECT id FROM wc_runs)');
    });
    return true;
  }
}
