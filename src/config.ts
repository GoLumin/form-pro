// Reading a site's declared config: turning envelopes into recipients, leads
// into exactly the keys one webhook accepts, and templates into subject lines.
//
// Pure functions over the types in ./types.ts and the field list in
// ./fields.ts, with no import of any site's values — which is what lets the
// same code serve a one-inbox contact form and a four-market quote form, and
// lets the console test either without a form.

import { DATE_FORMATS, formatDateAs } from './dateFormats.ts'
import { optionLabel, type FieldDef, type Lead } from './fields.ts'
import type {
  EmailEnvelope,
  EmailLabels,
  Profile,
  WebhookKeys,
  WebhookTransform,
} from './types.ts'

/**
 * Stands in for the submitter's own address in an envelope's `to` or `ccs`.
 * Resolved per submission by resolveRecipients().
 */
export const LEAD_EMAIL = '{{lead.email}}'

/** `Name <address@domain>`, the form every mail transport here expects. */
export function formatSender(envelope: EmailEnvelope): string {
  return `${envelope.fromName} <${envelope.fromAddress}>`
}

/** An envelope with its addresses resolved for one submission. */
export interface ResolvedEnvelope {
  /** `Name <address@domain>`. */
  from: string
  to: string[]
  cc: string[]
}

/**
 * An envelope's addresses with LEAD_EMAIL swapped for the submitter's, blanks
 * dropped and duplicates removed — the same address must never land in both To
 * and Cc.
 */
export function resolveRecipients(addresses: string[], leadEmail: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of addresses) {
    const address = (raw === LEAD_EMAIL ? leadEmail : raw).trim()
    if (!address) continue
    const key = address.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(address)
  }
  return out
}

/**
 * Turns a configured envelope into the addresses one send actually uses:
 * LEAD_EMAIL becomes the submitter, and anything already in To is dropped from
 * Cc so the same person is never on both.
 */
export function resolveEnvelope(
  envelope: EmailEnvelope,
  leadEmail: string
): ResolvedEnvelope {
  const to = resolveRecipients(envelope.to, leadEmail)
  const taken = new Set(to.map((a) => a.toLowerCase()))
  return {
    from: formatSender(envelope),
    to,
    cc: resolveRecipients(envelope.ccs, leadEmail).filter(
      (a) => !taken.has(a.toLowerCase())
    ),
  }
}

/**
 * "16x8" -> "8x16". Some CRMs name a two-dimension size width-first where the
 * form names it length-first. Anything that isn't two numbers passes through.
 */
export function widthFirstBoxSize(value: string): string {
  const m = /^\s*(\d+)\s*x\s*(\d+)\s*$/i.exec(value)
  if (!m) return value
  const [a, b] = [Number(m[1]), Number(m[2])]
  return `${Math.min(a, b)}x${Math.max(a, b)}`
}

function runTransform(name: WebhookTransform, value: string): string {
  if (name === 'widthFirst') return widthFirstBoxSize(value)
  if (name.startsWith('date:')) return formatDateAs(value, name.slice(5))
  return value
}

/** Every transform the editor can offer. */
export const WEBHOOK_TRANSFORMS: WebhookTransform[] = [
  'widthFirst',
  ...DATE_FORMATS.map((f) => `date:${f}` as WebhookTransform),
]

/**
 * Shapes a lead into exactly the keys one webhook accepts.
 *
 * A key whose field is absent or empty sends `whenEmpty`, or '' when the site
 * didn't declare one — webhooks treat a missing key and an empty string
 * differently, and several of these fields are usually required in the CRM.
 */
export function buildWebhookPayload(
  keys: WebhookKeys,
  lead: Lead
): Record<string, string> {
  const payload: Record<string, string> = {}

  for (const [key, spec] of Object.entries(keys)) {
    if ('value' in spec) {
      payload[key] = spec.value
      continue
    }

    const raw = lead[spec.from]
    const source = raw == null ? '' : String(raw)
    if (!source) {
      payload[key] = spec.whenEmpty ?? ''
      continue
    }

    if (!spec.as) {
      payload[key] = source
    } else if (typeof spec.as === 'string') {
      payload[key] = runTransform(spec.as, source)
    } else {
      // An unmapped value would send this CRM a word its field mapping cannot
      // read, so fall back to whenEmpty rather than guess.
      payload[key] = spec.as[source] ?? spec.whenEmpty ?? ''
    }
  }

  return payload
}

/**
 * The values a `{placeholder}` can name: every field by id, plus the profile's
 * own brand and phone.
 *
 * A choice resolves to the words the visitor saw rather than its stored value,
 * because these end up in a subject line and in body copy — "Keep It", not
 * "keep_it".
 */
export function templateVars(
  profile: Pick<Profile, 'emailBrand' | 'phoneNumber'>,
  fields: readonly FieldDef[],
  lead: Lead
): Record<string, string> {
  const vars: Record<string, string> = {
    brand: profile.emailBrand,
    phone: profile.phoneNumber,
  }
  for (const field of fields) {
    vars[field.id] = optionLabel(field, lead[field.id] ?? '')
  }
  return vars
}

/**
 * Fills `{placeholder}` from `vars`.
 *
 * A name with no value is left standing rather than blanked, so a template that
 * outlived the field it names says so in the preview instead of quietly losing
 * a word mid-sentence.
 */
export function renderTemplate(
  template: string,
  vars: Record<string, string>
): string {
  return template.replace(/\{(\w+)\}/g, (whole, key: string) =>
    vars[key] == null ? whole : vars[key]
  )
}

/** The subject both emails are sent with, from EMAIL_LABELS.subjectTemplate. */
export function emailSubjectFor(
  profile: Pick<Profile, 'emailBrand' | 'phoneNumber'>,
  labels: Pick<EmailLabels, 'subjectTemplate'>,
  fields: readonly FieldDef[],
  lead: Lead
): string {
  return renderTemplate(
    labels.subjectTemplate,
    templateVars(profile, fields, lead)
  ).replace(/\s+/g, ' ').trim()
}

/**
 * The fields a webhook key can draw from, as the editor lists them.
 *
 * Derived rather than declared: the picker offers exactly what the form
 * collects, so a key can never be pointed at a field that does not exist.
 */
export function leadFieldChoices(
  fields: readonly FieldDef[]
): { value: string; label: string }[] {
  return fields.map((f) => ({ value: f.id, label: f.label }))
}

/**
 * The fields whose values are a vocabulary the CRM has its own words for, and
 * what those values are — every `choice` field, for the editor's value table.
 */
export function mappableValues(
  fields: readonly FieldDef[]
): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  for (const field of fields) {
    if (field.type === 'choice' && field.options?.length) {
      out[field.id] = field.options.map((o) => o.value)
    }
  }
  return out
}

/** Sensible EMAIL_LABELS for a site that has not overridden them. */
export const DEFAULT_EMAIL_LABELS: EmailLabels = {
  dateFormat: 'Month D, YYYY',
  subjectTemplate: '{brand} enquiry',
  adminSubjectPrefix: 'New Lead: ',
}
