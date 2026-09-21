// Entry point for the sign-in bundle, mounted by routes/sign-in.astro.
//
// Named -entry rather than signin.tsx because SignIn.tsx sits beside it, and
// two files whose names differ only in case cannot both exist on macOS or
// Windows. When they collided, a clone on either platform got one file under
// both names and the build still succeeded — esbuild warned that `SignIn` was
// undefined and emitted a bundle that rendered nothing. scripts/build.mjs maps
// this to signin.js, so the output name is unchanged.
import * as React from 'react'
import { createRoot } from 'react-dom/client'
import { SignIn } from './SignIn.tsx'

const host = document.getElementById('form-console-signin')
if (host) createRoot(host).render(<SignIn />)
