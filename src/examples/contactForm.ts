// The smallest config that works: one form, one inbox, one CRM.
//
// Copy this into a site as src/config/form.ts and change the values. Nothing
// here is optional-with-a-catch — a site that declares this much has a working
// console, working emails and a working webhook.

import type { EmailLabels, FieldDef, ProfileFor, SiteSettings } from '../types.ts'
import { LEAD_EMAIL } from '../config.ts'

/**
 * What the form collects.
 *
 * `as const` is what makes the ids checkable: with it, a webhook key pointing
 * at a field that does not exist is a type error rather than an empty column in
 * the CRM.
 */
export const FIELDS = [
  { id: 'firstName', label: 'First name', type: 'text', required: true, hidden: true, sample: 'Ada' },
  { id: 'lastName', label: 'Last name', type: 'text', required: true, hidden: true, sample: 'Lovelace' },
  {
    id: 'fullName',
    label: 'Name',
    type: 'text',
    audience: 'admin',
    // The heading of the internal email, and one row instead of the two halves
    // above — which is why those are `hidden`.
    headline: true,
    // Derived, so it is never asked for — and never out of step with the two
    // fields it is built from.
    derive: (v) => `${v.firstName ?? ''} ${v.lastName ?? ''}`.trim(),
  },
  {
    id: 'email',
    label: 'Email',
    type: 'email',
    required: true,
    audience: 'admin',
    sample: 'ada@example.com',
  },
  { id: 'phone', label: 'Phone', type: 'phone', audience: 'admin', sample: '(555) 010-4142' },
  {
    id: 'topic',
    label: 'What about',
    type: 'choice',
    options: [
      { value: 'sales', label: 'Sales' },
      { value: 'support', label: 'Support' },
    ],
  },
  { id: 'message', label: 'Message', type: 'textarea', sample: 'Hello!' },
] as const satisfies readonly FieldDef[]

export const PROFILES: Record<string, ProfileFor<typeof FIELDS>> = {
  main: {
    slug: 'main',
    name: 'Example Co',
    emailBrand: 'Example Co',
    phoneNumber: '(555) 010-0000',
    emailResponsePromise: 'We answer every message within one business day.',
    emailFooterLines: ['Example Co', '1 Example Street'],
    clientCopy: {
      heading: 'Thanks, {firstName}.',
      greeting: "We have your message and someone will be in touch.",
      requestTitle: 'What you sent us',
      pricingNote: '',
      bookingNote: 'If it is urgent, call us on {phone}.',
      ctaLabel: 'Call {phone}',
    },
    adminCopy: {
      heading: 'New enquiry',
      subheading: '{topic}',
      requestTitle: 'What they sent',
      noPricingNote: 'No pricing was attached to this enquiry.',
      replyLabel: 'Reply',
      callLabel: 'Call',
      footer: 'Sent by the website contact form.',
    },
    clientEmail: {
      fromName: 'Example Co',
      fromAddress: 'hello@example.com',
      to: [LEAD_EMAIL],
      ccs: [],
    },
    adminEmail: {
      fromName: 'Example Co website',
      fromAddress: 'hello@example.com',
      to: ['sales@example.com'],
      ccs: [],
    },
    webhook: {
      url: 'https://crm.example.com/hooks/leads',
      keys: {
        first_name: { from: 'firstName' },
        last_name: { from: 'lastName' },
        email: { from: 'email' },
        phone: { from: 'phone', whenEmpty: '' },
        interest: { from: 'topic', as: { sales: 'Sales', support: 'Customer Support' } },
        notes: { from: 'message', whenEmpty: '' },
        source: { value: 'Website' },
      },
    },
    canary: { values: { topic: 'sales', message: 'Daily check.' } },
  },
}

export const EMAIL_LABELS: EmailLabels = {
  dateFormat: 'Month D, YYYY',
  subjectTemplate: '{brand} — {topic} enquiry',
  adminSubjectPrefix: 'New Lead: ',
}

export const SITE_SETTINGS: SiteSettings = {
  canaryEnabled: true,
  canaryEmailTo: 'ops@example.com',
  canarySendEmails: false,
  marketingCc: '',
  consoleUsers: [],
}
