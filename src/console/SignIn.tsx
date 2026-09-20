import * as React from 'react'
import { ArrowLeft, Loader2, Mail } from 'lucide-react'
import { Button } from '../components/ui/button.tsx'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card.tsx'
import { Input } from '../components/ui/input.tsx'
import { Label } from '../components/ui/label.tsx'

/**
 * Address, then code.
 *
 * The same message comes back whether or not the address is allowed to sign in,
 * because a sign-in form that tells you which addresses exist is a directory of
 * who to phish. The refusal happens server-side and silently.
 */

interface Boot {
  route: string
  brand: string
  api: string
}

const boot = (): Boot => (window as unknown as { __formConsoleSignIn: Boot }).__formConsoleSignIn

async function post(path: string, body: unknown) {
  const response = await fetch(`${boot().api}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body),
  })
  const data = await response.json().catch(() => ({}))
  return { ok: response.ok, data }
}

export function SignIn() {
  const { brand, route } = boot()
  const [stage, setStage] = React.useState<'email' | 'code'>('email')
  const [email, setEmail] = React.useState('')
  const [code, setCode] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const askForCode = async (event: React.FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError(null)
    // The answer is the same either way; only the server knows whether a code
    // was really sent.
    await post('/email-otp/send-verification-otp', { email: email.trim(), type: 'sign-in' })
    setBusy(false)
    setStage('code')
  }

  const submitCode = async (event: React.FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError(null)
    const { ok, data } = await post('/sign-in/email-otp', { email: email.trim(), otp: code.trim() })
    setBusy(false)
    if (!ok) {
      setError(
        data?.message ??
          'That code was not accepted. It may have expired, already been used, or this address may not have access.'
      )
      return
    }
    window.location.href = route
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-shell p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>{brand}</CardTitle>
          <CardDescription>
            {stage === 'email'
              ? 'Sign in to the form console. We will email you a six-digit code.'
              : `If ${email} has access, a code is on its way. It expires in ten minutes.`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {stage === 'email' ? (
            <form onSubmit={askForCode} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Work email</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  required
                  autoFocus
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                />
              </div>
              <Button type="submit" className="w-full" disabled={busy}>
                {busy ? <Loader2 className="animate-spin" /> : <Mail />} Email me a code
              </Button>
            </form>
          ) : (
            <form onSubmit={submitCode} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="code">Six-digit code</Label>
                <Input
                  id="code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  required
                  autoFocus
                  maxLength={6}
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                  className="text-center font-mono text-lg tracking-[0.4em]"
                />
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button type="submit" className="w-full" disabled={busy || code.length < 6}>
                {busy ? <Loader2 className="animate-spin" /> : null} Sign in
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="w-full"
                onClick={() => {
                  setStage('email')
                  setCode('')
                  setError(null)
                }}
              >
                <ArrowLeft /> Use a different address
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
