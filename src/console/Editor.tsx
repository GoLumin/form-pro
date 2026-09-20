import * as React from 'react'
import { Checkbox } from '../components/ui/checkbox.tsx'
import { Input } from '../components/ui/input.tsx'
import { Label } from '../components/ui/label.tsx'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs.tsx'
import { Textarea } from '../components/ui/textarea.tsx'
import { boot } from './api.ts'
import { Display, Eyebrow, Mono, Panel } from './instrument.tsx'
import { MailPreview } from './MailPreview.tsx'
import { WiringBoard } from './WiringBoard.tsx'
import type { EditableEnvelope, EditableProfile, EmailLabels, FieldDef } from './types.ts'

/**
 * One profile's configuration, as the file declares it.
 *
 * Five sections because five different things are being decided: what the form
 * asks, who the message comes from and goes to, what it says, what the CRM
 * receives, and the one line every email shares. They all save together, since
 * they all live in one entry in one file.
 *
 * The thing this screen does that a settings form does not is say what else a
 * value touches. Every field label is read by both emails, the subject line and
 * any webhook key drawn from it, and on a multi-market site by every other
 * profile as well — so the field being edited shows its own blast radius,
 * worked out from the declaration rather than written down in prose that would
 * go stale the first time someone added a key.
 */

/** The five things this screen decides, in the order the tabs offer them. */
export type EditorSection = 'fields' | 'envelopes' | 'copy' | 'webhook' | 'subject'

const lines = (v: string[]) => v.join('\n')
const unlines = (v: string) =>
  v
    .split('\n')
    .map((x) => x.trim())
    .filter(Boolean)

function Section({
  title,
  description,
  children,
  action,
}: {
  title: string
  description?: React.ReactNode
  children: React.ReactNode
  action?: React.ReactNode
}) {
  return (
    <Panel className="flex flex-col gap-3.5 p-4">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <Display>{title}</Display>
        {action && (
          <>
            <span className="grow" />
            {action}
          </>
        )}
        {description && (
          <p className="m-0 w-full text-[12.5px] leading-relaxed text-pretty text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      {children}
    </Panel>
  )
}

function Field({
  label,
  hint,
  htmlFor,
  children,
  className,
}: {
  label: string
  hint?: React.ReactNode
  htmlFor?: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={className ? `space-y-1.5 ${className}` : 'space-y-1.5'}>
      <Label htmlFor={htmlFor}>
        <Eyebrow>{label}</Eyebrow>
      </Label>
      {children}
      {hint && <p className="m-0 text-[11.5px] leading-relaxed text-muted-foreground">{hint}</p>}
    </div>
  )
}

/**
 * Everything one field's label is read by, worked out from the declaration.
 *
 * Derived rather than described: a key added to the webhook this afternoon
 * shows up here without anyone remembering to mention it.
 */
function touches(
  field: FieldDef,
  profile: EditableProfile,
  fields: FieldDef[],
  labels: EmailLabels,
  routingField: string | undefined,
  crm: string
): string[] {
  const out: string[] = []

  if (field.hidden) out.push('neither email — collected only')
  else if (field.headline) out.push('the new-lead email heading')
  else if (field.audience === 'admin') out.push('the new-lead email')
  else out.push('both emails')

  if (labels.subjectTemplate?.includes(`{${field.id}}`)) out.push('the subject line')
  if (labels.adminSubjectPrefix?.includes(`{${field.id}}`)) out.push('the new-lead subject')

  for (const key of profile.webhookKeys) {
    if (key.mode === 'field' && key.from === field.id) out.push(`${key.key} → ${crm}`)
  }

  if (routingField === field.id) out.push('which profile takes the lead')

  if (field.showWhen) {
    const [[on, expected] = ['', '']] = Object.entries(field.showWhen)
    const name = fields.find((f) => f.id === on)?.label ?? on
    const values = Array.isArray(expected) ? expected.join(' or ') : expected
    out.push(`asked only when ${name} is ${values}`)
  }

  return out
}

export function Editor({
  profile,
  fields,
  fieldLabels,
  labels,
  section,
  onSection,
  onProfile,
  onFieldLabels,
  onLabels,
}: {
  profile: EditableProfile
  /** What the form collects. Structure is read-only here; labels are copy. */
  fields: FieldDef[]
  fieldLabels: Record<string, string>
  labels: EmailLabels
  /** Which section is open, so the rail can point straight at one. */
  section: EditorSection
  onSection: (next: EditorSection) => void
  onProfile: (next: EditableProfile) => void
  onFieldLabels: (next: Record<string, string>) => void
  onLabels: (next: EmailLabels) => void
}) {
  const { crm, single, routing } = boot()
  const set = (patch: Partial<EditableProfile>) => onProfile({ ...profile, ...patch })
  const choices = fields.filter((f) => f.type === 'choice' && (f.options?.length ?? 0) > 0)
  const [open, setOpen] = React.useState<string | null>(null)

  /** A [data-copy-key] edited in the preview maps back to one config field. */
  const applyCopy = (key: string, template: string) => {
    if (key === 'responsePromise') return set({ emailResponsePromise: template })
    if (key.startsWith('fields.')) {
      return onFieldLabels({ ...fieldLabels, [key.slice(7)]: template })
    }
    if (key.startsWith('pricing.')) {
      return onLabels({
        ...labels,
        pricing: { ...(labels.pricing ?? {}), [key.slice(8)]: template },
      })
    }
    const [group, field] = key.split('.')
    if (group === 'client') return set({ clientCopy: { ...profile.clientCopy, [field]: template } })
    if (group === 'admin') return set({ adminCopy: { ...profile.adminCopy, [field]: template } })
  }

  return (
    <Tabs
      value={section}
      onValueChange={(v) => onSection(v as EditorSection)}
      className="gap-4"
    >
      <TabsList>
        <TabsTrigger value="fields">Fields</TabsTrigger>
        <TabsTrigger value="envelopes">Envelopes</TabsTrigger>
        <TabsTrigger value="copy">Email copy</TabsTrigger>
        <TabsTrigger value="webhook">Webhook keys</TabsTrigger>
        <TabsTrigger value="subject">Subject line</TabsTrigger>
      </TabsList>

      <TabsContent value="fields" className="flex flex-col gap-4">
        <Section
          title="What the form asks"
          description={
            <>
              The words beside each question, and the left-hand column of the details block in
              both emails. What the form <em>collects</em> is structure and stays a code edit —
              these are the words.
            </>
          }
          action={
            <span className="text-[12.5px] text-muted-foreground">
              {fields.length} {fields.length === 1 ? 'field' : 'fields'}
              {!single && ' · labels are shared by every profile'}
            </span>
          }
        >
          <div className="grid max-w-4xl grid-cols-[minmax(7rem,10rem)_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2">
            <Eyebrow className="text-[9.5px]">Id in the config</Eyebrow>
            <Eyebrow className="text-[9.5px]">Label the visitor reads</Eyebrow>
            <Eyebrow className="text-[9.5px]">Type</Eyebrow>

            {fields.map((field) => (
              <React.Fragment key={field.id}>
                <Mono className="truncate text-[12px]">{field.id}</Mono>
                <Input
                  aria-label={`Label for ${field.id}`}
                  value={fieldLabels[field.id] ?? field.label}
                  onFocus={() => setOpen(field.id)}
                  onChange={(e) => onFieldLabels({ ...fieldLabels, [field.id]: e.target.value })}
                  className="h-9"
                />
                <Mono className="justify-self-start rounded-sm bg-muted px-1.5 py-0.5 text-[10.5px] text-muted-foreground">
                  {field.derived ? 'derived' : field.type}
                </Mono>

                {open === field.id && (
                  <div className="col-span-full flex flex-wrap items-center gap-2 rounded-lg border border-primary/25 bg-primary/8 px-3 py-2.5">
                    <Eyebrow className="text-primary">This label is read by</Eyebrow>
                    {touches(field, profile, fields, labels, routing.field, crm).map((what) => (
                      <span
                        key={what}
                        className="rounded-md bg-muted px-2 py-1 text-[11.5px] text-foreground"
                      >
                        {what}
                      </span>
                    ))}
                    <span className="grow" />
                    <span className="text-[11.5px] text-muted-foreground">
                      The id never changes — only what the visitor reads.
                    </span>
                  </div>
                )}
              </React.Fragment>
            ))}
          </div>
        </Section>

        {choices.length > 0 && (
          <Section
            title="What this profile offers"
            description="Tick what this one actually handles. Everything ticked appears in the form; a field with nothing ticked offers all of its options."
          >
            <div className="flex flex-col gap-4">
              {choices.map((field) => {
                const chosen = profile.fieldOptions[field.id] ?? []
                return (
                  <div key={field.id} className="space-y-2">
                    <p className="m-0 text-sm font-medium">
                      {fieldLabels[field.id] ?? field.label}
                    </p>
                    <div className="flex flex-wrap gap-5">
                      {(field.options ?? []).map((option) => (
                        <div key={option.value} className="flex items-center gap-2">
                          <Checkbox
                            id={`opt-${field.id}-${option.value}`}
                            checked={chosen.includes(option.value)}
                            onCheckedChange={(v) =>
                              set({
                                fieldOptions: {
                                  ...profile.fieldOptions,
                                  [field.id]:
                                    v === true
                                      ? [...chosen, option.value]
                                      : chosen.filter((o) => o !== option.value),
                                },
                              })
                            }
                          />
                          <Label htmlFor={`opt-${field.id}-${option.value}`}>{option.label}</Label>
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          </Section>
        )}
      </TabsContent>

      <TabsContent value="envelopes" className="flex flex-col gap-4">
        <Envelope
          title="Who the confirmation comes from"
          description="The From domain must be verified in the sending account, or the message is rejected outright and the customer hears nothing."
          value={profile.clientEmail}
          onChange={(clientEmail) => set({ clientEmail })}
          idPrefix="client"
        />
        <Envelope
          title="Who is told about a new lead"
          description="Everyone listed is on the To line. Leave it empty and nobody is notified — the customer still gets their confirmation, so it fails quietly."
          value={profile.adminEmail}
          onChange={(adminEmail) => set({ adminEmail })}
          idPrefix="admin"
        />
      </TabsContent>

      <TabsContent value="copy" className="flex flex-col gap-4">
        <Section
          title="The client confirmation"
          description="The real email, rendered by the same template the site sends. Edit it where you read it."
        >
          <MailPreview
            slug={profile.slug}
            kind="client"
            dateFormat={labels.dateFormat}
            onCopyChange={applyCopy}
            onDateFormatChange={(dateFormat) => onLabels({ ...labels, dateFormat })}
          />
        </Section>

        <Section title="The new-lead notification">
          <MailPreview
            slug={profile.slug}
            kind="admin"
            dateFormat={labels.dateFormat}
            onCopyChange={applyCopy}
            onDateFormatChange={(dateFormat) => onLabels({ ...labels, dateFormat })}
          />
        </Section>

        {Object.keys(labels.pricing ?? {}).length > 0 && (
          <Section
            title="Pricing wording"
            description={
              <>
                {single
                  ? 'Shared with every email this site sends.'
                  : 'Shared by every profile — editing here changes the others too.'}{' '}
                <Mono className="rounded-sm bg-muted px-1 py-0.5">{'{amount}'}</Mono>,{' '}
                <Mono className="rounded-sm bg-muted px-1 py-0.5">{'{monthly}'}</Mono> and{' '}
                <Mono className="rounded-sm bg-muted px-1 py-0.5">{'{firstMonth}'}</Mono> are
                filled in from the live quote.
              </>
            }
          >
            <div className="grid gap-4 sm:grid-cols-2">
              {Object.entries(labels.pricing ?? {}).map(([key, value]) => (
                <Field key={key} label={key} htmlFor={`pricing-${key}`}>
                  <Input
                    id={`pricing-${key}`}
                    value={value}
                    onChange={(e) =>
                      onLabels({
                        ...labels,
                        pricing: { ...(labels.pricing ?? {}), [key]: e.target.value },
                      })
                    }
                  />
                </Field>
              ))}
            </div>
          </Section>
        )}

        <Section title="This profile">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Subject-line brand"
              htmlFor="emailBrand"
              hint={
                <>
                  Fills <Mono className="rounded-sm bg-muted px-1">{'{brand}'}</Mono> in the
                  subject line.
                </>
              }
            >
              <Input
                id="emailBrand"
                value={profile.emailBrand}
                onChange={(e) => set({ emailBrand: e.target.value })}
              />
            </Field>
            <Field label="Phone shown to the client" htmlFor="phoneNumber">
              <Input
                id="phoneNumber"
                value={profile.phoneNumber}
                onChange={(e) => set({ phoneNumber: e.target.value })}
              />
            </Field>
            <Field
              label="Footer lines"
              htmlFor="footer"
              className="sm:col-span-2"
              hint="One per line, under the card. A street address belongs here once there is one."
            >
              <Textarea
                id="footer"
                rows={3}
                value={lines(profile.emailFooterLines)}
                onChange={(e) => set({ emailFooterLines: unlines(e.target.value) })}
              />
            </Field>
          </div>
        </Section>
      </TabsContent>

      <TabsContent value="webhook" className="flex flex-col gap-4">
        <Section
          title={`Where the lead is filed`}
          description={`The URL and its keys change together or not at all — a correct payload sent to the wrong webhook is accepted and dropped.`}
        >
          <Field label="Endpoint" htmlFor="webhookUrl">
            <Input
              id="webhookUrl"
              value={profile.webhookUrl}
              onChange={(e) => set({ webhookUrl: e.target.value })}
              className="font-mono text-xs"
            />
          </Field>
        </Section>

        <WiringBoard
          keys={profile.webhookKeys}
          fields={fields}
          onChange={(webhookKeys) => set({ webhookKeys })}
        />
      </TabsContent>

      <TabsContent value="subject" className="flex flex-col gap-4">
        <Section
          title="The one line every email shares"
          description={
            <>
              Shared by every email this site sends.{' '}
              <Mono className="rounded-sm bg-muted px-1 py-0.5">{'{brand}'}</Mono> is the
              subject-line brand; any field id is filled in from the submission.
            </>
          }
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Template" htmlFor="subjectTemplate">
              <Input
                id="subjectTemplate"
                value={labels.subjectTemplate}
                onChange={(e) => onLabels({ ...labels, subjectTemplate: e.target.value })}
                className="font-mono text-xs"
              />
            </Field>
            {labels.adminSubjectPrefix != null && (
              <Field
                label="Internal copy's prefix"
                htmlFor="adminSubjectPrefix"
                hint="Put in front of the same subject on the new-lead notification, so it sorts apart in an inbox."
              >
                <Input
                  id="adminSubjectPrefix"
                  value={labels.adminSubjectPrefix}
                  onChange={(e) => onLabels({ ...labels, adminSubjectPrefix: e.target.value })}
                />
              </Field>
            )}
          </div>
        </Section>
      </TabsContent>
    </Tabs>
  )
}

function Envelope({
  title,
  description,
  value,
  onChange,
  idPrefix,
}: {
  title: string
  description: string
  value: EditableEnvelope
  onChange: (next: EditableEnvelope) => void
  idPrefix: string
}) {
  return (
    <Section title={title} description={description}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="From name" htmlFor={`${idPrefix}-fromName`}>
          <Input
            id={`${idPrefix}-fromName`}
            value={value.fromName}
            onChange={(e) => onChange({ ...value, fromName: e.target.value })}
          />
        </Field>
        <Field label="From address" htmlFor={`${idPrefix}-fromAddress`}>
          <Input
            id={`${idPrefix}-fromAddress`}
            value={value.fromAddress}
            onChange={(e) => onChange({ ...value, fromAddress: e.target.value })}
            className="font-mono text-xs"
          />
        </Field>
        <Field
          label="To"
          htmlFor={`${idPrefix}-to`}
          hint={
            <>
              One per line. <Mono className="rounded-sm bg-muted px-1">{'{{lead.email}}'}</Mono> is
              whoever submitted the form.
            </>
          }
        >
          <Textarea
            id={`${idPrefix}-to`}
            rows={3}
            value={lines(value.to)}
            onChange={(e) => onChange({ ...value, to: unlines(e.target.value) })}
            className="font-mono text-xs"
          />
        </Field>
        <Field
          label="Cc"
          htmlFor={`${idPrefix}-cc`}
          hint="Visible to everyone on the message."
        >
          <Textarea
            id={`${idPrefix}-cc`}
            rows={3}
            value={lines(value.ccs)}
            onChange={(e) => onChange({ ...value, ccs: unlines(e.target.value) })}
            className="font-mono text-xs"
          />
        </Field>
      </div>
    </Section>
  )
}
