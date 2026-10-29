import { and, desc, eq } from 'drizzle-orm';
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { z } from 'zod';
import {
  compileWireDisplayDocument, displayDocumentSchema, WorkcoreError,
} from '@workcore/core';
import type {
  Definition, DisplayDefinition, Json, ManifestDocument, Mutation, Operation, ReadContext, View,
} from '@workcore/core';

/** Optional application-owned SQL storage for protocol documents; it stores no executable code. */
export const savedDisplayTable = sqliteTable('saved_displays', {
  id: text('id').primaryKey(),
  ownerId: text('owner_id').notNull(),
  title: text('title').notNull(),
  /** Retained for existing SQLite workspaces that used the earlier example table. */
  projectId: text('project_id').notNull().default(''),
  document: text('document').notNull(),
  protocolVersion: integer('protocol_version').notNull(),
  status: text('status', { enum: ['draft', 'published'] }).notNull(),
  group: text('group_name'),
  order: integer('display_order'),
  version: integer('version').notNull(),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
}, table => [index('saved_displays_owner_updated').on(table.ownerId, table.updatedAt), index('saved_displays_status_updated').on(table.status, table.updatedAt)]);

type SavedRow = typeof savedDisplayTable.$inferSelect;
type SavedContext = ReadContext<any> & { trigger?: (...keys: string[]) => void };
type Target = Operation<any, any>;
type References = {
  views: Record<string, Target>;
  queries: Record<string, Target>;
  mutations: Record<string, Target>;
  jobs: Record<string, Target>;
  displays: NonNullable<Definition['displays']>['displays'];
  components?: NonNullable<Definition['displays']>['components'];
};
type Policy = {
  /** Required allowlists. An omitted list denies that capability. */
  allowedViews?: readonly string[];
  allowedQueries?: readonly string[];
  allowedMutations?: readonly string[];
  allowedJobs?: readonly string[];
  allowedDisplays?: readonly string[];
  allowedComponents?: readonly string[];
  canRead?: (context: ReadContext<any>, actorId: string, document: SavedRow) => boolean;
  canReadPublished?: (context: ReadContext<any>, actorId: string, document: SavedRow) => boolean;
  canEdit?: (context: ReadContext<any>, actorId: string, document: SavedRow | null) => boolean;
  canPublish?: (context: ReadContext<any>, actorId: string, document: SavedRow) => boolean;
  canDelete?: (context: ReadContext<any>, actorId: string, document: SavedRow) => boolean;
  maxBytes?: number;
  trigger?: string;
};

const documentInput = z.json();
const idInput = z.object({ id: z.string().uuid() });
const savedDisplayInput = z.object({ savedDisplayId: z.string().uuid() });
const versionedInput = idInput.extend({ expectedVersion: z.number().int().positive() });
const summary = z.object({ id: z.string(), ownerId: z.string(), title: z.string(), protocolVersion: z.number(), status: z.enum(['draft', 'published']), group: z.string().nullable(), order: z.number().nullable(), version: z.number(), createdAt: z.number(), updatedAt: z.number() });
const readSummary = (row: SavedRow) => ({ ...row, group: row.group ?? null, order: row.order ?? null });

function failNotFound(): never { throw new WorkcoreError('NOT_FOUND', 'Saved display not found', 404); }
function operation(map: Record<string, Target>, name: string, kind: string): Target {
  const found = map[name];
  if (!found) throw new WorkcoreError('INVALID_DISPLAY', `Unknown ${kind} reference: ${name}`, 400);
  return found;
}

/**
 * Optional checked storage capability. Applications register its table in their Drizzle schema,
 * its operations in normal workspace maps, and its resolver as an ordinary dynamic display.
 */
export function createSavedDisplayCapability(policy: Policy = {}) {
  const maxBytes = policy.maxBytes ?? 128 * 1024;
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1024 || maxBytes > 512 * 1024) throw new Error('Saved display maxBytes must be 1KB–512KB');
  const canEdit = policy.canEdit ?? ((_context: ReadContext<any>, actorId: string, row: SavedRow | null) => row === null || row.ownerId === actorId);
  const canRead = policy.canRead ?? ((_context: ReadContext<any>, actorId: string, row: SavedRow) => row.ownerId === actorId);
  const canReadPublished = policy.canReadPublished ?? (() => false);
  const canPublish = policy.canPublish ?? (() => false);
  const canDelete = policy.canDelete ?? ((_context: ReadContext<any>, actorId: string, row: SavedRow) => row.ownerId === actorId);
  let references: References | undefined;

  function checkPolicyDocument(context: ReadContext<any>, actorId: string, document: ManifestDocument): void {
    const refs = references;
    if (!refs) throw new Error('Call configure() before using saved-display operations');
    const checkAction = (action: NonNullable<Extract<ManifestDocument['blocks'][number], { kind: 'button' }>['action']>) => {
      const map = action.operation.kind === 'mutation' ? refs.mutations : refs.jobs;
      const allowed = action.operation.kind === 'mutation' ? policy.allowedMutations : policy.allowedJobs;
      if (!allowed?.includes(action.operation.name)) throw new WorkcoreError('INVALID_DISPLAY', `Action is not allowed: ${action.operation.kind}:${action.operation.name}`, 400);
      operation(map, action.operation.name, action.operation.kind);
      if (action.navigate && (!policy.allowedDisplays?.includes(action.navigate.display) || !refs.displays[action.navigate.display])) {
        throw new WorkcoreError('INVALID_DISPLAY', `Navigation target is not allowed: ${action.navigate.display}`, 400);
      }
      for (const effect of action.effects ?? []) if (effect.type === 'navigate' && (!policy.allowedDisplays?.includes(effect.display) || !refs.displays[effect.display])) {
        throw new WorkcoreError('INVALID_DISPLAY', `Navigation target is not allowed: ${effect.display}`, 400);
      }
    };
    const visit = (block: ManifestDocument['blocks'][number]): void => {
      if ('source' in block) {
        const allowed = block.source.kind === 'view' ? policy.allowedViews : policy.allowedQueries;
        const map = block.source.kind === 'view' ? refs.views : refs.queries;
        if (!allowed?.includes(block.source.name)) throw new WorkcoreError('INVALID_DISPLAY', `Data source is not allowed: ${block.source.kind}:${block.source.name}`, 400);
        operation(map, block.source.name, block.source.kind);
      }
      if (block.kind === 'form' || block.kind === 'button') checkAction(block.action as never);
      if (block.kind === 'collection') for (const action of block.actions ?? []) checkAction(action as never);
      if (block.kind === 'chat' && block.send) checkAction(block.send as never);
      if (block.kind === 'display' && (!policy.allowedDisplays?.includes(block.display) || !refs.displays[block.display])) throw new WorkcoreError('INVALID_DISPLAY', `Nested display is not allowed: ${block.display}`, 400);
      if (block.kind === 'custom' && (!policy.allowedComponents?.includes(block.component) || !refs.components?.[block.component])) throw new WorkcoreError('INVALID_DISPLAY', `Custom component is not allowed: ${block.component}`, 400);
      if (block.kind === 'system') throw new WorkcoreError('INVALID_DISPLAY', 'System blocks are not permitted in saved displays', 400);
      if ('children' in block && block.children) block.children.forEach(visit);
      if (block.kind === 'columns') block.columns.forEach(column => column.children.forEach(visit));
    };
    document.blocks.forEach(visit);
    const definition = {
      tables: {}, migrations: { journal: { entries: [] }, migrations: {} }, tableDisplay: {}, triggerKeys: [],
      views: refs.views, queries: refs.queries, mutations: refs.mutations, jobs: refs.jobs,
      authorize: () => true,
      displays: { title: 'Saved displays', displays: refs.displays, components: refs.components ?? {} },
    } as unknown as Definition;
    try { compileWireDisplayDocument(definition, 'savedDocumentValidation', document, () => true); }
    catch (error) { throw new WorkcoreError('INVALID_DISPLAY', error instanceof Error ? error.message : 'Saved display is invalid', 400); }
    const bytes = new TextEncoder().encode(JSON.stringify(document)).byteLength;
    if (bytes > maxBytes) throw new WorkcoreError('DISPLAY_TOO_LARGE', `Saved display exceeds ${maxBytes} bytes`, 413);
    void context; void actorId;
  }

  const list: View = {
    input: z.object({}), output: z.array(summary), dependsOn: [policy.trigger ?? 'savedDisplays'], maxRows: 200,
    ui: { label: 'Saved pages', presentation: 'table' },
    handler: (context: ReadContext<any>) => {
      const rows = context.db.select().from(savedDisplayTable).orderBy(desc(savedDisplayTable.updatedAt)).limit(501).all();
      if (rows.length > 500) throw new WorkcoreError('SAVED_DISPLAY_LIMIT', 'Saved-display catalogue is too large to list; use a narrower application view');
      return rows.filter(row => (row.ownerId === context.actor.id && canRead(context, context.actor.id, row)) || (row.status === 'published' && canReadPublished(context, context.actor.id, row))).slice(0, 200).map(readSummary);
    },
  };

  const createDraft: Mutation = {
    input: z.object({ title: z.string().trim().min(1).max(120), document: documentInput, group: z.string().trim().min(1).max(64).optional(), order: z.number().int().min(-10000).max(10000).optional() }),
    output: summary, triggers: [policy.trigger ?? 'savedDisplays'],
    ui: { label: 'Create saved display draft' },
    handler: (context: any, raw: { title: string; document: Json; group?: string; order?: number }) => {
      if (!canEdit(context, context.actor.id, null)) throw new WorkcoreError('FORBIDDEN', 'You cannot create saved displays', 403);
      const document = displayDocumentSchema.parse(raw.document) as ManifestDocument;
      checkPolicyDocument(context, context.actor.id, document);
      const id = crypto.randomUUID();
      context.db.insert(savedDisplayTable).values({ id, ownerId: context.actor.id, title: raw.title, projectId: '', document: JSON.stringify(document), protocolVersion: 3, status: 'draft', group: raw.group ?? null, order: raw.order ?? null, version: 1, createdAt: context.now, updatedAt: context.now }).run();
      return readSummary(context.db.select().from(savedDisplayTable).where(eq(savedDisplayTable.id, id)).get()!);
    },
  };

  const updateDraft: Mutation = {
    input: versionedInput.extend({ title: z.string().trim().min(1).max(120).optional(), document: documentInput.optional(), group: z.string().trim().min(1).max(64).nullable().optional(), order: z.number().int().min(-10000).max(10000).nullable().optional() }),
    output: summary, triggers: [policy.trigger ?? 'savedDisplays'], ui: { label: 'Update saved display draft' },
    handler: (context: any, input: any) => {
      const row = context.db.select().from(savedDisplayTable).where(eq(savedDisplayTable.id, input.id)).get() as SavedRow | undefined;
      if (!row || !canEdit(context, context.actor.id, row) || row.ownerId !== context.actor.id || row.status !== 'draft') failNotFound();
      if (row.version !== input.expectedVersion) throw new WorkcoreError('CONFLICT', 'Saved display changed; reload the current draft', 409);
      const document = input.document === undefined ? JSON.parse(row.document) as ManifestDocument : displayDocumentSchema.parse(input.document) as ManifestDocument;
      checkPolicyDocument(context, context.actor.id, document);
      const updated = context.db.update(savedDisplayTable).set({
        ...(input.title === undefined ? {} : { title: input.title }), document: JSON.stringify(document),
        ...(input.group === undefined ? {} : { group: input.group }), ...(input.order === undefined ? {} : { order: input.order }),
        version: row.version + 1, updatedAt: context.now,
      }).where(and(eq(savedDisplayTable.id, row.id), eq(savedDisplayTable.ownerId, context.actor.id), eq(savedDisplayTable.status, 'draft'), eq(savedDisplayTable.version, input.expectedVersion))).returning().get();
      if (!updated) throw new WorkcoreError('CONFLICT', 'Saved display changed; reload the current draft', 409);
      return readSummary(updated);
    },
  };

  const publish: Mutation = {
    input: versionedInput, output: summary, triggers: [policy.trigger ?? 'savedDisplays'], ui: { label: 'Publish saved display' },
    handler: (context: any, input: z.infer<typeof versionedInput>) => {
      const row = context.db.select().from(savedDisplayTable).where(eq(savedDisplayTable.id, input.id)).get() as SavedRow | undefined;
      if (!row || row.version !== input.expectedVersion) throw new WorkcoreError('CONFLICT', 'Saved display changed; reload the current draft', 409);
      if (row.ownerId !== context.actor.id || row.status !== 'draft' || !canPublish(context, context.actor.id, row)) throw new WorkcoreError('FORBIDDEN', 'Publishing is not permitted', 403);
      const document = displayDocumentSchema.parse(JSON.parse(row.document)) as ManifestDocument;
      checkPolicyDocument(context, context.actor.id, document);
      const updated = context.db.update(savedDisplayTable).set({ status: 'published', version: row.version + 1, updatedAt: context.now }).where(and(eq(savedDisplayTable.id, row.id), eq(savedDisplayTable.status, 'draft'), eq(savedDisplayTable.version, input.expectedVersion))).returning().get();
      if (!updated) throw new WorkcoreError('CONFLICT', 'Saved display changed; retry after reloading', 409);
      return readSummary(updated);
    },
  };

  const unpublish: Mutation = {
    input: versionedInput, output: summary, triggers: [policy.trigger ?? 'savedDisplays'], ui: { label: 'Unpublish saved display' },
    handler: (context: any, input: z.infer<typeof versionedInput>) => {
      const row = context.db.select().from(savedDisplayTable).where(eq(savedDisplayTable.id, input.id)).get() as SavedRow | undefined;
      if (!row || row.ownerId !== context.actor.id || row.status !== 'published' || row.version !== input.expectedVersion || !canPublish(context, context.actor.id, row)) throw new WorkcoreError('FORBIDDEN', 'Unpublishing is not permitted', 403);
      const updated = context.db.update(savedDisplayTable).set({ status: 'draft', version: row.version + 1, updatedAt: context.now }).where(and(eq(savedDisplayTable.id, row.id), eq(savedDisplayTable.status, 'published'), eq(savedDisplayTable.version, input.expectedVersion))).returning().get();
      if (!updated) throw new WorkcoreError('CONFLICT', 'Saved display changed; retry after reloading', 409);
      return readSummary(updated);
    },
  };

  const remove: Mutation = {
    input: versionedInput, output: z.object({ id: z.string(), revision: z.number() }), triggers: [policy.trigger ?? 'savedDisplays'], ui: { label: 'Delete saved display' },
    handler: (context: any, input: z.infer<typeof versionedInput>) => {
      const row = context.db.select().from(savedDisplayTable).where(eq(savedDisplayTable.id, input.id)).get() as SavedRow | undefined;
      if (!row || row.ownerId !== context.actor.id || !canDelete(context, context.actor.id, row)) failNotFound();
      const deleted = context.db.delete(savedDisplayTable).where(and(eq(savedDisplayTable.id, row.id), eq(savedDisplayTable.ownerId, context.actor.id), eq(savedDisplayTable.version, input.expectedVersion))).returning({ id: savedDisplayTable.id }).get();
      if (!deleted) throw new WorkcoreError('CONFLICT', 'Saved display changed; reload before deleting', 409);
      return { id: deleted.id, revision: row.version };
    },
  };

  const display: DisplayDefinition<typeof savedDisplayInput, ReadContext<any>> = {
    input: savedDisplayInput,
    metadata: { title: 'Saved display', route: { path: '/saved/:savedDisplayId', listed: false } },
    wireHandler: (context: ReadContext<any>, input: { savedDisplayId: string }) => {
      const row = context.db.select().from(savedDisplayTable).where(eq(savedDisplayTable.id, input.savedDisplayId)).get() as SavedRow | undefined;
      if (!row || !(row.ownerId === context.actor.id && canRead(context, context.actor.id, row)) && !(row.status === 'published' && canReadPublished(context, context.actor.id, row))) failNotFound();
      const document = displayDocumentSchema.parse(JSON.parse(row.document)) as ManifestDocument;
      checkPolicyDocument(context, context.actor.id, document);
      return document;
    },
  };

  function configure(next: References): void { references = next; }
  return { table: savedDisplayTable, list, mutations: { createDraft, updateDraft, publish, unpublish, delete: remove }, display, configure };
}

export type SavedDisplayOperations = ReturnType<typeof createSavedDisplayCapability>;
