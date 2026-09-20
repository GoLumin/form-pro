// Drives one submission for the console and reports every decision back instead
// of redirecting: the profile it resolved, both email envelopes, the webhook URL
// and the payload key by key, and both rendered emails.
//
// It is not a second copy of the site's own form action. It calls the same
// functions in the same order — buildLead, resolveProfile, resolveEnvelope,
// emailSubjectFor, buildWebhookPayload, renderLeadEmails — so what it reports is
// what a real submission would do. What it skips is whatever bot check sits on
// the real form, and the redirect.
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
import { EMAIL_LABELS, FIELDS, QUOTING } from 'virtual:form-pro/config'
import { sendEmail } from 'virtual:form-pro/mail'
import { buildWebhookPayload, emailSubjectFor, resolveEnvelope } from '../../config.ts'
import { buildLead } from '../../fields.ts'
import { resolveProfile } from '../../routing.ts'
import { renderLeadEmails, sendLeadEmails } from '../../email/leadEmails.ts'
import { priceSubmission, quotingEnabled } from '../../quoting/submission.ts'

export const prerender = false

interface Body {
  token?: string
  /** The page the form sits on, when the site routes by page. */
  profileSlug?: string | null
  /** The submission itself, keyed by field id. */
  values?: Record<string, unknown>
  /** Ask the pricing back end for real figures, as a visitor would. */
  liveQuote?: boolean
  /** Actually deliver both emails to their real recipients. */
  reallySend?: boolean
  /** Actually POST the lead to this profile's CRM webhook. */
  reallyPost?: boolean
}

export const POST: APIRoute = async (context) => {
  const checked = await authorize<Body>(context)
  if ('response' in checked) return checked.response
  const input = checked.body

  const notes: string[] = []
  const lead = buildLead(FIELDS, input.values ?? {})

  const profile = await resolveProfile(input.profileSlug, lead).catch((error) => {
    notes.push(`Coverage lookup failed: ${String(error)}`)
    return null
  })

  if (!profile) {
    return json({ served: false, message: "We don't currently serve this area", notes })
  }

  const emailField = FIELDS.find((f) => f.type === 'email')
  const leadEmail = emailField ? (lead[emailField.id] ?? '') : ''

  const clientEnvelope = resolveEnvelope(profile.clientEmail, leadEmail)
  const adminEnvelope = resolveEnvelope(profile.adminEmail, leadEmail)
  const emailSubject = emailSubjectFor(profile, EMAIL_LABELS, FIELDS, lead)
  const webhookPayload = buildWebhookPayload(profile.webhook.keys, lead)

  // Pricing is opt-in twice over: the site has to have a back end at all, and
  // this submission has to have asked for live figures.
  let priced = null
  if (input.liveQuote && quotingEnabled() && QUOTING) {
    priced = await priceSubmission({ profile, fields: FIELDS, lead, config: QUOTING })
    notes.push(...priced.notes)
  } else if (input.liveQuote && !QUOTING) {
    notes.push('This site has no pricing back end, so the emails show no pricing block.')
  } else if (!input.liveQuote) {
    notes.push('Live pricing was off, so the emails show no pricing block.')
  }

  const emailInput = {
    clientEmail: clientEnvelope,
    adminEmail: adminEnvelope,
    emailSubject,
    profile,
    fields: FIELDS,
    lead,
    labels: EMAIL_LABELS,
    pricing: priced?.pricing ?? null,
    logoUrl: await logoUrlFor(context),
  }

  // Rendering is pure, so both emails always come back for inspection.
  let clientHtml = ''
  let adminHtml = ''
  try {
    const rendered = renderLeadEmails(emailInput)
    clientHtml = rendered.clientHtml
    adminHtml = rendered.adminHtml
  } catch (error) {
    notes.push(`Rendering the emails failed: ${String(error)}`)
  }

  let sent = false
  if (input.reallySend) {
    try {
      await sendLeadEmails({ ...emailInput, apiKey: profile.mailApiKey, send: sendEmail })
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
      const response = await fetch(profile.webhook.url, {
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

  return json({
    served: true,
    profile: {
      slug: profile.slug,
      name: profile.name,
      phoneNumber: profile.phoneNumber,
      fromPage: Boolean(input.profileSlug),
    },
    emailSubject,
    clientEnvelope,
    adminEnvelope,
    /** Echoed back so the page can show the trace and flag the lead's own address. */
    lead,
    leadEmail,
    webhook: { url: profile.webhook.url, payload: webhookPayload },
    clientHtml,
    adminHtml,
    sent,
    posted,
    quoteId: priced?.quoteId ?? null,
    thankYouUrl: priced?.thankYouUrl ?? null,
    notes,
  })
}
