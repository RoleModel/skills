---
name: agentation
description: Add Agentation visual feedback toolbar to a project. Use when the user asks to "install Agentation", "add the Agentation toolbar", or "set up visual feedback". Covers Rails apps that bundle with webpack into `app/assets/builds` (the RoleModel default) by adding React as a development-only dependency, plus hosts that already bundle React. The same pattern adapts to other server-rendered hosts, but the snippets are Rails.
---

# Agentation Setup

> Adapted from [benjitaylor/agentation](https://github.com/benjitaylor/agentation)
> `skills/agentation`, upstream commit `4a3b08f` (2026-02-18), which covers Next.js
> only. Steps 1, 2 and 7 are upstream's; the non-React host path is RoleModel's
> addition. Re-check against upstream when bumping the `agentation` package — the
> toolbar's internals are not a public API.

Set up the Agentation annotation toolbar in this project.

Agentation ships a single React component. React is therefore required — but it is
required **only in development**, and it must never reach the production bundle.
In a project that already uses React that is automatic. In a project that does not,
add React as a development-only dependency rather than declining to install.

## Steps

1. **Check if already configured** — do this before installing anything
   - Search for `<Agentation` or `from "agentation"` / `from 'agentation'` across the
     project's source directories (`src/`, `app/`, `assets/`, `frontend/`)
   - If found, report that Agentation is already set up and exit

2. **Check if already installed**
   - Look for `agentation` in package.json `dependencies` or `devDependencies`
   - If not found, install it as a **dev dependency**: `npm install -D agentation`
     (or `yarn add -D` / `pnpm add -D` based on the lockfile)

3. **Check for React — add it as a dev dependency if absent**
   - Look for `react` and `react-dom` in package.json `dependencies` **or**
     `devDependencies`
   - If either is already present anywhere, leave it alone — never move an existing
     runtime dependency into devDependencies, and never change its version range
   - **If React is present but below 18**, stop and tell the user. Agentation's peer
     range is `>=18.0.0` and the mount script needs `react-dom/client`, which does not
     exist in 17. Upgrading the host's React is a real decision, not a side effect of
     installing a dev toolbar — do not do it here
   - If absent, install the latest React as dev dependencies — do not pin an older
     major:
     ```bash
     npm install -D react react-dom
     ```
     Agentation's peer range is `>=18`, so whatever `latest` resolves to satisfies
     it. Nothing is being shipped to users here, so there is no reason to hold back
     to an older major.

4. **Detect the host**

   | Host | Signal |
   | ---- | ------ |
   | Non-React host | React was added in step 3 — a server-rendered app (Rails, Django, Laravel, Phoenix) or a plain bundler setup. **This is the common case.** |
   | Host that already bundles React | `react` was already a dependency before step 3 |

   For a non-React host, also identify the bundler (`webpack.config.js`,
   `vite.config.*`, `rollup.config.*`), its **output directory** (webpack `output.path`,
   `app/assets/builds/` or shakapacker's `public/packs/`, Vite's `build.outDir`), and the
   server-rendered layout template that emits `<script>` tags. You need all three — step 7
   verifies against the output directory.

   The snippets in step 5 are written for the RoleModel Rails default: a hand-rolled
   `webpack.config.js` with a module-scope `mode` variable, output to
   `app/assets/builds`, served by sprockets/propshaft. That is the shape they are known
   to work in. Read the project's actual config before pasting — each snippet below
   notes what to do when it differs.

5. **Add the component**

   **Non-React host** (Rails and friends — the path below is the one you almost always
   want) — do NOT add React to the app's existing entry point. Create a
   separate, dev-only bundle entry so the main bundle is untouched:

   a. Write a standalone entry (e.g. `app/javascript/agentation.js`). Use
      `createElement` rather than JSX so the project needs no JSX toolchain config:

   ```js
   // Development-only entry: mounts the Agentation feedback toolbar.
   import { createElement } from 'react'
   import { createRoot } from 'react-dom/client'
   import { Agentation } from 'agentation'

   const CONTAINER_ID = 'agentation-root'
   const ENDPOINT = 'http://localhost:4747' // agentation-mcp HTTP server

   let root = null

   function mount() {
     if (document.getElementById(CONTAINER_ID)) return

     root?.unmount()

     const container = document.createElement('div')
     container.id = CONTAINER_ID
     document.body.appendChild(container)

     root = createRoot(container)
     root.render(createElement(Agentation, { endpoint: ENDPOINT }))
   }

   // Re-mount after client-side navigation that swaps <body>.
   document.addEventListener('turbo:load', mount)   // Turbo / Hotwire
   document.addEventListener('turbo:morph', mount)
   mount()
   ```

   b. Register the entry **only in the bundler's development mode**. This is the real
      production guarantee — the dev dependency alone is not enough. webpack, reusing
      the `mode` variable a RoleModel config already computes near the top of the file:

   ```js
   const isDevelopment = mode === 'development'

   entry: {
     application: './app/javascript/application.js',
     ...(isDevelopment && { agentation: './app/javascript/agentation.js' })
   }
   ```

   That `mode` binding comes from the app's config, not from webpack. If it is not in
   scope — shakapacker's generated config is `generateWebpackConfig()` with no `mode`
   variable, and a plain object export has `mode` only as a key — derive the flag
   directly instead:

   ```js
   const isDevelopment = process.env.RAILS_ENV !== 'production'
   ```

   Shakapacker and Vite also have no top-level `entry` literal to spread into
   (shakapacker returns a built config object; Vite uses `build.rollupOptions.input`).
   Add the entry to whatever those configs actually expose, and keep the dev gate.

   c. Emit the script from the server-rendered layout, gated on the server's
      development environment. Rails/Slim:

   ```slim
   - if Rails.env.development?
     = javascript_include_tag 'agentation', defer: true
   ```

   `javascript_include_tag` is correct when webpack writes to `app/assets/builds` and
   sprockets/propshaft serves it — the RoleModel default. A **shakapacker** app writing
   to `public/packs` needs `javascript_pack_tag 'agentation'` instead;
   `javascript_include_tag` will not resolve a pack, and the toolbar silently never
   loads. Non-Rails hosts (Django, Laravel, Phoenix) use the same two ideas — a
   dev-gated conditional and the framework's own script tag helper — but the helper
   name is theirs, not this one.

   Do not add cache-busting/asset-tracking attributes (e.g. Turbo's
   `data-turbo-track: 'reload'`) to this tag — rebuilding the dev bundle would then
   force full page reloads.

   **Host that already bundles React** — render `<Agentation />` once near the root of
   the tree, behind a `process.env.NODE_ENV === 'development'` check. Import it through a
   dev-only dynamic import rather than a top-level `import`: a top-level import leaves the
   module in the production bundle unless the bundler can prove it side-effect free, and
   the point of this skill is that it never gets there.

6. **Match the host's root font-size**

   Agentation sizes itself in a mix of px and rem against a 16px root. Optics sets
   `html { font-size: 62.5% }` (`1rem = 10px`), so on an Optics app every rem value in
   the toolbar renders at 62.5% while every px value renders correctly — small text and
   tight gaps around full-size icons. `rem` cannot be rebased for a subtree and
   Agentation exposes no sizing custom properties, so bake the rem values to px at build
   time. Skip this step if the host's root font-size is already 16px.

   a. Add a loader:

   ```js
   // config/webpack/agentation-rem-to-px.cjs
   module.exports = (source) =>
     source.replace(/(\d*\.?\d+)rem\b/g, (_, v) => `${parseFloat(v) * 16}px`)
   ```

   b. Register it in the same dev-only branch as the entry, so it cannot reach a
      production build:

   ```js
   ...(isDevelopment ? [{
     test: /node_modules[\\/]agentation[\\/]/,
     loader: path.resolve('config/webpack/agentation-rem-to-px.cjs')
   }] : []),
   ```

   Rebuild, then confirm in the browser console with the annotation dialog open. Expect
   `0`; anything else means the loader did not run:

   ```js
   [...document.querySelectorAll('style')]
     .filter(s => s.textContent.includes('styles-module__'))
     .reduce((n, s) => n + (s.textContent.match(/[\d.]+rem/g) || []).length, 0)
   ```

7. **Confirm and verify**
   - Tell the user the Agentation toolbar component is configured
   - For a non-React host, verify the production boundary before reporting success.
     Run these against the output directory found in step 4 — `$OUT` below is that
     directory (`app/assets/builds`, `public/packs`, `dist`, …), **not** a literal:
     ```bash
     # Build into a clean directory — a leftover dev artifact in $OUT reads as a
     # failure that isn't real, and a wrong $OUT reads as a pass that isn't real.
     # check-ignore refuses to delete anything that isn't generated build output.
     git check-ignore -q "$OUT" || { echo "refusing: $OUT is not gitignored"; exit 1; }
     rm -rf "$OUT" && RAILS_ENV=production npm run build   # or NODE_ENV=production
     ls "$OUT" | grep -i agentation                        # expect: no matches
     ```
     If the bundler writes hashed filenames through a manifest
     (`public/packs/manifest.json`, `.vite/manifest.json`), grep the manifest for an
     `agentation` entry instead of guessing the filename.

     Do **not** try to prove React's absence by grepping the output for `react-dom`.
     Production builds are minified and that string need not survive, so "no matches"
     is not evidence either way. If you want a second signal, compare the total output
     size against a build from before this change — a leaked React DOM adds well over
     100 KB.

     Restore the development build afterward.

8. **Recommend MCP server setup**
   - Explain that for real-time annotation syncing with AI agents, they should also set up the MCP server
   - Recommend one of the following approaches:
     - **Universal (supports 9+ agents including Claude Code, Cursor, Codex, Windsurf, etc.):**
       See [add-mcp](https://github.com/neondatabase/add-mcp) — run `npx add-mcp` and follow the prompts to add `agentation-mcp` as an MCP server
     - **Claude Code only (interactive wizard):**
       Run `agentation-mcp init` after installing the package
   - Tell user to restart their coding agent after MCP setup to load the server
   - Explain that once configured, annotations will sync to the agent automatically

## Notes

- The `NODE_ENV` / bundler-mode / server-env checks ensure Agentation only loads in
  development. In a non-React host, layer all three — the bundler-mode check is the
  one that actually keeps React out of the production bundle.
- Agentation's peer range is `>=18`, so installing React at `latest` is always
  compatible. It declares those peers as **optional**, so a package manager will not
  warn when they are absent — check package.json yourself rather than relying on
  install output.
- `Agentation` renders as a **React portal into `document.body`** and injects its
  `<style>` tags into `<head>`. The styles survive navigation; the portal does not.
  Turbo/Hotwire swaps `document.body`, so the two `turbo:` listeners in step 5 are
  required or the toolbar silently disappears after the first link click. Any other
  host that replaces the body needs the equivalent listener for its own navigation
  event — the sample wires Turbo only.
- Without an `endpoint` prop the toolbar is localStorage + clipboard only. Pass
  `endpoint: "http://localhost:4747"` to sync with `agentation-mcp`. If that server
  is not running, expect a console fetch error on send; annotations still persist
  locally.
- Agentation has no style isolation — no shadow DOM, styles injected as `<style>` tags
  into `<head>`, portal into `document.body`. Step 6 fixes its own sizing, but host
  element selectors still reach it: a bare `button` or `textarea` rule in the app's
  stylesheets will restyle the toolbar's controls. Find the winning rule in devtools and
  scope it out rather than adding an ID-prefixed reset, which outranks Agentation's own
  class rules and trades a wrong focus ring for no focus ring.
- Agentation is licensed PolyForm Shield 1.0.0 — fine for an internal dev tool, but
  worth mentioning in a client codebase.
- The MCP server runs on port 4747 by default for the HTTP server
- MCP server exposes tools like `agentation_get_all_pending`, `agentation_resolve`, and `agentation_watch_annotations`
- Run `agentation-mcp doctor` to verify setup after installing
