<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { Label } from '$lib/components/ui/label';
  import * as Card from '$lib/components/ui/card';
  let {
    busy = false,
    error = '',
    onsubmit,
    onmodechange,
  }: {
    busy?: boolean;
    error?: string;
    onsubmit: (value: { email: string; password: string; name: string; signup: boolean }) => void;
    onmodechange: () => void;
  } = $props();
  let signup = $state(false),
    email = $state(''),
    password = $state(''),
    name = $state('');
</script>

<Card.Root class="w-full max-w-sm gap-5 shadow-sm">
  <Card.Header>
    <Card.Title>{signup ? 'Create your account' : 'Welcome back'}</Card.Title><Card.Description>
      One workspace for your tasks, notes and conversations.
    </Card.Description>
  </Card.Header>
  <Card.Content>
    <form
      class="grid gap-4"
      onsubmit={(e) => {
        e.preventDefault();
        onsubmit({ email, password, name, signup });
      }}
    >
      {#if signup}<div class="grid gap-2">
          <Label for="name">Name</Label><Input
            id="name"
            bind:value={name}
            required
            autocomplete="name"
          />
        </div>{/if}
      <div class="grid gap-2">
        <Label for="email">Email</Label><Input
          id="email"
          type="email"
          bind:value={email}
          required
          autocomplete="email"
        />
      </div>
      <div class="grid gap-2">
        <Label for="password">Password</Label><Input
          id="password"
          type="password"
          bind:value={password}
          minlength={8}
          required
          autocomplete={signup ? 'new-password' : 'current-password'}
        />
      </div>
      {#if error}<p class="text-sm text-destructive" role="alert">
          {error}
        </p>{/if}
      <Button type="submit" disabled={busy}>
        {busy ? 'Please wait…' : signup ? 'Create account' : 'Sign in'}
      </Button>
      <Button
        variant="link"
        type="button"
        class="h-auto whitespace-normal"
        onclick={() => {
          signup = !signup;
          onmodechange();
        }}
      >
        {signup ? 'Already have an account? Sign in' : 'New here? Create an account'}
      </Button>
    </form>
  </Card.Content>
</Card.Root>
