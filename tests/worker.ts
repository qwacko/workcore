import { DurableObject } from 'cloudflare:workers';
export { default, TrackerWorkspace, NotesWorkspace } from '../examples/workcore-demo/src/worker.js';

export class TestWorkspace extends DurableObject {
  fetch(): Response { return new Response('Test storage'); }
}
