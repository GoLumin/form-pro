import * as React from 'react'
import { Plus, X } from 'lucide-react'
import { Button } from '../components/ui/button.tsx'
import { Input } from '../components/ui/input.tsx'
import { Label } from '../components/ui/label.tsx'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select.tsx'
import { boot } from './api.ts'
import { Display, Eyebrow, Mono, Panel } from './instrument.tsx'
import { cn } from '../lib/utils.ts'
import { DATE_FORMATS } from '../dateFormats.ts'
import type { EditableKey, FieldDef } from './types.ts'

/**
 * The keys one webhook accepts, and what fills each — drawn as the wiring it
 * actually is.
 *
 * Two columns and a line between them, because the failure this screen exists
 * to prevent is a gap rather than a wrong value: a key the CRM does not know is
 * dropped in silence, a required one that is missing gets the lead rejected,
 * and a field the form collects that no key draws from is a question asked for
 * nothing. A list of rows hides all three. A patch bay shows them: a field with
 * no line leaving it, and a key with no line arriving.
 *
 * Editing happens in the panel underneath rather than inside the rows, so a key
 * row stays one line tall and the lines stay meaningful.
 */

/**
 * Fields whose values are a vocabulary the CRM has its own words for — every
 * choice field the site declares, so the value table offers exactly what can
 * actually arrive.
 */
function mappable(fields: FieldDef[]): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  for (const field of fields) {
    if (field.type === 'choice' && field.options?.length) {
      out[field.id] = field.options.map((o) => o.value)
    }
  }
  return out
}

const TRANSFORMS = [
  ['', 'Send as-is'],
  ['widthFirst', 'Width first (16x8 → 8x16)'],
  ...DATE_FORMATS.map((f) => [`date:${f}`, `Date as ${f}`]),
] as [string, string][]

const blank = (firstField: string): EditableKey => ({
  key: '',
  mode: 'field',
  from: firstField,
  value: '',
  transform: '',
  map: {},
  hasWhenEmpty: false,
  whenEmpty: '',
})

/** One line of plain English for what fills a key, plus the shorthand chip. */
function rule(
  key: EditableKey,
  fields: FieldDef[],
  mapped: Record<string, string[]>,
  crm: string
): { text: string; tag?: string } {
  if (key.mode === 'value') {
    return { text: key.value ? `The fixed text "${key.value}"` : 'A fixed value, not set yet', tag: 'fixed value' }
  }
  const field = fields.find((f) => f.id === key.from)
  const name = field?.label ?? key.from
  if (!field) return { text: `${key.from} — no such field`, tag: 'broken' }
  if (mapped[key.from]) {
    const written = Object.values(key.map ?? {}).filter(Boolean).length
    return {
      text: `${name}, in ${crm}'s own words`,
      tag: `${written}/${mapped[key.from].length} values mapped`,
    }
  }
  const transform = TRANSFORMS.find(([value]) => value === key.transform)
  if (key.transform && transform) return { text: name, tag: transform[1].toLowerCase() }
  return { text: `${name}, as typed` }
}

type Picked = { type: 'key'; index: number } | { type: 'field'; id: string } | null

export function WiringBoard({
  keys,
  fields,
  onChange,
}: {
  keys: EditableKey[]
  /** What the form collects — the only things a key may draw from. */
  fields: FieldDef[]
  onChange: (keys: EditableKey[]) => void
}) {
  const { crm } = boot()
  const mapped = React.useMemo(() => mappable(fields), [fields])
  const [picked, setPicked] = React.useState<Picked>(() => (keys.length ? { type: 'key', index: 0 } : null))

  const update = (index: number, patch: Partial<EditableKey>) =>
    onChange(keys.map((key, i) => (i === index ? { ...key, ...patch } : key)))

  const remove = (index: number) => {
    onChange(keys.filter((_, i) => i !== index))
    setPicked(null)
  }

  /** Which field is lit — the one the picked key draws from, or the picked one. */
  const litField =
    picked?.type === 'field'
      ? picked.id
      : picked?.type === 'key'
        ? (keys[picked.index]?.mode === 'field' ? keys[picked.index].from : null)
        : null

  const isKeyLit = (key: EditableKey, index: number) =>
    (picked?.type === 'key' && picked.index === index) ||
    (litField !== null && key.mode === 'field' && key.from === litField)

  const drawnFrom = new Set(keys.filter((k) => k.mode === 'field').map((k) => k.from))

  // ── Where the lines go ──────────────────────────────────────────────────
  // Measured rather than computed from row heights: a label wraps at some
  // widths and a key's rule does not, and a line that lands a few pixels off
  // its port is worse than no line at all.
  const board = React.useRef<HTMLDivElement>(null)
  const fieldRows = React.useRef(new Map<string, HTMLElement>())
  const keyRows = React.useRef(new Map<number, HTMLElement>())
  const [lines, setLines] = React.useState<{ id: string; d: string; lit: boolean }[]>([])
  const [height, setHeight] = React.useState(0)

  React.useLayoutEffect(() => {
    const measure = () => {
      const box = board.current?.getBoundingClientRect()
      if (!box) return
      const centre = (el?: HTMLElement) => {
        if (!el) return null
        const rect = el.getBoundingClientRect()
        return rect.top - box.top + rect.height / 2
      }
      const next: { id: string; d: string; lit: boolean }[] = []
      keys.forEach((key, index) => {
        if (key.mode !== 'field') return
        const from = centre(fieldRows.current.get(key.from))
        const to = centre(keyRows.current.get(index))
        if (from === null || to === null) return
        next.push({
          id: `${index}-${key.from}`,
          d: `M0 ${from} C 56 ${from}, 56 ${to}, 112 ${to}`,
          lit: isKeyLit(key, index),
        })
      })
      setLines(next)
      setHeight(box.height)
    }

    measure()
    const observer = new ResizeObserver(measure)
    if (board.current) observer.observe(board.current)
    window.addEventListener('resize', measure)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [keys, fields, picked])

  const unwired = fields.filter((f) => !drawnFrom.has(f.id))
  const selected = picked?.type === 'key' ? keys[picked.index] : undefined

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-0.5">
          <Display className="text-[23px]">The wiring</Display>
          <p className="text-[12.5px] text-pretty text-muted-foreground">
            What the form collects, on the left. What this webhook accepts, on the right. Nothing
            crosses that gap unless a line says so.
          </p>
        </div>
        <span className="grow" />
        {unwired.length > 0 && (
          <span className="inline-flex items-center gap-2 rounded-full border border-warning/30 bg-warning-surface px-2.5 py-1">
            <span className="size-1.5 rounded-full bg-warning" />
            <span className="text-[11.5px] text-warning-ink">
              {unwired.length} collected {unwired.length === 1 ? 'field' : 'fields'} no key draws
              from
            </span>
          </span>
        )}
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            onChange([...keys, blank(fields[0]?.id ?? '')])
            setPicked({ type: 'key', index: keys.length })
          }}
        >
          <Plus /> Add a key
        </Button>
      </div>

      <div ref={board} className="flex items-start gap-0">
        <div className="flex w-[19.75rem] shrink-0 flex-col gap-2">
          <Eyebrow className="h-3.5 leading-[0.875rem]">What the form collects</Eyebrow>
          {fields.map((field) => {
              const wired = drawnFrom.has(field.id)
              const lit = litField === field.id
              return (
                <button
                  key={field.id}
                  type="button"
                  ref={(el) => {
                    if (el) fieldRows.current.set(field.id, el)
                    else fieldRows.current.delete(field.id)
                  }}
                  onClick={() => setPicked({ type: 'field', id: field.id })}
                  className={cn(
                    'flex h-11 items-center gap-2.5 rounded-lg border py-0 pr-1 pl-3 text-left transition-colors',
                    lit
                      ? 'border-primary/45 bg-primary/12'
                      : wired
                        ? 'bg-card hover:bg-accent'
                        : 'border-border/60 bg-chrome hover:bg-accent'
                  )}
                >
                  <span className="flex min-w-0 flex-col items-start gap-0.5">
                    <span
                      className={cn(
                        'truncate text-[13px] font-medium',
                        lit ? 'text-primary' : wired ? undefined : 'text-muted-foreground'
                      )}
                    >
                      {field.label}
                    </span>
                    <Mono className="text-[10.5px] text-muted-foreground/80">{field.id}</Mono>
                  </span>
                  <span className="grow" />
                  {wired ? (
                    <Mono className="rounded-sm bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                      {field.derived ? 'derived' : field.type}
                    </Mono>
                  ) : (
                    <span className="rounded-sm bg-warning-surface px-1.5 py-0.5 text-[10px] text-warning-ink">
                      unused
                    </span>
                  )}
                  <span
                    aria-hidden
                    className={cn(
                      'ml-1 size-2.5 shrink-0 rounded-full',
                      lit ? 'bg-primary' : wired ? 'bg-muted-foreground/50' : 'bg-border'
                    )}
                  />
                </button>
            )
          })}
        </div>

        <div className="relative hidden w-28 shrink-0 self-stretch lg:block">
          <svg
            width={112}
            height={height}
            aria-hidden
            className="absolute top-0 left-0 overflow-visible"
          >
            {lines.map((line) => (
              <path
                key={line.id}
                d={line.d}
                fill="none"
                strokeLinecap="round"
                strokeWidth={line.lit ? 2 : 1.25}
                className={line.lit ? 'stroke-primary' : 'stroke-input'}
              />
            ))}
          </svg>
        </div>

        <div className="flex min-w-0 grow flex-col gap-2">
          <Eyebrow className="h-3.5 leading-[0.875rem]">Keys this webhook accepts</Eyebrow>
          {keys.length === 0 && (
            <Panel className="border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
              No keys yet. Nothing about this profile's leads reaches {crm}.
            </Panel>
          )}
          {keys.map((key, index) => {
            const lit = isKeyLit(key, index)
            const { text, tag } = rule(key, fields, mapped, crm)
            return (
              <div
                key={index}
                ref={(el) => {
                  if (el) keyRows.current.set(index, el)
                  else keyRows.current.delete(index)
                }}
                className={cn(
                  'flex h-14 items-center gap-3 rounded-xl border pr-2 transition-colors',
                  lit ? 'border-primary/40 bg-primary/10' : 'bg-card'
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    '-ml-1 size-2.5 shrink-0 rounded-full',
                    lit ? 'bg-primary' : key.mode === 'field' ? 'bg-muted-foreground/50' : 'bg-border'
                  )}
                />
                <button
                  type="button"
                  onClick={() => setPicked({ type: 'key', index })}
                  className="flex min-w-0 grow items-center gap-3 py-2 text-left"
                >
                  <span className="flex w-44 shrink-0 flex-col gap-0.5">
                    <Mono className={cn('truncate text-[12.5px]', lit && 'text-primary')}>
                      {key.key || 'unnamed key'}
                    </Mono>
                    {key.hasWhenEmpty && (
                      <span className="truncate text-[10.5px] text-muted-foreground/80">
                        empty → &quot;{key.whenEmpty}&quot;
                      </span>
                    )}
                  </span>
                  <span className="min-w-0 truncate text-[12.5px] text-muted-foreground">
                    {text}
                  </span>
                  <span className="grow" />
                  {tag && (
                    <Mono className="hidden shrink-0 rounded-md bg-muted px-2 py-1 text-[10.5px] text-muted-foreground xl:block">
                      {tag}
                    </Mono>
                  )}
                </button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Remove ${key.key || 'this key'}`}
                  onClick={() => remove(index)}
                >
                  <X />
                </Button>
              </div>
            )
          })}
        </div>
      </div>

      <KeyDetail
        picked={picked}
        selected={selected}
        keys={keys}
        fields={fields}
        mapped={mapped}
        crm={crm}
        onUpdate={update}
      />
    </div>
  )
}

/**
 * The one key being edited. It sits under the board rather than inside a row so
 * that a key with six mapped values does not push its own line off the port it
 * is drawn to.
 */
function KeyDetail({
  picked,
  selected,
  keys,
  fields,
  mapped,
  crm,
  onUpdate,
}: {
  picked: Picked
  selected: EditableKey | undefined
  keys: EditableKey[]
  fields: FieldDef[]
  mapped: Record<string, string[]>
  crm: string
  onUpdate: (index: number, patch: Partial<EditableKey>) => void
}) {
  if (!picked) {
    return (
      <Panel className="border-dashed p-4">
        <p className="m-0 text-[12.5px] text-pretty text-muted-foreground">
          Pick a key on the right to edit what fills it, or a field on the left to see which keys
          draw from it. Saving writes the whole set out, so a profile that shared a default set
          gets its own copy.
        </p>
      </Panel>
    )
  }

  if (picked.type === 'field' || !selected) {
    const field = fields.find((f) => f.id === (picked.type === 'field' ? picked.id : ''))
    const drawing = keys.filter((k) => k.mode === 'field' && k.from === field?.id)
    return (
      <Panel className="flex flex-col gap-2 border-primary/25 p-4">
        <Display className="text-lg">{field?.label ?? 'That field'}</Display>
        <p className="m-0 text-[12.5px] leading-relaxed text-pretty text-muted-foreground">
          {drawing.length === 0 ? (
            <>
              No key draws from <Mono>{field?.id}</Mono>. The form asks for it and both emails can
              show it, but nothing about it reaches {crm} — which is the right answer for some
              fields and a silent gap for others.
            </>
          ) : (
            <>
              <Mono>{field?.id}</Mono> fills{' '}
              {drawing.map((k, i) => (
                <React.Fragment key={k.key}>
                  {i > 0 && ', '}
                  <Mono className="text-primary">{k.key}</Mono>
                </React.Fragment>
              ))}
              . Renaming the field changes what the visitor reads; the id, and everything above,
              stays as it is.
            </>
          )}
        </p>
      </Panel>
    )
  }

  const index = picked.index
  const key = selected
  const vocabulary = key.mode === 'field' ? mapped[key.from] : undefined

  return (
    <Panel className="flex flex-col gap-4 border-primary/25 p-4 lg:flex-row">
      <div className="flex w-full shrink-0 flex-col gap-2 lg:w-72">
        <Display className="text-lg">{key.key || 'Unnamed key'}</Display>
        <p className="m-0 text-[12.5px] leading-relaxed text-pretty text-muted-foreground">
          {vocabulary ? (
            <>
              A choice field, so {crm} gets its own vocabulary rather than the site's. Add an
              option to the form and it arrives here unmapped — the lead is accepted and the
              column is blank.
            </>
          ) : key.mode === 'value' ? (
            <>The same text on every lead, never drawn from the form.</>
          ) : (
            <>
              Must match the field mapping on the other end exactly. A key {crm} does not know is
              ignored; a required one that is missing gets the lead rejected.
            </>
          )}
        </p>
      </div>

      <div className="flex w-full shrink-0 flex-col gap-3 lg:w-52">
        <div className="space-y-1.5">
          <Label htmlFor="wiring-key">
            <Eyebrow>Key</Eyebrow>
          </Label>
          <Input
            id="wiring-key"
            value={key.key}
            placeholder="first_name"
            onChange={(e) => onUpdate(index, { key: e.target.value })}
            className="font-mono text-xs"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="wiring-from">
            <Eyebrow>Filled with</Eyebrow>
          </Label>
          <Select
            value={key.mode === 'value' ? '__value' : key.from}
            onValueChange={(v) =>
              onUpdate(
                index,
                v === '__value'
                  ? { mode: 'value' }
                  : {
                      mode: 'field',
                      from: v,
                      // A field with its own vocabulary is mapped, not
                      // transformed; the two are never both meaningful.
                      transform: mapped[v] ? '' : key.transform,
                      map: mapped[v] ? key.map : {},
                    }
              )
            }
          >
            <SelectTrigger id="wiring-from" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {fields.map((field) => (
                <SelectItem key={field.id} value={field.id}>
                  {field.label}
                </SelectItem>
              ))}
              <SelectItem value="__value">A fixed value</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex min-w-0 grow flex-col gap-3">
        {key.mode === 'value' ? (
          <div className="space-y-1.5">
            <Label htmlFor="wiring-value">
              <Eyebrow>Value</Eyebrow>
            </Label>
            <Input
              id="wiring-value"
              value={key.value}
              placeholder="Website"
              onChange={(e) => onUpdate(index, { value: e.target.value })}
            />
          </div>
        ) : vocabulary ? (
          <div className="space-y-1.5">
            <Eyebrow>As {crm} words it</Eyebrow>
            <div className="grid gap-2.5 sm:grid-cols-3">
              {vocabulary.map((option) => (
                <div key={option} className="space-y-1">
                  <Label htmlFor={`wiring-map-${option}`}>
                    <Mono className="text-[11px] text-muted-foreground">{option}</Mono>
                  </Label>
                  <Input
                    id={`wiring-map-${option}`}
                    value={key.map[option] ?? ''}
                    placeholder={option}
                    onChange={(e) =>
                      onUpdate(index, { map: { ...key.map, [option]: e.target.value } })
                    }
                    className="h-8 font-mono text-xs"
                  />
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-1.5">
            <Label htmlFor="wiring-transform">
              <Eyebrow>Reshape</Eyebrow>
            </Label>
            <Select
              value={key.transform || '__none'}
              onValueChange={(v) => onUpdate(index, { transform: v === '__none' ? '' : v })}
            >
              <SelectTrigger id="wiring-transform" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TRANSFORMS.map(([value, label]) => (
                  <SelectItem key={value || '__none'} value={value || '__none'}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {key.mode === 'field' && (
          <div className="flex flex-wrap items-center gap-3">
            <Label htmlFor="wiring-empty" className="text-[11.5px] text-muted-foreground">
              When the lead has no value
            </Label>
            <Input
              id="wiring-empty"
              value={key.whenEmpty}
              placeholder="omit the key"
              onChange={(e) => onUpdate(index, { whenEmpty: e.target.value, hasWhenEmpty: true })}
              className="h-8 w-44 font-mono text-xs"
            />
            <span className="text-[11.5px] text-muted-foreground/80">
              Several {crm} fields require an empty string rather than a missing key.
            </span>
          </div>
        )}
      </div>
    </Panel>
  )
}
