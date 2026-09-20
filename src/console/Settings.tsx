import * as React from 'react'
import { Info } from 'lucide-react'
import { Button } from '../components/ui/button.tsx'
import { Input } from '../components/ui/input.tsx'
import { Label } from '../components/ui/label.tsx'
import { Switch } from '../components/ui/switch.tsx'
import { boot } from './api.ts'
import { Database } from './Database.tsx'
import { Display, Panel } from './instrument.tsx'
import { SETTING_INFO } from './settingInfo.tsx'
import type { SiteSettings } from './types.ts'

/**
 * What applies to the whole site rather than to one profile. It lives in the
 * same file as the profiles and saves the same way, so the values a person
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
  const { single } = boot()
  const set = (patch: Partial<SiteSettings>) => onChange({ ...settings, ...patch })

  return (
    <div className="flex flex-col gap-4">
      <Database />

      <Panel className="flex flex-col gap-4 p-4">
        <div className="flex flex-col gap-1">
          <Display>Daily form check</Display>
          <p className="m-0 text-[12.5px] leading-relaxed text-pretty text-muted-foreground">
            A form submission we make ourselves, every day, so a silent break is found by us
            rather than by a customer who never hears back.
          </p>
        </div>
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
          <p className="m-0 text-[11.5px] leading-relaxed text-muted-foreground">
            One address. It receives one digest a day, plus one email per profile when delivery is
            on. No lead is ever posted to a CRM by the check.
          </p>
        </div>
      </Panel>

      <Panel className="flex flex-col gap-4 p-4">
        <Display>Everything the site sends</Display>
        <div className="space-y-2">
          <LabelWithInfo id="marketingCc" onExplain={onExplain}>
            Copy every email to
          </LabelWithInfo>
          <Input
            id="marketingCc"
            value={settings.marketingCc}
            onChange={(e) => set({ marketingCc: e.target.value })}
          />
          <p className="m-0 text-[11.5px] leading-relaxed text-muted-foreground">
            Added as a Cc to every message the site sends, customer confirmations included — so the
            recipient can see it.
          </p>
        </div>
      </Panel>
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
