import type { ScheduleEntry, Scope } from '@workcore/core';

export const sameScope = (left: Scope, right: Scope) => left.applicationId === right.applicationId && left.workspaceId === right.workspaceId;

/** Storage owns claims and dispatch fields; a user snapshot must never replace them. */
export function scheduleEdit(current: ScheduleEntry, snapshot: ScheduleEntry): ScheduleEntry | undefined {
  if (!sameScope(current.scope, snapshot.scope) || (current.revision ?? 0) !== (snapshot.revision ?? 0)) return undefined;
  const { claimToken: _token, claimUntil: _until, activeRunId: _active, pendingRunId: _pending, ...fields } = snapshot;
  return { ...current, ...fields, revision: (current.revision ?? 0) + 1 };
}

export function claimedScheduleUpdate(current: ScheduleEntry, snapshot: ScheduleEntry): ScheduleEntry | undefined {
  if (!sameScope(current.scope, snapshot.scope) || (current.revision ?? 0) !== (snapshot.revision ?? 0)) return undefined;
  const updated = { ...current, ...snapshot, revision: (current.revision ?? 0) + 1 };
  delete updated.claimToken;
  delete updated.claimUntil;
  delete updated.pendingRunId;
  return updated;
}
