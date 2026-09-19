// Runs the daily check and mails the digest.
//
// Guarded by a shared secret rather than the console password, so a schedule
// can call it without carrying credentials that also unlock an editor which
// writes production code.
//
// Answers 200 only when every location passed, so an uptime monitor pointed
// here alerts on a broken form even if the digest email is the thing that
// broke.

import type { APIRoute } from 'astro'
import { canaryEnabled, canaryRecipient, runCanary } from '../../canary.ts'
import { canarySubject, renderCanaryEmail } from '../../email/canaryEmail.ts'
import { getEmailLogoUrl } from 'virtual:form-console/logo'
import { sendEmail } from 'virtual:form-console/mail'
import { envValue } from '../../env.ts'
import { LOCATIONS } from 'virtual:form-console/config'
import { formatSender } from '../../config.ts'

export const prerender = false

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })
}

export const GET: APIRoute = async ({ url, request }) => {
  const secret = envValue('CANARY_TOKEN')
  if (!secret) {
    return json({ error: 'CANARY_TOKEN is not set, so the check is disabled.' }, 503)
  }
  const supplied =
    url.searchParams.get('token') ??
    request.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
  if (supplied !== secret) return new Response('Not found', { status: 404 })

  if (!canaryEnabled()) {
    return json({ ok: true, skipped: 'the daily check is switched off in Settings' }, 200)
  }

  // ?dry=1 runs every check but delivers nothing — useful for a manual run.
  const deliver = url.searchParams.get('dry') !== '1'
  const rawLogo = await getEmailLogoUrl(url.hostname)
  const logoUrl = /^https?:\/\//i.test(rawLogo) ? rawLogo : new URL(rawLogo, url.origin).href
  const report = await runCanary({ deliver, logoUrl, send: sendEmail })

  let digest: 'sent' | 'skipped' | 'failed' = 'skipped'
  if (deliver) {
    try {
      // The digest comes from the first location's own admin identity: it is
      // internal mail, and that address is already verified in the account that
      // sends it — a separate corporate From would be one more thing to keep in
      // step with the sending workspace.
      const first = Object.values(LOCATIONS)[0]
      await sendEmail({
        from: formatSender(first.adminEmail),
        apiKey: first.getoutsendApiKey,
        to: [canaryRecipient()],
        subject: canarySubject(report),
        html: renderCanaryEmail(report, logoUrl),
      })
      digest = 'sent'
    } catch (error) {
      // The digest failing is itself a finding, and the status code still
      // carries it to whatever is watching.
      console.error('canary digest failed to send:', error)
      digest = 'failed'
    }
  }

  return json({ ...report, digest }, report.ok ? 200 : 500)
}
