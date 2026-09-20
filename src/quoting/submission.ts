// The quoting adapter: everything that happens between a submission and a
// price, for the sites that have a pricing back end at all.
//
// Nothing in the core path imports this. A site declares QUOTING in its config
// — which field carries the ZIP, which one decides the service — and that is
// the whole join between what the form asks and what gofuse is told. The core
// knows there may be figures; only this file knows where they come from.

import { createQuote, enabled, getConfig, previewQuote } from 'virtual:form-pro/quoting'
import { formatDateAs } from '../dateFormats.ts'
import type { FieldDef, Lead } from '../fields.ts'
import { fieldById, optionsFor } from '../fields.ts'
import type { Profile, QuotingConfig } from '../types.ts'
import { containerSizeLabel, selectProductForSize, type SelectedProduct } from './catalog.ts'
import { toEmailPricing } from './emailPricing.ts'
import type { EmailPricing } from '../email/pricingSection.ts'

/** Whether this site wired a pricing back end in at all. */
export const quotingEnabled = (): boolean => Boolean(enabled)

/** Per-profile instance, or nothing when the site has just the one. */
function overridesFor(profile: Profile) {
  return profile.quoting?.baseUrl
    ? { baseUrl: profile.quoting.baseUrl, token: profile.quoting.token }
    : undefined
}

const at = (lead: Lead, id: string | undefined): string =>
  id ? (lead[id] ?? '') : ''

export interface PricedSubmission {
  pricing: EmailPricing | null
  /** The catalog's own name for what was picked, for the email's fallback. */
  productName: string | null
  quoteId: string | null
  thankYouUrl: string
  /** Everything that went wrong, reported rather than thrown. */
  notes: string[]
}

/**
 * Prices one submission and, when asked, persists the quote.
 *
 * Every call is individually guarded: a back end that is down costs the
 * submission its pricing block, not the lead. The emails still render and the
 * CRM still hears about it, which is the outcome worth protecting.
 */
export async function priceSubmission({
  profile,
  fields,
  lead,
  config,
  persist = true,
}: {
  profile: Profile
  fields: readonly FieldDef[]
  lead: Lead
  config: QuotingConfig
  /** Create a stored quote, as a visitor's submission would. */
  persist?: boolean
}): Promise<PricedSubmission> {
  const notes: string[] = []
  const overrides = overridesFor(profile)
  const serviceType = config.serviceType(lead)
  const productType = config.productType
  const zip = at(lead, config.from.zip)
  const destinationZip = at(lead, config.from.destinationZip)
  const size = at(lead, config.from.size)

  let selected: SelectedProduct | null = null
  let totalLabel: string | null = null
  let quote: any = null
  let quoteId: string | null = null

  try {
    const catalog = await getConfig({ zip_code: zip }, overrides)
    totalLabel = catalog?.settings?.total_price_label?.trim() || null
    selected = selectProductForSize({
      products: catalog?.products ?? [],
      serviceType,
      productType: productType ?? '',
      containerSize: size,
    })
  } catch (error) {
    notes.push(`getConfig failed: ${String(error)}`)
  }

  try {
    quote = await previewQuote(
      {
        service_type: serviceType,
        ...(productType ? { product_type: productType } : {}),
        zip_code: zip,
        ...(destinationZip ? { destination_zip_code: destinationZip } : {}),
        ...(selected ? { quantities: { [selected.id]: 1 } } : {}),
      },
      overrides
    )
  } catch (error) {
    notes.push(`previewQuote failed: ${String(error)}`)
  }

  // The date the API wants is yyyy-mm-dd; the lead holds mm/dd/yyyy.
  const isoDate = formatDateAs(at(lead, config.from.date), 'yyyy-mm-dd')

  if (persist) {
    try {
      const created = await createQuote(
        {
          service_type: serviceType,
          ...(productType ? { product_type: productType } : {}),
          zip_code: zip,
          destination_zip_code: destinationZip,
          full_name: at(lead, config.from.name),
          email: at(lead, config.from.email),
          phone: at(lead, config.from.phone),
          delivery_date: isoDate,
          idempotency_key: crypto.randomUUID(),
          ...(selected ? { quantities: { [selected.id]: 1 } } : {}),
        },
        overrides
      )
      quoteId = created?.uuid ?? created?.id ?? null
    } catch (error) {
      notes.push(`createQuote failed: ${String(error)}`)
    }
  }

  const pricing = toEmailPricing(
    {
      products: quote?.products ?? [],
      fees: quote?.fees ?? [],
      subtotal: quote?.subtotal ?? null,
      total: quote?.total ?? null,
      totalLabel,
      discountLabel: selected?.discountLabel ?? null,
    },
    size || 'Your order'
  )

  // A site with one instance has one thank-you page; a site with several gives
  // each its own, so the page reads the quote back from the right instance.
  const base = config.thankYouPath ?? '/quote-thank-you'
  const path = profile.quoting?.baseUrl ? `${base}/${profile.slug}` : base
  const params = new URLSearchParams({
    zip_code: zip,
    destination_zip_code: destinationZip,
    service_type: serviceType,
    full_name: at(lead, config.from.name),
    delivery_date: isoDate,
    email: at(lead, config.from.email),
    phone: at(lead, config.from.phone),
    ...(productType ? { product_type: productType } : {}),
    ...(config.from.size ? { container_size: size } : {}),
  })

  return {
    pricing,
    productName: selected?.name ?? null,
    quoteId,
    thankYouUrl: quoteId
      ? `${path}?q=${encodeURIComponent(quoteId)}&${params}`
      : `${path}?${params}`,
    notes,
  }
}

/**
 * The catalog-backed options for one profile, keyed by the value they depend
 * on — every service's sizes in one request, so switching service costs the
 * form no round trip.
 *
 * An empty list is the honest outcome of a failed lookup: without the catalog
 * we do not know what this profile stocks, and guessing would offer something
 * it cannot price.
 */
export async function catalogOptionsFor({
  profile,
  fields,
  lead,
  config,
}: {
  profile: Profile
  fields: readonly FieldDef[]
  lead: Lead
  config: QuotingConfig
}): Promise<Record<string, string[]>> {
  const spec = config.catalogOptions
  if (!spec) return {}
  const dependsOn = fieldById(fields, spec.dependsOn)
  if (!dependsOn) return {}

  const byValue: Record<string, string[]> = {}
  const catalog = await getConfig(
    { zip_code: at(lead, config.from.zip) },
    overridesFor(profile)
  )

  for (const option of optionsFor(dependsOn, profile.fieldOptions?.[dependsOn.id])) {
    const serviceType = config.serviceType({ ...lead, [dependsOn.id]: option.value })
    const sizes = new Set<string>()
    for (const product of catalog?.products ?? []) {
      if (!product.service_types?.includes(serviceType)) continue
      if (
        config.productType &&
        product.product_type &&
        product.product_type !== config.productType
      ) {
        continue
      }
      const label = containerSizeLabel(product)
      if (label) sizes.add(label)
    }
    byValue[option.value] = [...sizes].sort(
      (a, b) => Number.parseInt(a, 10) - Number.parseInt(b, 10)
    )
  }

  return byValue
}
