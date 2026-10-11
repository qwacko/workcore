<script lang="ts">
  import { createFetchTransport, type UiMetadata, type WorkcoreManifest, type WorkcoreTransport } from '@workcore/client';
  import { superjsonCodec } from '@workcore/codec-superjson';
  import { editableJson, parseEditableJson, hydrateRuntimeTypes } from './rich-input.js';

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
  let selectedVariant = $state('');
  let inputText = $state('{}');
  let result = $state.raw<unknown>(null);
  let error = $state('');
  let loading = $state(false);
  let section = $state<'operations' | 'tasks' | 'schedules' | 'history'>('operations');
  let runs = $state<Array<Record<string, unknown>>>([]);
  let schedules = $state<Array<Record<string, unknown>>>([]);
  let history = $state<Array<Record<string, unknown>>>([]);
  let unsubscribe: (() => void) | undefined;
  let cursorStack = $state<string[]>([]);
  let queryRefreshInFlight = false;
  let queryRefreshPending = false;
  let queryGeneration = 0;
  let workspaceRequestGeneration = 0;
  let sectionRequestGeneration = 0;
  let scheduleDialogOpen = $state(false);
  let scheduleKind = $state<'recurring' | 'once'>('recurring');
  let scheduleCron = $state('0 9 * * *');
  let scheduleRunAt = $state('');
  let scheduleTimezone = $state(Intl.DateTimeFormat().resolvedOptions().timeZone);

  const operations = $derived(manifest?.operations ?? []);
  const currentOperation = $derived(operations.find((operation) => operation.name === selectedOperation));
  const currentVariant = $derived(currentOperation?.ui?.variants[selectedVariant || currentOperation.ui.default]);
  const isTask = $derived(currentOperation?.kind === 'task');

  $effect(() => {
    void loadApplications();
    return () => unsubscribe?.();
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
    workspaceRequestGeneration++;
    sectionRequestGeneration++;
    queryGeneration++;
    queryRefreshPending = false;
    loading = false;
    workspaceId = '';
    manifest = null;
    result = null;
    await loadWorkspaces();
  }

  async function selectWorkspace() {
    const generation = ++workspaceRequestGeneration;
    queryGeneration++;
    sectionRequestGeneration++;
    queryRefreshPending = false;
    loading = false;
    unsubscribe?.();
    manifest = null;
    result = null;
    if (!workspaceId) return;
    const requestApplicationId = applicationId;
    const requestWorkspaceId = workspaceId;
    try {
      const loadedManifest = await transport.manifest(requestApplicationId, requestWorkspaceId);
      if (generation !== workspaceRequestGeneration || applicationId !== requestApplicationId || workspaceId !== requestWorkspaceId) return;
      manifest = loadedManifest;
      const first = loadedManifest.operations[0];
      selectedOperation = first?.name ?? '';
      selectedVariant = first?.ui?.default ?? '';
      syncInput(first?.input);
      updateAddress();
      unsubscribe = transport.subscribe(applicationId, workspaceId, {
        onInvalidate: () => {
          if (generation !== workspaceRequestGeneration) return;
          if (section === 'operations') {
            if (currentOperation?.kind === 'query') void runSelectedQuery(false);
          } else void loadSection();
        },
        onReady: () => { if (generation === workspaceRequestGeneration && currentOperation?.kind === 'query') void runSelectedQuery(false); },
        onError: (cause) => { if (generation === workspaceRequestGeneration && !cause.message.includes('reconnecting')) error = cause.message; },
      });
      await loadSection();
      if (generation !== workspaceRequestGeneration || applicationId !== requestApplicationId || workspaceId !== requestWorkspaceId) return;
      if (first?.kind === 'query') await runOperation(false);
    } catch (cause) {
      if (generation === workspaceRequestGeneration && applicationId === requestApplicationId && workspaceId === requestWorkspaceId) error = message(cause);
    }
  }

  function chooseOperation(name: string) {
    queryGeneration++;
    queryRefreshPending = false;
    loading = false;
    selectedOperation = name;
    const operation = operations.find((candidate) => candidate.name === name);
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

  function richJson(value: unknown) {
    const seen = new WeakSet<object>();
    const render = (item: unknown, depth = 0): unknown => {
      if (depth > 64) return '[Circular or deeply nested value]';
      if (typeof item === 'bigint') return `${item}n`;
      if (typeof item === 'undefined') return '[undefined]';
      if (typeof item === 'symbol') return String(item);
      if (typeof item === 'function') return `[Function${item.name ? ` ${item.name}` : ''}]`;
      if (typeof item === 'number' && !Number.isFinite(item)) return { $type: 'Number', value: String(item) };
      if (item instanceof Date) return { $type: 'Date', value: item.toISOString() };
      if (item instanceof RegExp) return { $type: 'RegExp', value: String(item) };
      if (item instanceof URL) return { $type: 'URL', value: String(item) };
      if (item instanceof Error) return { $type: 'Error', name: item.name, message: item.message };
      if (!item || typeof item !== 'object') return item;
      if (seen.has(item)) return '[Circular reference]';
      seen.add(item);
      if (item instanceof Map) return { $type: 'Map', entries: [...item.entries()].map(([key, child]) => [render(key, depth + 1), render(child, depth + 1)]) };
      if (item instanceof Set) return { $type: 'Set', values: [...item].map((child) => render(child, depth + 1)) };
      if (Array.isArray(item)) return item.map((child) => render(child, depth + 1));
      return Object.fromEntries(Object.entries(item).map(([key, child]) => [key, render(child, depth + 1)]));
    };
    try { return JSON.stringify(render(value), null, 2); }
    catch (cause) { return `Unable to render result: ${message(cause)}`; }
  }

  function displayCell(value: unknown) {
    if (value == null) return '—';
    if (value instanceof Date) return value.toISOString();
    if (typeof value === 'bigint') return `${value}n`;
    if (value instanceof Map) return `Map(${value.size})`;
    if (value instanceof Set) return `Set(${value.size})`;
    if (typeof value === 'object') return richJson(value);
    return String(value);
  }

  function editableFieldValue(value: unknown) {
    return value instanceof Date ? value.toISOString() : String(value ?? '');
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
    error = '';
    if (showPending) loading = true;
    try {
      const input = parseOperationInput(operation);
      if (operation.kind === 'mutation') result = await transport.request({ path: 'mutate', applicationId, workspaceId, operation: operation.name, input });
      else result = await transport.request({ path: 'enqueue', applicationId, workspaceId, operation: operation.name, input });
      await loadSection();
    } catch (cause) { error = message(cause); }
    finally { loading = false; }
  }

  async function runSelectedQuery(showPending: boolean) {
    const operation = currentOperation;
    if (!operation || operation.kind !== 'query') return;
    if (queryRefreshInFlight) {
      queryGeneration++;
      queryRefreshPending = true;
      return;
    }

    const generation = ++queryGeneration;
    const operationName = operation.name;
    const requestApplicationId = applicationId;
    const requestWorkspaceId = workspaceId;
    queryRefreshInFlight = true;
    error = '';
    if (showPending) loading = true;
    try {
      const input = parseOperationInput(operation);
      const value = await transport.request({ path: 'query', applicationId: requestApplicationId, workspaceId: requestWorkspaceId, operation: operationName, input });
      if (generation === queryGeneration && selectedOperation === operationName && applicationId === requestApplicationId && workspaceId === requestWorkspaceId) result = value;
    } catch (cause) {
      if (generation === queryGeneration && selectedOperation === operationName && applicationId === requestApplicationId && workspaceId === requestWorkspaceId) error = message(cause);
    } finally {
      queryRefreshInFlight = false;
      loading = false;
      if (queryRefreshPending) {
        queryRefreshPending = false;
        if (currentOperation?.kind === 'query') void runSelectedQuery(false);
      }
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

  function useVariant(name: string) { selectedVariant = name; }
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
  function basicFields(properties: Record<string, Record<string, unknown>>) {
    return Object.values(properties).every((schema) => ['string', 'number', 'integer', 'boolean'].includes(String(schema.type)) || Array.isArray(schema.enum));
  }
  function editRow(row: Record<string, unknown>, action: NonNullable<NonNullable<UiMetadata['variants'][string]>['actions']>[number]) {
    const mutationOperation = operations.find((operation) => operation.name === action.mutation && operation.kind === 'mutation');
    if (!mutationOperation) { error = `Unknown row action mutation: ${action.mutation}`; return; }
    selectedOperation = mutationOperation.name;
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
  function updateAddress() {
    const url = new URL(location.href);
    url.searchParams.set('applicationId', applicationId);
    url.searchParams.set('workspaceId', workspaceId);
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
    <div class="side-label nav-label">CONSOLE</div>
    <nav>
      <button class:active={section === 'operations'} onclick={() => { section = 'operations'; void loadSection(); }}>◫ <span>Operations</span></button>
      <button class:active={section === 'tasks'} onclick={() => { section = 'tasks'; void loadSection(); }}>◷ <span>Task runs</span></button>
      <button class:active={section === 'schedules'} onclick={() => { section = 'schedules'; void loadSection(); }}>▤ <span>Schedules</span></button>
      <button class:active={section === 'history'} onclick={() => { section = 'history'; void loadSection(); }}>◴ <span>History</span></button>
    </nav>
    <div class="sidebar-bottom"><span class="connection-dot"></span>Connected <span class="version">v1 protocol</span></div>
  </aside>

  <main class="main">
    <header class="topbar"><div><span class="breadcrumb">{applicationId}</span><span class="slash">/</span><span>{workspaceId || 'No workspace'}</span></div><span class="avatar">{workspaceId.slice(0, 1).toUpperCase() || 'W'}</span></header>
    <div class="content">
      {#if error}<div class="alert"><span>Something needs attention</span><p>{error}</p><button onclick={() => error = ''} aria-label="Dismiss">×</button></div>{/if}
      {#if !workspaces.length && !error}<div class="empty"><h1>No workspace access</h1><p>Sign in with an account that belongs to a Workcore workspace.</p></div>
      {:else if section === 'operations'}
        <div class="page-heading"><div><div class="eyebrow">APPLICATION CONSOLE</div><h1>Operations</h1><p>Explore validated operations available in this workspace.</p></div><span class="live-pill"><span></span> Live updates</span></div>
        {#if manifest}
          <div class="workspace-grid">
            <section class="panel operation-panel">
              <div class="panel-heading"><div><h2>Available operations</h2><p>{operations.length} exposed operations</p></div><span class="protocol">Protocol {manifest.protocolVersion}</span></div>
              <div class="operation-list">
                {#each operations as operation}
                  <button class="operation-row" class:selected={selectedOperation === operation.name} onclick={() => chooseOperation(operation.name)}>
                    <span class="kind-icon" class:query={operation.kind === 'query'} class:mutation={operation.kind === 'mutation'} class:task={operation.kind === 'task'}>{operation.kind === 'query' ? '⌕' : operation.kind === 'mutation' ? '✎' : '↗'}</span>
                    <span class="operation-name"><strong>{operation.ui?.variants[operation.ui.default]?.title ?? operation.name}</strong><small>{operation.name}</small></span>
                    <span class="kind-tag">{operation.kind}</span>
                  </button>
                {/each}
              </div>
            </section>
            <section class="panel detail-panel">
              {#if currentOperation}
                <div class="panel-heading detail-heading"><div><div class="eyebrow">{currentOperation.kind.toUpperCase()}</div><h2>{currentVariant?.title ?? currentOperation.name}</h2><p>{currentVariant?.subtitle ?? currentOperation.name}</p></div><span class="kind-tag">{currentOperation.kind}</span></div>
                {#if currentOperation.ui?.variants && Object.keys(currentOperation.ui.variants).length > 1}
                  <div class="variant-tabs">{#each Object.entries(currentOperation.ui.variants) as [name, variant]}<button class:chosen={selectedVariant === name} onclick={() => useVariant(name)}>{variant.title}</button>{/each}</div>
                {/if}
                {#if currentVariant?.helpText}<p class="help-text">{currentVariant.helpText}</p>{/if}
                {#if currentOperation.kind !== 'query' || currentOperation.input.properties}
                  {@const properties = currentOperation.input.properties as Record<string, Record<string, unknown>> | undefined}
                  {#if (currentVariant?.renderer === 'form' || currentVariant?.renderer === 'table') && properties && Object.keys(properties).length > 0 && basicFields(properties)}
                    <div class="generated-form">
                      {#each Object.entries(properties) as [key, schema]}
                        {@const value = currentInput()[key]}
                        {@const required = ((currentOperation.input.required as string[] | undefined) ?? []).includes(key)}
                        <label class="field-label">{key}<span>{required ? 'Required' : 'Optional'}</span>
                          {#if Array.isArray(schema.enum)}
                            <select value={String(value ?? (((currentOperation.input.required as string[] | undefined) ?? []).includes(key) ? schema.enum[0] : ''))} onchange={(event) => { if (event.currentTarget.value) setField(key, event.currentTarget.value); else { const input = currentInput(); delete input[key]; inputText = JSON.stringify(input, null, 2); } }}>
                              {#if !required}<option value="">Any</option>{/if}
                              {#each schema.enum as choice}<option value={String(choice)}>{String(choice)}</option>{/each}
                            </select>
                          {:else if schema.type === 'boolean'}
                            <span class="checkbox-field"><input type="checkbox" checked={Boolean(value)} onchange={(event) => setField(key, event.currentTarget.checked)} /> Enabled</span>
                          {:else}
                             <input type={schema.type === 'number' || schema.type === 'integer' ? 'number' : 'text'} value={editableFieldValue(value)} required={required} oninput={(event) => setField(key, schema.type === 'number' || schema.type === 'integer' ? Number(event.currentTarget.value) : event.currentTarget.value)} />
                          {/if}
                        </label>
                      {/each}
                      <div class="schema-hint">Validated by the operation schema on the server.</div>
                    </div>
                  {:else}
                    <div class="input-editor"><label for="input">Input <span>JSON / rich-value envelope</span></label><textarea id="input" bind:value={inputText} spellcheck="false" rows="9"></textarea><div class="schema-hint">Plain JSON is accepted; row actions use a SuperJSON envelope when bound values include rich types.</div></div>
                  {/if}
                {/if}
                <div class="actions"><button class="primary" onclick={() => runOperation()} disabled={loading}>{loading ? 'Running…' : currentOperation.kind === 'query' ? 'Run query' : currentOperation.kind === 'mutation' ? 'Run mutation' : 'Launch task'}</button>{#if isTask}<button class="secondary" onclick={() => scheduleDialogOpen = true}>Schedule task</button>{/if}</div>
                {#if result !== null}
                  {#if currentVariant?.renderer === 'table' && isPage(result)}
                    <div class="table-result"><div class="result-heading"><h3>{result.totalCount ?? result.rows.length} results</h3><span>LIVE</span></div>
                       {#if result.rows.length}<div class="table-scroll"><table><thead><tr>{#each rowColumns(result.rows[0]!) as column}<th>{column}</th>{/each}<th></th></tr></thead><tbody>{#each result.rows as row}<tr>{#each rowColumns(row) as column}<td>{displayCell(row[column])}</td>{/each}<td class="row-actions">{#each currentVariant?.actions ?? [] as action}<button class="text-button" onclick={() => editRow(row, action)}>{action.label}</button>{/each}</td></tr>{/each}</tbody></table></div>{:else}<div class="empty"><p>No rows returned.</p></div>{/if}
                      {#if result.nextCursor || cursorStack.length}<div class="pagination"><button class="secondary" onclick={previousPage} disabled={!cursorStack.length}>Previous</button><button class="secondary" onclick={nextPage} disabled={!result.nextCursor}>Next page</button></div>{/if}
                    </div>
                  {:else}<div class="result-heading"><h3>{isTask ? 'Launch result' : 'Result'}</h3><span>Rich JSON</span></div><pre class="result">{richJson(result)}</pre>{/if}
                {/if}
              {:else}<div class="empty"><h2>Select an operation</h2><p>Choose an operation to inspect or run it.</p></div>{/if}
            </section>
          </div>
        {:else}<div class="loading-card">Loading workspace manifest…</div>{/if}
      {:else if section === 'tasks'}
        <div class="page-heading"><div><div class="eyebrow">BACKGROUND WORK</div><h1>Task runs</h1><p>Inspect queued, running and completed tasks.</p></div><button class="secondary" onclick={() => void loadSection()}>Refresh</button></div>
         <div class="panel data-panel">{#if runs.length}<div class="data-table"><div class="data-header"><span>Task</span><span>Status</span><span>Progress</span><span>Started</span></div>{#each runs as run}<div class="data-row"><strong>{String(run.operation)}</strong><span class="status" class:success={run.status === 'succeeded'}>{String(run.status)}</span><span>{run.progress == null ? '—' : `${run.progress}%`}</span><span>{String(run.startedAt ?? '')}</span></div>{#if run.result !== undefined || run.error}<details class="run-details"><summary>View result / error</summary><pre>{richJson(run.result ?? run.error)}</pre></details>{/if}{/each}</div>{:else}<div class="empty"><h2>No task runs yet</h2><p>Launch a task from Operations to see its run here.</p></div>{/if}</div>
      {:else if section === 'schedules'}
        <div class="page-heading"><div><div class="eyebrow">AUTOMATION</div><h1>Schedules</h1><p>Manage recurring and one-off task schedules.</p></div><button class="secondary" onclick={() => void loadSection()}>Refresh</button></div>
        <div class="panel data-panel">{#if schedules.length}<div class="data-table"><div class="data-header schedule-cols"><span>Task</span><span>Pattern</span><span>Timezone</span><span>Next run</span><span>Manage</span></div>{#each schedules as schedule}<div class="data-row schedule-cols"><strong>{String(schedule.operation)}</strong><span>{String(schedule.cron ?? schedule.runAt)}</span><span>{String(schedule.timezone)}</span><span>{String(schedule.nextRunAt ?? '—')}</span><span class="schedule-actions"><button class="text-button" onclick={() => void toggleSchedule(schedule)}>{schedule.enabled ? 'Disable' : 'Enable'}</button><button class="text-button" onclick={() => void deleteSchedule(schedule.id)}>Remove</button></span></div>{#if schedule.lastSkipReason}<div class="skip-reason">{String(schedule.lastSkipReason)}</div>{/if}{/each}</div>{:else}<div class="empty"><h2>No schedules</h2><p>Choose a task operation and schedule it from the operations console.</p></div>{/if}</div>
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
