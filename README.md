# @golumin/form-pro

An Astro integration that gives a site **one declared source of truth** for its
lead forms — what the form collects, who each email comes from and goes to, and
exactly which keys its CRM webhook accepts — plus an authenticated console at
`/form-preview` to test, edit, deploy and monitor all of it.

It exists because these values only work as a set. A From address only sends if
its domain is verified in the account whose key is used. A CRM webhook only maps
the keys its own field-mapping screen declares. A webhook key can only draw from
a field the form actually asks for. Splitting them across files and hosting
dashboards is what lets a correct payload reach a webhook that cannot read it,
and what lets a renamed field quietly empty a required CRM column — with nothing
visibly wrong on the site either time.

Nothing in the package knows what any particular form asks. A site declares its
fields once and everything reads that list: the rows in both emails, the source
fields a webhook key may draw from, the console's test submission, and the
validation on the way in. Adding a question is a change in one file, in the
site's own repository.

## Requirements

| | |
|---|---|
| Astro | **6 or newer**, with an adapter |
| Tailwind | **v4** on the host site |
| Node | 20 or newer |
| React | none — the console bundles its own |

The console is server-rendered and its endpoints are API routes, so the site
needs an **adapter** — something to run them on. It does **not** need
`output: 'server'`. Every route the integration injects declares
`export const prerender = false` in its own file, and that wins over the site's
output mode, so a site on `output: 'static'` with an adapter serves the console
on demand and keeps prerendering everything else exactly as before.

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
  // Any adapter; `output` can stay 'static'.
  adapter: cloudflare(),
  integrations: [
    formConsole({
      config: './src/config/form.ts',
      mail: './src/lib/sendEmail.ts',
      env: './src/lib/consoleEnv.ts',   // Cloudflare only; see below
      repo: 'you/your-site',
      crm: 'HubSpot',
      host: 'Cloudflare',
      title: 'Example Co',
      // Declare these. The fallback is the same two words in every site that
      // installs the package; FORM_CONSOLE_USER / FORM_CONSOLE_PASSWORD in the
      // environment win over them and are what production should use.
      user: 'example',
      password: 'change-me',
    }),
  ],
})
```

Then write `src/config/form.ts` and `src/config/revisions.json` (containing
`[]`). Two worked configs ship with the package and are typechecked with it:
[`src/examples/contactForm.ts`](src/examples/contactForm.ts) — one form, one
inbox, one CRM — and [`src/examples/quoteForm.ts`](src/examples/quoteForm.ts) —
several profiles, routing between them, and a pricing back end. Copy whichever
is closer.

## The config

Four exports, and two more only if you need them.

### `FIELDS` — what the form collects

```ts
export const FIELDS = [
  { id: 'firstName', label: 'First name', type: 'text', required: true },
  { id: 'email', label: 'Email', type: 'email', required: true, audience: 'admin' },
  {
    id: 'topic',
    label: 'What about',
    type: 'choice',
    options: [
      { value: 'sales', label: 'Sales' },
      { value: 'support', label: 'Support' },
    ],
  },
  { id: 'storageType', label: 'Storage', type: 'choice', options: [...],
    showWhen: { serviceType: 'store_it' } },
  { id: 'fullName', label: 'Name', type: 'text',
    derive: (v) => `${v.firstName} ${v.lastName}`.trim() },
] as const satisfies readonly FieldDef[]
```

Types are `text`, `email`, `phone`, `date`, `zip`, `number`, `choice` and
`textarea` — a closed list, because this is a lead pipeline rather than a form
builder, and each one has to be something the emails and the webhook know how to
write down.

- **`showWhen`** is evaluated in the console's test form, in the emails and on
  the way in, so a field that was not asked for is also not reported, not mailed
  and not sent to the CRM. One rule, not four.
- **`audience: 'admin'`** keeps a row out of the client's own copy. Telling
  someone their own phone number back is the one thing in the message they
  cannot need.
- **`derive`** computes a value from the others, so it can never drift from
  them. Derived fields are never asked for, and the function itself never
  reaches the browser.
- **`hidden`** keeps a field out of the emails' rows while still collecting it
  and still sending it to the CRM — the two halves of a name that a derived
  field already prints as one line.
- **`headline: true`** names the field that says who a submission is from; it
  becomes the heading of the internal email.
- **`label`** is the only part the console can edit: it is the words beside the
  value in both emails, and that is copy. The rest is structure, and changing it
  changes what the webhook keys can draw from.

Declaring it `as const satisfies readonly FieldDef[]` is what makes the ids
checkable. Then use `ProfileFor<typeof FIELDS>`, `RoutingConfigFor<…>` and
`QuotingConfigFor<…>` and a key pointed at a field that was renamed is a type
error with a suggestion, rather than an empty column in the CRM:

```
Type '"firstNmae"' is not assignable to type '"email" | "firstName" | …'.
Did you mean '"firstName"'?
```

### `PROFILES` — where a lead goes

One destination: the brand on the email, the envelopes, the copy, the CRM
webhook and its keys. A site with one form and one inbox declares one and never
thinks about it again. A site serving several markets, brands or business units
declares one each — nothing else about the shape changes.

`fieldOptions` narrows a choice field per profile ("this branch doesn't sell
that"), and `canary` is what the daily check submits as this profile.

`emailLogoBackground` is for a brand whose logo does not survive the page it is
placed on. The email renders the logo above the card, on a near-white page,
which suits a mark drawn in dark ink — a white logo, or one outlined in white
for a dark header, disappears there. Set it to the colour the logo was drawn
for and it gets a padded panel of that colour instead. Unset is the page
background, which is what every site had before the option existed.

### `EMAIL_LABELS` and `SITE_SETTINGS`

Shared wording — the date format, the subject template, and the pricing block's
words for a site that has one — and the settings that belong to the site rather
than a profile.

### `ROUTING` — which profile handles a submission

Optional. Defaults to `single` for one profile and `page` for several.

| kind | |
|---|---|
| `single` | the one profile, always. Nothing is asked and nothing can fail |
| `page` | the page the form was submitted from names it, by slug |
| `lookup` | one field's value decides — each profile is asked, in order, and the first that covers it wins |

`lookup` takes a `probe`, because whether a profile covers a value is a question
only the site's own back end can answer. The package ships `zipCoverageProbe()`
for the common case of asking a pricing instance; anything else is a few lines
in the config.

A page keeps its own profile whenever that profile covers the value, so an
in-area visitor is never handed off just because another profile was asked
earlier. Coverage that cannot be determined falls back to the page's own profile
rather than refusing — a back end being down must not cost that profile a lead
it already had in hand.

### `QUOTING` — a pricing back end

Optional, and off unless the integration is passed `quoting: true` or a path. A
site that prices nothing neither imports one nor carries it in the bundle.

It declares which of the site's fields each call is built from — which one holds
the ZIP, which the date, which decides the service — and that is the whole join
between what the form asks and what the back end is told.

## What the site keeps, and why

Two files stay in the repository that deploys, because the console **edits and
commits them**: `src/config/form.ts` and `src/config/revisions.json`.
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
- **`quoting`** — `true` for the `virtual:quoting` module the quote-experience
  integration provides, or a path to the site's own client. Off by default.
- **`logoResolver`** — for a site whose email logo varies by hostname.

## The quoting integration

A second integration in the same package binds `virtual:quoting` to one gofuse
instance and exposes the per-site presentation config the quote pages read.

```js
import quoteExperience from '@golumin/form-pro/quoting'

quoteExperience({
  baseUrl: 'https://example.gofuse.app',
  tokenEnv: 'GOFUSE_API_TOKEN',
  env: './src/lib/consoleEnv.ts',   // Cloudflare only
  logo: '/logo.webp',
  phones: [{ label: 'Austin', number: '5125550100' }],
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

It is laid out as an instrument panel rather than a settings page. Across the
top sit the two **arming switches** — really send the emails, really file the
lead — and a status word that reads *Safe* until one of them is thrown. They are
above every screen rather than inside the test form, because whether a run
reaches a real inbox is the most consequential thing on the page and the easiest
to forget. Both reset on reload.

- **Path** — one submission and every decision it triggered, drawn as a single
  chain: what was submitted, the profile it resolved to and why, both email
  envelopes, the webhook payload key by key with what filled each, and where the
  visitor lands. The stations under the profile inherit that one decision, which
  is what makes a mismatch visible rather than merely present.
- **Wiring** — what the form collects on the left, what the webhook accepts on
  the right, and a line for every key that draws from a field. A field with no
  line leaving it is flagged: the form asks for it and nothing about it reaches
  the CRM.
- **Fields** — the label beside each question, with what else that label is read
  by worked out from the declaration: both emails, the subject line, any webhook
  key drawn from it, and the other profiles.
- **Envelopes**, **Email copy**, **Subject line** — the emails are shown as the
  real message with every editable string click-to-edit in place; injected
  values are chips you can move or delete but not retype, and the dated one
  opens a picker of worked examples.
- **History** — who changed what, when, with a diff. Written into the repository
  in the same commit as the change.
- **Settings** — what applies to the whole site rather than one profile.

Saving and deploying both open a dialog listing the changes about to be written,
worked out in the browser from what was loaded, with anything shared by every
profile marked as such. Deploy is a button you hold rather than click: a commit
that goes live with no review step deserves more of a gate than an OK one
keystroke from the caret.

The page is dark, and loads Archivo, Instrument Serif and JetBrains Mono from
Google Fonts in `routes/console.astro`. Every stack falls back to a face with
close metrics, so a network that cannot reach `fonts.googleapis.com` gets a
plainer console rather than a broken one — and deleting those two `<link>` lines
is a supported way to opt out.

### The daily check

Submits through every profile once a day and emails a digest: routing, pricing
where the site has any, webhook payload, envelope, render, and a real delivery.
It answers `200` only when everything passed, so an uptime monitor pointed at it
alerts on a broken form even if the digest is the thing that broke. No lead is
ever posted to a CRM.

Delivery is real on purpose. The outage this was written after was the transport
rejecting a From whose domain was not verified in the sending workspace —
everything upstream was green, and only a real send sees it.

## Known limitation

One `FIELDS` list per site, so a site with two genuinely different forms — a
contact form and a franchise enquiry, say — needs two installs or a superset of
fields with `showWhen`. Several forms per site is the next thing to add.

## Environment

| | |
|---|---|
| `FORM_CONSOLE_USER` / `FORM_CONSOLE_PASSWORD` | the console's credentials. Set these on anything that matters — they win over `user`/`password` in the config, so rotating needs no deploy |
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
