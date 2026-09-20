// Better Auth's own endpoints, mounted under the console's route.
//
// A site with no database configured has no auth instance, and says so plainly
// rather than 500-ing: that state is the shared-password gate still being in
// force, not a fault.

import type { APIRoute } from 'astro'
import { auth } from '../auth/server.ts'

export const prerender = false

export const ALL: APIRoute = async ({ request }) => {
  const a = auth()
  if (!a) {
    return new Response(
      JSON.stringify({ error: 'This console has no database configured, so sign-in is not available.' }),
      { status: 503, headers: { 'Content-Type': 'application/json' } }
    )
  }
  return a.handler(request)
}
