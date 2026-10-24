import type { Actor, AdminBlock, AdminManifestPage, ApplicationRegistration, CollectionViewOptions, OperationViewVariant, PlatformOptions, Scope } from '../index.js';
import { createManifestAccess } from './authorization.js';
import { compileOperationSchemas } from './schema.js';

type Visibility = { query: Set<string>; mutation: Set<string>; task: Set<string> };

function projectCollection(collection: CollectionViewOptions, mutations: Set<string>): CollectionViewOptions {
  const { editor, actions = [], ...fields } = collection;
  const visibleActions = actions.filter((action) => mutations.has(action.mutation));
  return { ...fields,
    ...(editor && mutations.has(editor.mutation) ? { editor } : {}),
    ...(visibleActions.length ? { actions: visibleActions } : {}),
  };
}

/** Projection only removes unavailable references; it never mutates the compiled catalog. */
function projectVariant(variant: OperationViewVariant, visible: Visibility): OperationViewVariant {
  const { chat, chatActions, chatList, collection, ...fields } = variant;
  const actions = <T extends { mutation: string }>(mappings: Record<string, T>) => Object.fromEntries(Object.entries(mappings).filter(([, mapping]) => visible.mutation.has(mapping.mutation)));
  const safeChat = chat && (!chat.sendMutation || visible.mutation.has(chat.sendMutation))
    ? { ...chat, ...(chat.actions ? { actions: actions(chat.actions) } : {}) }
    : undefined;
  const safeChatList = chatList ? (() => {
    const { threadQuery, ...options } = chatList;
    return threadQuery && visible.query.has(threadQuery) ? chatList : options;
  })() : undefined;
  return { ...fields,
    ...(variant.actions ? { actions: variant.actions.filter((action) => visible.mutation.has(action.mutation)) } : {}),
    ...(collection ? { collection: projectCollection(collection, visible.mutation) } : {}),
    ...(safeChat ? { chat: safeChat } : {}),
    ...(chatActions ? { chatActions: actions(chatActions) } : {}),
    ...(safeChatList ? { chatList: safeChatList } : {}),
  };
}

export async function makeManifest(registration: ApplicationRegistration, actor: Actor, scope: Scope, options: PlatformOptions) {
  const definition = registration.definition;
  const access = createManifestAccess(registration, options, actor, scope);
  const visible: Visibility = { query: new Set(), mutation: new Set(), task: new Set() };
  const allowed = [];
  for (const operation of compileOperationSchemas(definition)) {
    if (!await access.visible(operation.definition)) continue;
    visible[operation.kind].add(operation.name);
    allowed.push(operation);
  }
  const operations = allowed.map(({ name, kind, input, output }) => ({ name, kind, input, output }));
  const operationViews = allowed.map(({ presentation }) => ({ ...presentation,
    variants: Object.fromEntries(Object.entries(presentation.variants).map(([name, variant]) => [name, projectVariant(variant, visible)])),
  }));
  const capabilities = {
    tasksRead: await access.has('workcore.tasks.read'),
    schedulesRead: await access.has('workcore.schedules.read'),
    schedulesManage: await access.has('workcore.schedules.manage'),
    historyRead: await access.has('workcore.history.read'),
    agentRunsRead: await access.has('workcore.agents.runs.read'),
    agentRunsReadAll: await access.has('workcore.agents.runs.read.all'),
    agentResultsRead: await access.has('workcore.agents.results.read'),
    agentMessagesRead: await access.has('workcore.agents.messages.read'),
    agentToolsRead: await access.has('workcore.agents.tools.read'),
    agentToolPayloadsRead: await access.has('workcore.agents.toolPayloads.read'),
  };
  const resources = { tasks: capabilities.tasksRead, schedules: capabilities.schedulesRead, history: capabilities.historyRead, agents: Boolean(options.services.agentRuns && capabilities.agentRunsRead) };
  const builtinEnabled = (id: 'operations' | 'tasks' | 'schedules' | 'history' | 'agents') => definition.admin?.builtins?.[id] !== false;
  const pages: AdminManifestPage[] = [];
  if (builtinEnabled('operations') && operations.length) pages.push({
    id: 'operations', title: 'Operations', description: 'Explore validated operations available in this workspace.', layout: 'two-column', builtin: true,
    blocks: [
      { id: 'operation-catalog', type: 'operation-catalog', selection: 'operation' },
      { id: 'operation-executor', type: 'operation-executor', selection: 'operation' },
    ],
  });
  if (builtinEnabled('tasks') && resources.tasks) pages.push({ id: 'tasks', title: 'Task runs', description: 'Inspect queued, running and completed tasks.', blocks: [{ id: 'task-runs', type: 'resource', resource: 'tasks', title: 'Task runs' }], builtin: true });
  if (builtinEnabled('schedules') && resources.schedules) pages.push({ id: 'schedules', title: 'Schedules', description: 'Manage recurring and one-off task schedules.', blocks: [{ id: 'schedules', type: 'resource', resource: 'schedules', title: 'Schedules' }], builtin: true });
  if (builtinEnabled('history') && resources.history) pages.push({ id: 'history', title: 'History', description: 'Recent execution outcomes for this workspace.', blocks: [{ id: 'history', type: 'resource', resource: 'history', title: 'History' }], builtin: true });
  if (builtinEnabled('agents') && resources.agents) pages.push({ id: 'agents', title: 'Agent runs', description: 'Inspect agent execution status and authorized trace details.', blocks: [{ id: 'agent-runs', type: 'resource', resource: 'agents', title: 'Agent runs' }], builtin: true });
  const blockVisible = (block: AdminBlock) => {
    switch (block.type) {
      case 'custom': return true;
      case 'resource': return resources[block.resource];
      case 'operation-catalog': case 'operation-executor': return operations.length > 0;
      case 'query': return visible.query.has(block.operation);
      case 'mutation-form': return visible.mutation.has(block.operation);
      case 'task-launcher': return visible.task.has(block.operation);
    }
  };
  for (const [id, page] of Object.entries(definition.admin?.pages ?? {})) {
    const blocks = page.blocks.filter(blockVisible);
    if (blocks.length) pages.push({ id, ...page, blocks });
  }
  const semanticPages = pages.map((page) => ({ ...page, layout: normalizeLayout(page.layout) }));
  const defaultPage = semanticPages.some((page) => page.id === definition.admin?.defaultPage) ? definition.admin!.defaultPage : semanticPages[0]?.id;
  const blocks = semanticPages.flatMap((page) => page.blocks);
  const requiredFeatures = [
    ...(operationViews.length ? ['operation-views-v1'] : []),
    ...(operationViews.some((view) => Object.values(view.variants).some((variant) => !!variant.collection)) ? ['collection-editor-v1'] : []),
    ...(blocks.some((block) => block.type === 'operation-catalog' || block.type === 'operation-executor') ? ['operation-catalog-v1'] : []),
    ...(blocks.some((block) => block.type === 'custom') ? ['custom-placeholder-v1'] : []),
  ];
  return { protocolVersion: 2, schemaDialect: 'https://json-schema.org/draft/2020-12/schema', applicationId: definition.id, operations,
    interface: { version: 1, requiredFeatures, pages: semanticPages, ...(defaultPage ? { defaultPage } : {}), operationViews }, capabilities };
}

function normalizeLayout(layout: AdminManifestPage['layout']): 'stack' | 'grid' | 'page' {
  return layout === 'two-column' || layout === 'overview' ? 'grid' : layout === 'stacked' ? 'stack' : 'page';
}
