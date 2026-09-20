import * as React from 'react'
import { ArrowRight, Loader2, Save, Upload } from 'lucide-react'
import { Button } from '../components/ui/button.tsx'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog.tsx'
import { Input } from '../components/ui/input.tsx'
import { Label } from '../components/ui/label.tsx'
import { boot } from './api.ts'
import { Eyebrow, Mono, Panel } from './instrument.tsx'
import { cn } from '../lib/utils.ts'
import type { Change } from './changes.ts'

/**
 * The last thing between an edit and production.
 *
 * It replaces a `window.confirm`, which this deserved better than: the browser
 * dialog could say what was about to happen but not what was about to change,
 * and an OK button one keystroke from the caret is not much of a gate for a
 * commit that goes live with no review step.
 *
 * So: the changes in full, whose name goes against them, and a button you hold
 * rather than click. The hold is not theatre — it is the difference between a
 * deploy you meant and a deploy your hand made on the way somewhere else. Let
 * go early and nothing is sent.
 */

const HOLD_MS = 1400

export function DeployDialog({
  mode,
  changes,
  profileName,
  author,
  busy,
  onClose,
  onConfirm,
}: {
  /** null when closed; otherwise which of the two buttons opened it. */
  mode: 'save' | 'deploy' | null
  changes: Change[]
  profileName: string
  author: string
  busy: boolean
  onClose: () => void
  onConfirm: (author: string) => void
}) {
  const { host, configPath, crm, single } = boot()
  const [name, setName] = React.useState(author)
  const deploying = mode === 'deploy'

  React.useEffect(() => {
    if (mode) setName(author)
  }, [mode, author])

  const shared = changes.filter((c) => c.shared)
  const external = changes.filter((c) => c.external)

  return (
    <Dialog open={Boolean(mode)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[86vh] max-w-2xl flex-col gap-5 sm:max-w-2xl">
        <DialogHeader className="gap-2">
          <div className="flex items-center gap-2.5">
            <span
              className={cn(
                'size-2.5 rounded-full',
                deploying ? 'bg-primary shadow-[0_0_0_4px_color-mix(in_oklab,var(--primary)_16%,transparent)]' : 'bg-muted-foreground'
              )}
            />
            <Eyebrow className={deploying ? 'text-primary' : undefined}>
              {deploying ? 'Deploy' : 'Save'} · {profileName}
            </Eyebrow>
            <span className="grow" />
            <Mono className="text-[11.5px] text-muted-foreground">
              {deploying ? 'production branch · no review step' : configPath}
            </Mono>
          </div>
          <DialogTitle className="font-serif text-3xl leading-tight font-normal">
            {deploying
              ? `This is live on ${host} in about two minutes.`
              : `This rewrites ${configPath} on this machine.`}
          </DialogTitle>
          <DialogDescription className="text-pretty">
            {deploying
              ? 'The commit goes straight to the production branch and the host builds it. The only way back is another deploy.'
              : 'Nothing is committed and nothing is deployed. The live site keeps running the version in the repository.'}
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-col gap-2 overflow-y-auto">
          <Eyebrow>
            {changes.length === 0
              ? 'Nothing has changed'
              : `${changes.length} ${changes.length === 1 ? 'change' : 'changes'} in this ${deploying ? 'commit' : 'save'}`}
          </Eyebrow>
          {changes.length === 0 && (
            <p className="m-0 text-[12.5px] text-muted-foreground">
              The file already matches what is on screen, so this will write nothing.
            </p>
          )}
          {changes.map((change) => (
            <Panel key={change.path} className="flex flex-col gap-1.5 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <Mono className="text-[11px] text-muted-foreground">{change.path}</Mono>
                <span className="grow" />
                {change.shared && (
                  <span className="rounded-sm bg-shared/15 px-2 py-0.5 text-[10.5px] text-shared">
                    every profile, not just this one
                  </span>
                )}
                {change.external && (
                  <span className="rounded-sm bg-warning-surface px-2 py-0.5 text-[10.5px] text-warning-ink">
                    {crm} must already know this key
                  </span>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-md bg-destructive/12 px-2 py-1 font-mono text-[11.5px] text-destructive line-through">
                  {change.before || '(empty)'}
                </span>
                <ArrowRight className="size-3.5 shrink-0 text-muted-foreground/70" />
                <span className="rounded-md bg-success-surface px-2 py-1 font-mono text-[11.5px] text-success">
                  {change.after || '(empty)'}
                </span>
              </div>
            </Panel>
          ))}
        </div>

        {deploying && (shared.length > 0 || external.length > 0) && !single && (
          <p className="m-0 text-[11.5px] leading-relaxed text-pretty text-warning-ink">
            {shared.length > 0 && 'Some of this is shared wording, so the other profiles change with it. '}
            {external.length > 0 &&
              `The ${crm} end has its own field mapping and this commit does not update it.`}
          </p>
        )}

        <div className="flex flex-wrap items-end gap-3">
          <div className="w-60 space-y-1.5">
            <Label htmlFor="deploy-author">
              <Eyebrow>Who is making this change</Eyebrow>
            </Label>
            <Input
              id="deploy-author"
              value={name}
              autoFocus
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <p className="m-0 pb-1.5 text-[11.5px] leading-relaxed text-pretty text-muted-foreground">
            Recorded against it in Revisions, so the history says who as well as what.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Button variant="outline" size="lg" onClick={onClose}>
            Cancel
          </Button>
          {deploying ? (
            <HoldToDeploy
              disabled={!name.trim() || busy}
              busy={busy}
              onComplete={() => onConfirm(name.trim())}
            />
          ) : (
            <Button
              size="lg"
              className="grow"
              disabled={!name.trim() || busy}
              onClick={() => onConfirm(name.trim())}
            >
              {busy ? <Loader2 className="animate-spin" /> : <Save />}
              Save to {configPath}
            </Button>
          )}
        </div>

        <p className="m-0 text-[11.5px] leading-relaxed text-pretty text-muted-foreground/80">
          {deploying
            ? 'Let go before the bar fills and nothing is committed. A deploy never sends an email and never files a lead — only the two switches on the path do that.'
            : 'A deployed build has no writable file, which is when the deploy button is the only one that does anything.'}
        </p>
      </DialogContent>
    </Dialog>
  )
}

function HoldToDeploy({
  disabled,
  busy,
  onComplete,
}: {
  disabled: boolean
  busy: boolean
  onComplete: () => void
}) {
  const [held, setHeld] = React.useState(0)
  const frame = React.useRef<number | null>(null)
  const done = React.useRef(onComplete)
  done.current = onComplete

  const stop = React.useCallback(() => {
    if (frame.current !== null) cancelAnimationFrame(frame.current)
    frame.current = null
    setHeld(0)
  }, [])

  React.useEffect(() => stop, [stop])

  const begin = () => {
    if (disabled || frame.current !== null) return
    const from = performance.now()
    const tick = () => {
      const progress = Math.min(1, (performance.now() - from) / HOLD_MS)
      setHeld(progress)
      if (progress < 1) {
        frame.current = requestAnimationFrame(tick)
        return
      }
      stop()
      done.current()
    }
    frame.current = requestAnimationFrame(tick)
  }

  const remaining = Math.max(0, HOLD_MS * (1 - held)) / 1000

  return (
    <button
      type="button"
      disabled={disabled}
      // Pointer and keyboard both hold: Space held down on a focused button is
      // the same gesture, and a deploy that only a mouse can reach is not one.
      onPointerDown={begin}
      onPointerUp={stop}
      onPointerLeave={stop}
      onPointerCancel={stop}
      onKeyDown={(e) => {
        if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) {
          e.preventDefault()
          begin()
        }
      }}
      onKeyUp={stop}
      className="relative flex h-11 grow items-center justify-between gap-3 overflow-hidden rounded-lg border border-primary bg-primary/12 px-4 text-sm font-semibold transition-colors outline-none select-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50"
    >
      <span
        aria-hidden
        className="absolute inset-y-0 left-0 border-r-[3px] border-primary bg-primary/35"
        style={{ width: `${held * 100}%` }}
      />
      <span className="relative flex items-center gap-2.5">
        {busy ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
        {busy ? 'Committing…' : held > 0 ? 'Keep holding to deploy' : 'Hold to deploy'}
      </span>
      <Mono className="relative text-[12px] text-muted-foreground">
        {held > 0 ? `${remaining.toFixed(1)}s` : `${(HOLD_MS / 1000).toFixed(1)}s`}
      </Mono>
    </button>
  )
}
