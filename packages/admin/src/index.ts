import { consoleScript } from './script.js';

function escape(value: string): string {
  return value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
}

/** A same-origin console. Every operation and inspection is independently authorised by the API. */
export function adminPage(options: { apiBasePath: string; title?: string }): Response {
  const title = escape(options.title ?? 'Workcore');
  const config = JSON.stringify({ base: options.apiBasePath.replace(/\/$/, '') }).replace(/</g, '\\u003c');
  return new Response(`<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<style>
:root { font:14px Inter,ui-sans-serif,system-ui,sans-serif; color:#e8eaf0; background:#111318; color-scheme:dark }
* { box-sizing:border-box }
body { margin:0 }
header { display:flex; gap:16px; align-items:center; padding:20px 28px; border-bottom:1px solid #2c303a }
header strong { font-size:20px; letter-spacing:-.6px }
header span { color:#9ca4b6 }
header a { margin-left:auto; color:#ffb673 }
main { display:grid; grid-template-columns:230px minmax(0,1fr); max-width:1400px; margin:auto; min-height:80vh }
nav { padding:24px 16px; border-right:1px solid #2c303a }
nav h2 { color:#929bb0; font-size:11px; letter-spacing:1.4px; text-transform:uppercase; margin:24px 10px 10px }
nav h2:first-child { margin-top:0 }
button { font:inherit; cursor:pointer; border:1px solid #394151; border-radius:7px; background:#242a36; color:#e8eaf0; padding:9px 13px }
button:hover { background:#30394a }
button:disabled { opacity:.5; cursor:wait }
nav button { display:block; width:100%; text-align:left; border:0; background:transparent; overflow-wrap:anywhere; margin:3px 0 }
nav button[aria-current=true] { background:#30271f; color:#ffb673 }
.content { padding:32px; min-width:0 }
h1 { font-size:28px; letter-spacing:-.8px; margin:0 0 8px }
p { color:#a0a9bb; line-height:1.6 }
.meta { font-size:12px; color:#a0a9bb; margin:16px 0 }
.live { color:#a8d8b0 }
.error { color:#ff9c9c; white-space:pre-wrap }
.toolbar { display:flex; gap:8px; flex-wrap:wrap; margin:16px 0 }
textarea { width:100%; min-height:140px; background:#191d25; border:1px solid #394151; border-radius:8px; color:#e8eaf0; padding:14px; font:13px/1.6 ui-monospace,monospace; resize:vertical }
pre { background:#191d25; border-radius:8px; padding:16px; overflow:auto; font:12px/1.6 ui-monospace,monospace; max-height:600px }
details { margin:16px 0; color:#a0a9bb }
summary { cursor:pointer }
.scroll { overflow-x:auto; border:1px solid #2c303a; border-radius:8px; margin-top:20px }
table { border-collapse:collapse; width:100%; font-size:13px }
th { text-align:left; color:#a0a9bb; font-weight:500; background:#1a1e26 }
td,th { padding:12px 14px; border-bottom:1px solid #2c303a; vertical-align:top; min-width:90px; max-width:360px; overflow-wrap:anywhere }
td:first-child { min-width:200px }
td button { font-size:12px; padding:5px 8px; margin:2px }
td code { font-size:11px; color:#a0a9bb }
.empty { padding:32px; background:#191d25; border-radius:8px; color:#a0a9bb }
.badge { font:11px ui-monospace,monospace; background:#242a36; padding:4px 7px; border-radius:5px }
.warning { padding:12px 16px; background:#30271f; color:#ffca99; border-radius:8px }
@media(max-width:650px) {
  header { padding:16px; flex-wrap:wrap }
  header span { display:none }
  main { display:block }
  nav { border-right:0; border-bottom:1px solid #2c303a; padding:12px; display:flex; gap:4px; overflow:auto }
  nav h2 { display:none }
  nav button { width:auto; white-space:nowrap }
  .content { padding:22px 16px }
  h1 { font-size:24px }
}
</style></head><body>
<header><strong>${title}</strong><span>Workspace console</span><span class="badge">Cloudflare · SQLite</span><a href="/">Workspace home</a></header>
<main><nav id="nav"><p>Connecting…</p></nav>
<section class="content"><h1 id="heading">Your workspace</h1><p id="description">Loading authorised operations.</p><div id="body"></div></section></main>
<script id="config" type="application/json">${config}</script>
<script type="module">${consoleScript}</script>
</body></html>`, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'content-security-policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
      'x-content-type-options': 'nosniff',
    },
  });
}
