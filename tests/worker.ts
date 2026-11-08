import { DurableObject } from 'cloudflare:workers';
import { Workspace } from '../packages/core/src/cloudflare.js';
import { permissionsDefinition } from './fixtures/permissions.js';
export { default, TrackerWorkspace, NotesWorkspace } from '../examples/workcore-demo/src/worker.js';

export class TestWorkspace extends DurableObject {
  fetch(): Response { return new Response('Test storage'); }
}
export class PermissionsWorkspace extends Workspace {
  constructor(ctx: DurableObjectState, env: unknown) { super(ctx, env, permissionsDefinition); }
}
