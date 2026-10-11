import { readFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export type AdminMountOptions = { basePath?: string; apiBasePath?: string; assetsDirectory?: string; wireCodecId?: 'json' | 'superjson-v1' };

/** Serve the prebuilt Workcore admin at a host-controlled route. The host remains responsible for auth. */
export function createAdminHandler(options: AdminMountOptions = {}) {
  const basePath = normalize(options.basePath ?? '/workcore/admin');
  const apiBasePath = normalize(options.apiBasePath ?? '/workcore/api');
  const wireCodecId = options.wireCodecId ?? 'json';
  if (wireCodecId !== 'json' && wireCodecId !== 'superjson-v1') throw new TypeError(`Unsupported admin wire codec '${wireCodecId}'`);
  const defaultAssets = resolve(dirname(fileURLToPath(import.meta.url)), 'assets');
  const assetsDirectory = resolve(options.assetsDirectory ?? defaultAssets);
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    if (url.pathname !== basePath && !url.pathname.startsWith(`${basePath}/`)) return new Response('Not found', { status: 404 });
    if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method not allowed', { status: 405 });
    const relative = decodeURIComponent(url.pathname.slice(basePath.length).replace(/^\//, ''));
    if (!relative || relative === 'index.html' || !relative.includes('.')) {
      const html = await readFile(join(assetsDirectory, 'index.html'), 'utf8');
      const rooted = html.replaceAll('="/assets/', `="${basePath}/assets/`).replaceAll("='/assets/", `='${basePath}/assets/`);
      const configured = rooted.replace('</head>', `<script>window.__WORKCORE_ADMIN__=${JSON.stringify({ apiBasePath, basePath, wireCodecId })}</script></head>`);
      return new Response(configured, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });
    }
    const assetPath = resolve(assetsDirectory, relative);
    if (!assetPath.startsWith(`${assetsDirectory}${sep}`)) return new Response('Not found', { status: 404 });
    try {
      const bytes = await readFile(assetPath);
      const extension = relative.split('.').at(-1);
      const contentType = extension === 'js' ? 'text/javascript; charset=utf-8' : extension === 'css' ? 'text/css; charset=utf-8' : extension === 'svg' ? 'image/svg+xml' : extension === 'woff2' ? 'font/woff2' : 'application/octet-stream';
      return new Response(request.method === 'HEAD' ? null : bytes, { headers: { 'content-type': contentType, 'cache-control': 'public, max-age=31536000, immutable', 'x-content-type-options': 'nosniff' } });
    } catch { return new Response('Not found', { status: 404 }); }
  };
}

function normalize(path: string) { return `/${path.split('/').filter(Boolean).join('/')}`; }
