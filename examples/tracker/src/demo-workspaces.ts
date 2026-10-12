import type { Activity } from './app.js';

export type Role = 'owner' | 'viewer';
export type WorkspaceRecord = {
  applicationId: string;
  id: string;
  name: string;
  members: Record<string, Role>;
};
export type TrackerWorkspace = WorkspaceRecord & { activities: Activity[] };

// This is the complete demo membership configuration. The role controls which
// operations a member may use after workspace access has been granted.
export const trackerWorkspaces: TrackerWorkspace[] = [
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
];

export const noteWorkspaces: WorkspaceRecord[] = [
  { applicationId: 'notes', id: 'notebook', name: 'Demo notebook', members: { alice: 'owner', bob: 'viewer' } },
];

export const allWorkspaces = [...trackerWorkspaces, ...noteWorkspaces];

const workcoreCapabilities: Record<Role, readonly string[]> = {
  owner: ['workcore.history.read', 'workcore.tasks.read', 'workcore.schedules.read', 'workcore.schedules.manage'],
  viewer: ['workcore.history.read', 'workcore.tasks.read', 'workcore.schedules.read'],
};

export function roleCanUseWorkcoreCapability(role: Role, permission: string) {
  return workcoreCapabilities[role].includes(permission);
}

export function isKnownActor(actorId: string) {
  return allWorkspaces.some((workspace) => workspace.members[actorId]);
}

export function workspaceRole(actorId: string, applicationId: string, workspaceId: string): Role | undefined {
  return allWorkspaces.find((workspace) => workspace.applicationId === applicationId && workspace.id === workspaceId)?.members[actorId];
}

export function workspaceServiceConfig() {
  return allWorkspaces.map(({ members, ...workspace }) => ({ ...workspace, actors: Object.keys(members) }));
}
