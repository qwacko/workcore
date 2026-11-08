// Test-only host: the production Worker remains unchanged. The fixture endpoint
// provisions an administrator for console coverage using a real Better Auth session.
import worker, { TrackerWorkspace as BaseTrackerWorkspace, NotesWorkspace } from '../../examples/workcore-demo/src/worker.js';
import { authFor } from '../../examples/workcore-demo/src/auth.js';
import type { Env } from '../../examples/workcore-demo/src/app.js';

export { NotesWorkspace };
export class TrackerWorkspace extends BaseTrackerWorkspace {
  async provisionAdmin(id: string) {
    this.engine.storage.sql.exec('INSERT OR REPLACE INTO members (id, name, role) VALUES (?, ?, ?)', id, 'Test administrator', 'admin');
  }
  async fixtureRun(id: string, actor: string) {
    const sql = this.engine.storage.sql;
    const row = sql.exec<{ data: string }>('SELECT data FROM wc_runs WHERE id = ?', id).toArray()[0];
    if (!row) throw new Error('Run not found');
    const run = JSON.parse(row.data);
    if (run.actor.id !== actor || run.status !== 'completed') throw new Error('Run is not owned and complete');
    run.result = { finishReason: 'tool', tool: { name: 'submitReport', result: { reportId: 'report-1' } }, text: '' };
    run.progress = { phase: 'completed', turn: 1, completionMode: 'tool-required', completion: { kind: 'tool', tool: 'submitReport' } };
    sql.exec('UPDATE wc_runs SET data = ? WHERE id = ?', JSON.stringify(run), id);
  }
  async failRun(id: string, actor: string) {
    const sql = this.engine.storage.sql;
    const row = sql.exec<{ data: string }>('SELECT data FROM wc_runs WHERE id = ?', id).toArray()[0];
    if (!row) throw new Error('Run not found');
    const run = JSON.parse(row.data);
    if (run.actor.id !== actor || run.status !== 'completed') throw new Error('Run is not owned and complete');
    run.status = 'failed'; run.error = 'TEST_FAILURE';
    sql.exec("UPDATE wc_runs SET status = 'failed', data = ? WHERE id = ?", JSON.stringify(run), id);
  }
}
export default {
  async fetch(request: Request, env: Env) {
    const path = new URL(request.url).pathname;
    if (path === '/__test/provision-admin' || path === '/__test/fixture-run' || path === '/__test/fail-run') {
      if (request.method !== 'POST') return new Response(null, { status: 405 });
      const session = await (await authFor(env)).api.getSession({ headers: request.headers });
      if (!session) return new Response(null, { status: 401 });
      // Initialize schema via the same authenticated production route first.
      const manifest = await worker.fetch(new Request(new URL('/api/workspaces/demo/manifest', request.url), { headers: request.headers }), env);
      if (!manifest.ok) return manifest;
      const stub = env.WORKSPACES.get(env.WORKSPACES.idFromName('demo')) as unknown as { provisionAdmin(id: string): Promise<void>; fixtureRun(id: string, actor: string): Promise<void>; failRun(id: string, actor: string): Promise<void> };
      if (path === '/__test/provision-admin') await stub.provisionAdmin(session.user.id);
      else if (path === '/__test/fail-run') await stub.failRun((await request.json() as { id: string }).id, session.user.id);
      else await stub.fixtureRun((await request.json() as { id: string }).id, session.user.id);
      return new Response(null, { status: 204 });
    }
    return worker.fetch(request, env);
  },
};
