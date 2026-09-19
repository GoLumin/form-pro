# @golumin/form-pro

An Astro integration that gives a marketing site **one declared source of truth**
for its lead forms — who each email comes from and goes to, exactly which keys
its CRM webhook accepts, and what the pricing block says — plus an
authenticated console at `/form-preview` to test, edit, deploy and monitor all
of it.

It exists because these values only work as a set. A quote created on one gofuse
instance is not resolvable on another. A From address only sends if its domain
is verified in the GetOutsend workspace whose key is used. A CRM webhook only
maps the keys its own field-mapping screen declares. Splitting them across files
and hosting dashboards is what lets a lead get priced by one market and filed in
another's, and what lets a correct payload reach a webhook that cannot read it —
with nothing visibly wrong on the site either time.

## Requirements

| | |
|---|---|
| Astro | **6 or newer**, `output: 'server'` |
| Tailwind | **v4** on the host site |
| Node | 20 or newer |
| React | none — the console bundles its own |

The console ships **pre-built**: one `console.js` with React 19, Radix and its
components inside, and one `console.css` compiled from Tailwind. A site needs no
React renderer, no Tailwind config and no `components.json`. That is deliberate
— the sites this runs on disagree about all three (one builds with React, three
with Preact), and a console that argued with each host's pipeline would be a
console nobody could install.

Tailwind v4 is required of the *host* only because of the cascade: a v3
preflight is unlayered, and an unlayered `* { border-width: 0 }` beats the
console's layered `.border-b` no matter how specific it is. On v4 both sides
use layers and the console's utilities win, as they should.

## Install

```sh
npm install @golumin/form-pro
```

```js
// astro.config.mjs
import formConsole from '@golumin/form-pro'

export default defineConfig({
  output: 'server',
  integrations: [
    formConsole({
      config: './src/config/locations.ts',
      mail: './src/lib/sendEmail.ts',
      env: './src/lib/consoleEnv.ts',   // Cloudflare only; see below
      repo: 'GoLumin/austinmulebox',
      crm: 'Stella',
      host: 'Cloudflare',
      title: 'Mule Box Austin',
    }),
  ],
})
```

Then write `src/config/locations.ts` exporting `LOCATIONS`, `EMAIL_LABELS` and
`SITE_SETTINGS` (see `SiteConfigModule` in `src/types.ts`), and
`src/config/revisions.json` containing `[]`.

A single-location site declares one entry and the console says "the quote form"
instead of naming markets. A site serving several declares one per market and
gets ZIP routing between them. Nothing else about the shape changes.

## What the site keeps, and why

Two files stay in the repository that deploys, because the console **edits and
commits them**: `src/config/locations.ts` and `src/config/revisions.json`.
Everything else — the types, the payload builder, the templates, the editor, the
GitHub commit, the daily check and the whole page — comes from here, so a fix
lands once and every site gets it on its next install.

Four things are seams rather than assumptions, each passed as a module path:

- **`mail`** — the site's own transport. The package renders every message and
  sends none of its own, so a preview and the daily check go out the way a real
  lead does, including through a dev outbox that a private sender would bypass.
- **`env`** — required on Cloudflare. Since Astro 6 the only way to a Worker's
  secrets is `import { env } from 'cloudflare:workers'`, a specifier that does
  not resolve anywhere else, so the site imports it and hands the reader in.
- **`quoting`** — defaults to the `virtual:quoting` module the quote-experience
  integration provides.
- **`logoResolver`** — for a site whose email logo varies by hostname.

## The quoting integration

A second integration in the same package binds `virtual:quoting` to one gofuse
instance and exposes the per-site presentation config the quote pages read.

```js
import quoteExperience from '@golumin/form-pro/quoting'

quoteExperience({
  baseUrl: 'https://mulebox.gofuse.app',
  tokenEnv: 'GOFUSE_API_TOKEN',
  env: './src/lib/consoleEnv.ts',   // Cloudflare only
  logo: '/logo.webp',
  phones: [{ label: 'Austin Customers', number: '5125752929' }],
})
```

Its stylesheet and WebGL script are package exports, imported by the page that
needs them rather than injected into every page:

```js
import scriptUrl from '@golumin/form-pro/quoting/assets/quote-experience-vt.js?url'
import '@golumin/form-pro/quoting/assets/quote-experience.css'
```

Three things about it are deliberate:

- **The token is never in the bundle.** It is read through `readEnv` at call
  time, so there is no secret to leak if the module is imported from the
  browser, and rotating it in a hosting dashboard takes effect on the next
  request rather than the next deploy.
- **`virtual:quoting` refuses to load in the client build.** A client that
  silently cannot authenticate is worse than a build that stops and names the
  file importing it. Astro's `prerender` environment is allowed — that is still
  the server.
- **`.env` is read from the project root, not the working directory**, so
  `astro dev --root apps/site`, or any script run from a parent folder, reads
  the right file. `config.root` is a `URL`, so it is converted rather than
  passed straight to `loadEnv`.

`preview` and `sync` are treated as production, because they operate on built
output and should read the variables the build did. A token change needs a
restart; there is no watch on it.

## What it adds

| Route | |
|---|---|
| `/form-preview` | the console, behind HTTP Basic auth |
| `/form-preview/api/*` | read, write, preview, submit, options |
| `/form-preview/assets/*` | the console's own bundle |
| `/api/canary` | the daily form check, behind `CANARY_TOKEN` |

### The console

- **Results** — one submission, and every decision it triggered: the location it
  resolved and why, both email envelopes, the webhook payload key by key, and
  both rendered emails. Sending and posting are opt-in per submission, so it
  runs in production safely.
- **Editor** — the configuration as a form. The emails are shown as the real
  message with every editable string click-to-edit in place; injected values are
  chips you can move or delete but not retype, and the dated one opens a picker
  of worked examples.
- **Revisions** — who changed what, when, with a diff. Written into the
  repository in the same commit as the change.
- **Settings** — what applies to the whole site rather than one location.

### The daily check

Submits a quote through every location once a day and emails a digest: routing,
catalog, pricing, webhook payload, envelope, render, and a real delivery. It
answers `200` only when everything passed, so an uptime monitor pointed at it
alerts on a broken form even if the digest is the thing that broke. No lead is
ever posted to a CRM.

Delivery is real on purpose. The outage this was written after was GetOutsend
rejecting a From whose domain was not verified in the sending workspace —
everything upstream was green, and only a real send sees it.

## Environment

| | |
|---|---|
| `FORM_CONSOLE_USER` / `FORM_CONSOLE_PASSWORD` | override the console's credentials without a deploy |
| `GITHUB_TOKEN` | enables Save and deploy. Scope it to this one repository, Contents: read and write |
| `GITHUB_REPO` / `GITHUB_BRANCH` | override the configured repository and branch |
| `CANARY_TOKEN` | required for `/api/canary` to run at all |
| `CANARY_EMAIL_TO` | overrides where the digest goes |

## Development

```sh
npm run build     # bundles console.js and compiles console.css
```

Both outputs are committed, because a `file:`/`link:` install has no build step.
`prepublishOnly` rebuilds them before a release.
