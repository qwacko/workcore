import { defineWorkspace, tableQuery, mutation, task, type JsonSchemaProvider, type ValidationSchema } from '@workcore/core';
import { z } from 'zod';

export type Activity = { id: string; title: string; status: 'planned' | 'complete'; updatedAt: Date };
export type ActivityStore = {
  list(scope: { applicationId: string; workspaceId: string }, input: { limit: number; cursor?: string | undefined; status?: Activity['status'] | undefined; search?: string | undefined }): Promise<{ rows: Activity[]; nextCursor: string | null; totalCount: number }>;
  update(scope: { applicationId: string; workspaceId: string }, input: { id: string; title: string; status: 'planned' | 'complete' }): Promise<Activity>;
};
export type TrackerContext = { activities: ActivityStore };

const activityRow = z.object({ id: z.string(), title: z.string(), status: z.enum(['planned', 'complete']), updatedAt: z.date() });
const activityPage = withStandardJsonSchema(z.object({
  rows: z.array(activityRow),
  nextCursor: z.string().nullable(),
  totalCount: z.number(),
}), {
  type: 'object', properties: {
    rows: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, title: { type: 'string' }, status: { type: 'string', enum: ['planned', 'complete'] }, updatedAt: { type: 'string', format: 'date-time', 'x-workcore-runtimeType': 'date' } }, required: ['id', 'title', 'status', 'updatedAt'] } },
    nextCursor: { anyOf: [{ type: 'string' }, { type: 'null' }] }, totalCount: { type: 'number' },
  }, required: ['rows', 'nextCursor', 'totalCount'],
});
const activitySchema = withStandardJsonSchema(activityRow, { type: 'object', properties: { id: { type: 'string' }, title: { type: 'string' }, status: { type: 'string', enum: ['planned', 'complete'] }, updatedAt: { type: 'string', format: 'date-time', 'x-workcore-runtimeType': 'date' } }, required: ['id', 'title', 'status', 'updatedAt'] });
const dateEchoInput = withStandardJsonSchema(z.object({ at: z.date() }), { type: 'object', properties: { at: { type: 'string', format: 'date-time', default: '2026-10-12T10:00:00.000Z', 'x-workcore-runtimeType': 'date' } }, required: ['at'] });
const dateTimeTextInput = withStandardJsonSchema(z.object({ at: z.iso.datetime() }), { type: 'object', properties: { at: { type: 'string', format: 'date-time', default: '2026-10-12T10:00:00.000Z' } }, required: ['at'] });
const dateOutput = withStandardJsonSchema(z.date(), { type: 'string', format: 'date-time', 'x-workcore-runtimeType': 'date' });
const richValueOutput = withStandardJsonSchema(z.custom<Record<string, unknown>>((value): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)), { type: 'object' });
const listInput = z.object({
  limit: z.number().int().min(1).max(100).default(25),
  cursor: z.string().optional(),
  status: z.enum(['planned', 'complete']).optional(),
  search: z.string().max(120).optional(),
});
const editInput = z.object({ id: z.string().min(1), title: z.string().min(1).max(120), status: z.enum(['planned', 'complete']) });
const emptyInput = z.object({});
const summarySchema = z.object({ total: z.number(), complete: z.number(), planned: z.number() });

const defineTracker = defineWorkspace<TrackerContext>();

export const trackerBase = defineTracker({
  id: 'tracker',
  queries: {
    activities: defineTracker.tableQuery({
      input: listInput,
      output: activityPage,
      permission: 'activities.read',
      api: true,
      ui: {
        default: 'basic',
        variants: {
          basic: { title: 'Activities', renderer: 'table', rowKey: 'id', columns: ['title', 'status', 'updatedAt'], actions: [{ label: 'Edit activity', mutation: 'editActivity', variant: 'basic', bind: { id: { fromRow: 'id' } } }] },
          compact: { title: 'Recent activities', subtitle: 'Latest workspace activity', renderer: 'table', rowKey: 'id', columns: ['title', 'status'] },
          dataOnly: { title: 'Activity data', renderer: 'json' },
        },
      },
      handler: ({ ctx, input }) => ctx.app.activities.list(ctx.scope, input),
    }),
    dateRoundTrip: defineTracker.query({
      input: dateEchoInput,
      output: dateOutput,
      permission: 'activities.read',
      api: true,
      ui: { default: 'basic', variants: { basic: { title: 'Date round trip', renderer: 'json' } } },
      handler: ({ input }) => input.at,
    }),
    dateTimeText: defineTracker.query({
      input: dateTimeTextInput,
      output: z.string(),
      permission: 'activities.read',
      api: true,
      ui: { default: 'basic', variants: { basic: { title: 'Date-time text', renderer: 'json' } } },
      handler: ({ input }) => input.at,
    }),
    richValues: defineTracker.query({
      input: emptyInput,
      output: richValueOutput,
      permission: 'activities.read',
      api: true,
      ui: { default: 'basic', variants: { basic: { title: 'Rich value viewer', renderer: 'json' } } },
      handler: () => {
        const value: Record<string, unknown> = { big: 42n, map: new Map([['key', 'value']]), set: new Set(['member']) };
        value.self = value;
        return value;
      },
    }),
  },
  mutations: {
    editActivity: defineTracker.mutation({
      input: editInput,
      output: activitySchema,
      permission: 'activities.write',
      api: true,
      ui: { default: 'basic', variants: { basic: { title: 'Edit activity', renderer: 'form' } } },
      handler: ({ ctx, input }) => ctx.app.activities.update(ctx.scope, input),
    }),
  },
});

function withStandardJsonSchema<S extends z.ZodType>(
  schema: S,
  jsonSchema: Record<string, unknown>,
): ValidationSchema<z.input<S>, z.output<S>> & JsonSchemaProvider<z.input<S>, z.output<S>> {
  const standard = schema['~standard'];
  return {
    '~standard': {
      version: 1 as const,
      vendor: standard.vendor,
      types: undefined as unknown as { input: z.input<S>; output: z.output<S> },
      validate: (value: unknown, options?: { readonly libraryOptions?: Record<string, unknown> }) => standard.validate(value, options),
      jsonSchema: { input: () => jsonSchema, output: () => jsonSchema },
    },
  } as ValidationSchema<z.input<S>, z.output<S>> & JsonSchemaProvider<z.input<S>, z.output<S>>;
}

const defineTrackerOperations = defineTracker.withOperations<typeof trackerBase>();

export const tracker = defineTracker({
  ...trackerBase,
  tasks: {
    refreshSummary: defineTrackerOperations.task({
      input: emptyInput,
      output: summarySchema,
      permission: 'summary.refresh',
      api: true,
      triggers: { mutations: ['editActivity'] },
      ui: { default: 'basic', variants: { basic: { title: 'Refresh summary', renderer: 'form' } } },
      handler: async ({ ctx, operations }) => {
        await ctx.services.tasks.reportProgress(0);
        const activities: Activity[] = [];
        let cursor: string | undefined;
        do {
          const page = await operations.query('activities', { limit: 100, ...(cursor ? { cursor } : {}) });
          activities.push(...page.rows);
          cursor = page.nextCursor ?? undefined;
          await ctx.services.tasks.reportProgress(cursor ? 50 : 90);
        } while (cursor);
        const summary = { total: activities.length, complete: activities.filter((activity) => activity.status === 'complete').length, planned: activities.filter((activity) => activity.status === 'planned').length };
        await ctx.services.kv.set('activity-summary', summary);
        await ctx.services.tasks.reportProgress(100);
        return summary;
      },
    }),
  },
});
