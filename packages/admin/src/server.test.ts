import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createAdminHandler } from './server.js';

let directory = '';
afterEach(async () => { if (directory) await rm(directory, { recursive: true, force: true }); directory = ''; });

describe('prebuilt admin route handler', () => {
  it('serves the shell and assets under a configurable base path', async () => {
    directory = await mkdtemp(join(tmpdir(), 'workcore-admin-'));
    await mkdir(join(directory, 'assets'));
    await writeFile(join(directory, 'index.html'), '<html><head></head><body><script src="/assets/app.js"></script></body></html>');
    await writeFile(join(directory, 'assets', 'app.js'), 'console.log("admin")');
    const handler = createAdminHandler({ basePath: '/ops/control', apiBasePath: '/ops/api', assetsDirectory: directory });
    const shell = await handler(new Request('http://localhost/ops/control'));
    const html = await shell.text();
    expect(shell.status).toBe(200);
    expect(html).toContain('/ops/control/assets/app.js');
    expect(html).toContain('"apiBasePath":"/ops/api"');
    const asset = await handler(new Request('http://localhost/ops/control/assets/app.js'));
    expect(await asset.text()).toBe('console.log("admin")');
    expect(asset.headers.get('cache-control')).toContain('immutable');
  });

  it('does not serve files outside the asset directory', async () => {
    directory = await mkdtemp(join(tmpdir(), 'workcore-admin-'));
    await writeFile(join(directory, 'secret.txt'), 'secret');
    const handler = createAdminHandler({ basePath: '/admin', assetsDirectory: directory });
    const response = await handler(new Request('http://localhost/admin/%2e%2e/secret.txt'));
    expect(response.status).toBe(404);
  });

  it('rejects a codec the prebuilt admin cannot use', () => {
    expect(() => createAdminHandler({ wireCodecId: 'devalue-v1' as never })).toThrow(/Unsupported admin wire codec/);
  });
});
