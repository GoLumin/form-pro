import type { CanaryReport } from '../canary.ts'
import { COLORS, emailShell, esc } from './shell.ts'

/**
 * The daily digest — one email that says whether every profile is answering.
 *
 * Deliberately readable at a glance and in the notification preview: the
 * subject alone should settle it, and the body only has to be opened when
 * something is wrong.
 */
export function renderCanaryEmail(
  report: CanaryReport,
  logoUrl: string,
  brand = 'This site'
): string {
  const failed = report.profiles.filter((p) => !p.ok)
  const count = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

  const row = (label: string, ok: boolean, detail: string) => `
              <tr>
                <td style="padding:7px 0;border-bottom:1px solid ${COLORS.dividerSoft};font-size:13px;color:${COLORS.muted};width:150px;">${esc(label)}</td>
                <td style="padding:7px 0;border-bottom:1px solid ${COLORS.dividerSoft};font-size:13px;color:${ok ? COLORS.ink : '#b3261e'};font-weight:${ok ? 400 : 600};">
                  ${ok ? '' : '✕ '}${esc(detail)}
                </td>
              </tr>`

  const section = (p: CanaryReport['profiles'][number]) => `
        <tr>
          <td style="background-color:${COLORS.card};padding:22px 40px 0;">
            <p style="margin:0 0 2px;font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:${p.ok ? '#15803d' : '#b3261e'};">
              ${p.ok ? 'Answering' : 'Needs attention'}
            </p>
            <p style="margin:0 0 10px;font-size:16px;font-weight:700;color:${COLORS.ink};">${esc(p.profile)}</p>
            <table width="100%" cellpadding="0" cellspacing="0" border="0">
              ${p.checks.map((c) => row(c.name, c.ok, c.detail)).join('')}
            </table>
          </td>
        </tr>`

  return emailShell({
    brand: 'Daily form check',
    heading: report.ok
      ? `All ${count(report.profiles.length, 'form')} are answering.`
      : `${count(failed.length, 'form')} need${failed.length === 1 ? 's' : ''} attention.`,
    subheading: report.ok
      ? 'An email was rendered and a CRM payload was built for every profile.'
      : `Failing: ${failed.map((p) => p.profile).join(', ')}.`,
    logoUrl,
    title: `${brand} daily form check`,
    rawHeadings: false,
    footerLines: [
      `Checked ${new Date(report.at).toUTCString()}`,
      report.sent
        ? `A copy of each profile's email was delivered to ${report.recipient}.`
        : 'Delivery was not exercised on this run.',
      'No leads were posted to any CRM.',
    ],
    bodyHtml: report.profiles.map(section).join(''),
  })
}

/** Subject line — the whole answer, for anyone who only reads the list. */
export function canarySubject(report: CanaryReport, brand = 'Forms'): string {
  return report.ok
    ? `${brand}: all ${report.profiles.length} OK`
    : `${brand}: ${report.profiles.filter((p) => !p.ok).map((p) => p.profile).join(', ')} failing`
}
