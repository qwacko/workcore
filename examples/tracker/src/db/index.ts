import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from './schema.js';

export const databasePath = resolve(process.env.WORKCORE_DATABASE ?? 'data/workcore.sqlite');
mkdirSync(dirname(databasePath), { recursive: true });
const sqlite = new Database(databasePath);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');
export const db = drizzle(sqlite, { schema });

export function migrateDatabase() {
  migrate(db, { migrationsFolder: resolve('drizzle') });
}

export function closeDatabase() { sqlite.close(); }
