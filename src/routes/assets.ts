// Serves the console's pre-bundled JavaScript and stylesheet.
//
// A route rather than a static asset because the files live in node_modules,
// where a site's own asset pipeline cannot reach them — and deliberately not
// inlined into the page, so a browser caches them between visits instead of
// re-downloading React on every load.
//
// Imported with ?raw, which makes the contents part of the server bundle: there
// is no filesystem read at request time, so this works unchanged on a Worker.

import type { APIRoute } from 'astro'
import js from '../console/console.js?raw'
import css from '../console/console.css?raw'

export const prerender = false

const TYPES: Record<string, string> = {
  js: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
}

export const GET: APIRoute = ({ params }) => {
  const file = String(params.file ?? '')
  const body = file === 'console.js' ? js : file === 'console.css' ? css : null
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
