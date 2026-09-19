import * as React from 'react'
import { AlertTriangle, Loader2 } from 'lucide-react'
import { Button } from '../components/ui/button.tsx'
import { Checkbox } from '../components/ui/checkbox.tsx'
import { Input } from '../components/ui/input.tsx'
import { Label } from '../components/ui/label.tsx'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select.tsx'
import { Separator } from '../components/ui/separator.tsx'
import { api, boot } from './api.ts'
import type { SubmitResponse } from './types.ts'

/**
 * The submission form, with the same conditionals the real quote form has.
 *
 * Storage only appears on Store It, because that is the only service where the
 * indoor/outdoor split exists; the relocation ZIP only on Move It. A preview
 * that offered fields the form does not would report on a submission nobody can
 * actually make.
 */

interface Options {
  served: boolean
  incomplete: boolean
  name: string | null
  sizesByService: Record<string, string[]>
  storageOptions: string[]
}

const SERVICES = [
  ['keep_it', 'Keep It'],
  ['move_it', 'Move It'],
  ['store_it', 'Store It'],
] as const

export function QuoteForm({
  onResult,
  busy,
  setBusy,
}: {
  onResult: (r: SubmitResponse) => void
  busy: boolean
  setBusy: (b: boolean) => void
}) {
  const { markets, single, defaultDate } = boot()

  const HOME = '__home'
  const [locationSlug, setLocationSlug] = React.useState(
    single ? (markets[0]?.slug ?? HOME) : HOME
  )
  const pageSlug = locationSlug === HOME ? null : locationSlug
  const [serviceType, setServiceType] = React.useState<string>('keep_it')
  const [storeItType, setStoreItType] = React.useState('outdoor')
  const [containerSize, setContainerSize] = React.useState('')
  const [deliveryDate, setDeliveryDate] = React.useState(defaultDate)
  const [zip, setZip] = React.useState('')
  const [relocationZip, setRelocationZip] = React.useState('')
  const [firstName, setFirstName] = React.useState('Ada')
  const [lastName, setLastName] = React.useState('Lovelace')
  const [email, setEmail] = React.useState('ada@example.com')
  const [phone, setPhone] = React.useState('(555) 010-4142')
  const [liveQuote, setLiveQuote] = React.useState(true)
  const [reallySend, setReallySend] = React.useState(false)
  const [reallyPost, setReallyPost] = React.useState(false)

  const [options, setOptions] = React.useState<Options | null>(null)
  const [checking, setChecking] = React.useState(false)

  // The catalog is asked once per complete ZIP, and answers for every service
  // at once, so switching service costs no round trip.
  React.useEffect(() => {
    if (!/^\d{5}$/.test(zip.trim())) {
      setOptions(null)
      return
    }
    let cancelled = false
    setChecking(true)
    api<Options>('options', { zip: zip.trim(), locationSlug: pageSlug }).then(
      ({ data }) => {
        if (cancelled) return
        setChecking(false)
        setOptions(data)
      }
    )
    return () => {
      cancelled = true
    }
  }, [zip, pageSlug])

  const sizes = options?.sizesByService?.[serviceType] ?? []
  const storage = options?.storageOptions ?? []

  React.useEffect(() => {
    if (sizes.length && !sizes.includes(containerSize)) setContainerSize(sizes[0])
  }, [sizes.join(','), serviceType])

  React.useEffect(() => {
    if (storage.length && !storage.includes(storeItType)) setStoreItType(storage[0])
  }, [storage.join(',')])

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setBusy(true)
    const { data, error } = await api<SubmitResponse>('submit', {
      locationSlug: pageSlug,
      serviceType,
      storeItType: serviceType === 'store_it' && storage.length > 1 ? storeItType : undefined,
      firstName,
      lastName,
      email,
      phone,
      initialDeliveryZip: zip,
      finalDeliveryZip: serviceType === 'move_it' ? relocationZip : undefined,
      deliveryDate,
      selectedContainerType: containerSize,
      liveQuote,
      reallySend,
      reallyPost,
    })
    setBusy(false)
    if (error) {
      onResult({ served: false, message: error.message, notes: [] })
      return
    }
    if (data) onResult(data)
  }

  const section = (title: string, children: React.ReactNode) => (
    <div className="space-y-3">
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {title}
      </p>
      {children}
    </div>
  )

  return (
    <form onSubmit={submit} className="space-y-6">
      {section(
        "Where it's submitted from",
        <div className="space-y-2">
          <Label htmlFor="page">Page</Label>
          <Select value={locationSlug} onValueChange={setLocationSlug} disabled={single}>
            <SelectTrigger id="page" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {single ? (
                <SelectItem value={markets[0]?.slug ?? HOME}>
                  The quote form — {markets[0]?.name}
                </SelectItem>
              ) : (
                <>
                  <SelectItem value={HOME}>Home / any non-location page (ZIP decides)</SelectItem>
                  {markets.map((m) => (
                    <SelectItem key={m.slug} value={m.slug}>
                      /locations/{m.slug} — {m.name}
                    </SelectItem>
                  ))}
                </>
              )}
            </SelectContent>
          </Select>
        </div>
      )}

      <Separator />

      {section(
        'What they picked',
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="service">Service</Label>
            <Select value={serviceType} onValueChange={setServiceType}>
              <SelectTrigger id="service" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SERVICES.map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="size">Container</Label>
              <Select
                value={containerSize}
                onValueChange={setContainerSize}
                disabled={sizes.length === 0}
              >
                <SelectTrigger id="size" className="w-full">
                  <SelectValue placeholder={options ? 'No sizes here' : 'Enter a ZIP'} />
                </SelectTrigger>
                <SelectContent>
                  {sizes.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="date">Delivery date</Label>
              <Input
                id="date"
                type="date"
                value={deliveryDate}
                onChange={(e) => setDeliveryDate(e.target.value)}
              />
            </div>
          </div>

          {/* Only on Store It, and only where the market sells both. */}
          {serviceType === 'store_it' && storage.length > 1 && (
            <div className="space-y-2">
              <Label htmlFor="storage">Storage</Label>
              <Select value={storeItType} onValueChange={setStoreItType}>
                <SelectTrigger id="storage" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {storage.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s === 'indoor' ? 'Indoor' : 'Outdoor'}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="zip">Delivery ZIP</Label>
              <Input
                id="zip"
                inputMode="numeric"
                value={zip}
                onChange={(e) => setZip(e.target.value)}
                placeholder="75201"
              />
            </div>
            {serviceType === 'move_it' && (
              <div className="space-y-2">
                <Label htmlFor="relo">Relocation ZIP</Label>
                <Input
                  id="relo"
                  inputMode="numeric"
                  value={relocationZip}
                  onChange={(e) => setRelocationZip(e.target.value)}
                />
              </div>
            )}
          </div>

          <p className="text-xs leading-relaxed text-muted-foreground" aria-live="polite">
            {checking ? (
              <span className="inline-flex items-center gap-1.5">
                <Loader2 className="size-3 animate-spin" /> Checking coverage…
              </span>
            ) : options?.served ? (
              <>
                Served by <span className="font-medium text-foreground">{options.name}</span>. Sizes
                and storage above are that market's own.
              </>
            ) : options && !options.incomplete ? (
              <span className="text-destructive">No market serves this ZIP.</span>
            ) : (
              'Enter a five-digit ZIP to see who serves it and what they stock.'
            )}
          </p>
        </div>
      )}

      <Separator />

      {section(
        'Who they are',
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="first">First name</Label>
              <Input id="first" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="last">Last name</Label>
              <Input id="last" value={lastName} onChange={(e) => setLastName(e.target.value)} />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="phone">Phone</Label>
            <Input id="phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
        </div>
      )}

      <Separator />

      <div className="space-y-3">
        <Toggle
          id="live"
          checked={liveQuote}
          onChange={setLiveQuote}
          title="Ask gofuse for live pricing"
          hint="Creates a real quote on that market's instance, which is what gives the thank-you page its numbers. Off means no pricing block."
        />
        <Toggle
          id="send"
          checked={reallySend}
          onChange={setReallySend}
          danger
          title="Really send the emails"
          hint="Delivers to the real addresses shown on the right, the market's people included. Leave off to render and read them here."
        />
        <Toggle
          id="post"
          checked={reallyPost}
          onChange={setReallyPost}
          danger
          title="Really post the lead"
          hint={`Files a real lead in ${boot().crm}. Leave off to see the payload without sending it.`}
        />
      </div>

      <Button type="submit" className="w-full" disabled={busy}>
        {busy ? (
          <>
            <Loader2 className="animate-spin" /> Running…
          </>
        ) : (
          'Submit'
        )}
      </Button>
    </form>
  )
}

function Toggle({
  id,
  checked,
  onChange,
  title,
  hint,
  danger,
}: {
  id: string
  checked: boolean
  onChange: (v: boolean) => void
  title: string
  hint: string
  danger?: boolean
}) {
  return (
    <div
      className={
        danger
          ? 'flex gap-3 rounded-lg border border-destructive/25 bg-destructive/5 p-3'
          : 'flex gap-3 rounded-lg border p-3'
      }
    >
      <Checkbox
        id={id}
        checked={checked}
        onCheckedChange={(v) => onChange(v === true)}
        className="mt-0.5"
      />
      <div className="space-y-1">
        <Label
          htmlFor={id}
          className={
            danger
              ? 'flex items-center gap-1.5 font-semibold text-destructive'
              : 'flex items-center gap-1.5 font-semibold'
          }
        >
          {danger && <AlertTriangle className="size-3.5" />}
          {title}
        </Label>
        <p className="text-xs leading-relaxed text-muted-foreground">{hint}</p>
      </div>
    </div>
  )
}
