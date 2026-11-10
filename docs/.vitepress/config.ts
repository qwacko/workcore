import { defineConfig } from 'vitepress';

export default defineConfig({
  title: 'Workcore',
  description: 'Cloudflare-first live workspace applications',
  base: '/workcore/',
  themeConfig: {
    search: { provider: 'local' },
    outline: [2, 3],
    nav: [
      { text: 'Start', link: '/getting-started' },
      { text: 'For coding agents', link: '/coding-agents' },
      { text: 'API reference', link: '/reference' },
      { text: 'GitHub', link: 'https://github.com/qwacko/workcore' },
    ],
    sidebar: [
      { text: 'Start', items: [
        { text: 'Documentation map', link: '/' },
        { text: 'Getting started', link: '/getting-started' },
        { text: 'Coding-agent reading map', link: '/coding-agents' },
        { text: 'Architecture and boundaries', link: '/architecture' },
      ] },
      { text: 'Build an application', items: [
        { text: 'Schema, operations and migrations', link: '/authoring' },
        { text: 'Context and identity', link: '/context' },
        { text: 'Permissions and concurrent editing', link: '/multi-user' },
        { text: 'Typed client and custom frontends', link: '/custom-frontends' },
        { text: 'Live data and pagination', link: '/sync' },
        { text: 'Tasks, schedules and agents', link: '/execution' },
        { text: 'AI SDK integration', link: '/ai' },
        { text: 'R2 file storage', link: '/files' },
        { text: 'Optional admin console', link: '/admin' },
      ] },
      { text: 'API reference', items: [
        { text: 'Packages and public symbols', link: '/reference' },
        { text: 'Browser client methods', link: '/client-api' },
        { text: 'Worker host and routing', link: '/hosting' },
        { text: 'Admin display protocol', link: '/display-protocol' },
        { text: 'Security, errors and limits', link: '/security' },
      ] },
      { text: 'Operate and maintain', items: [
        { text: 'Example and Cloudflare deployment', link: '/deployment' },
        { text: 'Diagnostics, backup and recovery', link: '/recovery' },
        { text: 'Publishing npm packages', link: '/publishing' },
        { text: 'Contributing and documentation', link: '/contributing' },
      ] },
    ],
  },
});
