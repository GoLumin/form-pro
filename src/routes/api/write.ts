// Writing the editor's changes back into the site's config module.
//
// Two destinations, one code path. `deploy: false` writes to disk and only
// works on a dev server: a deployed build runs compiled output on a read-only
// filesystem, so a write there would change nothing and survive nothing —
// rather than pretend, it hands back the lines that would have been written and
// says so. `deploy: true` commits to GitHub, which is what actually ships.
//
// Either way the edit is applied to the source *text* and the result is checked
// before anything is written. A file that has drifted from the shape the editor
// expects fails loudly instead of being mangled — the one failure mode that can
// take the whole site's build down.

import type { APIRoute } from 'astro'
import { authorize, fail, json, readSource } from './_shared.ts'
import {
  applyEdit,
  applyKeys,
  applyLabels,
  applySettings,
  changedFields,
  diffEditable,
  readEditable,
  readLabels,
  SOURCE_PATH,
  type EditableKey,
  type EditPayload,
} from '../../editor/source.ts'
import { getFile, githubConfig, putFiles } from '../../editor/github.ts'
import {
  addRevision,
  parseRevisions,
  REVISIONS_PATH,
  serialiseRevisions,
  type Revision,
} from '../../editor/revisions.ts'

export const prerender = false

interface Body extends Record<string, unknown> {
  token?: string
  author?: string
  slug?: string
  deploy?: boolean
}

/** Every field the editor may set, so a malformed body cannot reach the file. */
function validate(edit: Record<string, unknown>): string | null {
  const text = (v: unknown) => typeof v === 'string' && v.trim() !== ''
  if (!text(edit.slug)) return 'slug is required'
  if (!text(edit.author)) return 'A name is required, so the revision says who'
  for (const field of ['emailBrand', 'phoneNumber', 'emailResponsePromise', 'webhookUrl']) {
    if (!text(edit[field])) return `${field} cannot be empty`
  }
  try {
    // eslint-disable-next-line no-new
    new URL(String(edit.webhookUrl))
  } catch {
    return 'The webhook URL is not a URL'
  }
  if (!Array.isArray(edit.webhookKeys) || edit.webhookKeys.length === 0) {
    return 'A webhook with no keys would post an empty lead'
  }
  for (const key of edit.webhookKeys as { key?: unknown }[]) {
    if (!text(key.key)) return 'Every webhook key needs a name'
  }
  for (const envelope of ['clientEmail', 'adminEmail'] as const) {
    const e = edit[envelope] as { fromName?: unknown; fromAddress?: unknown } | undefined
    if (!e || !text(e.fromName)) return `${envelope}: a From name is required`
    if (!text(e.fromAddress) || !String(e.fromAddress).includes('@')) {
      return `${envelope}: a From address is required`
    }
  }
  return null
}

/** Applies the whole edit to the source text, in the order the file expects. */
function applyAll(before: string, edit: Record<string, any>): string {
  return applySettings(
    applyKeys(
      applyLabels(applyEdit(before, edit as EditPayload), edit.emailLabels),
      String(edit.slug),
      edit.webhookKeys as EditableKey[]
    ),
    edit.settings
  )
}

export const POST: APIRoute = async (context) => {
  const checked = await authorize<Body>(context)
  if ('response' in checked) return checked.response
  const { token, deploy, ...edit } = checked.body

  const invalid = validate(edit)
  if (invalid) return fail(invalid)

  const author = String(edit.author).trim()
  const slug = String(edit.slug)
  const current = readEditable().find((l) => l.slug === slug)
  const market = current?.name ?? slug
  const labelsBefore = readLabels()

  const config = githubConfig()
  if (deploy && !config) {
    return fail('No GITHUB_TOKEN is set, so there is nothing to push to.')
  }

  // The base is whichever copy is authoritative for where this is going: the
  // repository for a deploy — a deployed build is a snapshot and can be several
  // commits behind — and the working file for a local save.
  let before: string
  let sha: string | undefined
  try {
    if (deploy && config) {
      const remote = await getFile(config, SOURCE_PATH)
      before = remote.content
      sha = remote.sha
    } else {
      const source = await readSource()
      before = source.text
    }
  } catch (error) {
    return fail((error as Error).message)
  }

  let after: string
  try {
    after = applyAll(before, edit)
  } catch (error) {
    return fail(
      `${SOURCE_PATH} is not in the shape the editor expects, so nothing was written: ${
        (error as Error).message
      }`
    )
  }

  if (after === before) {
    return json({ written: false, committed: false, changed: false, source: SOURCE_PATH, diff: [] })
  }

  const beforeLines = before.split('\n')
  const diff = after
    .split('\n')
    .map((line, i) => ({ line, i }))
    .filter(({ line, i }) => beforeLines[i] !== line)
    .slice(0, 40)
    .map(({ line }) => line.trim())

  const fields = changedFields(current, edit as any, labelsBefore)
  const changes = diffEditable(current, edit as any, labelsBefore, (edit as any).emailLabels)

  if (deploy && config) {
    const revision: Revision = {
      at: new Date().toISOString(),
      author,
      slug,
      market,
      fields,
      kind: 'deploy',
      changes,
    }
    // The log ships in the same commit, read from the repository so it cannot
    // be clobbered by a stale local copy.
    let existing: Revision[] = []
    try {
      existing = parseRevisions((await getFile(config, REVISIONS_PATH)).content)
    } catch {
      // No log yet on this branch; the commit below creates it.
      existing = []
    }
    const message =
      `${market}: update ${fields.length ? fields.join(', ') : 'configuration'}\n\n` +
      `Edited from the form console by ${author}.`
    try {
      const commit = await putFiles(
        config,
        [
          { path: SOURCE_PATH, content: after },
          {
            path: REVISIONS_PATH,
            content: serialiseRevisions(addRevision(existing, revision)),
          },
        ],
        message
      )
      return json({ committed: true, changed: true, market, commit, fields, diff, revision })
    } catch (error) {
      return fail((error as Error).message)
    }
  }

  if (!import.meta.env.DEV) {
    return json({ written: false, committed: false, changed: true, source: SOURCE_PATH, diff })
  }

  const revision: Revision = {
    at: new Date().toISOString(),
    author,
    slug,
    market,
    fields,
    kind: 'local',
    changes,
  }

  const { writeFile, readFile } = await import('node:fs/promises')
  const path = await import('node:path')
  await writeFile(path.join(process.cwd(), SOURCE_PATH), after, 'utf8')

  // The log must never cost a save: a failure here is reported, not thrown.
  let logged = true
  try {
    const logPath = path.join(process.cwd(), REVISIONS_PATH)
    const existing = parseRevisions(await readFile(logPath, 'utf8').catch(() => '[]'))
    await writeFile(logPath, serialiseRevisions(addRevision(existing, revision)), 'utf8')
  } catch (error) {
    console.error('Could not append to the revision log:', error)
    logged = false
  }

  return json({
    written: true,
    committed: false,
    changed: true,
    source: SOURCE_PATH,
    diff,
    revision,
    logged,
  })
}
