// Self-contained browser JavaScript, embedded by the Worker. No runtime dependency or CDN.
// Keep untrusted content in textContent; never interpolate it into HTML.
export const consoleScript = String.raw`
const { base } = JSON.parse(document.querySelector('#config').textContent);
const nav = document.querySelector('#nav');
const body = document.querySelector('#body');
let socket;
let refreshTimer;
let generation = 0;
let canManage = false;

function node(tag, text, className) {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (className) element.className = className;
  return element;
}

function showError(error) {
  body.querySelector('.error')?.remove();
  body.append(node('p', error.message || String(error), 'error'));
}

async function api(path, input) {
  const response = await fetch(base + '/' + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  const data = await response.json();
  if (!response.ok) throw Error((data.error?.code || response.status) + ': ' + (data.error?.message || 'Request failed'));
  return data;
}

function sample(schema) {
  if (schema.default !== undefined) return schema.default;
  if (schema.enum) return schema.enum[0];
  if (schema.const !== undefined) return schema.const;
  if (schema.type === 'object') {
    return Object.fromEntries((schema.required || []).map(key => [key, sample(schema.properties[key])]));
  }
  if (schema.type === 'array') return [];
  if (schema.type === 'boolean') return false;
  if (schema.type === 'number' || schema.type === 'integer') return schema.minimum || 0;
  if (schema.anyOf) return sample(schema.anyOf[0]);
  return '';
}

function renderData(target, data, actions) {
  target.replaceChildren();
  const rows = Array.isArray(data) ? data : Array.isArray(data?.rows) ? data.rows : null;
  if (!rows) { target.append(node('pre', JSON.stringify(data, null, 2))); return; }
  if (!rows.length) { target.append(node('div', 'No records in this result.', 'empty')); return; }
  const normalized = rows.map(row => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) return { value: row };
    if (row.data && typeof row.data === 'object' && !Array.isArray(row.data)) {
      return { ...row.data, id: row.id, revision: row.revision, schemaVersion: row.schemaVersion };
    }
    return row;
  });
  const keys = [...new Set(normalized.flatMap(row => Object.keys(row)))];
  const scroll = node('div', undefined, 'scroll');
  const table = node('table');
  const head = node('tr');
  for (const key of keys) head.append(node('th', key));
  if (actions) head.append(node('th', 'Actions'));
  const thead = node('thead');
  thead.append(head);
  table.append(thead);
  const tbody = node('tbody');
  normalized.forEach((row, index) => {
    const tr = node('tr');
    for (const key of keys) {
      const value = row[key];
      const text = value === undefined ? '—' : typeof value === 'object' ? JSON.stringify(value) : String(value);
      const cell = node('td', text);
      cell.title = text;
      tr.append(cell);
    }
    if (actions) {
      const cell = node('td');
      actions(rows[index], cell);
      tr.append(cell);
    }
    tbody.append(tr);
  });
  table.append(tbody);
  scroll.append(table);
  target.append(scroll);
}

function select(button, title, description) {
  generation++;
  socket?.close();
  socket = undefined;
  clearInterval(refreshTimer);
  nav.querySelectorAll('button').forEach(item => item.setAttribute('aria-current', String(item === button)));
  document.querySelector('#heading').textContent = title;
  document.querySelector('#description').textContent = description;
  body.replaceChildren();
  return generation;
}

function addGroup(title, items) {
  nav.append(node('h2', title));
  for (const [label, handler] of items) {
    const button = node('button', label);
    button.onclick = () => handler(button);
    nav.append(button);
  }
}

function operation(button, kind, name, schema) {
  const current = select(button, name, kind === 'view'
    ? 'A complete, authorised live result. Local filtering never grants access.'
    : kind === 'job' ? 'Launch a persisted task or agent run.' : 'Validated server execution.');
  const details = node('details');
  details.append(node('summary', 'Input schema'), node('pre', JSON.stringify(schema.input, null, 2)));
  const input = node('textarea');
  input.setAttribute('aria-label', 'Operation input JSON');
  input.value = JSON.stringify(sample(schema.input), null, 2);
  const toolbar = node('div', undefined, 'toolbar');
  const execute = node('button', kind === 'view' ? 'Subscribe' : kind === 'job' ? 'Launch run' : 'Execute');
  toolbar.append(execute);
  const status = node('div', 'Ready', 'meta');
  const output = node('div');
  body.append(details, input, toolbar, status, output);
  execute.onclick = async () => {
    try {
      const value = JSON.parse(input.value);
      execute.disabled = true;
      if (kind === 'view') {
        socket?.close();
        const url = new URL(base + '/live', location.href);
        url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
        const connection = new WebSocket(url);
        socket = connection;
        status.textContent = 'Connecting…';
        connection.onopen = () => {
          if (current !== generation || socket !== connection) { connection.close(); return; }
          connection.send(JSON.stringify({ type: 'subscribe', id: 'console', name, input: value }));
          clearInterval(refreshTimer);
          refreshTimer = setInterval(() => {
            if (connection.readyState === 1) connection.send(JSON.stringify({ type: 'refresh' }));
          }, 30000);
        };
        connection.onmessage = event => {
          if (current !== generation || socket !== connection) return;
          const message = JSON.parse(event.data);
          if (message.type === 'error') {
            output.replaceChildren();
            status.textContent = message.error.message;
            status.className = 'error';
          } else {
            status.textContent = 'Live · revision ' + message.revision;
            status.className = 'meta live';
            if (message.type === 'snapshot') renderData(output, message.data);
          }
        };
        connection.onclose = () => {
          if (current !== generation || socket !== connection) return;
          clearInterval(refreshTimer);
          status.textContent = 'Disconnected. Subscribe again to reconnect.';
          status.className = 'meta';
          output.replaceChildren();
        };
      } else {
        const result = await api(kind === 'mutation' ? 'mutate' : kind === 'job' ? 'enqueue' : 'query', {
          name, input: value, requestId: crypto.randomUUID(),
        });
        if (current !== generation) return;
        status.textContent = 'Committed/read revision ' + result.revision;
        renderData(output, result.data);
      }
    } catch (error) {
      if (current === generation) showError(error);
    } finally { execute.disabled = false; }
  };
}

async function detail(resourceName, id, current) {
  const data = await api('inspect', { resource: resourceName + ':' + id });
  if (current !== generation) return;
  const details = node('details');
  details.open = true;
  details.append(node('summary', resourceName + ' ' + id), node('pre', JSON.stringify(data, null, 2)));
  body.append(details);
}

async function trace(runId, current, after = 0, container) {
  const data = await api('trace', { runId, after });
  if (current !== generation) return;
  if (!container) {
    container = node('details');
    container.open = true;
    container.append(node('summary', 'Run ' + runId));
    body.append(container);
  }
  container.querySelector('button')?.remove();
  container.append(node('pre', JSON.stringify(data.rows, null, 2)));
  if (data.nextCursor !== null) {
    const next = node('button', 'More trace entries');
    next.onclick = () => trace(runId, current, data.nextCursor, container).catch(showError);
    container.append(next);
  }
}

async function resource(button, name, after = '') {
  const title = name === 'runs' ? 'Execution runs' : name === 'schedules' ? 'Schedules'
    : name === 'history' ? 'Operation history' : name.startsWith('table:') ? name.slice(6) : 'Tables';
  const description = name === 'runs' ? 'Inspect outcomes before retrying interrupted work. Retries can repeat external effects.'
    : name === 'schedules' ? 'One-off and interval schedules. Missed intervals coalesce; active runs do not overlap.'
    : 'Server-authorised workspace inspection.';
  const current = select(button, title, description);
  const output = node('div');
  const toolbar = node('div', undefined, 'toolbar');
  body.append(toolbar, output);
  let loading = false;
  async function load() {
    if (loading) return;
    loading = true;
    try {
      const data = await api('inspect', { resource: name, after });
      if (current !== generation) return;
      const actionable = name === 'runs' || name === 'schedules';
      renderData(output, data, actionable ? (row, cell) => {
        const actions = !canManage ? [] : name === 'schedules' ? [row.enabled ? 'disable' : 'enable']
          : row.status === 'running' || row.status === 'queued' ? ['cancel']
          : ['failed', 'interrupted', 'cancelled'].includes(row.status) ? ['retry'] : [];
        for (const action of actions) {
          const button = node('button', action);
          button.onclick = async () => {
            try {
              if (action === 'retry' && !confirm('Retry as a NEW run? External effects may already have happened.')) return;
              await api('control', { resource: name === 'runs' ? 'run' : 'schedule', id: row.id, action });
              await load();
            } catch (error) { showError(error); }
          };
          cell.append(button);
        }
        const details = node('button', 'Details');
        details.onclick = () => detail(name === 'runs' ? 'run' : 'schedule', row.id, current).catch(showError);
        cell.append(details);
        if (name === 'runs') {
          const button = node('button', 'Trace');
          button.onclick = () => trace(row.id, current).catch(showError);
          cell.append(button);
        }
      } : undefined);
      toolbar.replaceChildren();
      if (data.nextCursor) {
        const next = node('button', 'Next page');
        next.onclick = () => resource(button, name, data.nextCursor);
        toolbar.append(next);
      }
      if (after) {
        const first = node('button', 'First page');
        first.onclick = () => resource(button, name);
        toolbar.append(first);
      }
      if (name === 'tables') {
        output.replaceChildren();
        for (const [table, version] of Object.entries(data)) {
          const next = node('button', table + ' · schema v' + version);
          next.onclick = () => resource(button, 'table:' + table);
          output.append(next);
        }
      }
    } catch (error) {
      if (current === generation) { output.replaceChildren(); showError(error); }
    } finally { loading = false; }
  }
  await load();
  if (current === generation && ['runs', 'schedules'].includes(name)) refreshTimer = setInterval(load, 3000);
}

try {
  const response = await fetch(base + '/manifest');
  const manifest = await response.json();
  if (!response.ok) throw Error(manifest.error?.message || 'Sign in first');
  canManage = manifest.admin;
  nav.replaceChildren();
  for (const kind of ['view', 'query', 'mutation', 'job']) {
    const title = { view: 'Live views', query: 'Queries', mutation: 'Mutations', job: 'Tasks & agents' }[kind];
    addGroup(title, Object.entries(manifest[kind]).map(([name, schema]) => [name, button => operation(button, kind, name, schema)]));
  }
  if (manifest.runs) addGroup('Execution', [['Runs', button => resource(button, 'runs')]]);
  if (manifest.admin) {
    addGroup('Administration', ['tables', 'schedules', 'history'].map(name => [name, button => resource(button, name)]));
  }
  document.querySelector('#description').textContent = 'Select a live view, query, mutation, or background operation.';
  body.append(node('p', 'All data and execution state are scoped to this workspace. Writes go through named mutations.', 'warning'));
} catch (error) {
  nav.replaceChildren();
  document.querySelector('#description').textContent = 'Unable to open workspace.';
  showError(error);
}
`;
