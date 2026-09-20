import * as React from 'react'
import { GitCommitHorizontal, HardDrive } from 'lucide-react'
import { Badge } from '../components/ui/badge.tsx'
import { Button } from '../components/ui/button.tsx'
import { Display, Eyebrow, Mono, Panel, Pip } from './instrument.tsx'
import type { Revision } from './types.ts'

/**
 * Who changed what, and when.
 *
 * Kept as a JSON file beside the config it describes, so a deploy carries the
 * log in the same commit as the change and anyone reading the repository can
 * see the history without a database.
 *
 * Drawn as a spine rather than a stack of cards for the same reason the path
 * is: the newest entry is the one the live site is running, and everything
 * under it is what it replaced.
 */

function initials(author: string): string {
  const parts = author.trim().split(/[\s@._-]+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

/** Today, yesterday, then the date — the way someone reading a log says it. */
function dayOf(at: string): string {
  const date = new Date(at)
  const midnight = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const days = Math.round((midnight(new Date()) - midnight(date)) / 86_400_000)
  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  return date.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })
}

export function Revisions({
  revisions,
  onShowDiff,
}: {
  revisions: Revision[]
  onShowDiff: (revision: Revision) => void
}) {
  if (revisions.length === 0) {
    return (
      <Panel className="flex flex-col items-center gap-2 border-dashed px-6 py-16 text-center">
        <Display className="text-[22px]">No changes recorded yet</Display>
        <p className="max-w-md text-sm text-pretty text-muted-foreground">
          Saving from the editor adds one, with the name you type and what moved. Deploying adds
          the commit it went out in.
        </p>
      </Panel>
    )
  }

  // One heading per day, in the order the revisions already arrive in.
  let previousDay: string | null = null

  return (
    <div className="flex max-w-5xl flex-col gap-4">
      <div className="flex flex-col gap-0.5">
        <Display className="text-[23px]">Who changed what</Display>
        <p className="text-[12.5px] text-muted-foreground">
          The newest entry is what the live site is running.
        </p>
      </div>

      <div className="flex flex-col">
        {revisions.map((revision, index) => {
          const day = dayOf(revision.at)
          const heading = day === previousDay ? null : day
          previousDay = day
          const deployed = revision.kind === 'deploy'
          const live = index === 0 && deployed

          return (
            <React.Fragment key={`${revision.at}-${index}`}>
              {heading && (
                <Eyebrow className={index === 0 ? 'pb-2' : 'pt-4 pb-2'}>{heading}</Eyebrow>
              )}
              <div className="grid grid-cols-[1.625rem_minmax(0,1fr)] gap-x-3.5">
                <div className="flex flex-col items-center gap-1.5">
                  <Pip tone={live ? 'signal' : deployed ? 'safe' : 'idle'} className="mt-[0.9375rem]" />
                  {index < revisions.length - 1 && <span className="w-px grow bg-border" />}
                </div>
                <div className="pb-3">
                  <Panel className={live ? 'border-primary/30 p-3.5' : 'p-3.5'}>
                    <div className="flex flex-col gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={
                            live
                              ? 'flex size-6 items-center justify-center rounded-full bg-primary/15 text-[10px] font-semibold text-primary'
                              : 'flex size-6 items-center justify-center rounded-full bg-muted text-[10px] font-semibold text-muted-foreground'
                          }
                        >
                          {initials(revision.author)}
                        </span>
                        <span className="text-sm font-semibold">{revision.author}</span>
                        <Badge variant="outline" className="rounded-md bg-muted">
                          {revision.profile}
                        </Badge>
                        <Badge
                          variant="outline"
                          className={
                            deployed
                              ? 'rounded-md border-success/30 bg-success-surface text-success'
                              : 'rounded-md bg-muted text-muted-foreground'
                          }
                        >
                          {deployed ? (
                            <>
                              <GitCommitHorizontal className="size-3" /> deployed
                            </>
                          ) : (
                            <>
                              <HardDrive className="size-3" /> local only
                            </>
                          )}
                        </Badge>
                        <span className="grow" />
                        {revision.commit?.url && (
                          <Button asChild variant="link" className="h-auto p-0">
                            <a href={revision.commit.url} target="_blank" rel="noopener">
                              <Mono className="text-[11.5px]">{revision.commit.sha}</Mono>
                            </a>
                          </Button>
                        )}
                        <Mono className="text-[11.5px] text-muted-foreground">
                          {new Date(revision.at).toLocaleTimeString(undefined, {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </Mono>
                      </div>

                      <div className="flex flex-wrap items-center gap-3">
                        <p className="m-0 min-w-0 text-[12.5px] text-muted-foreground">
                          {revision.fields.length
                            ? revision.fields.join(', ')
                            : 'configuration'}
                        </p>
                        <span className="grow" />
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={!revision.changes?.length}
                          onClick={() => onShowDiff(revision)}
                        >
                          What changed
                        </Button>
                      </div>
                    </div>
                  </Panel>
                </div>
              </div>
            </React.Fragment>
          )
        })}
      </div>
    </div>
  )
}
