// The sign-in code, in the same shell as everything else the site sends.
//
// It goes out through the site's own transport, so it comes from an address
// already verified in the sending account and lands in the dev outbox during
// development — the two things that make a code reliably arrive.

import { LOCATIONS } from 'virtual:form-pro/config'
import { formatSender } from '../config.ts'
import { COLORS, emailShell, esc } from './shell.ts'

const REASON: Record<string, string> = {
  'sign-in': 'signing in to',
  'email-verification': 'verifying your address for',
  'forget-password': 'recovering access to',
}

export function otpEmail({
  otp,
  type,
  brand,
  minutes,
}: {
  otp: string
  type: string
  brand: string
  minutes: number
}): { from: string; subject: string; html: string } {
  const first = Object.values(LOCATIONS)[0]
  const name = brand || first?.name || 'Form console'

  const body = `
        <tr>
          <td style="background-color:${COLORS.card};padding:28px 40px 0;">
            <p style="margin:0;font-size:15px;line-height:1.65;color:${COLORS.muted};">
              Someone asked for a code ${esc(REASON[type] ?? 'signing in to')} the ${esc(name)} form
              console. Enter it to continue.
            </p>
          </td>
        </tr>
        <tr>
          <td style="background-color:${COLORS.card};padding:22px 40px 0;">
            <div style="display:inline-block;background-color:${COLORS.cream};border:1px solid ${COLORS.creamBorder};border-radius:12px;padding:16px 26px;">
              <span style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:30px;font-weight:700;letter-spacing:8px;color:${COLORS.ink};">${esc(otp)}</span>
            </div>
          </td>
        </tr>
        <tr>
          <td style="background-color:${COLORS.card};padding:18px 40px 0;">
            <p style="margin:0;font-size:13px;line-height:1.6;color:${COLORS.faint};">
              It expires in ${minutes} minutes and can be used once. If you did not ask for it,
              nothing has happened and you can ignore this — but tell whoever runs the site, because
              it means your address is on the console's allowlist and somebody tried to use it.
            </p>
          </td>
        </tr>`

  return {
    from: formatSender(first.adminEmail),
    subject: `${otp} is your ${name} console code`,
    html: emailShell({
      brand: name,
      heading: 'Your sign-in code',
      subheading: `Expires in ${minutes} minutes.`,
      logoUrl: '',
      title: `${name} form console`,
      bodyHtml: body,
      footerLines: [`${name} form console`, 'This code was requested from the sign-in page.'],
      preheader: `${otp} — expires in ${minutes} minutes.`,
    }),
  }
}
