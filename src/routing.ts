// Which location quotes a submission. Everything a location *is* — its gofuse
// instance, its email envelopes, its CRM webhook and keys — is declared in the
// site's own config; this file only decides which of them applies.
//
// A single-location site never leaves its one entry, so the lookup below costs
// it nothing. The multi-market path exists because a ZIP typed on one market's
// page may belong to another, and the lead must be priced, emailed and filed by
// the market that actually serves the address.

import { LOCATIONS, ZIP_LOOKUP_ORDER } from 'virtual:form-pro/config'
import type { Location } from './types.ts'

export function getLocation(slug: string | null | undefined): Location | null {
  if (!slug) return null
  return LOCATIONS[slug.replace(/^\/+|\/+$/g, '')] ?? null
}

/** The order locations are asked in; the first that serves a ZIP wins. */
export function lookupOrder(): string[] {
  return ZIP_LOOKUP_ORDER
}

/** The only location, when a site has exactly one. */
export function soleLocation(): Location | null {
  const all = Object.values(LOCATIONS)
  return all.length === 1 ? all[0] : null
}

/** A ZIP is five digits; anything shorter can't be looked up yet. */
export function isCompleteZip(zip: string): boolean {
  return /^\d{5}$/.test(zip.trim())
}

/**
 * Asks one location's gofuse instance whether it serves `zip`.
 *
 * A location with no `baseUrl` of its own is on a site whose quoting
 * integration already points at one instance; there is nothing to choose
 * between, so it serves whatever that instance serves.
 */
async function locationServesZip(location: Location, zip: string): Promise<boolean> {
  if (!location.baseUrl) return true
  const response = await fetch(
    `${location.baseUrl}/zip_codes/fetch?zip=${encodeURIComponent(zip)}`
  )
  if (!response.ok) {
    throw new Error(`${location.slug} ZIP lookup failed (${response.status})`)
  }
  // The endpoint answers with a bare `true` / `false` JSON body.
  return (await response.json()) === true
}

/**
 * Resolves a ZIP to the location that serves it, or `null` when none do.
 *
 * A location whose instance errors is skipped rather than failing the lookup:
 * one backend being down shouldn't hide a ZIP that belongs to another. If every
 * instance errors the caller gets a rejection instead of a false "we don't
 * serve you", which would be the wrong thing to tell a visitor.
 */
export async function findQuoteLocationForZip(
  zip: string,
  options: { skip?: string } = {}
): Promise<Location | null> {
  const trimmed = zip.trim()
  if (!isCompleteZip(trimmed)) return null

  // `skip` drops a location that has already been asked, so it is neither
  // re-queried nor counted towards the all-failed check below — otherwise a
  // location page whose own market answered "no" would mask the others being
  // down and the visitor would be told we don't serve them.
  const slugs = lookupOrder().filter((slug) => slug !== options.skip)

  let failures = 0

  for (const slug of slugs) {
    const location = LOCATIONS[slug]
    if (!location) continue
    try {
      if (await locationServesZip(location, trimmed)) return location
    } catch (error) {
      failures += 1
      console.error(`ZIP lookup failed for ${slug}:`, error)
    }
  }

  if (slugs.length > 0 && failures === slugs.length) {
    throw new Error('Unable to check ZIP coverage right now')
  }

  return null
}

/**
 * The location that should quote a submission, given the page it was made from
 * and the delivery ZIP. This is the single answer the form's coverage check and
 * the quote action both work from, so the market named under the ZIP field is
 * the market that ends up pricing, emailing and posting the lead.
 *
 * A location page keeps its own market whenever that market actually covers the
 * ZIP — an in-area visitor is never handed off just because another market also
 * serves the ZIP and is asked earlier. When the page's market does not cover
 * it, the submission resolves by ZIP exactly as one from the home page does.
 *
 * Coverage that can't be determined falls back to the page's own market rather
 * than refusing: an instance being down must not cost that market a lead it
 * already had in hand. Null — "we don't serve this area" — is returned only on
 * a real answer that no location covers the ZIP.
 */
export async function resolveQuoteLocation(
  pageSlug: string | null | undefined,
  zip: string
): Promise<Location | null> {
  // One location and nothing to route between: it is always the answer, and a
  // coverage refusal stays where it already lives on those sites.
  const sole = soleLocation()
  if (sole) return sole

  const pageLocation = getLocation(pageSlug)
  if (!pageLocation) return findQuoteLocationForZip(zip)

  const trimmed = zip.trim()
  // Nothing to resolve against yet; the page's market is the right default
  // until the visitor has typed a full ZIP.
  if (!isCompleteZip(trimmed)) return pageLocation

  try {
    if (await locationServesZip(pageLocation, trimmed)) return pageLocation
  } catch (error) {
    console.error(`ZIP lookup failed for ${pageLocation.slug}:`, error)
    return pageLocation
  }

  try {
    return await findQuoteLocationForZip(trimmed, { skip: pageLocation.slug })
  } catch (error) {
    // Every other location errored, so there is no answer to act on. The page's
    // own market did say no, but quoting the visitor where they started beats
    // turning them away on an outage.
    console.error('ZIP coverage lookup failed:', error)
    return pageLocation
  }
}
