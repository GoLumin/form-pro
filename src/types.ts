// The shapes a site declares in its own src/config/locations.ts.
//
// The package owns these types and the machinery that reads them; it never owns
// the values. Those live in the repository that deploys, because that is the
// file the console edits and commits — and because a market's gofuse instance,
// its GetOutsend account, its envelopes and its CRM keys only work as a set,
// and the set belongs to the site that sends them.
//
// A single-location site declares one entry and is done. A site serving several
// markets declares one per market; nothing else about the shape changes.

import type { DateFormat } from './dateFormats.ts'

/**
 * The market-neutral lead, as the quote form collected it. Webhook keys draw
 * their values from these fields.
 */
export interface Lead {
  firstName: string
  lastName: string
  /** "First Last" — some webhooks want the whole name in one key. */
  fullName: string
  phone: string
  email: string
  /** mm/dd/yyyy, as the form's date formatter produces it. */
  deliveryDate: string
  deliveryZip: string
  /** Only present on move-it submissions. */
  relocationZip?: string
  /** The service the visitor picked on the form. */
  serviceType: 'keep_it' | 'move_it' | 'store_it'
  /** Store-it only: the storage variant, when the market offers the split. */
  storageType: 'indoor' | 'outdoor' | null
  /** Container size as the visitor selected it, length-first, e.g. "16x8". */
  containerSize: string
}

export type LeadField = keyof Lead

/**
 * Named reshapes a webhook key can ask for.
 *
 * `date:*` writes the delivery date the way that market's field mapping
 * expects. It is spelled out on every date key rather than left implicit, so
 * the format is visible and changeable instead of being whatever the form
 * happened to produce.
 */
export type WebhookTransform = 'widthFirst' | `date:${DateFormat}`

/**
 * What one webhook key is filled with.
 *
 * `{ value }`            a constant, e.g. a Source column that is always "Website"
 * `{ from }`             copied straight off the lead
 * `{ from, as }`         translated — a lookup table of the market's own
 *                        vocabulary, or a named transform
 * `{ from, whenEmpty }`  what to send when the lead has no value for it; without
 *                        it an absent field is sent as ''
 */
export type WebhookValue =
  | { value: string }
  | {
      from: LeadField
      as?: Record<string, string> | WebhookTransform
      whenEmpty?: string
    }

/** Exactly the keys one market's webhook accepts, and what fills them. */
export type WebhookKeys = Record<string, WebhookValue>

/**
 * One outgoing email's envelope. The body is built by the shared templates;
 * only who it comes from and goes to lives here.
 */
export interface EmailEnvelope {
  /** Display name shown in the inbox. */
  fromName: string
  /**
   * The sending address. Its domain MUST be verified in the GetOutsend
   * workspace this market's `getoutsendApiKey` belongs to, or the send is
   * rejected outright.
   */
  fromAddress: string
  /** Recipients. Use LEAD_EMAIL for "whoever submitted the form". */
  to: string[]
  /** Copied recipients, visible to everyone on the message. */
  ccs: string[]
}

export interface Location {
  /** Route segment and config key. On a single-location site, anything stable. */
  slug: string
  /** Human label, used on the lead email and page titles. */
  name: string
  /**
   * Brand wording for email subjects: "<brand> Quote - Keep It". Separate from
   * `name` because the subject line is customer-facing copy the markets have
   * already agreed on, not a label we are free to reword.
   */
  emailBrand: string
  /** Number shown to the customer and used for the call-to-action. */
  phoneNumber: string
  /**
   * The line under the headline of the customer's quote email. Say what happens
   * next and how fast — it is the only promise the email makes.
   */
  emailResponsePromise: string
  /** Lines under the email card. A street address belongs here once there is one. */
  emailFooterLines: string[]
  /**
   * gofuse host root, no trailing slash. Optional: a site whose quoting
   * integration already points at one instance leaves it unset and the calls
   * go wherever that integration is configured.
   */
  baseUrl?: string
  /** Server-only gofuse API key. Optional for the same reason as `baseUrl`. */
  token?: string | undefined
  /** GetOutsend key both emails below are sent with. */
  getoutsendApiKey?: string | undefined
  /**
   * Which storage variants this market sells, in the order the form offers
   * them. Declared here because gofuse has no indoor/outdoor concept at all —
   * both collapse to its single "store-it" service — so the catalog cannot
   * answer this and the form has to be told.
   */
  storageOptions: ReadonlyArray<'indoor' | 'outdoor'>
  /**
   * The wording of the customer's email.
   *
   * {firstName}, {brand} and {phone} are filled in per submission. Delete one
   * and that value simply stops appearing — nothing breaks.
   */
  clientCopy: {
    heading: string
    greeting: string
    requestTitle: string
    pricingNote: string
    bookingNote: string
    ctaLabel: string
  }
  /** The wording of the internal new-lead email. {name} is the lead's. */
  adminCopy: {
    heading: string
    subheading: string
    requestTitle: string
    noPricingNote: string
    replyLabel: string
    callLabel: string
    footer: string
  }
  /** Quote confirmation to the person who filled in the form. */
  clientEmail: EmailEnvelope
  /** Internal new-lead notification, with the full submission and pricing. */
  adminEmail: EmailEnvelope
  /**
   * A ZIP this location is known to cover, submitted by the daily check.
   * Without one the check skips this location and says so, rather than
   * inventing an address and reporting a failure that is ours, not the site's.
   */
  canaryZip?: string
  /** CRM destination, and the only keys it understands. */
  webhook: {
    /**
     * Deliberately not read from the environment: a stale variable once sent a
     * correct payload to a webhook that could not map it, and the lead was
     * rejected with no visible error on the site. The URL and `keys` change
     * together or not at all.
     */
    url: string
    keys: WebhookKeys
  }
}

/** Wording shared by every market's emails. */
export interface EmailLabels {
  /** How a delivery date reads in an email. Webhook dates are unaffected. */
  dateFormat: DateFormat | string
  rows: {
    service: string
    name: string
    email: string
    phone: string
    deliveryDate: string
    deliveryZip: string
    relocationZip: string
    containerSize: string
    storage: string
  }
  pricing: {
    title: string
    firstMonthLabel: string
    monthlyAfterLabel: string
    monthlyAfterNote: string
    monthlyLabel: string
    startingAt: string
    feesSeparate: string
    dueSuffix: string
    afterFirstMonth: string
    discountExplainer: string
  }
}

/** Settings that belong to the site rather than to any one market. */
export interface SiteSettings {
  /** Whether the daily form check runs at all. */
  canaryEnabled: boolean
  /** Where the daily digest and the probe emails go. */
  canaryEmailTo: string
  /** Whether the check really delivers a quote email per market. */
  canarySendEmails: boolean
  /** Copied on every message the site sends, so nothing goes out unseen. */
  marketingCc: string
  /** Who receives a franchise enquiry. Sites without one leave it empty. */
  franchiseAdminTo: string[]
}

/**
 * What a site's config module must export, and what the console reads.
 *
 * `LOCATIONS` is keyed by slug even on a single-location site, so one code path
 * serves both and adding a second market is a data change rather than a
 * rewrite.
 */
export interface SiteConfigModule {
  LOCATIONS: Record<string, Location>
  EMAIL_LABELS: EmailLabels
  SITE_SETTINGS: SiteSettings
  /** Slugs in the order a ZIP is tried against them. Single-location: one. */
  ZIP_LOOKUP_ORDER?: string[]
}
