import type { ResolvedEnvelope } from '../config.ts'
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
  textRow,
  emailShell,
} from './shell.ts'
import { renderPricingSection, type EmailPricing } from './pricingSection.ts'
import type { EmailLabels } from '../types.ts'

interface QuoteProduct {
  name: string
  quantity: number
  subtotal?: number
  discounted_price?: number
  price?: number
  /** Per-unit cents before any discount, as gofuse returns it. */
  original_price?: number
  has_discount?: boolean
  monthly?: boolean
}

interface QuoteFee {
  name: string
  /** Cents. Per unit when `per_quantity` is set, as gofuse returns it. */
  amount: number
  per_quantity?: boolean
  recurring?: boolean
  starting_at?: boolean
  excluded_from_total?: boolean
}

export interface CopyVars {
  firstName?: string
  brand?: string
  phone?: string
  name?: string
  service?: string
  zip?: string
}

/**
 * Fills {placeholders} in a copy string.
 *
 * `mark` wraps each one so the editor's preview can show it as a chip and read
 * the template back out of the rendered HTML. Production never passes it, so a
 * sent email carries no extra markup.
 */
export function fillCopy(
  template: string,
  vars: CopyVars,
  mark = false
): string {
  return template.replace(/\{(\w+)\}/g, (whole, key: string) => {
    const value = (vars as Record<string, string | undefined>)[key]
    if (value == null) return whole
    return mark
      ? `<span data-var="${key}" contenteditable="false">${esc(value)}</span>`
      : esc(value)
  })
}

/** Wraps one editable string so the preview can make it click-to-edit. */
const editable = (key: string, html: string, on: boolean) =>
  on ? `<span data-copy-key="${key}">${html}</span>` : html

export interface QuoteEmailInput {
  /**
   * Who each message comes from and goes to, already resolved for this
   * submission. Both come from the location's entry in the site's config —
   * nothing in this file decides an address.
   */
  clientEmail: ResolvedEnvelope
  adminEmail: ResolvedEnvelope
  emailSubject: string
  /** Market presentation, straight off the same config entry. */
  brand: string
  /** One line under the client email's headline. */
  responsePromise: string
  footerLines: string[]
  companyPhone: string
  /** "Keep It" / "Move It" / "Store It". */
  formTypeName: string
  firstName: string
  fullName: string
  email: string
  phone: string
  initialDeliveryZip: string
  initialDeliveryDate: string
  relocationZip?: string
  /** "indoor" / "outdoor" on a store-it submission. */
  storageType?: string | null
  /**
   * The container the visitor picked, e.g. "20x8" — the same value carried as
   * `container_size` on the thank-you URL. Empty when the form was submitted
   * before a size was chosen.
   */
  containerSize?: string
  /** Per-market wording; see the site's config. */
  clientCopy: {
    heading: string
    greeting: string
    requestTitle: string
    pricingNote: string
    bookingNote: string
    ctaLabel: string
  }
  adminCopy: {
    heading: string
    subheading: string
    requestTitle: string
    noPricingNote: string
    replyLabel: string
    callLabel: string
    footer: string
  }
  /** Shared row and pricing wording; see EMAIL_LABELS in the site's config. */
  labels: EmailLabels
  /** Preview only: tag the editable strings and placeholders in the output. */
  markEditable?: boolean
  quote: {
    products: QuoteProduct[]
    fees: QuoteFee[]
    subtotal?: number | null
    total?: number | null
    /** gofuse's own wording for the up-front figure. */
    totalLabel?: string | null
    /** gofuse's badge for the chosen container's discount, e.g. "$50 OFF". */
    discountLabel?: string | null
  }
  logoUrl: string
}

const sum = (xs: number[]) => xs.reduce((t, x) => t + x, 0)

/**
 * Folds gofuse's quote into the shape the pricing block renders.
 *
 * Returns null when gofuse gave us nothing to show, which is what makes the
 * pricing block disappear rather than print zeroes.
 */
export function toEmailPricing(
  quote: QuoteEmailInput['quote'],
  fallbackProductName: string
): EmailPricing | null {
  const products = quote.products ?? []
  const fees = quote.fees ?? []

  // gofuse stores per_quantity fees per unit and multiplies them by the quote's
  // total quantity, so the same multiplication happens here.
  const totalQuantity = Math.max(1, sum(products.map((p) => p.quantity || 1)))
  const feeAmount = (f: QuoteFee) =>
    f.amount * (f.per_quantity ? totalQuantity : 1)

  // A waiver zeroes a charge rather than adding one; gofuse lists it in its own
  // breakdown but never sums it, and neither does the thank-you page.
  const recurringTotal = sum(
    fees.filter((f) => f.recurring && !/waiver/i.test(f.name)).map(feeAmount)
  )
  const oneTime = fees.filter((f) => !f.recurring)

  // The container is billed monthly, and gofuse's discounts are first-month
  // only, so the two figures are tracked apart: `ongoing` is what recurs,
  // `first` is what this first month actually costs.
  let ongoingContainers = 0
  let firstMonthContainers = 0
  let anyDiscount = false
  for (const p of products) {
    const units = p.quantity || 1
    const charged = p.subtotal ?? (p.discounted_price ?? p.price ?? 0) * units
    const full = p.original_price != null ? p.original_price * units : charged
    anyDiscount ||= full > charged
    ongoingContainers += full > charged ? full : charged
    firstMonthContainers += charged
  }

  const monthly = ongoingContainers + recurringTotal
  const transit = oneTime
    .filter((f) => !f.excluded_from_total)
    .map((f) => ({
      name: f.name,
      amount: feeAmount(f),
      startingAt: Boolean(f.starting_at),
      excludedFromTotal: false,
    }))
  const totalFeesSeparate = sum(
    oneTime.filter((f) => f.excluded_from_total).map(feeAmount)
  )

  const hasAnything =
    products.length > 0 || transit.length > 0 || quote.total != null
  if (!hasAnything) return null

  const primary = products[0]
  const productName = primary
    ? `${primary.name}${(primary.quantity || 1) > 1 ? ` ×${primary.quantity}` : ''}`
    : fallbackProductName

  return {
    productName,
    monthly,
    firstMonth: anyDiscount ? firstMonthContainers + recurringTotal : null,
    discountLabel: quote.discountLabel ?? null,
    dueLabel: quote.totalLabel?.trim() || 'Total Due at Delivery',
    dueBeforeDelivery: quote.total ?? 0,
    totalFeesSeparate,
    transit,
  }
}

/**
 * The details every version of these emails lists back.
 *
 * The labels are editable and shared across markets; the values beside them are
 * the submission itself, so they are injected and never editable.
 */
function requestRows(input: QuoteEmailInput, includeContact: boolean): string {
  const mark = Boolean(input.markEditable)
  const rows = input.labels.rows
  const L = (key: keyof EmailLabels['rows']) =>
    mark
      ? `<span data-copy-key="rows.${key}" data-shared="1">${esc(rows[key])}</span>`
      : esc(rows[key])
  const V = (value: string) =>
    mark ? `<span data-var="value" contenteditable="false">${esc(value)}</span>` : esc(value)
  // The delivery date is injected, but how it reads is a choice — so the
  // preview makes this one chip open a format picker rather than nothing.
  const shownDate = formatEmailDate(input.initialDeliveryDate, input.labels.dateFormat)
  const D = () =>
    mark
      ? `<span data-var="value" data-date="1" contenteditable="false" title="Click to change the date format">${esc(shownDate)}</span>`
      : esc(shownDate)

  const mailto = `<a href="mailto:${esc(input.email)}" style="color:${COLORS.crimson};text-decoration:none;">${V(input.email)}</a>`
  const tel = `<a href="${telHref(input.phone)}" style="color:${COLORS.crimson};text-decoration:none;">${V(input.phone)}</a>`
  return [
    row(L('service'), V(input.formTypeName), undefined, true),
    includeContact ? row(L('name'), V(input.fullName), undefined, true) : '',
    includeContact ? row(L('email'), mailto, undefined, true) : '',
    includeContact ? row(L('phone'), tel, undefined, true) : '',
    row(L('deliveryDate'), D(), undefined, true),
    row(L('deliveryZip'), V(input.initialDeliveryZip), undefined, true),
    input.relocationZip ? row(L('relocationZip'), V(input.relocationZip), undefined, true) : '',
    input.containerSize ? row(L('containerSize'), V(input.containerSize), undefined, true) : '',
    input.storageType ? row(L('storage'), V(input.storageType), undefined, true) : '',
  ].join('')
}

/**
 * Builds both quote emails. Pure — renders HTML and sends nothing, so the
 * output can be inspected directly (and is, by the dev mail preview).
 */
export const renderQuoteEmails = (input: QuoteEmailInput) => {
  const pricing = toEmailPricing(input.quote, input.containerSize || 'Your container')
  const mark = Boolean(input.markEditable)
  const pricingHtml = renderPricingSection(pricing, input.labels.pricing, mark)
  const vars: CopyVars = {
    firstName: input.firstName,
    brand: input.brand,
    phone: input.companyPhone,
    name: input.fullName,
  }
  const copy = (
    key: string,
    template: string,
    scope: 'client' | 'admin' = 'client'
  ) => editable(`${scope}.${key}`, fillCopy(template, vars, mark), mark)

  const clientHtml = emailShell({
    brand: input.brand,
    heading: copy('heading', input.clientCopy.heading),
    subheading: editable('responsePromise', esc(input.responsePromise), mark),
    logoUrl: input.logoUrl,
    title: `Your ${input.formTypeName} quote — ${input.brand}`,
    footerLines: input.footerLines,
    rawHeadings: true,
    bodyHtml: [
      paragraph(copy('greeting', input.clientCopy.greeting), 28, true),
      detailsBlock(
        copy('requestTitle', input.clientCopy.requestTitle),
        requestRows(input, false),
        true
      ),
      pricingHtml,
      pricing ? footnote(copy('pricingNote', input.clientCopy.pricingNote), true) : '',
      paragraph(copy('bookingNote', input.clientCopy.bookingNote), 26, true),
      buttons([
        {
          label: copy('ctaLabel', input.clientCopy.ctaLabel),
          href: telHref(input.companyPhone),
          raw: true,
        },
      ]),
    ].join(''),
  })

  const adminVars: CopyVars = {
    ...vars,
    service: input.formTypeName,
    zip: input.initialDeliveryZip,
  }
  const adminCopy = (key: string, template: string) =>
    editable(`admin.${key}`, fillCopy(template, adminVars, mark), mark)

  const adminHtml = emailShell({
    brand: adminCopy('heading', input.adminCopy.heading),
    heading: input.fullName,
    rawHeadings: true,
    subheading: adminCopy('subheading', input.adminCopy.subheading),
    logoUrl: input.logoUrl,
    title: `New quote: ${input.fullName}`,
    footerLines: [adminCopy('footer', input.adminCopy.footer)],
    rawFooter: true,
    bodyHtml: [
      detailsBlock(
        adminCopy('requestTitle', input.adminCopy.requestTitle),
        requestRows(input, true),
        true
      ),
      pricingHtml ||
        footnote(adminCopy('noPricingNote', input.adminCopy.noPricingNote), true),
      buttons([
        {
          label: adminCopy('replyLabel', input.adminCopy.replyLabel),
          href: `mailto:${input.email}`,
          raw: true,
        },
        {
          label: adminCopy('callLabel', input.adminCopy.callLabel),
          href: telHref(input.phone),
          secondary: true,
          raw: true,
        },
      ]),
    ].join(''),
  })

  return { adminHtml, clientHtml, pricing }
}

/** What one send resolved with — in dev, where its preview was written. */
type SendResult = { preview?: { path: string; file: string } } | undefined

/**
 * Sends both quote emails and reports what each send resolved with, so the
 * form lab can link straight to the dev previews. In production the results
 * are getoutsend's and nothing looks at them.
 */
export const sendQuoteEmail = async ({
  apiKey,
  send,
  ...input
}: QuoteEmailInput & { apiKey?: string; send: MailSender }): Promise<{
  admin: SendResult
  client: SendResult
}> => {
  const { adminHtml, clientHtml } = renderQuoteEmails(input)
  let admin: SendResult
  let client: SendResult

  // A market with no admin recipients configured simply gets no notification;
  // the customer's own confirmation still goes out.
  if (input.adminEmail.to.length > 0) {
    admin = (await send({
      from: input.adminEmail.from,
      apiKey,
      to: input.adminEmail.to,
      cc: input.adminEmail.cc,
      subject: `New Lead: ${input.emailSubject}`,
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
