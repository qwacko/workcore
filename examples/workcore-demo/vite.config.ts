import { sveltekit } from '@sveltejs/kit/vite';
import adapter from '@sveltejs/adapter-static';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [sveltekit({ adapter: adapter({ fallback: 'index.html' }) })],
  server: {
    host: process.env.HOST ?? '127.0.0.1', port: Number(process.env.PORT ?? 5173), strictPort: true,
    allowedHosts: (process.env.DEMO_ALLOWED_HOSTS ?? '').split(',').map(host => host.trim()).filter(Boolean),
    proxy: process.env.WORKCORE_API_ORIGIN ? {
      '^/(api|admin)(/|$)': { target: process.env.WORKCORE_API_ORIGIN, ws: true },
    } : undefined,
  },
});
