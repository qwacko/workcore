import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.cwd();
const temporary = await mkdtemp(join(tmpdir(), 'workcore-packed-consumer-'));
try {
  const run = (command, args, cwd = root) => execFileSync(command, args, { cwd, stdio: 'inherit' });
  run('pnpm', ['--filter', '@workcore/core', 'pack', '--pack-destination', temporary]);
  run('pnpm', ['--filter', '@workcore/adapters', 'pack', '--pack-destination', temporary]);
  run('pnpm', ['--filter', '@workcore/client', 'pack', '--pack-destination', temporary]);
  run('pnpm', ['--filter', '@workcore/codec-superjson', 'pack', '--pack-destination', temporary]);
  run('pnpm', ['--filter', '@workcore/codec-devalue', 'pack', '--pack-destination', temporary]);
  run('pnpm', ['--filter', '@workcore/admin', 'pack', '--pack-destination', temporary]);
  const consumer = join(temporary, 'consumer');
  await (await import('node:fs/promises')).mkdir(consumer);
  const tar = (name) => pathToFileURL(join(temporary, name)).href;
  const coreTar = tar('workcore-core-0.1.0.tgz');
  const adaptersTar = tar('workcore-adapters-0.1.0.tgz');
  const clientTar = tar('workcore-client-0.1.0.tgz');
  const superjsonCodecTar = tar('workcore-codec-superjson-0.1.0.tgz');
  const devalueCodecTar = tar('workcore-codec-devalue-0.1.0.tgz');
  await writeFile(join(consumer, 'package.json'), JSON.stringify({
    name: 'workcore-packed-consumer', private: true, type: 'module',
    pnpm: { overrides: { '@workcore/core': coreTar, '@workcore/adapters': adaptersTar, '@workcore/client': clientTar, '@workcore/codec-superjson': superjsonCodecTar, '@workcore/codec-devalue': devalueCodecTar } },
    dependencies: {
      '@workcore/core': coreTar,
      '@workcore/adapters': adaptersTar,
      '@workcore/client': clientTar,
      '@workcore/codec-superjson': superjsonCodecTar,
      '@workcore/codec-devalue': devalueCodecTar,
      '@workcore/admin': tar('workcore-admin-0.1.0.tgz'),
      typescript: '7.0.2',
      zod: '4.6.5',
    },
  }, null, 2));
  await writeFile(join(consumer, 'tsconfig.json'), JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext', strict: true, noEmit: true, skipLibCheck: true }, include: ['index.ts'] }, null, 2));
  await writeFile(join(consumer, 'index.ts'), `
import { defineWorkspace } from '@workcore/core';
import { createFileState, createFileWorkspaces } from '@workcore/adapters/file';
import { createPostgresState, migratePostgres } from '@workcore/adapters/postgres';
import { createRedisEvents } from '@workcore/adapters/redis';
import { createMemoryState, createMemoryHistory } from '@workcore/adapters/memory';
import { createClient, createFetchTransport } from '@workcore/client';
import { createAdminHandler } from '@workcore/admin/server';
import { superjsonCodec } from '@workcore/codec-superjson';
import { devalueCodec } from '@workcore/codec-devalue';
import { z } from 'zod';

const schema = z.object({ value: z.number() });
const app = defineWorkspace<{ add(value: number): number }>()({ id: 'consumer', queries: { read: { input: schema, output: schema, api: true, permission: 'read', handler: ({ ctx, input }) => ({ value: ctx.app.add(input.value) }) } } });
const client = createClient<typeof app>({ transport: createFetchTransport({}), applicationId: 'consumer', workspaceId: 'one' });
void client.query('read', { value: 2 });
const services = createPostgresState({ pool: {} as never });
void services.tasks;
void createRedisEvents({ publisher: {} as never, subscriber: {} as never });
// @ts-expect-error Schema-inferred client inputs are enforced after packing.
void client.query('read', { value: 'bad' });
createAdminHandler({ basePath: '/admin' });
void superjsonCodec();
void devalueCodec();
const memory = createMemoryState();
void createMemoryHistory(memory);
const file = createFileState({ path: 'workcore-state.json', workspaces: [] });
void createFileWorkspaces(file);
void createPostgresState;
void migratePostgres;
void createRedisEvents;
`);
  run('pnpm', ['install', '--no-frozen-lockfile'], consumer);
  run('pnpm', ['exec', 'tsc', '-p', 'tsconfig.json'], consumer);
  const smoke = `import { createAdminHandler } from '@workcore/admin/server'; const h=createAdminHandler({basePath:'/mounted/admin'}); const r=await h(new Request('http://localhost/mounted/admin')); const html=await r.text(); if(r.status!==200||!html.includes('/mounted/admin/assets/')) throw new Error('admin route/assets failed'); const assetPath=new URL(html.match(/src="([^"]+\.js)"/)?.[1]??'', 'http://localhost').pathname; const asset=await h(new Request('http://localhost'+assetPath)); if(asset.status!==200) throw new Error('packed admin asset missing'); console.log('packed admin route and asset verified');`;
  run('node', ['--input-type=module', '-e', smoke], consumer);
  console.log('Packed consumer type and runtime checks passed.');
} finally {
  await rm(temporary, { recursive: true, force: true });
}
