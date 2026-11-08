import { eq } from 'drizzle-orm';
import type { AnySQLiteColumn } from 'drizzle-orm/sqlite-core';
import { WorkcoreError } from './json.js';

/** Include this predicate alongside row identity AND ownership in a write. */
export function versionMatch(column: AnySQLiteColumn, expected: number) {
  if (!Number.isSafeInteger(expected) || expected < 1) throw new WorkcoreError('INVALID_VERSION', 'Expected a positive integer version');
  return eq(column, expected);
}

/** Avoid disclosing whether a missing row was deleted, changed, or belongs to someone else. */
export function requireChanged<T>(row: T | undefined | null): T {
  if (row === undefined || row === null) throw new WorkcoreError('CONFLICT', 'Record changed or is unavailable; reload before retrying', 409);
  return row;
}
