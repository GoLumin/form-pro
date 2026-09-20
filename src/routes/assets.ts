// Serves the console's pre-bundled JavaScript and stylesheet.
//
// A route rather than a static asset because the files live in node_modules,
// where a site's own asset pipeline cannot reach them — and deliberately not
// inlined into the page, so a browser caches them between visits instead of
// re-downloading React on every load.
//
// The contents arrive as a generated module, so they are part of the server
// bundle: there is no filesystem read at request time and this works unchanged
// on a Worker.
//
// Generated rather than imported with `?raw`, because `?raw` is a Vite feature
// and this file is scanned by esbuild once the package is installed rather than
// linked — at which point the suffix is just part of a filename that does not
// exist.

import type { APIRoute } from 'astro'
import { css, js, signinJs } from 'virtual:form-pro/assets'

export const prerender = false

const TYPES: Record<string, string> = {
  js: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
}

export const GET: APIRoute = ({ params }) => {
  const file = String(params.file ?? '')
  const body =
    file === 'console.js' ? js : file === 'signin.js' ? signinJs : file === 'console.css' ? css : null
  if (body == null) return new Response('Not found', { status: 404 })

  return new Response(body, {
    headers: {
      'Content-Type': TYPES[file.split('.').pop() as string],
      // Safe to pin hard: the page asks for these with a hash of their own
      // contents on the query, so a changed bundle is a different URL.
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  })
}
