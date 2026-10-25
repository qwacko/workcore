import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { devArgs, readEnvironment } from './dev-config.mjs';

test('dev args use the configured address, port and exact proxy hostname', () => {
  const args = devArgs({ HOST: '127.100.0.10', PORT: '8787', DEMO_ALLOWED_HOSTS: 'workcore.dev.jmcdowall.com' });
  assert.deepEqual(args.slice(0, 7), ['dev', '--env', 'local', '--ip', '127.100.0.10', '--port', '8787']);
  assert.equal(args.at(-1), 'DEMO_ALLOWED_HOSTS:localhost,127.0.0.1,[::1],127.100.0.10,workcore.dev.jmcdowall.com');
  assert.throws(() => devArgs({ PORT: '65536' }), /PORT/);
  assert.throws(() => devArgs({ HOST: 'example.com' }), /HOST/);
  for (const host of ['*', 'https://example.com', 'example.com:8787', 'example.com/path']) {
    assert.throws(() => devArgs({ DEMO_ALLOWED_HOSTS: host }), /exact hostnames/);
  }
});

test('environment files preserve secrets and use shell > example > root precedence', () => {
  const directory = mkdtempSync(join(tmpdir(), 'workcore-dev-config-'));
  try {
    const root = join(directory, 'root.env');
    const example = join(directory, 'example.env');
    writeFileSync(root, 'HOST=127.0.0.1\nPORT=8000\nSECRET=root-secret\n');
    writeFileSync(example, 'HOST=127.100.0.10\nPORT=8787\n');
    const result = readEnvironment([join(directory, 'missing'), root, example], { PORT: '9000' });
    assert.deepEqual(result, { HOST: '127.100.0.10', PORT: '9000', SECRET: 'root-secret' });
  } finally { rmSync(directory, { recursive: true }); }
});
