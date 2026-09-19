import * as React from 'react'
import { RefreshCw } from 'lucide-react'
import { Button } from '../components/ui/button.tsx'
import { api } from './api.ts'
import { DATE_FORMATS, formatDateAs } from '../dateFormats.ts'

/**
 * The real email, editable in place.
 *
 * The server renders it with every editable string wrapped in [data-copy-key]
 * and every injected value in [data-var], so what you click is the message that
 * would be sent rather than a mock of it. Injected values are chips you can
 * move or delete but not retype — the lead decides those — and the dated one
 * opens a picker of worked examples, because how a date reads is a choice too.
 *
 * Everything here happens inside the iframe's own document, which is why the
 * styles are injected rather than written in Tailwind: the frame has none of
 * this page's CSS, and it must not, or the preview would stop looking like the
 * email.
 */

const SAMPLE = '10/01/2026'

/**
 * Reads a template back out of an edited node.
 *
 * Node type numbers rather than instanceof: these nodes belong to the iframe's
 * realm, so `node instanceof HTMLElement` is false here and every placeholder
 * chip would be silently dropped.
 */
function serialise(el: Element): string {
  let out = ''
  el.childNodes.forEach((node) => {
    if (node.nodeType === 3) {
      out += node.textContent ?? ''
    } else if (node.nodeType === 1) {
      const child = node as Element
      const v = child.getAttribute('data-var')
      out += v ? `{${v}}` : serialise(child)
    }
  })
  // Contenteditable inserts non-breaking spaces; the config wants plain ones.
  return out.replace(/ /g, ' ').replace(/\s+/g, ' ').trim()
}

const FRAME_CSS = `
  [data-copy-key] {
    outline: 1px dashed rgba(176,138,62,.55);
    outline-offset: 3px;
    border-radius: 3px;
    cursor: text;
  }
  [data-copy-key]:hover { background: rgba(176,138,62,.10); }
  [data-copy-key]:focus { outline: 2px solid #B08A3E; background: rgba(176,138,62,.08); }
  [data-copy-key][data-shared] { outline: 1px dashed rgba(37,99,235,.5); }
  [data-copy-key][data-shared]:hover { background: rgba(37,99,235,.10); }
  [data-copy-key][data-shared]:focus { outline: 2px solid #2563eb; background: rgba(37,99,235,.08); }
  [data-var] {
    background: rgba(100,116,139,.14);
    border-radius: 4px;
    padding: 0 3px;
    cursor: default;
  }`

const SELECT_CSS =
  'font:inherit;padding:3px 26px 3px 8px;border:1px solid #2563eb;' +
  'border-radius:5px;background-color:#fff;appearance:none;' +
  '-webkit-appearance:none;-moz-appearance:none;cursor:pointer;' +
  "background-image:url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 8'%3E%3Cpath fill='none' stroke='%232563eb' stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round' d='M1 1.5 6 6.5l5-5'/%3E%3C/svg%3E\");" +
  'background-repeat:no-repeat;background-position:right 8px center;background-size:10px 7px;'

export function MailPreview({
  slug,
  kind,
  dateFormat,
  onCopyChange,
  onDateFormatChange,
}: {
  slug: string
  kind: 'client' | 'admin'
  dateFormat: string
  /** A [data-copy-key] was edited: its key and the template read back out. */
  onCopyChange: (key: string, template: string) => void
  onDateFormatChange: (format: string) => void
}) {
  const frame = React.useRef<HTMLIFrameElement>(null)
  const [html, setHtml] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)
  const [loading, setLoading] = React.useState(true)

  // The handlers are read through a ref so re-rendering the parent never has to
  // re-wire the iframe, which would lose the caret mid-edit.
  const handlers = React.useRef({ onCopyChange, onDateFormatChange, dateFormat })
  handlers.current = { onCopyChange, onDateFormatChange, dateFormat }

  const load = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    const { data, error } = await api<{ html: string }>('preview', { slug, kind })
    setLoading(false)
    if (error) return setError(error.message)
    setHtml(data?.html ?? '')
  }, [slug, kind])

  React.useEffect(() => {
    void load()
  }, [load])

  const wire = React.useCallback(() => {
    const doc = frame.current?.contentDocument
    if (!doc) return
    const style = doc.createElement('style')
    style.textContent = FRAME_CSS
    doc.head?.appendChild(style)

    const sample = (format: string) => formatDateAs(SAMPLE, format)

    doc.querySelectorAll('[data-date]').forEach((el) => {
      const chip = el as HTMLElement
      chip.style.cursor = 'pointer'
      chip.style.textDecoration = 'underline dotted'
      chip.addEventListener('click', () => {
        if (chip.dataset.picking) return
        chip.dataset.picking = '1'
        const select = doc.createElement('select')
        select.style.cssText = SELECT_CSS
        DATE_FORMATS.forEach((f) => {
          const option = doc.createElement('option')
          option.value = f
          option.textContent = `${sample(f)}   —   ${f}`
          if (f === handlers.current.dateFormat) option.selected = true
          select.appendChild(option)
        })
        const restore = () => {
          delete chip.dataset.picking
          select.replaceWith(chip)
        }
        select.addEventListener('change', () => {
          handlers.current.onDateFormatChange(select.value)
          // The chip being edited is out of the document right now — it was
          // swapped for this select — so it is retexted directly, and only then
          // put back. Any other date chip is still in the document.
          chip.textContent = sample(select.value)
          restore()
          doc.querySelectorAll('[data-date]').forEach((other) => {
            ;(other as HTMLElement).textContent = sample(select.value)
          })
        })
        select.addEventListener('blur', restore)
        chip.replaceWith(select)
        select.focus()
      })
    })

    doc.querySelectorAll('[data-copy-key]').forEach((el) => {
      const key = el.getAttribute('data-copy-key') as string
      const node = el as HTMLElement
      node.setAttribute('contenteditable', 'true')
      node.spellcheck = true
      node.addEventListener('input', () => {
        handlers.current.onCopyChange(key, serialise(node))
      })
      // Enter would insert a <div>; these are all single-line strings.
      node.addEventListener('keydown', (event) => {
        if ((event as KeyboardEvent).key === 'Enter') {
          event.preventDefault()
          node.blur()
        }
      })
    })
  }, [])

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs leading-relaxed text-muted-foreground">
          Click any outlined line to edit it. Grey chips are filled in per submission — keep or
          delete them, and click the <span className="underline decoration-dotted">dated</span> one
          to change how dates read.{' '}
          <span className="font-semibold text-blue-600">Blue</span> lines are shared with every
          email.
        </p>
        <Button type="button" variant="ghost" size="sm" onClick={() => void load()}>
          <RefreshCw /> Reload
        </Button>
      </div>
      <div className="overflow-hidden rounded-lg border bg-muted/30">
        {error ? (
          <p className="p-4 text-sm text-destructive">{error}</p>
        ) : (
          <iframe
            ref={frame}
            title={`${kind} email preview`}
            srcDoc={html}
            onLoad={wire}
            className="h-[560px] w-full bg-white"
            style={{ opacity: loading ? 0.4 : 1 }}
          />
        )}
      </div>
    </div>
  )
}
