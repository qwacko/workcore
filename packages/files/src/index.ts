import { table } from '@workcore/core';
import type { Definition, FileBucket, Table } from '@workcore/core';
import { z } from 'zod';

/** Explicitly add this predefined metadata table to workspace(tables). */
export const fileTable: Table & { schema: z.ZodObject<any> } = table(z.object({
  ownerId: z.string().min(1).max(200),
  filename: z.string().min(1).max(255),
  contentType: z.string().min(1).max(255),
  size: z.number().int().nonnegative().max(5_000_000_000),
  status: z.enum(['pending', 'ready', 'deleting']),
  createdAt: z.number().int().nonnegative(),
  uploadedAt: z.number().int().nonnegative().nullable(),
}), { indexes: { owner: 'ownerId', status: 'status' } });

/** Compose the R2 binding into a normal Workcore definition. Bytes never enter SQLite. */
export function fileStorage<E>(options: { bucket: (env: E) => FileBucket; maxSize?: number } ): NonNullable<Definition['files']> {
  const maxSize = options.maxSize ?? 25 * 1024 * 1024;
  if (!Number.isSafeInteger(maxSize) || maxSize < 1 || maxSize > 5_000_000_000) throw new Error('maxSize must be between 1 byte and 5GB');
  return { table: 'files', bucket: options.bucket as (env: unknown) => FileBucket, maxSize };
}
