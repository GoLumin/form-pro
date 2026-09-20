// The console runs in every environment, production included, so it is behind
// HTTP Basic auth rather than a dev-only guard.
//
// Credentials come from the environment first and the integration's options
// second, which is how you rotate them without a deploy. A value in
// astro.config is a shared password living in the repository: good enough to
// keep the page out of crawlers and casual hands, and nothing more. The page
// really sends email and really files leads, so set the variables where that
// matters.

import { envValue } from './env.ts'
import options from 'virtual:form-pro/options'

const REALM = 'Form console'

function credentials(): { user: string; password: string } {
  return {
    user: envValue('FORM_CONSOLE_USER') || envValue('FORM_PREVIEW_USER') || options.user,
    password:
      envValue('FORM_CONSOLE_PASSWORD') ||
      envValue('FORM_PREVIEW_PASSWORD') ||
      options.password,
  }
}

/** Constant-time-ish compare, so a wrong password can't be probed by timing. */
function matches(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

function decode(header: string | null): { user: string; password: string } | null {
  if (!header?.toLowerCase().startsWith('basic ')) return null
  try {
    const raw = atob(header.slice(6).trim())
    const split = raw.indexOf(':')
    if (split < 0) return null
    return { user: raw.slice(0, split), password: raw.slice(split + 1) }
  } catch {
    return null
  }
}

/** Returns a 401 to send back, or null when the request may proceed. */
export function basicAuthChallenge(request: Request): Response | null {
  const supplied = decode(request.headers.get('authorization'))
  const { user, password } = credentials()

  if (supplied && matches(supplied.user, user) && matches(supplied.password, password)) {
    return null
  }

  return new Response('Authentication required', {
    status: 401,
    headers: {
      'WWW-Authenticate': `Basic realm="${REALM}", charset="UTF-8"`,
      'Cache-Control': 'no-store',
    },
  })
}

/**
 * A value only an authenticated page render can hand to the browser, so the
 * endpoints behind the page are as protected as the page itself.
 *
 * Browsers send Basic credentials for paths under the one they authenticated
 * against. The endpoints sit under the console's own route so that mostly
 * holds — but a fetch() from a page loaded with credentials in the URL does
 * not resend them, and neither does every client. The page embeds this token
 * and the endpoints require it. It is derived rather than the password itself,
 * so the password never reaches the HTML.
 */
export async function consoleToken(): Promise<string> {
  const { user, password } = credentials()
  const bytes = new TextEncoder().encode(`${user}:${password}:form-console`)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** Whether a token handed back by the page is the one we issued. */
export async function isValidToken(token: string | undefined | null): Promise<boolean> {
  if (!token) return false
  return matches(token, await consoleToken())
}

/**
 * The guard every endpoint opens with: Basic auth OR the page's token.
 * Returns a Response to send back, or null to carry on.
 */
export async function guard(request: Request, token: string | undefined | null): Promise<Response | null> {
  if (await isValidToken(token)) return null
  return basicAuthChallenge(request)
}
