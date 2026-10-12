import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type { Activity, ActivityStore } from './app.js';
import { trackerWorkspaces } from './demo-workspaces.js';

const databasePath = resolve(process.env.WORKCORE_DATA ?? 'data/tracker.json');
type DataFile = Record<string, Activity[]>;
type PersistedDataFile = Record<string, Array<Omit<Activity, 'updatedAt'> & { updatedAt: string }>>;
const scopeStorageKey = (applicationId: string, workspaceId: string) => JSON.stringify([applicationId, workspaceId]);
let activityWrite: Promise<void> = Promise.resolve();

async function readDatabase(): Promise<DataFile> {
  try {
    const stored = JSON.parse(await readFile(databasePath, 'utf8')) as PersistedDataFile;
    return Object.fromEntries(Object.entries(stored).map(([key, rows]) => [key, rows.map((row) => ({ ...row, updatedAt: new Date(row.updatedAt) }))]));
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return {};
    throw error;
  }
}

async function writeDatabase(data: DataFile) {
  await mkdir(dirname(databasePath), { recursive: true });
  const temporary = `${databasePath}.${process.pid}.tmp`;
  const persisted: PersistedDataFile = Object.fromEntries(Object.entries(data).map(([key, rows]) => [
    key,
    rows.map(({ updatedAt, ...row }) => ({ ...row, updatedAt: updatedAt.toISOString() })),
  ]));
  await writeFile(temporary, JSON.stringify(persisted, null, 2));
  await rename(temporary, databasePath);
}

export const activityStore: ActivityStore = {
  async list(scope, input) {
    const data = await readDatabase();
    const allRows = data[scopeStorageKey(scope.applicationId, scope.workspaceId)] ?? [];
    const search = input.search?.trim().toLocaleLowerCase();
    const rows = allRows.filter((row) => (!input.status || row.status === input.status) && (!search || row.title.toLocaleLowerCase().includes(search)));
    const start = input.cursor ? Math.max(0, Number.parseInt(input.cursor, 10) || 0) : 0;
    const page = rows.slice(start, start + input.limit);
    const next = start + page.length;
    return { rows: page, nextCursor: next < rows.length ? String(next) : null, totalCount: rows.length };
  },
  async update(scope, input) {
    let updated!: Activity;
    const operation = activityWrite.then(async () => {
      const data = await readDatabase();
      const key = scopeStorageKey(scope.applicationId, scope.workspaceId);
      const rows = data[key] ?? [];
      const index = rows.findIndex((row) => row.id === input.id);
      if (index < 0) throw new Error('Activity not found in this workspace');
      updated = { ...rows[index]!, ...input, updatedAt: new Date() };
      rows[index] = updated;
      data[key] = rows;
      await writeDatabase(data);
    });
    activityWrite = operation.catch(() => undefined);
    await operation;
    return updated;
  },
};

export async function seedData() {
  const data = await readDatabase();
  let changed = false;
  for (const workspace of trackerWorkspaces) {
    const key = scopeStorageKey(workspace.applicationId, workspace.id);
    if (data[key]) continue;
    const legacyKey = `${workspace.applicationId}:${workspace.id}`;
    if (data[legacyKey]) {
      data[key] = data[legacyKey];
      delete data[legacyKey];
    } else data[key] = workspace.activities;
    changed = true;
  }
  if (changed) await writeDatabase(data);
}
