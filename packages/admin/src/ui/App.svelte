<script lang="ts">
  import { createFetchTransport, type UiMetadata, type WorkcoreManifest, type WorkcoreTransport } from '@workcore/client';
  import type { AgentRun, AgentRunStatus, AgentTraceEvent, ChatAction, ChatActionMapping, OperationKind } from '@workcore/core';
  import { superjsonCodec } from '@workcore/codec-superjson';
  import DashboardBlock from './DashboardBlock.svelte';
  import OperationList from './OperationList.svelte';
  import OperationInput from './OperationInput.svelte';
  import DataTable from './DataTable.svelte';
  import ChatView from './ChatView.svelte';
  import { chatMessages as getChatMessages, previousCursor as getPreviousCursor, chatMutationInput, pathValue } from './chat-data.js';
  import { captureRequestContext } from './request-context.js';
  import { editableJson, parseEditableJson, hydrateRuntimeTypes, richJson, displayCell } from './rich-input.js';

  const config = (window as Window & { __WORKCORE_ADMIN__?: { apiBasePath?: string; basePath?: string; wireCodecId?: string } }).__WORKCORE_ADMIN__ ?? {};
  if (config.wireCodecId && config.wireCodecId !== 'json' && config.wireCodecId !== 'superjson-v1') throw new Error(`Unsupported admin wire codec '${config.wireCodecId}'`);
  const codec = config.wireCodecId === 'superjson-v1' ? superjsonCodec() : undefined;
  const transport: WorkcoreTransport = createFetchTransport({ baseUrl: config.apiBasePath ?? '/workcore/api', ...(codec ? { codec } : {}), onWarning: (code) => { error = `Operation completed, but follow-up delivery reported ${code}.`; } });
  let applicationId = $state(new URLSearchParams(location.search).get('applicationId') ?? 'tracker');
  let workspaceId = $state(new URLSearchParams(location.search).get('workspaceId') ?? '');
  let applications = $state<Array<{ id: string; workspaceCount: number }>>([]);
  let workspaces = $state<Array<{ id: string; name: string }>>([]);
  let manifest = $state<WorkcoreManifest | null>(null);
  let selectedOperation = $state('');
  let selectedOperationKind = $state<OperationKind>('query');
  let selectedVariant = $state('');
  let inputText = $state('{}');
  let result = $state.raw<unknown>(null);
  let error = $state('');
  let loading = $state(false);
  let liveStatus = $state<'connecting' | 'connected' | 'reconnecting' | 'offline'>('connecting');
  let section = $state('operations');
  let runs = $state<Array<Record<string, unknown>>>([]);
  let schedules = $state<Array<Record<string, unknown>>>([]);
  let scheduleDrafts = $state<Record<string, { cron?: string; timezone?: string }>>({});
  let history = $state<Array<Record<string, unknown>>>([]);
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
  let unsubscribe: (() => void) | undefined;
  let cursorStack = $state<string[]>([]);
  let queryGeneration = 0;
  let submissionGeneration = 0;
  let workspaceRequestGeneration = 0;
  let sectionRequestGeneration = 0;
  let agentRunsGeneration = 0;
  let agentEventsGeneration = 0;
  let chatSendGeneration = 0;
  let pageNavigationGeneration = 0;
  let scheduleDialogOpen = $state(false);
  let scheduleKind = $state<'recurring' | 'once'>('recurring');
  let scheduleCron = $state('0 9 * * *');
  let scheduleRunAt = $state('');
  let scheduleTimezone = $state(Intl.DateTimeFormat().resolvedOptions().timeZone);
  let pageQueryResults = $state<Record<string, unknown>>({});
  let pageQueryErrors = $state<Record<string, string>>({});
  let pageQueryLoading = $state<Record<string, boolean>>({});
  let pageChatSending = $state<Record<string, boolean>>({});
  let pageChatFollowTokens = $state<Record<string, number>>({});
  let pageQueryInputs = $state<Record<string, string>>({});
  let pageQueryGenerations: Record<string, number> = {};
  let pageChatGenerations: Record<string, number> = {};
  let operationInputGeneration = 0;
  let pageInputGenerations: Record<string, number> = {};
  let pageCursorStacks = $state<Record<string, string[]>>({});

  const operations = $derived(manifest?.operations ?? []);
  const currentOperation = $derived(operations.find((operation) => operation.kind === selectedOperationKind && operation.name === selectedOperation));
  const currentVariant = $derived(currentOperation?.ui?.variants[selectedVariant || currentOperation.ui.default]);
  const isTask = $derived(currentOperation?.kind === 'task');
  const currentPage = $derived(manifest?.pages?.find((page) => page.id === section));

  function pageBlockKey(pageId: string, blockId: string) { return `${pageId}\u0000${blockId}`; }

  function invalidateChatSend() { chatSendGeneration++; chatSending = false; }

  function invalidatePageRequests() {
    pageNavigationGeneration++;
    for (const key of Object.keys(pageChatGenerations)) pageChatGenerations[key] = (pageChatGenerations[key] ?? 0) + 1;
    pageChatSending = {};
    pageQueryLoading = {};
    invalidateChatSend();
  }

  function pageContext(key: string) {
    return captureRequestContext(() => [workspaceRequestGeneration, pageNavigationGeneration, applicationId, workspaceId, currentPage?.id, pageInputGenerations[key] ?? 0, pageQueryInputs[key]]);
  }

  function editOperationInput(value: string) {
    operationInputGeneration++;
    invalidateChatSend();
    inputText = value;
  }

  function editPageInput(key: string, value: string, resetCursor = true) {
    pageInputGenerations[key] = (pageInputGenerations[key] ?? 0) + 1;
    pageQueryGenerations[key] = (pageQueryGenerations[key] ?? 0) + 1;
    pageChatGenerations[key] = (pageChatGenerations[key] ?? 0) + 1;
    pageChatSending[key] = false;
    pageQueryLoading[key] = false;
    if (resetCursor) pageCursorStacks[key] = [];
    pageQueryInputs[key] = value;
  }

  function legacyManifestPages(value: WorkcoreManifest): NonNullable<WorkcoreManifest['pages']> {
    const pages: NonNullable<WorkcoreManifest['pages']> = [];
    if (value.operations.length) pages.push({ id: 'operations', title: 'Operations', layout: 'stacked', blocks: [], builtin: true });
    if (value.capabilities?.tasksRead) pages.push({ id: 'tasks', title: 'Task runs', blocks: [{ id: 'task-runs', type: 'resource', resource: 'tasks' }], builtin: true });
    if (value.capabilities?.schedulesRead) pages.push({ id: 'schedules', title: 'Schedules', blocks: [{ id: 'schedules', type: 'resource', resource: 'schedules' }], builtin: true });
    if (value.capabilities?.historyRead) pages.push({ id: 'history', title: 'History', blocks: [{ id: 'history', type: 'resource', resource: 'history' }], builtin: true });
    if (value.capabilities?.agentRunsRead) pages.push({ id: 'agents', title: 'Agent runs', blocks: [{ id: 'agent-runs', type: 'resource', resource: 'agents' }], builtin: true });
    return pages;
  }

  $effect(() => {
    void loadApplications();
    window.addEventListener('popstate', restoreAddress);
    return () => {
      window.removeEventListener('popstate', restoreAddress);
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
    invalidateChatSend();
    agentRunsGeneration++;
    agentEventsGeneration++;
    workspaceRequestGeneration++;
    sectionRequestGeneration++;
    queryGeneration++;
    submissionGeneration++;
    loading = false;
    workspaceId = '';
    manifest = null;
    result = null;
    await loadWorkspaces();
  }

  async function selectWorkspace() {
    invalidateChatSend();
    agentRunsGeneration++;
    agentEventsGeneration++;
    const generation = ++workspaceRequestGeneration;
    queryGeneration++;
    submissionGeneration++;
    sectionRequestGeneration++;
    loading = false;
    chatSending = false;
    unsubscribe?.();
    liveStatus = 'connecting';
    scheduleDrafts = {};
    manifest = null;
    result = null;
    agentRuns = [];
    selectedAgentRun = null;
    agentEvents = [];
    if (!workspaceId) return;
    const requestApplicationId = applicationId;
    const requestWorkspaceId = workspaceId;
    try {
      const responseManifest = await transport.manifest(requestApplicationId, requestWorkspaceId);
      const loadedManifest = responseManifest.pages ? responseManifest : { ...responseManifest, pages: legacyManifestPages(responseManifest) };
      if (generation !== workspaceRequestGeneration || applicationId !== requestApplicationId || workspaceId !== requestWorkspaceId) return;
      manifest = loadedManifest;
      pageQueryResults = {};
      pageQueryErrors = {};
      pageQueryLoading = {};
      pageChatSending = {};
      pageQueryGenerations = {};
      pageChatGenerations = {};
      pageInputGenerations = {};
      pageCursorStacks = {};
      pageQueryInputs = Object.fromEntries((loadedManifest.pages ?? []).flatMap((page) => page.blocks.flatMap((block) => {
        if (block.type !== 'query') return [];
        const operation = loadedManifest.operations.find((candidate) => candidate.kind === 'query' && candidate.name === block.operation);
        const initial = block.input ?? (operation ? defaultValue(operation.input) : {});
        return [[pageBlockKey(page.id, block.id), JSON.stringify(initial, null, 2)]];
      })));
      const first = loadedManifest.operations[0];
      selectedOperation = first?.name ?? '';
      selectedOperationKind = first?.kind ?? 'query';
      selectedVariant = first?.ui?.default ?? '';
      const requestedPage = new URLSearchParams(location.search).get('page');
      section = loadedManifest.pages?.some((page) => page.id === requestedPage) ? requestedPage! : loadedManifest.defaultPage ?? 'operations';
      syncInput(first?.input);
      updateAddress();
      unsubscribe = transport.subscribe(applicationId, workspaceId, {
        onInvalidate: () => {
          if (generation !== workspaceRequestGeneration) return;
          if (currentPage && !currentPage.builtin) void loadPageQueries();
          else if (section === 'operations') {
            if (currentOperation?.kind === 'query') void runSelectedQuery(false);
          } else void loadSection();
        },
        onReady: () => { if (generation !== workspaceRequestGeneration) return; liveStatus = 'connected'; if (currentPage && !currentPage.builtin) void loadPageQueries(); else if (currentOperation?.kind === 'query') void runSelectedQuery(false); },
        onReconnect: () => { if (generation !== workspaceRequestGeneration) return; liveStatus = 'connected'; if (currentPage && !currentPage.builtin) void loadPageQueries(); else if (currentOperation?.kind === 'query') void runSelectedQuery(false); else void loadSection(); },
        onError: (cause) => { if (generation !== workspaceRequestGeneration) return; if (cause.message.includes('reconnecting')) liveStatus = 'reconnecting'; else { liveStatus = 'offline'; error = cause.message; } },
      });
      await loadSection();
      await loadPageQueries();
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
    selectedVariant = operation?.ui?.default ?? '';
    syncInput(operation?.input);
    result = null;
    cursorStack = [];
    error = '';
    if (operation?.kind === 'query') void runOperation(false);
  }

  function syncInput(schema?: Record<string, unknown>) {
    const defaults = schema ? defaultValue(schema) : {};
    inputText = JSON.stringify(defaults, null, 2);
  }

  function parseOperationInput(operation: NonNullable<typeof currentOperation>) {
    const value = inputText.trim() ? parseEditableJson(inputText) : {};
    return hydrateRuntimeTypes(value, operation.input);
  }


  function encodeBody(value: unknown) {
    const payload = codec ? codec.encode(value) : value;
    return JSON.stringify(codec ? { workcoreCodec: codec.id, payload } : payload);
  }

  async function decodeResponse(response: Response): Promise<unknown> {
    const data = await response.json().catch(() => ({})) as unknown;
    if (!codec) return data;
    if (!data || typeof data !== 'object' || Array.isArray(data)
      || (data as { workcoreCodec?: unknown }).workcoreCodec !== codec.id || !('payload' in data)) {
      throw new Error(`Server response did not use '${codec.id}'`);
    }
    return codec.decode((data as { payload: import('@workcore/core').JsonValue }).payload);
  }

  function apiHeaders(jsonBody = false) {
    return { ...(jsonBody ? { 'content-type': 'application/json' } : {}), ...(codec ? { 'x-workcore-codec': codec.id } : {}) };
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
      if (isCurrent()) { result = value; await loadSection(); }
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

  async function loadSection() {
    if (!workspaceId) return;
    const generation = ++sectionRequestGeneration;
    const requestApplicationId = applicationId;
    const requestWorkspaceId = workspaceId;
    const requestSection = section;
    const query = `applicationId=${encodeURIComponent(requestApplicationId)}&workspaceId=${encodeURIComponent(requestWorkspaceId)}`;
    const base = config.apiBasePath ?? '/workcore/api';
    try {
      if (requestSection === 'tasks') {
        const value = await request<{ runs: Array<Record<string, unknown>> }>(`${base}/tasks?${query}`);
        if (isCurrent()) runs = value.runs;
      }
      if (requestSection === 'agents') await loadAgentRuns();
      if (requestSection === 'schedules') {
        const value = await request<{ schedules: Array<Record<string, unknown>> }>(`${base}/schedules?${query}`);
        if (isCurrent()) schedules = value.schedules;
      }
      if (requestSection === 'history') {
        const value = await request<{ entries: Array<Record<string, unknown>> }>(`${base}/history?${query}`);
        if (isCurrent()) history = value.entries;
      }
    } catch (cause) { if (isCurrent()) error = message(cause); }

    function isCurrent() {
      return generation === sectionRequestGeneration && applicationId === requestApplicationId && workspaceId === requestWorkspaceId && section === requestSection;
    }
  }

  async function loadAgentRuns(cursor?: string) {
    if (!transport.agentRuns) return;
    const generation = ++agentRunsGeneration;
    const sectionGeneration = sectionRequestGeneration;
    const requestApplicationId = applicationId;
    const requestWorkspaceId = workspaceId;
    const value = await transport.agentRuns(requestApplicationId, requestWorkspaceId, {
      limit: 30,
      ...(cursor ? { cursor } : {}),
      ...(agentStatusFilter ? { status: agentStatusFilter } : {}),
      ...(agentNameFilter.trim() ? { agent: agentNameFilter.trim() } : {}),
      ...(agentActorFilter.trim() ? { actorId: agentActorFilter.trim() } : {}),
      ...(agentConversationFilter.trim() ? { conversationId: agentConversationFilter.trim() } : {}),
    });
    if (generation !== agentRunsGeneration || sectionGeneration !== sectionRequestGeneration || section !== 'agents' || requestApplicationId !== applicationId || requestWorkspaceId !== workspaceId) return;
    agentRuns = cursor ? [...agentRuns, ...value.runs] : value.runs;
    agentRunCursor = value.nextCursor;
    const focusedRun = agentRuns.find((run) => run.id === selectedAgentRun?.id) ?? agentRuns[0] ?? null;
    if (focusedRun) await chooseAgentRun(focusedRun);
    if (!agentRuns.length) { selectedAgentRun = null; agentEvents = []; }
  }

  async function chooseAgentRun(run: AgentRun | null) {
    const generation = ++agentEventsGeneration;
    selectedAgentRun = run;
    agentEvents = [];
    agentEventsCursor = null;
    if (!run || !transport.agentRunEvents) return;
    try {
      const page = await transport.agentRunEvents(applicationId, workspaceId, run.id, 0, 100);
      if (generation === agentEventsGeneration && selectedAgentRun?.id === run.id) { agentEvents = page.events; agentEventsCursor = page.nextCursor; }
    } catch (cause) { if (generation === agentEventsGeneration) error = message(cause); }
  }

  async function loadMoreAgentEvents() {
    const run = selectedAgentRun;
    if (!run || !agentEventsCursor || !transport.agentRunEvents) return;
    const generation = agentEventsGeneration;
    try {
      const page = await transport.agentRunEvents(applicationId, workspaceId, run.id, Number(agentEventsCursor), 100);
      if (generation === agentEventsGeneration && selectedAgentRun?.id === run.id) { agentEvents = [...agentEvents, ...page.events]; agentEventsCursor = page.nextCursor; }
    } catch (cause) { if (generation === agentEventsGeneration) error = message(cause); }
  }

  async function applyAgentFilters() {
    selectedAgentRun = null;
    agentEvents = [];
    agentRunCursor = null;
    await loadAgentRuns();
  }

  async function sendChatMessage(text: string) {
    const operation = currentOperation;
    const requestApplicationId = applicationId;
    const requestWorkspaceId = workspaceId;
    const chat = currentVariant?.renderer === 'chat' ? currentVariant.chat : undefined;
    if (!operation || operation.kind !== 'query' || !chat || !text.trim() || chatSending) return;
    const generation = ++chatSendGeneration;
    const mutation = operations.find((candidate) => candidate.kind === 'mutation' && candidate.name === chat.sendMutation);
    if (!mutation) throw new Error(`Chat send mutation '${chat.sendMutation}' is unavailable.`);
    const isCurrent = captureRequestContext(() => [workspaceRequestGeneration, pageNavigationGeneration, chatSendGeneration, operationInputGeneration, applicationId, workspaceId, selectedOperation, selectedOperationKind, selectedVariant, inputText]);
    const conversationId = pathValue(result, chat.conversationIdPath ?? 'conversation.id');
    const mutationInput = chatMutationInput(chat, text, conversationId);
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

  async function loadPageQueries() {
    const page = currentPage;
    if (!page || !workspaceId) return;
    await Promise.all(page.blocks.filter((block) => block.type === 'query').map((block) => runPageQuery(block)));
  }

  async function runPageQuery(block: Extract<NonNullable<WorkcoreManifest['pages']>[number]['blocks'][number], { type: 'query' }>) {
    const page = currentPage;
    if (!page || !workspaceId) return;
    const key = pageBlockKey(page.id, block.id);
    const generation = (pageQueryGenerations[key] ?? 0) + 1;
    pageQueryGenerations[key] = generation;
    const requestApplicationId = applicationId;
    const requestWorkspaceId = workspaceId;
    const contextIsCurrent = pageContext(key);
    const isCurrent = () => contextIsCurrent() && pageQueryGenerations[key] === generation;
    pageQueryLoading[key] = true;
    pageQueryErrors[key] = '';
    try {
      const operation = operations.find((candidate) => candidate.kind === 'query' && candidate.name === block.operation);
      if (!operation) throw new Error(`Query '${block.operation}' is unavailable.`);
      const input = hydrateRuntimeTypes(parseEditableJson(pageQueryInputs[key] ?? JSON.stringify(block.input ?? {})), operation.input);
      const value = await transport.request({ path: 'query', applicationId: requestApplicationId, workspaceId: requestWorkspaceId, operation: block.operation, input });
      if (isCurrent()) pageQueryResults[key] = value;
    } catch (cause) {
      if (isCurrent()) pageQueryErrors[key] = message(cause);
    } finally {
      if (isCurrent()) pageQueryLoading[key] = false;
    }
  }

  function pageCustomQuery(block: Extract<NonNullable<WorkcoreManifest['pages']>[number]['blocks'][number], { type: 'query' }>, cursor?: string) {
    const page = currentPage;
    if (!page) return;
    const key = pageBlockKey(page.id, block.id);
    const input = parseEditableJson(pageQueryInputs[key] ?? JSON.stringify(block.input ?? {})) as Record<string, unknown>;
    if (cursor) {
      pageCursorStacks[key] = [...(pageCursorStacks[key] ?? []), String(input.cursor ?? '')];
      input.cursor = cursor;
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

  async function loadPageOlderMessages(block: Extract<NonNullable<WorkcoreManifest['pages']>[number]['blocks'][number], { type: 'query' }>, cursor: string) {
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
    const olderInput = { ...input as Record<string, unknown>, cursor, direction: 'backward' };
    const value = await transport.request({ path: 'query', applicationId: requestApplicationId, workspaceId: requestWorkspaceId, operation: block.operation, input: olderInput });
    if (!isCurrent()) throw new Error('This page changed while loading messages.');
    return { messages: getChatMessages(value), previousCursor: getPreviousCursor(value) };
  }

  async function sendPageChatMessage(block: Extract<NonNullable<WorkcoreManifest['pages']>[number]['blocks'][number], { type: 'query' }>, messageText: string) {
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
    const variant = operation?.ui?.variants[block.variant ?? operation.ui.default];
    const chat = variant?.renderer === 'chat' ? variant.chat : undefined;
    const mutation = chat && operations.find((candidate) => candidate.kind === 'mutation' && candidate.name === chat.sendMutation);
    if (!operation || !chat || !mutation) throw new Error('This chat is not available to your account.');
    const currentResult = pageQueryResults[key];
    const conversationId = pathValue(currentResult, chat.conversationIdPath ?? 'conversation.id');
    pageQueryErrors[key] = '';
    pageChatSending[key] = true;
    try {
      const input = chatMutationInput(chat, messageText, conversationId);
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
      if (isCurrent()) pageQueryErrors[key] = message(cause);
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
    return { messages: getChatMessages(value), previousCursor: getPreviousCursor(value) };
  }

  function choosePage(id: string) {
    invalidatePageRequests();
    section = id;
    const url = new URL(location.href);
    url.searchParams.set('applicationId', applicationId);
    url.searchParams.set('workspaceId', workspaceId);
    url.searchParams.set('page', id);
    window.history.pushState({}, '', url);
    if (id === 'tasks' || id === 'schedules' || id === 'history' || id === 'agents') void loadSection();
    else void loadPageQueries();
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
    if (nextPage && manifest?.pages?.some((page) => page.id === nextPage)) choosePageFromHistory(nextPage);
  }

  function choosePageFromHistory(id: string) {
    invalidatePageRequests();
    section = id;
    if (id === 'tasks' || id === 'schedules' || id === 'history' || id === 'agents') void loadSection();
    else void loadPageQueries();
  }

  function openBlockOperation(name: string, kind: OperationKind, variant?: string) {
    choosePage('operations');
    chooseOperation(name, kind);
    if (variant) selectedVariant = variant;
  }

  async function request<T>(url: string): Promise<T> {
    const response = await fetch(url, { credentials: 'same-origin', headers: apiHeaders() });
    const data = await decodeResponse(response) as { error?: { message?: string } } & T;
    if (!response.ok) throw new Error(data.error?.message ?? `Request failed (${response.status})`);
    return data as T;
  }

  async function createSchedule() {
    if (!currentOperation || currentOperation.kind !== 'task') return;
    try {
      if (scheduleKind === 'once' && (!scheduleRunAt || !Number.isFinite(Date.parse(scheduleRunAt)))) throw new Error('Choose a valid future run time.');
      const response = await fetch(`${config.apiBasePath ?? '/workcore/api'}/schedules`, {
        method: 'POST', credentials: 'same-origin', headers: apiHeaders(true),
        body: encodeBody({ applicationId, workspaceId, operation: currentOperation.name, input: parseOperationInput(currentOperation), kind: scheduleKind, ...(scheduleKind === 'once' ? { runAt: new Date(scheduleRunAt).toISOString() } : { cron: scheduleCron }), timezone: scheduleTimezone }),
      });
      const data = await decodeResponse(response) as { error?: { message?: string } };
      if (!response.ok) throw new Error(data.error?.message ?? 'Could not create schedule');
      scheduleDialogOpen = false;
      section = 'schedules';
      await loadSection();
    } catch (cause) { error = message(cause); }
  }

  async function deleteSchedule(id: unknown) {
    try {
      const query = `applicationId=${encodeURIComponent(applicationId)}&workspaceId=${encodeURIComponent(workspaceId)}`;
      const response = await fetch(`${config.apiBasePath ?? '/workcore/api'}/schedules/${encodeURIComponent(String(id))}?${query}`, { method: 'DELETE', credentials: 'same-origin', headers: apiHeaders() });
      if (!response.ok) throw new Error('Could not remove schedule');
      await loadSection();
    } catch (cause) { error = message(cause); }
  }

  async function toggleSchedule(schedule: Record<string, unknown>) {
    try {
      const query = `applicationId=${encodeURIComponent(applicationId)}&workspaceId=${encodeURIComponent(workspaceId)}`;
      const response = await fetch(`${config.apiBasePath ?? '/workcore/api'}/schedules/${encodeURIComponent(String(schedule.id))}?${query}`, {
        method: 'PATCH', credentials: 'same-origin', headers: apiHeaders(true), body: encodeBody({ enabled: !schedule.enabled }),
      });
      const data = await decodeResponse(response) as { error?: { message?: string } };
      if (!response.ok) throw new Error(data.error?.message ?? 'Could not update schedule');
      await loadSection();
    } catch (cause) { error = message(cause); }
  }
  async function saveSchedule(schedule: Record<string, unknown>) {
    try {
      const query = `applicationId=${encodeURIComponent(applicationId)}&workspaceId=${encodeURIComponent(workspaceId)}`;
      const draft = scheduleDrafts[String(schedule.id)] ?? {};
      const patch = { ...(schedule.kind === 'recurring' ? { cron: draft.cron ?? schedule.cron } : {}), timezone: draft.timezone ?? schedule.timezone };
      const response = await fetch(`${config.apiBasePath ?? '/workcore/api'}/schedules/${encodeURIComponent(String(schedule.id))}?${query}`, { method: 'PATCH', credentials: 'same-origin', headers: apiHeaders(true), body: encodeBody(patch) });
      const data = await decodeResponse(response) as { error?: { message?: string } };
      if (!response.ok) throw new Error(data.error?.message ?? 'Could not save schedule');
      delete scheduleDrafts[String(schedule.id)];
      await loadSection();
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
  function editRow(row: Record<string, unknown>, action: NonNullable<NonNullable<UiMetadata['variants'][string]>['actions']>[number]) {
    const mutationOperation = operations.find((operation) => operation.name === action.mutation && operation.kind === 'mutation');
    if (!mutationOperation) { error = `Unknown row action mutation: ${action.mutation}`; return; }
    chooseOperation(mutationOperation.name, 'mutation');
    selectedVariant = action.variant ?? mutationOperation.ui?.default ?? '';
    const bound: Record<string, unknown> = {};
    for (const [inputKey, binding] of Object.entries(action.bind ?? {})) bound[inputKey] = row[binding.fromRow];
    const properties = mutationOperation.input.properties as Record<string, Record<string, unknown>> | undefined;
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
    choosePage('operations');
    chooseOperation(mutationOperation.name, 'mutation');
    inputText = prepared;
    selectedVariant = mapping.variant ?? mutationOperation.ui?.default ?? '';
    result = null;
    error = '';
    section = 'operations';
  }
  function updateAddress() {
    const url = new URL(location.href);
    url.searchParams.set('applicationId', applicationId);
    url.searchParams.set('workspaceId', workspaceId);
    url.searchParams.set('page', section);
    window.history.replaceState({}, '', url);
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
      {#each manifest?.pages ?? [] as page}
         <button class:active={section === page.id} onclick={() => choosePage(page.id)}><span>{page.id === 'operations' ? '◫' : page.id === 'tasks' ? '◷' : page.id === 'schedules' ? '▤' : page.id === 'history' ? '◴' : page.id === 'agents' ? '✳' : '▧'}</span><span>{page.title}</span></button>
      {/each}
    </nav>
    <div class="sidebar-bottom"><span class="connection-dot" class:reconnecting={liveStatus === 'reconnecting'} class:offline={liveStatus === 'offline'}></span>{liveStatus === 'connected' ? 'Connected' : liveStatus === 'connecting' ? 'Connecting…' : liveStatus === 'reconnecting' ? 'Reconnecting…' : 'Offline'} <span class="version">v1 protocol</span></div>
  </aside>

  <main class="main">
    <header class="topbar"><div><span class="breadcrumb">{applicationId}</span><span class="slash">/</span><span>{workspaceId || 'No workspace'}</span></div><span class="avatar">{workspaceId.slice(0, 1).toUpperCase() || 'W'}</span></header>
    <div class="mobile-page-nav">
      <label for="mobile-page-select">PAGE</label>
      <select id="mobile-page-select" aria-label="Admin page" value={section} onchange={(event) => choosePage(event.currentTarget.value)} disabled={!manifest?.pages?.length}>
        {#each manifest?.pages ?? [] as page}<option value={page.id}>{page.title}</option>{/each}
      </select>
    </div>
    <div class="content">
      {#if error}<div class="alert"><span>Something needs attention</span><p>{error}</p><button onclick={() => error = ''} aria-label="Dismiss">×</button></div>{/if}
      {#if !workspaces.length && !error}<div class="empty"><h1>No workspace access</h1><p>Sign in with an account that belongs to a Workcore workspace.</p></div>
      {:else if currentPage && !currentPage.builtin}
        <div class="page-heading"><div><div class="eyebrow">CUSTOM WORKSPACE PAGE</div><h1>{currentPage.title}</h1><p>{currentPage.description ?? ''}</p></div><button class="secondary" onclick={() => void loadPageQueries()}>Refresh</button></div>
        <div class="custom-page" class:two-column={currentPage.layout === 'two-column' || currentPage.layout === 'overview'}>
          {#each currentPage.blocks as block (block.id)}
            {@const blockOperation = block.type === 'query' ? operations.find((operation) => operation.kind === 'query' && operation.name === block.operation) : block.type === 'mutation-form' ? operations.find((operation) => operation.kind === 'mutation' && operation.name === block.operation) : block.type === 'task-launcher' ? operations.find((operation) => operation.kind === 'task' && operation.name === block.operation) : undefined}
            {@const blockVariant = block.type === 'query' ? blockOperation?.ui?.variants[block.variant ?? blockOperation.ui.default] : undefined}
            {@const blockKey = pageBlockKey(currentPage.id, block.id)}
            <DashboardBlock
              {block}
              contextKey={`${applicationId}:${workspaceId}:${blockKey}:${block.type === 'query' ? block.operation : ''}`}
              variant={blockVariant}
              followToken={block.type === 'query' ? pageChatFollowTokens[blockKey] ?? 0 : 0}
              inputText={block.type === 'query' ? pageQueryInputs[blockKey] : undefined}
              onInputChange={(value) => { if (block.type === 'query') editPageInput(blockKey, value); }}
              result={block.type === 'query' ? pageQueryResults[blockKey] : undefined}
              error={block.type === 'query' ? pageQueryErrors[blockKey] : ''}
              loading={block.type === 'query' ? pageQueryLoading[blockKey] : false}
              chatSending={block.type === 'query' ? pageChatSending[blockKey] : false}
              hasPreviousPage={block.type === 'query' ? !!pageCursorStacks[blockKey]?.length : false}
              onPage={block.type === 'query' ? (cursor) => pageCustomQuery(block, cursor) : undefined}
              onRefresh={() => block.type === 'query' ? runPageQuery(block) : loadPageQueries()}
              onChatSend={block.type === 'query' ? (text) => sendPageChatMessage(block, text) : undefined}
              onLoadOlder={block.type === 'query' ? (cursor) => loadPageOlderMessages(block, cursor) : undefined}
              onChatAction={openChatAction}
              onOpen={() => block.type === 'resource' ? choosePage(block.resource) : block.type === 'mutation-form' ? openBlockOperation(block.operation, 'mutation', block.variant) : block.type === 'task-launcher' ? openBlockOperation(block.operation, 'task') : undefined}
              onRowAction={(row, action) => { choosePage('operations'); editRow(row, action); }}
            />
          {/each}
        </div>
      {:else if section === 'operations'}
        <div class="page-heading"><div><div class="eyebrow">APPLICATION CONSOLE</div><h1>Operations</h1><p>Explore validated operations available in this workspace.</p></div><span class="live-pill" class:offline={liveStatus === 'offline'} class:reconnecting={liveStatus === 'reconnecting'}><span></span> {liveStatus === 'connected' ? 'Live updates' : liveStatus === 'reconnecting' ? 'Reconnecting' : liveStatus === 'offline' ? 'Live updates offline' : 'Connecting'}</span></div>
        {#if manifest}
          <div class="workspace-grid">
            <OperationList {operations} selected={selectedOperation} selectedKind={selectedOperationKind} protocolVersion={manifest.protocolVersion} onSelect={chooseOperation} />
            <section class="panel detail-panel">
              {#if currentOperation}
                <div class="panel-heading detail-heading"><div><div class="eyebrow">{currentOperation.kind.toUpperCase()}</div><h2>{currentVariant?.title ?? currentOperation.name}</h2><p>{currentVariant?.subtitle ?? currentOperation.name}</p></div><span class="kind-tag">{currentOperation.kind}</span></div>
                {#if currentOperation.ui?.variants && Object.keys(currentOperation.ui.variants).length > 1}
                  <div class="variant-tabs">{#each Object.entries(currentOperation.ui.variants) as [name, variant]}<button class:chosen={selectedVariant === name} onclick={() => useVariant(name)}>{variant.title}</button>{/each}</div>
                {/if}
                {#if currentVariant?.helpText}<p class="help-text">{currentVariant.helpText}</p>{/if}
                <OperationInput operation={currentOperation} variant={currentVariant} {inputText} onInputChange={editOperationInput} />
                <div class="actions"><button class="primary" onclick={() => runOperation()} disabled={loading}>{loading ? 'Running…' : currentOperation.kind === 'query' ? 'Run query' : currentOperation.kind === 'mutation' ? 'Run mutation' : 'Launch task'}</button>{#if isTask && manifest?.capabilities?.schedulesManage}<button class="secondary" onclick={() => scheduleDialogOpen = true}>Schedule task</button>{/if}</div>
                {#if result !== null}
                  {#if currentVariant?.renderer === 'table' && isPage(result)}
                    <div class="table-result"><div class="result-heading"><h3>{result.totalCount ?? result.rows.length} results</h3><span>LIVE</span></div>
                        {#if result.rows.length}<DataTable rows={result.rows} columns={rowColumns(result.rows[0]!)} actions={currentVariant?.actions ?? []} display={displayCell} onAction={(row, action) => editRow(row, action)} />{:else}<div class="empty"><p>No rows returned.</p></div>{/if}
                      {#if result.nextCursor || cursorStack.length}<div class="pagination"><button class="secondary" onclick={previousPage} disabled={!cursorStack.length}>Previous</button><button class="secondary" onclick={nextPage} disabled={!result.nextCursor}>Next page</button></div>{/if}
                    </div>
                  {:else if currentVariant?.renderer.startsWith('chat')}
                    <ChatView variant={currentVariant} {result} {inputText} contextKey={`${applicationId}:${workspaceId}:${selectedOperationKind}:${selectedOperation}:${selectedVariant}`} sending={chatSending} followToken={chatFollowToken} onSend={sendChatMessage} onAction={openChatAction} onLoadOlder={loadOperationOlderMessages} />
                  {:else}<div class="result-heading"><h3>{isTask ? 'Launch result' : 'Result'}</h3><span>Rich JSON</span></div><pre class="result">{richJson(result)}</pre>{/if}
                {/if}
              {:else}<div class="empty"><h2>Select an operation</h2><p>Choose an operation to inspect or run it.</p></div>{/if}
            </section>
          </div>
        {:else}<div class="loading-card">Loading workspace manifest…</div>{/if}
      {:else if section === 'tasks'}
        <div class="page-heading"><div><div class="eyebrow">BACKGROUND WORK</div><h1>Task runs</h1><p>Inspect queued, running and completed tasks.</p></div><button class="secondary" onclick={() => void loadSection()}>Refresh</button></div>
         <div class="panel data-panel">{#if runs.length}<div class="data-table"><div class="data-header"><span>Task</span><span>Status</span><span>Progress</span><span>Started</span></div>{#each runs as run}<div class="data-row"><strong>{String(run.operation)}</strong><span class="status" class:success={run.status === 'succeeded'}>{String(run.status)}</span><span>{run.progress == null ? '—' : `${run.progress}%`}</span><span>{String(run.startedAt ?? '')}</span></div>{#if run.result !== undefined || run.error}<details class="run-details"><summary>View result / error</summary><pre>{richJson(run.result ?? run.error)}</pre></details>{/if}{/each}</div>{:else}<div class="empty"><h2>No task runs yet</h2><p>Launch a task from Operations to see its run here.</p></div>{/if}</div>
       {:else if section === 'agents'}
         <div class="page-heading"><div><div class="eyebrow">AGENT OBSERVABILITY</div><h1>Agent runs</h1><p>Inspect authorized runs, tool calls, model steps, and results.</p></div><button class="secondary" onclick={() => void applyAgentFilters()}>Refresh</button></div>
         <div class="agent-filters panel">
           <label>Agent<input bind:value={agentNameFilter} placeholder="Any agent" /></label>
           <label>Status<select bind:value={agentStatusFilter}><option value="">Any status</option><option value="queued">Queued</option><option value="running">Running</option><option value="succeeded">Succeeded</option><option value="failed">Failed</option><option value="interrupted">Interrupted</option></select></label>
           {#if manifest?.capabilities?.agentRunsReadAll}<label>Actor ID<input bind:value={agentActorFilter} placeholder="Any actor" /></label>{/if}
           <label>Conversation ID<input bind:value={agentConversationFilter} placeholder="Any conversation" /></label>
           <button class="secondary" onclick={() => void applyAgentFilters()}>Filter</button>
         </div>
         <div class="agent-layout">
           <section class="panel agent-run-list" aria-label="Agent run list">
             {#if agentRuns.length}
               {#each agentRuns as run (run.id)}
                 <button class="agent-run-row" class:selected={selectedAgentRun?.id === run.id} onclick={() => void chooseAgentRun(run)}>
                   <strong>{run.agent}</strong><span class="status" class:success={run.status === 'succeeded'}>{run.status}</span>
                   <small>{run.actorId} · {new Date(run.createdAt).toLocaleString()}</small>
                 </button>
               {/each}
               {#if agentRunCursor}<button class="text-button load-more" onclick={() => void loadAgentRuns(agentRunCursor ?? undefined)}>Load more runs</button>{/if}
             {:else}<div class="empty"><h2>No agent runs</h2><p>Runs visible to your account will appear here.</p></div>{/if}
           </section>
           <section class="panel agent-run-detail">
             {#if selectedAgentRun}
               <div class="panel-heading"><div><div class="eyebrow">{selectedAgentRun.agent}</div><h2>Run details</h2><p>{selectedAgentRun.id}</p></div><span class="status" class:success={selectedAgentRun.status === 'succeeded'}>{selectedAgentRun.status}</span></div>
               <dl class="agent-metadata"><div><dt>Actor</dt><dd>{selectedAgentRun.actorId}</dd></div><div><dt>Created</dt><dd>{new Date(selectedAgentRun.createdAt).toLocaleString()}</dd></div><div><dt>Duration</dt><dd>{selectedAgentRun.startedAt && selectedAgentRun.finishedAt ? `${Date.parse(selectedAgentRun.finishedAt) - Date.parse(selectedAgentRun.startedAt)} ms` : '—'}</dd></div>{#if selectedAgentRun.conversationId}<div><dt>Conversation</dt><dd>{selectedAgentRun.conversationId}</dd></div>{/if}</dl>
               {#if selectedAgentRun.error}<div class="alert"><p>{selectedAgentRun.error.code}: {selectedAgentRun.error.message}</p></div>{/if}
               {#if selectedAgentRun.result !== undefined}<details class="run-details" open><summary>Final result</summary><pre>{richJson(selectedAgentRun.result)}</pre></details>{/if}
               <div class="agent-trace-heading"><h3>Trace</h3><button class="text-button" onclick={() => void chooseAgentRun(selectedAgentRun)}>Refresh trace</button></div>
               {#if agentEvents.length}<ol class="agent-trace">{#each agentEvents as event (event.id)}<li><div><strong>{event.type}</strong><time>{new Date(event.createdAt).toLocaleTimeString()}</time></div>{#if event.data !== undefined}<pre>{richJson(event.data)}</pre>{/if}</li>{/each}</ol>
               {:else}<div class="empty"><p>No trace events are currently visible.</p></div>{/if}
               {#if agentEventsCursor}<button class="text-button load-more" onclick={() => void loadMoreAgentEvents()}>Load later trace events</button>{/if}
             {:else}<div class="empty"><h2>Select an agent run</h2><p>Trace fields are filtered by your assigned capabilities.</p></div>{/if}
           </section>
         </div>
       {:else if section === 'schedules'}
        <div class="page-heading"><div><div class="eyebrow">AUTOMATION</div><h1>Schedules</h1><p>Manage recurring and one-off task schedules.</p></div><button class="secondary" onclick={() => void loadSection()}>Refresh</button></div>
          <div class="panel data-panel">{#if schedules.length}<div class="data-table"><div class="data-header schedule-cols"><span>Task</span><span>Pattern</span><span>Timezone</span><span>Next run</span><span>{manifest?.capabilities?.schedulesManage ? 'Manage' : ''}</span></div>{#each schedules as schedule}<div class="data-row schedule-cols"><strong>{String(schedule.operation)}</strong>{#if schedule.kind === 'recurring'}<input aria-label={`Cron for ${schedule.operation}`} value={scheduleDrafts[String(schedule.id)]?.cron ?? String(schedule.cron)} oninput={(event) => scheduleDrafts[String(schedule.id)] = { ...scheduleDrafts[String(schedule.id)], cron: event.currentTarget.value }} disabled={!manifest?.capabilities?.schedulesManage} />{:else}<span>{String(schedule.runAt)}</span>{/if}<input aria-label={`Timezone for ${schedule.operation}`} value={scheduleDrafts[String(schedule.id)]?.timezone ?? String(schedule.timezone)} oninput={(event) => scheduleDrafts[String(schedule.id)] = { ...scheduleDrafts[String(schedule.id)], timezone: event.currentTarget.value }} disabled={!manifest?.capabilities?.schedulesManage} /><span>{String(schedule.nextRunAt ?? '—')}</span>{#if manifest?.capabilities?.schedulesManage}<span class="schedule-actions"><button class="text-button" onclick={() => void saveSchedule(schedule)}>Save</button><button class="text-button" onclick={() => void toggleSchedule(schedule)}>{schedule.enabled ? 'Disable' : 'Enable'}</button><button class="text-button" onclick={() => void deleteSchedule(schedule.id)}>Remove</button></span>{/if}</div>{#if schedule.lastSkipReason}<div class="skip-reason">{String(schedule.lastSkipReason)}</div>{/if}{/each}</div>{:else}<div class="empty"><h2>No schedules</h2><p>Choose a task operation and schedule it from the operations console.</p></div>{/if}</div>
      {:else}
        <div class="page-heading"><div><div class="eyebrow">AUDIT</div><h1>Operation history</h1><p>Recent execution outcomes for this workspace.</p></div><button class="secondary" onclick={() => void loadSection()}>Refresh</button></div>
        <div class="panel data-panel">{#if history.length}<div class="data-table"><div class="data-header"><span>Operation</span><span>Kind</span><span>Status</span><span>Actor</span><span>Duration</span></div>{#each history as entry}<div class="data-row"><strong>{String(entry.operation)}</strong><span>{String(entry.kind)}</span><span class="status" class:success={entry.status === 'succeeded'}>{String(entry.status)}</span><span>{String(entry.actorId)}</span><span>{entry.durationMs == null ? '—' : `${entry.durationMs} ms`}</span></div>{/each}</div>{:else}<div class="empty"><h2>No operation history</h2><p>Successful and failed operations will appear here.</p></div>{/if}</div>
      {/if}
    </div>
  </main>
</div>

{#if scheduleDialogOpen && currentOperation?.kind === 'task'}
  <div class="modal-backdrop" role="presentation" onclick={(event) => { if (event.target === event.currentTarget) scheduleDialogOpen = false; }}>
    <dialog open class="schedule-modal" aria-labelledby="schedule-title">
      <div class="panel-heading"><div><div class="eyebrow">AUTOMATION</div><h2 id="schedule-title">Schedule {currentOperation.name}</h2><p>Runs use this workspace and your current identity.</p></div><button class="text-button" onclick={() => scheduleDialogOpen = false} aria-label="Close">×</button></div>
      <div class="schedule-form">
        <label class="field-label">Schedule type<select bind:value={scheduleKind}><option value="recurring">Recurring</option><option value="once">One time</option></select></label>
        {#if scheduleKind === 'recurring'}<label class="field-label">Cron expression<input bind:value={scheduleCron} placeholder="0 9 * * *" /><span>Five fields: minute hour day month weekday.</span></label>{:else}<label class="field-label">Run at<input type="datetime-local" bind:value={scheduleRunAt} required /></label>{/if}
        <label class="field-label">Timezone<input bind:value={scheduleTimezone} required /></label>
        <p class="schema-hint">Missed recurring runs are skipped. A schedule will not overlap its previous run.</p>
        <div class="actions"><button class="primary" onclick={() => void createSchedule()}>Create schedule</button><button class="secondary" onclick={() => scheduleDialogOpen = false}>Cancel</button></div>
      </div>
    </dialog>
  </div>
{/if}
