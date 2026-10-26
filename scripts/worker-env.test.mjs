import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, statSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createWorkerEnvFile, workerEnvContents } from './worker-env.mjs';

test('the Worker receives only explicit agent bindings with literal dollar signs', () => {
  const result = workerEnvContents({ OPENROUTER_API_KEY: 'test-$TOKEN', WORKCORE_AGENT_MODEL: 'openrouter/test/model', UNRELATED_SECRET: 'do-not-forward' });
  assert.equal(result, "WORKCORE_AGENT_MODEL='openrouter/test/model'\nOPENROUTER_API_KEY='test-\\$TOKEN'\n");
  assert.equal(result.includes('UNRELATED_SECRET'), false);
  assert.throws(() => workerEnvContents({ OPENAI_API_KEY: 'bad\nvalue' }), /OPENAI_API_KEY must be a single-line value/);
  assert.equal(workerEnvContents({ OPENAI_API_KEY: "test'quoted" }), "OPENAI_API_KEY=`test'quoted`\n");
});

test('temporary Worker bindings are private and are cleaned up without touching other files', () => {
  const directory = mkdtempSync(join(tmpdir(), 'workcore-env-test-'));
  try {
    const file = createWorkerEnvFile({ OPENAI_API_KEY: 'test-only-key' }, directory);
    assert.equal(statSync(file.path).mode & 0o777, 0o600);
    assert.equal(readFileSync(file.path, 'utf8'), "OPENAI_API_KEY='test-only-key'\n");
    file.dispose();
    file.dispose();
    assert.equal(existsSync(file.path), false);
    assert.equal(existsSync(directory), true);
  } finally { rmSync(directory, { recursive: true }); }
});
