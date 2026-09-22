// The shapes a site declares in its own config module.
//
// The package owns these types and the machinery that reads them; it never owns
// the values. Those live in the repository that deploys, because that is the
// file the console edits and commits — and because one profile's credentials,
// its envelopes and its CRM keys only work as a set, and the set belongs to the
// site that sends them.
//
// Nothing here knows what a site's form asks. What it collects is declared as
// FIELDS (see ./fields.ts) and everything below reads that list: a webhook key
// draws from a field id, an email row is a field's label beside its value, and
// the console builds its test submission from the same declaration. Adding a
// field is a change in the site's config and nowhere else.

import type { DateFormat } from './dateFormats.ts'
import type { FieldDef, FieldIdOf, Lead } from './fields.ts'

export type { FieldDef, FieldOption, FieldType, Lead, FieldIdOf } from './fields.ts'

/**
 * Named reshapes a webhook key can ask for.
 *
 * `date:*` writes a date the way that CRM's field mapping expects. It is
 * spelled out on every date key rather than left implicit, so the format is
 * visible and changeable instead of being whatever the form happened to
 * produce.
 */
export type WebhookTransform = 'widthFirst' | `date:${DateFormat}`

/**
 * What one webhook key is filled with.
 *
 * `{ value }`            a constant, e.g. a Source column that is always "Website"
 * `{ from }`             copied straight off the lead, by field id
 * `{ from, as }`         translated — a lookup table of the CRM's own
 *                        vocabulary, or a named transform
 * `{ from, whenEmpty }`  what to send when the lead has no value for it; without
 *                        it an absent field is sent as ''
 */
export type WebhookValue =
  | { value: string }
  | {
      /** A field id from the site's FIELDS. */
      from: string
      as?: Record<string, string> | WebhookTransform
      whenEmpty?: string
    }

/** Exactly the keys one CRM webhook accepts, and what fills them. */
export type WebhookKeys = Record<string, WebhookValue>

/**
 * One outgoing email's envelope. The body is built by the shared templates;
 * only who it comes from and goes to lives here.
 */
export interface EmailEnvelope {
  /** Display name shown in the inbox. */
  fromName: string
  /**
   * The sending address. Its domain MUST be verified in the account this
   * profile's `mailApiKey` belongs to, or the send is rejected outright.
   */
  fromAddress: string
  /** Recipients. Use LEAD_EMAIL for "whoever submitted the form". */
  to: string[]
  /** Copied recipients, visible to everyone on the message. */
  ccs: string[]
}

/**
 * One destination a submission can resolve to: who it is emailed as, who is
 * told about it, and which CRM it is filed in.
 *
 * A site with one form and one inbox declares one profile and never thinks
 * about it again. A site that serves several markets, brands or business units
 * declares one each — nothing else about the shape changes, and which profile
 * applies is decided by ROUTING rather than by anything in here.
 */
export interface Profile {
  /** Route segment and config key. On a single-profile site, anything stable. */
  slug: string
  /** Human label, used on the lead email and in the console. */
  name: string
  /**
   * Brand wording for email subjects. Separate from `name` because the subject
   * line is customer-facing copy that has usually already been agreed on, not a
   * label we are free to reword.
   */
  emailBrand: string
  /** Number shown to the client and used for the call-to-action. */
  phoneNumber: string
  /**
   * The line under the headline of the client's email. Say what happens next
   * and how fast — it is the only promise the email makes.
   */
  emailResponsePromise: string
  /** Lines under the email card. A street address belongs here once there is one. */
  emailFooterLines: string[]
  /**
   * A colour to sit the email's logo on.
   *
   * The logo is rendered above the card, on the page's own near-white
   * background, which suits a mark drawn in dark ink. A brand whose logo is
   * white — or outlined in white for a dark header — disappears there, so it
   * declares the plate it needs and gets a padded panel of that colour
   * instead. Unset means the page background, which is what every site had
   * before this existed.
   */
  emailLogoBackground?: string
  /** Sending-account key both emails below go out with. */
  mailApiKey?: string | undefined
  /**
   * Which of a `choice` field's options this profile actually offers, keyed by
   * field id. A field left out here offers everything it declares.
   *
   * This is where "this branch doesn't sell that" lives — the general form of a
   * per-market product list, kept beside the profile rather than in the field,
   * because the field is the same everywhere and the stock is not.
   */
  fieldOptions?: Record<string, readonly string[]>
  /**
   * The wording of the client's email.
   *
   * {brand} and {phone} are filled in from this profile, and any field id from
   * the submission. Delete one and that value simply stops appearing — nothing
   * breaks.
   */
  clientCopy: {
    heading: string
    greeting: string
    requestTitle: string
    pricingNote: string
    bookingNote: string
    ctaLabel: string
  }
  /** The wording of the internal new-lead email. */
  adminCopy: {
    heading: string
    subheading: string
    requestTitle: string
    noPricingNote: string
    replyLabel: string
    callLabel: string
    footer: string
  }
  /** Confirmation to the person who filled in the form. */
  clientEmail: EmailEnvelope
  /** Internal new-lead notification, with the full submission. */
  adminEmail: EmailEnvelope
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
  /**
   * What the daily check submits as this profile.
   *
   * Without it the check skips this profile and says so, rather than inventing
   * a submission and reporting a failure that is ours, not the site's.
   */
  canary?: {
    /** Field values to submit. Anything absent falls back to the field's sample. */
    values?: Lead
  }
  /**
   * Pricing back end for this profile, when the site has one at all. Optional
   * for the same reason quoting is: most forms do not price anything.
   */
  quoting?: {
    /** Instance root, no trailing slash. */
    baseUrl?: string
    /** Server-only API key. */
    token?: string | undefined
  }
}

/**
 * Asks whether one profile covers a value — the ZIP a visitor typed, say.
 *
 * A function rather than data, because coverage is a question only the site's
 * own back end can answer. The package ships one for a quoting instance (see
 * `zipCoverageProbe`); anything else is a few lines in the site's config.
 */
export type ProfileProbe = (value: string, profile: Profile) => Promise<boolean>

/**
 * Which profile handles a submission.
 *
 * `single`  the one profile, always. Nothing is asked and nothing can fail.
 * `page`    the page the form was submitted from names it, by slug.
 * `lookup`  one field's value decides: each profile is asked, in order, and the
 *           first that covers it wins. The page's own profile is preferred
 *           whenever it covers the value, so an in-area visitor is never handed
 *           off just because another profile was asked earlier.
 */
export type RoutingConfig =
  | { kind: 'single' }
  | { kind: 'page' }
  | {
      kind: 'lookup'
      /** The field id whose value decides. */
      field: string
      /** Slugs in the order they are asked. Defaults to declaration order. */
      order?: string[]
      probe: ProfileProbe
      /** A value shorter than this is not looked up yet. */
      minLength?: number
    }

/**
 * How a submission becomes a request to a pricing back end.
 *
 * Only a site that prices something declares this, and it is the whole of what
 * the quoting adapter knows about that site's fields: which one carries the
 * ZIP, which the date, which decides the service. The adapter knows gofuse; it
 * does not know what the form asks, and this is the join between the two.
 */
export interface QuotingConfig {
  /** The back end's service id for this submission. */
  serviceType: (lead: Lead) => string
  /** Its product family, where it has more than one. */
  productType?: string
  /** Which field carries each thing the quote call needs. */
  from: {
    zip: string
    destinationZip?: string
    size?: string
    date?: string
    name?: string
    email?: string
    phone?: string
  }
  /**
   * A choice field whose options come from the back end's catalog rather than
   * from the config, and the field whose value they depend on.
   *
   * This is what stops the form offering something the quote cannot price: the
   * dropdown and the quote read the same catalog.
   */
  catalogOptions?: { field: string; dependsOn: string }
  /** Where the visitor lands afterwards. */
  thankYouPath?: string
}

/** Wording shared by every profile's emails. */
export interface EmailLabels {
  /** How a date field reads in an email. Webhook dates are unaffected. */
  dateFormat: DateFormat | string
  /**
   * The subject line. `{brand}` is the profile's emailBrand; any field id is
   * filled in from the submission, a choice by its option label.
   */
  subjectTemplate: string
  /** Prefix on the internal copy, so the two are distinguishable in a thread. */
  adminSubjectPrefix?: string
  /**
   * Pricing block wording, for a site whose quoting integration returns
   * figures. Omitted entirely on a site that prices nothing.
   */
  pricing?: {
    title: string
    firstMonthLabel: string
    monthlyAfterLabel: string
    monthlyAfterNote: string
    monthlyLabel: string
    startingAt: string
    /** Beside a fee the quote states but does not collect up front. */
    billedLater: string
    feesSeparate: string
    dueSuffix: string
    afterFirstMonth: string
    discountExplainer: string
  }
}

/** Settings that belong to the site rather than to any one profile. */
export interface SiteSettings {
  /** Whether the daily form check runs at all. */
  canaryEnabled: boolean
  /** Where the daily digest and the probe emails go. */
  canaryEmailTo: string
  /** Whether the check really delivers an email per profile. */
  canarySendEmails: boolean
  /** Copied on every message the site sends, so nothing goes out unseen. */
  marketingCc: string
  /**
   * Who may sign in to the console, once the site has a database.
   *
   * Declared here rather than in the database so that adding someone is a
   * config change: it goes through the same review and deploy as everything
   * else the console edits, and who has access to a tool that commits to
   * production stays visible in the repository.
   *
   * Empty means nobody, which is the safe default — a site with no database
   * still has its shared password, so an empty list locks nothing out.
   */
  consoleUsers?: string[]
}

// -----------------------------------------------------------------------------
// Checked against one site's own fields
// -----------------------------------------------------------------------------
//
// The types above take a field id as a plain string, because the package cannot
// know what a site collects. The ones below take the site's own FIELDS and
// narrow every id to what that list actually declares — so a webhook key
// pointing at a field that was renamed or removed is a type error here rather
// than an empty column in the CRM, which is the failure this whole package
// exists to stop being invisible.
//
// Use them by declaring FIELDS `as const satisfies readonly FieldDef[]` and
// passing `typeof FIELDS`.

/** What one webhook key is filled with, drawn from `Id`. */
export type WebhookValueFor<Id extends string> =
  | { value: string }
  | { from: Id; as?: Record<string, string> | WebhookTransform; whenEmpty?: string }

/** A Profile whose every field reference is checked against the site's FIELDS. */
export type ProfileFor<F extends readonly FieldDef[]> = Omit<
  Profile,
  'webhook' | 'fieldOptions' | 'canary'
> & {
  webhook: { url: string; keys: Record<string, WebhookValueFor<FieldIdOf<F>>> }
  fieldOptions?: Partial<Record<FieldIdOf<F>, readonly string[]>>
  canary?: { values?: Partial<Record<FieldIdOf<F>, string>> }
}

/** Routing whose deciding field is checked against the site's FIELDS. */
export type RoutingConfigFor<F extends readonly FieldDef[]> =
  | { kind: 'single' }
  | { kind: 'page' }
  | {
      kind: 'lookup'
      field: FieldIdOf<F>
      order?: string[]
      probe: ProfileProbe
      minLength?: number
    }

/** Quoting whose every `from` is checked against the site's FIELDS. */
export type QuotingConfigFor<F extends readonly FieldDef[]> = Omit<
  QuotingConfig,
  'from' | 'catalogOptions'
> & {
  from: {
    zip: FieldIdOf<F>
    destinationZip?: FieldIdOf<F>
    size?: FieldIdOf<F>
    date?: FieldIdOf<F>
    name?: FieldIdOf<F>
    email?: FieldIdOf<F>
    phone?: FieldIdOf<F>
  }
  catalogOptions?: { field: FieldIdOf<F>; dependsOn: FieldIdOf<F> }
}

/**
 * What a site's config module must export, and what the console reads.
 *
 * `PROFILES` is keyed by slug even on a single-profile site, so one code path
 * serves both and adding a second is a data change rather than a rewrite.
 */
export interface SiteConfigModule {
  /** What the form collects. Declare it `as const` to get checked field ids. */
  FIELDS: readonly FieldDef[]
  PROFILES: Record<string, Profile>
  EMAIL_LABELS: EmailLabels
  SITE_SETTINGS: SiteSettings
  /** Defaults to `single` for one profile and `page` for several. */
  ROUTING?: RoutingConfig
  /** Only for a site that prices what it collects. */
  QUOTING?: QuotingConfig
}
