import type { Activity } from './app.js';

export type DemoWorkspace = {
  applicationId: string;
  id: string;
  name: string;
  members: Record<string, 'owner' | 'viewer' | 'admin'>;
  activities?: Activity[];
};

// Seed definitions only. Memberships and all changes made by the demo live in SQLite.
export const demoWorkspaces: DemoWorkspace[] = [
  { applicationId: 'tracker', id: 'personal-alice', name: 'Alice · Personal', members: { alice: 'owner' }, activities: [
    { id: 'run-001', title: 'Morning interval run', status: 'planned', updatedAt: new Date('2026-10-10T08:00:00.000Z') },
    { id: 'ride-002', title: 'Coastal bike ride', status: 'complete', updatedAt: new Date('2026-10-09T17:30:00.000Z') },
  ] },
  { applicationId: 'tracker', id: 'team', name: 'Weekend group', members: { alice: 'owner', bob: 'viewer' }, activities: [
    { id: 'team-001', title: 'Plan group hike', status: 'planned', updatedAt: new Date('2026-10-10T09:15:00.000Z') },
    { id: 'team-002', title: 'Shared trail cleanup', status: 'complete', updatedAt: new Date('2026-10-08T12:30:00.000Z') },
  ] },
  { applicationId: 'tracker', id: 'personal-bob', name: 'Bob · Personal', members: { bob: 'viewer' }, activities: [
    { id: 'swim-100', title: 'Pool technique session', status: 'planned', updatedAt: new Date('2026-10-10T07:20:00.000Z') },
  ] },
  { applicationId: 'notes', id: 'notebook', name: 'Demo notebook', members: { alice: 'owner', bob: 'viewer' } },
  { applicationId: 'identity', id: 'directory', name: 'Identity directory', members: { admin: 'admin' } },
];

export const capabilityRoles = {
  owner: ['workcore.history.read', 'workcore.tasks.read', 'workcore.schedules.read', 'workcore.schedules.manage'],
  viewer: ['workcore.history.read', 'workcore.tasks.read', 'workcore.schedules.read'],
} as const;

export function roleCanUseWorkcoreCapability(role: 'owner' | 'viewer', permission: string) {
  return capabilityRoles[role].includes(permission as never);
}
