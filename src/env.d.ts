/// <reference path="../.astro/types.d.ts" />
// Starlight's virtual modules. `virtual.d.ts` (user-config, …) is pulled in via the
// integration import in astro.config, but the `virtual:starlight/components/*` modules
// live in `virtual-internal.d.ts`, which nothing references — so referencing both here
// makes them resolve deterministically in the editor for our Header/component overrides.
/// <reference path="../node_modules/@astrojs/starlight/virtual.d.ts" />
/// <reference path="../node_modules/@astrojs/starlight/virtual-internal.d.ts" />
