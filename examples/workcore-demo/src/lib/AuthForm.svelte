<script lang="ts">
  type Props = {
    busy?: boolean;
    error?: string;
    onsubmit: (values: { email: string; password: string; name: string; signup: boolean }) => void;
    onmodechange: () => void;
  };
  let { busy = false, error = '', onsubmit, onmodechange }: Props = $props();

  let signup = $state(false);
  let email = $state('');
  let password = $state('');
  let name = $state('');
</script>

<form class="auth-card" onsubmit={(event) => { event.preventDefault(); onsubmit({ email, password, name, signup }); }}>
  <h2>{signup ? 'Create your account' : 'Welcome back'}</h2>
  <p>One account for tasks and private notes.</p>
  {#if signup}<label>Name<input bind:value={name} required autocomplete="name" /></label>{/if}
  <label>Email<input bind:value={email} type="email" required autocomplete="email" /></label>
  <label>Password<input bind:value={password} type="password" minlength="8" required autocomplete={signup ? 'new-password' : 'current-password'} /></label>
  {#if error}<p class="error" role="alert">{error}</p>{/if}
  <button class="primary" disabled={busy}>{signup ? 'Create account' : 'Sign in'}</button>
  <button type="button" class="link" onclick={() => { signup = !signup; onmodechange(); }}>{signup ? 'Already have an account? Sign in' : 'New here? Create an account'}</button>
</form>

<style>
  .auth-card{display:grid;gap:14px;background:white;border:1px solid #e3e8df;padding:32px;border-radius:14px}
  .auth-card p{color:#89948a;margin:0}
  label{display:grid;gap:6px;font-size:13px;color:#6b786d;font-weight:600}
  input{width:100%;border:1px solid #dce3d9;border-radius:8px;background:#fcfdfa;padding:11px 12px;color:#26342c;font:inherit}
  .primary{background:#285f4c;color:white;border:0;border-radius:8px;padding:12px 15px;font:inherit;font-weight:650;text-align:left;cursor:pointer}
  .link{border:0;background:none;color:#47755d;padding:8px;text-align:left;font:inherit;cursor:pointer}
  .error{background:#fff2ed;color:#a1442e;padding:12px;border-radius:8px}
</style>
