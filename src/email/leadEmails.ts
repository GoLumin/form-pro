// Both messages one submission sends: the confirmation to whoever filled the
// form in, and the new-lead notification to whoever has to act on it.
//
// Neither template knows what the form asks. The detail rows are the site's
// FIELDS rendered in declared order — label from the field, value from the
// lead, formatting from the field's type — so a site that adds a question gets
// it in both emails without touching this file.

import type { ResolvedEnvelope } from '../config.ts'
import { renderTemplate, templateVars } from '../config.ts'
import { isVisible, optionLabel, type FieldDef, type Lead } from '../fields.ts'
import type { MailSender } from './send.ts'
import {
  buttons,
  COLORS,
  formatEmailDate,
  detailsBlock,
  esc,
  footnote,
  paragraph,
  row,
  telHref,
  emailShell,
} from './shell.ts'
import { renderPricingSection, type EmailPricing } from './pricingSection.ts'
import type { EmailLabels, Profile } from '../types.ts'

/**
 * Fills {placeholders} in a copy string.
 *
 * `mark` wraps each one so the editor's preview can show it as a chip and read
 * the template back out of the rendered HTML. Production never passes it, so a
 * sent email carries no extra markup.
 */
export function fillCopy(
  template: string,
  vars: Record<string, string>,
  mark = false
): string {
  return template.replace(/\{(\w+)\}/g, (whole, key: string) => {
    const value = vars[key]
    if (value == null) return whole
    return mark
      ? `<span data-var="${key}" contenteditable="false">${esc(value)}</span>`
      : esc(value)
  })
}

/** Wraps one editable string so the preview can make it click-to-edit. */
const editable = (key: string, html: string, on: boolean) =>
  on ? `<span data-copy-key="${key}">${html}</span>` : html

export interface LeadEmailInput {
  /**
   * Who each message comes from and goes to, already resolved for this
   * submission. Both come from the profile's entry in the site's config —
   * nothing in this file decides an address.
   */
  clientEmail: ResolvedEnvelope
  adminEmail: ResolvedEnvelope
  emailSubject: string
  /** Presentation, straight off the same config entry. */
  profile: Pick<
    Profile,
    | 'emailBrand'
    | 'name'
    | 'phoneNumber'
    | 'emailResponsePromise'
    | 'emailFooterLines'
    | 'clientCopy'
    | 'adminCopy'
  >
  /** What the form collects, and what this submission gave. */
  fields: readonly FieldDef[]
  lead: Lead
  /** Shared wording; see EMAIL_LABELS in the site's config. */
  labels: EmailLabels
  /** Preview only: tag the editable strings and placeholders in the output. */
  markEditable?: boolean
  /**
   * Figures to show, for a site whose quoting integration produced some. Null
   * on every site that prices nothing, which makes the block disappear rather
   * than print zeroes.
   */
  pricing?: EmailPricing | null
  logoUrl: string
}

/** The lead's own address, for the To line and the reply button. */
function leadEmailAddress(fields: readonly FieldDef[], lead: Lead): string {
  const field = fields.find((f) => f.type === 'email')
  return field ? (lead[field.id] ?? '') : ''
}

/** The lead's phone, for the call button. */
function leadPhone(fields: readonly FieldDef[], lead: Lead): string {
  const field = fields.find((f) => f.type === 'phone')
  return field ? (lead[field.id] ?? '') : ''
}

/**
 * The details every version of these emails lists back.
 *
 * The labels are the fields' own and shared across profiles; the values beside
 * them are the submission itself, so they are injected and never editable. A
 * field with no value is left out entirely rather than printed blank — an empty
 * row tells the reader nothing and makes the message look broken.
 */
function detailRows(
  input: LeadEmailInput,
  audience: 'client' | 'admin'
): string {
  const mark = Boolean(input.markEditable)
  const L = (field: FieldDef) =>
    mark
      ? `<span data-copy-key="fields.${field.id}" data-shared="1">${esc(field.label)}</span>`
      : esc(field.label)
  const V = (value: string) =>
    mark ? `<span data-var="value" contenteditable="false">${esc(value)}</span>` : esc(value)

  const out: string[] = []
  for (const field of input.fields) {
    if (field.hidden) continue
    if (audience === 'client' && field.audience === 'admin') continue
    if (!isVisible(field, input.lead)) continue

    const raw = input.lead[field.id] ?? ''
    if (!raw) continue

    let valueHtml: string
    if (field.type === 'email') {
      valueHtml = `<a href="mailto:${esc(raw)}" style="color:${COLORS.crimson};text-decoration:none;">${V(raw)}</a>`
    } else if (field.type === 'phone') {
      valueHtml = `<a href="${telHref(raw)}" style="color:${COLORS.crimson};text-decoration:none;">${V(raw)}</a>`
    } else if (field.type === 'date') {
      // The date is injected, but how it reads is a choice — so the preview
      // makes this one chip open a format picker rather than nothing.
      const shown = formatEmailDate(raw, input.labels.dateFormat)
      valueHtml = mark
        ? `<span data-var="value" data-date="1" contenteditable="false" title="Click to change the date format">${esc(shown)}</span>`
        : esc(shown)
    } else {
      valueHtml = V(optionLabel(field, raw))
    }

    out.push(row(L(field), valueHtml, undefined, true))
  }
  return out.join('')
}

/**
 * Builds both emails. Pure — renders HTML and sends nothing, so the output can
 * be inspected directly (and is, by the console's preview).
 */
export const renderLeadEmails = (input: LeadEmailInput) => {
  const { profile } = input
  const mark = Boolean(input.markEditable)
  const pricing = input.pricing ?? null
  const pricingHtml = renderPricingSection(pricing, input.labels.pricing, mark)
  const vars = templateVars(profile, input.fields, input.lead)
  const copy = (
    key: string,
    template: string,
    scope: 'client' | 'admin' = 'client'
  ) => editable(`${scope}.${key}`, fillCopy(template, vars, mark), mark)

  const email = leadEmailAddress(input.fields, input.lead)
  const phone = leadPhone(input.fields, input.lead)
  // The headline of the internal email is whoever sent it, when the form asks
  // at all; a form that collects no name falls back to the subject, which at
  // least says what came in.
  const who =
    input.fields.find((f) => f.derive || /name/i.test(f.id))?.id ?? ''
  const heading = (who && input.lead[who]) || input.emailSubject

  const clientHtml = emailShell({
    brand: profile.emailBrand,
    heading: copy('heading', profile.clientCopy.heading),
    subheading: editable('responsePromise', esc(profile.emailResponsePromise), mark),
    logoUrl: input.logoUrl,
    title: input.emailSubject,
    footerLines: profile.emailFooterLines,
    rawHeadings: true,
    bodyHtml: [
      paragraph(copy('greeting', profile.clientCopy.greeting), 28, true),
      detailsBlock(
        copy('requestTitle', profile.clientCopy.requestTitle),
        detailRows(input, 'client'),
        true
      ),
      pricingHtml,
      pricing ? footnote(copy('pricingNote', profile.clientCopy.pricingNote), true) : '',
      paragraph(copy('bookingNote', profile.clientCopy.bookingNote), 26, true),
      buttons([
        {
          label: copy('ctaLabel', profile.clientCopy.ctaLabel),
          href: telHref(profile.phoneNumber),
          raw: true,
        },
      ]),
    ].join(''),
  })

  const adminCopy = (key: string, template: string) =>
    editable(`admin.${key}`, fillCopy(template, vars, mark), mark)

  const adminHtml = emailShell({
    brand: adminCopy('heading', profile.adminCopy.heading),
    heading,
    rawHeadings: true,
    subheading: adminCopy('subheading', profile.adminCopy.subheading),
    logoUrl: input.logoUrl,
    title: `${input.labels.adminSubjectPrefix ?? ''}${input.emailSubject}`,
    footerLines: [adminCopy('footer', profile.adminCopy.footer)],
    rawFooter: true,
    bodyHtml: [
      detailsBlock(
        adminCopy('requestTitle', profile.adminCopy.requestTitle),
        detailRows(input, 'admin'),
        true
      ),
      pricingHtml ||
        footnote(adminCopy('noPricingNote', profile.adminCopy.noPricingNote), true),
      buttons([
        ...(email
          ? [
              {
                label: adminCopy('replyLabel', profile.adminCopy.replyLabel),
                href: `mailto:${email}`,
                raw: true,
              },
            ]
          : []),
        ...(phone
          ? [
              {
                label: adminCopy('callLabel', profile.adminCopy.callLabel),
                href: telHref(phone),
                secondary: true,
                raw: true,
              },
            ]
          : []),
      ]),
    ].join(''),
  })

  return { adminHtml, clientHtml, pricing }
}

/** What one send resolved with — in dev, where its preview was written. */
type SendResult = { preview?: { path: string; file: string } } | undefined

/**
 * Sends both emails and reports what each send resolved with, so the console
 * can link straight to the dev previews. In production the results are the
 * transport's and nothing looks at them.
 */
export const sendLeadEmails = async ({
  apiKey,
  send,
  ...input
}: LeadEmailInput & { apiKey?: string; send: MailSender }): Promise<{
  admin: SendResult
  client: SendResult
}> => {
  const { adminHtml, clientHtml } = renderLeadEmails(input)
  let admin: SendResult
  let client: SendResult

  // A profile with no admin recipients configured simply gets no notification;
  // the client's own confirmation still goes out.
  if (input.adminEmail.to.length > 0) {
    admin = (await send({
      from: input.adminEmail.from,
      apiKey,
      to: input.adminEmail.to,
      cc: input.adminEmail.cc,
      subject: `${input.labels.adminSubjectPrefix ?? ''}${input.emailSubject}`,
      html: adminHtml,
    })) as SendResult
  }

  if (input.clientEmail.to.length > 0) {
    client = (await send({
      from: input.clientEmail.from,
      apiKey,
      to: input.clientEmail.to,
      cc: input.clientEmail.cc,
      subject: input.emailSubject,
      html: clientHtml,
    })) as SendResult
  }

  return { admin, client }
}

export { renderTemplate }
