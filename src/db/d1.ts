// The D1 half of the database seam.
//
// A real file in the package rather than code generated into the site, because
// a generated module resolves its imports against the *project* root and
// `kysely-d1` lives here. Only the `cloudflare:workers` import has to be
// generated — that one genuinely cannot exist anywhere else.

import { D1Dialect } from 'kysely-d1'
import type { DatabaseHandle } from './index.ts'

export function d1Handle(binding: unknown, name: string): DatabaseHandle | null {
  if (!binding) return null
  return {
    dialect: new D1Dialect({ database: binding as never }),
    type: 'sqlite',
    label: `Cloudflare D1 (${name})`,
  }
}
