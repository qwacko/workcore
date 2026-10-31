<script lang="ts">
  type Props = {
    section: 'tasks' | 'notes';
    liveStatus: string;
    live: boolean;
    onsectionchange: (section: 'tasks' | 'notes') => void;
    onsignout: () => void;
    children: import('svelte').Snippet;
  };
  let { section, liveStatus, live, onsectionchange, onsignout, children }: Props = $props();
</script>

<div class="shell">
  <header>
    <a class="brand" href="/">✳ <span>workcore<span class="brand-light"> / demo</span></span></a>
    <nav aria-label="Main navigation">
      <button class:active={section === 'tasks'} onclick={() => onsectionchange('tasks')}>Tasks</button>
      <button class:active={section === 'notes'} onclick={() => onsectionchange('notes')}>Notes</button>
      <a href={section === 'tasks' ? '/admin/demo' : '/admin/notes'}>Admin ↗</a>
    </nav>
    <button class="signout" onclick={onsignout}>Sign out</button>
  </header>
  <main>
    <div class="heading">
      <div><span class="eyebrow">YOUR WORKSPACE / {section.toUpperCase()}</span><h1>{section === 'tasks' ? 'Make space for the work.' : 'A place to think.'}</h1><p>{section === 'tasks' ? 'A clear view of what needs your attention.' : 'Capture ideas, keep the useful ones close.'}</p></div>
      <div class="live"><span class:offline={!live}></span>{live ? 'Live and in sync' : liveStatus}</div>
    </div>
    {@render children()}
  </main>
  <footer>Built with Workcore <span>Live data · Thoughtful work</span></footer>
</div>
