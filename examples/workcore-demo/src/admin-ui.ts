// Optional admin-only pages. The custom demo frontend does not consume these definitions.
import { ui } from '@workcore/core';
import { z } from 'zod';
import type { adminOperations, taskRow } from './app';

export function adminUI(operations: typeof adminOperations) {
  const {
    tasks,
    summary,
    stateScopedTasks,
    stateScopedSummary,
    assistantSummary,
    conversation,
    taskDetails,
  } = operations.views;
  const { guide, myTaskPage } = operations.queries;
  const { editTask, completeTask, scheduleCompletion, createTask, saveSummary, sendMessage } =
    operations.mutations;
  const taskList = ui.collection(tasks, ({ form, command }) => ({
    id: 'project-tasks',
    title: 'Project tasks',
    description: 'A bounded, live dataset. Use row actions instead of copying record IDs.',
    columns: [
      { path: 'title', label: 'Task' },
      { path: 'done', label: 'Complete', renderer: 'tracker.completion-cell' },
      { path: 'private', label: 'Private', format: 'badge' },
      { path: 'ownerId', label: 'Owner' },
    ],
    search: ['title'],
    filters: [
      {
        path: 'done',
        label: 'Completion',
        options: [
          { label: 'Open', value: false },
          { label: 'Completed', value: true },
        ],
      },
    ],
    detail: { display: 'taskDetail', label: 'Details', bind: { taskId: 'id' } },
    actions: [
      form(editTask, {
        label: 'Edit task',
        bind: { id: 'id', expectedRevision: 'version' },
        initial: { title: 'title', projectId: 'projectId', private: 'private' },
        visibleWhen: { path: 'ownerId', equals: { actor: true } },
      }),
      command(completeTask, {
        label: 'Complete',
        bind: { id: 'id', expectedRevision: 'version' },
        visibleWhen: { path: 'ownerId', equals: { actor: true } },
        disabledWhen: { path: 'done', equals: true },
      }),
      form(scheduleCompletion, {
        label: 'Schedule',
        bind: { id: 'id' },
        visibleWhen: { path: 'ownerId', equals: { actor: true } },
      }),
    ],
  }));

  const projectDisplay = ui.display({
    input: z.object({ projectId: z.string().min(1).max(100) }),
    metadata: {
      title: 'Project detail',
      route: { path: '/projects/:projectId', listed: false },
    },
    handler: (_ctx, input) =>
      ui.document({
        blocks: [
          ui.record(summary, {
            id: 'project-summary',
            title: 'Project summary',
            input: { projectId: input.projectId },
          }),
          ui.collection(tasks, () => ({
            id: 'project-tasks',
            title: 'Project tasks',
            input: { projectId: input.projectId },
            columns: [{ path: 'title' }, { path: 'done', format: 'badge' }],
            detail: {
              display: 'taskDetail',
              label: 'Details',
              bind: { taskId: 'id' },
            },
          })),
        ],
      }),
  });
  const editReconciliationDemo = ui.display({
    input: z.object({ projectId: z.string().min(1).max(100) }),
    metadata: {
      title: 'Live edit reconciliation',
      route: { path: '/edit-reconciliation/:projectId', listed: false },
    },
    handler: (_ctx, input) =>
      ui.document({
        blocks: [
          ui.collection(tasks, ({ form }) => ({
            id: 'reconciled-tasks',
            title: 'Tasks with live edit forms',
            input: { projectId: input.projectId },
            columns: [{ path: 'title' }],
            actions: [
              form(editTask, {
                label: 'Edit task',
                bind: { id: 'id', expectedRevision: 'version' },
                initial: {
                  title: 'title',
                  projectId: 'projectId',
                  private: 'private',
                },
                visibleWhen: { path: 'ownerId', equals: { actor: true } },
              }),
            ],
          })),
        ],
      }),
  });
  const statefulProject = ui.display({
    input: z.object({ projectId: z.string().min(1).max(100) }),
    metadata: {
      title: 'Typed state demo',
      route: { path: '/stateful/:projectId', listed: false },
    },
    handler: (_ctx, input) =>
      ui.document({
        state: {
          status: ui.state(z.enum(['all', 'open', 'done']), {
            default: 'open',
            persistence: 'url',
          }),
        },
        blocks: [
          ui.stateControl('status', {
            id: 'status-state-control',
            label: 'Shared task status',
            options: [
              { label: 'All tasks', value: 'all' },
              { label: 'Open tasks', value: 'open' },
              { label: 'Completed tasks', value: 'done' },
            ],
          }),
          ui.form(saveSummary, {
            id: 'state-effect-form',
            label: 'Apply all-task filter',
            values: { text: 'State effect exercised' },
            effects: [ui.effect.setState('status', 'all'), ui.effect.refreshSources()],
          }),
          ui.record(stateScopedSummary, {
            id: 'state-summary',
            title: 'Matching tasks',
            input: {
              projectId: input.projectId,
              status: ui.bind.state('status'),
            },
            fields: [{ path: 'count', label: 'Count' }],
          }),
          ui.collection(stateScopedTasks, ({ command }) => ({
            id: 'state-tasks',
            title: 'Tasks in selected state',
            input: {
              projectId: input.projectId,
              status: ui.bind.state('status'),
            },
            columns: [{ path: 'title' }],
            actions: [
              command(completeTask, {
                label: 'Complete, filter done and open',
                bind: { id: 'id', expectedRevision: 'version' },
                effects: [
                  ui.effect.setState('status', 'done'),
                  ui.effect.navigate<typeof taskRow>('taskDetail', {
                    taskId: 'id',
                  }),
                ],
              }),
            ],
          })),
        ],
      }),
  });
  return {
    title: 'Tracker',
    description: 'Live tasks, private conversations and durable background work.',
    components: {
      'tracker.task-board': {
        version: 1,
        props: z.object({ groupBy: z.enum(['status', 'owner']) }),
      },
      'tracker.completion-cell': {
        version: 1,
        placement: 'cell' as const,
        props: z.object({}),
      },
      'tracker.title-field': {
        version: 1,
        placement: 'field' as const,
        props: z.object({}),
      },
    },
    displays: {
      overview: ui.display({
        metadata: {
          title: 'Workspace overview',
          description:
            'A small application, not just a database browser. Every panel is declared by the backend.',
          route: { path: '/', listed: true },
        },
        document: ui.document({
          blocks: [
            ui.markdown(guide, { id: 'getting-started', title: 'Start here' }),
            ui.record(summary, { id: 'summary', title: 'At a glance' }),
            taskList,
            ui.form(createTask, {
              id: 'create-task',
              title: 'Add something to do',
              label: 'Create task',
            }),
          ],
        }),
      }),
      tasks: ui.display({
        metadata: {
          title: 'Tasks',
          description: 'Manage a live project working set. Local filters are preserved in the URL.',
          route: { path: '/tasks', listed: true },
        },
        document: ui.document({
          blocks: [
            taskList,
            ui.form(createTask, {
              id: 'create-task',
              title: 'Create task',
              label: 'Create task',
              navigate: { display: 'taskDetail', bind: { taskId: 'id' } },
            }),
          ],
        }),
      }),
      assistant: ui.display({
        metadata: {
          title: 'Assistant',
          description: 'A private, persisted conversation with checked background execution.',
          route: { path: '/assistant', listed: true },
        },
        document: ui.document({
          blocks: [
            ui.chat(conversation, sendMessage, {
              id: 'conversation',
              title: 'Workspace assistant',
              messages: 'messages',
              message: {
                id: 'id',
                role: 'role',
                content: 'content',
                parts: 'parts',
                at: 'at',
              },
              promptField: 'message',
              runId: 'runId',
            }),
            ui.markdown(assistantSummary, {
              id: 'assistant-summary',
              title: 'Latest summary',
            }),
          ],
        }),
      }),
      data: ui.display({
        metadata: {
          title: 'Data explorer',
          description:
            'Inspect authorised application data and browse raw registered tables as an administrator.',
          classification: 'admin',
          route: { path: '/data', listed: true },
        },
        document: ui.document({
          blocks: [
            ui.json(tasks, { id: 'live-json', title: 'Live project JSON' }),
            ui.collection(myTaskPage, () => ({
              id: 'my-task-page',
              title: 'My paginated tasks',
              columns: [
                { path: 'title', label: 'Task' },
                { path: 'id', label: 'Record ID' },
              ],
            })),
          ],
        }),
      }),
      project: projectDisplay,
      editReconciliationDemo,
      statefulProject,
      embedDemo: ui.display({
        metadata: {
          title: 'Embedded projects',
          description: 'Two independently scoped instances of the same parameterized display.',
          route: { path: '/embedded-projects', listed: true },
        },
        document: ui.document({
          blocks: [
            ui.displayReference('project', {
              id: 'project-one',
              title: 'First project instance',
              input: { projectId: 'inbox' },
            }),
            ui.displayReference('project', {
              id: 'project-two',
              title: 'Second project instance',
              input: { projectId: 'inbox' },
            }),
          ],
        }),
      }),
      embedBudgetDemo: ui.display({
        metadata: {
          title: 'Embed budget demo',
          route: { path: '/embed-budget', listed: false },
        },
        document: ui.document({
          blocks: [
            ui.dialog({
              id: 'budget-dialog',
              triggerLabel: 'Open 21 embedded displays',
              children: Array.from({ length: 21 }, (_, index) =>
                ui.displayReference('project', {
                  id: `budget-${index}`,
                  title: `Project embed ${index + 1}`,
                  input: { projectId: 'inbox' },
                }),
              ),
            }),
          ],
        }),
      }),
      taskDetail: ui.display({
        input: z.object({ taskId: z.string().min(1).max(200) }),
        metadata: {
          title: 'Task details',
          route: { path: '/tasks/:taskId', listed: false },
        },
        document: ui.document({
          blocks: [
            ui.record(taskDetails, {
              id: 'task-details',
              title: 'Selected task',
              input: { taskId: ui.bind.property('taskId') },
              fields: [
                { path: 'title', label: 'Task' },
                { path: 'projectId', label: 'Project' },
                { path: 'ownerId', label: 'Owner' },
                { path: 'private', label: 'Private', format: 'badge' },
                {
                  path: 'done',
                  label: 'Complete',
                  renderer: 'tracker.completion-cell',
                },
              ],
            }),
          ],
        }),
      }),
      board: ui.display({
        metadata: {
          title: 'Component demo',
          description:
            'A working, locally registered task board built from an authorized live view.',
          route: { path: '/board', listed: true },
        },
        document: ui.document({
          blocks: [
            ui.custom(
              'tracker.task-board',
              1,
              { groupBy: 'status' },
              { id: 'task-board', title: 'Task board' },
            ),
          ],
        }),
      }),
      layouts: ui.display({
        metadata: {
          title: 'Layout demo',
          description: 'Responsive composition, dialog content, and a declared action button.',
          route: { path: '/layouts', listed: true },
        },
        document: ui.document({
          blocks: [
            ui.section({
              id: 'layout-example',
              title: 'Layout example',
              children: [
                ui.columns({
                  id: 'layout-columns',
                  columns: [
                    {
                      id: 'layout-left',
                      children: [
                        ui.markdown(guide, {
                          id: 'layout-guide',
                          title: 'Inside the first column',
                        }),
                      ],
                    },
                    {
                      id: 'layout-right',
                      children: [
                        ui.dialog({
                          id: 'layout-dialog',
                          title: 'Helpful details',
                          triggerLabel: 'Open layout dialog',
                          children: [
                            ui.markdown(guide, {
                              id: 'dialog-content',
                              title: 'Dialog content',
                            }),
                          ],
                        }),
                      ],
                    },
                  ],
                }),
                ui.button(createTask, {
                  id: 'layout-create',
                  label: 'Create task from layout',
                  variant: 'secondary',
                }),
              ],
            }),
          ],
        }),
      }),
      selection: ui.display({
        metadata: {
          title: 'Selection demo',
          description: 'A typed table selection drives an independently authorized detail source.',
          route: { path: '/selection', listed: true },
        },
        document: ui.document({
          blocks: [
            ui.combined.masterDetail(tasks, taskDetails, {
              id: 'task-browser',
              title: 'Choose a task',
              key: 'id',
              detailInput: 'taskId',
              listTitle: 'Tasks',
              detailTitle: 'Selected task',
              columns: [
                { path: 'title', label: 'Task' },
                { path: 'done', label: 'Complete', format: 'badge' },
              ],
              detailFields: [
                { path: 'title', label: 'Task' },
                { path: 'projectId', label: 'Project' },
                { path: 'ownerId', label: 'Owner' },
              ],
            }),
          ],
        }),
      }),
    },
  };
}
