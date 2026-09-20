import type { EditableKey, EditableProfile, EmailLabels, ReadResponse, SiteSettings } from './types.ts'

/**
 * What a save is about to change, worked out in the browser before it is sent.
 *
 * The server already records a revision for the log afterwards; this is the
 * other half, and the more important one — a deploy on this console commits
 * straight to the production branch with no review step, so the list of what is
 * about to move belongs in front of the person, before they commit, not in the
 * history after.
 *
 * It covers exactly what the write endpoint writes: the profile on screen, plus
 * the three things every profile shares. Anything shared is marked, because
 * "this also changes the other markets" is the surprise this console exists to
 * stop.
 */

export interface Change {
  path: string
  before: string
  after: string
  /** Shared by every profile, so editing it here edits the others. */
  shared?: boolean
  /** The other end has its own field mapping, and it will not be updated. */
  external?: boolean
}

const isPlain = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/** One value, as a person would read it back. */
function show(value: unknown): string {
  if (value == null) return ''
  if (typeof value === 'boolean') return value ? 'on' : 'off'
  if (Array.isArray(value)) return value.join(', ')
  if (isPlain(value)) {
    const pairs = Object.entries(value).filter(([, v]) => v !== '' && v != null)
    return pairs.map(([k, v]) => `${k}: ${show(v)}`).join(' · ')
  }
  return String(value)
}

function walk(before: unknown, after: unknown, path: string, out: Change[], mark: Partial<Change>) {
  if (isPlain(before) && isPlain(after)) {
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
      walk(before[key], after[key], path ? `${path}.${key}` : key, out, mark)
    }
    return
  }
  const from = show(before)
  const to = show(after)
  if (from !== to) out.push({ path, before: from, after: to, ...mark })
}

/**
 * Webhook keys compared by name rather than by position, so reordering them is
 * not reported as every key changing at once.
 */
function webhookChanges(before: EditableKey[], after: EditableKey[], out: Change[]) {
  const byKey = (list: EditableKey[]) => new Map(list.map((k) => [k.key, k]))
  const was = byKey(before)
  const now = byKey(after)

  for (const [name, key] of now) {
    const previous = was.get(name)
    if (!previous) {
      out.push({
        path: `webhook.${name || '(unnamed)'}`,
        before: '(no such key)',
        after: describeKey(key),
        external: true,
      })
      continue
    }
    if (describeKey(previous) !== describeKey(key)) {
      out.push({
        path: `webhook.${name}`,
        before: describeKey(previous),
        after: describeKey(key),
        external: true,
      })
    }
  }
  for (const [name, key] of was) {
    if (!now.has(name)) {
      out.push({
        path: `webhook.${name || '(unnamed)'}`,
        before: describeKey(key),
        after: '(key removed)',
        external: true,
      })
    }
  }
}

function describeKey(key: EditableKey): string {
  if (key.mode === 'value') return `fixed "${key.value}"`
  const bits = [`from ${key.from}`]
  if (key.transform) bits.push(`as ${key.transform}`)
  const mapped = Object.entries(key.map ?? {}).filter(([, v]) => v)
  if (mapped.length) bits.push(mapped.map(([k, v]) => `${k}→${v}`).join(', '))
  if (key.hasWhenEmpty) bits.push(`empty → "${key.whenEmpty}"`)
  return bits.join(' · ')
}

export function pendingChanges(
  original: ReadResponse | null,
  edited: {
    profile: EditableProfile | undefined
    fieldLabels: Record<string, string>
    labels: EmailLabels | null
    settings: SiteSettings | null
  }
): Change[] {
  if (!original || !edited.profile || !edited.labels || !edited.settings) return []
  const out: Change[] = []

  const was = original.profiles.find((p) => p.slug === edited.profile!.slug)
  if (was) {
    const { webhookKeys: wasKeys, ...wasRest } = was
    const { webhookKeys: nowKeys, ...nowRest } = edited.profile
    walk(wasRest, nowRest, '', out, {})
    webhookChanges(wasKeys, nowKeys, out)
  }

  for (const field of original.fields) {
    const next = edited.fieldLabels[field.id] ?? field.label
    if (next !== field.label) {
      out.push({
        path: `fields.${field.id}.label`,
        before: field.label,
        after: next,
        shared: original.profiles.length > 1,
      })
    }
  }

  walk(original.labels, edited.labels, 'subject', out, { shared: original.profiles.length > 1 })
  walk(original.settings, edited.settings, 'site', out, { shared: original.profiles.length > 1 })

  return out
}
