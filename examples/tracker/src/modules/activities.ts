import { defineModule } from '@workcore/core';
import { cursorTableZodQuery } from '@workcore/schema-zod';
import { z } from 'zod';
import type { Activity, TrackerContext } from '../tracker-types.js';

type ActivitiesContext = Pick<TrackerContext, 'activities'>;
export type ActivitiesDependencies = { afterUpdated?: (activity: Activity) => Promise<void> };
const dateSchema = z.date().meta({ type: 'string', format: 'date-time', 'x-workcore-runtimeType': 'date' });
const activityRow = z.object({ id: z.string(), title: z.string(), status: z.enum(['planned', 'complete']), updatedAt: dateSchema });
const activityFilters = z.object({ status: z.enum(['planned', 'complete']).optional(), search: z.string().max(120).optional() });
const emptyInput = z.object({});
const summarySchema = z.object({ total: z.number(), complete: z.number(), planned: z.number() });

export const activitiesModule = defineModule<ActivitiesContext, ActivitiesDependencies>()({
  id: 'activities',
  queries: {
    list: {
      ...cursorTableZodQuery<ActivitiesContext, typeof activityFilters.shape, typeof activityRow>({
        input: activityFilters, row: activityRow, defaultLimit: 25, maxLimit: 100,
        permission: 'activities.read', api: true,
        handler: ({ ctx, input }) => ctx.app.activities.list(ctx.scope, input),
      }),
      views: {
        default: 'manage',
        variants: {
          basic: { title: 'Activities', renderer: 'table', rowKey: 'id', columns: ['title', 'status', 'updatedAt'], collection: { itemKey: 'id', titleField: 'title', subtitleField: 'status', columns: [{ field: 'title', editable: true, filter: { type: 'text', targetParam: 'search' } }, { field: 'status', display: 'badge', editable: true }, { field: 'updatedAt', display: 'datetime', editable: false }], actions: [{ label: 'Edit activity', mutation: 'edit', variant: 'basic', bind: { id: { fromRow: 'id' } } }], editor: { mutation: 'edit', variant: 'basic', identity: { rowField: 'id', targetInput: 'id' } } } },
          compact: { title: 'Recent activities', subtitle: 'Latest workspace activity', renderer: 'table', rowKey: 'id', columns: ['title', 'status'] },
          manage: { title: 'Manage activities', renderer: 'table', rowKey: 'id', columns: ['title', 'status', 'updatedAt'], collection: { itemKey: 'id', titleField: 'title', subtitleField: 'status', columns: [{ field: 'title', editable: true, filter: { type: 'text', targetParam: 'search' } }, { field: 'status', editable: true, filter: { type: 'select' } }, { field: 'updatedAt', display: 'datetime', editable: false }], actions: [{ label: 'Edit activity', mutation: 'edit', variant: 'basic', bind: { id: { fromRow: 'id' } } }], editor: { mutation: 'edit', variant: 'basic' } } },
          dataOnly: { title: 'Activity data', renderer: 'json' },
        },
      },
    },
    summary: {
      input: emptyInput, output: summarySchema, permission: 'activities.read',
      handler: async ({ operations }) => {
        const activities: Activity[] = [];
        let cursor: string | undefined;
        do {
          const page = await operations.query('list', { limit: 100, ...(cursor ? { cursor } : {}) });
          activities.push(...page.rows);
          cursor = page.nextCursor ?? undefined;
        } while (cursor);
        const complete = activities.filter((activity) => activity.status === 'complete').length;
        return { total: activities.length, complete, planned: activities.length - complete };
      },
    },
    dateRoundTrip: {
      input: z.object({ at: dateSchema.meta({ default: '2026-10-12T10:00:00.000Z' }) }), output: dateSchema,
      permission: 'activities.read', api: true,
      views: { default: 'basic', variants: { basic: { title: 'Date round trip', renderer: 'json' } } },
      handler: ({ input }) => input.at,
    },
    dateTimeText: {
      input: z.object({ at: z.iso.datetime().meta({ default: '2026-10-12T10:00:00.000Z' }) }), output: z.string(),
      permission: 'activities.read', api: true,
      views: { default: 'basic', variants: { basic: { title: 'Date-time text', renderer: 'json' } } },
      handler: ({ input }) => input.at,
    },
    richValues: {
      input: emptyInput,
      output: z.custom<Record<string, unknown>>((value): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)).meta({ type: 'object' }),
      permission: 'activities.read', api: true,
      views: { default: 'basic', variants: { basic: { title: 'Rich value viewer', renderer: 'json' } } },
      handler: () => {
        const value: Record<string, unknown> = { big: 42n, map: new Map([['key', 'value']]), set: new Set(['member']) };
        value.self = value;
        return value;
      },
    },
  },
  mutations: {
    edit: {
      input: z.object({ id: z.string().min(1), title: z.string().min(1).max(120), status: z.enum(['planned', 'complete']) }), output: activityRow,
      permission: 'activities.write', api: true,
      views: { default: 'basic', variants: { basic: { title: 'Edit activity', renderer: 'form' } } },
      handler: async ({ ctx, input, dependencies }) => {
        const activity = await ctx.app.activities.update(ctx.scope, input);
        // Optional, awaited application wiring. Failure cannot roll back this repository write.
        await dependencies.afterUpdated?.(activity);
        return activity;
      },
    },
  },
  tasks: {
    refreshSummary: {
      input: emptyInput, output: summarySchema, permission: 'summary.refresh', api: true,
      triggers: { mutations: ['edit'] },
      views: { default: 'basic', variants: { basic: { title: 'Refresh summary', renderer: 'form' } } },
      handler: async ({ ctx, operations }) => {
        await ctx.services.tasks.reportProgress(0);
        const summary = await operations.query('summary', {});
        await ctx.services.kv.set('activity-summary', summary);
        await ctx.services.tasks.reportProgress(100);
        return summary;
      },
    },
  },
  admin: ({ ui, queries }) => ({ pages: {
    search: ui.page({
      title: 'Activity search', description: 'Module-owned search and status controls bind to the local activities query.', layout: 'stacked',
      state: {
        searchText: { type: 'text', label: 'Search activities', default: '' },
        status: { type: 'select', label: 'Activity status', default: '', options: [{ value: '', label: 'All statuses' }, { value: 'planned', label: 'Planned' }, { value: 'complete', label: 'Complete' }] },
      },
      blocks: [queries.list.view('basic', { id: 'search-results', input: { limit: 25 }, inputBindings: { search: { state: 'searchText' }, status: { state: 'status' } } })],
    }),
  } }),
});
