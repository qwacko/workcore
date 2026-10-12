import { foreignKey, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

// Better Auth core tables, plus its username plugin and the demo's admin flag.
export const user = sqliteTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: integer('emailVerified', { mode: 'boolean' }).notNull().default(false),
  image: text('image'),
  username: text('username').unique(),
  displayUsername: text('displayUsername'),
  role: text('role').notNull().default('user'),
  banned: integer('banned', { mode: 'boolean' }).notNull().default(false),
  banReason: text('banReason'),
  banExpires: integer('banExpires', { mode: 'timestamp' }),
  createdAt: integer('createdAt', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updatedAt', { mode: 'timestamp' }).notNull(),
});

export const session = sqliteTable('session', {
  id: text('id').primaryKey(),
  expiresAt: integer('expiresAt', { mode: 'timestamp' }).notNull(),
  token: text('token').notNull().unique(),
  createdAt: integer('createdAt', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updatedAt', { mode: 'timestamp' }).notNull(),
  ipAddress: text('ipAddress'),
  userAgent: text('userAgent'),
  impersonatedBy: text('impersonatedBy'),
  userId: text('userId').notNull().references(() => user.id, { onDelete: 'cascade' }),
});

export const account = sqliteTable('account', {
  id: text('id').primaryKey(),
  accountId: text('accountId').notNull(),
  providerId: text('providerId').notNull(),
  userId: text('userId').notNull().references(() => user.id, { onDelete: 'cascade' }),
  accessToken: text('accessToken'),
  refreshToken: text('refreshToken'),
  idToken: text('idToken'),
  accessTokenExpiresAt: integer('accessTokenExpiresAt', { mode: 'timestamp' }),
  refreshTokenExpiresAt: integer('refreshTokenExpiresAt', { mode: 'timestamp' }),
  scope: text('scope'),
  password: text('password'),
  createdAt: integer('createdAt', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updatedAt', { mode: 'timestamp' }).notNull(),
});

export const verification = sqliteTable('verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: integer('expiresAt', { mode: 'timestamp' }).notNull(),
  createdAt: integer('createdAt', { mode: 'timestamp' }),
  updatedAt: integer('updatedAt', { mode: 'timestamp' }),
});

export const workspaces = sqliteTable('workcore_workspaces', {
  applicationId: text('application_id').notNull(),
  id: text('id').notNull(),
  name: text('name').notNull(),
}, (table) => [primaryKey({ columns: [table.applicationId, table.id], name: 'workcore_workspaces_pk' })]);

export const workspaceMembers = sqliteTable('workcore_workspace_members', {
  applicationId: text('application_id').notNull(),
  workspaceId: text('workspace_id').notNull(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  role: text('role').notNull(),
}, (table) => [
  primaryKey({ columns: [table.applicationId, table.workspaceId, table.userId], name: 'workcore_workspace_members_pk' }),
  foreignKey({ columns: [table.applicationId, table.workspaceId], foreignColumns: [workspaces.applicationId, workspaces.id], name: 'workcore_workspace_members_workspace_fk' }).onDelete('cascade'),
]);

export const activities = sqliteTable('activities', {
  applicationId: text('application_id').notNull(),
  workspaceId: text('workspace_id').notNull(),
  id: text('id').notNull(),
  title: text('title').notNull(),
  status: text('status', { enum: ['planned', 'complete'] }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
}, (table) => [primaryKey({ columns: [table.applicationId, table.workspaceId, table.id], name: 'activities_scope_id_pk' })]);
