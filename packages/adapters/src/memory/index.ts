import type { PlatformServices, Scope } from '@workcore/core';
export { createMemoryState } from '@workcore/core';

/** Shared in-memory state. Create one per platform/test. */
export type MemoryState = PlatformServices;

export const createMemoryWorkspaces = (state: MemoryState) => state.workspaces;
export const createMemoryEvents = (state: MemoryState) => state.events;
export const createMemoryHistory = (state: MemoryState) => state.history;
export const createMemoryTasks = (state: MemoryState) => state.tasks;
export const createMemorySchedules = (state: MemoryState) => state.schedules;
export const createMemoryKV = (state: MemoryState) => state.kv;
export const createMemoryAgentRuns = (state: MemoryState) => state.agentRuns!;
export const createMemoryLogger = (state: MemoryState): NonNullable<MemoryState['logger']> => state.logger!;

export type { Scope };
