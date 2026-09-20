import * as React from 'react'
import { createRoot } from 'react-dom/client'
import { SignIn } from './SignIn.tsx'

const host = document.getElementById('form-console-signin')
if (host) createRoot(host).render(<SignIn />)
