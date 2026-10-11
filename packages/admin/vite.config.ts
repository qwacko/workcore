import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  plugins: [svelte()],
  build: {
    outDir: 'dist/assets',
    emptyOutDir: true,
    rollupOptions: { input: 'index.html' },
  },
});
