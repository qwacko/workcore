import { defineWorkspace } from '@workcore/core';
import { z } from 'zod';
import { roleCanUseWorkcoreCapability } from './demo-workspaces.js';

export type Activity = { id: string; title: string; status: 'planned' | 'complete'; updatedAt: Date };
export type ActivityStore = {
  list(scope: { applicationId: string; workspaceId: string }, input: { limit: number; cursor?: string | undefined; status?: Activity['status'] | undefined; search?: string | undefined }): Promise<{ rows: Activity[]; nextCursor: string | null; totalCount: number }>;
  update(scope: { applicationId: string; workspaceId: string }, input: { id: string; title: string; status: 'planned' | 'complete' }): Promise<Activity>;
};
export type TrackerContext = { activities: ActivityStore };
const trackerAuthorizationContext = z.object({ userId: z.string(), role: z.enum(['owner', 'viewer']), isAdmin: z.boolean() });
export type TrackerAuthorization = z.output<typeof trackerAuthorizationContext>;
const dateSchema = z.date().meta({ type: 'string', format: 'date-time', 'x-workcore-runtimeType': 'date' });
const activityRow = z.object({ id: z.string(), title: z.string(), status: z.enum(['planned', 'complete']), updatedAt: dateSchema });
const activityPage = z.object({
  rows: z.array(activityRow),
  nextCursor: z.string().nullable(),
  totalCount: z.number(),
});
const activitySchema = activityRow;
const dateEchoInput = z.object({ at: dateSchema.meta({ default: '2026-10-12T10:00:00.000Z' }) });
const dateTimeTextInput = z.object({ at: z.iso.datetime().meta({ default: '2026-10-12T10:00:00.000Z' }) });
const dateOutput = dateSchema;
const richValueOutput = z.custom<Record<string, unknown>>((value): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)).meta({ type: 'object' });
const listInput = z.object({
  limit: z.number().int().min(1).max(100).default(25),
  cursor: z.string().optional(),
  status: z.enum(['planned', 'complete']).optional(),
  search: z.string().max(120).optional(),
});
const editInput = z.object({ id: z.string().min(1), title: z.string().min(1).max(120), status: z.enum(['planned', 'complete']) });
const emptyInput = z.object({});
const summarySchema = z.object({ total: z.number(), complete: z.number(), planned: z.number() });

export const tracker = defineWorkspace<TrackerContext>()({
  id: 'tracker',
  authorization: {
    context: trackerAuthorizationContext,
    check: ({ auth, permission }) => auth.isAdmin || auth.role === 'owner' || permission === 'activities.read' || permission === 'notes.read' || (permission.startsWith('workcore.') && roleCanUseWorkcoreCapability(auth.role, permission)),
  },
  queries: {
    activities: {
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
    },
    dateRoundTrip: {
      input: dateEchoInput,
      output: dateOutput,
      permission: 'activities.read',
      api: true,
      ui: { default: 'basic', variants: { basic: { title: 'Date round trip', renderer: 'json' } } },
      handler: ({ input }) => input.at,
    },
    dateTimeText: {
      input: dateTimeTextInput,
      output: z.string(),
      permission: 'activities.read',
      api: true,
      ui: { default: 'basic', variants: { basic: { title: 'Date-time text', renderer: 'json' } } },
      handler: ({ input }) => input.at,
    },
    richValues: {
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
    },
  },
  mutations: {
    editActivity: {
      input: editInput,
      output: activitySchema,
      permission: 'activities.write',
      api: true,
      ui: { default: 'basic', variants: { basic: { title: 'Edit activity', renderer: 'form' } } },
      handler: ({ ctx, input }) => ctx.app.activities.update(ctx.scope, input),
    }
  },
  tasks: {
    refreshSummary: {
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
    },
  },
});
