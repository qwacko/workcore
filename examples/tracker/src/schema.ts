import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { defineSchema, idColumn, timestampColumns, versionColumn } from '@workcore/core';
import { fileTable } from '@workcore/files';
export { fileTable };
export { workcoreHistory, workcoreKv, workcoreMeta, workcoreRequests, workcoreRuns, workcoreSchedules, workcoreSteps } from '@workcore/core/schema';

export const members = sqliteTable('members', {
  ...idColumn(), name: text('name').notNull(), role: text('role', { enum: ['member', 'admin'] }).notNull(),
});
export const tasks = sqliteTable('tasks', {
  ...idColumn(), ...versionColumn(), ...timestampColumns(),
  title: text('title').notNull(), projectId: text('project_id').notNull(), ownerId: text('owner_id').notNull(),
  private: integer('private', { mode: 'boolean' }).notNull().default(false), done: integer('done', { mode: 'boolean' }).notNull().default(false),
}, table => [index('tasks_project').on(table.projectId, table.id), index('tasks_owner').on(table.ownerId, table.id)]);
export const messages = sqliteTable('messages', {
  ...idColumn(), ownerId: text('owner_id').notNull(), role: text('role', { enum: ['user', 'assistant'] }).notNull(),
  content: text('content').notNull(), at: integer('at').notNull(),
}, table => [index('messages_owner_at').on(table.ownerId, table.at, table.id)]);

export const schema = defineSchema({ members, tasks, messages, files: fileTable });
