import { DurableObject } from 'cloudflare:workers';
export { default, TrackerWorkspace } from '../examples/tracker/src/worker.js';

export class TestWorkspace extends DurableObject {
  fetch(): Response { return new Response('Test storage'); }
}
