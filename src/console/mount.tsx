import * as React from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App.tsx'

/**
 * The console mounts its own React root rather than shipping as an Astro
 * island.
 *
 * It is one standalone page with no site chrome, so it does not need Astro's
 * hydration machinery — and not using it means a site needs no React renderer
 * configured at all. The microsites run Preact for their own components; asking
 * them to add a second renderer, or to hydrate this through preact/compat,
 * would make installing the console a change to how the rest of the site
 * builds. This way it is one dependency and one integration line.
 */
const host = document.getElementById('form-console-root')
if (host) createRoot(host).render(<App />)
