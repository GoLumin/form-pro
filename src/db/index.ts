// The database seam.
//
// The package never picks a database. Each site hands one in, because the two
// hosts have different native storage and neither is reachable from the other:
// a Cloudflare site binds D1, a Netlify one connects to its Postgres, and
// a local `astro dev` has neither, so it opens a file.
//
// All three arrive here as a Kysely dialect plus the SQL flavour it speaks,
// which is the shape Better Auth's own adapter takes — so nothing downstream
// has to know which host it is running on.

import { Kysely } from 'kysely'
import { database } from 'virtual:form-pro/db'

export type SqlFlavour = 'sqlite' | 'postgres' | 'mysql' | 'mssql'

export interface DatabaseHandle {
  dialect: unknown
  type: SqlFlavour
  /** Shown in the console, e.g. "Cloudflare D1" or "a local file". */
  label?: string
}

let cached: { handle: DatabaseHandle; db: Kysely<any> } | null = null
let failure: string | null = null

/**
 * The site's database, or null when it has not configured one.
 *
 * Null is a supported state, not an error: a site with no database keeps the
 * shared-password gate it had before, and the Settings tab is what moves it
 * from one to the other.
 */
export function handle(): DatabaseHandle | null {
  if (cached) return cached.handle
  if (failure) return null
  try {
    const resolved = database?.()
    if (!resolved) return null
    cached = { handle: resolved, db: new Kysely<any>({ dialect: resolved.dialect as any }) }
    return cached.handle
  } catch (error) {
    // A misconfigured database must not take the console down — it is the one
    // page you would use to find out why.
    failure = String((error as Error).message)
    console.error('form-pro: could not open the database:', error)
    return null
  }
}

/** The Kysely instance, or null when no database is configured. */
export function db(): Kysely<any> | null {
  handle()
  return cached?.db ?? null
}

/** Why the database could not be opened, when that is what happened. */
export function openError(): string | null {
  return failure
}

export function configured(): boolean {
  return handle() !== null
}
