// Small pure readings of a gofuse catalog, used by the quoting adapter and the
// daily check. Nothing outside src/quoting imports this: it is the one place
// that knows what a container is, and a site that prices nothing never loads
// it.

/**
 * A gofuse product's size as a quote form names it: "16' × 8' × 8'" -> "16x8".
 *
 * The form's value travels a long way — it is the `container_size` on the
 * thank-you URL and, width-first, the box size on the CRM lead — so the label
 * has to keep the length-first shape those consumers already expect.
 * Dimensions read length × width × height, so the first two numbers are the
 * face the customer pictures; the product name is tried second because a few
 * catalog entries carry the size only there.
 */
export function containerSizeLabel(product: {
  dimensions?: string
  name?: string
}): string | null {
  for (const source of [product.dimensions, product.name]) {
    const nums = String(source ?? '').match(/\d+/g)
    if (nums && nums.length >= 2) return `${Number(nums[0])}x${Number(nums[1])}`
  }
  return null
}

/** "20x8" -> 20. The form's sizes lead with the length in feet. */
export function lengthFromContainerSize(
  containerSize: string | null | undefined
): number | null {
  const n = Number(/(\d+)/.exec(containerSize ?? '')?.[1])
  return Number.isFinite(n) && n > 0 ? n : null
}

const FEET = /(\d+(?:\.\d+)?)\s*(?:'|ft\b|feet\b)/gi

/** The longest dimension in feet, and the cubic feet when all three are given. */
export function parseDimensions(dimensions: string | null | undefined): {
  lengthFt: number | null
  cuft: number | null
} {
  if (!dimensions) return { lengthFt: null, cuft: null }
  const parts = [...dimensions.matchAll(FEET)].map((m) => Number(m[1])).filter((n) => n > 0)
  if (!parts.length) return { lengthFt: null, cuft: null }
  const lengthFt = Math.max(...parts)
  const cuft = parts.length >= 3 ? parts.slice(0, 3).reduce((a, b) => a * b, 1) : null
  return { lengthFt, cuft }
}

export interface SelectedProduct {
  id: number
  name: string
  lengthFt: number
  /**
   * gofuse's badge for this product's discount ("$50 OFF"), or null when the
   * catalog price and discounted price agree.
   */
  discountLabel: string | null
}

interface CatalogProductLike {
  id: number
  name: string
  price?: number
  discounted_price?: number
  dimensions?: string
  product_type?: string
  service_types?: string[]
  discount?: { label?: string }
}

/**
 * The product a service stocks at the requested length, chosen from an already
 * fetched catalog. Pure, so the fallback order can be exercised directly.
 *
 * When the form offered a size gofuse has no product for, falls to the largest
 * size below it and then to the smallest stocked — the same order of preference
 * the thank-you page uses, so the email and the page agree on the container.
 */
export function selectProductForSize({
  products,
  serviceType,
  productType,
  containerSize,
}: {
  products: CatalogProductLike[]
  serviceType: string
  productType: string
  containerSize: string | null | undefined
}): SelectedProduct | null {
  const requestedLength = lengthFromContainerSize(containerSize)
  if (requestedLength == null) return null

  const candidates = products
    .filter(
      (p) =>
        p.service_types?.includes(serviceType) &&
        (!p.product_type || p.product_type === productType)
    )
    .map((p) => {
      // gofuse sets discounted_price to the plain price when nothing is
      // discounted and omits has_discount from the catalog, so the gap between
      // the two is the only reliable signal that a discount applies.
      const charged = typeof p.discounted_price === 'number' ? p.discounted_price : p.price
      const discounted = typeof p.price === 'number' && p.price > (charged ?? 0)
      return {
        id: p.id,
        name: p.name,
        lengthFt: parseDimensions(p.dimensions).lengthFt,
        discountLabel: discounted ? (p.discount?.label ?? null) : null,
      }
    })
    .filter((p): p is SelectedProduct => p.lengthFt != null)
    .sort((a, b) => a.lengthFt - b.lengthFt)

  if (candidates.length === 0) return null

  return (
    candidates.find((p) => p.lengthFt === requestedLength) ??
    candidates.filter((p) => p.lengthFt <= requestedLength).pop() ??
    candidates[0]
  )
}
