// Drives one submission for the console and reports every decision back instead
// of redirecting: the location it resolved, both email envelopes, the webhook
// URL and the payload key by key, and both rendered emails.
//
// It is not a second copy of the site's quote action. It calls the same
// functions in the same order — resolveQuoteLocation, resolveEnvelope,
// emailSubjectFor, buildWebhookPayload, renderQuoteEmails — so what it reports
// is what a real submission would do. What it skips is Turnstile (there is no
// widget on the console) and the redirect.
//
// It runs in production too, which is why nothing here is gated on DEV: the two
// dangerous steps are opt-in per submission instead. Rendering an email is
// free; sending it is not, and neither is filing a lead in a CRM.
//
// The emails come back as HTML rather than as a file to fetch, because on a
// serverless host there is no writable disk to leave them on and no guarantee
// the next request lands on the same instance.

import type { APIRoute } from 'astro'
import { authorize, json, logoUrlFor } from './_shared.ts'
import { EMAIL_LABELS } from 'virtual:form-pro/config'
import { createQuote, getConfig, previewQuote } from 'virtual:form-pro/quoting'
import { sendEmail } from 'virtual:form-pro/mail'
import {
  buildWebhookPayload,
  emailSubjectFor,
  resolveEnvelope,
  serviceLabel,
} from '../../config.ts'
import { formatDate, QUOTING_SERVICE_TYPE, selectProductForSize, type SelectedProduct } from '../../catalog.ts'
import { resolveQuoteLocation } from '../../routing.ts'
import { renderQuoteEmails, sendQuoteEmail } from '../../email/quoteEmails.ts'
import type { Lead } from '../../types.ts'

export const prerender = false

interface Body {
  token?: string
  locationSlug?: string | null
  serviceType?: string
  storeItType?: string
  firstName?: string
  lastName?: string
  email?: string
  phone?: string
  initialDeliveryZip?: string
  finalDeliveryZip?: string
  deliveryDate?: string
  selectedContainerType?: string
  /** Ask gofuse for real pricing and persist a quote, as a visitor would. */
  liveQuote?: boolean
  /** Actually deliver both emails to their real recipients. */
  reallySend?: boolean
  /** Actually POST the lead to this location's CRM webhook. */
  reallyPost?: boolean
}

/** The three services as a quote form names them, for the lead payload. */
const LEAD_SERVICE: Record<string, Lead['serviceType']> = {
  keep_it: 'keep_it',
  move_it: 'move_it',
  store_it: 'store_it',
}

export const POST: APIRoute = async (context) => {
  const checked = await authorize<Body>(context)
  if ('response' in checked) return checked.response
  const input = checked.body

  const notes: string[] = []
  const zip = String(input.initialDeliveryZip ?? '')
  const quoteLocation = await resolveQuoteLocation(input.locationSlug, zip).catch((error) => {
    notes.push(`ZIP coverage lookup failed: ${String(error)}`)
    return null
  })

  if (!quoteLocation) {
    return json({ served: false, message: "We don't currently serve this area", notes })
  }

  const storeItType =
    input.storeItType === 'indoor' || input.storeItType === 'outdoor' ? input.storeItType : null
  const serviceType = storeItType ? `store_it_${storeItType}` : String(input.serviceType ?? '')
  const apiServiceType = QUOTING_SERVICE_TYPE[serviceType] ?? 'keep-it'
  const leadService = LEAD_SERVICE[String(input.serviceType ?? '')] ?? 'keep_it'
  const fullName = `${input.firstName ?? ''} ${input.lastName ?? ''}`.trim()
  const deliveryDateObj = new Date(String(input.deliveryDate ?? ''))
  const deliveryDateIso = Number.isNaN(deliveryDateObj.getTime())
    ? ''
    : deliveryDateObj.toISOString().slice(0, 10)

  // Undefined on a single-tenant site: there is one instance and nothing to
  // point the call at.
  const overrides = quoteLocation.baseUrl
    ? { baseUrl: quoteLocation.baseUrl, token: quoteLocation.token }
    : undefined

  let selectedProduct: SelectedProduct | null = null
  let totalLabel: string | null = null
  let quote: any = null
  let quoteId: string | null = null

  if (input.liveQuote) {
    try {
      const config = await getConfig({ zip_code: zip }, overrides)
      totalLabel = config?.settings?.total_price_label?.trim() || null
      selectedProduct = selectProductForSize({
        products: config?.products ?? [],
        serviceType: apiServiceType,
        productType: 'portable-storage',
        containerSize: input.selectedContainerType,
      })
    } catch (error) {
      notes.push(`getConfig failed: ${String(error)}`)
    }

    try {
      quote = await previewQuote(
        {
          service_type: apiServiceType,
          product_type: 'portable-storage',
          zip_code: zip,
          ...(input.finalDeliveryZip ? { destination_zip_code: input.finalDeliveryZip } : {}),
          ...(selectedProduct ? { quantities: { [selectedProduct.id]: 1 } } : {}),
        },
        overrides
      )
    } catch (error) {
      notes.push(`previewQuote failed: ${String(error)}`)
    }

    try {
      const created = await createQuote(
        {
          service_type: apiServiceType,
          product_type: 'portable-storage',
          zip_code: zip,
          destination_zip_code: input.finalDeliveryZip ?? '',
          full_name: fullName,
          email: input.email,
          phone: input.phone,
          delivery_date: deliveryDateIso,
          idempotency_key: crypto.randomUUID(),
          ...(selectedProduct ? { quantities: { [selectedProduct.id]: 1 } } : {}),
        },
        overrides
      )
      quoteId = created?.uuid ?? created?.id ?? null
    } catch (error) {
      notes.push(`createQuote failed: ${String(error)}`)
    }
  } else {
    notes.push('Live pricing was off, so the emails show no pricing block.')
  }

  const leadEmail = String(input.email ?? '')
  const lead: Lead = {
    firstName: String(input.firstName ?? ''),
    lastName: String(input.lastName ?? ''),
    fullName,
    phone: String(input.phone ?? ''),
    email: leadEmail,
    deliveryDate: formatDate(input.deliveryDate),
    deliveryZip: zip,
    relocationZip: input.finalDeliveryZip,
    serviceType: leadService,
    storageType: storeItType,
    containerSize: String(input.selectedContainerType ?? ''),
  }

  const clientEnvelope = resolveEnvelope(quoteLocation.clientEmail, leadEmail)
  const adminEnvelope = resolveEnvelope(quoteLocation.adminEmail, leadEmail)
  const emailSubject = emailSubjectFor(quoteLocation, leadService)
  const webhookPayload = buildWebhookPayload(quoteLocation.webhook.keys, lead)

  const emailInput = {
    clientEmail: clientEnvelope,
    adminEmail: adminEnvelope,
    email: leadEmail,
    emailSubject,
    brand: quoteLocation.name,
    responsePromise: quoteLocation.emailResponsePromise,
    clientCopy: quoteLocation.clientCopy,
    adminCopy: quoteLocation.adminCopy,
    labels: EMAIL_LABELS,
    footerLines: quoteLocation.emailFooterLines,
    formTypeName: serviceLabel(leadService),
    firstName: lead.firstName,
    fullName,
    companyPhone: quoteLocation.phoneNumber,
    phone: lead.phone,
    initialDeliveryZip: zip,
    initialDeliveryDate: lead.deliveryDate,
    relocationZip: input.finalDeliveryZip,
    storageType: lead.storageType,
    containerSize: selectedProduct?.name || lead.containerSize,
    quote: {
      products: quote?.products ?? [],
      fees: quote?.fees ?? [],
      subtotal: quote?.subtotal ?? null,
      total: quote?.total ?? null,
      totalLabel,
      discountLabel: selectedProduct?.discountLabel ?? null,
    },
    logoUrl: await logoUrlFor(context),
  }

  // Rendering is pure, so both emails always come back for inspection.
  let clientHtml = ''
  let adminHtml = ''
  try {
    const rendered = renderQuoteEmails(emailInput)
    clientHtml = rendered.clientHtml
    adminHtml = rendered.adminHtml
  } catch (error) {
    notes.push(`Rendering the emails failed: ${String(error)}`)
  }

  let sent = false
  if (input.reallySend) {
    try {
      await sendQuoteEmail({
        ...emailInput,
        apiKey: quoteLocation.getoutsendApiKey,
        send: sendEmail,
      })
      sent = true
      notes.push(
        `Emails were really sent: ${clientEnvelope.to.join(', ')} and ${adminEnvelope.to.join(', ')}.`
      )
    } catch (error) {
      notes.push(`Sending failed: ${String(error)}`)
    }
  }

  let posted = false
  if (input.reallyPost) {
    try {
      const response = await fetch(quoteLocation.webhook.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(webhookPayload),
      })
      const body = await response.text().catch(() => '')
      posted = response.ok
      notes.push(`The CRM answered ${response.status}${body ? ` ${body.slice(0, 200)}` : ''}.`)
    } catch (error) {
      notes.push(`Posting the lead failed: ${String(error)}`)
    }
  }

  const redirectParams = new URLSearchParams({
    zip_code: zip,
    destination_zip_code: input.finalDeliveryZip ?? '',
    service_type: apiServiceType,
    full_name: fullName,
    delivery_date: deliveryDateIso,
    email: leadEmail,
    phone: lead.phone,
    product_type: 'portable-storage',
    container_size: lead.containerSize,
  })
  // A site with one location has one thank-you page; a multi-market site gives
  // each its own, so the page reads back the quote from the right instance.
  const thankYouPath = quoteLocation.baseUrl
    ? `/quote-thank-you/${quoteLocation.slug}`
    : '/quote-thank-you'

  return json({
    served: true,
    market: {
      slug: quoteLocation.slug,
      name: quoteLocation.name,
      baseUrl: quoteLocation.baseUrl ?? '',
      phoneNumber: quoteLocation.phoneNumber,
      fromPage: Boolean(input.locationSlug),
    },
    emailSubject,
    clientEnvelope,
    adminEnvelope,
    /** Echoed back so the page can show the trace and flag the lead's own address. */
    zip,
    leadEmail,
    webhook: { url: quoteLocation.webhook.url, payload: webhookPayload },
    clientHtml,
    adminHtml,
    sent,
    posted,
    quoteId,
    thankYouUrl: quoteId
      ? `${thankYouPath}?q=${encodeURIComponent(quoteId)}&${redirectParams}`
      : `${thankYouPath}?${redirectParams}`,
    notes,
  })
}
