import { getConfig, previewQuote } from 'virtual:form-pro/quoting'
import { EMAIL_LABELS, LOCATIONS, SITE_SETTINGS } from 'virtual:form-pro/config'
import {
  buildWebhookPayload,
  emailSubjectFor,
  resolveEnvelope,
  serviceLabel,
} from './config.ts'
import type { Lead, Location } from './types.ts'
import { resolveQuoteLocation } from './routing.ts'
import { containerSizeLabel } from './catalog.ts'
import { renderQuoteEmails } from './email/quoteEmails.ts'
import type { MailSender } from './email/send.ts'
import { envValue } from './env.ts'

/**
 * A daily submission through each market, so a silent break is found by us
 * rather than by a customer who never hears back.
 *
 * It runs the real path as far as delivery: the quote is really priced, the
 * emails are really rendered and really sent — with the recipients swapped for
 * a monitoring inbox, but the From address and the GetOutsend key left exactly
 * as configured, because that pairing is what fails. A dry run would not have
 * caught the outage this was written after: GetOutsend rejected a From whose
 * domain was not verified in the sending workspace, and nothing short of a real
 * send sees that.
 *
 * The Stella payload is built and checked but deliberately not posted. A junk
 * lead a day in a client's CRM is a cost with little return — Stella answers
 * 200 to a payload it cannot map, so posting proves less than it appears to.
 */

/** Only the fields this check reads, so no site's catalog type is imported. */
interface CatalogProductLike {
  id?: number
  name?: string
  dimensions?: string
  service_types?: string[]
}

export interface Check {
  name: string
  ok: boolean
  detail: string
}

export interface MarketResult {
  slug: string
  market: string
  zip: string
  ok: boolean
  checks: Check[]
}

export interface CanaryReport {
  at: string
  ok: boolean
  sent: boolean
  recipient: string
  markets: MarketResult[]
}

/**
 * Where the probe emails and the digest go. The environment still wins, so a
 * deploy preview can be pointed elsewhere without editing the config.
 */
export function canaryRecipient(): string {
  return envValue('CANARY_EMAIL_TO') || SITE_SETTINGS.canaryEmailTo
}

/** Whether the daily check is switched on at all. */
export function canaryEnabled(): boolean {
  return SITE_SETTINGS.canaryEnabled
}

const pass = (name: string, detail: string): Check => ({ name, ok: true, detail })
const fail = (name: string, detail: string): Check => ({ name, ok: false, detail })

async function checkMarket(
  slug: string,
  location: Location,
  logoUrl: string,
  deliver: boolean,
  send: MailSender
): Promise<MarketResult> {
  const zip = location.canaryZip ?? ''
  const checks: Check[] = []
  // Undefined on a single-tenant site, where the quoting integration already
  // points at the one instance and there is nothing to override.
  const overrides = location.baseUrl
    ? { baseUrl: location.baseUrl, token: location.token }
    : undefined

  if (!zip) {
    return {
      slug,
      market: location.name,
      zip: '',
      ok: false,
      checks: [fail('zip', 'no canaryZip declared for this location, so nothing was submitted')],
    }
  }

  // 1. The ZIP still routes where we expect. Catches a coverage change, or a
  //    market quietly taking over another's territory.
  try {
    const resolved = await resolveQuoteLocation(null, zip)
    checks.push(
      resolved?.slug === slug
        ? pass('routing', `${zip} → ${resolved.name}`)
        : fail('routing', `${zip} resolved to ${resolved?.slug ?? 'no market'}, expected ${slug}`)
    )
  } catch (error) {
    checks.push(fail('routing', String((error as Error).message)))
  }

  // 2. The catalog answers. An expired or missing QUOTING_API_TOKEN shows up
  //    here as an empty size list, which is also an empty dropdown on the form.
  let productId: number | null = null
  try {
    const config = await getConfig({ zip_code: zip }, overrides)
    const products = ((config?.products ?? []) as CatalogProductLike[]).filter((p) =>
      p.service_types?.includes('keep-it')
    )
    const sizes = products.map(containerSizeLabel).filter(Boolean)
    productId = products[0]?.id ?? null
    checks.push(
      sizes.length
        ? pass('catalog', sizes.join(', '))
        : fail('catalog', 'gofuse returned no keep-it products — check this market’s token')
    )
  } catch (error) {
    checks.push(fail('catalog', String((error as Error).message)))
  }

  // 3. Pricing comes back with a number. The thank-you page and the email both
  //    depend on it, and both degrade silently without it.
  let quote: any = null
  try {
    quote = await previewQuote(
      {
        service_type: 'keep-it',
        product_type: 'portable-storage',
        zip_code: zip,
        ...(productId ? { quantities: { [productId]: 1 } } : {}),
      },
      overrides
    )
    checks.push(
      quote?.total != null
        ? pass('pricing', `total ${(quote.total / 100).toFixed(2)}`)
        : fail('pricing', 'previewQuote returned no total')
    )
  } catch (error) {
    checks.push(fail('pricing', String((error as Error).message)))
  }

  // 4. The lead shapes into this market's webhook keys, and nothing required
  //    comes out blank. Catches a key pointed at a field that no longer exists.
  const lead: Lead = {
    firstName: 'Mule Box',
    lastName: 'Monitoring',
    fullName: 'Mule Box Monitoring',
    phone: '(000) 000-0000',
    email: canaryRecipient(),
    deliveryDate: '01/01/2030',
    deliveryZip: zip,
    relocationZip: undefined,
    serviceType: 'keep_it',
    storageType: null,
    containerSize: '16x8',
  }
  const payload = buildWebhookPayload(location.webhook.keys, lead)
  const blank = Object.entries(payload)
    .filter(([key, value]) => {
      if (value !== '') return false
      const spec = location.webhook.keys[key] as { whenEmpty?: string }
      // A key that declares a fallback is allowed to be empty on purpose.
      return spec?.whenEmpty === undefined
    })
    .map(([key]) => key)
  checks.push(
    blank.length === 0
      ? pass('webhook payload', `${Object.keys(payload).length} keys, none unexpectedly blank`)
      : fail('webhook payload', `blank with no fallback: ${blank.join(', ')}`)
  )

  // 5. Both emails render, and the envelope is one a mail server will take.
  const clientEnvelope = resolveEnvelope(location.clientEmail, lead.email)
  const adminEnvelope = resolveEnvelope(location.adminEmail, lead.email)
  const envelopeOk =
    /.+<.+@.+\..+>/.test(clientEnvelope.from) && clientEnvelope.to.length > 0
  checks.push(
    envelopeOk
      ? pass('envelope', clientEnvelope.from)
      : fail('envelope', `unusable From or empty To: ${clientEnvelope.from}`)
  )

  const emailInput = {
    clientEmail: clientEnvelope,
    adminEmail: adminEnvelope,
    email: lead.email,
    emailSubject: emailSubjectFor(location, 'keep_it'),
    brand: location.name,
    responsePromise: location.emailResponsePromise,
    footerLines: location.emailFooterLines,
    clientCopy: location.clientCopy,
    adminCopy: location.adminCopy,
    labels: EMAIL_LABELS,
    formTypeName: serviceLabel('keep_it'),
    firstName: lead.firstName,
    fullName: lead.fullName,
    phone: lead.phone,
    initialDeliveryZip: zip,
    initialDeliveryDate: lead.deliveryDate,
    storageType: null,
    containerSize: lead.containerSize,
    companyPhone: location.phoneNumber,
    quote: {
      products: quote?.products ?? [],
      fees: quote?.fees ?? [],
      subtotal: quote?.subtotal ?? null,
      total: quote?.total ?? null,
      totalLabel: quote?.settings?.total_price_label ?? null,
      discountLabel: null,
    },
    logoUrl,
  }

  let clientHtml = ''
  try {
    const rendered = renderQuoteEmails(emailInput)
    clientHtml = rendered.clientHtml
    checks.push(
      rendered.clientHtml.includes(location.name)
        ? pass('render', `${rendered.clientHtml.length} bytes`)
        : fail('render', 'the market name is missing from the rendered email')
    )
  } catch (error) {
    checks.push(fail('render', String((error as Error).message)))
  }

  // 6. Delivery. The recipients are swapped for the monitoring inbox; the From
  //    and the API key are left exactly as configured, because they are the
  //    pair being tested.
  if (deliver && clientHtml) {
    try {
      await send({
        from: clientEnvelope.from,
        apiKey: location.getoutsendApiKey,
        to: [canaryRecipient()],
        subject: `[canary] ${emailInput.emailSubject}`,
        html: clientHtml,
      })
      checks.push(pass('delivery', `accepted for ${canaryRecipient()}`))
    } catch (error) {
      checks.push(
        fail(
          'delivery',
          `${String((error as Error).message)} — check the From domain is verified in the sending workspace`
        )
      )
    }
  }

  return {
    slug,
    market: location.name,
    zip,
    ok: checks.every((c) => c.ok),
    checks,
  }
}

export interface CanaryOptions {
  /** The site's own transport. Never called when `deliver` resolves to false. */
  send: MailSender
  logoUrl: string
  /** Force a dry run. Without it SITE_SETTINGS.canarySendEmails decides. */
  deliver?: boolean
}

export async function runCanary(options: CanaryOptions): Promise<CanaryReport> {
  // A caller can force a dry run; otherwise the setting decides.
  const deliver = options.deliver === false ? false : SITE_SETTINGS.canarySendEmails
  const markets: MarketResult[] = []
  for (const [slug, location] of Object.entries(LOCATIONS)) {
    // Sequential on purpose: a handful of locations against their backends,
    // once a day, is not worth the concurrency and reads better in the logs.
    markets.push(
      await checkMarket(slug, location, options.logoUrl, deliver, options.send)
    )
  }
  return {
    at: new Date().toISOString(),
    ok: markets.every((m) => m.ok),
    sent: deliver,
    recipient: canaryRecipient(),
    markets,
  }
}
