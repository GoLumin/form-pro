// The one email design every site in this family sends, ported from Mule Box
// of Austin.
//
// Every message a site sends — both lead emails and the daily digest —
// is built from the pieces below, so there is a single place to change how our
// mail looks. Table-based layout with inline styles throughout: that is still
// the only markup Outlook and Gmail render the same way.

const FONT_STACK =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif"

/** Austin's palette, kept exactly. */
export const COLORS = {
  /** Header band. */
  navy: '#1A2E3B',
  /** Eyebrows and small-caps labels. */
  gold: '#B08A3E',
  /** Buttons and links. */
  crimson: '#882435',
  ink: '#1A1A25',
  muted: '#6B7280',
  faint: '#9CA3AF',
  page: '#FAFAFA',
  card: '#ffffff',
  cardBorder: '#EFEFEF',
  divider: '#F3F3F5',
  dividerSoft: '#F0F0F2',
  /** Tinted band behind a details block. */
  tint: '#FAFBFC',
  /** The pricing callout. */
  cream: '#FAF9F7',
  creamBorder: '#EFEBE4',
} as const

/**
 * Form fields are customer-supplied and land in an HTML document, so escape
 * before interpolating. Every helper here escapes its own text; callers passing
 * raw HTML use the *Html variants and are responsible for it.
 */
export function esc(value: string): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * Formats a CENTS amount. Pricing back ends return every price and fee in cents, so the
 * conversion happens here rather than earlier, where rounding to whole dollars
 * would quietly drop a half-dollar price.
 */
export function money(cents: number): string {
  return (cents / 100).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })
}

export { DATE_FORMATS, formatDateAs as formatEmailDate } from '../dateFormats.ts'
export type { DateFormat } from '../dateFormats.ts'

/** `tel:` href — digits only, so mail clients dial it. */
export function telHref(phone: string): string {
  return `tel:${String(phone).replace(/[^\d+]/g, '')}`
}

/**
 * A label/value line. `valueHtml` is inserted raw; escape it yourself.
 * `rawLabel` does the same for the label, which the editor's preview needs.
 */
export function row(
  label: string,
  valueHtml: string,
  note?: string,
  rawLabel = false
): string {
  return `
              <tr>
                <td style="padding:10px 0;border-bottom:1px solid ${COLORS.divider};font-size:14px;color:${COLORS.muted};width:140px;">${rawLabel ? label : esc(label)}${
                  note
                    ? `<span style="display:block;font-size:12px;color:${COLORS.faint};">${esc(note)}</span>`
                    : ''
                }</td>
                <td style="padding:10px 0;border-bottom:1px solid ${COLORS.divider};text-align:right;font-size:14px;font-weight:600;color:${COLORS.ink};">${valueHtml}</td>
              </tr>`
}

/** The same line, with the value escaped for you. */
export const textRow = (label: string, value: string, note?: string) =>
  row(label, esc(value), note)

/** Small-caps gold heading above a block. */
export function eyebrow(text: string, raw = false): string {
  return `<p style="margin:0 0 6px;font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:${COLORS.gold};">${raw ? text : esc(text)}</p>`
}

/**
 * A block of label/value rows on the tinted band, under a gold heading.
 * `rowsHtml` comes from row()/textRow().
 */
export function detailsBlock(title: string, rowsHtml: string, raw = false): string {
  return `
        <tr>
          <td style="background-color:${COLORS.tint};padding:24px 40px 12px;">
            ${eyebrow(title, raw)}
            <table width="100%" cellpadding="0" cellspacing="0" border="0">${rowsHtml}
            </table>
          </td>
        </tr>`
}

/** A paragraph on the white card. */
export function paragraph(text: string, topPad = 24, raw = false): string {
  return `
        <tr>
          <td style="background-color:${COLORS.card};padding:${topPad}px 40px 0;">
            <p style="margin:0;font-size:15px;line-height:1.65;color:${COLORS.muted};">${raw ? text : esc(text)}</p>
          </td>
        </tr>`
}

/** A small grey note, for disclaimers that sit under a block. */
export function footnote(text: string, raw = false): string {
  return `
        <tr>
          <td style="background-color:${COLORS.card};padding:10px 40px 0;">
            <p style="margin:0;font-size:12px;line-height:1.6;color:${COLORS.faint};">${raw ? text : esc(text)}</p>
          </td>
        </tr>`
}

export interface ShellButton {
  label: string
  href: string
  /** Secondary buttons render navy instead of crimson. */
  secondary?: boolean
  /** The label is already-escaped HTML — used by the editor's preview. */
  raw?: boolean
}

/** One or more buttons on their own row. */
export function buttons(items: ShellButton[], background = COLORS.card): string {
  if (items.length === 0) return ''
  const html = items
    .map(
      (b) =>
        `<a href="${esc(b.href)}" style="display:inline-block;background-color:${
          b.secondary ? COLORS.navy : COLORS.crimson
        };color:#ffffff;font-size:14px;font-weight:700;text-decoration:none;padding:13px 26px;border-radius:10px;margin:0 8px 8px 0;">${b.raw ? b.label : esc(b.label)}</a>`
    )
    .join('')
  return `
        <tr>
          <td style="background-color:${background};padding:26px 40px 8px;">${html}</td>
        </tr>`
}

export interface ShellOptions {
  /** Shown above the headline in the navy band — the market, usually. */
  brand: string
  /** The headline in the navy band. */
  heading: string
  /** One line under the headline, inside the band. */
  subheading?: string
  logoUrl: string
  /** Alt text on the logo and the document title. */
  title: string
  /** The rows between the band and the footer, built from the helpers above. */
  bodyHtml: string
  /** `brand`, `heading` and `subheading` are already-escaped HTML. */
  rawHeadings?: boolean
  /** `footerLines` are already-escaped HTML. */
  rawFooter?: boolean
  /** Lines under the card. An address belongs here when a market has one. */
  footerLines: string[]
  /**
   * Hidden preview text — what an inbox shows next to the subject. Falls back
   * to the subheading, which is the first thing the reader sees anyway.
   */
  preheader?: string
}

export function emailShell({
  brand,
  heading,
  subheading,
  logoUrl,
  title,
  bodyHtml,
  footerLines,
  preheader,
  rawHeadings,
  rawFooter,
}: ShellOptions): string {
  const text = (v: string) => (rawHeadings ? v : esc(v))
  // The preheader is plain inbox text, so it never carries markup.
  const preview = (preheader ?? subheading ?? '').replace(/<[^>]*>/g, '')
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<meta name="color-scheme" content="light"/>
<title>${esc(title)}</title>
</head>
<body style="margin:0;padding:0;background-color:${COLORS.page};font-family:${FONT_STACK};">
${preview ? `<span style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(preview)}</span>` : ''}
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${COLORS.page};">
  <tr>
    <td align="center" style="padding:32px 16px;">
      <table width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;">

        <tr>
          <td style="padding:0 0 24px;text-align:center;">
            <img src="${esc(logoUrl)}" alt="${esc(title)}" width="152" style="display:inline-block;height:auto;border:0;outline:none;text-decoration:none;"/>
          </td>
        </tr>

        <tr>
          <td style="background-color:${COLORS.card};border-radius:20px;overflow:hidden;border:1px solid ${COLORS.cardBorder};">
            <table width="100%" cellpadding="0" cellspacing="0" border="0">

              <tr>
                <td style="background-color:${COLORS.navy};padding:36px 40px;">
                  <p style="margin:0 0 10px;font-size:11px;font-weight:700;letter-spacing:2.5px;text-transform:uppercase;color:${COLORS.gold};">${text(brand)}</p>
                  <p style="margin:0${subheading ? ' 0 6px' : ''};font-size:24px;font-weight:800;letter-spacing:-0.5px;color:#ffffff;">${text(heading)}</p>
                  ${
                    subheading
                      ? `<p style="margin:0;font-size:14px;line-height:1.6;color:rgba(255,255,255,0.72);">${text(subheading)}</p>`
                      : ''
                  }
                </td>
              </tr>
${bodyHtml}
              <tr>
                <td style="background-color:${COLORS.card};height:36px;font-size:0;line-height:0;">&nbsp;</td>
              </tr>

            </table>
          </td>
        </tr>

        <tr>
          <td style="padding:24px 24px 8px;text-align:center;">
            <p style="margin:0;font-size:12px;line-height:1.7;color:${COLORS.faint};">${footerLines
              .map((line) => (rawFooter ? line : esc(line)))
              .join('<br/>')}</p>
          </td>
        </tr>

      </table>
    </td>
  </tr>
</table>
</body>
</html>`
}
