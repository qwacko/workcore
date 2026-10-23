<script lang="ts">
import { createFetchTransport, validateSemanticInterface, type OperationViews, type ScheduleCreateInput, type WorkcoreManifest, type WorkcoreTransport } from '@workcore/client';
  import type { AdminBlock, AgentRun, AgentRunStatus, AgentTraceEvent, ChatAction, ChatActionMapping, ChatThread, CollectionViewOptions, OperationKind, SemanticManifestPage } from '@workcore/core';
  import { superjsonCodec } from '@workcore/codec-superjson';
  import DashboardBlock from './DashboardBlock.svelte';
  import OperationList from './OperationList.svelte';
  import OperationInput from './OperationInput.svelte';
  import DataTable from './DataTable.svelte';
  import ChartView from './ChartView.svelte';
  import ChatView from './ChatView.svelte';
  import { chatMessages as getChatMessages, chatThreads as getChatThreads, nextCursor as getNextCursor, previousCursor as getPreviousCursor, chatMutationInput, pathValue, validateChatNavigation } from './chat-data.js';
  import { captureRequestContext } from './request-context.js';
  import { QuerySourceController, type QuerySourceSnapshot } from './query-source.js';
  import { editableJson, parseEditableJson, hydrateRuntimeTypes, richJson, displayCell } from './rich-input.js';
  import { getCollectionFieldValue } from './collection-editor.js';
  import { clearChatQueryViewCache, createChatQueryCacheNamespace } from './chat-query-cache.js';
  import { createPlatformSchedule, deletePlatformSchedule, loadAgentRunEvents, loadPlatformResource, updatePlatformSchedule } from './platform-resource-adapter.js';

  const config = (window as Window & { __WORKCORE_ADMIN__?: { apiBasePath?: string; basePath?: string; wireCodecId?: string } }).__WORKCORE_ADMIN__ ?? {};
  if (config.wireCodecId && config.wireCodecId !== 'json' && config.wireCodecId !== 'superjson-v1') throw new Error(`Unsupported admin wire codec '${config.wireCodecId}'`);
  const codec = config.wireCodecId === 'superjson-v1' ? superjsonCodec() : undefined;
  const transport: WorkcoreTransport = createFetchTransport({ baseUrl: config.apiBasePath ?? '/workcore/api', ...(codec ? { codec } : {}), onWarning: (code) => { error = `Operation completed, but follow-up delivery reported ${code}.`; } });
  let applicationId = $state(new URLSearchParams(location.search).get('applicationId') ?? 'tracker');
  let workspaceId = $state(new URLSearchParams(location.search).get('workspaceId') ?? '');
  let applications = $state<Array<{ id: string; workspaceCount: number }>>([]);
  let workspaces = $state<Array<{ id: string; name: string }>>([]);
  let manifest = $state<WorkcoreManifest | null>(null);
  let pages = $state<SemanticManifestPage[]>([]);
  let selectedOperation = $state('');
  let selectedOperationKind = $state<OperationKind>('query');
  let selectedVariant = $state('');
  let inputText = $state('{}');
  let result = $state.raw<unknown>(null);
  let error = $state('');
  let loading = $state(false);
  let liveStatus = $state<'connecting' | 'connected' | 'reconnecting' | 'offline'>('connecting');
  let section = $state('operations');
  let scheduleDrafts = $state<Record<string, { cron?: string; timezone?: string }>>({});
  let agentRuns = $state<AgentRun[]>([]);
  let selectedAgentRun = $state<AgentRun | null>(null);
  let agentEvents = $state<AgentTraceEvent[]>([]);
  let agentEventsCursor = $state<string | null>(null);
  let agentRunCursor = $state<string | null>(null);
  let agentStatusFilter = $state<AgentRunStatus | ''>('');
  let agentNameFilter = $state('');
  let agentActorFilter = $state('');
  let agentConversationFilter = $state('');
  let chatSending = $state(false);
  let chatFollowToken = $state(0);
  let queryCacheNamespace = $state(createChatQueryCacheNamespace());
  let unsubscribe: (() => void) | undefined;
  let cursorStack = $state<string[]>([]);
  let queryGeneration = 0;
  let submissionGeneration = 0;
  let workspaceRequestGeneration = 0;
  let agentRunsGeneration = 0;
  let agentEventsGeneration = 0;
  let chatSendGeneration = 0;
  let pageNavigationGeneration = 0;
  let scheduleDialogOpen = $state(false);
  let scheduleTaskOperation = $state('');
  let scheduleTaskInputText = $state('{}');
  let scheduleKind = $state<'recurring' | 'once'>('recurring');
  let scheduleCron = $state('0 9 * * *');
  let scheduleRunAt = $state('');
  let scheduleTimezone = $state(Intl.DateTimeFormat().resolvedOptions().timeZone);
  let pageQueryStates = $state<Record<string, QuerySourceSnapshot<unknown>>>({});
  let pageStateValues = $state<Record<string, Record<string, string>>>({});
  let dirtyCollectionEditors = $state<Record<string, true>>({});
  const pageQuerySources = new Map<string, QuerySourceController<unknown>>();
  let pageResourceStates = $state<Record<string, QuerySourceSnapshot<unknown>>>({});
  const pageResourceSources = new Map<string, QuerySourceController<unknown>>();
  let pageChatSending = $state<Record<string, boolean>>({});
  let pageChatFollowTokens = $state<Record<string, number>>({});
  let pageQueryInputs = $state<Record<string, string>>({});
  let pageChatGenerations: Record<string, number> = {};
  let operationInputGeneration = 0;
  let pageInputGenerations: Record<string, number> = {};
  let pageCursorStacks = $state<Record<string, string[]>>({});

  const operations = $derived(manifest?.operations ?? []);
  const operationViews = $derived(manifest?.interface?.operationViews ?? []);
  function operationView(operation: WorkcoreManifest['operations'][number]) {
    return operationViews.find((view) => view.kind === operation.kind && view.operation === operation.name);
  }
  function operationVariant(operation: WorkcoreManifest['operations'][number], name: string) {
    return operationView(operation)?.variants[name];
  }
  function mutationOperation(name: string) {
    return operations.find((operation): operation is WorkcoreManifest['operations'][number] & { kind: 'mutation' } => operation.kind === 'mutation' && operation.name === name);
  }
  const currentOperation = $derived(operations.find((operation) => operation.kind === selectedOperationKind && operation.name === selectedOperation));
  const currentScheduleTask = $derived(operations.find((operation) => operation.kind === 'task' && operation.name === scheduleTaskOperation));
  const currentVariantName = $derived(selectedVariant || (currentOperation ? operationView(currentOperation)?.default : undefined) || '');
  const currentVariant = $derived(currentOperation ? operationVariant(currentOperation, currentVariantName) : undefined);
  const availableOperationVariants = $derived.by(() => {
    const names = new Set(Object.keys(currentOperation ? operationView(currentOperation)?.variants ?? {} : {}));
    return [...names].map((name) => ({ name, title: (currentOperation ? operationVariant(currentOperation, name)?.title : undefined) ?? (name === 'json' ? 'JSON' : name === 'table' ? 'Table' : name === 'cards' ? 'Cards' : name) }));
  });
  const isTask = $derived(currentOperation?.kind === 'task');
  const currentPage = $derived(pages.find((page) => page.id === section));
  const currentPageHasOperationExecutor = $derived(!!currentPage?.blocks.some((block) => block.type === 'operation-executor'));

  function operationExecutorPageId(): string | undefined {
    return pages.find((page) => page.blocks.some((block) => block.type === 'operation-executor'))?.id;
  }

  function pageBlockKey(pageId: string, blockId: string) { return `${pageId}\u0000${blockId}`; }
  function setCollectionEditorDirty(pageId: string, blockId: string, dirty: boolean) {
    const key = pageBlockKey(pageId, blockId);
    if (Boolean(dirtyCollectionEditors[key]) === dirty) return;
    const next = { ...dirtyCollectionEditors };
    if (dirty) next[key] = true;
    else delete next[key];
    dirtyCollectionEditors = next;
  }

  function confirmPageTransition(nextPageId: string, forceForStateChange = false): boolean {
    if (nextPageId === section && !forceForStateChange) return true;
    const prefix = `${section}\u0000`;
    const dirtyKeys = Object.keys(dirtyCollectionEditors).filter((key) => key.startsWith(prefix));
    if (!dirtyKeys.length) return true;
    if (!window.confirm('Discard unsaved changes?')) return false;
    const next = { ...dirtyCollectionEditors };
    for (const key of dirtyKeys) delete next[key];
    dirtyCollectionEditors = next;
    return true;
  }

  function defaultVariant(operation: WorkcoreManifest['operations'][number], value = manifest): string {
    return value?.interface?.operationViews?.find((view) => view.operation === operation.name && view.kind === operation.kind)?.default
      ?? '';
  }

  function refreshCurrentContent() {
    if (currentPageHasOperationExecutor) {
      if (currentOperation?.kind === 'query') void runSelectedQuery(false);
    } else if (currentPage) void loadPageBlocks();
  }

  function invalidateChatSend() { chatSendGeneration++; chatSending = false; }

  function updateChatQueryCacheNamespace(namespace?: string) {
    const next = namespace === undefined ? createChatQueryCacheNamespace() : `${createChatQueryCacheNamespace()}:${namespace}`;
    clearChatQueryViewCache(queryCacheNamespace);
    queryCacheNamespace = next;
  }

  function invalidatePageRequests() {
    pageNavigationGeneration++;
    for (const source of pageQuerySources.values()) source.dispose();
    pageQuerySources.clear();
    pageQueryStates = {};
    for (const source of pageResourceSources.values()) source.dispose();
    pageResourceSources.clear();
    pageResourceStates = {};
    for (const key of Object.keys(pageChatGenerations)) pageChatGenerations[key] = (pageChatGenerations[key] ?? 0) + 1;
    pageChatSending = {};
    invalidateChatSend();
  }

  function pageContext(key: string, agentResource = false) {
    return captureRequestContext(() => [workspaceRequestGeneration, pageNavigationGeneration, applicationId, workspaceId, currentPage?.id, pageInputGenerations[key] ?? 0, pageQueryInputs[key], JSON.stringify(pageStateValues[currentPage?.id ?? ''] ?? {}), agentResource ? agentRunsGeneration : 0, agentResource ? agentStatusFilter : '', agentResource ? agentNameFilter : '', agentResource ? agentActorFilter : '', agentResource ? agentConversationFilter : '']);
  }

  function changePageState(stateName: string, value: string) {
    const page = currentPage;
    if (!page?.state?.[stateName]) return;
    pageStateValues = { ...pageStateValues, [page.id]: { ...(pageStateValues[page.id] ?? {}), [stateName]: value } };
    resetBoundQueryPagination(page, new Set([stateName]));
    const dependentQueries = page.blocks.filter((block) => block.type === 'query' && Object.values(block.inputBindings ?? {}).some((binding) => binding.state === stateName));
    for (const block of dependentQueries) {
      if (block.type !== 'query') continue;
      const key = pageBlockKey(page.id, block.id);
      pageInputGenerations[key] = (pageInputGenerations[key] ?? 0) + 1;
      pageQuerySources.get(key)?.invalidate();
      if (pageQuerySources.has(key)) publishPageQuerySource(key, pageQuerySources.get(key)!);
      pageCursorStacks[key] = [];
    }
    void Promise.all(dependentQueries.map((block) => block.type === 'query' ? runPageQuery(block) : undefined));
  }

  function resetBoundQueryPagination(page: SemanticManifestPage, stateNames: Set<string>) {
    for (const block of page.blocks) {
      if (block.type !== 'query' || !Object.values(block.inputBindings ?? {}).some((binding) => stateNames.has(binding.state))) continue;
      const key = pageBlockKey(page.id, block.id);
      try {
        const input = parseEditableJson(pageQueryInputs[key] ?? JSON.stringify(block.input ?? {})) as Record<string, unknown>;
        delete input.cursor;
        delete input.direction;
        if (Object.hasOwn(input, 'offset')) input.offset = 0;
        pageQueryInputs[key] = editableJson(input);
      } catch { /* The query input editor will report malformed drafts when run. */ }
      pageCursorStacks[key] = [];
    }
  }

  function pageQuerySource(key: string) {
    let source = pageQuerySources.get(key);
    if (!source) {
      source = new QuerySourceController<unknown>();
      pageQuerySources.set(key, source);
    }
    return source;
  }

  function publishPageQuerySource(key: string, source: QuerySourceController<unknown>) {
    if (pageQuerySources.get(key) === source) pageQueryStates[key] = source.snapshot();
  }

  function pageResourceSource(key: string) {
    let source = pageResourceSources.get(key);
    if (!source) {
      source = new QuerySourceController<unknown>();
      pageResourceSources.set(key, source);
    }
    return source;
  }

  function publishPageResourceSource(key: string, source: QuerySourceController<unknown>) {
    if (pageResourceSources.get(key) === source) pageResourceStates[key] = source.snapshot();
  }

  function editOperationInput(value: string) {
    operationInputGeneration++;
    invalidateChatSend();
    inputText = value;
  }

  function editPageInput(key: string, value: string, resetCursor = true) {
    pageInputGenerations[key] = (pageInputGenerations[key] ?? 0) + 1;
    const source = pageQuerySources.get(key);
    source?.invalidate();
    if (source) pageQueryStates[key] = source.snapshot();
    pageChatGenerations[key] = (pageChatGenerations[key] ?? 0) + 1;
    pageChatSending[key] = false;
    if (resetCursor) pageCursorStacks[key] = [];
    pageQueryInputs[key] = value;
  }

  function resolveSemanticPages(value: WorkcoreManifest): SemanticManifestPage[] {
    const semantic = validateSemanticInterface(value);
    return semantic.pages;
  }

  $effect(() => {
    void loadApplications();
    window.addEventListener('popstate', restoreAddress);
    const onAuthScopeChange = (event: Event) => {
      const requested = event instanceof CustomEvent && typeof event.detail?.namespace === 'string' ? event.detail.namespace : undefined;
      updateChatQueryCacheNamespace(requested);
    };
    window.addEventListener('workcore:auth-scope-change', onAuthScopeChange);
    return () => {
      window.removeEventListener('popstate', restoreAddress);
      window.removeEventListener('workcore:auth-scope-change', onAuthScopeChange);
      unsubscribe?.();
      liveStatus = 'offline';
    };
  });

  async function loadApplications() {
    error = '';
    try {
      applications = await transport.applications();
      if (!applications.some((application) => application.id === applicationId)) applicationId = applications[0]?.id ?? '';
      if (applicationId) await loadWorkspaces();
    } catch (cause) { error = message(cause); }
  }

  async function loadWorkspaces() {
    const generation = ++workspaceRequestGeneration;
    const requestApplicationId = applicationId;
    error = '';
    try {
      const loadedWorkspaces = await transport.workspaces(requestApplicationId);
      if (generation !== workspaceRequestGeneration || applicationId !== requestApplicationId) return;
      workspaces = loadedWorkspaces;
      if (!workspaceId || !workspaces.some((workspace) => workspace.id === workspaceId)) workspaceId = workspaces[0]?.id ?? '';
      if (workspaceId) await selectWorkspace();
    } catch (cause) {
      if (generation === workspaceRequestGeneration && applicationId === requestApplicationId) error = message(cause);
    }
  }

  async function selectApplication() {
    updateChatQueryCacheNamespace();
    invalidateChatSend();
    agentRunsGeneration++;
    agentEventsGeneration++;
    workspaceRequestGeneration++;
    queryGeneration++;
    submissionGeneration++;
    loading = false;
    workspaceId = '';
    manifest = null;
    pages = [];
    result = null;
    await loadWorkspaces();
  }

  async function selectWorkspace() {
    updateChatQueryCacheNamespace();
    invalidateChatSend();
    agentRunsGeneration++;
    agentEventsGeneration++;
    const generation = ++workspaceRequestGeneration;
    queryGeneration++;
    submissionGeneration++;
    loading = false;
    chatSending = false;
    unsubscribe?.();
    liveStatus = 'connecting';
    scheduleDrafts = {};
    manifest = null;
    pages = [];
    dirtyCollectionEditors = {};
    result = null;
    agentRuns = [];
    selectedAgentRun = null;
    agentEvents = [];
    if (!workspaceId) return;
    const requestApplicationId = applicationId;
    const requestWorkspaceId = workspaceId;
    try {
      const responseManifest = await transport.manifest(requestApplicationId, requestWorkspaceId);
      const loadedManifest: WorkcoreManifest = responseManifest;
      if (generation !== workspaceRequestGeneration || applicationId !== requestApplicationId || workspaceId !== requestWorkspaceId) return;
      manifest = loadedManifest;
      pages = resolveSemanticPages(loadedManifest);
      for (const source of pageQuerySources.values()) source.dispose();
      pageQuerySources.clear();
      pageQueryStates = {};
      for (const source of pageResourceSources.values()) source.dispose();
      pageResourceSources.clear();
      pageResourceStates = {};
      pageChatSending = {};
      pageChatGenerations = {};
      pageInputGenerations = {};
      pageCursorStacks = {};
      pageStateValues = Object.fromEntries(pages.filter((page) => page.state).map((page) => [page.id, Object.fromEntries(Object.entries(page.state ?? {}).map(([key, state]) => [key, state.default]))]));
      pageQueryInputs = Object.fromEntries(pages.flatMap((page) => page.blocks.flatMap((block) => {
        if (block.type !== 'query') return [];
        const operation = loadedManifest.operations.find((candidate) => candidate.kind === 'query' && candidate.name === block.operation);
        const initial = block.input ?? (operation ? defaultValue(operation.input) : {});
        return [[pageBlockKey(page.id, block.id), JSON.stringify(initial, null, 2)]];
      })));
      const first = loadedManifest.operations[0];
      selectedOperation = first?.name ?? '';
      selectedOperationKind = first?.kind ?? 'query';
      selectedVariant = first ? defaultVariant(first, loadedManifest) : '';
      const requestedPage = new URLSearchParams(location.search).get('page');
      const semanticDefaultPage = loadedManifest.interface.defaultPage;
      section = pages.some((page) => page.id === requestedPage) ? requestedPage! : pages.some((page) => page.id === semanticDefaultPage) ? semanticDefaultPage! : pages[0]?.id ?? 'operations';
      syncInput(first?.input);
      updateAddress();
      unsubscribe = transport.subscribe(applicationId, workspaceId, {
        onInvalidate: () => {
          if (generation !== workspaceRequestGeneration) return;
          updateChatQueryCacheNamespace();
          refreshCurrentContent();
        },
        onReady: () => { if (generation !== workspaceRequestGeneration) return; liveStatus = 'connected'; refreshCurrentContent(); },
        onReconnect: () => { if (generation !== workspaceRequestGeneration) return; liveStatus = 'connected'; refreshCurrentContent(); },
        onError: (cause) => { if (generation !== workspaceRequestGeneration) return; if (cause.message.includes('reconnecting')) liveStatus = 'reconnecting'; else { liveStatus = 'offline'; error = cause.message; } },
      });
      await loadPageBlocks();
      if (generation !== workspaceRequestGeneration || applicationId !== requestApplicationId || workspaceId !== requestWorkspaceId) return;
      if (first?.kind === 'query') await runOperation(false);
    } catch (cause) {
      if (generation === workspaceRequestGeneration && applicationId === requestApplicationId && workspaceId === requestWorkspaceId) error = message(cause);
    }
  }

  function chooseOperation(name: string, kind: OperationKind) {
    invalidateChatSend();
    queryGeneration++;
    submissionGeneration++;
    loading = false;
    chatSending = false;
    selectedOperation = name;
    selectedOperationKind = kind;
    const operation = operations.find((candidate) => candidate.kind === kind && candidate.name === name);
    selectedVariant = operation ? defaultVariant(operation, manifest) : '';
    syncInput(operation?.input);
    result = null;
    cursorStack = [];
    error = '';
    // Let Svelte flush the selected operation/variant before runOperation reads
    // its derived values; otherwise the first query after switching can be lost.
    if (operation?.kind === 'query') setTimeout(() => void runOperation(false), 0);
  }

  function chooseScheduleTask(name: string) {
    scheduleTaskOperation = name;
    const operation = operations.find((candidate) => candidate.kind === 'task' && candidate.name === name);
    scheduleTaskInputText = JSON.stringify(operation ? defaultValue(operation.input) : {}, null, 2);
  }

  function openScheduleDialog(operation = currentOperation?.kind === 'task' ? currentOperation : undefined) {
    const task = operation ?? operations.find((candidate) => candidate.kind === 'task');
    if (!task) { error = 'No authorized task operation is available to schedule.'; return; }
    chooseScheduleTask(task.name);
    if (operation && selectedOperationKind === 'task' && selectedOperation === operation.name) scheduleTaskInputText = inputText;
    scheduleDialogOpen = true;
  }

  function syncInput(schema?: Record<string, unknown>) {
    const defaults = schema ? defaultValue(schema) : {};
    inputText = JSON.stringify(defaults, null, 2);
  }

  function parseOperationInput(operation: NonNullable<typeof currentOperation>) {
    const value = inputText.trim() ? parseEditableJson(inputText) : {};
    return hydrateRuntimeTypes(value, operation.input);
  }

  async function submitPageMutation(operation: WorkcoreManifest['operations'][number] & { kind: 'mutation' }, input: Record<string, unknown>) {
    const requestApplicationId = applicationId;
    const requestWorkspaceId = workspaceId;
    const requestPage = currentPage?.id;
    const pageGeneration = pageNavigationGeneration;
    const workspaceGeneration = workspaceRequestGeneration;
    await transport.request({ path: 'mutate', applicationId: requestApplicationId, workspaceId: requestWorkspaceId, operation: operation.name, input });
    if (pageGeneration === pageNavigationGeneration && workspaceGeneration === workspaceRequestGeneration && requestPage === currentPage?.id && currentPage) await loadPageBlocks();
  }

  async function runOperation(showPending = true) {
    const operation = currentOperation;
    if (!operation) return;
    if (operation.kind === 'query') return runSelectedQuery(showPending);
    const generation = ++submissionGeneration;
    const submittedApplicationId = applicationId;
    const submittedWorkspaceId = workspaceId;
    const submittedOperation = operation.name;
    const isCurrent = captureRequestContext(() => [submissionGeneration, workspaceRequestGeneration, pageNavigationGeneration, operationInputGeneration, applicationId, workspaceId, selectedOperationKind, selectedOperation, inputText]);
    error = '';
    if (showPending) loading = true;
    try {
      const input = parseOperationInput(operation);
      const value = operation.kind === 'mutation'
        ? await transport.request({ path: 'mutate', applicationId: submittedApplicationId, workspaceId: submittedWorkspaceId, operation: submittedOperation, input })
        : await transport.request({ path: 'enqueue', applicationId: submittedApplicationId, workspaceId: submittedWorkspaceId, operation: submittedOperation, input });
      if (isCurrent()) {
        result = value;
        if (currentPage) await loadPageBlocks();
      }
    } catch (cause) { if (isCurrent()) error = message(cause); }
    finally { if (generation === submissionGeneration) loading = false; }
  }

  async function runSelectedQuery(showPending: boolean) {
    const operation = currentOperation;
    if (!operation || operation.kind !== 'query') return;
    const generation = ++queryGeneration;
    const operationName = operation.name;
    const requestApplicationId = applicationId;
    const requestWorkspaceId = workspaceId;
    const isCurrent = captureRequestContext(() => [queryGeneration, workspaceRequestGeneration, pageNavigationGeneration, operationInputGeneration, selectedOperationKind, selectedOperation, selectedVariant, inputText]);
    error = '';
    if (showPending) loading = true;
    try {
      const input = parseOperationInput(operation);
      const value = await transport.request({ path: 'query', applicationId: requestApplicationId, workspaceId: requestWorkspaceId, operation: operationName, input });
      if (isCurrent()) result = value;
    } catch (cause) {
      if (isCurrent()) error = message(cause);
    } finally {
      if (generation === queryGeneration) loading = false;
    }
  }

  async function loadAgentRuns(cursor?: string) {
    agentRunsGeneration++;
    const block = currentPage?.blocks.find((candidate) => candidate.type === 'resource' && candidate.resource === 'agents');
    if (block?.type === 'resource') await runPageResource(block, cursor);
  }

  async function chooseAgentRun(run: AgentRun | null) {
    const generation = ++agentEventsGeneration;
    selectedAgentRun = run;
    agentEvents = [];
    agentEventsCursor = null;
    if (!run) return;
    try {
      const page = await loadAgentRunEvents(transport, applicationId, workspaceId, run.id, undefined, 100);
      if (generation === agentEventsGeneration && selectedAgentRun?.id === run.id) { agentEvents = page.events; agentEventsCursor = page.nextCursor; }
    } catch (cause) { if (generation === agentEventsGeneration) error = message(cause); }
  }

  async function loadMoreAgentEvents() {
    const run = selectedAgentRun;
    if (!run || !agentEventsCursor) return;
    const generation = agentEventsGeneration;
    try {
      const page = await loadAgentRunEvents(transport, applicationId, workspaceId, run.id, Number(agentEventsCursor), 100);
      if (generation === agentEventsGeneration && selectedAgentRun?.id === run.id) { agentEvents = [...agentEvents, ...page.events]; agentEventsCursor = page.nextCursor; }
    } catch (cause) { if (generation === agentEventsGeneration) error = message(cause); }
  }

  async function applyAgentFilters() {
    selectedAgentRun = null;
    agentEvents = [];
    agentRunCursor = null;
    await loadAgentRuns();
  }

  function changeAgentFilter(field: 'agent' | 'status' | 'actorId' | 'conversationId', value: string) {
    if (field === 'agent') agentNameFilter = value;
    else if (field === 'status') {
      if (value === '' || value === 'queued' || value === 'running' || value === 'succeeded' || value === 'failed' || value === 'interrupted') agentStatusFilter = value;
    }
    else if (field === 'actorId') agentActorFilter = value;
    else agentConversationFilter = value;
  }

  async function sendChatMessage(text: string) {
    const operation = currentOperation;
    const requestApplicationId = applicationId;
    const requestWorkspaceId = workspaceId;
    const chat = currentVariant && ['chat', 'chat-messages', 'chat-thread'].includes(currentVariant.renderer) ? currentVariant.chat : undefined;
    if (!operation || operation.kind !== 'query' || !chat?.sendMutation || !chat.messageInput || !text.trim() || chatSending) return;
    const generation = ++chatSendGeneration;
    const mutation = operations.find((candidate) => candidate.kind === 'mutation' && candidate.name === chat.sendMutation);
    if (!mutation) throw new Error(`Chat send mutation '${chat.sendMutation}' is unavailable.`);
    const isCurrent = captureRequestContext(() => [workspaceRequestGeneration, pageNavigationGeneration, chatSendGeneration, operationInputGeneration, applicationId, workspaceId, selectedOperation, selectedOperationKind, selectedVariant, inputText]);
    const conversationId = pathValue(result, chat.conversationIdPath ?? 'conversation.id');
    const mutationInput = chatMutationInput({ ...chat, messageInput: chat.messageInput }, text, conversationId, result);
    chatSending = true;
    error = '';
    try {
      const sendResult = await transport.request({ path: 'mutate', applicationId: requestApplicationId, workspaceId: requestWorkspaceId, operation: mutation.name, input: mutationInput });
      if (!isCurrent()) return;
      chatFollowToken++;
      const nextConversationId = conversationId ?? pathValue(sendResult, chat.conversationIdResultPath ?? 'conversationId');
      if (chat.conversationQueryInput && nextConversationId !== undefined && nextConversationId !== null) {
        const queryInput = currentInput();
        queryInput[chat.conversationQueryInput] = nextConversationId;
        inputText = editableJson(queryInput);
      }
      await runSelectedQuery(true);
    } catch (cause) { if (isCurrent()) error = message(cause); throw cause; }
    finally { if (generation === chatSendGeneration) chatSending = false; }
  }

  async function loadChatQueryView(queryName: string, viewName: string | undefined, rawInput: unknown): Promise<unknown> {
    const operation = operations.find((candidate) => candidate.kind === 'query' && candidate.name === queryName);
    if (!operation) throw new Error(`Query view '${queryName}' is not available to this actor.`);
    const views = operationView(operation);
    const selectedName = viewName ?? views?.default;
    const presentation = selectedName ? views?.variants[selectedName] : undefined;
    if (!presentation) throw new Error(`View '${selectedName ?? ''}' is not available on query '${queryName}'.`);
    if (!['table', 'json', 'chart'].includes(presentation.renderer)) throw new Error(`Query view '${queryName}.${selectedName}' does not use an embeddable table, chart, or JSON renderer.`);
    if (!rawInput || typeof rawInput !== 'object' || Array.isArray(rawInput)) throw new Error('Query-view inputs must be an object.');
    const value = await transport.request({ path: 'query', applicationId, workspaceId, operation: queryName, input: rawInput as Record<string, unknown> });
    return { result: value, presentation };
  }

  function openChatThread(thread: ChatThread, sourceVariant = currentVariant) {
    const targetName = sourceVariant?.chatList?.threadQuery;
    const target = targetName && operations.find((candidate) => candidate.kind === 'query' && candidate.name === targetName);
    if (!target) { error = 'This thread list does not configure a chat detail query.'; return; }
    const executorPage = operationExecutorPageId();
    if (executorPage) {
      if (!choosePage(executorPage)) return;
    } else section = 'operations';
    chooseOperation(target.name, 'query');
    selectedVariant = sourceVariant?.chatList?.detailVariant ?? operationView(target)?.default ?? '';
    const input = defaultValue(target.input) as Record<string, unknown>;
    input[sourceVariant?.chatList?.threadIdInput ?? 'threadId'] = thread.id;
    inputText = editableJson(input);
    result = null;
    error = '';
    setTimeout(() => void runSelectedQuery(true), 0);
  }

  function searchOperationThreads(value: string) {
    const input = currentInput();
    delete input.cursor;
    delete input.direction;
    input[currentVariant?.chatList?.searchInput ?? 'search'] = value;
    inputText = editableJson(input);
    void runSelectedQuery(true);
  }

  async function loadOperationMoreThreads(cursor: string) {
    const input = currentInput();
    input.cursor = cursor;
    input.direction = 'forward';
    const value = await transport.request({ path: 'query', applicationId, workspaceId, operation: selectedOperation, input });
    return { items: getChatThreads(value), nextCursor: getNextCursor(value) };
  }

  function openPageChatThread(block: Extract<AdminBlock, { type: 'query' }>, thread: ChatThread) {
    const operation = operations.find((candidate) => candidate.kind === 'query' && candidate.name === block.operation);
    const sourceVariant = operation && operationVariant(operation, block.variant ?? operationView(operation)?.default ?? '');
    openChatThread(thread, sourceVariant);
  }

  function searchPageThreads(block: Extract<AdminBlock, { type: 'query' }>, value: string) {
    const page = currentPage;
    if (!page) return;
    const key = pageBlockKey(page.id, block.id);
    const operation = operations.find((candidate) => candidate.kind === 'query' && candidate.name === block.operation);
    const variant = operation && operationVariant(operation, block.variant ?? operationView(operation)?.default ?? '');
    const input = parseEditableJson(pageQueryInputs[key] ?? '{}') as Record<string, unknown>;
    delete input.cursor;
    delete input.direction;
    input[variant?.chatList?.searchInput ?? 'search'] = value;
    pageQueryInputs[key] = editableJson(input);
    void runPageQuery(block);
  }

  async function loadPageMoreThreads(block: Extract<AdminBlock, { type: 'query' }>, cursor: string) {
    const page = currentPage;
    if (!page) throw new Error('This page is no longer active.');
    const key = pageBlockKey(page.id, block.id);
    const operation = operations.find((candidate) => candidate.kind === 'query' && candidate.name === block.operation);
    if (!operation) throw new Error(`Query '${block.operation}' is unavailable.`);
    const input = hydrateRuntimeTypes(parseEditableJson(pageQueryInputs[key] ?? '{}'), operation.input) as Record<string, unknown>;
    applyPageStateBindings(page, block, input);
    input.cursor = cursor;
    input.direction = 'forward';
    const value = await transport.request({ path: 'query', applicationId, workspaceId, operation: block.operation, input });
    return { items: getChatThreads(value), nextCursor: getNextCursor(value) };
  }

  function navigateFromChat(pageId: string, stateValues: Record<string, string>) {
    try { choosePage(validateChatNavigation(pages, pageId, stateValues).pageId, stateValues); }
    catch (cause) { error = message(cause); }
  }

  async function loadPageBlocks() {
    const page = currentPage;
    if (!page || !workspaceId) return;
    await Promise.all(page.blocks.map((block) => block.type === 'query' ? runPageQuery(block) : block.type === 'resource' ? runPageResource(block) : undefined));
  }

  async function runPageQuery(block: Extract<AdminBlock, { type: 'query' }>) {
    const page = currentPage;
    if (!page || !workspaceId) return;
    const key = pageBlockKey(page.id, block.id);
    const requestApplicationId = applicationId;
    const requestWorkspaceId = workspaceId;
    const contextIsCurrent = pageContext(key);
    const source = pageQuerySource(key);
    const request = source.run(async () => {
      const operation = operations.find((candidate) => candidate.kind === 'query' && candidate.name === block.operation);
      if (!operation) throw new Error(`Query '${block.operation}' is unavailable.`);
       const input = parseEditableJson(pageQueryInputs[key] ?? JSON.stringify(block.input ?? {})) as Record<string, unknown>;
        applyPageStateBindings(page, block, input);
        const validatedInput = hydrateRuntimeTypes(input, operation.input);
       return transport.request({ path: 'query', applicationId: requestApplicationId, workspaceId: requestWorkspaceId, operation: block.operation, input: validatedInput });
    }, contextIsCurrent);
    publishPageQuerySource(key, source);
    await request;
    publishPageQuerySource(key, source);
  }

  function applyPageStateBindings(page: SemanticManifestPage, block: Extract<AdminBlock, { type: 'query' }>, input: Record<string, unknown>) {
    for (const [target, binding] of Object.entries(block.inputBindings ?? {})) {
      const state = page.state?.[binding.state];
      const value = pageStateValues[page.id]?.[binding.state] ?? state?.default ?? '';
      if (state?.type === 'select' && value === '') delete input[target];
      else input[target] = value;
    }
  }

  async function runPageResource(block: Extract<AdminBlock, { type: 'resource' }>, cursor?: string) {
    const page = currentPage;
    if (!page || !workspaceId) return;
    const key = pageBlockKey(page.id, block.id);
    const requestApplicationId = applicationId;
    const requestWorkspaceId = workspaceId;
    const source = pageResourceSource(key);
    let loadedAgentPage: { runs: AgentRun[]; nextCursor: string | null } | undefined;
    const contextIsCurrent = pageContext(key, block.resource === 'agents');
    const request = source.run(async () => {
      const loaded = await loadPlatformResource(transport, requestApplicationId, requestWorkspaceId, block.resource, {
        ...(cursor ? { cursor } : {}),
        filters: { status: agentStatusFilter, agent: agentNameFilter, actorId: agentActorFilter, conversationId: agentConversationFilter },
        previousRuns: agentRuns,
      });
      loadedAgentPage = loaded.agentPage;
      return loaded.result;
    }, contextIsCurrent);
    publishPageResourceSource(key, source);
    const succeeded = await request;
    if (succeeded && contextIsCurrent() && block.resource === 'agents' && loadedAgentPage) {
      agentRuns = loadedAgentPage.runs;
      agentRunCursor = loadedAgentPage.nextCursor;
      const focusedRun = agentRuns.find((run) => run.id === selectedAgentRun?.id) ?? agentRuns[0] ?? null;
      if (focusedRun) void chooseAgentRun(focusedRun);
      else { selectedAgentRun = null; agentEvents = []; }
    }
    publishPageResourceSource(key, source);
  }

  function pageCustomQuery(block: Extract<AdminBlock, { type: 'query' }>, pagination?: { cursor?: string; offset?: number }) {
    const page = currentPage;
    if (!page) return;
    const key = pageBlockKey(page.id, block.id);
    const input = parseEditableJson(pageQueryInputs[key] ?? JSON.stringify(block.input ?? {})) as Record<string, unknown>;
    if (pagination && Object.hasOwn(pagination, 'offset')) {
      input.offset = Math.max(0, pagination.offset ?? 0);
      delete input.cursor;
      pageCursorStacks[key] = [];
    } else if (pagination?.cursor) {
      pageCursorStacks[key] = [...(pageCursorStacks[key] ?? []), String(input.cursor ?? '')];
      input.cursor = pagination.cursor;
    } else {
      const stack = pageCursorStacks[key] ?? [];
      const previous = stack.at(-1) ?? '';
      pageCursorStacks[key] = stack.slice(0, -1);
      if (previous) input.cursor = previous;
      else delete input.cursor;
    }
    editPageInput(key, editableJson(input), false);
    void runPageQuery(block);
  }

  function pageCollectionFilter(block: Extract<AdminBlock, { type: 'query' }>, targetParam: string, value: unknown) {
    const page = currentPage;
    if (!page) return;
    const key = pageBlockKey(page.id, block.id);
    let input: Record<string, unknown>;
    try { input = parseEditableJson(pageQueryInputs[key] ?? JSON.stringify(block.input ?? {})) as Record<string, unknown>; }
    catch { input = { ...(block.input ?? {}) }; }
    if (value === undefined) delete input[targetParam];
    else input[targetParam] = value;
    delete input.cursor;
    delete input.offset;
    pageCursorStacks[key] = [];
    editPageInput(key, editableJson(input));
    void runPageQuery(block);
  }

  function operationCollectionFilter(targetParam: string, value: unknown) {
    let input: Record<string, unknown>;
    try { input = parseEditableJson(inputText) as Record<string, unknown>; }
    catch { input = {}; }
    if (value === undefined) delete input[targetParam];
    else input[targetParam] = value;
    delete input.cursor;
    delete input.offset;
    cursorStack = [];
    editOperationInput(editableJson(input));
    void runOperation(false);
  }

  async function saveOperationCollection(collection: CollectionViewOptions, input: Record<string, unknown>) {
    const operationName = collection.editor?.mutation;
    const queryName = currentOperation?.kind === 'query' ? currentOperation.name : undefined;
    if (!operationName || !workspaceId || !queryName) throw new Error('This collection editor is no longer available.');
    const operation = operations.find((candidate) => candidate.kind === 'mutation' && candidate.name === operationName);
    if (!operation) throw new Error('This collection editor is not authorized.');
    const requestApplicationId = applicationId;
    const requestWorkspaceId = workspaceId;
    await transport.request({ path: 'mutate', applicationId: requestApplicationId, workspaceId: requestWorkspaceId, operation: operationName, input: hydrateRuntimeTypes(input, operation.input) });
    if (applicationId === requestApplicationId && workspaceId === requestWorkspaceId && selectedOperation === queryName) await runOperation(false);
  }

  async function savePageCollection(block: Extract<AdminBlock, { type: 'query' }>, collection: CollectionViewOptions | undefined, input: Record<string, unknown>) {
    const page = currentPage;
    const editor = collection?.editor;
    if (!page || !editor || !workspaceId) throw new Error('This collection editor is no longer available.');
    const operation = operations.find((candidate) => candidate.kind === 'mutation' && candidate.name === editor.mutation);
    if (!operation) throw new Error('This collection editor is not authorized.');
    const requestApplicationId = applicationId;
    const requestWorkspaceId = workspaceId;
    const hydrated = hydrateRuntimeTypes(input, operation.input);
    await transport.request({ path: 'mutate', applicationId: requestApplicationId, workspaceId: requestWorkspaceId, operation: editor.mutation, input: hydrated });
    if (currentPage?.id !== page.id || applicationId !== requestApplicationId || workspaceId !== requestWorkspaceId) return;
    await runPageQuery(block);
  }

  async function loadPageOlderMessages(block: Extract<AdminBlock, { type: 'query' }>, cursor: string) {
    const page = currentPage;
    if (!page || !workspaceId) throw new Error('This page is no longer active.');
    const key = pageBlockKey(page.id, block.id);
    const requestApplicationId = applicationId;
    const requestWorkspaceId = workspaceId;
    const isCurrent = pageContext(key);
    const requestInputText = pageQueryInputs[key] ?? JSON.stringify(block.input ?? {});
    const operation = operations.find((candidate) => candidate.kind === 'query' && candidate.name === block.operation);
    if (!operation) throw new Error(`Query '${block.operation}' is unavailable.`);
    const input = hydrateRuntimeTypes(parseEditableJson(requestInputText), operation.input);
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Chat query input must be an object.');
    applyPageStateBindings(page, block, input as Record<string, unknown>);
    const olderInput = { ...input as Record<string, unknown>, cursor, direction: 'backward' };
    const value = await transport.request({ path: 'query', applicationId: requestApplicationId, workspaceId: requestWorkspaceId, operation: block.operation, input: olderInput });
    if (!isCurrent()) throw new Error('This page changed while loading messages.');
    return { items: getChatMessages(value), previousCursor: getPreviousCursor(value) };
  }

  async function sendPageChatMessage(block: Extract<AdminBlock, { type: 'query' }>, messageText: string) {
    const page = currentPage;
    if (!page) throw new Error('This page is no longer active.');
    const key = pageBlockKey(page.id, block.id);
    if (pageChatSending[key] || !messageText.trim()) return;
    const generation = (pageChatGenerations[key] ?? 0) + 1;
    pageChatGenerations[key] = generation;
    const requestApplicationId = applicationId;
    const requestWorkspaceId = workspaceId;
    const contextIsCurrent = pageContext(key);
    const requestWorkspaceGeneration = workspaceRequestGeneration;
    const isCurrent = () => contextIsCurrent() && pageChatGenerations[key] === generation;
    const operation = operations.find((candidate) => candidate.kind === 'query' && candidate.name === block.operation);
    const variant = operation && operationVariant(operation, block.variant ?? operationView(operation)?.default ?? '');
    const chat = variant && ['chat', 'chat-messages', 'chat-thread'].includes(variant.renderer) ? variant.chat : undefined;
    const mutation = chat?.sendMutation && operations.find((candidate) => candidate.kind === 'mutation' && candidate.name === chat.sendMutation);
    if (!operation || !chat?.messageInput || !mutation) throw new Error('This chat is not available to your account.');
    const currentResult = pageQueryStates[key]?.result;
    const conversationId = pathValue(currentResult, chat.conversationIdPath ?? 'conversation.id');
    const source = pageQuerySource(key);
    source.invalidate();
    pageQueryStates[key] = source.snapshot();
    pageChatSending[key] = true;
    try {
      const input = chatMutationInput({ ...chat, messageInput: chat.messageInput }, messageText, conversationId, currentResult);
      const sendResult = await transport.request({ path: 'mutate', applicationId: requestApplicationId, workspaceId: requestWorkspaceId, operation: mutation.name, input });
      if (!isCurrent()) return;
      pageChatFollowTokens[key] = (pageChatFollowTokens[key] ?? 0) + 1;
      const nextConversationId = conversationId ?? pathValue(sendResult, chat.conversationIdResultPath ?? 'conversationId');
      if (chat.conversationQueryInput && typeof nextConversationId === 'string') {
        const queryInput = parseEditableJson(pageQueryInputs[key] ?? '{}') as Record<string, unknown>;
        queryInput[chat.conversationQueryInput] = nextConversationId;
        pageQueryInputs[key] = editableJson(queryInput);
      }
      await runPageQuery(block);
    } catch (cause) {
      if (isCurrent()) {
        source.setError(cause);
        pageQueryStates[key] = source.snapshot();
      }
      throw cause;
    } finally {
      if (workspaceRequestGeneration === requestWorkspaceGeneration && pageChatGenerations[key] === generation) {
        pageChatSending[key] = false;
      }
    }
  }

  async function loadOperationOlderMessages(cursor: string) {
    const isCurrent = captureRequestContext(() => [workspaceRequestGeneration, pageNavigationGeneration, operationInputGeneration, selectedOperation, selectedOperationKind, selectedVariant, inputText]);
    const input = currentInput();
    input.cursor = cursor;
    input.direction = 'backward';
    const value = await transport.request({ path: 'query', applicationId, workspaceId, operation: selectedOperation, input });
    if (!isCurrent()) throw new Error('This query changed while loading messages.');
    return { items: getChatMessages(value), previousCursor: getPreviousCursor(value) };
  }

  function choosePage(id: string, stateUpdates?: Record<string, string>): boolean {
    if (!confirmPageTransition(id, !!stateUpdates && Object.keys(stateUpdates).length > 0)) return false;
    if (!pages.some((page) => page.id === id)) return false;
    invalidatePageRequests();
    if (stateUpdates) {
      pageStateValues = { ...pageStateValues, [id]: { ...(pageStateValues[id] ?? {}), ...stateUpdates } };
      const targetPage = pages.find((page) => page.id === id);
      if (targetPage) resetBoundQueryPagination(targetPage, new Set(Object.keys(stateUpdates)));
    }
    section = id;
    const url = new URL(location.href);
    url.searchParams.set('applicationId', applicationId);
    url.searchParams.set('workspaceId', workspaceId);
    url.searchParams.set('page', id);
    window.history.pushState({}, '', url);
    if (pages.some((page) => page.id === id)) void loadPageBlocks();
    return true;
  }

  async function restoreAddress() {
    const params = new URLSearchParams(location.search);
    const nextApplicationId = params.get('applicationId') ?? applicationId;
    const nextWorkspaceId = params.get('workspaceId') ?? '';
    if (nextApplicationId !== applicationId) {
      applicationId = nextApplicationId;
      workspaceId = nextWorkspaceId;
      await loadWorkspaces();
      return;
    }
    if (nextWorkspaceId !== workspaceId) {
      workspaceId = nextWorkspaceId;
      await selectWorkspace();
      return;
    }
    const nextPage = params.get('page');
    if (nextPage && pages.some((page) => page.id === nextPage)) choosePageFromHistory(nextPage);
  }

  function choosePageFromHistory(id: string) {
    if (!confirmPageTransition(id)) {
      restoreCurrentAddress();
      return;
    }
    invalidatePageRequests();
    section = id;
    if (pages.some((page) => page.id === id)) void loadPageBlocks();
  }

  function openBlockOperation(name: string, kind: OperationKind, variant?: string) {
    const executorPage = operationExecutorPageId();
    if (!executorPage) { error = 'No operation executor page is available.'; return; }
    if (!choosePage(executorPage)) return;
    chooseOperation(name, kind);
    if (variant) selectedVariant = variant;
  }

  async function createSchedule() {
    if (!currentScheduleTask) return;
    try {
      if (scheduleKind === 'once' && (!scheduleRunAt || !Number.isFinite(Date.parse(scheduleRunAt)))) throw new Error('Choose a valid future run time.');
      const task = currentScheduleTask;
      if (!task) throw new Error('Choose an available task to schedule.');
      const input = hydrateRuntimeTypes(scheduleTaskInputText.trim() ? parseEditableJson(scheduleTaskInputText) : {}, task.input);
      const scheduleInput: ScheduleCreateInput = scheduleKind === 'once'
        ? { operation: task.name, input, kind: 'once', runAt: new Date(scheduleRunAt).toISOString(), timezone: scheduleTimezone }
        : { operation: task.name, input, kind: 'recurring', cron: scheduleCron, timezone: scheduleTimezone };
      await createPlatformSchedule(transport, applicationId, workspaceId, scheduleInput);
      scheduleDialogOpen = false;
      section = 'schedules';
      await loadPageBlocks();
    } catch (cause) { error = message(cause); }
  }

  async function deleteSchedule(id: unknown) {
    try {
      await deletePlatformSchedule(transport, applicationId, workspaceId, String(id));
      await loadPageBlocks();
    } catch (cause) { error = message(cause); }
  }

  async function toggleSchedule(schedule: Record<string, unknown>) {
    try {
      await updatePlatformSchedule(transport, applicationId, workspaceId, String(schedule.id), { enabled: !schedule.enabled });
      await loadPageBlocks();
    } catch (cause) { error = message(cause); }
  }
  async function saveSchedule(schedule: Record<string, unknown>) {
    try {
      const draft = scheduleDrafts[String(schedule.id)] ?? {};
      const patch = { ...(schedule.kind === 'recurring' ? { cron: draft.cron ?? String(schedule.cron ?? '') } : {}), timezone: draft.timezone ?? String(schedule.timezone ?? 'UTC') };
      await updatePlatformSchedule(transport, applicationId, workspaceId, String(schedule.id), patch);
      delete scheduleDrafts[String(schedule.id)];
      await loadPageBlocks();
    } catch (cause) { error = message(cause); }
  }

  function useVariant(name: string) { invalidateChatSend(); selectedVariant = name; }
  function isPage(value: unknown): value is { rows: Array<Record<string, unknown>>; nextCursor: string | null; totalCount?: number } {
    return !!value && typeof value === 'object' && Array.isArray((value as { rows?: unknown }).rows);
  }
  function rowColumns(row: Record<string, unknown>) {
    return currentVariant?.columns?.length ? currentVariant.columns : Object.keys(row);
  }
  function setField(key: string, value: unknown) {
    try { const parsed = (parseEditableJson(inputText || '{}') ?? {}) as Record<string, unknown>; parsed[key] = value; inputText = editableJson(parsed); }
    catch { inputText = JSON.stringify({ [key]: value }, null, 2); }
  }
  function currentInput() {
    try { return parseEditableJson(inputText) as Record<string, unknown>; } catch { return {}; }
  }
  function matchesInputSchema(value: unknown, schema: Record<string, unknown>): boolean {
    if (value === null) return schema.type === 'null' || (Array.isArray(schema.type) && schema.type.includes('null'));
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (value instanceof Date) return types.includes('string') && schema.format === 'date-time';
    return types.some((type) => type === 'string' ? typeof value === 'string'
      : type === 'number' ? typeof value === 'number' && Number.isFinite(value)
        : type === 'integer' ? typeof value === 'number' && Number.isInteger(value)
          : type === 'boolean' ? typeof value === 'boolean'
            : type === 'array' ? Array.isArray(value)
              : type === 'object' ? !!value && typeof value === 'object' && !Array.isArray(value)
                : false);
  }
  function editRow(row: Record<string, unknown>, action: NonNullable<NonNullable<OperationViews['variants'][string]>['actions']>[number]) {
    const mutationOperation = operations.find((operation) => operation.name === action.mutation && operation.kind === 'mutation');
    if (!mutationOperation) { error = `Unknown row action mutation: ${action.mutation}`; return; }
    chooseOperation(mutationOperation.name, 'mutation');
    selectedVariant = action.variant ?? operationView(mutationOperation)?.default ?? '';
    const bound: Record<string, unknown> = {};
    for (const [inputKey, binding] of Object.entries(action.bind ?? {})) {
      const value = getCollectionFieldValue(row, binding.fromRow);
      if (value !== undefined) bound[inputKey] = value;
    }
    const properties = mutationOperation.input.properties as Record<string, Record<string, unknown>> | undefined;
    for (const [key, schema] of Object.entries(properties ?? {})) {
      if (!Object.hasOwn(bound, key) && Object.hasOwn(row, key) && matchesInputSchema(row[key], schema)) bound[key] = row[key];
    }
    for (const [key, schema] of Object.entries(properties ?? {})) {
      if (!(key in bound) && ((mutationOperation.input.required as string[] | undefined) ?? []).includes(key)) bound[key] = defaultValue(schema);
    }
    try { inputText = editableJson(bound); }
    catch (cause) { error = `Could not prepare editable row input: ${message(cause)}`; return; }
    result = null;
    error = '';
  }
  function openChatAction(action: ChatAction, mapping: ChatActionMapping) {
    if (action.disabled) return;
    if (action.confirm && !window.confirm(action.confirm)) return;
    const mutationOperation = operations.find((operation) => operation.name === mapping.mutation && operation.kind === 'mutation');
    if (!mutationOperation) { error = `Configured chat mutation '${mapping.mutation}' is unavailable.`; return; }
    const source = action.input && typeof action.input === 'object' && !Array.isArray(action.input) ? action.input as Record<string, unknown> : {};
    const bound: Record<string, unknown> = {};
    for (const [inputKey, binding] of Object.entries(mapping.bind ?? {})) {
      const value = pathValue(source, binding.fromAction);
      if (value !== undefined) bound[inputKey] = value;
    }
    const properties = mutationOperation.input.properties as Record<string, Record<string, unknown>> | undefined;
    for (const [key, schema] of Object.entries(properties ?? {})) {
      if (!(key in bound) && ((mutationOperation.input.required as string[] | undefined) ?? []).includes(key)) bound[key] = defaultValue(schema);
    }
    let prepared: string;
    try { prepared = editableJson(bound); }
    catch (cause) { error = `Could not prepare chat action input: ${message(cause)}`; return; }
    const executorPage = operationExecutorPageId();
    if (!executorPage) { error = 'No operation executor page is available.'; return; }
    if (!choosePage(executorPage)) return;
    chooseOperation(mutationOperation.name, 'mutation');
    inputText = prepared;
    selectedVariant = mapping.variant ?? operationView(mutationOperation)?.default ?? '';
    result = null;
    error = '';
    section = executorPage;
  }
  function updateAddress() {
    const url = new URL(location.href);
    url.searchParams.set('applicationId', applicationId);
    url.searchParams.set('workspaceId', workspaceId);
    url.searchParams.set('page', section);
    window.history.replaceState({}, '', url);
  }
  function restoreCurrentAddress() {
    const url = new URL(location.href);
    url.searchParams.set('applicationId', applicationId);
    url.searchParams.set('workspaceId', workspaceId);
    url.searchParams.set('page', section);
    window.history.pushState({}, '', url);
  }
  function defaultValue(schema: Record<string, unknown>): unknown {
    if ('default' in schema) return schema.default;
    if (schema.type === 'object') {
      const properties = schema.properties as Record<string, Record<string, unknown>> | undefined;
      return Object.fromEntries(Object.entries(properties ?? {}).filter(([key, child]) => ((schema.required as string[] | undefined) ?? []).includes(key) || 'default' in child).map(([key, child]) => [key, defaultValue(child)]));
    }
    if (schema.type === 'array') return [];
    if (schema.enum) return (schema.enum as unknown[])[0];
    if (schema.type === 'boolean') return false;
    if (schema.type === 'number' || schema.type === 'integer') return 0;
    return '';
  }
  function message(cause: unknown) { return cause instanceof Error ? cause.message : String(cause); }
  function nextPage() {
    if (!isPage(result) || !result.nextCursor) return;
    cursorStack = [...cursorStack, String(currentInput().cursor ?? '')];
    setField('cursor', result.nextCursor);
    void runOperation();
  }
  function previousPage() {
    if (!cursorStack.length) return;
    const previous = cursorStack.at(-1) ?? '';
    cursorStack = cursorStack.slice(0, -1);
    const input = currentInput();
    if (previous) input.cursor = previous; else delete input.cursor;
    inputText = editableJson(input);
    void runOperation();
  }
  function operationCollectionPage(pagination?: { cursor?: string; offset?: number }) {
    const input = currentInput();
    if (pagination && Object.hasOwn(pagination, 'offset')) {
      input.offset = Math.max(0, pagination.offset ?? 0);
      delete input.cursor;
      cursorStack = [];
    } else if (pagination?.cursor) {
      cursorStack = [...cursorStack, String(input.cursor ?? '')];
      input.cursor = pagination.cursor;
    } else {
      const previous = cursorStack.at(-1) ?? '';
      cursorStack = cursorStack.slice(0, -1);
      if (previous) input.cursor = previous; else delete input.cursor;
    }
    inputText = editableJson(input);
    void runOperation();
  }
  function operationOffsetPage(offset: number) {
    operationCollectionPage({ offset });
  }
</script>

<svelte:head><title>Workcore Admin</title><meta name="description" content="Workspace operations and live data" /></svelte:head>

<div class="shell">
  <aside class="sidebar">
    <a class="brand" href={config.basePath ?? '/workcore/admin'}><span class="brand-mark">w</span><span>workcore<span class="brand-admin">/ admin</span></span></a>
    <div class="side-label">APPLICATION</div>
    <label class="select-wrap"><span class="sr-only">Application</span><select bind:value={applicationId} onchange={selectApplication} disabled={!applications.length}>{#each applications as application}<option value={application.id}>{application.id}</option>{/each}</select><span class="chevron">⌄</span></label>
    <div class="side-label">WORKSPACE</div>
    <label class="select-wrap"><span class="sr-only">Workspace</span><select bind:value={workspaceId} onchange={selectWorkspace} disabled={!workspaces.length}><option value="" disabled>Select workspace</option>{#each workspaces as workspace}<option value={workspace.id}>{workspace.name}</option>{/each}</select><span class="chevron">⌄</span></label>
    <div class="side-label nav-label">WORKSPACE</div>
    <nav>
      {#each pages as page}
         <button class:active={section === page.id} onclick={() => choosePage(page.id)}><span>{page.id === 'operations' ? '◫' : page.id === 'tasks' ? '◷' : page.id === 'schedules' ? '▤' : page.id === 'history' ? '◴' : page.id === 'agents' ? '✳' : '▧'}</span><span>{page.title}</span></button>
      {/each}
    </nav>
    <div class="sidebar-bottom"><span class="connection-dot" class:reconnecting={liveStatus === 'reconnecting'} class:offline={liveStatus === 'offline'}></span>{liveStatus === 'connected' ? 'Connected' : liveStatus === 'connecting' ? 'Connecting…' : liveStatus === 'reconnecting' ? 'Reconnecting…' : 'Offline'} <span class="version">v2 semantic UI</span></div>
  </aside>

  <main class="main">
    <header class="topbar"><div><span class="breadcrumb">{applicationId}</span><span class="slash">/</span><span>{workspaceId || 'No workspace'}</span></div><span class="avatar">{workspaceId.slice(0, 1).toUpperCase() || 'W'}</span></header>
    <div class="mobile-page-nav">
      <label for="mobile-page-select">PAGE</label>
      <select id="mobile-page-select" aria-label="Admin page" value={section} onchange={(event) => choosePage(event.currentTarget.value)} disabled={!pages.length}>
        {#each pages as page}<option value={page.id}>{page.title}</option>{/each}
      </select>
    </div>
    <div class="content">
      {#if error}<div class="alert"><span>Something needs attention</span><p>{error}</p><button onclick={() => error = ''} aria-label="Dismiss">×</button></div>{/if}
      {#if !workspaces.length && !error}<div class="empty"><h1>No workspace access</h1><p>Sign in with an account that belongs to a Workcore workspace.</p></div>
      {:else if currentPage}
        <div class="page-heading"><div><div class="eyebrow">{currentPage.builtin ? 'BUILT-IN PAGE' : 'WORKSPACE PAGE'}</div><h1>{currentPage.title}</h1><p>{currentPage.description ?? ''}</p></div>{#if currentPageHasOperationExecutor}<span class="live-pill" class:offline={liveStatus === 'offline'} class:reconnecting={liveStatus === 'reconnecting'}><span></span> {liveStatus === 'connected' ? 'Live updates' : liveStatus === 'reconnecting' ? 'Reconnecting' : liveStatus === 'offline' ? 'Live updates offline' : 'Connecting'}</span>{:else}<button class="secondary" onclick={() => void loadPageBlocks()}>Refresh</button>{/if}</div>
        {#if currentPage.state && Object.keys(currentPage.state).length}
          <section class="panel generated-form" aria-label="Page controls">
            {#each Object.entries(currentPage.state) as [stateName, state]}
              <label class="field-label">{state.label}
                {#if state.type === 'select'}
                  <select value={pageStateValues[currentPage.id]?.[stateName] ?? state.default} onchange={(event) => changePageState(stateName, event.currentTarget.value)}>
                    {#each state.options as option}<option value={option.value}>{option.label}</option>{/each}
                  </select>
                {:else}
                  <input type="search" value={pageStateValues[currentPage.id]?.[stateName] ?? state.default} onchange={(event) => changePageState(stateName, event.currentTarget.value)} />
                {/if}
              </label>
            {/each}
          </section>
        {/if}
        <div class="custom-page" class:two-column={currentPage.layout === 'two-column' || currentPage.layout === 'overview' || currentPage.layout === 'grid'}>
          {#each currentPage.blocks as block (block.id)}
            {@const blockOperation = block.type === 'query' ? operations.find((operation) => operation.kind === 'query' && operation.name === block.operation) : block.type === 'mutation-form' ? operations.find((operation) => operation.kind === 'mutation' && operation.name === block.operation) : block.type === 'task-launcher' ? operations.find((operation) => operation.kind === 'task' && operation.name === block.operation) : undefined}
            {@const blockMutation = block.type === 'mutation-form' ? mutationOperation(block.operation) : undefined}
            {@const blockVariant = block.type === 'query' && blockOperation ? operationVariant(blockOperation, block.variant ?? operationView(blockOperation)?.default ?? '') : undefined}
            {@const collectionEditorMutation = block.type === 'query' && blockVariant?.collection?.editor ? mutationOperation(blockVariant.collection.editor.mutation) : undefined}
            {@const blockKey = pageBlockKey(currentPage.id, block.id)}
            {#if block.type === 'operation-catalog'}
            <OperationList operations={operations} operationViews={operationViews} selected={selectedOperation} selectedKind={selectedOperationKind} onSelect={chooseOperation} />
            {:else if block.type === 'operation-executor'}
              <section class="panel detail-panel">
                {#if currentOperation}
                  <div class="panel-heading detail-heading"><div><div class="eyebrow">{currentOperation.kind.toUpperCase()}</div><h2>{currentVariant?.title ?? currentOperation.name}</h2><p>{currentVariant?.subtitle ?? currentOperation.name}</p></div><span class="kind-tag">{currentOperation.kind}</span></div>
                  {#if availableOperationVariants.length > 1}
                    <div class="variant-tabs">{#each availableOperationVariants as variant}<button class:chosen={currentVariantName === variant.name} onclick={() => useVariant(variant.name)}>{variant.title}</button>{/each}</div>
                  {/if}
                  {#if currentVariant?.helpText}<p class="help-text">{currentVariant.helpText}</p>{/if}
                  <OperationInput operation={currentOperation} variant={currentVariant} {inputText} onInputChange={editOperationInput} />
                  <div class="actions"><button class="primary" onclick={() => runOperation()} disabled={loading}>{loading ? 'Running…' : currentOperation.kind === 'query' ? 'Run query' : currentOperation.kind === 'mutation' ? 'Run mutation' : 'Launch task'}</button>{#if isTask && manifest?.capabilities?.schedulesManage}<button class="secondary" onclick={() => openScheduleDialog(currentOperation)}>Schedule task</button>{/if}</div>
                  {#if result !== null}
                    {#if currentVariant?.renderer === 'table' && isPage(result)}
                      <div class="table-result"><div class="result-heading"><h3>{result.totalCount ?? result.rows.length} results</h3><span>LIVE</span></div>
                          {#if currentVariant.collection}
                            {@const queryBlock = { id: `operation-${currentOperation.name}`, type: 'query' as const, operation: currentOperation.name, variant: currentVariantName } satisfies AdminBlock}
                            {@const editorOperation = currentVariant.collection.editor ? operations.find((operation) => operation.kind === 'mutation' && operation.name === currentVariant.collection?.editor?.mutation) : undefined}
                            <DashboardBlock block={queryBlock} contextKey={`${applicationId}:${workspaceId}:operation:${currentOperation.name}:${selectedVariant}`} result={result} variant={currentVariant} queryOperation={currentOperation} {editorOperation} editorVariant={editorOperation && currentVariant.collection.editor ? operationVariant(editorOperation, currentVariant.collection.editor.variant ?? operationView(editorOperation)?.default ?? '') : undefined} inputText={inputText} showControls={false} cacheNamespace={queryCacheNamespace} onFilter={operationCollectionFilter} onPage={operationCollectionPage} onSave={(input: Record<string, unknown>) => saveOperationCollection(currentVariant.collection!, input)} onEditorDirtyChange={(dirty: boolean) => setCollectionEditorDirty('operations', `operation-${currentOperation.name}`, dirty)} onRowAction={(row: Record<string, unknown>, action: NonNullable<OperationViews['variants'][string]['actions']>[number]) => editRow(row, action)} onChatQueryView={loadChatQueryView} onChatNavigate={navigateFromChat} />
                          {:else if result.rows.length}<DataTable rows={result.rows} columns={rowColumns(result.rows[0]!)} actions={currentVariant?.actions ?? []} display={displayCell} onAction={(row, action) => editRow(row, action)} />{:else}<div class="empty"><p>No rows returned.</p></div>{/if}
                         {#if currentVariant.collection?.paginationMode === 'offset'}
                           {@const limit = Math.max(1, Number(currentInput().limit) || 50)}
                           {@const offset = Math.max(0, Number(currentInput().offset) || 0)}
                           {@const total = Math.max(0, Number(result.totalCount) || 0)}
                           {@const pages = Math.max(1, Math.ceil(total / limit))}
                           <div class="pagination"><button class="secondary" onclick={() => operationOffsetPage(Math.max(0, offset - limit))} disabled={offset === 0 || loading}>Previous</button><label>Page <input aria-label="Page" type="number" min="1" max={pages} value={Math.floor(offset / limit) + 1} onchange={(event) => { const page = Math.min(pages, Math.max(1, Number(event.currentTarget.value) || 1)); operationOffsetPage((page - 1) * limit); }} disabled={loading} /> of {pages}</label><button class="secondary" onclick={() => operationOffsetPage(offset + limit)} disabled={offset + limit >= total || loading}>Next</button></div>
                         {:else if !currentVariant.collection && (result.nextCursor || cursorStack.length)}<div class="pagination"><button class="secondary" onclick={previousPage} disabled={!cursorStack.length}>Previous</button><button class="secondary" onclick={nextPage} disabled={!result.nextCursor}>Next page</button></div>{/if}
                      </div>
                     {:else if currentVariant?.renderer.startsWith('chat')}
                        <ChatView variant={currentVariant} {result} {inputText} contextKey={`${applicationId}:${workspaceId}:${selectedOperationKind}:${selectedOperation}:${selectedVariant}`} sending={chatSending} followToken={chatFollowToken} cacheNamespace={queryCacheNamespace} onSend={sendChatMessage} onAction={openChatAction} onLoadOlder={loadOperationOlderMessages} onQueryView={loadChatQueryView} onNavigate={navigateFromChat} onThreadSearch={searchOperationThreads} onThreadSelect={(thread: ChatThread) => openChatThread(thread)} onLoadMoreThreads={loadOperationMoreThreads} />
                     {:else if currentVariant?.renderer === 'chart' && isPage(result)}
                       <ChartView rows={result.rows} config={currentVariant.chart!} title={currentVariant.title} />
                     {:else}<div class="result-heading"><h3>{isTask ? 'Launch result' : 'Result'}</h3><span>Rich JSON</span></div><pre class="result">{richJson(result)}</pre>{/if}
                  {/if}
                {:else}<div class="empty"><h2>Select an operation</h2><p>Choose an operation to inspect or run it.</p></div>{/if}
              </section>
            {:else}
            <DashboardBlock
              {block}
              contextKey={`${applicationId}:${workspaceId}:${blockKey}:${block.type === 'query' ? block.operation : ''}`}
              variant={blockVariant}
               queryOperation={block.type === 'query' ? blockOperation : undefined}
               mutationOperation={blockMutation}
               mutationVariant={block.type === 'mutation-form' && blockMutation ? operationVariant(blockMutation, block.variant ?? operationView(blockMutation)?.default ?? '') : undefined}
              editorOperation={collectionEditorMutation}
              editorVariant={collectionEditorMutation && block.type === 'query' && blockVariant?.collection?.editor ? operationVariant(collectionEditorMutation, blockVariant.collection.editor.variant ?? operationView(collectionEditorMutation)?.default ?? '') : undefined}
              followToken={block.type === 'query' ? pageChatFollowTokens[blockKey] ?? 0 : 0}
              inputText={block.type === 'query' ? pageQueryInputs[blockKey] : undefined}
              onInputChange={(value: string) => { if (block.type === 'query') editPageInput(blockKey, value); }}
               result={block.type === 'query' ? pageQueryStates[blockKey]?.result : block.type === 'resource' ? pageResourceStates[blockKey]?.result : undefined}
               hasResult={block.type === 'query' ? pageQueryStates[blockKey]?.hasResult ?? false : block.type === 'resource' ? pageResourceStates[blockKey]?.hasResult ?? false : false}
                queryState={block.type === 'query' ? pageQueryStates[blockKey] : undefined}
                resourceState={block.type === 'resource' ? pageResourceStates[blockKey] : undefined}
                scheduleManage={block.type === 'resource' && block.resource === 'schedules' && !!manifest?.capabilities?.schedulesManage}
                scheduleDrafts={scheduleDrafts}
                agentRuns={block.type === 'resource' && block.resource === 'agents' ? agentRuns : []}
                selectedAgentRun={block.type === 'resource' && block.resource === 'agents' ? selectedAgentRun : null}
                agentEvents={block.type === 'resource' && block.resource === 'agents' ? agentEvents : []}
                agentEventsCursor={block.type === 'resource' && block.resource === 'agents' ? agentEventsCursor : null}
                agentRunCursor={block.type === 'resource' && block.resource === 'agents' ? agentRunCursor : null}
                agentStatusFilter={agentStatusFilter}
                agentNameFilter={agentNameFilter}
                agentActorFilter={agentActorFilter}
                agentConversationFilter={agentConversationFilter}
                canReadAllAgentRuns={!!manifest?.capabilities?.agentRunsReadAll}
               error={block.type === 'query' ? pageQueryStates[blockKey]?.error?.message ?? '' : block.type === 'resource' ? pageResourceStates[blockKey]?.error?.message ?? '' : ''}
               loading={block.type === 'query' ? pageQueryStates[blockKey]?.status === 'loading' || pageQueryStates[blockKey]?.status === 'refreshing' : block.type === 'resource' ? pageResourceStates[blockKey]?.status === 'loading' || pageResourceStates[blockKey]?.status === 'refreshing' : false}
               chatSending={block.type === 'query' ? pageChatSending[blockKey] : false}
                cacheNamespace={queryCacheNamespace}
                onChatNavigate={navigateFromChat}
              hasPreviousPage={block.type === 'query' ? !!pageCursorStacks[blockKey]?.length : false}
               onPage={block.type === 'query' ? (page?: { cursor?: string; offset?: number }) => pageCustomQuery(block, page) : undefined}
                onFilter={block.type === 'query' ? (target: string, value: unknown) => pageCollectionFilter(block, target, value) : undefined}
                onSave={block.type === 'query' ? (input: Record<string, unknown>) => savePageCollection(block, blockVariant?.collection, input) : undefined}
                onEditorDirtyChange={block.type === 'query' && blockVariant?.collection?.editor ? (dirty: boolean) => setCollectionEditorDirty(currentPage.id, block.id, dirty) : undefined}
                onRefresh={() => block.type === 'query' ? runPageQuery(block) : loadPageBlocks()}
                onScheduleCreate={block.type === 'resource' && block.resource === 'schedules' && manifest?.capabilities?.schedulesManage ? () => openScheduleDialog(undefined) : undefined}
                onScheduleDraft={block.type === 'resource' && block.resource === 'schedules' ? (id: string, field: 'cron' | 'timezone', value: string) => { scheduleDrafts[id] = { ...scheduleDrafts[id], [field]: value }; } : undefined}
                onScheduleAction={block.type === 'resource' && block.resource === 'schedules' && manifest?.capabilities?.schedulesManage ? (schedule: Record<string, unknown>, action: 'save' | 'toggle' | 'delete') => { if (action === 'save') void saveSchedule(schedule); else if (action === 'toggle') void toggleSchedule(schedule); else void deleteSchedule(schedule.id); } : undefined}
                onAgentFilter={block.type === 'resource' && block.resource === 'agents' ? (field: 'agent' | 'status' | 'actorId' | 'conversationId', value: string) => changeAgentFilter(field, value) : undefined}
                onAgentSelect={block.type === 'resource' && block.resource === 'agents' ? (run: AgentRun) => void chooseAgentRun(run) : undefined}
                onAgentApplyFilters={block.type === 'resource' && block.resource === 'agents' ? () => void applyAgentFilters() : undefined}
                onAgentLoadMoreRuns={block.type === 'resource' && block.resource === 'agents' ? () => void loadAgentRuns(agentRunCursor ?? undefined) : undefined}
                onAgentLoadMoreEvents={block.type === 'resource' && block.resource === 'agents' ? () => void loadMoreAgentEvents() : undefined}
               onChatSend={block.type === 'query' ? (text: string) => sendPageChatMessage(block, text) : undefined}
                onLoadOlder={block.type === 'query' ? (cursor: string) => loadPageOlderMessages(block, cursor) : undefined}
                onChatQueryView={loadChatQueryView}
                onThreadSearch={block.type === 'query' ? (value: string) => searchPageThreads(block, value) : undefined}
                onThreadSelect={block.type === 'query' ? (thread: ChatThread) => openPageChatThread(block, thread) : undefined}
                onLoadMoreThreads={block.type === 'query' ? (cursor: string) => loadPageMoreThreads(block, cursor) : undefined}
              onChatAction={openChatAction}
               onOpen={() => block.type === 'resource' ? choosePage(block.resource) : block.type === 'task-launcher' ? openBlockOperation(block.operation, 'task') : undefined}
               onMutationSubmit={(input: Record<string, unknown>) => blockMutation ? submitPageMutation(blockMutation, input) : Promise.reject(new Error('Mutation is not available.'))}
               onRowAction={(row: Record<string, unknown>, action: NonNullable<OperationViews['variants'][string]['actions']>[number]) => { const executorPage = operationExecutorPageId(); if (!executorPage) error = 'No operation executor page is available.'; else if (choosePage(executorPage)) editRow(row, action); }}
             />
            {/if}
          {/each}
        </div>
      {:else}
          <div class="empty"><h1>Page unavailable</h1><p>This page is not present in the current workspace manifest.</p></div>
      {/if}
    </div>
  </main>
</div>

{#if scheduleDialogOpen && currentScheduleTask}
  <div class="modal-backdrop" role="presentation" onclick={(event) => { if (event.target === event.currentTarget) scheduleDialogOpen = false; }}>
    <dialog open class="schedule-modal" aria-labelledby="schedule-title">
      <div class="panel-heading"><div><div class="eyebrow">AUTOMATION</div><h2 id="schedule-title">Schedule a task</h2><p>Runs use this workspace and your current identity.</p></div><button class="text-button" onclick={() => scheduleDialogOpen = false} aria-label="Close">×</button></div>
      <div class="schedule-form">
        <label class="field-label">Task<select value={scheduleTaskOperation} onchange={(event) => chooseScheduleTask(event.currentTarget.value)}>{#each operations.filter((operation) => operation.kind === 'task') as task}<option value={task.name}>{task.name}</option>{/each}</select></label>
        <OperationInput operation={currentScheduleTask} variant={operationVariant(currentScheduleTask, operationView(currentScheduleTask)?.default ?? '')} inputText={scheduleTaskInputText} onInputChange={(value: string) => scheduleTaskInputText = value} />
        <label class="field-label">Schedule type<select bind:value={scheduleKind}><option value="recurring">Recurring</option><option value="once">One time</option></select></label>
        {#if scheduleKind === 'recurring'}<label class="field-label">Cron expression<input bind:value={scheduleCron} placeholder="0 9 * * *" /><span>Five fields: minute hour day month weekday.</span></label>{:else}<label class="field-label">Run at<input type="datetime-local" bind:value={scheduleRunAt} required /></label>{/if}
        <label class="field-label">Timezone<input bind:value={scheduleTimezone} required /></label>
        <p class="schema-hint">Missed recurring runs are skipped. A schedule will not overlap its previous run.</p>
        <div class="actions"><button class="primary" onclick={() => void createSchedule()}>Create schedule</button><button class="secondary" onclick={() => scheduleDialogOpen = false}>Cancel</button></div>
      </div>
    </dialog>
  </div>
{/if}
