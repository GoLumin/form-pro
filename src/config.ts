// Reading a site's declared config: turning envelopes into recipients and leads
// into exactly the keys one webhook accepts.
//
// Pure functions over the types in ./types.ts, with no import of any site's
// values — which is what lets the same code serve a one-market microsite and a
// four-market parent, and lets the console test either without a form.

import { DATE_FORMATS, formatDateAs } from './dateFormats.ts'
import type {
  EmailEnvelope,
  Lead,
  LeadField,
  Location,
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
 * "16x8" -> "8x16". The quote form (and gofuse) name a container length-first;
 * some CRMs want width-first. Anything that isn't two numbers passes through.
 */
export function widthFirstBoxSize(containerSize: string): string {
  const m = /^\s*(\d+)\s*x\s*(\d+)\s*$/i.exec(containerSize)
  if (!m) return containerSize
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
 * Shapes a lead into exactly the keys one market's webhook accepts.
 *
 * A key whose lead field is absent or empty sends `whenEmpty`, or '' when the
 * market didn't declare one — the webhooks treat a missing key and an empty
 * string differently, and several of these fields are required in the CRM.
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
      // An unmapped value would send this market's CRM a word its field mapping
      // cannot read, so fall back to whenEmpty rather than guess.
      payload[key] = spec.as[source] ?? spec.whenEmpty ?? ''
    }
  }

  return payload
}

/** Subject line wording per service, e.g. "Mule Box Quote - Keep It". */
const SERVICE_LABELS: Record<Lead['serviceType'], string> = {
  keep_it: 'Keep It',
  move_it: 'Move It',
  store_it: 'Store It',
}

export function emailSubjectFor(
  location: Pick<Location, 'emailBrand'>,
  serviceType: Lead['serviceType']
): string {
  return `${location.emailBrand} Quote - ${SERVICE_LABELS[serviceType]}`
}

export function serviceLabel(serviceType: Lead['serviceType']): string {
  return SERVICE_LABELS[serviceType]
}

/** The lead fields a webhook key can draw from, in the order the editor lists them. */
export const LEAD_FIELDS: LeadField[] = [
  'firstName',
  'lastName',
  'fullName',
  'email',
  'phone',
  'deliveryDate',
  'deliveryZip',
  'relocationZip',
  'serviceType',
  'storageType',
  'containerSize',
]

/** The values a mapped field can take, for the editor's value table. */
export const MAPPABLE_VALUES: Partial<Record<string, string[]>> = {
  serviceType: ['keep_it', 'move_it', 'store_it'],
  storageType: ['indoor', 'outdoor'],
}

/** Sensible EMAIL_LABELS for a site that has not overridden them. */
export const DEFAULT_EMAIL_LABELS = {
  dateFormat: 'Month D, YYYY',
  rows: {
    service: 'Service Type',
    name: 'Name',
    email: 'Email',
    phone: 'Phone',
    deliveryDate: 'Delivery date',
    deliveryZip: 'Delivery ZIP',
    relocationZip: 'Relocation ZIP',
    containerSize: 'Container size',
    storage: 'Storage',
  },
  pricing: {
    title: 'Estimated pricing',
    firstMonthLabel: 'First month',
    monthlyAfterLabel: 'Monthly after that',
    monthlyAfterNote: 'Every month after first month',
    monthlyLabel: 'Monthly',
    startingAt: 'Starting at {amount}',
    feesSeparate: 'Plus {amount} in fees billed separately once confirmed.',
    dueSuffix: '(est.)',
    afterFirstMonth: 'Then {monthly}/mo after your first month.',
    discountExplainer:
      'The discount applies to the first month only. {monthly}/mo after first month.',
  },
}
