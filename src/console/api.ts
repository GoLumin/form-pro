// The console's own endpoints, in one place.
//
// They are endpoints rather than Astro actions because an action lives under
// /_actions and would have to be wired into each site's action index — this way
// adding the integration is the whole install. The token travels in the body
// because a browser does not resend Basic credentials on a fetch() from a
// document whose URL carried them.

export interface Boot {
  token: string
  api: string
  brand: string
  crm: string
  host: string
  configPath: string
  route: string
  profiles: { slug: string; name: string }[]
  single: boolean
  /**
   * How a submission finds its profile, so the test form knows whether to ask
   * the server for options and which field it is waiting on.
   */
  routing: { kind: 'single' | 'page' | 'lookup'; field?: string; minLength?: number }
  /** Whether this site has a pricing back end at all. */
  quoting: boolean
  /** Which host's storage the Settings screen is talking about. */
  adapter: string
  hasDb: boolean
  /** The signed-in email, where the site signs people in rather than using the
   *  shared password. Shown in the header and offered as the revision author. */
  user: string | null
}

export function boot(): Boot {
  return (window as unknown as { __formConsole: Boot }).__formConsole
}

export type Result<T> = { data: T; error: null } | { data: null; error: { message: string } }

export async function api<T = any>(
  name: string,
  payload: Record<string, unknown> = {}
): Promise<Result<T>> {
  const { api: base, token } = boot()
  try {
    const response = await fetch(`${base}/${name}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, ...payload }),
    })
    const body = await response.json().catch(() => ({}))
    if (!response.ok) {
      return { data: null, error: { message: body?.error ?? `Request failed (${response.status})` } }
    }
    return { data: body as T, error: null }
  } catch (err) {
    return { data: null, error: { message: String(err) } }
  }
}

/** Per-viewer conveniences only; every read is guarded because it can throw. */
export const local = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(key)
    } catch {
      return null
    }
  },
  set(key: string, value: string) {
    try {
      localStorage.setItem(key, value)
    } catch {
      // A private window is not a reason to fail a save.
    }
  },
}

export const STORE = {
  client: 'formConsole.client',
  admin: 'formConsole.admin',
  meta: 'formConsole.meta',
  author: 'formConsole.author',
}
