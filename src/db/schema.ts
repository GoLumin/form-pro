// The console's own tables, beside Better Auth's.
//
// Written through Kysely's schema builder rather than raw SQL so the same code
// creates them on SQLite and on Postgres. The columns are deliberately dumb —
// text ids, ISO timestamp strings, integers for booleans — because that is the
// intersection of what both speak, and because SQLite would force it anyway.

import type { Kysely } from 'kysely'
import type { SqlFlavour } from './index.ts'

export const TABLES = ['form_pro_revision', 'form_pro_canary_run'] as const

export interface RevisionRow {
  id: string
  at: string
  author: string
  slug: string
  market: string
  /** Human names of the fields that moved, comma-separated. */
  fields: string
  /** 'local' or 'deploy'. */
  kind: string
  commit_sha: string | null
  commit_url: string | null
  /** The before/after pairs, as JSON. */
  changes: string | null
}

export interface CanaryRunRow {
  id: string
  at: string
  ok: number
  sent: number
  recipient: string
  /** The full report, as JSON, so a failure can be read back in full. */
  report: string
}

/** Creates anything missing. Safe to run repeatedly. */
export async function createTables(db: Kysely<any>, _flavour: SqlFlavour): Promise<string[]> {
  const created: string[] = []

  const revision = db.schema
    .createTable('form_pro_revision')
    .ifNotExists()
    .addColumn('id', 'text', (c) => c.primaryKey())
    .addColumn('at', 'text', (c) => c.notNull())
    .addColumn('author', 'text', (c) => c.notNull())
    .addColumn('slug', 'text', (c) => c.notNull())
    .addColumn('market', 'text', (c) => c.notNull())
    .addColumn('fields', 'text', (c) => c.notNull())
    .addColumn('kind', 'text', (c) => c.notNull())
    .addColumn('commit_sha', 'text')
    .addColumn('commit_url', 'text')
    .addColumn('changes', 'text')

  const canary = db.schema
    .createTable('form_pro_canary_run')
    .ifNotExists()
    .addColumn('id', 'text', (c) => c.primaryKey())
    .addColumn('at', 'text', (c) => c.notNull())
    .addColumn('ok', 'integer', (c) => c.notNull())
    .addColumn('sent', 'integer', (c) => c.notNull())
    .addColumn('recipient', 'text', (c) => c.notNull())
    .addColumn('report', 'text', (c) => c.notNull())

  for (const [name, statement] of [
    ['form_pro_revision', revision],
    ['form_pro_canary_run', canary],
  ] as const) {
    await statement.execute()
    created.push(name)
  }

  // Newest first is how both are read, every time.
  for (const [table, column] of [
    ['form_pro_revision', 'at'],
    ['form_pro_canary_run', 'at'],
  ] as const) {
    await db.schema
      .createIndex(`${table}_at_idx`)
      .ifNotExists()
      .on(table)
      .column(column)
      .execute()
  }

  return created
}

/** Which of our tables already exist, for the Settings tab to report. */
export async function presentTables(db: Kysely<any>): Promise<string[]> {
  const tables = await db.introspection.getTables()
  const names = new Set(tables.map((t) => t.name))
  return TABLES.filter((t) => names.has(t))
}
