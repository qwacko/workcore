import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/** Internal schema is exported so application Drizzle Kit config snapshots it too. */
export const workcoreMeta = sqliteTable('wc_meta', {
  key: text('key').primaryKey(), value: text('value').notNull(),
});
export const workcoreKv = sqliteTable('wc_kv', {
  key: text('key').primaryKey(), value: text('value').notNull(),
});
export const workcoreRuns = sqliteTable('wc_runs', {
  id: text('id').primaryKey(), status: text('status').notNull(), due: integer('due').notNull(), data: text('data').notNull(),
}, table => [index('wc_runs_due').on(table.status, table.due)]);
export const workcoreSchedules = sqliteTable('wc_schedules', {
  id: text('id').primaryKey(), enabled: integer('enabled').notNull(), at: integer('at').notNull(), data: text('data').notNull(),
}, table => [index('wc_schedules_due').on(table.enabled, table.at)]);
export const workcoreSteps = sqliteTable('wc_steps', {
  runId: text('run_id').notNull(), sequence: integer('sequence').notNull(), data: text('data').notNull(),
}, table => [primaryKey({ columns: [table.runId, table.sequence] })]);
export const workcoreHistory = sqliteTable('wc_history', {
  id: text('id').primaryKey(), data: text('data').notNull(),
});
export const workcoreRequests = sqliteTable('wc_requests', {
  id: text('id').primaryKey(), fingerprint: text('fingerprint').notNull(), response: text('response').notNull(),
});
export const workcoreSchema = {
  workcoreMeta, workcoreKv, workcoreRuns, workcoreSchedules, workcoreSteps, workcoreHistory, workcoreRequests,
};

export type WorkcoreSchema = typeof workcoreSchema;
