import options from 'virtual:form-pro/options'
import { EMAIL_LABELS, FIELDS, PROFILES, SITE_SETTINGS } from 'virtual:form-pro/config'
import type { FieldDef } from '../fields.ts'
import type { EmailLabels, Profile } from '../types.ts'

/**
 * Reads and writes the editable values in the site's config module.
 *
 * Reading is free: the module is already imported, so the current values come
 * straight off PROFILES rather than being parsed back out of the source.
 *
 * Writing edits the source file in place, one field on one line, inside the
 * block belonging to one profile. It deliberately does NOT regenerate the file:
 * most of what is in there is the comments explaining why a value is what it
 * is — which webhook a key belongs to, why one profile sends from its own
 * domain — and regenerating would throw all of that away the first time anyone
 * saved.
 *
 * Only ever works on a dev server. A deployed build has a read-only filesystem
 * and is running compiled output, so a write there would change nothing and
 * survive nothing; the caller offers the generated lines to copy instead.
 */

/** The fields the form can change. Anything else stays a code edit. */
export interface EditableProfile {
  slug: string
  name: string
  emailBrand: string
  phoneNumber: string
  emailResponsePromise: string
  emailFooterLines: string[]
  /** Which of each choice field's options this profile offers, by field id. */
  fieldOptions: Record<string, string[]>
  webhookUrl: string
  clientEmail: { fromName: string; fromAddress: string; to: string[]; ccs: string[] }
  adminEmail: { fromName: string; fromAddress: string; to: string[]; ccs: string[] }
  clientCopy: Profile['clientCopy']
  adminCopy: Profile['adminCopy']
  /** The webhook's keys, editable. They must match the CRM's field mapping. */
  webhookKeys: EditableKey[]
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
  /** Per-source-value translation, for the choice fields. */
  map: Record<string, string>
  /** Whether the key declares a fallback at all, apart from what it is. */
  hasWhenEmpty: boolean
  whenEmpty: string
}

function toEditableKey(key: string, spec: unknown): EditableKey {
  const o = (spec ?? {}) as Record<string, unknown>
  return {
    key,
    mode: 'value' in o ? 'value' : 'field',
    from: typeof o.from === 'string' ? o.from : '',
    value: typeof o.value === 'string' ? o.value : '',
    transform: typeof o.as === 'string' ? o.as : '',
    map: o.as && typeof o.as === 'object' ? { ...(o.as as Record<string, string>) } : {},
    hasWhenEmpty: o.whenEmpty != null,
    whenEmpty: typeof o.whenEmpty === 'string' ? o.whenEmpty : '',
  }
}

export function toEditable(profile: Profile): EditableProfile {
  const fieldOptions: Record<string, string[]> = {}
  for (const [id, values] of Object.entries(profile.fieldOptions ?? {})) {
    fieldOptions[id] = [...values]
  }
  return {
    slug: profile.slug,
    name: profile.name,
    emailBrand: profile.emailBrand,
    phoneNumber: profile.phoneNumber,
    emailResponsePromise: profile.emailResponsePromise,
    emailFooterLines: [...profile.emailFooterLines],
    fieldOptions,
    webhookUrl: profile.webhook.url,
    clientCopy: { ...profile.clientCopy },
    adminCopy: { ...profile.adminCopy },
    clientEmail: {
      fromName: profile.clientEmail.fromName,
      fromAddress: profile.clientEmail.fromAddress,
      to: [...profile.clientEmail.to],
      ccs: [...profile.clientEmail.ccs],
    },
    adminEmail: {
      fromName: profile.adminEmail.fromName,
      fromAddress: profile.adminEmail.fromAddress,
      to: [...profile.adminEmail.to],
      ccs: [...profile.adminEmail.ccs],
    },
    webhookKeys: Object.entries(profile.webhook.keys).map(([key, spec]) =>
      toEditableKey(key, spec)
    ),
  }
}

export function readEditable(): EditableProfile[] {
  return Object.values(PROFILES).map(toEditable)
}

/**
 * The form's shape, for the console.
 *
 * Read-only apart from the labels: what a form collects is structure, and
 * changing it means changing the webhook keys that draw from it and the page
 * that renders it. The labels are copy, and those the console does write.
 */
export function readFields(): FieldDef[] {
  return FIELDS.map((f) => ({ ...f }))
}

export type SiteSettings = typeof SITE_SETTINGS

/** The settings that belong to the site rather than a profile. */
export function readSettings(): SiteSettings {
  const settings = SITE_SETTINGS as SiteSettings & { consoleUsers?: string[] }
  return {
    ...settings,
    // Defaulted rather than required, because a site that predates console
    // sign-in has no such line yet and must still be able to save the settings
    // it does have.
    consoleUsers: [...(settings.consoleUsers ?? [])],
  }
}

/** The wording shared by every profile. */
export function readLabels(): EmailLabels {
  return {
    dateFormat: EMAIL_LABELS.dateFormat,
    subjectTemplate: EMAIL_LABELS.subjectTemplate,
    ...(EMAIL_LABELS.adminSubjectPrefix != null
      ? { adminSubjectPrefix: EMAIL_LABELS.adminSubjectPrefix }
      : {}),
    ...(EMAIL_LABELS.pricing ? { pricing: { ...EMAIL_LABELS.pricing } } : {}),
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

/**
 * Where a top-level `export const NAME = {` or `= [` begins.
 *
 * Tolerates a type annotation, because a site that writes
 * `export const EMAIL_LABELS: EmailLabels = {` is doing the right thing and
 * must not be punished for it by an editor that cannot find its own block.
 * Returns the index of the newline before the declaration, which is what the
 * callers slice from.
 */
function declarationAt(source: string, name: string, opener: '{' | '['): number {
  // Built by concatenation rather than a template literal: the pattern is all
  // backslash escapes, and a template literal eats the ones it does not know.
  const re = new RegExp('(?:^|\\n)export const ' + name + '\\s*(?::[^=]+)?=\\s*\\' + opener)
  const found = re.exec(source)
  return found ? found.index : -1
}

/** The span of one profile's entry, from its key line to its closing brace. */
function blockRange(source: string, slug: string): [number, number] {
  const key = /^[a-z]+$/.test(slug) ? slug : `'${slug}'`
  const open = source.indexOf(`\n  ${key}: {\n`)
  if (open < 0) throw new Error(`${slug}: no entry found in ${SOURCE}`)
  const close = source.indexOf('\n  },\n', open)
  if (close < 0) throw new Error(`${slug}: entry is not closed as expected`)
  return [open, close]
}

/**
 * How far a comment starting at `i` runs, or -1 when one does not start there.
 *
 * The scanners below track string state so a brace inside a quoted value does
 * not move their depth count. Comments need the same treatment for the opposite
 * reason: an apostrophe in ordinary prose — "each market's own webhook" — opens
 * a string that never closes, and from there every brace is counted wrong and
 * an edit lands in the wrong entry. That failure is silent: the file still
 * parses, so the site still builds, and the only sign is a value that moved on
 * its own.
 */
function commentEnd(text: string, i: number): number {
  if (text[i] !== '/') return -1
  if (text[i + 1] === '/') {
    const nl = text.indexOf('\n', i)
    return nl === -1 ? text.length : nl
  }
  if (text[i + 1] === '*') {
    const close = text.indexOf('*/', i + 2)
    return close === -1 ? text.length : close + 1
  }
  return -1
}

/**
 * The end of the value that starts at `start`: the index just past the comma
 * that closes it, or at the bracket that closes the object holding it.
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
    const comment = commentEnd(block, i)
    if (comment !== -1) {
      i = comment
      continue
    }
    if (c === "'" || c === '"' || c === '`') quote = c
    else if (c === '[' || c === '{' || c === '(') depth += 1
    else if (c === ']' || c === '}' || c === ')') {
      // A closer we never opened ends the value: it belongs to the object this
      // value sits in, which is what a trailing property has instead of a comma.
      if (depth === 0) return i
      depth -= 1
    } else if (c === ',' && depth === 0) return i + 1
  }
  throw new Error('value is not terminated')
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

/**
 * The same replacement for a property that may sit inline — `{ id: 'x', label:
 * 'y' }` — where there is no line start to anchor to and no trailing comma to
 * stop at.
 */
function setInlineField(
  source: string,
  from: number,
  to: number,
  key: string,
  value: string
): string {
  const block = source.slice(from, to)
  const re = new RegExp(`(^|[{,\\s])${key}\\s*:`, 'm')
  const found = block.match(re)
  if (!found || found.index === undefined) {
    throw new Error(`${key}: not found where expected`)
  }
  const at = found.index + found[0].length
  const end = valueEnd(block, at)
  // valueEnd consumes the comma that closed the value but stops *at* a closing
  // bracket, so what followed the old value is put back as it was: the comma
  // where there was one, and otherwise whatever spacing separated it from the
  // brace. Dropping the comma runs the next property onto this line and the
  // site stops building — which the editor never sees, only the next deploy.
  const raw = block.slice(at, end)
  const hadComma = raw.endsWith(',')
  const trailing = hadComma ? ',' : (/\s*$/.exec(raw)?.[0] ?? '')
  const replaced = block.slice(0, at) + ` ${value}${trailing}` + block.slice(end)
  return source.slice(0, from) + replaced + source.slice(to)
}

/** Every top-level object in the array that starts at `open`. */
function arrayEntries(source: string, open: number): [number, number][] {
  const start = source.indexOf('[', open)
  if (start < 0) throw new Error('array: not found')
  const spans: [number, number][] = []
  let depth = 0
  let entry = -1
  let quote: string | null = null
  for (let i = start + 1; i < source.length; i += 1) {
    const c = source[i]
    if (quote) {
      if (c === '\\') i += 1
      else if (c === quote) quote = null
      continue
    }
    const comment = commentEnd(source, i)
    if (comment !== -1) {
      i = comment
      continue
    }
    if (c === "'" || c === '"' || c === '`') quote = c
    else if (c === '{' || c === '[' || c === '(') {
      if (depth === 0 && c === '{') entry = i
      depth += 1
    } else if (c === '}' || c === ']' || c === ')') {
      if (depth === 0 && c === ']') break
      depth -= 1
      if (depth === 0 && c === '}' && entry >= 0) {
        spans.push([entry, i + 1])
        entry = -1
      }
    }
  }
  return spans
}

export interface EditPayload {
  slug: string
  emailBrand: string
  phoneNumber: string
  emailResponsePromise: string
  emailFooterLines: string[]
  fieldOptions: Record<string, string[]>
  webhookUrl: string
  clientEmail: { fromName: string; fromAddress: string; to: string[]; ccs: string[] }
  adminEmail: { fromName: string; fromAddress: string; to: string[]; ccs: string[] }
  clientCopy: Record<string, string>
  adminCopy: Record<string, string>
}

/**
 * Shared constants the editor keeps using when the value still matches, so a
 * save does not expand every reference to one into a literal.
 */
const SHARED_ARRAYS: Record<string, string> = {
  '{{lead.email}}': '[LEAD_EMAIL]',
}

/** Applies one profile's edits to the source text and returns the new text. */
export function applyEdit(source: string, edit: EditPayload): string {
  let next = source
  const reslice = () => blockRange(next, edit.slug)

  const scalar: [string, string][] = [
    ['emailBrand', str(edit.emailBrand)],
    ['phoneNumber', str(edit.phoneNumber)],
    ['emailResponsePromise', str(edit.emailResponsePromise)],
    ['emailFooterLines', `[${edit.emailFooterLines.map(str).join(', ')}]`],
  ]
  for (const [key, value] of scalar) {
    const [from, to] = reslice()
    next = setField(next, from, to, key, value)
  }

  // Written on one line, and only where the file already declares it: a profile
  // that offers everything has no such key, and inventing one would be the
  // editor deciding something the site chose not to say.
  {
    const [from, to] = reslice()
    if (/\n    fieldOptions:/.test(next.slice(from, to))) {
      const literal = `{ ${Object.entries(edit.fieldOptions)
        .map(([id, values]) => `${id}: [${values.map(str).join(', ')}]`)
        .join(', ')} }`
      next = setField(next, from, to, 'fieldOptions', literal)
    }
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
 * It sits at module level rather than inside a profile, so it gets its own
 * locator — but the same one-line replacement, and the same refusal to guess
 * when the file has drifted.
 */
export function applyLabels(source: string, labels: EmailLabels): string {
  let next = source
  const open = declarationAt(next, 'EMAIL_LABELS', '{')
  if (open < 0) throw new Error(`EMAIL_LABELS: not found in ${SOURCE}`)
  const close = next.indexOf('\n}\n', open)
  if (close < 0) throw new Error('EMAIL_LABELS: not closed as expected')

  // The scalars at the top of the block. A key the file does not declare is
  // skipped rather than invented — adminSubjectPrefix is optional, and a site
  // that has not adopted it must still be able to save the rest.
  {
    let inner = next.slice(open, close)
    const scalars: [string, string | undefined][] = [
      ['dateFormat', labels.dateFormat],
      ['subjectTemplate', labels.subjectTemplate],
      ['adminSubjectPrefix', labels.adminSubjectPrefix],
    ]
    for (const [key, value] of scalars) {
      if (value == null) continue
      if (!new RegExp(`\\n  ${key}:`).test(inner)) continue
      inner = setField(inner, 0, inner.length, key, str(value), '  ')
    }
    next = next.slice(0, open) + inner + next.slice(close)
  }

  if (labels.pricing) {
    const groupAt = next.indexOf('  pricing: {\n', open)
    if (groupAt >= 0 && groupAt < close) {
      const groupEnd = next.indexOf('\n  },\n', groupAt)
      if (groupEnd < 0) throw new Error('EMAIL_LABELS.pricing: not closed as expected')
      let inner = next.slice(groupAt, groupEnd)
      for (const [key, value] of Object.entries(labels.pricing)) {
        inner = setField(inner, 0, inner.length, key, str(value), '    ')
      }
      next = next.slice(0, groupAt) + inner + next.slice(groupEnd)
    }
  }
  return next
}

/**
 * Writes the labels in the FIELDS array.
 *
 * A field's label is the one part of the form's shape that is copy rather than
 * structure: it is the words beside the value in both emails, and whoever owns
 * that wording should not need a deploy to change it. Everything else about a
 * field — its id, its type, what it depends on — stays a code edit, because
 * changing it changes what the webhook keys can draw from.
 */
export function applyFieldLabels(
  source: string,
  labels: Record<string, string>
): string {
  let next = source
  const open = declarationAt(next, 'FIELDS', '[')
  if (open < 0) throw new Error(`FIELDS: not found in ${SOURCE}`)

  for (const [id, label] of Object.entries(labels)) {
    const spans = arrayEntries(next, open)
    const span = spans.find((s) => {
      const entry = next.slice(s[0], s[1])
      return new RegExp(`id\\s*:\\s*'${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'`).test(entry)
    })
    // A label for a field the file no longer declares is dropped rather than
    // appended somewhere it does not belong.
    if (!span) continue
    next = setInlineField(next, span[0], span[1], 'label', str(label))
  }
  return next
}

/**
 * Writes the SITE_SETTINGS block.
 *
 * Booleans are written bare and lists as array literals; everything else is a
 * string. Same one-line replacement and same refusal to guess as the rest.
 */
export function applySettings(source: string, settings: SiteSettings): string {
  let next = source
  const open = declarationAt(next, 'SITE_SETTINGS', '{')
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
    // A key the file does not declare is skipped rather than invented. Settings
    // gained fields over time, and a site that has not adopted one must still
    // be able to save the ones it has — the Settings tab says which are absent.
    if (!new RegExp(`\\n\\s*${key}:`).test(inner)) continue
    inner = setField(inner, 0, inner.length, key, literal, '  ')
  }
  return next.slice(0, open) + inner + next.slice(close)
}

/** One key as it is written in the config. */
function serialiseKey(k: EditableKey): string {
  if (k.mode === 'value') return `{ value: ${str(k.value)} }`

  const parts: string[] = [`from: ${str(k.from)}`]
  const mapEntries = Object.entries(k.map).filter(([, v]) => v !== '')
  if (mapEntries.length) {
    parts.push(`as: { ${mapEntries.map(([a, b]) => `${a}: ${str(b)}`).join(', ')} }`)
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
 * Rewrites one profile's `keys` block.
 *
 * Unlike every other edit this one regenerates rather than replacing a line,
 * because keys can be renamed, added and removed. Two consequences worth
 * knowing: a profile that shared a default set gets its keys written out in
 * full the first time it is saved, and any comment written inside the block is
 * lost. Comments above `url` — which is where the per-profile notes live — are
 * untouched.
 */
export function applyKeys(source: string, slug: string, keys: EditableKey[]): string {
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

  const body = keys.map((k) => `        ${k.key}: ${serialiseKey(k)},`).join('\n')
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
  before: EditableProfile | undefined,
  after: Record<string, unknown>,
  labelsBefore: EmailLabels,
  labelsAfter: EmailLabels | undefined,
  fieldLabelsBefore: Record<string, string> = {},
  fieldLabelsAfter: Record<string, string> | undefined = undefined
): Change[] {
  const pick = (v: EditableProfile | Record<string, unknown> | undefined) => {
    if (!v) return {}
    const o = v as Record<string, unknown>
    return {
      emailBrand: o.emailBrand,
      phoneNumber: o.phoneNumber,
      emailResponsePromise: o.emailResponsePromise,
      emailFooterLines: o.emailFooterLines,
      fieldOptions: o.fieldOptions,
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
    ...flatten(fieldLabelsBefore, 'fields'),
  }
  const b = {
    ...flatten(pick(after)),
    ...keysByName(after.webhookKeys as EditableKey[] | undefined),
    ...flatten(labelsAfter ?? labelsBefore, 'labels'),
    ...flatten(fieldLabelsAfter ?? fieldLabelsBefore, 'fields'),
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
  current: EditableProfile | undefined,
  edit: Record<string, unknown>,
  labelsBefore: EmailLabels
): string[] {
  const changed: string[] = []
  // Key order must not count as a difference: the payload the editor posts and
  // the object read back out of the file list the same fields in different
  // orders, which otherwise reported "site settings" changed on every save.
  const stable = (value: unknown): string =>
    JSON.stringify(value, (_k, v) =>
      v && typeof v === 'object' && !Array.isArray(v)
        ? Object.fromEntries(
            Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1))
          )
        : v
    )
  const same = (a: unknown, b: unknown) => stable(a) === stable(b)
  if (!current) return changed
  if (current.emailBrand !== edit.emailBrand) changed.push('email brand')
  if (current.phoneNumber !== edit.phoneNumber) changed.push('phone number')
  if (current.emailResponsePromise !== edit.emailResponsePromise) changed.push('response promise')
  if (!same(current.emailFooterLines, edit.emailFooterLines)) changed.push('footer lines')
  if (!same(current.fieldOptions, edit.fieldOptions)) changed.push('field options')
  if (current.webhookUrl !== edit.webhookUrl) changed.push('webhook URL')
  if (!same(current.clientEmail, edit.clientEmail)) changed.push('client envelope')
  if (!same(current.adminEmail, edit.adminEmail)) changed.push('admin envelope')
  if (!same(current.clientCopy, edit.clientCopy)) changed.push('client wording')
  if (!same(current.adminCopy, edit.adminCopy)) changed.push('admin wording')
  if (!same(current.webhookKeys, edit.webhookKeys)) changed.push('webhook keys')
  if (!same(readSettings(), edit.settings)) changed.push('site settings')

  const labels = edit.emailLabels as EmailLabels | undefined
  if (labels) {
    if (labels.dateFormat !== labelsBefore.dateFormat) changed.push('date format')
    if (labels.subjectTemplate !== labelsBefore.subjectTemplate) changed.push('subject line')
    if (!same(labels.pricing, labelsBefore.pricing)) changed.push('pricing wording')
  }

  const fieldLabels = edit.fieldLabels as Record<string, string> | undefined
  if (fieldLabels) {
    const before = Object.fromEntries(FIELDS.map((f) => [f.id, f.label]))
    if (!same(before, fieldLabels)) changed.push('field labels')
  }
  return changed
}
