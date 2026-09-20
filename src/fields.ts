// What a form collects, declared as data rather than as a type.
//
// A site lists its fields once; everything downstream reads that list instead
// of knowing the shape itself. The rows in both emails, the source fields a
// webhook key can draw from, the console's test submission and its field
// pickers are all this one list rendered differently — which is what stops
// adding a field from being an edit in five places, four of them in here.
//
// The list is ordinary data, so it survives the trip to the browser and back:
// the console renders its test form from the same declaration the server
// renders the emails from, and neither can drift from the other.

import { normalizeDate } from './dateFormats.ts'

/**
 * One submission: field id to the value the visitor gave.
 *
 * Deliberately a plain string map. A site that wants its own field ids checked
 * declares FIELDS `as const` and derives them — see FieldIdOf — rather than
 * having this package guess at a shape it cannot know.
 */
export type Lead = Record<string, string>

/**
 * How a field is collected and how its value reads.
 *
 * The type decides the console's input, the email's formatting and the
 * validation the submit endpoint applies. It is a closed list on purpose: this
 * is a lead pipeline, not a form builder, and every type here has to be
 * something the emails and the webhook know how to write down.
 */
export type FieldType =
  | 'text'
  | 'email'
  | 'phone'
  | 'date'
  | 'zip'
  | 'number'
  | 'choice'
  | 'textarea'

/** One value a `choice` field can take, and the words the visitor sees. */
export interface FieldOption {
  value: string
  label: string
}

export interface FieldDef {
  /** Stable id. Webhook keys, copy placeholders and the lead all use it. */
  id: string
  /** The words beside the value, in the form and in the emails' detail rows. */
  label: string
  type: FieldType
  required?: boolean
  placeholder?: string
  /** `choice` only. A profile may narrow these; see Profile.fieldOptions. */
  options?: readonly FieldOption[]
  /**
   * Collect this only when another field already has one of these values.
   *
   * The condition is evaluated in the console's test form, in the emails and in
   * the submit endpoint, so a field that is not being asked for is also not
   * reported, not mailed and not sent to the CRM — one rule, not four.
   */
  showWhen?: Readonly<Record<string, string | readonly string[]>>
  /** What the console's test form starts with, and what a preview shows. */
  sample?: string
  /**
   * Computed from the other values rather than collected — a full name built
   * from two parts, say. Derived fields never appear in the form.
   *
   * A function, so it never reaches the browser: `clientFields` strips it.
   */
  derive?: (values: Lead) => string
  /** Kept out of the emails' detail rows, though still on the lead. */
  hidden?: boolean
  /**
   * Who sees this row in the emails. `admin` keeps it out of the client's copy
   * — telling someone their own phone number back is noise, and it is the one
   * thing in the message they cannot possibly need.
   */
  audience?: 'both' | 'admin'
}

/** A site's own field ids, for a FIELDS declared `as const`. */
export type FieldIdOf<F extends readonly FieldDef[]> = F[number]['id']

/** The field with this id, or null. */
export function fieldById(
  fields: readonly FieldDef[],
  id: string
): FieldDef | null {
  return fields.find((f) => f.id === id) ?? null
}

/**
 * Whether `field` applies, given what has been filled in so far.
 *
 * Every condition must hold. A field whose condition names a field that isn't
 * there is hidden rather than shown: an unanswerable condition means the site
 * changed under it, and offering the field would collect a value nothing
 * downstream expects.
 */
export function isVisible(field: FieldDef, values: Lead): boolean {
  if (!field.showWhen) return true
  for (const [id, expected] of Object.entries(field.showWhen)) {
    const actual = values[id] ?? ''
    const allowed = Array.isArray(expected) ? expected : [expected as string]
    if (!allowed.includes(actual)) return false
  }
  return true
}

/** The fields that apply to this submission, in declared order. */
export function visibleFields(
  fields: readonly FieldDef[],
  values: Lead
): FieldDef[] {
  return fields.filter((f) => !f.derive && isVisible(f, values))
}

/** The options this profile sells, which may be fewer than the field declares. */
export function optionsFor(
  field: FieldDef,
  narrowed?: readonly string[]
): readonly FieldOption[] {
  const all = field.options ?? []
  if (!narrowed || narrowed.length === 0) return all
  const keep = new Set(narrowed)
  return all.filter((o) => keep.has(o.value))
}

/**
 * How a value reads to a person: a choice's own label, everything else as-is.
 *
 * A value with no matching option falls back to itself rather than to an empty
 * cell — a lead that arrived with a value we no longer offer is still a lead,
 * and blanking it in the email would hide that it happened.
 */
export function optionLabel(field: FieldDef | null, value: string): string {
  if (!field || field.type !== 'choice' || !value) return value
  return field.options?.find((o) => o.value === value)?.label ?? value
}

/**
 * A complete lead from whatever the form posted.
 *
 * Values are trimmed, fields that do not apply are dropped, and derived fields
 * are computed last so they can read the rest. Everything is a string: the
 * webhook sends strings, the emails print strings, and a number that only ever
 * gets stringified is a number nobody needed.
 */
export function buildLead(
  fields: readonly FieldDef[],
  raw: Record<string, unknown>
): Lead {
  const values: Lead = {}
  for (const field of fields) {
    if (field.derive) continue
    const value = raw[field.id]
    const text = value == null ? '' : String(value).trim()
    // Dates are normalised once, here, so everything downstream reads the one
    // shape dateFormats.ts documents rather than whatever the input produced.
    values[field.id] = field.type === 'date' ? normalizeDate(text) : text
  }
  // A second pass, because a condition may name a field declared after it.
  for (const field of fields) {
    if (!field.derive && !isVisible(field, values)) values[field.id] = ''
  }
  for (const field of fields) {
    if (field.derive) values[field.id] = String(field.derive(values) ?? '').trim()
  }
  return values
}

/** Representative values, for a preview or the daily check. */
export function sampleLead(
  fields: readonly FieldDef[],
  overrides: Lead = {}
): Lead {
  const raw: Record<string, string> = {}
  for (const field of fields) {
    if (field.derive) continue
    raw[field.id] =
      overrides[field.id] ?? field.sample ?? field.options?.[0]?.value ?? ''
  }
  return buildLead(fields, raw)
}

/** The field list as the browser gets it: data only, no functions. */
export function clientFields(fields: readonly FieldDef[]): FieldDef[] {
  return fields.map(({ derive, ...rest }) => ({
    ...rest,
    ...(derive ? { hidden: true } : {}),
  }))
}
