// Exercises the config writer against a real config file.
//
// This is the one piece of the package that edits a site's own source, and a
// mangled edit is not a failure anybody sees until the next build — so the
// round trip is checked here rather than trusted: every writer is run over
// src/examples/contactForm.ts, and the result is compared field by field.
//
// The module reads two virtual modules that only exist inside an Astro build,
// so it is bundled here against stubs rather than imported directly.

import { build } from 'esbuild'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const dir = mkdtempSync(path.join(tmpdir(), 'form-pro-writer-'))
const stub = (name, contents) => {
  const file = path.join(dir, name)
  writeFileSync(file, contents)
  return file
}

const optionsStub = stub('options.mjs', `export default ${JSON.stringify({ configPath: 'src/config/form.ts' })}`)
const configStub = stub(
  'config.mjs',
  [
    'export const FIELDS = []',
    'export const PROFILES = {}',
    "export const EMAIL_LABELS = { dateFormat: '', subjectTemplate: '' }",
    'export const SITE_SETTINGS = {}',
  ].join('\n')
)

const bundle = path.join(dir, 'writer.mjs')
await build({
  entryPoints: ['src/editor/source.ts'],
  outfile: bundle,
  bundle: true,
  format: 'esm',
  platform: 'node',
  alias: { 'virtual:form-pro/options': optionsStub, 'virtual:form-pro/config': configStub },
})

const { applyEdit, applyFieldLabels, applyKeys, applyLabels, applySettings } = await import(bundle)

let failed = 0
const ok = (name, condition) => {
  if (!condition) failed += 1
  console.log(`${condition ? 'ok  ' : 'FAIL'} ${name}`)
}

const SOURCE = 'src/examples/contactForm.ts'
const before = readFileSync(SOURCE, 'utf8')

// Field labels, on entries written both inline and across several lines.
let out = applyFieldLabels(before, { topic: 'What is this about', email: 'Email address' })
ok('label rewritten', out.includes("label: 'What is this about'"))
ok('the property after it still has its comma', /label: 'What is this about',\n\s+type: 'choice',/.test(out))
ok(
  'an entry it did not touch is byte-identical',
  out.includes("{ id: 'phone', label: 'Phone', type: 'phone', audience: 'admin', sample: '(555) 010-4142' }")
)
ok('a label for a field the file no longer declares is dropped', applyFieldLabels(before, { nope: 'x' }) === before)

// A label that is the last property has no comma to restore, and none invented.
const trailing = "export const FIELDS = [\n  { id: 'a', type: 'text', label: 'Old' },\n] as const\n"
ok(
  'a trailing property keeps its spacing',
  applyFieldLabels(trailing, { a: 'New' }) ===
    "export const FIELDS = [\n  { id: 'a', type: 'text', label: 'New' },\n] as const\n"
)

// An apostrophe in a comment must not open a string. Before the scanners
// understood comments, "market's" swallowed every brace after it, the entry
// spans slid, and a label was written into the wrong field — silently, because
// the result still parsed and the site still built.
const commented = [
  'export const FIELDS = [',
  "  {",
  "    id: 'storageType',",
  "    label: 'Storage',",
  '    type: "choice",',
  "    // what each market's own catalog narrows; see the profile's fieldOptions",
  '    options: [],',
  '  },',
  "  { id: 'containerSize', label: 'Container size', type: 'choice' },",
  '] as const',
  '',
].join('\n')
ok(
  'an apostrophe in a comment does not shift the entry spans',
  applyFieldLabels(commented, { storageType: 'Storage', containerSize: 'Container size' }) ===
    commented
)
ok(
  'and the right entry is still editable through one',
  applyFieldLabels(commented, { containerSize: 'Box size' }).includes(
    "{ id: 'containerSize', label: 'Box size', type: 'choice' }"
  ) && applyFieldLabels(commented, { containerSize: 'Box size' }).includes("label: 'Storage',")
)

// One profile: scalars, a multi-line array, a nested value and the copy blocks.
out = applyEdit(out, {
  slug: 'main',
  emailBrand: 'Renamed Co',
  phoneNumber: '(555) 999-0000',
  emailResponsePromise: 'Within the hour.',
  emailFooterLines: ['Renamed Co', 'New address'],
  fieldOptions: { topic: ['sales'] },
  webhookUrl: 'https://crm.example.com/hooks/new',
  clientEmail: { fromName: 'Renamed Co', fromAddress: 'hi@example.com', to: ['{{lead.email}}'], ccs: [] },
  adminEmail: { fromName: 'Renamed site', fromAddress: 'hi@example.com', to: ['team@example.com'], ccs: [] },
  clientCopy: {
    heading: 'Thanks, {firstName}.',
    greeting: 'Got it.',
    requestTitle: 'What you sent us',
    pricingNote: '',
    bookingNote: 'Call {phone}.',
    ctaLabel: 'Call {phone}',
  },
  adminCopy: {
    heading: 'New enquiry',
    subheading: '{topic}',
    requestTitle: 'What they sent',
    noPricingNote: 'None.',
    replyLabel: 'Reply',
    callLabel: 'Call',
    footer: 'From the form.',
  },
})
ok('a scalar is rewritten', out.includes("emailBrand: 'Renamed Co'"))
ok('a multi-line array is replaced whole', out.includes("emailFooterLines: ['Renamed Co', 'New address']"))
ok('a nested value is rewritten', out.includes("url: 'https://crm.example.com/hooks/new'"))
ok('a shared constant is kept as the constant', out.includes('to: [LEAD_EMAIL]'))
ok('copy is rewritten', out.includes("greeting: 'Got it.'"))
ok('a key the file does not declare is not invented', !out.includes('fieldOptions:'))

out = applyKeys(out, 'main', [
  { key: 'first_name', mode: 'field', from: 'firstName', value: '', transform: '', map: {}, hasWhenEmpty: false, whenEmpty: '' },
  { key: 'source', mode: 'value', from: '', value: 'Website', transform: '', map: {}, hasWhenEmpty: false, whenEmpty: '' },
])
ok('keys are regenerated', out.includes("first_name: { from: 'firstName' },") && out.includes("source: { value: 'Website' },"))
ok('keys that were removed are gone', !out.includes('interest:'))

out = applyLabels(out, { dateFormat: 'D Month YYYY', subjectTemplate: '{brand} — new', adminSubjectPrefix: 'Lead: ' })
ok('shared labels are rewritten', out.includes("dateFormat: 'D Month YYYY'") && out.includes("subjectTemplate: '{brand} — new'"))

out = applySettings(out, {
  canaryEnabled: false,
  canaryEmailTo: 'x@example.com',
  canarySendEmails: true,
  marketingCc: '',
  consoleUsers: ['a@example.com'],
})
ok('a boolean is written bare', out.includes('canaryEnabled: false'))
ok('a list is written as a literal', out.includes("consoleUsers: ['a@example.com']"))

// A file that has drifted fails loudly instead of being mangled.
let threw = false
try {
  applyEdit('export const PROFILES = {}\n', { slug: 'main' })
} catch {
  threw = true
}
ok('a drifted file throws rather than being rewritten', threw)

// The result has to be something the site can still build.
const rewritten = path.join('src', 'examples', '__writer_output.ts')
writeFileSync(rewritten, out)
console.log(`\nwrote ${rewritten} — typecheck it with \`npx tsc --noEmit\` to confirm it still compiles`)

process.exit(failed === 0 ? 0 : 1)
