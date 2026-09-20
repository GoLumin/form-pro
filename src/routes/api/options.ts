// Everything the form needs once a routing value is complete: which profile
// will handle it, and which options each of its choice fields actually offers.
//
// Server-side because a catalog-backed list usually needs a key that must not
// reach the browser. That is the point of routing it through here: the dropdown
// and the submission read the same source, so the form can no longer offer
// something the back end cannot accept.

import type { APIRoute } from 'astro'
import { authorize, json } from './_shared.ts'
import { FIELDS, QUOTING } from 'virtual:form-pro/config'
import { buildLead, optionsFor } from '../../fields.ts'
import { isLookupReady, resolveProfile, routing } from '../../routing.ts'
import { catalogOptionsFor, quotingEnabled } from '../../quoting/submission.ts'

export const prerender = false

interface Body {
  token?: string
  /** Whatever has been filled in so far, keyed by field id. */
  values?: Record<string, unknown>
  /** The page the form sits on, if any. */
  profileSlug?: string | null
}

export const POST: APIRoute = async (context) => {
  const checked = await authorize<Body>(context)
  if ('response' in checked) return checked.response
  const { values = {}, profileSlug } = checked.body

  const lead = buildLead(FIELDS, values)
  const config = routing()

  const empty = {
    served: false,
    slug: null,
    name: null,
    incomplete: true,
    fieldOptions: {} as Record<string, string[]>,
    catalog: null as null | { field: string; dependsOn: string; byValue: Record<string, string[]> },
  }

  if (config.kind === 'lookup' && !isLookupReady(String(lead[config.field] ?? ''), config)) {
    return json(empty)
  }

  const profile = await resolveProfile(profileSlug, lead)
  if (!profile) return json({ ...empty, incomplete: false })

  // What this profile sells, as the config declares it: the general case, and
  // the only one on a site with no catalog behind it.
  const fieldOptions: Record<string, string[]> = {}
  for (const field of FIELDS) {
    if (field.type !== 'choice') continue
    fieldOptions[field.id] = optionsFor(field, profile.fieldOptions?.[field.id]).map(
      (o) => o.value
    )
  }

  let catalog = empty.catalog
  if (QUOTING?.catalogOptions && quotingEnabled()) {
    try {
      catalog = {
        ...QUOTING.catalogOptions,
        byValue: await catalogOptionsFor({ profile, fields: FIELDS, lead, config: QUOTING }),
      }
    } catch (error) {
      // The form shows no options and the visitor cannot pick one, which is the
      // honest outcome: without the catalog we do not know what this profile
      // stocks, and guessing would offer something it cannot price.
      console.error(`catalog lookup failed for ${profile.slug}:`, error)
    }
  }

  return json({
    served: true,
    slug: profile.slug,
    name: profile.name,
    incomplete: false,
    fieldOptions,
    catalog,
  })
}
