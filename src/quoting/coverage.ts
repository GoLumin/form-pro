// Coverage, asked of a quoting instance.
//
// A ProfileProbe for the `lookup` routing strategy, for the common case where
// "does this profile handle that value" is a question the profile's own pricing
// back end can answer. A site whose answer lives somewhere else writes its own
// probe — it is one function — and never imports this.

import type { ProfileProbe } from '../types.ts'

/**
 * Asks each profile's instance whether it serves a ZIP.
 *
 * A profile with no instance of its own is on a site whose quoting integration
 * already points at one; there is nothing to choose between, so it serves
 * whatever that instance serves.
 */
export function zipCoverageProbe(): ProfileProbe {
  return async (zip, profile) => {
    const baseUrl = profile.quoting?.baseUrl
    if (!baseUrl) return true
    const response = await fetch(
      `${baseUrl}/zip_codes/fetch?zip=${encodeURIComponent(zip)}`
    )
    if (!response.ok) {
      throw new Error(`${profile.slug} ZIP lookup failed (${response.status})`)
    }
    // The endpoint answers with a bare `true` / `false` JSON body.
    return (await response.json()) === true
  }
}
