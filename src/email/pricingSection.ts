import { COLORS, esc, eyebrow, money } from './shell.ts'
import type { EmailLabels } from '../types.ts'

/** Fills {amount}/{monthly}/{firstMonth}, marking each one for the editor. */
function fill(
  template: string,
  vars: Record<string, string>,
  mark: boolean
): string {
  return template.replace(/\{(\w+)\}/g, (whole, key: string) => {
    const value = vars[key]
    if (value == null) return whole
    return mark
      ? `<span data-var="${key}" contenteditable="false">${esc(value)}</span>`
      : esc(value)
  })
}

const label = (key: string, html: string, mark: boolean) =>
  mark ? `<span data-copy-key="${key}" data-shared="1">${html}</span>` : html

export interface EmailTransitFee {
  name: string
  /** Cents, already multiplied out for the quote's quantity. */
  amount: number
  startingAt: boolean
  excludedFromTotal: boolean
}

export interface EmailPricing {
  /** What is being priced, as the pricing back end names it. */
  productName: string
  /**
   * Cents billed every month from the second month on — the undiscounted rate
   * whenever a promo applies, for a back end whose discounts run for the first
   * month only.
   */
  monthly: number
  /** Cents billed for the first month; null when nothing is discounted. */
  firstMonth: number | null
  /** The back end's own label for the promo, next to the first-month price. */
  discountLabel: string | null
  /** Its wording for the up-front figure, e.g. "Total Due at Delivery". */
  dueLabel: string
  dueBeforeDelivery: number
  /** Cents in fees excluded from the total and billed separately. */
  totalFeesSeparate: number
  transit: EmailTransitFee[]
}

function lineRow(
  labelHtml: string,
  valueHtml: string,
  noteHtml?: string
): string {
  return `
              <tr>
                <td style="padding:11px 0;border-bottom:1px solid ${COLORS.dividerSoft};font-size:14px;color:${COLORS.muted};">${labelHtml}${
                  noteHtml
                    ? `<span style="display:block;font-size:12px;color:${COLORS.faint};">${noteHtml}</span>`
                    : ''
                }</td>
                <td style="padding:11px 0;border-bottom:1px solid ${COLORS.dividerSoft};text-align:right;font-size:14px;font-weight:600;color:${COLORS.ink};">${valueHtml}</td>
              </tr>`
}

/**
 * Shared by the admin and client quote emails — mirrors the "due before
 * delivery / then $X per month" breakdown on /quote-thank-you.
 *
 * Renders nothing when pricing is null, so a failed pricing lookup still sends
 * an email with the request details rather than an empty or $0 pricing block.
 * A plausible-looking wrong number in a customer's inbox is worse than none:
 * the coordinator confirms the figure by phone either way.
 */
export function renderPricingSection(
  pricing: EmailPricing | null,
  labels: EmailLabels['pricing'],
  mark = false
): string {
  // No figures, or a site that prices nothing and so declares no wording for
  // it: either way there is no block, rather than an empty one.
  if (!pricing || !labels) return ''
  const L = (key: keyof NonNullable<EmailLabels['pricing']>, vars: Record<string, string> = {}) =>
    label(`pricing.${key}`, fill(labels[key], vars, mark), mark)

  // The discount is a first-month promotion, so the email spells both figures
  // out: what they pay now, and what recurs afterwards. Without the second row
  // the discounted price reads as the ongoing rate.
  const discounted =
    pricing.firstMonth != null && pricing.firstMonth < pricing.monthly

  const monthlyRows = discounted
    ? lineRow(
        L('firstMonthLabel'),
        `<span style="color:${COLORS.faint};font-weight:600;text-decoration:line-through;">${money(
          pricing.monthly
        )}</span> ${money(pricing.firstMonth as number)}${
          pricing.discountLabel
            ? `<span style="display:block;font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:${COLORS.gold};">${esc(pricing.discountLabel)}</span>`
            : ''
        }`
      ) +
      lineRow(
        L('monthlyAfterLabel'),
        `${money(pricing.monthly)}/mo`,
        L('monthlyAfterNote')
      )
    : lineRow(L('monthlyLabel'), `${money(pricing.monthly)}/mo`)

  // A fee's own name is the back end's, so it is injected rather than editable.
  const feeRows = pricing.transit
    .map((f) =>
      lineRow(
        mark ? `<span data-var="feeName" contenteditable="false">${esc(f.name)}</span>` : esc(f.name),
        f.startingAt
          ? L('startingAt', { amount: money(f.amount) })
          : money(f.amount)
      )
    )
    .join('')

  // Every email that shows pricing states the ongoing rate under the total, in
  // one sentence — discounted or not. It used to be spelled twice, inline beside
  // the total and again underneath, which read as two different numbers at a
  // glance. A discounted quote says it the longer way, because two figures are
  // in play and the cheaper one is the temporary one.
  const afterFirstMonth = discounted
    ? L('discountExplainer', {
        firstMonth: money(pricing.firstMonth as number),
        monthly: money(pricing.monthly),
      })
    : L('afterFirstMonth', { monthly: money(pricing.monthly) })

  return `
        <tr>
          <td style="background-color:${COLORS.card};padding:32px 40px 8px;">
            ${eyebrow(L('title'), true)}
            <p style="margin:0 0 16px;font-size:15px;font-weight:700;color:${COLORS.ink};">${esc(pricing.productName)}</p>
            <table width="100%" cellpadding="0" cellspacing="0" border="0">${monthlyRows}${feeRows}
            </table>
            ${
              pricing.totalFeesSeparate > 0
                ? `<p style="margin:12px 0 0;font-size:12px;line-height:1.5;color:${COLORS.faint};">${L('feesSeparate', { amount: money(pricing.totalFeesSeparate) })}</p>`
                : ''
            }
          </td>
        </tr>
        <tr>
          <td style="background-color:${COLORS.card};padding:24px 40px 0;">
            <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${COLORS.cream};border:1px solid ${COLORS.creamBorder};border-radius:14px;">
              <tr>
                <td style="padding:20px 24px;">
                  <p style="margin:0 0 6px;font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:${COLORS.gold};">${
                    mark ? `<span data-var="dueLabel" contenteditable="false">${esc(pricing.dueLabel)}</span>` : esc(pricing.dueLabel)
                  } ${L('dueSuffix')}</p>
                  <p style="margin:0;font-size:30px;font-weight:800;letter-spacing:-0.5px;color:${COLORS.ink};">${money(pricing.dueBeforeDelivery)}</p>
                  <p style="margin:8px 0 0;font-size:14px;font-weight:600;line-height:1.5;color:#4B5563;">${afterFirstMonth}</p>
                </td>
              </tr>
            </table>
          </td>
        </tr>`
}
