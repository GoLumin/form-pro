import options from 'virtual:form-console/options'
import { EMAIL_LABELS, LOCATIONS, SITE_SETTINGS } from 'virtual:form-console/config'
import type { EmailLabels, Location } from '../types.ts'

/**
 * Reads and writes the editable values in the site's config module.
 *
 * Reading is free: the module is already imported, so the current values come
 * straight off LOCATIONS rather than being parsed back out of the source.
 *
 * Writing edits the source file in place, one field on one line, inside the
 * block belonging to one market. It deliberately does NOT regenerate the file:
 * most of what is in there is the comments explaining why a value is what it
 * is — which webhook a key belongs to, why Bay Area sends from its own domain —
 * and regenerating would throw all of that away the first time anyone saved.
 *
 * Only ever works on a dev server. A deployed build has a read-only filesystem
 * and is running compiled output, so a write there would change nothing and
 * survive nothing; the caller offers the generated lines to copy instead.
 */

/** The fields the form can change. Anything else stays a code edit. */
export interface EditableLocation {
  slug: string
  name: string
  emailBrand: string
  phoneNumber: string
  emailResponsePromise: string
  emailFooterLines: string[]
  storageOptions: string[]
  webhookUrl: string
  clientEmail: { fromName: string; fromAddress: string; to: string[]; ccs: string[] }
  adminEmail: { fromName: string; fromAddress: string; to: string[]; ccs: string[] }
  clientCopy: Location['clientCopy']
  adminCopy: Location['adminCopy']
  /** The webhook's keys, editable. They must match Stella's Fields Mapping. */
  webhookKeys: EditableKey[]
  baseUrl: string
}

/** One webhook key, in the shape the editor's form works with. */
export interface EditableKey {
  key: string
  /** 'field' draws from the lead; 'value' is a constant. */
  mode: 'field' | 'value'
  from: string
  value: string
  /** '' for none, otherwise a named transform like date:mm/dd/yyyy. */
  transform: string
  /** Per-source-value translation, for serviceType and storageType. */
  map: Record<string, string>
  /** Whether the key declares a fallback at all, apart from what it is. */
  hasWhenEmpty: boolean
  whenEmpty: string
}

function toEditableKey(key: string, spec: unknown): EditableKey {
  const o = (spec ?? {}) as Record<string, unknown>
  const base: EditableKey = {
    key,
    mode: 'value' in o ? 'value' : 'field',
    from: typeof o.from === 'string' ? o.from : '',
    value: typeof o.value === 'string' ? o.value : '',
    transform: typeof o.as === 'string' ? o.as : '',
    map: o.as && typeof o.as === 'object' ? { ...(o.as as Record<string, string>) } : {},
    hasWhenEmpty: o.whenEmpty != null,
    whenEmpty: typeof o.whenEmpty === 'string' ? o.whenEmpty : '',
  }
  return base
}

export function toEditable(location: Location): EditableLocation {
  return {
    slug: location.slug,
    name: location.name,
    emailBrand: location.emailBrand,
    phoneNumber: location.phoneNumber,
    emailResponsePromise: location.emailResponsePromise,
    emailFooterLines: [...location.emailFooterLines],
    storageOptions: [...location.storageOptions],
    webhookUrl: location.webhook.url,
    baseUrl: location.baseUrl,
    clientCopy: { ...location.clientCopy },
    adminCopy: { ...location.adminCopy },
    clientEmail: {
      fromName: location.clientEmail.fromName,
      fromAddress: location.clientEmail.fromAddress,
      to: [...location.clientEmail.to],
      ccs: [...location.clientEmail.ccs],
    },
    adminEmail: {
      fromName: location.adminEmail.fromName,
      fromAddress: location.adminEmail.fromAddress,
      to: [...location.adminEmail.to],
      ccs: [...location.adminEmail.ccs],
    },
    webhookKeys: Object.entries(location.webhook.keys).map(([key, spec]) =>
      toEditableKey(key, spec)
    ),
  }
}

export function readEditable(): EditableLocation[] {
  return Object.values(LOCATIONS).map(toEditable)
}

export type SiteSettings = typeof SITE_SETTINGS

/** The settings that belong to the site rather than a market. */
export function readSettings(): SiteSettings {
  return { ...SITE_SETTINGS, franchiseAdminTo: [...SITE_SETTINGS.franchiseAdminTo] }
}

/**
 * Writes the SITE_SETTINGS block.
 *
 * Booleans are written bare and lists as array literals; everything else is a
 * string. Same one-line replacement and same refusal to guess as the rest.
 */
export function applySettings(source: string, settings: SiteSettings): string {
  let next = source
  const open = next.indexOf('\nexport const SITE_SETTINGS = {\n')
  if (open < 0) throw new Error(`SITE_SETTINGS: not found in ${SOURCE}`)
  const close = next.indexOf('\n}\n', open)
  if (close < 0) throw new Error('SITE_SETTINGS: not closed as expected')

  let inner = next.slice(open, close)
  for (const [key, value] of Object.entries(settings)) {
    const literal =
      typeof value === 'boolean'
        ? String(value)
        : Array.isArray(value)
          ? `[${value.map((v) => str(String(v))).join(', ')}]`
          : str(String(value))
    inner = setField(inner, 0, inner.length, key, literal, '  ')
  }
  return next.slice(0, open) + inner + next.slice(close)
}

/** The wording shared by all four markets. */
export function readLabels(): EmailLabels {
  return {
    dateFormat: EMAIL_LABELS.dateFormat,
    rows: { ...EMAIL_LABELS.rows },
    pricing: { ...EMAIL_LABELS.pricing },
  }
}

// -----------------------------------------------------------------------------
// Writing
// -----------------------------------------------------------------------------

const SOURCE = options.configPath

/** A TS single-quoted string literal. */
function str(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
}

/** A TS array literal of strings, or the shared constants where they match. */
function arr(values: string[], shared: Record<string, string>): string {
  const joined = values.join('\u0000')
  for (const [literal, name] of Object.entries(shared)) {
    if (literal === joined) return name
  }
  return `[${values.map(str).join(', ')}]`
}

/** The span of one market's entry, from its key line to its closing brace. */
function blockRange(source: string, slug: string): [number, number] {
  const key = /^[a-z]+$/.test(slug) ? slug : `'${slug}'`
  const open = source.indexOf(`\n  ${key}: {\n`)
  if (open < 0) throw new Error(`${slug}: no entry found in ${SOURCE}`)
  const close = source.indexOf('\n  },\n', open)
  if (close < 0) throw new Error(`${slug}: entry is not closed as expected`)
  return [open, close]
}

/**
 * The end of the value that starts at `start`: the index just past the comma
 * that closes it.
 *
 * Scans rather than pattern-matches, tracking bracket depth and string state,
 * because a value can span lines and contain commas of its own. A regex that
 * stopped at the first comma-terminated line truncated a multi-line array and
 * left the rest of it orphaned in the file — which is not a syntax error the
 * editor can see, only one the next build reports.
 */
function valueEnd(block: string, start: number): number {
  let depth = 0
  let quote: string | null = null
  for (let i = start; i < block.length; i += 1) {
    const c = block[i]
    if (quote) {
      if (c === '\\') i += 1
      else if (c === quote) quote = null
      continue
    }
    if (c === "'" || c === '"' || c === '`') quote = c
    else if (c === '[' || c === '{' || c === '(') depth += 1
    else if (c === ']' || c === '}' || c === ')') depth -= 1
    else if (c === ',' && depth === 0) return i + 1
  }
  throw new Error('value is not terminated by a comma')
}

/**
 * Replaces `indent key: <value>,` with a new value, but only within [from, to)
 * and only when exactly one such key exists there. Anything else throws rather
 * than guessing, so a file that has drifted fails loudly instead of being
 * mangled.
 */
function setField(
  source: string,
  from: number,
  to: number,
  key: string,
  value: string,
  indent = '    '
): string {
  const block = source.slice(from, to)
  const re = new RegExp(`^${indent}${key}:`, 'm')
  const found = block.match(re)
  if (!found || found.index === undefined) {
    throw new Error(`${key}: not found where expected`)
  }
  const end = valueEnd(block, found.index + found[0].length)
  if (block.slice(end).match(re)) throw new Error(`${key}: matched more than once`)

  const replaced =
    block.slice(0, found.index) + `${indent}${key}: ${value},` + block.slice(end)
  return source.slice(0, from) + replaced + source.slice(to)
}

export interface EditPayload {
  slug: string
  emailBrand: string
  phoneNumber: string
  emailResponsePromise: string
  emailFooterLines: string[]
  storageOptions: string[]
  webhookUrl: string
  clientEmail: { fromName: string; fromAddress: string; to: string[]; ccs: string[] }
  adminEmail: { fromName: string; fromAddress: string; to: string[]; ccs: string[] }
  clientCopy: Record<string, string>
  adminCopy: Record<string, string>
}

/** Shared constants the editor keeps using when the value still matches. */
const SHARED_ARRAYS: Record<string, string> = {
  '{{lead.email}}': '[LEAD_EMAIL]',
  ['owner@example.com\u0000ops@example.com']: 'MULEBOX_ADMIN_TO',
}

/** Applies one market's edits to the source text and returns the new text. */
export function applyEdit(source: string, edit: EditPayload): string {
  let next = source
  const reslice = () => blockRange(next, edit.slug)

  const scalar: [string, string][] = [
    ['emailBrand', str(edit.emailBrand)],
    ['phoneNumber', str(edit.phoneNumber)],
    ['emailResponsePromise', str(edit.emailResponsePromise)],
    ['emailFooterLines', `[${edit.emailFooterLines.map(str).join(', ')}]`],
    ['storageOptions', `[${edit.storageOptions.map(str).join(', ')}]`],
  ]
  for (const [key, value] of scalar) {
    const [from, to] = reslice()
    next = setField(next, from, to, key, value)
  }

  // The webhook URL sits one level deeper, inside `webhook: {`.
  {
    const [from, to] = reslice()
    next = setField(next, from, to, 'url', str(edit.webhookUrl), '      ')
  }

  // The copy blocks are plain string maps, so every key is one line.
  for (const kind of ['clientCopy', 'adminCopy'] as const) {
    const block = edit[kind]
    const [from, to] = reslice()
    const openAt = next.indexOf(`    ${kind}: {\n`, from)
    if (openAt < 0 || openAt > to) throw new Error(`${kind}: not found`)
    const closeAt = next.indexOf('\n    },\n', openAt)
    if (closeAt < 0) throw new Error(`${kind}: not closed as expected`)
    let inner = next.slice(openAt, closeAt)
    for (const [key, value] of Object.entries(block)) {
      inner = setField(inner, 0, inner.length, key, str(value), '      ')
    }
    next = next.slice(0, openAt) + inner + next.slice(closeAt)
  }

  for (const kind of ['clientEmail', 'adminEmail'] as const) {
    const e = edit[kind]
    const [from, to] = reslice()
    const openAt = next.indexOf(`    ${kind}: {\n`, from)
    if (openAt < 0 || openAt > to) throw new Error(`${kind}: not found`)
    const closeAt = next.indexOf('\n    },\n', openAt)
    if (closeAt < 0) throw new Error(`${kind}: not closed as expected`)
    let inner = next.slice(openAt, closeAt)
    const fields: [string, string][] = [
      ['fromName', str(e.fromName)],
      ['fromAddress', str(e.fromAddress)],
      ['to', arr(e.to, SHARED_ARRAYS)],
      ['ccs', arr(e.ccs, SHARED_ARRAYS)],
    ]
    for (const [key, value] of fields) {
      inner = setField(inner, 0, inner.length, key, value, '      ')
    }
    next = next.slice(0, openAt) + inner + next.slice(closeAt)
  }

  return next
}

/**
 * Writes the shared EMAIL_LABELS block.
 *
 * It sits at module level rather than inside a market, so it gets its own
 * locator — but the same one-line replacement, and the same refusal to guess
 * when the file has drifted.
 */
export function applyLabels(source: string, labels: EmailLabels): string {
  let next = source
  const open = next.indexOf('\nexport const EMAIL_LABELS = {\n')
  if (open < 0) throw new Error(`EMAIL_LABELS: not found in ${SOURCE}`)
  const close = next.indexOf('\n}\n', open)
  if (close < 0) throw new Error('EMAIL_LABELS: not closed as expected')

  // dateFormat is a scalar at the top of the block.
  {
    const inner = next.slice(open, close)
    const updated = setField(inner, 0, inner.length, 'dateFormat', str(labels.dateFormat), '  ')
    next = next.slice(0, open) + updated + next.slice(close)
  }

  for (const group of ['rows', 'pricing'] as const) {
    const groupAt = next.indexOf(`  ${group}: {\n`, open)
    if (groupAt < 0 || groupAt > close) throw new Error(`EMAIL_LABELS.${group}: not found`)
    const groupEnd = next.indexOf('\n  },\n', groupAt)
    if (groupEnd < 0) throw new Error(`EMAIL_LABELS.${group}: not closed as expected`)
    let inner = next.slice(groupAt, groupEnd)
    for (const [key, value] of Object.entries(labels[group])) {
      inner = setField(inner, 0, inner.length, key, str(value as string), '    ')
    }
    next = next.slice(0, groupAt) + inner + next.slice(groupEnd)
  }
  return next
}

/** One key as it is written in the config. */
function serialiseKey(k: EditableKey): string {
  if (k.mode === 'value') return `{ value: ${str(k.value)} }`

  const parts: string[] = [`from: ${str(k.from)}`]
  const mapEntries = Object.entries(k.map).filter(([, v]) => v !== '')
  if (mapEntries.length) {
    parts.push(
      `as: { ${mapEntries.map(([a, b]) => `${a}: ${str(b)}`).join(', ')} }`
    )
  } else if (k.transform) {
    parts.push(`as: ${str(k.transform)}`)
  }
  if (k.hasWhenEmpty || k.whenEmpty !== '') {
    parts.push(`whenEmpty: ${str(k.whenEmpty)}`)
  }

  const oneLine = `{ ${parts.join(', ')} }`
  if (oneLine.length <= 76) return oneLine
  return `{\n${parts.map((p) => `          ${p},`).join('\n')}\n        }`
}

/**
 * Rewrites one market's `keys` block.
 *
 * Unlike every other edit this one regenerates rather than replacing a line,
 * because keys can be renamed, added and removed. Two consequences worth
 * knowing: a market that shared INITIAL_STAR_KEYS gets its keys written out in
 * full the first time it is saved, and any comment written inside the block is
 * lost. Comments above `url` — which is where the per-market notes live — are
 * untouched.
 */
export function applyKeys(
  source: string,
  slug: string,
  keys: EditableKey[]
): string {
  if (!keys.length) throw new Error('a webhook needs at least one key')
  const seen = new Set<string>()
  for (const k of keys) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(k.key)) {
      throw new Error(`"${k.key}" is not a usable key name`)
    }
    if (seen.has(k.key)) throw new Error(`${k.key}: listed twice`)
    seen.add(k.key)
  }

  const [from, to] = blockRange(source, slug)
  const openAt = source.indexOf('      keys: {\n', from)
  if (openAt < 0 || openAt > to) throw new Error('keys: not found')
  const closeAt = source.indexOf('\n      },\n', openAt)
  if (closeAt < 0) throw new Error('keys: not closed as expected')

  const body = keys
    .map((k) => `        ${k.key}: ${serialiseKey(k)},`)
    .join('\n')
  return source.slice(0, openAt) + `      keys: {\n${body}` + source.slice(closeAt)
}

/** One leaf value that moved, as the revision log records it. */
export interface Change {
  field: string
  before: string
  after: string
}

/** Long copy is recorded, but not without limit. */
const MAX_VALUE = 400
const show = (v: unknown): string => {
  if (v === undefined) return ''
  const text =
    typeof v === 'string' ? v : Array.isArray(v) ? v.join(' · ') : JSON.stringify(v)
  return text.length > MAX_VALUE ? `${text.slice(0, MAX_VALUE)}…` : text
}

/** Flattens an object to leaf paths, so two versions can be compared by key. */
function flatten(value: unknown, prefix = '', out: Record<string, string> = {}) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const [k, v] of Object.entries(value)) {
      flatten(v, prefix ? `${prefix}.${k}` : k, out)
    }
  } else {
    out[prefix] = show(value)
  }
  return out
}

/** A webhook key list keyed by name, so a rename reads as one gone and one new. */
function keysByName(keys: EditableKey[] | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  for (const k of keys ?? []) {
    out[`webhook.keys.${k.key}`] =
      k.mode === 'value'
        ? `value "${k.value}"`
        : [
            k.from,
            Object.keys(k.map).length
              ? `mapped ${Object.entries(k.map).map(([a, b]) => `${a}→${b}`).join(', ')}`
              : k.transform || null,
            k.hasWhenEmpty || k.whenEmpty ? `empty→"${k.whenEmpty}"` : null,
          ]
            .filter(Boolean)
            .join(' · ')
  }
  return out
}

/**
 * Every leaf that differs between what is saved and what is being saved.
 *
 * Recorded per field rather than as a text diff of the file: "phoneNumber:
 * (318) 881-6853 → (318) 999-1234" is what someone reading the history wants,
 * and it stays readable when the file around it moves.
 */
export function diffEditable(
  before: EditableLocation | undefined,
  after: Record<string, unknown>,
  labelsBefore: Record<string, unknown>,
  labelsAfter: Record<string, unknown> | undefined
): Change[] {
  const pick = (v: EditableLocation | Record<string, unknown> | undefined) => {
    if (!v) return {}
    const o = v as Record<string, unknown>
    return {
      emailBrand: o.emailBrand,
      phoneNumber: o.phoneNumber,
      emailResponsePromise: o.emailResponsePromise,
      emailFooterLines: o.emailFooterLines,
      storageOptions: o.storageOptions,
      webhookUrl: o.webhookUrl,
      clientEmail: o.clientEmail,
      adminEmail: o.adminEmail,
      clientCopy: o.clientCopy,
      adminCopy: o.adminCopy,
    }
  }

  const a = {
    ...flatten(pick(before)),
    ...keysByName(before?.webhookKeys),
    ...flatten(labelsBefore, 'labels'),
  }
  const b = {
    ...flatten(pick(after)),
    ...keysByName(after.webhookKeys as EditableKey[] | undefined),
    ...flatten(labelsAfter ?? labelsBefore, 'labels'),
  }

  const fields = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()
  return fields
    .filter((f) => (a[f] ?? '') !== (b[f] ?? ''))
    .map((field) => ({ field, before: a[field] ?? '', after: b[field] ?? '' }))
}

export const SOURCE_PATH = SOURCE

/**
 * Human names for the fields that moved, for the revision log and the commit
 * message — so the history says what happened rather than "update config".
 */
export function changedFields(
  current: EditableLocation | undefined,
  edit: Record<string, unknown>,
  labelsBefore: EmailLabels,
): string[] {
  const changed: string[] = []
  // Key order must not count as a difference: the payload the editor posts and
  // the object read back out of the file list the same fields in different
  // orders, which otherwise reported "site settings" changed on every save.
  const stable = (value: unknown): string =>
    JSON.stringify(value, (_k, v) =>
      v && typeof v === 'object' && !Array.isArray(v)
        ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1)))
        : v
    )
  const same = (a: unknown, b: unknown) => stable(a) === stable(b)
  if (!current) return changed
  if (current.emailBrand !== edit.emailBrand) changed.push('email brand')
  if (current.phoneNumber !== edit.phoneNumber) changed.push('phone number')
  if (current.emailResponsePromise !== edit.emailResponsePromise) changed.push('response promise')
  if (!same(current.emailFooterLines, edit.emailFooterLines)) changed.push('footer lines')
  if (!same(current.storageOptions, edit.storageOptions)) changed.push('storage options')
  if (current.webhookUrl !== edit.webhookUrl) changed.push('webhook URL')
  if (!same(current.clientEmail, edit.clientEmail)) changed.push('customer envelope')
  if (!same(current.adminEmail, edit.adminEmail)) changed.push('team envelope')
  if (!same(current.clientCopy, edit.clientCopy)) changed.push('customer wording')
  if (!same(current.adminCopy, edit.adminCopy)) changed.push('team wording')
  if (!same(current.webhookKeys, edit.webhookKeys)) changed.push('webhook keys')
  if (!same(readSettings(), edit.settings)) changed.push('site settings')

  const labels = edit.emailLabels as EmailLabels | undefined
  if (labels) {
    if (labels.dateFormat !== labelsBefore.dateFormat) changed.push('date format')
    if (!same(labels.rows, labelsBefore.rows)) changed.push('shared row labels')
    if (!same(labels.pricing, labelsBefore.pricing)) changed.push('shared pricing labels')
  }
  return changed
}
