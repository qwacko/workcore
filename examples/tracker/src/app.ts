import { composeApplication } from '@workcore/core';
import { z } from 'zod';
import { roleCanUseWorkcoreCapability } from './demo-workspaces.js';
import { activitiesModule } from './modules/activities.js';
import { assistantModule } from './modules/assistant.js';
import type { TrackerContext } from './tracker-types.js';

// Keep existing type imports source-compatible; implementation modules share only domain contracts.
export type { Activity, ActivityStore, ActivitySummary, Conversation, ConversationMessage, ConversationStore, TrackerContext } from './tracker-types.js';
const trackerAuthorizationContext = z.object({ userId: z.string(), role: z.enum(['owner', 'viewer']), isAdmin: z.boolean() });
export type TrackerAuthorization = z.output<typeof trackerAuthorizationContext>;

/** Tracker owns policy, capability wiring and cross-module navigation—not module implementations. */
export const tracker = composeApplication<TrackerContext>()({
  id: 'tracker',
  modules: { activities: activitiesModule, assistant: assistantModule },
  dependencies: {
    activities: ({ operations }) => ({
      afterUpdated: async (activity) => { await operations.mutate('assistant.activityUpdated', activity); },
    }),
    assistant: ({ operations }) => ({
      getActivitySummary: () => operations.query('activities.summary', {}),
    }),
  },
  authorization: {
    context: trackerAuthorizationContext,
    check: ({ auth, permission }) => auth.isAdmin || auth.role === 'owner' || permission === 'activities.read' || permission === 'assistant.chat' || permission === 'notes.read' || (permission.startsWith('workcore.') && roleCanUseWorkcoreCapability(auth.role, permission)),
  },
  admin: ({ ui, queries, mutations }) => ({
    defaultPage: 'operations',
    pages: {
      activityDashboard: ui.page({
        title: 'Activity dashboard', description: 'Application navigation composed from the activities module.', layout: 'two-column',
        blocks: [
          queries['activities.list'].view('basic', { id: 'recent-activities', input: { limit: 10 } }),
          { id: 'standalone-activity-editor', type: 'mutation-form', operation: mutations['activities.edit'].name, title: 'Edit an activity' },
        ],
      }),
      workspaceOverview: ui.page({
        title: 'Workspace overview', description: 'Activity data and Milo chat composed from independent modules.', layout: 'two-column',
        blocks: [
          queries['activities.list'].view('compact', { id: 'overview-activities', input: { limit: 10 } }),
          queries['assistant.conversation'].view('chat', { id: 'overview-assistant', input: {} }),
        ],
      }),
      workspaceHistory: ui.page({
        title: 'Workspace history', description: 'A custom page composed with the platform history resource.', layout: 'stacked',
        blocks: [{ id: 'history-resource', type: 'resource', resource: 'history', title: 'Recent activity' }],
      }),
      operationWorkbench: ui.page({
        title: 'Operation workbench', description: 'An application-authored operation catalog and checked executor composition.', layout: 'two-column',
        blocks: [ui.operationCatalog({ id: 'available-operations', selection: 'workbench' }), ui.operationExecutor({ id: 'operation-runner', selection: 'workbench' })],
      }),
      rendererExtension: ui.page({
        title: 'Renderer extension', description: 'A versioned, renderer-independent custom component descriptor.', layout: 'stacked',
        blocks: [{ id: 'activity-summary', type: 'custom', component: 'tracker/activity-summary', version: 1, title: 'Activity summary', description: 'A custom renderer can replace this placeholder with an activity summary.', props: { query: 'activities.list' } }],
      }),
    },
  }),
});
