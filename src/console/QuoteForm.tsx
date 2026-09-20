import * as React from 'react'
import { CalendarIcon, Loader2, Play } from 'lucide-react'
import { Button } from '../components/ui/button.tsx'
import { Calendar } from '../components/ui/calendar.tsx'
import { Input } from '../components/ui/input.tsx'
import { Label } from '../components/ui/label.tsx'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '../components/ui/popover.tsx'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select.tsx'
import { Separator } from '../components/ui/separator.tsx'
import { Switch } from '../components/ui/switch.tsx'
import { Textarea } from '../components/ui/textarea.tsx'
import { api, boot } from './api.ts'
import { Eyebrow } from './instrument.tsx'
import type { FieldDef, OptionsResponse, SubmitResponse } from './types.ts'

/**
 * One submission, built from the fields the site declares.
 *
 * It renders exactly what the real form renders — the same fields in the same
 * order, appearing and disappearing under the same conditions — because both
 * read the one declaration. A console that offered fields the form does not
 * would report on a submission nobody can actually make.
 *
 * What it deliberately does NOT own is whether the run reaches the outside
 * world. Those two switches live in the arming strip across the top of the
 * page, where they are visible from every screen — a decision that dangerous
 * should not be something you scroll past inside a form.
 */

/** Whether a field applies, given what has been filled in so far. */
function isVisible(field: FieldDef, values: Record<string, string>): boolean {
  if (!field.showWhen) return true
  return Object.entries(field.showWhen).every(([id, expected]) => {
    const allowed = Array.isArray(expected) ? expected : [expected]
    return allowed.includes(values[id] ?? '')
  })
}

/**
 * The delivered value stays the `yyyy-mm-dd` string a date input produces; the
 * calendar only borrows it as a `Date`.
 *
 * Both conversions read and write the local fields rather than going through
 * `toISOString`: a plain date has no timezone, so a round trip through UTC
 * lands on midnight and comes back as the day before anywhere west of it.
 */
function parseDate(value: string): Date | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!m) return undefined
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
}

function toDateValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** Two weeks out, so a date field always starts on something valid. */
function defaultDate(): string {
  return toDateValue(new Date(Date.now() + 14 * 86_400_000))
}

function initialValues(fields: FieldDef[]): Record<string, string> {
  const values: Record<string, string> = {}
  for (const field of fields) {
    if (field.derived) continue
    values[field.id] =
      field.sample ??
      (field.type === 'date'
        ? defaultDate()
        : field.type === 'choice'
          ? (field.options?.[0]?.value ?? '')
          : '')
  }
  return values
}

export function QuoteForm({
  fields,
  armed,
  onResult,
  busy,
  setBusy,
}: {
  fields: FieldDef[]
  /** The arming strip's two switches, which decide what this run really does. */
  armed: { emails: boolean; lead: boolean }
  onResult: (r: SubmitResponse) => void
  busy: boolean
  setBusy: (b: boolean) => void
}) {
  const { profiles, single, routing, quoting } = boot()

  const ANY = '__any'
  const [profileSlug, setProfileSlug] = React.useState(
    single ? (profiles[0]?.slug ?? ANY) : ANY
  )
  const pageSlug = profileSlug === ANY ? null : profileSlug
  const [values, setValues] = React.useState<Record<string, string>>(() =>
    initialValues(fields)
  )
  const [liveQuote, setLiveQuote] = React.useState(quoting)
  const [dateOpen, setDateOpen] = React.useState<string | null>(null)

  const [options, setOptions] = React.useState<OptionsResponse | null>(null)
  const [checking, setChecking] = React.useState(false)

  const set = (id: string, value: string) => setValues((v) => ({ ...v, [id]: value }))

  // What the server is asked about, and the only thing that makes it worth
  // asking again: the value that decides the profile, and the page it came
  // from. Everything else the form collects is irrelevant to that answer.
  const routingValue = routing.field ? (values[routing.field] ?? '') : ''
  const ready =
    routing.kind !== 'lookup' ||
    routingValue.trim().length >= (routing.minLength ?? 1)

  React.useEffect(() => {
    if (!ready) {
      setOptions(null)
      return
    }
    let cancelled = false
    setChecking(true)
    api<OptionsResponse>('options', {
      values: routing.field ? { [routing.field]: routingValue } : {},
      profileSlug: pageSlug,
    }).then(({ data }) => {
      if (cancelled) return
      setChecking(false)
      setOptions(data)
    })
    return () => {
      cancelled = true
    }
  }, [routingValue, pageSlug, ready])

  /**
   * The options one choice field actually offers here: the catalog's, when the
   * back end answered for it, and otherwise the ones this profile sells.
   */
  const optionsFor = (field: FieldDef): { value: string; label: string }[] => {
    const declared = field.options ?? []
    const catalog = options?.catalog
    if (catalog && catalog.field === field.id) {
      const values_ = catalog.byValue[values[catalog.dependsOn] ?? ''] ?? []
      return values_.map((v) => ({ value: v, label: v }))
    }
    const allowed = options?.fieldOptions?.[field.id]
    if (!allowed) return [...declared]
    const keep = new Set(allowed)
    return declared.filter((o) => keep.has(o.value))
  }

  // A value the profile turned out not to offer is corrected rather than sent:
  // the form must never submit an option this profile cannot accept.
  React.useEffect(() => {
    if (!options) return
    setValues((current) => {
      let next = current
      for (const field of fields) {
        if (field.type !== 'choice') continue
        const available = optionsFor(field)
        if (!available.length) continue
        if (!available.some((o) => o.value === current[field.id])) {
          next = { ...next, [field.id]: available[0].value }
        }
      }
      return next
    })
  }, [options, JSON.stringify(values)])

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setBusy(true)
    const { data, error } = await api<SubmitResponse>('submit', {
      profileSlug: pageSlug,
      values,
      liveQuote,
      reallySend: armed.emails,
      reallyPost: armed.lead,
    })
    setBusy(false)
    if (error) {
      onResult({ served: false, message: error.message, notes: [] })
      return
    }
    if (data) onResult(data)
  }

  const section = (title: string, children: React.ReactNode) => (
    <div className="space-y-3">
      <Eyebrow>{title}</Eyebrow>
      {children}
    </div>
  )

  const renderField = (field: FieldDef) => {
    const value = values[field.id] ?? ''

    if (field.type === 'choice') {
      const available = optionsFor(field)
      return (
        <Select
          value={value}
          onValueChange={(v) => set(field.id, v)}
          disabled={available.length === 0}
        >
          <SelectTrigger id={field.id} className="w-full">
            <SelectValue placeholder={options ? 'Nothing offered here' : 'Waiting…'} />
          </SelectTrigger>
          <SelectContent>
            {available.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )
    }

    if (field.type === 'date') {
      const selected = parseDate(value)
      return (
        <Popover
          open={dateOpen === field.id}
          onOpenChange={(open) => setDateOpen(open ? field.id : null)}
        >
          <PopoverTrigger asChild>
            <Button
              id={field.id}
              variant="outline"
              className="w-full justify-between px-3 font-normal"
            >
              {selected
                ? selected.toLocaleDateString(undefined, {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                  })
                : 'Pick a date'}
              <CalendarIcon className="size-4 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar
              mode="single"
              selected={selected}
              defaultMonth={selected}
              onSelect={(date) => {
                if (!date) return
                set(field.id, toDateValue(date))
                setDateOpen(null)
              }}
            />
          </PopoverContent>
        </Popover>
      )
    }

    if (field.type === 'textarea') {
      return (
        <Textarea
          id={field.id}
          rows={3}
          value={value}
          placeholder={field.placeholder}
          onChange={(e) => set(field.id, e.target.value)}
        />
      )
    }

    return (
      <Input
        id={field.id}
        type={field.type === 'email' ? 'email' : 'text'}
        inputMode={field.type === 'zip' || field.type === 'number' ? 'numeric' : undefined}
        value={value}
        placeholder={field.placeholder}
        onChange={(e) => set(field.id, e.target.value)}
      />
    )
  }

  // Derived fields are computed on the server from the rest, so there is
  // nothing to type into: the form asks for exactly what the real form asks for.
  const visible = fields.filter((f) => !f.derived && isVisible(f, values))

  return (
    <form onSubmit={submit} className="space-y-6">
      {!single &&
        section(
          "Where it's submitted from",
          <div className="space-y-2">
            <Label htmlFor="page">Page</Label>
            <Select value={profileSlug} onValueChange={setProfileSlug}>
              <SelectTrigger id="page" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>
                  {routing.kind === 'lookup'
                    ? 'Any page with no profile of its own'
                    : 'No page — nothing to route by'}
                </SelectItem>
                {profiles.map((p) => (
                  <SelectItem key={p.slug} value={p.slug}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

      {!single && <Separator />}

      {section(
        'What they filled in',
        <div className="space-y-4">
          {visible.map((field) => (
            <div key={field.id} className="space-y-2">
              <Label htmlFor={field.id}>{field.label}</Label>
              {renderField(field)}
            </div>
          ))}

          {routing.kind === 'lookup' && (
            <p className="text-xs leading-relaxed text-muted-foreground" aria-live="polite">
              {checking ? (
                <span className="inline-flex items-center gap-1.5">
                  <Loader2 className="size-3 animate-spin" /> Checking coverage…
                </span>
              ) : options?.served ? (
                <>
                  Handled by <span className="font-medium text-foreground">{options.name}</span>.
                  The options above are that profile's own.
                </>
              ) : options && !options.incomplete ? (
                <span className="text-destructive">No profile covers this.</span>
              ) : (
                'Fill that in to see which profile takes it, and what it offers.'
              )}
            </p>
          )}
        </div>
      )}

      {quoting && (
        <>
          <Separator />
          <Toggle
            id="live"
            checked={liveQuote}
            onChange={setLiveQuote}
            title="Ask for live pricing"
            hint="Creates a real quote on the pricing back end, which is what gives the emails their numbers. Off means no pricing block."
          />
        </>
      )}

      <Button type="submit" size="lg" className="w-full" disabled={busy}>
        {busy ? (
          <>
            <Loader2 className="animate-spin" /> Running…
          </>
        ) : (
          <>
            <Play className="fill-current" /> Run submission
          </>
        )}
      </Button>
    </form>
  )
}

function Toggle({
  id,
  checked,
  onChange,
  title,
  hint,
}: {
  id: string
  checked: boolean
  onChange: (v: boolean) => void
  title: string
  hint: string
}) {
  return (
    <div className="flex gap-3">
      <Switch id={id} checked={checked} onCheckedChange={onChange} className="mt-0.5" />
      <div className="space-y-1">
        <Label htmlFor={id} className="font-semibold">
          {title}
        </Label>
        <p className="text-xs leading-relaxed text-muted-foreground">{hint}</p>
      </div>
    </div>
  )
}
