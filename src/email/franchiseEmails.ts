import type { ResolvedEnvelope } from '../config.ts'
import type { MailSender } from './send.ts'
import {
  buttons,
  COLORS,
  detailsBlock,
  esc,
  paragraph,
  row,
  telHref,
  textRow,
  emailShell,
} from './shell.ts'

export interface FranchiseEmailInput {
  clientEmail: ResolvedEnvelope
  adminEmail: ResolvedEnvelope
  logoUrl: string
  name: string
  email: string
  phoneNumber: string
  marketInterest: string
  /** 'yes' / 'no' as the form submits it. */
  hasAssets: string
  footerLines: string[]
}

/**
 * Builds both franchise emails. Pure — renders HTML and sends nothing.
 *
 * The applicant's copy deliberately echoes none of their answers back: the
 * confirmation is a thank-you, and their financial position is not something to
 * put in a mailbox we don't control.
 */
export const renderFranchiseEmails = (input: FranchiseEmailInput) => {
  const mailto = `<a href="mailto:${esc(input.email)}" style="color:${COLORS.crimson};text-decoration:none;">${esc(input.email)}</a>`
  const tel = `<a href="${telHref(input.phoneNumber)}" style="color:${COLORS.crimson};text-decoration:none;">${esc(input.phoneNumber)}</a>`

  const adminHtml = emailShell({
    brand: 'New franchisee inquiry',
    heading: input.name,
    subheading: `Market of interest: ${input.marketInterest}`,
    logoUrl: input.logoUrl,
    title: `New franchisee inquiry: ${input.name}`,
    footerLines: ['Mule Box · Franchise form notification'],
    bodyHtml: [
      detailsBlock(
        'Inquiry details',
        [
          textRow('Full name', input.name),
          row('Email', mailto),
          row('Phone', tel),
          textRow('Market of interest', input.marketInterest),
          textRow(
            'Assets over $1M',
            input.hasAssets === 'yes' ? 'Yes' : 'No'
          ),
        ].join('')
      ),
      buttons([
        { label: 'Reply by email', href: `mailto:${input.email}` },
        {
          label: `Call ${input.phoneNumber}`,
          href: telHref(input.phoneNumber),
          secondary: true,
        },
      ]),
    ].join(''),
  })

  const clientHtml = emailShell({
    brand: 'Mule Box Franchising',
    heading: 'Thanks for your interest in Mule Box.',
    subheading: 'We have your inquiry and will be in touch shortly.',
    logoUrl: input.logoUrl,
    title: 'Mule Box Franchisee Inquiry',
    footerLines: input.footerLines,
    bodyHtml: [
      paragraph(
        `Hi ${input.name.split(' ')[0] || input.name}, thanks for reaching out about a Mule Box franchise. A member of our team will review your inquiry and follow up personally.`,
        28
      ),
      paragraph(
        'Mule Box is here to make moving and storage easy and hassle-free — and we are always glad to talk to operators who feel the same way.',
        20
      ),
    ].join(''),
  })

  return { adminHtml, clientHtml }
}

export const sendFranchiseEmails = async ({
  apiKey,
  send,
  ...input
}: FranchiseEmailInput & { apiKey?: string; send: MailSender }) => {
  const { adminHtml, clientHtml } = renderFranchiseEmails(input)

  if (input.adminEmail.to.length > 0) {
    await send({
      from: input.adminEmail.from,
      apiKey,
      to: input.adminEmail.to,
      cc: input.adminEmail.cc,
      subject: 'New Lead: Mule Box Franchisee Inquiry',
      html: adminHtml,
    })
  }

  if (input.clientEmail.to.length > 0) {
    await send({
      from: input.clientEmail.from,
      apiKey,
      to: input.clientEmail.to,
      cc: input.clientEmail.cc,
      subject: 'Mule Box Franchisee Inquiry',
      html: clientHtml,
    })
  }
}
