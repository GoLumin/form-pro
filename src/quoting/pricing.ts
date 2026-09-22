import type { CatalogProduct, QuoteConfig, QuotePreview, QuoteSettings } from "./runtime";

/**
 * Normalises a gofuse config + preview pair into the shape the thank-you page
 * renders.
 *
 * Money stays in CENTS end to end. gofuse stores and returns every amount in
 * cents (Product#price, Fee#amount, quote totals), so converting to dollars
 * here would round away real half-dollar prices; the browser formats at the
 * point of display instead.
 *
 * Nothing in this module invents a value. When gofuse has no product, no fee
 * or no label for something, the field is null and the page renders a
 * "call us" state rather than a made-up number.
 */

export interface TransitFee {
  name: string;
  /** Cents. Already multiplied out when gofuse flags the fee per_quantity. */
  amount: number;
  /** gofuse's own display_as_starting_at? — render an estimate prefix. */
  startingAt: boolean;
  /** Billed separately; not part of the up-front total. */
  excludedFromTotal: boolean;
}

export interface RecurringFee {
  name: string;
  amount: number;
}

export interface ProductView {
  id: number;
  name: string;
  /** Longest edge in feet, parsed from `dimensions`; the size selector key. */
  lengthFt: number | null;
  dimensions: string | null;
  /** Cubic feet, computed from `dimensions`; null when it can't be parsed. */
  cuft: number | null;
  /** Cents actually charged. */
  price: number;
  /** Cents before discount, only when gofuse is discounting this product. */
  originalPrice: number | null;
  discountLabel: string | null;
  idealFor: string[];
  imageUrl: string | null;
  /** gofuse's own flag for whether this price recurs monthly. */
  monthly: boolean;
}

export interface ServiceView {
  slug: string;
  name: string;
  products: ProductView[];
  recurringFees: RecurringFee[];
  transitFees: TransitFee[];
  /** Sum of recurring fees, cents. Added to the product price each month. */
  recurringTotal: number;
  /** One-time fees inside the up-front total, cents. */
  includedOneTime: number;
  /** One-time fees billed separately, cents. */
  excludedOneTime: number;
  /** gofuse's own total for this service, cents — used to verify our maths. */
  apiTotal: number | null;
  apiSubtotal: number | null;
  outOfAreaText: string | null;
  /** False when gofuse returned no catalog for this service. */
  available: boolean;
  /**
   * False when our total for gofuse's default product no longer equals the
   * total gofuse itself returned — a signal that the pricing rules changed.
   */
  totalsAgree: boolean;
}

const FEET = /(\d+(?:\.\d+)?)\s*(?:'|’|ft\b|foot\b|feet\b)/gi;

/** "16' × 8' × 8'" -> { lengthFt: 16, cuft: 1024 }. */
export function parseDimensions(dimensions: string | null | undefined): {
  lengthFt: number | null;
  cuft: number | null;
} {
  if (!dimensions) return { lengthFt: null, cuft: null };
  const parts = [...dimensions.matchAll(FEET)].map((m) => Number(m[1])).filter((n) => n > 0);
  if (!parts.length) return { lengthFt: null, cuft: null };
  const lengthFt = Math.max(...parts);
  const cuft = parts.length >= 3 ? parts.slice(0, 3).reduce((a, b) => a * b, 1) : null;
  return { lengthFt, cuft };
}

export function toProductView(p: CatalogProduct): ProductView {
  const { lengthFt, cuft } = parseDimensions(p.dimensions);
  // gofuse sets discounted_price to the plain price when nothing is discounted,
  // and omits `has_discount` from the catalog payload entirely, so the gap
  // between the two fields is the only reliable signal that a discount applies.
  const price = typeof p.discounted_price === "number" ? p.discounted_price : p.price;
  const discounted = typeof p.price === "number" && p.price > price;
  return {
    id: p.id,
    name: p.name,
    lengthFt,
    dimensions: p.dimensions ?? null,
    cuft,
    price,
    originalPrice: discounted ? p.price : null,
    discountLabel: discounted ? (p.discount?.label ?? null) : null,
    idealFor: Array.isArray(p.ideal_for) ? p.ideal_for : [],
    imageUrl: p.image_url ?? null,
    monthly: !!p.monthly,
  };
}

/**
 * Splits gofuse's fee list into recurring and one-time legs.
 *
 * `per_quantity` fees are stored per unit and multiplied by the quote's total
 * quantity when gofuse computes fees_total, so the same multiplication happens
 * here — otherwise a two-container quote would under-report its fees.
 */
export function extractFees(preview: QuotePreview | null | undefined): {
  recurring: RecurringFee[];
  transit: TransitFee[];
  recurringTotal: number;
  includedOneTime: number;
  excludedOneTime: number;
} {
  const fees = preview?.fees ?? [];
  const quantity = Math.max(1, preview?.total_quantity ?? 1);
  const amountOf = (f: (typeof fees)[number]) =>
    (typeof f.amount === "number" ? f.amount : 0) * (f.per_quantity ? quantity : 1);

  const recurring: RecurringFee[] = [];
  const transit: TransitFee[] = [];
  for (const f of fees) {
    if (f.recurring) {
      // A waiver zeroes a charge rather than adding one; it is shown in the
      // breakdown by gofuse's own web flow but never summed.
      if (/waiver/i.test(f.name)) continue;
      recurring.push({ name: f.name, amount: amountOf(f) });
    } else {
      // Excluded and hidden is gofuse saying this leg is not quoted here at
      // all, so listing it would put a figure on the page with nothing beside
      // it to say what it buys. Excluded but shown stays, and the page marks
      // it — the same rule the quote email applies, so the two surfaces of one
      // quote can never itemise it differently.
      if (f.excluded_from_total && f.excluded_shown === false) continue;
      transit.push({
        name: f.name,
        amount: amountOf(f),
        // gofuse already decides this: display_as_starting_at? is true for both
        // its "starting at" modes, including the one that stays in the total.
        startingAt: !!f.starting_at,
        excludedFromTotal: !!f.excluded_from_total,
      });
    }
  }

  const sum = (xs: { amount: number }[]) => xs.reduce((t, x) => t + x.amount, 0);
  return {
    recurring,
    transit,
    recurringTotal: sum(recurring),
    includedOneTime: sum(transit.filter((t) => !t.excludedFromTotal)),
    excludedOneTime: sum(transit.filter((t) => t.excludedFromTotal)),
  };
}

/**
 * The up-front figure for one product: its price, plus any recurring fee, plus
 * the one-time legs gofuse counts toward the total.
 *
 * gofuse's fee calculator keys off service type and ZIP only, never the
 * product, so one preview per service prices every product in that service.
 *
 * `product.price` is the discounted price where a promotion applies, which is
 * right here: the promotion is for the first month, and this is the month paid
 * up front. What recurs afterwards is `monthlyFor`.
 */
export function totalFor(service: ServiceView, product: ProductView): number {
  return product.price + service.recurringTotal + service.includedOneTime;
}

/**
 * The rate that recurs, cents.
 *
 * A gofuse product discount is a first-month promotion, so what recurs is the
 * undiscounted price; `firstMonthFor` covers the discounted month. Recurring
 * fees are never discounted and belong to both.
 */
export function monthlyFor(service: ServiceView, product: ProductView): number {
  return (product.originalPrice ?? product.price) + service.recurringTotal;
}

/** The discounted first month, cents — null when nothing is discounted. */
export function firstMonthFor(service: ServiceView, product: ProductView): number | null {
  return product.originalPrice != null ? product.price + service.recurringTotal : null;
}

/**
 * What the customer pays every month after the first.
 *
 * The undiscounted product price, because gofuse's product discount is a
 * first-month promotion — plus recurring fees, which are never discounted and
 * so appear in both this figure and the first month's.
 */
export function ongoingMonthlyFor(service: ServiceView, product: ProductView): number {
  return (product.originalPrice ?? product.price) + service.recurringTotal;
}

export function toServiceView(
  slug: string,
  name: string,
  config: QuoteConfig | null,
  preview: QuotePreview | null,
): ServiceView {
  const products = (config?.products ?? []).map(toProductView);
  const fees = extractFees(preview);
  const view: ServiceView = {
    slug,
    name,
    products,
    recurringFees: fees.recurring,
    transitFees: fees.transit,
    recurringTotal: fees.recurringTotal,
    includedOneTime: fees.includedOneTime,
    excludedOneTime: fees.excludedOneTime,
    apiTotal: typeof preview?.total === "number" ? preview.total : null,
    apiSubtotal: typeof preview?.subtotal === "number" ? preview.subtotal : null,
    outOfAreaText: preview?.out_of_area_zip_text?.trim() || null,
    available: products.length > 0,
    totalsAgree: true,
  };

  // A preview with no quantities prices gofuse's first catalogued product, so
  // its total is the one figure we can check ours against. If they ever part
  // company, gofuse has changed how it totals a quote and this page is now
  // showing a number gofuse would not.
  if (view.apiTotal != null && products[0]) {
    view.totalsAgree = totalFor(view, products[0]) === view.apiTotal;
  }
  return view;
}

/** The product a service offers at a given length, if any. */
export function productAtLength(service: ServiceView, lengthFt: number): ProductView | null {
  return service.products.find((p) => p.lengthFt === lengthFt) ?? null;
}

/** Every container length gofuse offers across the given services, ascending. */
export function lengthsAcross(services: ServiceView[]): number[] {
  const seen = new Set<number>();
  for (const s of services) {
    for (const p of s.products) if (p.lengthFt != null) seen.add(p.lengthFt);
  }
  return [...seen].sort((a, b) => a - b);
}

/** Customer-facing labels, each falling back to gofuse's own documented default. */
export function labelsFrom(settings: QuoteSettings | undefined | null) {
  return {
    products: settings?.product_price_label?.trim() || "Monthly recurring",
    fees: settings?.fees_price_label?.trim() || "Transit",
    total: settings?.total_price_label?.trim() || "Total",
    discountBadge: settings?.discount_badge_label?.trim() || null,
    qualifying: settings?.total_qualifying_text?.trim() || null,
    whatHappensNext: settings?.what_happens_next?.trim() || null,
    bookNowText: settings?.book_now_button_text?.trim() || null,
    bookNowLink: settings?.book_now_button_link?.trim() || null,
    phone: settings?.location_phone?.trim() || settings?.phone?.trim() || null,
  };
}

/**
 * Brand colours as configured in gofuse. The fallbacks are Mule Box red and
 * black, so the container render still looks right if the API is unreachable.
 */
export function brandFrom(settings: QuoteSettings | undefined | null) {
  return {
    primaryColor: settings?.primary_color?.trim() || "#8b2233",
    secondaryColor: settings?.secondary_color?.trim() || "#000000",
  };
}
