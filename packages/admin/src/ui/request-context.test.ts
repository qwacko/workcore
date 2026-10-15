import { describe, expect, it } from 'vitest';
import { captureRequestContext } from './request-context.js';

describe('admin request identity', () => {
  it('does not mistake A→B→A workspace visits for the same context', () => {
    let workspace = 'A';
    let generation = 1;
    const isCurrent = captureRequestContext(() => [generation, workspace]);
    workspace = 'B'; generation++;
    workspace = 'A'; generation++;
    expect(isCurrent()).toBe(false);
  });

  it('allows live refreshes during a send but rejects user input changes, including A→B→A', () => {
    let input = 'A';
    let inputGeneration = 1;
    let refreshGeneration = 0;
    const isCurrent = captureRequestContext(() => [inputGeneration, input]);
    refreshGeneration++;
    expect(refreshGeneration).toBe(1);
    expect(isCurrent()).toBe(true);
    input = 'B'; inputGeneration++;
    input = 'A'; inputGeneration++;
    expect(isCurrent()).toBe(false);
  });
});
