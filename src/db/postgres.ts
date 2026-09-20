// The Postgres half of the database seam: Netlify Database, or any Node host
// with a connection string.

import { PostgresDialect } from 'kysely'
import pg from 'pg'
import type { DatabaseHandle } from './index.ts'

export function postgresHandle(names: string[]): DatabaseHandle | null {
  const name = names.find((n) => process.env?.[n])
  if (!name) return null
  return {
    dialect: new PostgresDialect({
      // One connection: this runs in a serverless function handling a single
      // request, and a pool per invocation is a pool nothing reuses.
      pool: new pg.Pool({ connectionString: process.env[name], max: 1 }),
    }),
    type: 'postgres',
    label: name === 'NETLIFY_DATABASE_URL' ? 'Netlify Database' : `Postgres (${name})`,
  }
}
