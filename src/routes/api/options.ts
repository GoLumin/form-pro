// Everything the form needs to know about a ZIP, in one call: whether we serve
// it, which location will quote it, the container sizes that location actually
// stocks, and which storage variants it sells.
//
// Server-side because the sizes come from gofuse, whose catalog needs a Bearer
// token that must not reach the browser. That is the point of routing it
// through here: the dropdown and the quote read the same catalog, so the form
// can no longer offer a size the quote cannot price.

import type { APIRoute } from 'astro'
import { authorize, json } from './_shared.ts'
import { getConfig } from 'virtual:form-pro/quoting'
import { containerSizeLabel, QUOTING_SERVICE_TYPE } from '../../catalog.ts'
import { isCompleteZip, resolveQuoteLocation } from '../../routing.ts'

export const prerender = false

interface Body {
  token?: string
  zip?: string
  /** The location page the form sits on, if any. */
  locationSlug?: string | null
}

export const POST: APIRoute = async (context) => {
  const checked = await authorize<Body>(context)
  if ('response' in checked) return checked.response
  const { zip = '', locationSlug } = checked.body

  const empty = {
    served: false,
    slug: null,
    name: null,
    incomplete: true,
    sizesByService: {} as Record<string, string[]>,
    storageOptions: [] as string[],
  }
  if (!isCompleteZip(zip)) return json(empty)

  const location = await resolveQuoteLocation(locationSlug, zip)
  if (!location) return json({ ...empty, incomplete: false })

  // Sizes for every service in one request, so switching tab doesn't cost
  // another round trip — the form already has the answer.
  const sizesByService: Record<string, string[]> = {}
  try {
    const config = await getConfig(
      { zip_code: zip.trim() },
      location.baseUrl ? { baseUrl: location.baseUrl, token: location.token } : undefined
    )
    for (const [formService, apiService] of Object.entries(QUOTING_SERVICE_TYPE)) {
      if (formService.startsWith('store_it_')) continue
      const sizes = new Set<string>()
      for (const product of config?.products ?? []) {
        if (!product.service_types?.includes(apiService)) continue
        if (product.product_type && product.product_type !== 'portable-storage') continue
        const label = containerSizeLabel(product)
        if (label) sizes.add(label)
      }
      sizesByService[formService] = [...sizes].sort(
        (a, b) => Number.parseInt(a, 10) - Number.parseInt(b, 10)
      )
    }
  } catch (error) {
    // The form shows "no sizes available" and the visitor cannot pick one,
    // which is the honest outcome: without the catalog we do not know what this
    // location stocks, and guessing would offer a box it cannot price.
    console.error(`catalog lookup failed for ${location.slug}:`, error)
  }

  return json({
    served: true,
    slug: location.slug,
    name: location.name,
    incomplete: false,
    sizesByService,
    storageOptions: [...location.storageOptions],
  })
}
