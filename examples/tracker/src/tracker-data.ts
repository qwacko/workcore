import { and, asc, count, eq, like } from 'drizzle-orm';
import type { Activity, ActivityStore } from './tracker-types.js';
import { activities } from './db/schema.js';
import { db } from './db/index.js';

export const activityStore: ActivityStore = {
  async list(scope, input) {
    const filters = [eq(activities.applicationId, scope.applicationId), eq(activities.workspaceId, scope.workspaceId)];
    if (input.status) filters.push(eq(activities.status, input.status));
    if (input.search?.trim()) filters.push(like(activities.title, `%${input.search.trim()}%`));
    const where = and(...filters);
    const start = input.cursor ? Math.max(0, Number.parseInt(input.cursor, 10) || 0) : 0;
    const [total] = await db.select({ value: count() }).from(activities).where(where);
    const rows = await db.select().from(activities).where(where).orderBy(asc(activities.updatedAt)).limit(input.limit).offset(start);
    const next = start + rows.length;
    return { rows, nextCursor: next < (total?.value ?? 0) ? String(next) : null, totalCount: total?.value ?? 0 };
  },
  async update(scope, input) {
    const [updated] = await db.update(activities).set({ title: input.title, status: input.status, updatedAt: new Date() })
      .where(and(eq(activities.applicationId, scope.applicationId), eq(activities.workspaceId, scope.workspaceId), eq(activities.id, input.id)))
      .returning();
    if (!updated) throw new Error('Activity not found in this workspace');
    return updated;
  },
};

export async function seedActivityData() {
  const seeds: Array<[string, string, string, string, Activity['status'], string]> = [
    ['tracker', 'personal-alice', 'run-001', 'Morning interval run', 'planned', '2026-10-10T08:00:00.000Z'],
    ['tracker', 'personal-alice', 'ride-002', 'Coastal bike ride', 'complete', '2026-10-09T17:30:00.000Z'],
    ['tracker', 'team', 'team-001', 'Plan group hike', 'planned', '2026-10-10T09:15:00.000Z'],
    ['tracker', 'team', 'team-002', 'Shared trail cleanup', 'complete', '2026-10-08T12:30:00.000Z'],
    ['tracker', 'personal-bob', 'swim-100', 'Pool technique session', 'planned', '2026-10-10T07:20:00.000Z'],
  ];
  for (const [applicationId, workspaceId, id, title, status, updatedAt] of seeds) {
    await db.insert(activities).values({ applicationId, workspaceId, id, title, status, updatedAt: new Date(updatedAt) })
      .onConflictDoNothing({ target: [activities.applicationId, activities.workspaceId, activities.id] });
  }
}
