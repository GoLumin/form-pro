// The quoting client. Pure fetch over the gofuse API, with no Astro or host
// coupling — which is what lets the same file run on a Node server, in a
// Cloudflare Worker, and in a test.

export interface QuotingClientConfig {
  baseUrl: string;
  /**
   * The variable holding the API token. The token itself is deliberately NOT a
   * field here: it is read through `readEnv` at call time instead of baked into
   * the generated module, so there is no secret in the bundle to leak if the
   * module is ever imported from the browser — and so a token rotated in a
   * hosting dashboard takes effect on the next request rather than the next
   * deploy.
   */
  tokenEnv: string;
  /**
   * How to read an environment variable on this host. Node reads `process.env`;
   * a Cloudflare Worker's secrets only exist behind
   * `import { env } from 'cloudflare:workers'`, a specifier that resolves
   * nowhere else — so the site supplies the reader rather than this package
   * guessing at the runtime.
   */
  readEnv?: (name: string) => string | undefined;
}

export interface QuoteParams {
  service_type: string;
  product_type?: string;
  zip_code?: string;
  destination_zip_code?: string;
  full_name?: string;
  email?: string;
  phone?: string;
  delivery_date?: string;
  form_slug?: string;
  quantities?: Record<string, number>;
  idempotency_key?: string;
}

export interface QuoteProductLine {
  id: number;
  name: string;
  quantity: number;
  price: number;
  subtotal: number;
  has_discount: boolean;
  original_price: number;
  discounted_price: number;
  weekly: boolean;
  monthly: boolean;
}

export interface QuoteFeeLine {
  name: string;
  amount: number;
  per_quantity: boolean;
  excluded_from_total: boolean;
  starting_at: boolean;
  recurring: boolean;
}

export interface QuoteSettings {
  name?: string;
  logo_url?: string;
  phone?: string;
  location_phone?: string;
  call_now_label?: string;
  top_rated_label?: string;
  product_price_label?: string;
  fees_price_label?: string;
  total_price_label?: string;
  discount_badge_label?: string;
  copy_before_product_price?: string;
  total_qualifying_text?: string;
  what_happens_next?: string;
  book_now_button_text?: string;
  book_now_button_link?: string;
  show_pricing_breakdown?: boolean;
  primary_color?: string;
  secondary_color?: string;
}

export interface CatalogProduct {
  id: number;
  name: string;
  price: number;
  discounted_price: number;
  image_url?: string;
  dimensions?: string;
  ideal_for: string[];
  product_type?: string;
  product_type_name?: string;
  service_types: string[];
  for_sale: boolean;
  monthly: boolean;
  discount?: { name: string; label: string };
}

export interface QuoteReview {
  name: string;
  title?: string;
  content?: string;
  avatar_url?: string;
}

export interface QuoteFaq {
  question: string;
  answer?: string;
}

export interface QuoteConfig {
  settings: QuoteSettings;
  service_types: { slug: string; name: string }[];
  product_types: { slug: string; name: string }[];
  products: CatalogProduct[];
  reviews: QuoteReview[];
  faqs: QuoteFaq[];
}

export interface QuotePreview {
  products: QuoteProductLine[];
  fees: QuoteFeeLine[];
  subtotal: number;
  total: number;
  total_discount: number;
  fees_total: number;
  total_quantity: number;
  delivery_address?: string;
  relo_address?: string;
  out_of_area_zip_text?: string;
}

export interface QuoteRequestOverrides {
  baseUrl?: string;
  token?: string;
}

export function createQuotingClient(config: QuotingClientConfig) {
  const baseUrl = config.baseUrl.replace(/\/$/, "");

  /**
   * The token for this call, in the order a host can supply one.
   *
   * `||` rather than `??` at each step: a variable that is present but empty
   * (`QUOTING_API_TOKEN=` in a .env) is no token at all, and falling through to
   * the next source is what a person setting it in only one place expects.
   */
  function currentToken(override?: string): string | undefined {
    if (override) return override;
    let fromHost: string | undefined;
    try {
      fromHost = config.readEnv?.(config.tokenEnv);
    } catch {
      // A reader that is only valid on its own runtime — `cloudflare:workers`
      // outside a request, say — must not take the page down with it.
    }
    const fromNode =
      typeof process !== "undefined" ? process.env?.[config.tokenEnv] : undefined;
    const fromVite = (import.meta.env as Record<string, string | undefined>)[
      config.tokenEnv
    ];
    return fromHost || fromNode || fromVite || undefined;
  }

  function authHeaders(tokenOverride?: string): Record<string, string> {
    const token = currentToken(tokenOverride);
    if (!token) {
      throw new Error(
        `Missing Quoting API token — set \`${config.tokenEnv}\` in the environment, ` +
          "as a Worker secret, or pass a per-request override.",
      );
    }
    return { Accept: "application/json", Authorization: `Bearer ${token}` };
  }

  // Every quoting endpoint answers { data: … } on success and { error } or
  // { message } on failure, so unwrap one level when it is there.
  interface Envelope {
    data?: unknown;
    error?: string;
    message?: string;
  }

  async function unwrap<T>(res: Response): Promise<T> {
    const json = (await res.json().catch(() => ({}))) as Envelope;
    if (!res.ok) {
      throw new Error(json?.error || json?.message || `Quoting API ${res.status}`);
    }
    return (json?.data ?? json) as T;
  }

  async function post<T>(path: string, body: unknown, overrides?: QuoteRequestOverrides): Promise<T> {
    const res = await fetch(`${(overrides?.baseUrl ?? baseUrl).replace(/\/$/, "")}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders(overrides?.token) },
      body: JSON.stringify(body),
    });
    return unwrap<T>(res);
  }

  async function get<T>(path: string, overrides?: QuoteRequestOverrides): Promise<T> {
    const res = await fetch(`${(overrides?.baseUrl ?? baseUrl).replace(/\/$/, "")}${path}`, {
      headers: authHeaders(overrides?.token),
    });
    return unwrap<T>(res);
  }

  return {
    previewQuote(params: QuoteParams, overrides?: QuoteRequestOverrides): Promise<QuotePreview> {
      return post<QuotePreview>("/api/v1/quoting/preview", params, overrides);
    },

    createQuote(params: QuoteParams, overrides?: QuoteRequestOverrides): Promise<any> {
      return post<any>("/api/v1/quoting/quotes", params, overrides);
    },

    getQuote(uuid: string, overrides?: QuoteRequestOverrides): Promise<any> {
      return get<any>(`/api/v1/quoting/quotes/${encodeURIComponent(uuid)}`, overrides);
    },

    getForm(slug: string, overrides?: QuoteRequestOverrides): Promise<any> {
      return get<any>(`/api/v1/quoting/forms/${encodeURIComponent(slug)}`, overrides);
    },

    getConfig(
      params: { service_type?: string; product_type?: string; zip_code?: string } = {},
      overrides?: QuoteRequestOverrides,
    ): Promise<QuoteConfig> {
      const qs = new URLSearchParams(
        Object.entries(params).filter(([, v]) => v) as [string, string][],
      ).toString();
      return get<QuoteConfig>(`/api/v1/quoting/config${qs ? `?${qs}` : ""}`, overrides);
    },
  };
}

export type QuotingClient = ReturnType<typeof createQuotingClient>;
export function formatCents(cents: number | null | undefined): string {
  const value = (cents ?? 0) / 100;
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
    maximumFractionDigits: 2,
  });
}
