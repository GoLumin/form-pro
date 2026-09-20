import * as React from 'react'
import { ArrowUpRight, Check, Mail, Send } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '../components/ui/alert.tsx'
import { Badge } from '../components/ui/badge.tsx'
import { Button } from '../components/ui/button.tsx'
import { boot } from './api.ts'
import { cn } from '../lib/utils.ts'
import { Display, Eyebrow, Mono, Panel, Station, StationIndex } from './instrument.tsx'
import type { EditableKey, SubmitResponse } from './types.ts'

/**
 * What one submission decided, in the order it decided it.
 *
 * It is a single path rather than a set of panels because these are not
 * independent settings. The profile a submission resolves to chooses the name
 * on the email, the people told about the lead and the CRM it lands in; every
 * stage below it inherits that one decision. Drawn as a chain, a mismatch is
 * something you can see — a webhook two stations under a profile that does not
 * own it reads wrong at a glance, where two cards side by side would not.
 *
 * The pips carry the other half of the story: which stages stayed inside this
 * machine and which reached the outside world. That is why they change with
 * the arming switches rather than with the result alone.
 */

function Line({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[3rem_minmax(0,1fr)] gap-x-2.5 gap-y-1">
      <dt className="pt-0.5">
        <Eyebrow className="text-[9.5px] tracking-[0.1em]">{term}</Eyebrow>
      </dt>
      <dd className="m-0 font-mono text-[11.5px] break-all">{children}</dd>
    </div>
  )
}

function Heading({
  index,
  children,
  badge,
}: {
  index: string
  children: React.ReactNode
  badge?: React.ReactNode
}) {
  return (
    <div className="flex items-center gap-2.5">
      <StationIndex>{index}</StationIndex>
      <h3 className="text-sm font-semibold">{children}</h3>
      <span className="grow" />
      {badge}
    </div>
  )
}

/** "rendered only" and "not posted" are the safe states, so they are the quiet ones. */
function DeliveryBadge({ live, liveText, idleText }: { live?: boolean; liveText: string; idleText: string }) {
  return live ? (
    <Badge
      variant="outline"
      className="rounded-md border-destructive/40 bg-destructive/15 text-destructive"
    >
      {liveText}
    </Badge>
  ) : (
    <Badge variant="outline" className="rounded-md bg-muted text-muted-foreground">
      {idleText}
    </Badge>
  )
}

/**
 * The path of the hook, which is the part that differs between profiles.
 * Parsed defensively: the URL is whatever the config says it is, and a value
 * being edited into shape is not a reason for this panel to throw.
 */
function hookPath(url?: string): string {
  if (!url) return '—'
  try {
    return new URL(url).pathname
  } catch {
    return url
  }
}

function readInTab(html?: string) {
  if (!html) return
  const tab = window.open('', '_blank')
  if (!tab) return
  tab.document.write(html)
  tab.document.close()
}

function Envelope({
  index,
  title,
  icon,
  envelope,
  subject,
  leadEmail,
  sent,
  html,
  verified,
}: {
  index: string
  title: string
  icon: React.ReactNode
  envelope?: { from: string; to: string[]; cc: string[] }
  subject?: string
  leadEmail?: string
  sent?: boolean
  html?: string
  verified?: React.ReactNode
}) {
  const addresses = (list: string[]) =>
    list.length === 0 ? (
      <span className="text-muted-foreground">nobody</span>
    ) : (
      list.map((address) => (
        <span key={address} className="block">
          {address}
          {address === leadEmail && (
            <span className="ml-1 text-muted-foreground">(the person who submitted)</span>
          )}
        </span>
      ))
    )

  return (
    <Panel className="flex flex-col gap-2.5 p-3.5">
      <Heading
        index={index}
        badge={<DeliveryBadge live={sent} liveText="really sent" idleText="rendered only" />}
      >
        <span className="flex items-center gap-2">
          {icon}
          {title}
        </span>
      </Heading>
      <dl className="m-0 flex flex-col gap-1">
        <Line term="From">{envelope?.from ?? '—'}</Line>
        <Line term="To">{addresses(envelope?.to ?? [])}</Line>
        {(envelope?.cc.length ?? 0) > 0 && <Line term="Cc">{addresses(envelope?.cc ?? [])}</Line>}
      </dl>
      {verified}
      {subject && (
        <div className="flex flex-wrap items-baseline gap-2 rounded-lg bg-muted px-2.5 py-1.5">
          <Mono className="text-[11px] text-muted-foreground">Subject</Mono>
          <span className="text-[11.5px]">{subject}</span>
        </div>
      )}
      <Button
        variant="link"
        className="h-auto justify-start p-0 text-[12.5px]"
        onClick={() => readInTab(html)}
        disabled={!html}
      >
        Read the rendered email
      </Button>
    </Panel>
  )
}

export function SignalPath({
  result,
  keys,
  ran,
  armed,
}: {
  result: SubmitResponse | null
  /** The keys the resolved profile declares, so the payload can say what filled each. */
  keys?: EditableKey[]
  /** When the run came back, for the timestamp above the path. */
  ran: Date | null
  /** Where the switches are now — not necessarily where they were for this run. */
  armed: { emails: boolean; lead: boolean }
}) {
  const { crm, single } = boot()

  if (!result) {
    return (
      <Panel className="flex flex-col items-center gap-2 border-dashed px-6 py-16 text-center">
        <Display className="text-[22px]">Nothing has run yet</Display>
        <p className="max-w-md text-sm text-pretty text-muted-foreground">
          Fill in the form on the left and submit it. Every decision it makes appears here as a
          path — and while both switches above are off, nothing it does leaves this machine.
        </p>
      </Panel>
    )
  }

  if (!result.served) {
    return (
      <Alert variant="destructive">
        <AlertTitle>{result.message ?? "We don't currently serve this area"}</AlertTitle>
        <AlertDescription>
          <p>A visitor sees the out-of-area message instead of a quote. No email, and no lead.</p>
          {result.notes.length > 0 && (
            <ul className="list-disc space-y-1 pl-4">
              {result.notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          )}
        </AlertDescription>
      </Alert>
    )
  }

  const payload = Object.entries(result.webhook?.payload ?? {})
  /** What filled a key, said in the words the editor uses for it. */
  const source = (key: string): string => {
    const declared = keys?.find((k) => k.key === key)
    if (!declared) return ''
    if (declared.mode === 'value') return 'a fixed value'
    return declared.from
  }

  // The badges below report what this run did, which is not always what the
  // next one would do. Saying so is better than repainting history.
  const armedSince = (armed.emails && !result.sent) || (armed.lead && !result.posted)
  const disarmedSince = (!armed.emails && result.sent) || (!armed.lead && result.posted)

  const submitted = Object.entries(result.lead ?? {}).filter(([, value]) => value !== '')
  const shown = submitted.slice(0, 4)
  const rest = submitted.length - shown.length

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-end gap-3">
        <div className="flex flex-col gap-0.5">
          <Display className="text-[23px]">Signal path</Display>
          <p className="text-[12.5px] text-muted-foreground">
            Every decision that submission made, in the order it made it.
          </p>
        </div>
        <span className="grow" />
        {ran && (
          <Mono className="text-[11.5px] text-muted-foreground">
            {ran.toLocaleTimeString(undefined, { hour12: false })}
          </Mono>
        )}
      </div>

      {(armedSince || disarmedSince) && (
        <div
          className={cn(
            'flex items-center gap-2.5 rounded-lg border px-3 py-2',
            armedSince
              ? 'border-destructive/30 bg-destructive/10'
              : 'border-success/25 bg-success-surface/40'
          )}
        >
          <span
            className={cn(
              'size-2 shrink-0 rounded-full',
              armedSince ? 'bg-destructive' : 'bg-success'
            )}
          />
          <span
            className={cn(
              'text-[12px]',
              armedSince ? 'text-destructive' : 'text-success'
            )}
          >
            {armedSince
              ? 'Armed since this ran. What is below is what that run did — the next one goes out for real.'
              : 'That run went out for real. The switches are off again, so the next one stays here.'}
          </span>
        </div>
      )}

      <div className="flex flex-col">
        <Station tone="safe">
          <Panel className="flex flex-col gap-2.5 p-3.5">
            <Heading
              index="01"
              badge={
                <Badge
                  variant="outline"
                  className="rounded-md border-success/30 bg-success-surface text-success"
                >
                  {submitted.length} {submitted.length === 1 ? 'field' : 'fields'} · valid
                </Badge>
              }
            >
              Submitted
            </Heading>
            <div className="flex flex-wrap gap-1.5">
              {shown.map(([id, value]) => (
                <Mono key={id} className="rounded-md bg-muted px-2 py-1 text-[11px]">
                  {id}={value}
                </Mono>
              ))}
              {rest > 0 && (
                <Mono className="rounded-md bg-muted px-2 py-1 text-[11px] text-muted-foreground">
                  +{rest} more
                </Mono>
              )}
            </div>
          </Panel>
        </Station>

        <Station tone="signal">
          <Panel className="flex flex-col gap-3 border-primary/30 p-3.5">
            <Heading
              index="02"
              badge={
                <Badge
                  variant="outline"
                  className="rounded-md border-primary/30 bg-primary/15 text-primary"
                >
                  {result.profile?.fromPage ? 'chosen by the page' : 'chosen by the submission'}
                </Badge>
              }
            >
              <span className="flex items-baseline gap-2">
                Profile resolved
                <span className="font-serif text-lg font-normal">{result.profile?.name}</span>
              </span>
            </Heading>

            <div className="grid gap-2.5 sm:grid-cols-3">
              <div className="flex flex-col gap-1 rounded-lg bg-muted px-2.5 py-2">
                <Eyebrow className="text-[9.5px] tracking-[0.12em]">Name on the email</Eyebrow>
                <span className="text-[13px]">{result.clientEnvelope?.from ?? '—'}</span>
              </div>
              <div className="flex flex-col gap-1 rounded-lg bg-muted px-2.5 py-2">
                <Eyebrow className="text-[9.5px] tracking-[0.12em]">People told</Eyebrow>
                <Mono className="text-[12px] break-all">
                  {result.adminEnvelope?.to.join(', ') || 'nobody'}
                </Mono>
              </div>
              <div className="flex flex-col gap-1 rounded-lg bg-muted px-2.5 py-2">
                <Eyebrow className="text-[9.5px] tracking-[0.12em]">CRM it lands in</Eyebrow>
                <Mono className="text-[12px] break-all">{hookPath(result.webhook?.url)}</Mono>
              </div>
            </div>

            <p className="m-0 text-[11.5px] leading-relaxed text-pretty text-muted-foreground">
              {single
                ? 'These three belong to the one profile this site declares — they are never split.'
                : 'These three are one decision, never three. Another profile would put a different name on the email, tell different people and post to its own hook.'}
            </p>
          </Panel>
        </Station>

        <Station tone={result.sent ? 'live' : 'idle'}>
          <div className="grid gap-3 lg:grid-cols-2">
            <Envelope
              index="03"
              title="Client confirmation"
              icon={<Mail className="size-4" />}
              envelope={result.clientEnvelope}
              subject={result.emailSubject}
              leadEmail={result.leadEmail}
              sent={result.sent}
              html={result.clientHtml}
              verified={
                result.sent ? (
                  <div className="flex items-center gap-2 rounded-lg bg-success-surface px-2.5 py-1.5">
                    <Check className="size-3.5 shrink-0 text-success" />
                    <span className="text-[11.5px] text-success">
                      Accepted by the sending account — the From domain is verified
                    </span>
                  </div>
                ) : undefined
              }
            />
            <Envelope
              index="04"
              title="New-lead notification"
              icon={<Send className="size-4" />}
              envelope={result.adminEnvelope}
              subject={result.emailSubject ? `New Lead: ${result.emailSubject}` : undefined}
              leadEmail={result.leadEmail}
              sent={result.sent}
              html={result.adminHtml}
            />
          </div>
        </Station>

        <Station tone={result.posted ? 'live' : 'idle'} last={!result.thankYouUrl}>
          <Panel className="flex flex-col gap-2.5 p-3.5">
            <Heading
              index="05"
              badge={
                <DeliveryBadge
                  live={result.posted}
                  liveText="lead really filed"
                  idleText="not posted"
                />
              }
            >
              <span className="flex flex-wrap items-baseline gap-2">
                {crm} webhook
                <Mono className="text-[11px] font-normal break-all text-muted-foreground">
                  POST {result.webhook?.url}
                </Mono>
              </span>
            </Heading>

            <div className="overflow-hidden rounded-lg border">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="bg-muted">
                    <th className="w-[38%] px-3 py-1.5 text-left">
                      <Eyebrow className="text-[9.5px] tracking-[0.1em]">
                        Key the {crm} mapping accepts
                      </Eyebrow>
                    </th>
                    <th className="px-3 py-1.5 text-left">
                      <Eyebrow className="text-[9.5px] tracking-[0.1em]">Value sent</Eyebrow>
                    </th>
                    <th className="w-[26%] px-3 py-1.5 text-left">
                      <Eyebrow className="text-[9.5px] tracking-[0.1em]">Drawn from</Eyebrow>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {payload.map(([key, value]) => {
                    const from = source(key)
                    return (
                      <tr key={key} className="border-t">
                        <td className="px-3 py-1.5 font-mono text-[11.5px] text-primary">{key}</td>
                        <td className="px-3 py-1.5 font-mono text-[11.5px]">
                          {value === '' ? (
                            <span className="text-muted-foreground">— empty</span>
                          ) : (
                            value
                          )}
                        </td>
                        <td className="px-3 py-1.5 font-mono text-[11.5px] text-muted-foreground">
                          {from || '—'}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            <p className="m-0 text-[11.5px] leading-relaxed text-pretty text-muted-foreground">
              {payload.length} {payload.length === 1 ? 'key' : 'keys'}, shaped for this profile
              alone. A key {crm} does not know is dropped in silence and it answers 200 either
              way — which is why the wiring is worth a look when a column goes empty.
            </p>
          </Panel>
        </Station>

        {result.thankYouUrl && (
          <Station tone="idle" last>
            <Panel className="flex flex-wrap items-center gap-3 p-3.5">
              <StationIndex>06</StationIndex>
              <h3 className="text-sm font-semibold">Visitor lands</h3>
              <Mono className="min-w-0 break-all text-muted-foreground">{result.thankYouUrl}</Mono>
              <span className="grow" />
              <Button asChild variant="link" className="h-auto p-0 text-[12.5px]">
                <a href={result.thankYouUrl} target="_blank" rel="noopener">
                  Open the page <ArrowUpRight className="size-3.5" />
                </a>
              </Button>
            </Panel>
          </Station>
        )}
      </div>

      {(result.notes.length > 0 || result.quoteId != null) && (
        <Panel className="flex flex-col gap-2 p-3.5">
          <Eyebrow>What happened along the way</Eyebrow>
          <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
            {result.quoteId != null && (
              <li className="flex gap-2 text-[12.5px] text-muted-foreground">
                <span className="text-muted-foreground/60">·</span>
                {result.quoteId
                  ? `Live pricing attached — quote ${result.quoteId.slice(0, 12)}.`
                  : 'No live pricing was attached, so the emails carry no numbers.'}
              </li>
            )}
            {result.notes.map((note) => (
              <li key={note} className="flex gap-2 text-[12.5px] text-muted-foreground">
                <span className="text-muted-foreground/60">·</span>
                {note}
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  )
}
