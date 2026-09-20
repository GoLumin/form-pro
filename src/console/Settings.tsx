import * as React from 'react'
import { Info } from 'lucide-react'
import { Button } from '../components/ui/button.tsx'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card.tsx'
import { Input } from '../components/ui/input.tsx'
import { Label } from '../components/ui/label.tsx'
import { Switch } from '../components/ui/switch.tsx'
import { Textarea } from '../components/ui/textarea.tsx'
import { boot } from './api.ts'
import { Database } from './Database.tsx'
import { SETTING_INFO } from './settingInfo.tsx'
import type { SiteSettings } from './types.ts'

/**
 * What applies to the whole site rather than to one location. It lives in the
 * same file as the locations and saves the same way, so the values a person
 * changes are never split between a config file and a hosting dashboard where
 * only one of the two gets updated.
 */
export function Settings({
  settings,
  onChange,
  onExplain,
}: {
  settings: SiteSettings
  onChange: (next: SiteSettings) => void
  onExplain: (key: string) => void
}) {
  const { single, countWordFor } = boot() as any
  const set = (patch: Partial<SiteSettings>) => onChange({ ...settings, ...patch })

  return (
    <div className="space-y-4">
      <Database />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Daily form check</CardTitle>
          <CardDescription>
            A form submission we make ourselves, every day, so a silent break is found by us rather
            than by a customer who never hears back.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <Toggle
            id="canaryEnabled"
            checked={settings.canaryEnabled}
            onChange={(canaryEnabled) => set({ canaryEnabled })}
            onExplain={onExplain}
            title="Run the daily check"
            hint={`Submits a quote through ${single ? 'the form' : 'every market'} once a day and emails a digest. Off means nothing runs and nothing is watching.`}
          />
          <Toggle
            id="canarySendEmails"
            checked={settings.canarySendEmails}
            onChange={(canarySendEmails) => set({ canarySendEmails })}
            onExplain={onExplain}
            title="Really deliver the probe emails"
            hint="Sends the quote email using the real From address and sending account. Off makes it a dry run, which would not notice a sending account rejecting our From address — the failure this check exists for."
          />
          <div className="space-y-2">
            <LabelWithInfo id="canaryEmailTo" onExplain={onExplain}>
              Send the digest and probes to
            </LabelWithInfo>
            <Input
              id="canaryEmailTo"
              value={settings.canaryEmailTo}
              onChange={(e) => set({ canaryEmailTo: e.target.value })}
            />
            <p className="text-xs text-muted-foreground">
              One address. It receives one digest a day, plus one quote email per location when
              delivery is on. No lead is ever posted to a CRM by the check.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Everything the site sends</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-2">
            <LabelWithInfo id="marketingCc" onExplain={onExplain}>
              Copy every email to
            </LabelWithInfo>
            <Input
              id="marketingCc"
              value={settings.marketingCc}
              onChange={(e) => set({ marketingCc: e.target.value })}
            />
            <p className="text-xs text-muted-foreground">
              Added as a Cc to every message the site sends, customer confirmations included — so
              the recipient can see it.
            </p>
          </div>
          <div className="space-y-2">
            <LabelWithInfo id="franchiseAdminTo" onExplain={onExplain}>
              Franchise enquiries go to
            </LabelWithInfo>
            <Textarea
              id="franchiseAdminTo"
              rows={3}
              value={settings.franchiseAdminTo.join('\n')}
              onChange={(e) =>
                set({
                  franchiseAdminTo: e.target.value
                    .split('\n')
                    .map((x) => x.trim())
                    .filter(Boolean),
                })
              }
            />
            <p className="text-xs text-muted-foreground">
              One per line. Quote leads never come here — those go to the location's own team
              addresses, on the Editor tab.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

function LabelWithInfo({
  id,
  onExplain,
  children,
}: {
  id: string
  onExplain: (key: string) => void
  children: React.ReactNode
}) {
  const has = Boolean(SETTING_INFO[id])
  return (
    <div className="flex items-center gap-1.5">
      <Label htmlFor={id}>{children}</Label>
      {has && <InfoButton onClick={() => onExplain(id)} label={String(children)} />}
    </div>
  )
}

function InfoButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="size-5 rounded-full text-muted-foreground hover:text-foreground"
      aria-label={`What "${label}" does`}
      onClick={onClick}
    >
      <Info className="size-3.5" />
    </Button>
  )
}

function Toggle({
  id,
  checked,
  onChange,
  onExplain,
  title,
  hint,
}: {
  id: string
  checked: boolean
  onChange: (v: boolean) => void
  onExplain: (key: string) => void
  title: string
  hint: string
}) {
  return (
    <div className="flex gap-3">
      <Switch id={id} checked={checked} onCheckedChange={onChange} className="mt-0.5" />
      <div className="space-y-1">
        <div className="flex items-center gap-1.5">
          <Label htmlFor={id} className="font-semibold">
            {title}
          </Label>
          <InfoButton onClick={() => onExplain(id)} label={title} />
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">{hint}</p>
      </div>
    </div>
  )
}
