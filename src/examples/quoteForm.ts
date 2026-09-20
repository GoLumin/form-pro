// The other end of the range: several profiles, a field that decides which one
// handles a submission, and a pricing back end behind it.
//
// This is the shape a multi-market quote form takes. Read it beside
// contactForm.ts — the difference is three extra exports, not a different kind
// of config, and every profile below is the same Profile the one-inbox site
// declares once.

import type {
  EmailLabels,
  FieldDef,
  Profile,
  ProfileFor,
  QuotingConfigFor,
  RoutingConfigFor,
  SiteSettings,
} from '../types.ts'
import { LEAD_EMAIL } from '../config.ts'
import { zipCoverageProbe } from '../quoting/coverage.ts'

export const FIELDS = [
  { id: 'firstName', label: 'First name', type: 'text', required: true, hidden: true, sample: 'Ada' },
  { id: 'lastName', label: 'Last name', type: 'text', required: true, hidden: true, sample: 'Lovelace' },
  {
    id: 'fullName',
    label: 'Name',
    type: 'text',
    audience: 'admin',
    headline: true,
    derive: (v) => `${v.firstName ?? ''} ${v.lastName ?? ''}`.trim(),
  },
  { id: 'email', label: 'Email', type: 'email', required: true, audience: 'admin', sample: 'ada@example.com' },
  { id: 'phone', label: 'Phone', type: 'phone', audience: 'admin', sample: '(555) 010-4142' },
  {
    id: 'serviceType',
    label: 'Service',
    type: 'choice',
    required: true,
    options: [
      { value: 'keep_it', label: 'Keep It' },
      { value: 'move_it', label: 'Move It' },
      { value: 'store_it', label: 'Store It' },
    ],
  },
  {
    id: 'storageType',
    label: 'Storage',
    type: 'choice',
    options: [
      { value: 'indoor', label: 'Indoor' },
      { value: 'outdoor', label: 'Outdoor' },
    ],
    // Only asked on the one service where the split exists. The emails and the
    // webhook honour the same condition, so a value that was never collected is
    // never reported either.
    showWhen: { serviceType: 'store_it' },
  },
  {
    id: 'containerSize',
    label: 'Container size',
    type: 'choice',
    // No options here: they come from the catalog per profile and per service,
    // which is what QUOTING.catalogOptions below declares.
    options: [],
  },
  { id: 'deliveryDate', label: 'Delivery date', type: 'date' },
  { id: 'deliveryZip', label: 'Delivery ZIP', type: 'zip', required: true, sample: '75201' },
  {
    id: 'relocationZip',
    label: 'Relocation ZIP',
    type: 'zip',
    showWhen: { serviceType: 'move_it' },
  },
] as const satisfies readonly FieldDef[]

const copy = (name: string): Pick<Profile, 'clientCopy' | 'adminCopy'> => ({
  clientCopy: {
    heading: 'Thanks, {firstName}.',
    greeting: `Here is your ${name} quote.`,
    requestTitle: 'Your request',
    pricingNote: 'Prices are estimates until we confirm access at the address.',
    bookingNote: 'Call us to book, or reply to this message.',
    ctaLabel: 'Call {phone}',
  },
  adminCopy: {
    heading: 'New quote request',
    subheading: '{serviceType} · {deliveryZip}',
    requestTitle: 'What they asked for',
    noPricingNote: 'No live pricing was attached to this lead.',
    replyLabel: 'Reply',
    callLabel: 'Call',
    footer: 'Sent by the website quote form.',
  },
})

export const PROFILES: Record<string, ProfileFor<typeof FIELDS>> = {
  dallas: {
    slug: 'dallas',
    name: 'Dallas',
    emailBrand: 'Example Boxes Dallas',
    phoneNumber: '(214) 555-0100',
    emailResponsePromise: 'We confirm every quote within one business hour.',
    emailFooterLines: ['Example Boxes Dallas'],
    // This market sells both; Austin below sells only outdoor.
    fieldOptions: { storageType: ['indoor', 'outdoor'] },
    quoting: { baseUrl: 'https://dallas.example.app' },
    ...copy('Dallas'),
    clientEmail: {
      fromName: 'Example Boxes Dallas',
      fromAddress: 'quotes@dallas.example.com',
      to: [LEAD_EMAIL],
      ccs: [],
    },
    adminEmail: {
      fromName: 'Dallas quote form',
      fromAddress: 'quotes@dallas.example.com',
      to: ['dallas@example.com'],
      ccs: [],
    },
    webhook: {
      url: 'https://crm.example.com/hooks/dallas',
      keys: {
        first_name: { from: 'firstName' },
        last_name: { from: 'lastName' },
        email: { from: 'email' },
        phone: { from: 'phone' },
        delivery_date: { from: 'deliveryDate', as: 'date:yyyy-mm-dd' },
        zip: { from: 'deliveryZip' },
        box_size: { from: 'containerSize', as: 'widthFirst', whenEmpty: '' },
        service: {
          from: 'serviceType',
          as: { keep_it: 'Keep It', move_it: 'Move It', store_it: 'Store It' },
        },
        source: { value: 'Website' },
      },
    },
    canary: { values: { deliveryZip: '75201', serviceType: 'keep_it' } },
  },
  austin: {
    slug: 'austin',
    name: 'Austin',
    emailBrand: 'Example Boxes Austin',
    phoneNumber: '(512) 555-0100',
    emailResponsePromise: 'We confirm every quote within one business hour.',
    emailFooterLines: ['Example Boxes Austin'],
    fieldOptions: { storageType: ['outdoor'] },
    quoting: { baseUrl: 'https://austin.example.app' },
    ...copy('Austin'),
    clientEmail: {
      fromName: 'Example Boxes Austin',
      fromAddress: 'quotes@austin.example.com',
      to: [LEAD_EMAIL],
      ccs: [],
    },
    adminEmail: {
      fromName: 'Austin quote form',
      fromAddress: 'quotes@austin.example.com',
      to: ['austin@example.com'],
      ccs: [],
    },
    webhook: {
      url: 'https://crm.example.com/hooks/austin',
      keys: {
        first_name: { from: 'firstName' },
        last_name: { from: 'lastName' },
        email: { from: 'email' },
        phone: { from: 'phone' },
        delivery_date: { from: 'deliveryDate', as: 'date:mm/dd/yyyy' },
        zip: { from: 'deliveryZip' },
        source: { value: 'Website' },
      },
    },
    canary: { values: { deliveryZip: '78701', serviceType: 'keep_it' } },
  },
}

/**
 * The ZIP decides. Each profile's own instance is asked whether it covers it,
 * in this order, and the first that says yes wins — except that a page's own
 * profile keeps a submission it covers, however early another was asked.
 */
export const ROUTING: RoutingConfigFor<typeof FIELDS> = {
  kind: 'lookup',
  field: 'deliveryZip',
  order: ['dallas', 'austin'],
  minLength: 5,
  probe: zipCoverageProbe(),
}

/** Which of the fields above each quoting call is built from. */
export const QUOTING: QuotingConfigFor<typeof FIELDS> = {
  // Indoor and outdoor collapse to one service on the back end, so the mapping
  // lives here rather than in the field's own values.
  serviceType: (lead) =>
    ({ keep_it: 'keep-it', move_it: 'move-it', store_it: 'store-it' })[lead.serviceType] ??
    'keep-it',
  productType: 'portable-storage',
  from: {
    zip: 'deliveryZip',
    destinationZip: 'relocationZip',
    size: 'containerSize',
    date: 'deliveryDate',
    name: 'fullName',
    email: 'email',
    phone: 'phone',
  },
  // The size dropdown is the catalog's answer for whichever service is picked,
  // so the form can never offer a box the quote cannot price.
  catalogOptions: { field: 'containerSize', dependsOn: 'serviceType' },
  thankYouPath: '/quote-thank-you',
}

export const EMAIL_LABELS: EmailLabels = {
  dateFormat: 'Month D, YYYY',
  subjectTemplate: '{brand} Quote - {serviceType}',
  adminSubjectPrefix: 'New Lead: ',
  pricing: {
    title: 'Estimated pricing',
    firstMonthLabel: 'First month',
    monthlyAfterLabel: 'Monthly after that',
    monthlyAfterNote: 'Every month after first month',
    monthlyLabel: 'Monthly',
    startingAt: 'Starting at {amount}',
    feesSeparate: 'Plus {amount} in fees billed separately once confirmed.',
    dueSuffix: '(est.)',
    afterFirstMonth: 'Then {monthly}/mo after your first month.',
    discountExplainer:
      'The discount applies to the first month only. {monthly}/mo after first month.',
  },
}

export const SITE_SETTINGS: SiteSettings = {
  canaryEnabled: true,
  canaryEmailTo: 'ops@example.com',
  canarySendEmails: true,
  marketingCc: '',
  consoleUsers: [],
}
