import { defineConfig } from 'vitepress';

export default defineConfig({
  title: 'Workcore',
  description: 'Cloudflare-first live workspace applications',
  base: '/workcore/',
  themeConfig: {
    nav: [{ text: 'Guide', link: '/authoring' }, { text: 'GitHub', link: 'https://github.com/qwacko/workcore' }],
    sidebar: [
      { text: 'Introduction', link: '/' },
      { text: 'Getting started', link: '/getting-started' },
      { text: 'Architecture', link: '/architecture' },
      { text: 'Authoring and migrations', link: '/authoring' },
      { text: 'Admin metadata, pages and actions', link: '/admin' },
      { text: 'Custom frontends and chat', link: '/custom-frontends' },
      { text: 'AI SDK agents', link: '/ai' },
      { text: 'Live views and large datasets', link: '/sync' },
      { text: 'Tasks, schedules and agents', link: '/execution' },
      { text: 'Security and limits', link: '/security' },
      { text: 'Application permissions', link: '/multi-user' },
      { text: 'File storage', link: '/files' },
      { text: 'Backup and operations', link: '/recovery' },
      { text: 'Publishing', link: '/publishing' },
    ],
  },
});
