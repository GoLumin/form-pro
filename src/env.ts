// Reading configuration out of the environment, on every runtime these sites
// use — which no single mechanism covers.
//
// A Node host (Netlify) puts variables on `process.env`, and Vite inlines the
// public ones into `import.meta.env`. A Cloudflare Worker has neither: secrets
// arrive with the request, and since Astro 6 the only way to reach them is
// `import { env } from 'cloudflare:workers'` — an import that does not resolve
// off Cloudflare, so this package cannot make it.
//
// So the site makes it. `virtual:form-pro/env` is whatever module the
// integration was pointed at; without one it is the Node path, which is right
// for a Node host and empty on a Worker. Everything here goes through that seam
// rather than through `Astro.locals`, which used to carry the Worker's env and
// now throws when touched.
//
// It is a lookup rather than a cached object on purpose: a value changed in a
// hosting dashboard takes effect on the next request instead of the next
// deploy, and nothing holds a secret longer than one call.

import { readEnv } from 'virtual:form-pro/env'

type Bag = Record<string, unknown> | undefined

const nodeEnv = (): Bag =>
  typeof process !== 'undefined'
    ? (process.env as unknown as Record<string, unknown>)
    : undefined

const viteEnv = (): Bag => import.meta.env as unknown as Record<string, unknown>

/** One variable, trimmed; '' when it is not set anywhere. */
export function envValue(name: string): string {
  let fromSite: unknown
  try {
    fromSite = readEnv(name)
  } catch {
    // A site whose reader is only valid on its own runtime — `cloudflare:workers`
    // outside a request, say — must not take the page down with it.
    fromSite = undefined
  }
  for (const raw of [fromSite, nodeEnv()?.[name], viteEnv()?.[name]]) {
    if (raw != null && String(raw).trim() !== '') return String(raw).trim()
  }
  return ''
}

/** Case-insensitive flag comparison, so DEV_MODE=True behaves like true. */
export function envFlagIs(name: string, expected: string): boolean {
  return envValue(name).toLowerCase() === expected.toLowerCase()
}
