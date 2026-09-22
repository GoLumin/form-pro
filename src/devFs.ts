// Saving to disk from a dev server that cannot reach the disk.
//
// `astro dev` on the Cloudflare adapter runs the site inside workerd, where
// `process.cwd()` is `/bundle` and the project's own files are on no path the
// worker can open — an absolute one fails too. So the editor's write-to-disk
// step, which is the whole of what Save does before anything is deployed, came
// back as ENOENT on exactly the sites that need the console most.
//
// Vite's dev server is plain Node in the same process tree and does have the
// files, so that is where the read and the write happen. This plugin serves the
// two editable files over a private endpoint, and the worker calls it instead
// of opening them itself.
//
// Three things keep it from being a file server. `configureServer` runs on a
// dev server and nowhere else, so none of this exists in a build. The only
// paths it will touch are the two the integration already resolved — the name
// in the request picks between them and never becomes part of a path. And a
// token minted per dev session has to match, so a page the browser happens to
// have open cannot rewrite the site's config by guessing the URL.

import type { Plugin } from 'vite'
import { readFile, writeFile } from 'node:fs/promises'

/** Private, and prefixed so it cannot collide with a route the site declares. */
export const DEV_FS_ROUTE = '/__form-pro/local-file'

/** The two files the editor owns. Not paths — names that select one. */
export type DevFile = 'config' | 'revisions'

const HEADER = 'x-form-pro-dev'

export interface DevFsPaths {
  /** Absolute path to the site's config module. */
  config: string
  /** Absolute path to the revision log. */
  revisions: string
  /** Minted once per dev server; the worker sends it back on every call. */
  token: string
}

/**
 * The Node half. Reads and writes the two files for a runtime that cannot.
 */
export function devFsPlugin(paths: DevFsPaths): Plugin {
  const pathFor = (name: unknown): string | null =>
    name === 'config' ? paths.config : name === 'revisions' ? paths.revisions : null

  return {
    name: 'form-pro:dev-fs',
    // Dev only, by construction: Vite never calls this during a build.
    configureServer(server) {
      server.middlewares.use(DEV_FS_ROUTE, (req, res) => {
        const send = (status: number, body: unknown) => {
          res.statusCode = status
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify(body))
        }

        if (req.headers[HEADER] !== paths.token) return send(404, { error: 'Not found' })

        if (req.method === 'GET') {
          const name = new URL(req.url ?? '', 'http://localhost').searchParams.get('file')
          const file = pathFor(name)
          if (!file) return send(400, { error: 'Unknown file' })
          readFile(file, 'utf8').then(
            (text) => send(200, { text }),
            // A revision log that does not exist yet is not a failure; the
            // caller starts an empty one.
            (error) => send(404, { error: String(error) })
          )
          return
        }

        if (req.method === 'POST') {
          let body = ''
          req.on('data', (chunk) => {
            body += chunk
          })
          req.on('end', () => {
            let parsed: { file?: unknown; text?: unknown }
            try {
              parsed = JSON.parse(body)
            } catch {
              return send(400, { error: 'Expected a JSON body' })
            }
            const file = pathFor(parsed.file)
            if (!file) return send(400, { error: 'Unknown file' })
            if (typeof parsed.text !== 'string') return send(400, { error: 'text is required' })
            writeFile(file, parsed.text, 'utf8').then(
              () => send(200, { written: true }),
              (error) => send(500, { error: String(error) })
            )
          })
          return
        }

        send(405, { error: 'Method not allowed' })
      })
    },
  }
}

/**
 * The worker half.
 *
 * `origin` is the request's own — the dev server is the thing that just served
 * this request, so it is always reachable at the address the caller arrived on.
 */
export async function readDevFile(
  file: DevFile,
  origin: string,
  token: string
): Promise<string> {
  const response = await fetch(`${origin}${DEV_FS_ROUTE}?file=${file}`, {
    headers: { [HEADER]: token },
  })
  const body = (await response.json()) as { text?: string; error?: string }
  if (!response.ok || typeof body.text !== 'string') {
    throw new Error(body.error ?? `Could not read ${file}`)
  }
  return body.text
}

export async function writeDevFile(
  file: DevFile,
  text: string,
  origin: string,
  token: string
): Promise<void> {
  const response = await fetch(`${origin}${DEV_FS_ROUTE}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', [HEADER]: token },
    body: JSON.stringify({ file, text }),
  })
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string }
    throw new Error(body.error ?? `Could not write ${file}`)
  }
}
