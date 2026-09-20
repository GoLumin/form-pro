// Which profile handles a submission. Everything a profile *is* — its
// envelopes, its copy, its CRM webhook and keys — is declared in the site's own
// config; this file only decides which of them applies.
//
// A site with one profile never leaves it, so the lookup below costs it
// nothing. The other strategies exist because a value typed on one page may
// belong to another profile, and the lead must be emailed and filed by the
// profile that actually owns it.

import { PROFILES, ROUTING } from 'virtual:form-pro/config'
import type { Lead } from './fields.ts'
import type { Profile, RoutingConfig } from './types.ts'

export function getProfile(slug: string | null | undefined): Profile | null {
  if (!slug) return null
  return PROFILES[slug.replace(/^\/+|\/+$/g, '')] ?? null
}

export function allProfiles(): Profile[] {
  return Object.values(PROFILES)
}

/** The only profile, when a site has exactly one. */
export function soleProfile(): Profile | null {
  const all = allProfiles()
  return all.length === 1 ? all[0] : null
}

/**
 * The site's strategy, defaulted.
 *
 * A site with one profile has nothing to route between and should not have to
 * say so; one with several is assumed to give each its own page until it says
 * otherwise. Both defaults answer without a network call, which is the right
 * behaviour for a site that has not opted into one.
 */
export function routing(): RoutingConfig {
  if (ROUTING) return ROUTING
  return soleProfile() ? { kind: 'single' } : { kind: 'page' }
}

/** The order profiles are asked in; the first that covers a value wins. */
function lookupOrder(config: Extract<RoutingConfig, { kind: 'lookup' }>): string[] {
  return config.order ?? Object.keys(PROFILES)
}

/** A value long enough to be worth looking up. */
export function isLookupReady(value: string, config: RoutingConfig): boolean {
  if (config.kind !== 'lookup') return true
  return value.trim().length >= (config.minLength ?? 1)
}

/**
 * The profile that covers `value`, or `null` when none do.
 *
 * A profile whose probe errors is skipped rather than failing the lookup: one
 * back end being down shouldn't hide a value that belongs to another. If every
 * probe errors the caller gets a rejection instead of a false "we don't serve
 * you", which would be the wrong thing to tell a visitor.
 */
export async function findProfileFor(
  value: string,
  config: Extract<RoutingConfig, { kind: 'lookup' }>,
  options: { skip?: string } = {}
): Promise<Profile | null> {
  const trimmed = value.trim()
  if (!isLookupReady(trimmed, config)) return null

  // `skip` drops a profile that has already been asked, so it is neither
  // re-queried nor counted towards the all-failed check below — otherwise a
  // page whose own profile answered "no" would mask the others being down and
  // the visitor would be told we don't cover them.
  const slugs = lookupOrder(config).filter((slug) => slug !== options.skip)

  let failures = 0

  for (const slug of slugs) {
    const profile = PROFILES[slug]
    if (!profile) continue
    try {
      if (await config.probe(trimmed, profile)) return profile
    } catch (error) {
      failures += 1
      console.error(`coverage lookup failed for ${slug}:`, error)
    }
  }

  if (slugs.length > 0 && failures === slugs.length) {
    throw new Error('Unable to check coverage right now')
  }

  return null
}

/**
 * The profile that should handle a submission, given the page it was made from
 * and what has been filled in. This is the single answer the form's coverage
 * check and the submit action both work from, so the profile named under the
 * deciding field is the profile that ends up emailing and filing the lead.
 *
 * A page keeps its own profile whenever that profile actually covers the value
 * — an in-area visitor is never handed off just because another profile also
 * covers it and is asked earlier. When the page's profile does not cover it,
 * the submission resolves by value exactly as one from a generic page does.
 *
 * Coverage that can't be determined falls back to the page's own profile rather
 * than refusing: a back end being down must not cost that profile a lead it
 * already had in hand. Null — "we don't handle this" — is returned only on a
 * real answer that no profile covers the value.
 */
export async function resolveProfile(
  pageSlug: string | null | undefined,
  values: Lead
): Promise<Profile | null> {
  const config = routing()

  // One profile and nothing to route between: it is always the answer.
  const sole = soleProfile()
  if (sole || config.kind === 'single') return sole ?? allProfiles()[0] ?? null

  const pageProfile = getProfile(pageSlug)
  if (config.kind === 'page') return pageProfile

  const value = String(values[config.field] ?? '').trim()
  if (!pageProfile) return findProfileFor(value, config)

  // Nothing to resolve against yet; the page's own profile is the right default
  // until the visitor has finished typing.
  if (!isLookupReady(value, config)) return pageProfile

  try {
    if (await config.probe(value, pageProfile)) return pageProfile
  } catch (error) {
    console.error(`coverage lookup failed for ${pageProfile.slug}:`, error)
    return pageProfile
  }

  try {
    return await findProfileFor(value, config, { skip: pageProfile.slug })
  } catch (error) {
    // Every other profile errored, so there is no answer to act on. The page's
    // own profile did say no, but handling the visitor where they started beats
    // turning them away on an outage.
    console.error('coverage lookup failed:', error)
    return pageProfile
  }
}
