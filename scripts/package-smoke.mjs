import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cp, mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

// Exercise exactly the published files, never workspace source exports. Reuse
// already-installed third-party dependencies so this check needs no registry.
const root = fileURLToPath(new URL('../', import.meta.url));
const temp = await mkdir('/tmp/opencode', { recursive: true }).then(() => mkdtemp('/tmp/opencode/workcore-pack-')).catch(error => {
  if (error.code !== 'EACCES') throw error;
  return mkdtemp(join(tmpdir(), 'workcore-pack-'));
});
const run = (command, args, cwd = temp) => execFileSync(command, args, { cwd, encoding: 'utf8', stdio: 'pipe' });
function documentedFile(markdown, filename) {
  for (const match of markdown.matchAll(/```(?:ts|js)\n([\s\S]*?)\n```/g)) {
    if (match[1].split('\n')[0].startsWith(`// ${filename}`)) return match[1];
  }
  throw new Error(`Missing documented file: ${filename}`);
}
try {
  const archives = join(temp, 'archives');
  const modules = join(temp, 'node_modules');
  await mkdir(archives);
  await mkdir(join(modules, '@workcore'), { recursive: true });
  const linked = new Set();
  for (const name of ['core', 'client', 'files', 'ai', 'admin']) {
    const source = join(root, 'packages', name);
    const original = JSON.parse(await readFile(join(source, 'package.json'), 'utf8'));
    run('pnpm', ['pack', '--pack-destination', archives], source);
    const target = join(modules, '@workcore', name);
    await mkdir(target);
    run('tar', ['-xzf', join(archives, `workcore-${name}-${original.version}.tgz`), '--strip-components=1', '-C', target]);
    const published = JSON.parse(await readFile(join(target, 'package.json'), 'utf8'));
    assert.notEqual(published.private, true);
    assert(!JSON.stringify(published.exports).includes('./src/'));
    assert(!JSON.stringify(published.dependencies).includes('workspace:'));
    await readFile(join(target, 'LICENSE'));
    await readFile(join(target, 'README.md'));
    if (name === 'core') assert.match(await readFile(join(target, 'AGENTS.example.md'), 'utf8'), /Developing an application with Workcore/);
    for (const dependency of Object.keys({ ...published.dependencies, ...published.peerDependencies })) {
      if (dependency.startsWith('@workcore/') || linked.has(dependency)) continue;
      const destination = join(modules, dependency);
      await mkdir(resolve(destination, '..'), { recursive: true });
      const installed = await realpath(join(source, 'node_modules', dependency)).catch(() => realpath(join(root, 'node_modules', dependency)));
      await symlink(installed, destination);
      linked.add(dependency);
    }
  }
  await mkdir(join(modules, '@cloudflare'), { recursive: true });
  await symlink(await realpath(join(root, 'node_modules/@cloudflare/workers-types')), join(modules, '@cloudflare/workers-types'));
  await writeFile(join(temp, 'package.json'), JSON.stringify({ type: 'module' }));
  await writeFile(join(temp, 'smoke.mjs'), `
    import assert from 'node:assert/strict';
    import { readFile } from 'node:fs/promises';
    import { createClient } from '@workcore/client';
    import { encodeJson } from '@workcore/core';
    import { backupSchema } from '@workcore/core/backup';
    import { fileStorage } from '@workcore/files';
    import { createAI } from '@workcore/ai';
    import { serveAdmin } from '@workcore/admin/server';
    import { copyAdminAssets } from '@workcore/admin/assets';
    assert.equal(encodeJson({ ok: true }), '{"ok":true}');
    assert.equal(typeof backupSchema.parse, 'function');
    assert.equal(typeof createAI({ profiles: {} }).run, 'function');
    assert.equal(fileStorage({ bucket: () => ({}) }).maxSize, 25 * 1024 * 1024);
    const client = createClient({ baseUrl: 'http://localhost/api/workspaces/test' }); client.close();
    assert.equal((await serveAdmin(new Request('http://localhost/no'), { fetch: fetch })).status, 404);
    await copyAdminAssets(new URL('./static/', import.meta.url));
    assert((await readFile(new URL('./static/index.html', import.meta.url), 'utf8')).includes('/admin/'));
  `);
  run(process.execPath, ['smoke.mjs']);
  await writeFile(join(temp, 'worker.ts'), `
    import { defineSchema, workspace } from '@workcore/core';
    import { Workspace } from '@workcore/core/cloudflare';
    import { createClient } from '@workcore/client';
    import { sqliteTable, text } from 'drizzle-orm/sqlite-core';
    import { z } from 'zod';
    const items = sqliteTable('items', { id: text('id').primaryKey() });
    const app = workspace(defineSchema({ items }), { journal: { entries: [] }, migrations: {} });
    const definition = app.define({ views: {}, queries: {}, jobs: {}, authorize: () => true, mutations: {
      echo: app.mutation({ input: z.object({ value: z.string() }), output: z.string(), handler: (_ctx, input) => input.value }),
    } });
    const client = createClient<typeof definition>({ baseUrl: '/api/workspaces/test' });
    const result: Promise<{ data: string; revision: number }> = client.mutate('echo', { value: 'ok' });
    // @ts-expect-error packaged declarations preserve mutation input inference
    client.mutate('echo', { value: 123 });
    export class ConsumerWorkspace extends Workspace { constructor(ctx: DurableObjectState, env: unknown) { super(ctx, env, definition); } }
    export default { fetch() { return new Response('ok'); } };
  `);
  await writeFile(join(temp, 'tsconfig.json'), JSON.stringify({ compilerOptions: { strict: true, noEmit: true, target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler', skipLibCheck: true, types: ['@cloudflare/workers-types'] }, include: ['worker.ts'] }));
  run(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '-p', 'tsconfig.json']);
  await writeFile(join(temp, 'wrangler.jsonc'), JSON.stringify({ name: 'workcore-package-smoke', main: 'worker.ts', compatibility_date: '2026-10-01', durable_objects: { bindings: [{ name: 'WORKSPACE', class_name: 'ConsumerWorkspace' }] }, migrations: [{ tag: 'v1', new_sqlite_classes: ['ConsumerWorkspace'] }] }));
  run(join(root, 'node_modules/.bin/wrangler'), ['deploy', '--dry-run', '--outdir', 'bundle']);

  // Check the published usage instructions too, including first migration generation.
  const readme = await readFile(join(root, 'README.md'), 'utf8');
  const guide = await readFile(join(root, 'docs/getting-started.md'), 'utf8');
  const starter = join(temp, 'documented-usage');
  await mkdir(join(starter, 'src'), { recursive: true });
  await mkdir(join(starter, 'scripts'));
  await writeFile(join(starter, 'package.json'), JSON.stringify({ type: 'module' }));
  for (const filename of ['src/schema.ts', 'src/worker.ts', 'src/auth.ts', 'drizzle.config.ts', 'scripts/ingest-migrations.mjs']) {
    await writeFile(join(starter, filename), documentedFile(guide, filename));
  }
  await writeFile(join(starter, 'src/app.ts'), documentedFile(readme, 'src/app.ts'));
  await symlink(await realpath(join(root, 'examples/workcore-demo/node_modules/drizzle-kit')), join(modules, 'drizzle-kit'));
  run(join(root, 'examples/workcore-demo/node_modules/.bin/drizzle-kit'), ['generate'], starter);
  run(process.execPath, ['scripts/ingest-migrations.mjs'], starter);
  const configs = [...guide.matchAll(/```json\n([\s\S]*?)\n```/g)].map(match => JSON.parse(match[1]));
  await writeFile(join(starter, 'wrangler.jsonc'), JSON.stringify(configs.find(config => config.durable_objects)));
  await writeFile(join(starter, 'tsconfig.json'), JSON.stringify(configs.find(config => config.compilerOptions)));
  run(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '-p', 'tsconfig.json'], starter);
  run(join(root, 'node_modules/.bin/wrangler'), ['deploy', '--dry-run', '--outdir', 'bundle'], starter);

  // Reuse the real example, not a new application design. Whitelist inputs so
  // local .env/.dev.vars, credentials and persisted data never enter this copy.
  const exampleSource = join(root, 'examples/workcore-demo');
  const example = join(temp, 'example');
  await mkdir(join(example, 'node_modules'), { recursive: true });
  for (const entry of ['src', 'static', 'scripts', 'drizzle', 'drizzle.config.ts', 'vite.config.ts', 'tsconfig.json', 'wrangler.jsonc']) {
    await cp(join(exampleSource, entry), join(example, entry), { recursive: true }).catch(error => {
      if (entry !== 'static' || error.code !== 'ENOENT') throw error;
    });
  }
  const examplePackage = JSON.parse(await readFile(join(exampleSource, 'package.json'), 'utf8'));
  for (const group of ['dependencies', 'devDependencies']) {
    for (const dependency of Object.keys(examplePackage[group] ?? {})) {
      if (dependency.startsWith('@workcore/')) {
        const name = dependency.slice('@workcore/'.length);
        const metadata = JSON.parse(await readFile(join(modules, dependency, 'package.json'), 'utf8'));
        examplePackage[group][dependency] = `file:../archives/workcore-${name}-${metadata.version}.tgz`;
        continue;
      }
      const destination = join(example, 'node_modules', dependency);
      await mkdir(resolve(destination, '..'), { recursive: true });
      await symlink(await realpath(join(exampleSource, 'node_modules', dependency)), destination);
    }
  }
  // The staged app consumes the prebuilt admin package; no workspace-only build step.
  examplePackage.scripts['build:ui'] = 'vite build && node scripts/copy-admin.mjs';
  await writeFile(join(example, 'package.json'), JSON.stringify(examplePackage));
  run(join(exampleSource, 'node_modules/.bin/vite'), ['build'], example);
  run(process.execPath, ['scripts/copy-admin.mjs'], example);
  run(join(root, 'node_modules/.bin/wrangler'), ['deploy', '--env=', '--dry-run', '--outdir', 'dist'], example);
  console.log('Packed packages: imports, types, agent guide, admin assets, documented setup and existing example build/dry run passed.');
} catch (error) {
  console.error(error.stdout?.toString() ?? '', error.stderr?.toString() ?? '');
  throw error;
} finally {
  // Only this invocation's private temporary directory is removed.
  await rm(temp, { recursive: true, force: true });
}
