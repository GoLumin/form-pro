import * as React from 'react'
import { cn } from '../lib/utils.ts'

/**
 * The console's design language, as the four pieces every screen is built from.
 *
 * They are here rather than in components/ui because none of them is a shadcn
 * component with a bespoke skin — they are this console's own vocabulary, and
 * keeping them apart is what stops an upgrade of the stock components from
 * having to reconcile with them.
 *
 * The rule the whole console follows: `Display` names things, ordinary sans
 * explains them, and `Mono` is for anything the machine compares character for
 * character — ids, keys, addresses, URLs, SHAs, payload values. A webhook key
 * set in prose is a key nobody proofreads.
 */

/** A name: a profile, a screen, a status word. Never a sentence. */
export function Display({
  className,
  ...props
}: React.ComponentProps<'h2'> & { as?: never }) {
  return (
    <h2
      className={cn('font-serif text-xl leading-tight font-normal', className)}
      {...props}
    />
  )
}

/** The small tracked label above a value. */
export function Eyebrow({ className, ...props }: React.ComponentProps<'span'>) {
  return (
    <span
      className={cn(
        'text-[10px] font-semibold tracking-[0.14em] text-muted-foreground uppercase',
        className
      )}
      {...props}
    />
  )
}

/** Anything that has to match somewhere else exactly. */
export function Mono({ className, ...props }: React.ComponentProps<'span'>) {
  return <span className={cn('font-mono text-xs', className)} {...props} />
}

export type Tone = 'safe' | 'signal' | 'live' | 'idle'

const PIP: Record<Tone, string> = {
  /** Ran, and stayed inside this machine. */
  safe: 'border-success bg-shell',
  /** The decision everything downstream inherits. */
  signal: 'border-primary bg-primary shadow-[0_0_0_4px_color-mix(in_oklab,var(--primary)_16%,transparent)]',
  /** Reached the outside world. */
  live: 'border-destructive bg-shell shadow-[0_0_0_4px_color-mix(in_oklab,var(--destructive)_16%,transparent)]',
  /** Rendered, but not delivered. */
  idle: 'border-muted-foreground/45 bg-shell',
}

export function Pip({ tone = 'idle', className }: { tone?: Tone; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn('size-3 shrink-0 rounded-full border-2', PIP[tone], className)}
    />
  )
}

/**
 * One stop on a spine: the pip, the line down to the next one, and the card
 * beside it.
 *
 * The line is drawn by the gutter rather than by a border on the card, so a
 * station whose card is two cards side by side (the pair of emails) still
 * hangs off the same thread.
 */
export function Station({
  index,
  tone = 'idle',
  last,
  children,
}: {
  index?: string
  tone?: Tone
  last?: boolean
  children: React.ReactNode
}) {
  return (
    <div className="grid grid-cols-[1.625rem_minmax(0,1fr)] gap-x-3.5">
      <div className="flex flex-col items-center gap-1.5">
        <Pip tone={tone} className="mt-[0.9375rem]" />
        {!last && <span className="w-px grow bg-border" />}
      </div>
      <div className={last ? undefined : 'pb-3'}>{children}</div>
      {index !== undefined && <span className="sr-only">{`Stage ${index}`}</span>}
    </div>
  )
}

/** The number in a station's heading. Quiet on purpose: it orders, not ranks. */
export function StationIndex({ children }: { children: React.ReactNode }) {
  return <Mono className="text-[11px] text-muted-foreground/70">{children}</Mono>
}

/**
 * A panel. `Card` from stock is the same thing with more padding and a shadow;
 * every surface in this console is a hairline instead, so they are declared
 * here once.
 */
export function Panel({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      className={cn(
        'rounded-xl border bg-card shadow-[inset_0_1px_0_rgb(255_255_255/0.03)]',
        className
      )}
      {...props}
    />
  )
}
