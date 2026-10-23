<script lang="ts">
  import type { AdminBlock, AgentRun, AgentRunStatus, AgentTraceEvent, ChatAction, ChatActionMapping, ChatMessage, CollectionViewOptions } from '@workcore/core';
  import type { OperationViews } from '@workcore/client';
  import type { WorkcoreManifest } from '@workcore/client';
  import CollectionView from './CollectionView.svelte';
  import DataTable from './DataTable.svelte';
  import ChatView from './ChatView.svelte';
  import OperationInput from './OperationInput.svelte';
  import { editableJson, parseEditableJson, richJson } from './rich-input.js';
  import { CollectionEditorController } from './collection-editor.js';
  import type { QuerySourceSnapshot } from './query-source.js';
  import AgentRunsView from './AgentRunsView.svelte';
  import MutationForm from './MutationForm.svelte';
  import ChartView from './ChartView.svelte';

  let { block, result, contextKey, error = '', loading = false, hasResult, queryState, resourceState, scheduleManage = false, scheduleDrafts = {}, agentRuns = [], selectedAgentRun = null, agentEvents = [], agentEventsCursor = null, agentRunCursor = null, agentStatusFilter = '', agentNameFilter = '', agentActorFilter = '', agentConversationFilter = '', canReadAllAgentRuns = false, chatSending = false, followToken = 0, cacheNamespace = 'default', hasPreviousPage = false, variant, editorVariant, inputText = '{}', queryOperation, editorOperation, mutationOperation, mutationVariant, showControls = true, onRefresh, onInputChange, onPage, onOpen, onMutationSubmit, onScheduleDraft, onScheduleAction, onScheduleCreate, onAgentFilter, onAgentSelect, onAgentApplyFilters, onAgentLoadMoreRuns, onAgentLoadMoreEvents, onRowAction, onChatSend, onChatAction, onLoadOlder, onChatQueryView, onChatNavigate, onThreadSearch, onThreadSelect, onLoadMoreThreads, onFilter, onSave, onEditorDirtyChange } = $props<{
    block: AdminBlock;
    contextKey: string;
    result?: unknown | undefined;
    error?: string | undefined;
    loading?: boolean | undefined;
    hasResult?: boolean | undefined;
    queryState?: QuerySourceSnapshot<unknown> | undefined;
    resourceState?: QuerySourceSnapshot<unknown> | undefined;
    scheduleManage?: boolean | undefined;
    scheduleDrafts?: Record<string, { cron?: string; timezone?: string }> | undefined;
    agentRuns?: AgentRun[] | undefined;
    selectedAgentRun?: AgentRun | null | undefined;
    agentEvents?: AgentTraceEvent[] | undefined;
    agentEventsCursor?: string | null | undefined;
    agentRunCursor?: string | null | undefined;
    agentStatusFilter?: AgentRunStatus | '' | undefined;
    agentNameFilter?: string | undefined;
    agentActorFilter?: string | undefined;
    agentConversationFilter?: string | undefined;
    canReadAllAgentRuns?: boolean | undefined;
    chatSending?: boolean | undefined;
    followToken?: number | undefined;
    cacheNamespace?: string | undefined;
    hasPreviousPage?: boolean | undefined;
    variant?: OperationViews['variants'][string] | undefined;
    editorVariant?: OperationViews['variants'][string] | undefined;
    queryOperation?: WorkcoreManifest['operations'][number] | undefined;
    editorOperation?: WorkcoreManifest['operations'][number] | undefined;
    mutationOperation?: (WorkcoreManifest['operations'][number] & { kind: 'mutation' }) | undefined;
    mutationVariant?: OperationViews['variants'][string] | undefined;
    showControls?: boolean | undefined;
    inputText?: string | undefined;
    onRefresh?: (() => void) | undefined;
    onInputChange?: ((value: string) => void) | undefined;
    onPage?: ((page?: { cursor?: string; offset?: number }) => void) | undefined;
    onOpen?: (() => void) | undefined;
    onMutationSubmit?: ((input: Record<string, unknown>) => Promise<void>) | undefined;
    onScheduleDraft?: ((id: string, field: 'cron' | 'timezone', value: string) => void) | undefined;
    onScheduleAction?: ((row: Record<string, unknown>, action: 'save' | 'toggle' | 'delete') => void) | undefined;
    onScheduleCreate?: (() => void) | undefined;
    onAgentFilter?: ((field: 'agent' | 'status' | 'actorId' | 'conversationId', value: string) => void) | undefined;
    onAgentSelect?: ((run: AgentRun) => void) | undefined;
    onAgentApplyFilters?: (() => void) | undefined;
    onAgentLoadMoreRuns?: (() => void) | undefined;
    onAgentLoadMoreEvents?: (() => void) | undefined;
    onRowAction?: ((row: Record<string, unknown>, action: NonNullable<OperationViews['variants'][string]['actions']>[number]) => void) | undefined;
    onChatSend?: ((message: string) => Promise<void>) | undefined;
    onChatAction?: ((action: ChatAction, mapping: ChatActionMapping) => void) | undefined;
    onLoadOlder?: ((cursor: string) => Promise<{ items: ChatMessage[]; previousCursor: string | null }>) | undefined;
    onChatQueryView?: ((query: string, view: string | undefined, input: unknown) => Promise<unknown>) | undefined;
    onChatNavigate?: ((page: string, state: Record<string, string>) => void) | undefined;
    onThreadSearch?: ((value: string) => void) | undefined;
    onThreadSelect?: ((thread: import('@workcore/core').ChatThread) => void) | undefined;
    onLoadMoreThreads?: ((cursor: string) => Promise<{ items: import('@workcore/core').ChatThread[]; nextCursor: string | null }>) | undefined;
    onFilter?: ((targetParam: string, value: unknown) => void) | undefined;
    onSave?: ((input: Record<string, unknown>) => Promise<unknown>) | undefined;
    onEditorDirtyChange?: ((dirty: boolean) => void) | undefined;
  }>();

  const resultAvailable = $derived(queryState?.hasResult ?? hasResult ?? result !== undefined);
  const displayError = $derived(queryState?.error?.message ?? error);
  const isLoading = $derived(queryState ? queryState.status === 'loading' || queryState.status === 'refreshing' : loading);
  const resourceIsLoading = $derived(resourceState ? resourceState.status === 'loading' || resourceState.status === 'refreshing' : loading);
  const resourceError = $derived(resourceState?.error?.message ?? error);

  let editorController = $state.raw<CollectionEditorController | null>(null);
  let editorState = $state.raw<ReturnType<CollectionEditorController['snapshot']>>({ selectedKey: null, selectedRecord: null, selectedMissing: false, draft: null, dirty: false, updateAvailable: false, submitting: false, error: null });
  let controllerContext: string | null = null;
  let editorInput = $state('{}');
  let editorParseError = $state('');

  $effect(() => {
    onEditorDirtyChange?.(editorState.dirty);
  });

  function format(value: unknown) {
    return richJson(value);
  }

  function collectionActions(collection: CollectionViewOptions, existingActions: OperationViews['variants'][string]['actions']): NonNullable<OperationViews['variants'][string]['actions']> {
    const actions = [...(existingActions ?? []), ...(collection.actions ?? [])];
    return actions.filter((action, index) => actions.findIndex((candidate) => candidate.label === action.label && candidate.mutation === action.mutation && candidate.variant === action.variant) === index);
  }

  function pageRows(value: unknown): Array<Record<string, unknown>> | undefined {
    if (!value || typeof value !== 'object' || !Array.isArray((value as { rows?: unknown }).rows)) return undefined;
    return (value as { rows: Array<Record<string, unknown>> }).rows;
  }

  function resourceRows(value: unknown): Array<Record<string, unknown>> | undefined {
    if (!Array.isArray(value)) return undefined;
    const fields = block.type !== 'resource' ? [] : block.resource === 'tasks'
      ? ['runId', 'operation', 'status', 'progress', 'startedAt', 'finishedAt', 'result', 'error']
      : block.resource === 'history'
        ? ['id', 'operation', 'kind', 'status', 'actorId', 'startedAt', 'durationMs', 'runId']
        : block.resource === 'schedules'
          ? ['id', 'operation', 'kind', 'enabled', 'cron', 'runAt', 'nextRunAt', 'timezone', 'lastSkipReason']
          : ['id', 'agent', 'status', 'actorId', 'createdAt', 'conversationId'];
    return value.filter((row): row is Record<string, unknown> => !!row && typeof row === 'object' && !Array.isArray(row))
      .map((row) => Object.fromEntries(fields.filter((field) => Object.hasOwn(row, field)).map((field) => [field, row[field]])));
  }

  function nextCursor(value: unknown): string | null {
    if (!value || typeof value !== 'object') return null;
    const cursor = (value as { nextCursor?: unknown }).nextCursor;
    return typeof cursor === 'string' ? cursor : null;
  }

  $effect(() => {
    const key = contextKey;
    if (controllerContext === null) controllerContext = key;
    else if (controllerContext !== key) {
      controllerContext = key;
      editorController = null;
      editorInput = '{}';
      editorParseError = '';
    }
    if (queryState?.error?.kind === 'forbidden') {
      editorController?.dispose();
      editorController = null;
      editorState = { selectedKey: null, selectedRecord: null, selectedMissing: false, draft: null, dirty: false, updateAvailable: false, submitting: false, error: null };
      editorInput = '{}';
      editorParseError = '';
      return;
    }
    const rows = pageRows(result);
    if (rows && editorController) {
      try { editorController.refresh(rows); }
      catch (cause) { editorState = { ...editorController.snapshot(), error: cause instanceof Error ? cause.message : String(cause) }; return; }
    }
    editorState = editorController?.snapshot() ?? { selectedKey: null, selectedRecord: null, selectedMissing: false, draft: null, dirty: false, updateAvailable: false, submitting: false, error: null };
  });

  function selectRow(row: Record<string, unknown>) {
    const collection = block.type === 'query' ? variant?.collection : undefined;
    if (!collection?.editor) return;
    if (!editorController) {
      editorController = new CollectionEditorController(collection);
      editorController.refresh(pageRows(result) ?? []);
    }
    try {
      if (!editorController.select(row, () => !editorState.dirty || window.confirm('Discard unsaved changes?'))) return;
      editorState = editorController.snapshot();
    } catch (cause) {
      editorState = { ...editorController.snapshot(), error: cause instanceof Error ? cause.message : String(cause) };
    }
    editorInput = editableJson(editorState.draft ?? {});
    editorParseError = '';
  }

  function fieldValue(object: unknown, field: string): unknown {
    return object && typeof object === 'object' && Object.hasOwn(object, field) ? (object as Record<string, unknown>)[field] : undefined;
  }

  function queryInputValue(field: string): unknown {
    try { return fieldValue(JSON.parse(inputText || '{}'), field); } catch { return undefined; }
  }

  async function save() {
    if (!onSave || !editorController || editorState.submitting) return;
    try {
      const parsed = parseEditableJson(editorInput) as Record<string, unknown>;
      editorController.updateDraft(parsed);
      const succeeded = await editorController.submit(onSave);
      if (succeeded) {
        editorController.discard();
        editorInput = '{}';
      }
      editorState = editorController.snapshot();
    } catch (cause) { editorParseError = cause instanceof Error ? cause.message : String(cause); }
  }

  function updateEditorInput(value: string) {
    editorInput = value;
    editorParseError = '';
    if (!editorController) return;
    try { editorController.updateDraft(parseEditableJson(value) as Record<string, unknown>); }
    catch { /* Invalid intermediate input remains in the editor and is reported on submit. */ }
    editorState = editorController.snapshot();
  }

  function discardEditor() {
    if (!editorController) return;
    const discarded = editorController.discard(() => !editorState.dirty || window.confirm('Discard unsaved changes?'));
    if (discarded) editorInput = '{}';
    editorState = editorController.snapshot();
  }

  function transitionCollection(action: () => void): boolean {
    if (editorController) {
      const discarded = editorController.discard(() => !editorState.dirty || window.confirm('Discard unsaved changes?'));
      if (!discarded) {
        editorState = editorController.snapshot();
        return false;
      }
      editorState = editorController.snapshot();
      editorInput = '{}';
      editorParseError = '';
    }
    action();
    return true;
  }

  function changeCollectionFilter(target: string, value: unknown): boolean {
    return transitionCollection(() => onFilter?.(target, value));
  }

  function changeCollectionPage(cursor?: string) {
    transitionCollection(() => onPage?.({ cursor }));
  }

  function changeOffsetPage(offset: number) {
    transitionCollection(() => onPage?.({ offset }));
  }

  function pageInputValue(field: string): number {
    try { const value = JSON.parse(inputText || '{}')[field]; return Number.isInteger(value) && value >= 0 ? value : 0; } catch { return 0; }
  }

</script>

<section class="panel custom-block" data-query-status={queryState?.status} data-query-failure={queryState?.error?.kind} data-query-stale={queryState?.stale ? 'true' : undefined}>
  {#if block.type === 'query'}
    {#if showControls}<div class="panel-heading"><div><h2>{variant?.title ?? block.operation}</h2><p>{variant?.subtitle ?? block.variant ?? 'Query result'}</p></div><button class="text-button" onclick={onRefresh} disabled={loading}>{loading ? 'Running…' : variant?.renderer === 'chat' ? 'Check now' : 'Run query'}</button></div>{/if}
    {#if showControls && variant?.renderer !== 'chat'}<details class="dashboard-input"><summary>Query input (JSON)</summary><textarea aria-label={`Input for ${block.operation}`} value={inputText} oninput={(event) => onInputChange?.(event.currentTarget.value)} spellcheck="false" rows="4"></textarea><small>Validated by the query schema on the server.</small></details>{/if}
    {#if variant?.renderer.startsWith('chat')}
       {#if isLoading}<p class="chat-live-note" role="status">Updating…</p>{/if}
       {#if displayError}<div class="alert" role="alert"><p>{displayError}</p></div>{/if}
      <ChatView {variant} {result} {contextKey} {inputText} sending={chatSending} {followToken} {cacheNamespace} onSend={onChatSend} onAction={onChatAction} {onLoadOlder} onQueryView={onChatQueryView} onNavigate={onChatNavigate} onThreadSearch={onThreadSearch} onThreadSelect={onThreadSelect} onLoadMoreThreads={onLoadMoreThreads} />
      {#if variant.renderer === 'chat-threads' && (nextCursor(result) || hasPreviousPage)}<div class="pagination"><button class="secondary" onclick={() => onPage?.()} disabled={!hasPreviousPage || loading}>Previous</button><button class="secondary" onclick={() => onPage?.(nextCursor(result) ?? undefined)} disabled={!nextCursor(result) || loading}>Next</button></div>{/if}
     {:else if isLoading && !resultAvailable}<div class="empty" role="status"><p>Loading…</p></div>
      {:else if displayError && !resultAvailable}<div class="alert" role="alert"><p>{displayError}</p></div>
      {:else if variant?.renderer === 'chart' && pageRows(result)}
        {#if isLoading}<p class="chat-live-note" role="status">Updating results…</p>{/if}
        {#if displayError}<div class="alert" role="alert"><p>{displayError}</p></div>{/if}
        <ChartView rows={pageRows(result)!} config={variant.chart!} title={variant.title} />
       {:else if variant?.renderer === 'table' && pageRows(result)}
        {@const rows = pageRows(result)!}
         {@const collection = block.type === 'query' ? variant?.collection : undefined}
         {@const columns = collection?.columns.map((column: CollectionViewOptions['columns'][number]) => column.field) ?? (variant.columns?.length ? variant.columns : Object.keys(rows[0] ?? {}))}
        {#if queryState?.stale}<p class="chat-live-note" role="status">Showing results from the previous query input.</p>{/if}
        {#if isLoading}<p class="chat-live-note" role="status">Updating results…</p>{/if}
        {#if displayError}<div class="alert" role="alert"><p>{displayError}</p></div>{/if}
        {#if collection?.columns.some((column: CollectionViewOptions['columns'][number]) => column.filter)}
         <div class="generated-form collection-filters">
            {#each collection.columns.filter((column: CollectionViewOptions['columns'][number]) => column.filter) as column}
             {@const filter = column.filter!}
             {@const target = filter.targetParam ?? column.field}
             {@const filterSchema = queryOperation?.input.properties && typeof queryOperation.input.properties === 'object' ? (queryOperation.input.properties as Record<string, Record<string, unknown>>)[target] : undefined}
             <label class="field-label">{column.label ?? column.field}
               {#if filter.type === 'select' && Array.isArray(filterSchema?.enum)}
                  <select value={String(queryInputValue(target) ?? '')} onchange={(event) => { const selected = event.currentTarget.value; const changed = changeCollectionFilter(target, selected === '' ? undefined : (filterSchema?.enum as unknown[] | undefined)?.find((choice) => String(choice) === selected)); if (!changed) event.currentTarget.value = String(queryInputValue(target) ?? ''); }}>
                   <option value="">All</option>{#each filterSchema.enum as choice}<option value={String(choice)}>{String(choice)}</option>{/each}
                 </select>
               {:else}
                  <input type="search" aria-label={`Filter ${column.label ?? column.field}`} value={String(queryInputValue(target) ?? '')} onchange={(event) => { const value = event.currentTarget.value; if (!changeCollectionFilter(target, value || undefined)) event.currentTarget.value = String(queryInputValue(target) ?? ''); }} />
               {/if}
             </label>
           {/each}
         </div>
       {/if}
             {#if collection}<CollectionView {rows} {columns} actions={collectionActions(collection, variant?.actions)} labels={Object.fromEntries(collection.columns.flatMap((column: CollectionViewOptions['columns'][number]) => column.label ? [[column.field, column.label]] : []))} displayHints={Object.fromEntries(collection.columns.flatMap((column: CollectionViewOptions['columns'][number]) => column.display ? [[column.field, column.display]] : []))} titleField={collection.titleField} subtitleField={collection.subtitleField} presentation={collection.presentation} onAction={onRowAction} onSelect={collection.editor ? selectRow : undefined} />{:else}<DataTable {rows} {columns} actions={variant?.actions ?? []} onAction={onRowAction} />{/if}
         {#if editorState.error && !editorState.selectedRecord}<div class="alert" role="alert"><p>{editorState.error}</p></div>{/if}
         {#if editorState.selectedRecord && collection?.editor}
           <section class="panel collection-editor" aria-label={`Edit ${String(fieldValue(editorState.selectedRecord, collection.itemKey) ?? 'record')}`}>
             <div class="panel-heading"><div><h3>Edit record</h3><p>Only mapped editor fields are submitted.</p></div><button class="text-button" onclick={discardEditor} disabled={editorState.submitting}>Cancel</button></div>
             {#if !editorOperation}<div class="alert" role="alert"><p>The configured editor mutation is unavailable to this account.</p></div>{/if}
             {#if editorState.selectedMissing}<div class="alert" role="status"><p>This record is no longer in the current result set. Discard the draft or change the filters to locate it.</p></div>{/if}
             {#if editorState.updateAvailable}<div class="chat-live-note" role="status">A newer server version is available; your draft was preserved.</div>{/if}
              {#if editorOperation}<OperationInput operation={editorOperation} variant={editorVariant} inputText={editorInput} onInputChange={updateEditorInput} />{/if}
             {#if editorParseError || editorState.error}<div class="alert" role="alert"><p>{editorParseError || editorState.error}</p></div>{/if}
             <div class="actions"><button class="primary" onclick={() => void save()} disabled={!editorOperation || editorState.submitting || editorState.selectedMissing}>{editorState.submitting ? 'Saving…' : 'Save changes'}</button></div>
           </section>
         {/if}
         {#if (!collection || collection.pagination !== false) && collection?.paginationMode === 'offset'}
           {@const total = result && typeof result === 'object' && Number.isInteger((result as { totalCount?: unknown }).totalCount) ? Number((result as { totalCount: number }).totalCount) : 0}
           {@const limit = Math.max(1, pageInputValue('limit') || 50)}
           {@const offset = pageInputValue('offset')}
           {@const pages = Math.max(1, Math.ceil(total / limit))}
           <div class="pagination"><button class="secondary" onclick={() => changeOffsetPage(Math.max(0, offset - limit))} disabled={offset <= 0 || loading}>Previous</button><label>Page <input aria-label="Page" type="number" min="1" max={pages} value={Math.floor(offset / limit) + 1} onchange={(event) => { const page = Math.min(pages, Math.max(1, Number(event.currentTarget.value) || 1)); changeOffsetPage((page - 1) * limit); }} disabled={loading} /> of {pages}</label><button class="secondary" onclick={() => changeOffsetPage(offset + limit)} disabled={offset + limit >= total || loading}>Next</button></div>
         {:else if (!collection || collection.pagination !== false) && (nextCursor(result) || hasPreviousPage)}<div class="pagination"><button class="secondary" onclick={() => changeCollectionPage()} disabled={!hasPreviousPage || loading}>Previous</button><button class="secondary" onclick={() => changeCollectionPage(nextCursor(result) ?? undefined)} disabled={!nextCursor(result) || loading}>Next</button></div>{/if}
     {:else if resultAvailable}<div class="query-result">
       {#if queryState?.stale}<p class="chat-live-note" role="status">Showing results from the previous query input.</p>{/if}
       {#if displayError}<div class="alert" role="alert"><p>{displayError}</p></div>{/if}
       {#if isLoading}<p class="chat-live-note" role="status">Updating result…</p>{/if}
       <pre class="result">{format(result)}</pre>
     </div>
    {:else}<div class="empty"><p>No result yet.</p></div>{/if}
  {:else if block.type === 'mutation-form'}
    {#if mutationOperation && onMutationSubmit}<MutationForm operation={mutationOperation} variant={mutationVariant} title={block.title} {contextKey} onSubmit={onMutationSubmit} />{:else}<div class="empty"><p>Mutation is not available.</p></div>{/if}
   {:else if block.type === 'task-launcher'}
     <div class="panel-heading"><div><h2>{block.title ?? block.operation}</h2><p>Launch a validated background task.</p></div><button class="primary" onclick={onOpen}>Launch task</button></div>
    {:else if block.type === 'resource'}
      {@const rows = resourceRows(result)}
     <div class="panel-heading"><div><h2>{block.title ?? block.resource}</h2><p>Authorized {block.resource} resource.</p></div><button class="secondary" onclick={onRefresh} disabled={resourceIsLoading}>{resourceIsLoading ? 'Refreshing…' : 'Refresh'}</button></div>
     {#if resourceIsLoading && !resultAvailable}<div class="empty" role="status"><p>Loading {block.resource}…</p></div>
     {:else if resourceError && !resultAvailable}<div class="alert" role="alert"><p>{resourceError}</p></div>
     {:else if rows}
       {#if resourceIsLoading}<p class="chat-live-note" role="status">Refreshing {block.resource}…</p>{/if}
       {#if resourceError}<div class="alert" role="alert"><p>{resourceError}</p></div>{/if}
         {#if block.resource === 'agents'}
           <AgentRunsView runs={agentRuns} selectedRun={selectedAgentRun} events={agentEvents} eventCursor={agentEventsCursor} runCursor={agentRunCursor} status={agentStatusFilter} agent={agentNameFilter} actorId={agentActorFilter} conversationId={agentConversationFilter} canReadAll={canReadAllAgentRuns} loading={resourceIsLoading} onFilter={(field, value) => onAgentFilter?.(field, value)} onSelectRun={(run) => onAgentSelect?.(run)} onApplyFilters={() => onAgentApplyFilters?.()} onLoadMoreRuns={() => onAgentLoadMoreRuns?.()} onLoadMoreEvents={() => onAgentLoadMoreEvents?.()} onRefresh={() => selectedAgentRun && onAgentSelect?.(selectedAgentRun)} />
         {:else if block.resource === 'schedules'}
          {#if scheduleManage}<div class="actions"><button class="primary" onclick={onScheduleCreate}>Create schedule</button></div>{/if}
          {#if rows.length}
            <div class="schedule-resource-list">
              {#each rows as schedule (String(schedule.id))}
                <article class="schedule-resource-card">
                  <div class="schedule-resource-heading"><strong>{String(schedule.operation)}</strong><span class="status" class:success={schedule.enabled === true}>{schedule.enabled ? 'Enabled' : 'Disabled'}</span></div>
                  <dl>
                    <div><dt>Pattern</dt><dd>{#if schedule.kind === 'recurring'}{#if scheduleManage}<input aria-label={`Cron for ${schedule.operation}`} value={scheduleDrafts[String(schedule.id)]?.cron ?? String(schedule.cron ?? '')} oninput={(event) => onScheduleDraft?.(String(schedule.id), 'cron', event.currentTarget.value)} />{:else}{String(schedule.cron ?? '—')}{/if}{:else}{String(schedule.runAt ?? '—')}{/if}</dd></div>
                    <div><dt>Timezone</dt><dd>{#if scheduleManage}<input aria-label={`Timezone for ${schedule.operation}`} value={scheduleDrafts[String(schedule.id)]?.timezone ?? String(schedule.timezone ?? 'UTC')} oninput={(event) => onScheduleDraft?.(String(schedule.id), 'timezone', event.currentTarget.value)} />{:else}{String(schedule.timezone ?? 'UTC')}{/if}</dd></div>
                    <div><dt>Next run</dt><dd>{String(schedule.nextRunAt ?? '—')}</dd></div>
                  </dl>
                  {#if schedule.lastSkipReason}<p class="skip-reason">{String(schedule.lastSkipReason)}</p>{/if}
                  {#if scheduleManage}<div class="schedule-actions"><button class="text-button" onclick={() => onScheduleAction?.(schedule, 'save')}>Save</button><button class="text-button" onclick={() => onScheduleAction?.(schedule, 'toggle')}>{schedule.enabled ? 'Disable' : 'Enable'}</button><button class="text-button" onclick={() => onScheduleAction?.(schedule, 'delete')}>Remove</button></div>{/if}
                </article>
              {/each}
            </div>
          {:else}<div class="empty"><p>No schedules yet. Create one to automate an authorized task.</p></div>{/if}
        {:else if rows.length}<CollectionView {rows} columns={Object.keys(rows[0] ?? {})} actions={[]} />{:else}<div class="empty"><p>No {block.resource} records.</p></div>{/if}
      {:else}<div class="empty"><p>Resource data is not available.</p></div>{/if}
    {:else}
      <div class="custom-component-placeholder" role="note">
        <div class="panel-heading"><div><h2>{block.title ?? block.component}</h2><p>{block.description ?? 'This renderer does not provide the configured component.'}</p></div></div>
        <p><code>{block.component}@{block.version}</code></p>
        <small>Custom component implementations are supplied by the renderer; configuration never loads remote code.</small>
      </div>
    {/if}
</section>

<style>
  :global(.semantic-badge) { display: inline-block; border-radius: 999px; padding: 3px 7px; background: #edf4ef; color: #276348; font-size: 10px; }
  .schedule-resource-list { display: grid; gap: 10px; margin-top: 12px; }
  .schedule-resource-card { border: 1px solid var(--line, #d9e0dc); border-radius: 12px; padding: 14px; }
  .schedule-resource-heading { display: flex; justify-content: space-between; gap: 12px; align-items: center; }
  .schedule-resource-card dl { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; margin: 12px 0 0; }
  .schedule-resource-card dt { color: var(--muted, #63716a); font-size: 12px; }
  .schedule-resource-card dd { margin: 4px 0 0; overflow-wrap: anywhere; }
  .schedule-resource-card input { width: 100%; min-width: 0; }
  .schedule-actions { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 10px; }
</style>
