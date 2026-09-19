import type { CanaryReport } from '../canary.ts'
import { COLORS, emailShell, esc } from './shell.ts'

/**
 * The daily digest — one email that says whether every market is answering.
 *
 * Deliberately readable at a glance and in the notification preview: the
 * subject alone should settle it, and the body only has to be opened when
 * something is wrong.
 */
export function renderCanaryEmail(report: CanaryReport, logoUrl: string): string {
  const failed = report.markets.filter((m) => !m.ok)

  const row = (label: string, ok: boolean, detail: string) => `
              <tr>
                <td style="padding:7px 0;border-bottom:1px solid ${COLORS.dividerSoft};font-size:13px;color:${COLORS.muted};width:150px;">${esc(label)}</td>
                <td style="padding:7px 0;border-bottom:1px solid ${COLORS.dividerSoft};font-size:13px;color:${ok ? COLORS.ink : '#b3261e'};font-weight:${ok ? 400 : 600};">
                  ${ok ? '' : '✕ '}${esc(detail)}
                </td>
              </tr>`

  const market = (m: CanaryReport['markets'][number]) => `
        <tr>
          <td style="background-color:${COLORS.card};padding:22px 40px 0;">
            <p style="margin:0 0 2px;font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:${m.ok ? '#15803d' : '#b3261e'};">
              ${m.ok ? 'Answering' : 'Needs attention'}
            </p>
            <p style="margin:0 0 10px;font-size:16px;font-weight:700;color:${COLORS.ink};">${esc(m.market)} <span style="font-weight:400;color:${COLORS.faint};font-size:13px;">· ${esc(m.zip)}</span></p>
            <table width="100%" cellpadding="0" cellspacing="0" border="0">
              ${m.checks.map((c) => row(c.name, c.ok, c.detail)).join('')}
            </table>
          </td>
        </tr>`

  return emailShell({
    brand: 'Daily form check',
    heading: report.ok
      ? 'All four markets are answering.'
      : `${failed.length} market${failed.length === 1 ? '' : 's'} need${failed.length === 1 ? 's' : ''} attention.`,
    subheading: report.ok
      ? 'A quote was priced, an email was delivered and a CRM payload was built for every market.'
      : `Failing: ${failed.map((m) => m.market).join(', ')}.`,
    logoUrl,
    title: 'Mule Box daily form check',
    rawHeadings: false,
    footerLines: [
      `Checked ${new Date(report.at).toUTCString()}`,
      report.sent
        ? `A copy of each market's quote email was delivered to ${report.recipient}.`
        : 'Delivery was not exercised on this run.',
      'No leads were posted to any CRM.',
    ],
    bodyHtml: report.markets.map(market).join(''),
  })
}

/** Subject line — the whole answer, for anyone who only reads the list. */
export function canarySubject(report: CanaryReport): string {
  return report.ok
    ? 'Mule Box forms: all four markets OK'
    : `Mule Box forms: ${report.markets.filter((m) => !m.ok).map((m) => m.market).join(', ')} failing`
}
