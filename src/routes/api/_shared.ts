// What every console endpoint needs: the guard, JSON in and out, and the two
// files the editor works on — read from GitHub in production, from disk on a
// dev server.

import type { APIContext } from 'astro'
import { guard } from '../../basicAuth.ts'
import { auth, sessionUser } from '../../auth/server.ts'
import { getFile, githubConfig } from '../../editor/github.ts'
import { parseRevisions, REVISIONS_PATH, type Revision } from '../../editor/revisions.ts'
import { SOURCE_PATH } from '../../editor/source.ts'
import { getEmailLogoUrl } from 'virtual:form-pro/logo'

export const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })

export const fail = (message: string, status = 400): Response =>
  json({ error: message }, status)

/**
 * Reads the JSON body and checks the caller is allowed here, in that order —
 * the token travels in the body, because the browser will not resend Basic
 * credentials to a fetch() from a page it loaded with them in the URL.
 *
 * Returns either the body or the Response to send back instead.
 */
export async function authorize<T extends { token?: string }>(
  context: APIContext
): Promise<{ body: T } | { response: Response }> {
  let body: T
  try {
    body = (await context.request.json()) as T
  } catch {
    return { response: fail('Expected a JSON body') }
  }
  // A signed-in session where the site has one, and the shared password where
  // it does not. The two are never both required: a site mid-migration would
  // otherwise lock out the very page you use to finish the migration.
  if (auth()) {
    const user = await sessionUser(context.request)
    if (!user) return { response: fail('Not signed in', 401) }
    return { body }
  }

  const denied = await guard(context.request, body.token)
  // A 401 with a WWW-Authenticate header is right for the page; for an endpoint
  // it would pop a browser dialog on top of the console, so the refusal is
  // plain.
  if (denied) return { response: fail('Not found', 404) }
  return { body }
}

/**
 * The revision log.
 *
 * GitHub first: a deployed build has no writable filesystem and, on a Worker,
 * no filesystem at all — the log it would read from disk is the one baked into
 * the bundle at build time, which is why the Revisions tab used to come up
 * empty in production. The repository is the only copy that is current.
 */
export async function readRevisions(): Promise<Revision[]> {
  const config = githubConfig()
  if (config) {
    try {
      const file = await getFile(config, REVISIONS_PATH)
      return parseRevisions(file.content)
    } catch (error) {
      console.error('Could not read the revision log from GitHub:', error)
    }
  }
  // Dev server: read it off disk so a local save shows up immediately.
  try {
    const { readFile } = await import('node:fs/promises')
    const path = await import('node:path')
    return parseRevisions(await readFile(path.join(process.cwd(), REVISIONS_PATH), 'utf8'))
  } catch {
    return []
  }
}

/** The config source text, from the same place and for the same reasons. */
export async function readSource(): Promise<{
  text: string
  sha?: string
  from: 'github' | 'disk'
}> {
  const config = githubConfig()
  if (config) {
    const file = await getFile(config, SOURCE_PATH)
    return { text: file.content, sha: file.sha, from: 'github' }
  }
  const { readFile } = await import('node:fs/promises')
  const path = await import('node:path')
  return {
    text: await readFile(path.join(process.cwd(), SOURCE_PATH), 'utf8'),
    from: 'disk',
  }
}

/** The email logo as an absolute URL, whatever shape the site configured. */
export async function logoUrlFor(context: APIContext): Promise<string> {
  const logo = await getEmailLogoUrl(context.url.hostname)
  return /^https?:\/\//i.test(logo) ? logo : new URL(logo, context.url.origin).href
}
