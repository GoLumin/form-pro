import * as React from 'react'
import { ArrowRight, Check, Mail, MapPin, Send, X } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '../components/ui/alert.tsx'
import { Badge } from '../components/ui/badge.tsx'
import { Button } from '../components/ui/button.tsx'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../components/ui/card.tsx'
import { Separator } from '../components/ui/separator.tsx'
import { Table, TableBody, TableCell, TableRow } from '../components/ui/table.tsx'
import { boot } from './api.ts'
import type { SubmitResponse } from './types.ts'

/**
 * What one submission decided, in the order it decided it.
 *
 * The point is that these are not six independent settings: the market picked
 * from the ZIP chooses the instance that priced the quote, the name on the
 * email, the people told about the lead and the CRM it lands in. Showing them
 * as one chain is what makes a mismatch obvious.
 */
export function Results({ result }: { result: SubmitResponse | null }) {
  const { crm, single } = boot()

  if (!result) {
    return (
      <Card className="border-dashed">
        <CardContent className="py-14 text-center">
          <MapPin className="mx-auto mb-3 size-6 text-muted-foreground" />
          <p className="text-sm font-medium">Nothing submitted yet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Fill in the form on the left. Everything it decides shows up here — no email is sent and
            no lead is filed unless you tick those boxes.
          </p>
        </CardContent>
      </Card>
    )
  }

  if (!result.served) {
    return (
      <Alert variant="destructive">
        <X />
        <AlertTitle>{result.message ?? "We don't currently serve this area"}</AlertTitle>
        <AlertDescription>
          A visitor sees the out-of-area message instead of a quote. No email and no lead.
          {result.notes.length > 0 && (
            <ul className="mt-2 list-disc space-y-1 pl-4">
              {result.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          )}
        </AlertDescription>
      </Alert>
    )
  }

  const rows = Object.entries(result.webhook?.payload ?? {})

  return (
    <div className="space-y-4">
      <Card className="border-primary/20 bg-linear-to-b from-primary/[0.04] to-transparent">
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle className="flex items-center gap-2">
                {result.market?.name}
                <Badge className="bg-primary/10 text-primary hover:bg-primary/10">
                  {result.market?.slug}
                </Badge>
              </CardTitle>
              <CardDescription>
                {single
                  ? 'Everything below belongs to this one market: the instance that priced the quote, the name on the email, the people told, and the CRM the lead lands in.'
                  : 'One decision, not six. This market chose the instance that priced the quote, the name on the email, the people told, and the CRM the lead lands in — they are never split.'}
              </CardDescription>
            </div>
            <Badge variant="outline">
              {result.market?.fromPage ? 'from the page' : 'from the ZIP'}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-3">
          <Fact label="Delivery ZIP" value={result.zip ?? ''} />
          <Fact label="Quote created" value={result.quoteId ? result.quoteId.slice(0, 12) : 'none'} />
          <Fact label="Phone shown" value={result.market?.phoneNumber ?? ''} />
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Envelope
          title="Customer confirmation"
          icon={<Mail className="size-4" />}
          subject={result.emailSubject}
          envelope={result.clientEnvelope}
          leadEmail={result.leadEmail}
          sent={result.sent}
          html={result.clientHtml}
        />
        <Envelope
          title="New-lead notification"
          icon={<Send className="size-4" />}
          subject={result.emailSubject ? `New Lead: ${result.emailSubject}` : undefined}
          envelope={result.adminEnvelope}
          leadEmail={result.leadEmail}
          sent={result.sent}
          html={result.adminHtml}
        />
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle className="text-base">{crm} webhook</CardTitle>
              <CardDescription className="font-mono text-xs break-all">
                POST {result.webhook?.url}
              </CardDescription>
            </div>
            <Badge variant={result.posted ? 'destructive' : 'secondary'}>
              {result.posted ? 'lead really filed' : 'not posted'}
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableBody>
              {rows.map(([key, value]) => (
                <TableRow key={key}>
                  <TableCell className="w-[44%] font-mono text-xs">{key}</TableCell>
                  <TableCell className="font-mono text-xs">
                    {value === '' ? (
                      <span className="text-muted-foreground">— empty</span>
                    ) : (
                      value
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
            {single
              ? `This webhook accepts only the keys declared for it.`
              : `Each market's webhook accepts only its own keys, so this payload is shaped for this market alone.`}{' '}
            Blank values are sent as empty strings, which several {crm} fields require. A key {crm}{' '}
            does not know is dropped silently — it answers 200 either way.
          </p>
        </CardContent>
      </Card>

      {result.thankYouUrl && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Where the visitor lands</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="font-mono text-xs break-all text-muted-foreground">
              {result.thankYouUrl}
            </p>
            <Button asChild variant="outline" size="sm">
              <a href={result.thankYouUrl} target="_blank" rel="noopener">
                Open the thank-you page <ArrowRight />
              </a>
            </Button>
          </CardContent>
        </Card>
      )}

      {result.notes.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">What happened along the way</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1.5 text-sm text-muted-foreground">
              {result.notes.map((n) => (
                <li key={n} className="flex gap-2">
                  <span className="text-muted-foreground/60">·</span>
                  {n}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-muted/50 px-3 py-2">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-0.5 font-mono text-sm">{value || '—'}</p>
    </div>
  )
}

function Envelope({
  title,
  icon,
  subject,
  envelope,
  leadEmail,
  sent,
  html,
}: {
  title: string
  icon: React.ReactNode
  subject?: string
  envelope?: { from: string; to: string[]; cc: string[] }
  leadEmail?: string
  sent?: boolean
  html?: string
}) {
  const open = () => {
    if (!html) return
    const tab = window.open('', '_blank')
    if (!tab) return
    tab.document.write(html)
    tab.document.close()
  }

  const addresses = (list: string[]) =>
    list.length === 0 ? (
      <span className="text-muted-foreground">nobody</span>
    ) : (
      list.map((a) => (
        <span key={a} className="block">
          {a}
          {a === leadEmail && (
            <span className="ml-1 text-muted-foreground">(the person who submitted)</span>
          )}
        </span>
      ))
    )

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            {icon}
            {title}
          </CardTitle>
          <Badge
            variant="secondary"
            className={sent ? 'bg-success text-success-foreground' : undefined}
          >
            {sent ? <Check className="size-3" /> : null}
            {sent ? 'really sent' : 'rendered only'}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <dl className="space-y-2 text-sm">
          <Line term="From" detail={envelope?.from} />
          <Line term="To" detail={addresses(envelope?.to ?? [])} />
          <Line term="Cc" detail={addresses(envelope?.cc ?? [])} />
          <Line term="Subject" detail={subject} />
        </dl>
        <Separator />
        <Button variant="outline" size="sm" onClick={open} disabled={!html}>
          Read the email
        </Button>
      </CardContent>
    </Card>
  )
}

function Line({ term, detail }: { term: string; detail: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[64px_1fr] gap-2">
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{term}</dt>
      <dd className="font-mono text-xs break-all">{detail ?? '—'}</dd>
    </div>
  )
}
