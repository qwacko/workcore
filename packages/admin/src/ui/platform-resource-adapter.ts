import type { AdminBlock, AgentRun, AgentRunStatus } from '@workcore/core';
import type { ScheduleCreateInput, ScheduleUpdateInput, WorkcoreTransport } from '@workcore/client';

export type PlatformResource = Extract<AdminBlock, { type: 'resource' }>['resource'];
export type PlatformAgentFilters = {
  status: AgentRunStatus | '';
  agent: string;
  actorId: string;
  conversationId: string;
};

export type PlatformResourceResult = {
  result: unknown;
  agentPage?: { runs: AgentRun[]; nextCursor: string | null };
};

type PlatformTransport = Pick<WorkcoreTransport, 'resources' | 'agentRuns' | 'agentRunEvents'>;

function scheduleAdapter(transport: PlatformTransport) {
  if (!transport.resources) throw new Error('Schedule resource adapter is unavailable.');
  return transport.resources;
}

export async function createPlatformSchedule(transport: PlatformTransport, applicationId: string, workspaceId: string, input: ScheduleCreateInput) {
  return scheduleAdapter(transport).createSchedule(applicationId, workspaceId, input);
}

export async function updatePlatformSchedule(transport: PlatformTransport, applicationId: string, workspaceId: string, id: string, patch: ScheduleUpdateInput) {
  return scheduleAdapter(transport).updateSchedule(applicationId, workspaceId, id, patch);
}

export async function deletePlatformSchedule(transport: PlatformTransport, applicationId: string, workspaceId: string, id: string) {
  return scheduleAdapter(transport).deleteSchedule(applicationId, workspaceId, id);
}

export async function loadAgentRunEvents(transport: PlatformTransport, applicationId: string, workspaceId: string, runId: string, cursor: number | undefined, limit: number) {
  if (!transport.agentRunEvents) throw new Error('Agent run event adapter is unavailable.');
  return transport.agentRunEvents(applicationId, workspaceId, runId, cursor, limit);
}

/** Fetch one declared platform resource using only the built-in allow-list. */
export async function loadPlatformResource(
  transport: PlatformTransport,
  applicationId: string,
  workspaceId: string,
  resource: PlatformResource,
  options: { cursor?: string; filters: PlatformAgentFilters; previousRuns: AgentRun[] },
): Promise<PlatformResourceResult> {
  if (resource === 'agents') {
    if (!transport.agentRuns) throw new Error('Agent run resource adapter is unavailable.');
    const page = await transport.agentRuns(applicationId, workspaceId, {
      limit: 30,
      ...(options.cursor ? { cursor: options.cursor } : {}),
      ...(options.filters.status ? { status: options.filters.status } : {}),
      ...(options.filters.agent.trim() ? { agent: options.filters.agent.trim() } : {}),
      ...(options.filters.actorId.trim() ? { actorId: options.filters.actorId.trim() } : {}),
      ...(options.filters.conversationId.trim() ? { conversationId: options.filters.conversationId.trim() } : {}),
    });
    const runs = options.cursor ? [...options.previousRuns, ...page.runs] : page.runs;
    return { result: runs, agentPage: { runs, nextCursor: page.nextCursor } };
  }

  const adapters = transport.resources;
  if (!adapters) throw new Error(`${resource} resource adapter is unavailable.`);
  switch (resource) {
    case 'tasks': return { result: (await adapters.taskRuns(applicationId, workspaceId, 50)).runs };
    case 'history': return { result: (await adapters.history(applicationId, workspaceId, 50)).entries };
    case 'schedules': return { result: (await adapters.schedules(applicationId, workspaceId)).schedules };
  }
}
