// What the Settings tab's Connect button talks to.
//
// Reporting and creating are the same endpoint because they answer the same
// question from opposite ends: what is missing, and make it stop being missing.
// Creating is deliberately not automatic on boot — a console that silently
// writes tables into a database on first request is a console you cannot point
// at the wrong database safely.

import type { APIRoute } from 'astro'
import { getMigrations } from 'better-auth/db/migration'
import { authorize, fail, json } from './_shared.ts'
import options from 'virtual:form-pro/options'
import { auth, allowlist } from '../../auth/server.ts'
import { db, handle, openError } from '../../db/index.ts'
import { createTables, presentTables, TABLES } from '../../db/schema.ts'
import { envValue } from '../../env.ts'

export const prerender = false

/** What each host's native storage is called, for the button's label. */
const STORAGE: Record<string, string> = {
  cloudflare: 'Cloudflare D1',
  netlify: 'Netlify Database',
  node: 'the configured database',
  unknown: 'the configured database',
}

interface Body {
  token?: string
  /** Absent reports; 'create' runs the migrations. */
  action?: 'create'
}

async function report() {
  const database = handle()
  const storage = STORAGE[options.adapter] ?? STORAGE.unknown

  if (!database) {
    return {
      configured: false,
      storage,
      adapter: options.adapter,
      // Told apart on purpose: nothing to connect to, versus something that
      // would not open. The first is a setup step, the second is a fault.
      reason:
        openError() ??
        (options.hasDb
          ? 'No storage is attached in this environment yet.'
          : 'Storage is switched off for this site.'),
      secret: Boolean(envValue('BETTER_AUTH_SECRET')),
      allowlist: allowlist(),
      tables: { auth: [], console: [] },
      ready: false,
    }
  }

  const kysely = db()!
  const ours = await presentTables(kysely).catch(() => [] as string[])

  // Better Auth's own plan, asked for read-only, so the button can say what it
  // is about to create rather than "set up the database".
  let authPending: string[] = []
  let authError: string | null = null
  try {
    const a = auth()
    if (a) {
      const plan = await getMigrations((a as unknown as { options: any }).options, {
        throwOnUnsafe: false,
      })
      authPending = [
        ...plan.toBeCreated.map((t) => t.table),
        ...plan.toBeAdded.map((t) => `${t.table} (columns)`),
      ]
    }
  } catch (error) {
    authError = String((error as Error).message)
  }

  const consolePending = TABLES.filter((t) => !ours.includes(t))
  return {
    configured: true,
    storage: database.label ?? storage,
    adapter: options.adapter,
    flavour: database.type,
    secret: Boolean(envValue('BETTER_AUTH_SECRET')),
    allowlist: allowlist(),
    tables: { auth: authPending, console: ours },
    pending: [...authPending, ...consolePending],
    authError,
    ready: authPending.length === 0 && consolePending.length === 0,
  }
}

export const POST: APIRoute = async (context) => {
  const checked = await authorize<Body>(context)
  if ('response' in checked) return checked.response

  if (checked.body.action !== 'create') return json(await report())

  const kysely = db()
  if (!kysely) return fail('There is no database to create tables in.')

  try {
    const a = auth()
    if (a) {
      const plan = await getMigrations((a as unknown as { options: any }).options)
      await plan.runMigrations()
    }
    await createTables(kysely, handle()!.type)
  } catch (error) {
    return fail(`Creating the tables failed: ${String((error as Error).message)}`)
  }

  return json({ created: true, ...(await report()) })
}
