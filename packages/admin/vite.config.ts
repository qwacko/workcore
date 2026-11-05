import { sveltekit } from '@sveltejs/kit/vite';
import adapter from '@sveltejs/adapter-static';
import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  define: {
    __ADMIN_BUILD_ID__: JSON.stringify(process.env.ADMIN_BUILD_ID ?? new Date().toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC')),
  },
  plugins: [tailwindcss(), sveltekit({ alias: { '$lib': 'src/lib' }, adapter: adapter({ pages: 'build', assets: 'build', fallback: 'index.html' }), paths: { base: '/admin' } })],
  server: {
    host: process.env.HOST ?? '127.0.0.1',
    port: Number(process.env.PORT ?? 5173),
    strictPort: true,
    allowedHosts: (process.env.DEMO_ALLOWED_HOSTS ?? '').split(',').map(host => host.trim()).filter(Boolean),
    proxy: process.env.WORKCORE_API_ORIGIN ? {
      '^/(?!admin(?:/|$))': { target: process.env.WORKCORE_API_ORIGIN, ws: true, changeOrigin: false },
    } : undefined,
  },
});
