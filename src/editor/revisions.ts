/**
 * Who changed a market's configuration, when, and what moved.
 *
 * Kept as a JSON file beside the config it describes, so it travels with it:
 * a deploy carries the log in the same commit as the change, and anyone reading
 * the repository can see the history without a database.
 *
 * Newest first, so the list reads the way it is displayed and a truncation
 * drops the oldest.
 */

import options from 'virtual:form-pro/options'

export interface Revision {
  /** ISO timestamp, UTC. */
  at: string
  /** Typed by whoever saved; required, and remembered per browser. */
  author: string
  /** Market slug, and its name at the time of the change. */
  slug: string
  market: string
  /** Human names of the fields that moved, e.g. "phone number". */
  fields: string[]
  /** 'local' while editing on a dev server, 'deploy' once pushed. */
  kind: 'local' | 'deploy'
  /** Short commit sha, when this was a deploy. */
  commit?: string
  commitUrl?: string
  /** Every leaf value that moved, so the log says what as well as which. */
  changes?: { field: string; before: string; after: string }[]
}

export const REVISIONS_PATH = options.revisionsPath

/** How many entries to keep; older ones drop off the end. */
const LIMIT = 200

export function parseRevisions(json: string): Revision[] {
  try {
    const parsed = JSON.parse(json)
    return Array.isArray(parsed) ? (parsed as Revision[]) : []
  } catch {
    // A corrupt log must not block a save — the change matters more than
    // the record of it.
    return []
  }
}

export function addRevision(existing: Revision[], entry: Revision): Revision[] {
  return [entry, ...existing].slice(0, LIMIT)
}

/** Trailing newline so the file is a well-behaved text file in git. */
export function serialiseRevisions(revisions: Revision[]): string {
  return `${JSON.stringify(revisions, null, 2)}\n`
}
