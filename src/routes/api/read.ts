// The current editable values, straight off the imported config, plus the
// revision log and what this environment will let you do with them.

import type { APIRoute } from 'astro'
import { authorize, json, readRevisions } from './_shared.ts'
import { readEditable, readLabels, readSettings } from '../../editor/source.ts'
import { githubConfig } from '../../editor/github.ts'

export const prerender = false

export const POST: APIRoute = async (context) => {
  const checked = await authorize(context)
  if ('response' in checked) return checked.response

  return json({
    locations: readEditable(),
    labels: readLabels(),
    settings: readSettings(),
    revisions: await readRevisions(),
    // Writing to disk only means anything where there is one to write to.
    writable: Boolean(import.meta.env.DEV),
    deployable: Boolean(githubConfig()),
  })
}
