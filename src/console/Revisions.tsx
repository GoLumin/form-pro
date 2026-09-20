import * as React from 'react'
import { GitCommitHorizontal, HardDrive } from 'lucide-react'
import { Badge } from '../components/ui/badge.tsx'
import { Button } from '../components/ui/button.tsx'
import { Card, CardContent } from '../components/ui/card.tsx'
import type { Revision } from './types.ts'

/**
 * Who changed what, and when. Kept as a JSON file beside the config it
 * describes, so a deploy carries the log in the same commit as the change and
 * anyone reading the repository can see the history without a database.
 */
export function Revisions({
  revisions,
  onShowDiff,
}: {
  revisions: Revision[]
  onShowDiff: (revision: Revision) => void
}) {
  if (revisions.length === 0) {
    return (
      <Card className="border-dashed">
        <CardContent className="py-14 text-center">
          <p className="text-sm font-medium">No changes recorded yet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Saving from the Editor adds one, with the name you type and what moved.
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-2">
      {revisions.map((r, i) => (
        <Card key={`${r.at}-${i}`}>
          <CardContent className="flex flex-wrap items-start justify-between gap-3 py-4">
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{r.author}</span>
                <Badge variant="secondary">{r.profile}</Badge>
                <Badge variant={r.kind === 'deploy' ? 'default' : 'outline'}>
                  {r.kind === 'deploy' ? (
                    <>
                      <GitCommitHorizontal className="size-3" /> deployed
                    </>
                  ) : (
                    <>
                      <HardDrive className="size-3" /> local
                    </>
                  )}
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground">
                {r.fields.length ? r.fields.join(', ') : 'configuration'}
              </p>
              <p className="text-xs text-muted-foreground">
                {new Date(r.at).toLocaleString(undefined, {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                })}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {r.commit?.url && (
                <Button asChild variant="ghost" size="sm">
                  <a href={r.commit.url} target="_blank" rel="noopener">
                    {r.commit.sha}
                  </a>
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                disabled={!r.changes?.length}
                onClick={() => onShowDiff(r)}
              >
                What changed
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
