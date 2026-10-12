import { and, eq } from 'drizzle-orm';
import type { Actor, Scope, WorkspaceAdapter } from '@workcore/core';
import { auth } from './auth.js';
import { db } from './db/index.js';
import { user, workspaceMembers, workspaces } from './db/schema.js';
import { demoWorkspaces } from './demo-workspaces.js';

const demoUsers = [
  { username: 'alice', email: 'alice@example.test', name: 'Alice Example', password: 'alice-demo-pass', role: 'user' },
  { username: 'bob', email: 'bob@example.test', name: 'Bob Example', password: 'bob-demo-pass', role: 'user' },
  { username: 'admin', email: 'admin@example.test', name: 'Workcore Admin', password: 'admin-demo-pass', role: 'admin' },
] as const;

export async function seedIdentityAndWorkspaces() {
  for (const account of demoUsers) {
    let [existing] = await db.select().from(user).where(eq(user.username, account.username)).limit(1);
    if (!existing) {
      const result = await auth.api.signUpEmail({
        body: { email: account.email, name: account.name, password: account.password, username: account.username },
      });
      [existing] = await db.select().from(user).where(eq(user.id, result.user.id)).limit(1);
      if (existing) await db.update(user).set({ role: account.role }).where(eq(user.id, existing.id));
    }
    if (!existing) throw new Error(`Could not provision demo account ${account.username}`);
    if (account.role === 'admin') await db.update(user).set({ role: 'admin' }).where(eq(user.id, existing.id));
  }

  const userIds = new Map((await db.select({ id: user.id, username: user.username }).from(user)).map((row) => [row.username, row.id]));
  for (const workspace of demoWorkspaces) {
    await db.insert(workspaces).values({ applicationId: workspace.applicationId, id: workspace.id, name: workspace.name })
      .onConflictDoUpdate({ target: [workspaces.applicationId, workspaces.id], set: { name: workspace.name } });
    for (const [username, role] of Object.entries(workspace.members)) {
      const userId = userIds.get(username);
      if (!userId) throw new Error(`Missing user for workspace member ${username}`);
      await db.insert(workspaceMembers).values({ applicationId: workspace.applicationId, workspaceId: workspace.id, userId, role })
        .onConflictDoNothing({ target: [workspaceMembers.applicationId, workspaceMembers.workspaceId, workspaceMembers.userId] });
    }
  }
}

export const sqliteWorkspaceAdapter: WorkspaceAdapter = {
  async canAccess(actor: Actor, scope: Scope) {
    if (scope.applicationId === 'identity' && actor.role === 'admin') return true;
    const [member] = await db.select({ userId: workspaceMembers.userId }).from(workspaceMembers)
      .where(and(eq(workspaceMembers.applicationId, scope.applicationId), eq(workspaceMembers.workspaceId, scope.workspaceId), eq(workspaceMembers.userId, actor.id))).limit(1);
    return !!member;
  },
  async list(actor: Actor, applicationId: string) {
    if (applicationId === 'identity' && actor.role === 'admin') {
      return db.select({ id: workspaces.id, name: workspaces.name }).from(workspaces)
        .where(eq(workspaces.applicationId, applicationId)).orderBy(workspaces.name, workspaces.id);
    }
    return db.select({ id: workspaces.id, name: workspaces.name }).from(workspaces)
      .innerJoin(workspaceMembers, and(
        eq(workspaceMembers.applicationId, workspaces.applicationId),
        eq(workspaceMembers.workspaceId, workspaces.id),
      ))
      .where(and(eq(workspaces.applicationId, applicationId), eq(workspaceMembers.userId, actor.id)))
      .orderBy(workspaces.name, workspaces.id);
  },
};

export async function workspaceRole(actorId: string, scope: Scope) {
  const [member] = await db.select({ role: workspaceMembers.role }).from(workspaceMembers)
    .where(and(eq(workspaceMembers.userId, actorId), eq(workspaceMembers.applicationId, scope.applicationId), eq(workspaceMembers.workspaceId, scope.workspaceId))).limit(1);
  return member?.role;
}
