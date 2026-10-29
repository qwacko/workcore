export type AssetFetcher = { fetch(request: Request): Promise<Response> };

/** The SvelteKit SPA is compiled once and served by the host Worker's static asset binding. */
export async function serveAdmin(request: Request, assets: AssetFetcher): Promise<Response> {
  const url = new URL(request.url);
  const admin = url.pathname === '/admin' || url.pathname.startsWith('/admin/');
  if (!admin) return new Response('Not found', { status: 404 });
  url.pathname = url.pathname.slice('/admin'.length) || '/';
  const response = await assets.fetch(new Request(url, request));
  const headers = new Headers(response.headers);
  headers.set('x-content-type-options', 'nosniff');
  headers.set('content-security-policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'; object-src 'none'");
  return new Response(response.body, { status: response.status, headers });
}
