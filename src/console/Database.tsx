import * as React from 'react'
import { AlertTriangle, Check, Database as DatabaseIcon, Loader2, Plug } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '../components/ui/alert.tsx'
import { Badge } from '../components/ui/badge.tsx'
import { Button } from '../components/ui/button.tsx'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card.tsx'
import { api, boot } from './api.ts'

/**
 * The console's own storage, and the one button that sets it up.
 *
 * Creating the tables is a button rather than something that happens on first
 * request, because a console that silently writes its schema into whatever
 * database it was pointed at is a console you cannot point at the wrong one
 * safely. It says what it is about to create, then creates exactly that.
 */

interface Status {
  configured: boolean
  storage: string
  adapter: string
  flavour?: string
  reason?: string
  secret: boolean
  allowlist: string[]
  tables: { auth: string[]; console: string[] }
  pending?: string[]
  authError?: string | null
  ready: boolean
}

/** What each host's storage is called, and how you attach one. */
const SETUP: Record<string, { name: string; how: React.ReactNode }> = {
  cloudflare: {
    name: 'Cloudflare D1',
    how: (
      <>
        Create a database with <code className="font-mono">wrangler d1 create</code>, add it to{' '}
        <code className="font-mono">wrangler.toml</code> as a binding, and return it from this
        site's database module.
      </>
    ),
  },
  netlify: {
    name: 'Netlify Database',
    how: (
      <>
        Run <code className="font-mono">netlify database init</code>, then return a Postgres dialect
        built from the connection string it sets.
      </>
    ),
  },
  node: { name: 'the configured database', how: <>Return a Kysely dialect from the database module.</> },
  unknown: {
    name: 'the configured database',
    how: <>Return a Kysely dialect from the database module.</>,
  },
}

export function Database() {
  const { adapter, hasDb } = boot() as unknown as { adapter: string; hasDb: boolean }
  const [status, setStatus] = React.useState<Status | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const setup = SETUP[adapter] ?? SETUP.unknown

  const load = React.useCallback(async () => {
    const { data, error } = await api<Status>('database')
    if (error) return setError(error.message)
    setStatus(data)
  }, [])

  React.useEffect(() => {
    void load()
  }, [load])

  const connect = async () => {
    setBusy(true)
    setError(null)
    const { data, error } = await api<Status>('database', { action: 'create' })
    setBusy(false)
    if (error) return setError(error.message)
    setStatus(data)
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <DatabaseIcon className="size-4" />
              Storage
            </CardTitle>
            <CardDescription>
              Where sign-ins, the revision log and the daily check's history are kept. This site
              deploys to {adapter === 'unknown' ? 'an unrecognised host' : adapter}, so the storage
              it can use is <b>{setup.name}</b>.
            </CardDescription>
          </div>
          {status && (
            <Badge
              variant="secondary"
              className={status.ready ? 'bg-success text-success-foreground' : undefined}
            >
              {status.ready ? (
                <>
                  <Check className="size-3" /> connected
                </>
              ) : status.configured ? (
                'tables missing'
              ) : (
                'not connected'
              )}
            </Badge>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {error && <p className="text-sm text-destructive">{error}</p>}

        {!status && <p className="text-sm text-muted-foreground">Checking…</p>}

        {status && !status.configured && (
          <>
            <Alert>
              <AlertTriangle />
              <AlertTitle>No database yet</AlertTitle>
              <AlertDescription>
                <p>{status.reason}</p>
                <p>
                  Until there is one, the console keeps the shared password it has always used, and
                  nobody can sign in by email.
                </p>
                <p>{setup.how}</p>
              </AlertDescription>
            </Alert>
            {hasDb && (
              <p className="text-xs text-muted-foreground">
                The plugin knows how to reach {setup.name} on this host — there is just nothing
                attached here yet. A local <code className="font-mono">astro dev</code> has no
                binding, for instance, so this is expected in development.
              </p>
            )}
          </>
        )}

        {status?.configured && (
          <>
            <dl className="grid gap-3 sm:grid-cols-3">
              <Fact label="Storage" value={status.storage} />
              <Fact label="SQL" value={status.flavour ?? '—'} />
              <Fact
                label="Sign-in secret"
                value={status.secret ? 'set' : 'missing'}
                bad={!status.secret}
              />
            </dl>

            {!status.secret && (
              <Alert variant="destructive">
                <AlertTriangle />
                <AlertTitle>BETTER_AUTH_SECRET is not set</AlertTitle>
                <AlertDescription>
                  <p>
                    Sessions cannot be signed without it, so email sign-in stays off and the shared
                    password remains in force. Set it to 32 or more random characters.
                  </p>
                </AlertDescription>
              </Alert>
            )}

            {status.authError && <p className="text-sm text-destructive">{status.authError}</p>}

            {status.ready ? (
              <p className="text-sm text-muted-foreground">
                Every table this console needs is present.{' '}
                {status.allowlist.length === 0 ? (
                  <b className="text-destructive">
                    Nobody is on the allowlist yet, so nobody can sign in — add addresses below.
                  </b>
                ) : (
                  <>
                    {status.allowlist.length}{' '}
                    {status.allowlist.length === 1 ? 'person' : 'people'} may sign in.
                  </>
                )}
              </p>
            ) : (
              <>
                <div className="space-y-1.5">
                  <p className="text-sm text-muted-foreground">Connecting will create:</p>
                  <ul className="list-disc space-y-1 pl-5 text-sm">
                    {(status.pending ?? []).map((t) => (
                      <li key={t} className="font-mono text-xs">
                        {t}
                      </li>
                    ))}
                  </ul>
                </div>
                <Button onClick={connect} disabled={busy}>
                  {busy ? <Loader2 className="animate-spin" /> : <Plug />} Connect {setup.name}
                </Button>
              </>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}

function Fact({ label, value, bad }: { label: string; value: string; bad?: boolean }) {
  return (
    <div className="rounded-lg bg-muted/60 px-3 py-2">
      <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className={bad ? 'mt-0.5 font-mono text-sm text-destructive' : 'mt-0.5 font-mono text-sm'}>
        {value}
      </dd>
    </div>
  )
}
