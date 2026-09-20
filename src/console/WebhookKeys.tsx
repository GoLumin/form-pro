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
import type { EditableKey, FieldDef } from './types.ts'
import { DATE_FORMATS } from '../dateFormats.ts'

/**
 * The keys one webhook accepts, and what fills each.
 *
 * Every key must match the field mapping on the other end exactly: one the CRM
 * does not know is dropped in silence, and a missing required one gets the lead
 * rejected — in both cases the site shows nothing wrong. That is the whole
 * reason this is editable here rather than in the file.
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

export function WebhookKeys({
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
  const MAPPABLE = mappable(fields)

  const update = (i: number, patch: Partial<EditableKey>) =>
    onChange(keys.map((k, n) => (n === i ? { ...k, ...patch } : k)))

  return (
    <div className="space-y-3">
      <p className="text-xs leading-relaxed text-muted-foreground">
        Each key must match the field mapping in {crm} exactly — a key it does not know is ignored,
        and a missing required one gets the lead rejected. Saving writes these out in full, so a
        profile that shared a default set gets its own copy.
      </p>

      <div className="space-y-2">
        {keys.map((k, i) => {
          const mapped = k.mode === 'field' && MAPPABLE[k.from]
          return (
            <div key={i} className="rounded-lg border bg-card p-3">
              <div className="grid gap-3 sm:grid-cols-[1fr_1fr_1fr_auto]">
                <Field label="Key">
                  <Input
                    value={k.key}
                    onChange={(e) => update(i, { key: e.target.value })}
                    placeholder="first_name"
                    className="font-mono text-xs"
                  />
                </Field>

                <Field label="Filled with">
                  <Select
                    value={k.mode === 'value' ? '__value' : k.from}
                    onValueChange={(v) =>
                      update(
                        i,
                        v === '__value'
                          ? { mode: 'value' }
                          : {
                              mode: 'field',
                              from: v,
                              // A field with its own vocabulary is mapped, not
                              // transformed; the two are never both meaningful.
                              transform: MAPPABLE[v] ? '' : k.transform,
                              map: MAPPABLE[v] ? k.map : {},
                            }
                      )
                    }
                  >
                    <SelectTrigger className="w-full">
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
                </Field>

                {k.mode === 'value' ? (
                  <Field label="Value">
                    <Input
                      value={k.value}
                      onChange={(e) => update(i, { value: e.target.value })}
                      placeholder="Website"
                    />
                  </Field>
                ) : mapped ? (
                  <Field label={`As ${crm} words it`}>
                    <div className="space-y-1.5">
                      {MAPPABLE[k.from].map((option) => (
                        <div key={option} className="flex items-center gap-2">
                          <span className="w-20 shrink-0 font-mono text-[11px] text-muted-foreground">
                            {option}
                          </span>
                          <Input
                            value={k.map[option] ?? ''}
                            onChange={(e) =>
                              update(i, { map: { ...k.map, [option]: e.target.value } })
                            }
                            placeholder={option}
                            className="h-8 font-mono text-xs"
                          />
                        </div>
                      ))}
                    </div>
                  </Field>
                ) : (
                  <Field label="Reshape">
                    <Select
                      value={k.transform}
                      onValueChange={(v) => update(i, { transform: v === '__none' ? '' : v })}
                    >
                      <SelectTrigger className="w-full">
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
                  </Field>
                )}

                <div className="flex items-end">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`Remove ${k.key || 'this key'}`}
                    onClick={() => onChange(keys.filter((_, n) => n !== i))}
                  >
                    <X />
                  </Button>
                </div>
              </div>

              {k.mode === 'field' && (
                <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_1fr_1fr_auto]">
                  <Field label="When the lead has no value">
                    <Input
                      value={k.whenEmpty}
                      onChange={(e) =>
                        update(i, { whenEmpty: e.target.value, hasWhenEmpty: true })
                      }
                      placeholder="nothing"
                      className="font-mono text-xs"
                    />
                  </Field>
                  <div className="sm:col-span-3" />
                </div>
              )}
            </div>
          )
        })}
      </div>

      <Button type="button" variant="outline" size="sm" onClick={() => onChange([...keys, blank(fields[0]?.id ?? '')])}>
        <Plus /> Add a key
      </Button>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</Label>
      {children}
    </div>
  )
}
