# AGENTS.md

Notes for AI agents working on this repo.

## What this package is

An Astro integration giving a site one declared source of truth for its lead
forms — what the form collects, both email envelopes, and exactly which keys
its CRM webhook accepts — plus an authenticated console at `/form-preview` to
test, edit, deploy and monitor it.

The dividing line runs through everything here: **this package owns the shapes
and the machinery, the site owns the values.** A site's `src/config/form.ts`
holds its fields, profiles, envelopes and webhook keys, and stays in the
repository that deploys, because that is the file the console edits and commits
back. Nothing in here should ever know what a particular form asks.

Two integrations ship from one package, and they install independently:

| entrypoint | export | gives the site |
|---|---|---|
| `@golumin/form-pro` | `formConsole()` | the `/form-preview` console and its API routes |
| `@golumin/form-pro/quoting` | `quoteExperience()` | `virtual:quoting`, the quote page's client and assets |

A site can take the quoting half alone. Several do — don't assume the console
is installed wherever the package is.

## The consuming sites

Changes here reach real sites on the next install, so judge them against one.
Clone beside this repo:

```sh
gh repo clone GoLumin/mibox-rhode-island   # Cloudflare, output: "static", console + quoting
gh repo clone GoLumin/miboxvw              # Cloudflare, output: "server", quoting only
gh repo clone Brem-LLC/mulebox             # Netlify,    output: "server", console + quoting, 4 profiles
```

They disagree on host, output mode and profile count on purpose — between them
they cover most of what the integration has to tolerate. To try a change
against one without publishing, swap the installed copy for this working tree:

```sh
cd ../mibox-rhode-island
mv node_modules/@golumin/form-pro node_modules/@golumin/form-pro.bak
ln -s "$(cd ../form-pro && pwd)" node_modules/@golumin/form-pro
npm run build            # then put the .bak back when finished
```

## Releasing — the part that is easy to get wrong

**The built console is committed.** `src/console/console.js`, `signin.js` and
`console.css` are build outputs that live in git, because consumers install
this as a **git dependency** and a git install has no build step. Change
anything under `src/console/` and you must:

```sh
npm run build     # bundles console.js + signin.js, compiles console.css
```

and commit the regenerated files, or every site keeps running the old console.

**Releases are git tags.** Every site pins
`git+https://github.com/GoLumin/form-pro.git#semver:^0.1.0`, which resolves
against tags — an untagged push on `main` reaches nobody. The full sequence:

```sh
npm run build
npm version 0.1.10 --no-git-tag-version
git add -A && git commit
git tag v0.1.10
git push origin main && git push origin v0.1.10
```

Consumers then need `npm install` to move; `npm ci` holds the lockfile's commit.

**`package-lock.json` is deliberately not committed** — see `.gitignore`. npm
obeys a committed lockfile while preparing a git dependency, which would impose
our exact transitive pins on every consuming site's CI.

**Never create two files whose names differ only in case.** This bit us:
`src/console/SignIn.tsx` and `src/console/signin.tsx` could not coexist on
macOS or Windows, so a clone there got one file under both names — and the
build still *passed*, with esbuild quietly warning the import would be
`undefined` and emitting a sign-in bundle that rendered nothing. v0.1.8 shipped
that way. The entry is `signin-entry.tsx` now and `scripts/build.mjs` maps
entry points by name so the output is still `signin.js`. Before releasing,
check:

```sh
git ls-files | tr 'A-Z' 'a-z' | sort | uniq -d     # must print nothing
```

## The host contract — keep the footprint small

This package is a guest in someone else's Astro build. It currently injects
**nothing** global into a host's pages: no middleware, no `injectScript`, no
renderer, no client directive. Its Vite changes are scoped to itself
(`ssr.noExternal`, `optimizeDeps.exclude`, `resolve.alias`). Preserve that.

- **Never require `output: 'server'`.** Every injected route declares
  `export const prerender = false` in its own file, and that declaration wins
  over the site's output mode — so `output: 'static'` with an adapter serves
  the console fine and keeps prerendering everything else. The integration
  warns on a **missing adapter**, which is the real requirement. (It used to
  test `output === 'static'` and talked sites out of a configuration that
  works.) If you add a route, give it that export.
- **The console ships pre-built with its own React.** Consuming sites disagree
  about React vs Preact and about Tailwind config; bundling here ends the
  argument. Don't make the host compile the console, and don't require a
  renderer, a Tailwind config or a `components.json` from it.
- Tailwind **v4 on the host** is a genuine requirement, and only because of the
  cascade: a v3 preflight is unlayered and beats the console's layered
  utilities. Don't try to fix that with specificity.

## Virtual modules are aliases, not plugin-served

`virtual:form-pro/*`, `virtual:quoting`, `virtual:turnstile` and
`virtual:getoutsend` are Vite **aliases to generated files** under
`.astro/`, not ids served from a plugin's `resolveId`. That is load-bearing: a
plugin's `resolveId` is never consulted for an import appearing inside
`node_modules`, so a published package that imported these could not resolve
them. If you add one, generate a file and alias it — with an **anchored regex
in array form**, because a string alias matches by prefix (`virtual:quoting`
would swallow `virtual:quoting/config`) and arrays concatenate when several
integrations each add their own.

The ones this package defines: `options`, `config`, `mail`, `env`, `db`,
`logo`, `quoting`, `assets`, all under `virtual:form-pro/`.

## The seams

Four things are passed in as module paths rather than assumed, and each exists
for a reason worth preserving:

- **`mail`** — the site's own transport. The package renders every message and
  sends none, so a preview and the daily check go out the way a real lead does,
  including through a site's dev outbox. It is imported *lazily*: a static
  re-export puts the site's transport on a path the dependency scanner walks in
  from this package, where its virtual ids cannot resolve.
- **`env`** — required on Cloudflare. Since Astro 6 the only route to a
  Worker's secrets is `import { env } from 'cloudflare:workers'`, a specifier
  that resolves nowhere else, so the site imports it and hands the reader in.
- **`quoting`** — `true` for the quoting integration's `virtual:quoting`, or a
  path to the site's own client. Off by default, so a site that prices nothing
  carries none of it.
- **`logoResolver`** — for a site whose email logo varies by hostname.

Secrets are read through `readEnv` **at call time**, never baked into a
generated module. That is why rotating a token in a hosting dashboard takes
effect on the next request rather than the next deploy, and why there is
nothing to leak if a module is imported from the browser. Don't "simplify" this
by inlining a value at build time.

## The config writer

`src/editor/` is the only part of this package that edits a site's own source,
and a mangled edit is not a failure anyone sees until the next build. It writes
one field on one line inside one profile's block and deliberately does **not**
regenerate the file — most of what is in a site config is the comments
explaining why a value is what it is, and regenerating would throw all of that
away the first time anyone saved. It also only ever works on a dev server; a
deployed build has a read-only filesystem.

Its round trip is covered:

```sh
npm test          # runs every writer over src/examples/contactForm.ts
```

That writes `src/examples/__writer_output.ts` (gitignored) for a typecheck.
**Run it after any change under `src/editor/` or to the config shapes.** The
scanners must also skip commented-out code — a past release did not.

## Checks, and the failures that are not yours

```sh
npm run build     # required before release; also catches esbuild warnings
npm test          # the config writer round trip
```

Two pre-existing failures will greet you; don't chase them unless that is the
task:

- `npx tsc --noEmit` fails immediately on `tsconfig.json`'s `baseUrl`, removed
  in TypeScript 7 (this package's own devDependency).
- With that worked around, one error remains in `src/auth/server.ts`, a
  better-auth generic-variance complaint.

Read esbuild's warnings during `npm run build`. The broken sign-in bundle
announced itself there for a whole release and was scrolled past.

## Known limitation

One `FIELDS` list per site. A site with two genuinely different forms — a
quote form and a contact form — needs a superset with `showWhen` gating each
half off a discriminator field (mibox-rhode-island does exactly this, keyed on
`formType`), or two installs. Several forms per site is the next thing to add,
and would be the right fix.
