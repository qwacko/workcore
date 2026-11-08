# @workcore/admin

Prebuilt Svelte workspace console for Workcore. No Svelte build is required in consuming applications.

At build time, import `copyAdminAssets` from `@workcore/admin/assets` and copy the prebuilt SPA into your Worker's assets directory. At runtime, import `serveAdmin` from `@workcore/admin/server`; see the [admin guide](https://qwacko.github.io/workcore/admin) for routing and authorization boundaries.

Once 0.1.0 is published, install with `pnpm add @workcore/admin@0.1.0`. For example, a Node build script can copy the assets:

```js
import { copyAdminAssets } from '@workcore/admin/assets';
await copyAdminAssets(new URL('./build/admin-assets/', import.meta.url));
```

The destination is relative to that script; adapt it to your build output. The [todo/notes example](https://github.com/qwacko/workcore/tree/main/examples/workcore-demo) shows how its asset binding routes those copied files through `serveAdmin`. No Svelte compiler is needed in your app to serve this prebuilt console.

The default SPA is compiled for `/admin`. Authentication and access to workspace data remain host/application-owned.
