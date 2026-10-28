import type { Definition, FileBucket } from '@workcore/core';
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/** File bytes live in R2; this typed SQL table stores only authorised metadata. */
export const fileTable = sqliteTable('files', {
  id: text('id').primaryKey(), ownerId: text('owner_id').notNull(), filename: text('filename').notNull(),
  contentType: text('content_type').notNull(), size: integer('size').notNull(),
  status: text('status', { enum: ['pending', 'ready', 'deleting'] }).notNull(),
  createdAt: integer('created_at').notNull(), uploadedAt: integer('uploaded_at'),
}, table => [index('files_owner_id').on(table.ownerId), index('files_status').on(table.status)]);

/** Compose the R2 binding into a normal Workcore definition. Bytes never enter SQLite. */
export function fileStorage<E>(options: { bucket: (env: E) => FileBucket; maxSize?: number }): NonNullable<Definition['files']> {
  const maxSize = options.maxSize ?? 25 * 1024 * 1024;
  if (!Number.isSafeInteger(maxSize) || maxSize < 1 || maxSize > 5_000_000_000) throw new Error('maxSize must be between 1 byte and 5GB');
  return { table: 'files' as const, bucket: options.bucket as (env: unknown) => FileBucket, maxSize };
}
