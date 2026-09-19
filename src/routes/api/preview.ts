// One location's email rendered exactly as it would send, with every editable
// string wrapped in [data-copy-key] and every {placeholder} in [data-var].
//
// The editor makes those spans contenteditable and reads the template back out
// of them, so the thing you click is the real email rather than a mock of it.
// Production never passes markEditable, so a sent message carries none of this.

import type { APIRoute } from 'astro'
import { authorize, fail, json, logoUrlFor } from './_shared.ts'
import { LOCATIONS, EMAIL_LABELS } from 'virtual:form-console/config'
import { emailSubjectFor, resolveEnvelope, serviceLabel } from '../../config.ts'
import { renderQuoteEmails } from '../../email/quoteEmails.ts'

export const prerender = false

interface Body {
  token?: string
  slug?: string
  kind?: 'client' | 'admin'
}

export const POST: APIRoute = async (context) => {
  const checked = await authorize<Body>(context)
  if ('response' in checked) return checked.response
  const { slug, kind } = checked.body

  const location = LOCATIONS[String(slug ?? '')]
  if (!location) return fail('No such location')

  // Representative values, so the preview shows a real-looking email rather
  // than empty rows.
  const rendered = renderQuoteEmails({
    clientEmail: resolveEnvelope(location.clientEmail, 'ada@example.com'),
    adminEmail: resolveEnvelope(location.adminEmail, 'ada@example.com'),
    email: 'ada@example.com',
    emailSubject: emailSubjectFor(location, 'keep_it'),
    brand: location.name,
    responsePromise: location.emailResponsePromise,
    footerLines: location.emailFooterLines,
    clientCopy: location.clientCopy,
    adminCopy: location.adminCopy,
    labels: EMAIL_LABELS,
    markEditable: true,
    formTypeName: serviceLabel('keep_it'),
    firstName: 'Ada',
    fullName: 'Ada Lovelace',
    phone: '(555) 010-4142',
    initialDeliveryZip: '00000',
    initialDeliveryDate: '10/01/2026',
    storageType: null,
    containerSize: '16x8',
    companyPhone: location.phoneNumber,
    quote: {
      products: [
        { name: "16' x 8' Mule Box", quantity: 1, subtotal: 18900, original_price: 23900 },
      ],
      fees: [{ name: 'Delivery', amount: 14900, starting_at: true }],
      total: 33800,
      totalLabel: 'Total Due at Delivery',
      discountLabel: '$50 OFF FIRST MONTH',
    },
    logoUrl: await logoUrlFor(context),
  })

  return json({ html: kind === 'admin' ? rendered.adminHtml : rendered.clientHtml })
}
