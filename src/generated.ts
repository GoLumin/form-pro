// Code the integrations write at build time, once the host is known.
//
// Generated rather than shipped as branches behind a runtime check, because the
// branches are not portable: `cloudflare:workers` does not resolve off
// Cloudflare and `pg` does not run on it. Emitting only the one this site can
// use means the other never reaches the bundle — and a site installs the plugin
// instead of writing these modules itself.

export type Adapter = 'cloudflare' | 'netlify' | 'node' | 'unknown'

/** Which host this site deploys to, from the adapter it configured. */
export function adapterKind(name: string | undefined): Adapter {
  if (!name) return 'unknown'
  if (name.includes('cloudflare')) return 'cloudflare'
  if (name.includes('netlify')) return 'netlify'
  if (name.includes('node')) return 'node'
  return 'unknown'
}

/**
 * Reading a variable on one host.
 *
 * Cloudflare keeps secrets on the Worker's own env and, since Astro 6, behind a
 * specifier that resolves nowhere else. Everywhere else `process.env` and
 * `import.meta.env` are all there is, and env.ts already reads both.
 */
export function envModule(adapter: Adapter): string {
  if (adapter !== 'cloudflare') return 'export const readEnv = () => undefined'
  return `
import { env } from 'cloudflare:workers'

export function readEnv(name) {
  try {
    const value = env[name]
    return value == null ? undefined : String(value)
  } catch {
    // Read outside a request, where the Worker env does not exist yet.
    return undefined
  }
}`
}

/** The console's database client for one host. */
export function databaseModule(
  adapter: Adapter,
  options: { binding?: string; urlEnv?: string }
): string {
  if (adapter === 'cloudflare') {
    const binding = options.binding ?? 'CONSOLE_DB'
    return `
import { env } from 'cloudflare:workers'
import { d1Handle } from '@golumin/form-pro/db/d1'

export function database() {
  try {
    return d1Handle(env[${JSON.stringify(binding)}], ${JSON.stringify(binding)})
  } catch {
    // Outside a request there is no env to read, which is not a failure.
    return null
  }
}`
  }

  // Netlify and any Node host. Netlify Database sets NETLIFY_DATABASE_URL; the
  // other names are what a site is likely to already have.
  const names = [options.urlEnv, 'NETLIFY_DATABASE_URL', 'DATABASE_URL'].filter(Boolean)
  return `
import { postgresHandle } from '@golumin/form-pro/db/postgres'

export function database() {
  return postgresHandle(${JSON.stringify(names)})
}`
}
