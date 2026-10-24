import { execFileSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('documentation snapshots freeze executable snippets, rewrite links, and index every guide', async () => {
  const root = await mkdtemp(join(tmpdir(), 'workcore-docs-test-'));
  try {
    for (const path of ['scripts', 'docs', 'examples', 'packages/core']) await mkdir(join(root, path), { recursive: true });
    await cp(new URL('./version-docs.mjs', import.meta.url), join(root, 'scripts/version-docs.mjs'));
    await writeFile(join(root, 'packages/core/package.json'), JSON.stringify({ version: '0.2.0' }));
    await writeFile(join(root, 'examples/minimal.ts'), 'export const value = 42;\n');
    await writeFile(join(root, 'docs/minimal-integration.md'), '# Minimal integration\n\n<<< ../examples/minimal.ts\n\n[Protocol](/protocol)\n');
    await writeFile(join(root, 'docs/protocol.md'), '# HTTP and live protocol\n');
    const run = () => execFileSync(process.execPath, [join(root, 'scripts/version-docs.mjs')], { encoding: 'utf8' });
    run();
    const archived = await readFile(join(root, 'docs/versions/0.2.0/minimal-integration.md'), 'utf8');
    assert.match(archived, /```ts\nexport const value = 42;\n```/);
    assert.match(archived, /\]\(\/versions\/0\.2\.0\/protocol\)/);
    assert.doesNotMatch(archived, /<<</);
    assert.match(await readFile(join(root, 'docs/versions/0.2.0/index.md'), 'utf8'), /\[HTTP and live protocol\]\(\.\/protocol\)/);
    await writeFile(join(root, 'examples/minimal.ts'), 'export const value = 99;\n');
    assert.match(run(), /already exists/);
    assert.equal(await readFile(join(root, 'docs/versions/0.2.0/minimal-integration.md'), 'utf8'), archived);
  } finally { await rm(root, { recursive: true, force: true }); }
});
