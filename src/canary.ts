import { EMAIL_LABELS, FIELDS, PROFILES, QUOTING, SITE_SETTINGS } from 'virtual:form-pro/config'
import { buildWebhookPayload, emailSubjectFor, resolveEnvelope } from './config.ts'
import { sampleLead } from './fields.ts'
import type { Lead } from './fields.ts'
import type { Profile } from './types.ts'
import { resolveProfile, routing } from './routing.ts'
import { renderLeadEmails } from './email/leadEmails.ts'
import type { MailSender } from './email/send.ts'
import { priceSubmission, quotingEnabled } from './quoting/submission.ts'
import { envValue } from './env.ts'

/**
 * A daily submission through each profile, so a silent break is found by us
 * rather than by someone who never hears back.
 *
 * It runs the real path as far as delivery: the emails are really rendered and
 * really sent — with the recipients swapped for a monitoring inbox, but the
 * From address and the sending key left exactly as configured, because that
 * pairing is what fails. A dry run would not have caught the outage this was
 * written after: the transport rejected a From whose domain was not verified in
 * the sending workspace, and nothing short of a real send sees that.
 *
 * The CRM payload is built and checked but deliberately not posted. A junk lead
 * a day in a client's CRM is a cost with little return — most webhooks answer
 * 200 to a payload they cannot map, so posting proves less than it appears to.
 */

export interface Check {
  name: string
  ok: boolean
  detail: string
}

export interface ProfileResult {
  slug: string
  profile: string
  ok: boolean
  checks: Check[]
}

export interface CanaryReport {
  at: string
  ok: boolean
  sent: boolean
  recipient: string
  profiles: ProfileResult[]
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

async function checkProfile(
  slug: string,
  profile: Profile,
  logoUrl: string,
  deliver: boolean,
  send: MailSender
): Promise<ProfileResult> {
  const checks: Check[] = []
  const declared = profile.canary?.values

  if (!declared) {
    return {
      slug,
      profile: profile.name,
      ok: false,
      checks: [
        fail('submission', 'no canary values declared for this profile, so nothing was submitted'),
      ],
    }
  }

  // The monitoring inbox stands in for the submitter, so a probe that really
  // sends lands somewhere we read rather than somewhere a customer does.
  const emailField = FIELDS.find((f) => f.type === 'email')
  const lead: Lead = sampleLead(FIELDS, {
    ...declared,
    ...(emailField ? { [emailField.id]: canaryRecipient() } : {}),
  })
  const leadEmail = emailField ? (lead[emailField.id] ?? '') : canaryRecipient()

  // 1. The submission still routes where we expect. Catches a coverage change,
  //    or one profile quietly taking over another's territory.
  const config = routing()
  if (config.kind === 'lookup') {
    try {
      const resolved = await resolveProfile(null, lead)
      checks.push(
        resolved?.slug === slug
          ? pass('routing', `${lead[config.field] ?? ''} → ${resolved.name}`)
          : fail(
              'routing',
              `resolved to ${resolved?.slug ?? 'no profile'}, expected ${slug}`
            )
      )
    } catch (error) {
      checks.push(fail('routing', String((error as Error).message)))
    }
  }

  // 2. Pricing, where the site has any. An expired token shows up here, and it
  //    is also an empty dropdown on the real form.
  let pricing = null
  if (quotingEnabled() && QUOTING) {
    try {
      // Nothing is persisted: the check should not leave a stored quote a day
      // behind it in the back end.
      const priced = await priceSubmission({
        profile,
        fields: FIELDS,
        lead,
        config: QUOTING,
        persist: false,
      })
      pricing = priced.pricing
      checks.push(
        priced.pricing
          ? pass('pricing', `due ${(priced.pricing.dueBeforeDelivery / 100).toFixed(2)}`)
          : fail('pricing', priced.notes.join('; ') || 'no figures came back')
      )
    } catch (error) {
      checks.push(fail('pricing', String((error as Error).message)))
    }
  }

  // 3. The lead shapes into this profile's webhook keys, and nothing required
  //    comes out blank. Catches a key pointed at a field that no longer exists.
  const payload = buildWebhookPayload(profile.webhook.keys, lead)
  const blank = Object.entries(payload)
    .filter(([key, value]) => {
      if (value !== '') return false
      const spec = profile.webhook.keys[key] as { whenEmpty?: string }
      // A key that declares a fallback is allowed to be empty on purpose.
      return spec?.whenEmpty === undefined
    })
    .map(([key]) => key)
  checks.push(
    blank.length === 0
      ? pass('webhook payload', `${Object.keys(payload).length} keys, none unexpectedly blank`)
      : fail('webhook payload', `blank with no fallback: ${blank.join(', ')}`)
  )

  // 4. Both emails render, and the envelope is one a mail server will take.
  const clientEnvelope = resolveEnvelope(profile.clientEmail, leadEmail)
  const adminEnvelope = resolveEnvelope(profile.adminEmail, leadEmail)
  const envelopeOk = /.+<.+@.+\..+>/.test(clientEnvelope.from) && clientEnvelope.to.length > 0
  checks.push(
    envelopeOk
      ? pass('envelope', clientEnvelope.from)
      : fail('envelope', `unusable From or empty To: ${clientEnvelope.from}`)
  )

  const emailSubject = emailSubjectFor(profile, EMAIL_LABELS, FIELDS, lead)
  const emailInput = {
    clientEmail: clientEnvelope,
    adminEmail: adminEnvelope,
    emailSubject,
    profile,
    fields: FIELDS,
    lead,
    labels: EMAIL_LABELS,
    pricing,
    logoUrl,
  }

  let clientHtml = ''
  try {
    const rendered = renderLeadEmails(emailInput)
    clientHtml = rendered.clientHtml
    checks.push(
      rendered.clientHtml.includes(profile.emailBrand)
        ? pass('render', `${rendered.clientHtml.length} bytes`)
        : fail('render', 'the brand is missing from the rendered email')
    )
  } catch (error) {
    checks.push(fail('render', String((error as Error).message)))
  }

  // 5. Delivery. The recipients are swapped for the monitoring inbox; the From
  //    and the API key are left exactly as configured, because they are the
  //    pair being tested.
  if (deliver && clientHtml) {
    try {
      await send({
        from: clientEnvelope.from,
        apiKey: profile.mailApiKey,
        to: [canaryRecipient()],
        subject: `[canary] ${emailSubject}`,
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

  return { slug, profile: profile.name, ok: checks.every((c) => c.ok), checks }
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
  const profiles: ProfileResult[] = []
  for (const [slug, profile] of Object.entries(PROFILES)) {
    // Sequential on purpose: a handful of profiles against their back ends,
    // once a day, is not worth the concurrency and reads better in the logs.
    profiles.push(await checkProfile(slug, profile, options.logoUrl, deliver, options.send))
  }
  return {
    at: new Date().toISOString(),
    ok: profiles.every((p) => p.ok),
    sent: deliver,
    recipient: canaryRecipient(),
    profiles,
  }
}
