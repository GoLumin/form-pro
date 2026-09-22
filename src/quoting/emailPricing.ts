// Folding a gofuse quote into the figures the email's pricing block renders.
//
// It lives here rather than beside the template because everything it knows is
// this one back end's: that discounts are first-month only, that a per-quantity
// fee is stored per unit, that a waiver zeroes a charge instead of adding one.
// The template is handed the result and knows none of it.

import type { EmailPricing } from '../email/pricingSection.ts'

export interface QuoteProduct {
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

export interface QuoteFee {
  name: string
  /** Cents. Per unit when `per_quantity` is set, as gofuse returns it. */
  amount: number
  per_quantity?: boolean
  recurring?: boolean
  starting_at?: boolean
  excluded_from_total?: boolean
  /** Excluded from the total but still itemised, as gofuse flags it. */
  excluded_shown?: boolean
}

export interface QuoteFigures {
  products: QuoteProduct[]
  fees: QuoteFee[]
  subtotal?: number | null
  total?: number | null
  /** gofuse's own wording for the up-front figure. */
  totalLabel?: string | null
  /** gofuse's badge for the chosen product's discount, e.g. "$50 OFF". */
  discountLabel?: string | null
}

const sum = (xs: number[]) => xs.reduce((t, x) => t + x, 0)

/**
 * Returns null when the back end gave us nothing to show, which is what makes
 * the pricing block disappear rather than print zeroes.
 */
export function toEmailPricing(
  quote: QuoteFigures,
  fallbackProductName: string
): EmailPricing | null {
  const products = quote.products ?? []
  const fees = quote.fees ?? []

  // gofuse stores per_quantity fees per unit and multiplies them by the quote's
  // total quantity, so the same multiplication happens here.
  const totalQuantity = Math.max(1, sum(products.map((p) => p.quantity || 1)))
  const feeAmount = (f: QuoteFee) => f.amount * (f.per_quantity ? totalQuantity : 1)

  // A waiver zeroes a charge rather than adding one; gofuse lists it in its own
  // breakdown but never sums it, and neither does the thank-you page.
  const recurringTotal = sum(
    fees.filter((f) => f.recurring && !/waiver/i.test(f.name)).map(feeAmount)
  )
  const oneTime = fees.filter((f) => !f.recurring)

  // The product is billed monthly, and the discounts are first-month only, so
  // the two figures are tracked apart: `ongoing` is what recurs, `first` is
  // what this first month actually costs.
  let ongoingProducts = 0
  let firstMonthProducts = 0
  let anyDiscount = false
  for (const p of products) {
    const units = p.quantity || 1
    const charged = p.subtotal ?? (p.discounted_price ?? p.price ?? 0) * units
    const full = p.original_price != null ? p.original_price * units : charged
    anyDiscount ||= full > charged
    ongoingProducts += full > charged ? full : charged
    firstMonthProducts += charged
  }

  const monthly = ongoingProducts + recurringTotal

  // gofuse decides two things about a one-time fee, and they are not the same
  // decision: whether it counts toward the up-front total, and whether it is
  // itemised at all. A storage job's final delivery and pick-up legs are
  // excluded from the total but flagged shown — they are real charges the
  // customer will see, just at a later date — so they belong in the table
  // saying so, not folded into a lump sum with no explanation of what it buys.
  // A fee gofuse excludes AND hides is neither listed nor summed here, because
  // a number with no name beside it is worse than no number at all.
  // `excluded_shown !== false` rather than a plain truth test: a back end that
  // predates the flag sends neither value, and the disclosing reading of
  // silence is the right one for a charge the customer will be billed.
  const shown = oneTime.filter((f) => !f.excluded_from_total || f.excluded_shown !== false)
  const transit = shown.map((f) => ({
    name: f.name,
    amount: feeAmount(f),
    startingAt: Boolean(f.starting_at),
    excludedFromTotal: Boolean(f.excluded_from_total),
  }))
  const totalFeesSeparate = sum(
    shown.filter((f) => f.excluded_from_total).map(feeAmount)
  )

  const hasAnything = products.length > 0 || transit.length > 0 || quote.total != null
  if (!hasAnything) return null

  const primary = products[0]
  const productName = primary
    ? `${primary.name}${(primary.quantity || 1) > 1 ? ` ×${primary.quantity}` : ''}`
    : fallbackProductName

  return {
    productName,
    monthly,
    firstMonth: anyDiscount ? firstMonthProducts + recurringTotal : null,
    discountLabel: quote.discountLabel ?? null,
    dueLabel: quote.totalLabel?.trim() || 'Total Due at Delivery',
    dueBeforeDelivery: quote.total ?? 0,
    totalFeesSeparate,
    transit,
  }
}
