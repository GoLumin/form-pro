// One profile's email rendered exactly as it would send, with every editable
// string wrapped in [data-copy-key] and every {placeholder} in [data-var].
//
// The editor makes those spans contenteditable and reads the template back out
// of them, so the thing you click is the real email rather than a mock of it.
// Production never passes markEditable, so a sent message carries none of this.

import type { APIRoute } from 'astro'
import { authorize, fail, json, logoUrlFor } from './_shared.ts'
import { EMAIL_LABELS, FIELDS, PROFILES } from 'virtual:form-pro/config'
import { emailSubjectFor, resolveEnvelope } from '../../config.ts'
import { sampleLead } from '../../fields.ts'
import { renderLeadEmails } from '../../email/leadEmails.ts'
import type { EmailPricing } from '../../email/pricingSection.ts'

export const prerender = false

interface Body {
  token?: string
  slug?: string
  kind?: 'client' | 'admin'
}

/**
 * Figures for the preview, so the block can be read and edited before any real
 * quote exists. Built here rather than fetched: a preview that had to price
 * something would cost money to open.
 */
const SAMPLE_PRICING: EmailPricing = {
  productName: 'Your order',
  monthly: 23900,
  firstMonth: 18900,
  discountLabel: '$50 OFF FIRST MONTH',
  dueLabel: 'Total Due at Delivery',
  dueBeforeDelivery: 33800,
  totalFeesSeparate: 0,
  transit: [{ name: 'Delivery', amount: 14900, startingAt: true, excludedFromTotal: false }],
}

export const POST: APIRoute = async (context) => {
  const checked = await authorize<Body>(context)
  if ('response' in checked) return checked.response
  const { slug, kind } = checked.body

  const profile = PROFILES[String(slug ?? '')]
  if (!profile) return fail('No such profile')

  // Representative values, so the preview shows a real-looking email rather
  // than empty rows. A field with no sample falls back to its first option.
  const lead = sampleLead(FIELDS)

  const emailField = FIELDS.find((f) => f.type === 'email')
  const leadEmail = (emailField && lead[emailField.id]) || 'ada@example.com'

  const rendered = renderLeadEmails({
    clientEmail: resolveEnvelope(profile.clientEmail, leadEmail),
    adminEmail: resolveEnvelope(profile.adminEmail, leadEmail),
    emailSubject: emailSubjectFor(profile, EMAIL_LABELS, FIELDS, lead),
    profile,
    fields: FIELDS,
    lead,
    labels: EMAIL_LABELS,
    markEditable: true,
    // Only a site that has pricing wording has a pricing block to preview.
    pricing: EMAIL_LABELS.pricing ? SAMPLE_PRICING : null,
    logoUrl: await logoUrlFor(context),
  })

  return json({ html: kind === 'admin' ? rendered.adminHtml : rendered.clientHtml })
}
