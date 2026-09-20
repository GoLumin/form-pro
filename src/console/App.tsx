import * as React from 'react'
import {
  AlertTriangle,
  Activity,
  Cable,
  History as HistoryIcon,
  Loader2,
  Save,
  SlidersHorizontal,
  TextCursorInput,
  Upload,
} from 'lucide-react'
import { Badge } from '../components/ui/badge.tsx'
import { Button } from '../components/ui/button.tsx'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog.tsx'
import { Label } from '../components/ui/label.tsx'
import { Switch } from '../components/ui/switch.tsx'
import { api, boot, local, STORE } from './api.ts'
import { pendingChanges } from './changes.ts'
import { DeployDialog } from './DeployDialog.tsx'
import { Editor, type EditorSection } from './Editor.tsx'
import { Display, Eyebrow, Mono, Panel } from './instrument.tsx'
import { QuoteForm } from './QuoteForm.tsx'
import { Revisions } from './Revisions.tsx'
import { Settings } from './Settings.tsx'
import { SETTING_INFO } from './settingInfo.tsx'
import { SignalPath } from './SignalPath.tsx'
import { cn } from '../lib/utils.ts'
import type {
  EditableProfile,
  EmailLabels,
  FieldDef,
  ReadResponse,
  Revision,
  SiteSettings,
  SubmitResponse,
} from './types.ts'

/**
 * The console.
 *
 * It is laid out as an instrument panel rather than a settings page because
 * that is what it is. A submission runs down one visible path — profile,
 * emails, webhook, landing — and every screen behind the rail is the thing
 * that decided one of those stages.
 *
 * Two decisions shape the chrome:
 *
 * The arming switches live across the top, above every screen, rather than
 * inside the test form. Whether a run reaches real inboxes and the real CRM is
 * the most consequential thing on the page and the easiest to forget, and a
 * strip that says "Safe" until you throw something is a state you can check at
 * a glance from wherever you are.
 *
 * And nothing commits without being read back first. Save and deploy both open
 * a dialog that lists the actual changes, worked out here from what was loaded
 * — a deploy goes straight to the production branch with no review step, so
 * this page is the review step.
 */

type SaveState = { tone: 'idle' | 'busy' | 'good' | 'bad'; message: React.ReactNode }
type View = 'path' | 'editor' | 'history' | 'settings'

const RAIL: {
  id: string
  view: View
  section?: EditorSection
  label: string
  icon: React.ElementType
}[] =
  [
    { id: 'path', view: 'path', label: 'Path', icon: Activity },
    { id: 'wiring', view: 'editor', section: 'webhook', label: 'Wiring', icon: Cable },
    { id: 'fields', view: 'editor', section: 'fields', label: 'Fields', icon: TextCursorInput },
    { id: 'history', view: 'history', label: 'History', icon: HistoryIcon },
    { id: 'settings', view: 'settings', label: 'Settings', icon: SlidersHorizontal },
  ]

export function App() {
  const { brand, single, crm, host, configPath, user } = boot()

  const [view, setView] = React.useState<View>('path')
  const [section, setSection] = React.useState<EditorSection>('fields')

  const [result, setResult] = React.useState<SubmitResponse | null>(null)
  const [ran, setRan] = React.useState<Date | null>(null)
  const [busy, setBusy] = React.useState(false)
  /** What a run is allowed to do outside this machine. Never persisted. */
  const [armed, setArmed] = React.useState({ emails: false, lead: false })

  const [data, setData] = React.useState<ReadResponse | null>(null)
  const [current, setCurrent] = React.useState(0)
  const [profiles, setProfiles] = React.useState<EditableProfile[]>([])
  const [fields, setFields] = React.useState<FieldDef[]>([])
  /** The field labels being edited, keyed by id — copy, unlike the rest. */
  const [fieldLabels, setFieldLabels] = React.useState<Record<string, string>>({})
  const [labels, setLabels] = React.useState<EmailLabels | null>(null)
  const [settings, setSettings] = React.useState<SiteSettings | null>(null)
  const [revisions, setRevisions] = React.useState<Revision[]>([])
  const [save, setSave] = React.useState<SaveState>({ tone: 'idle', message: '' })

  const [author, setAuthor] = React.useState(() => local.get(STORE.author) ?? user ?? '')
  const [asking, setAsking] = React.useState<'save' | 'deploy' | null>(null)
  const [warning, setWarning] = React.useState(false)
  const [explaining, setExplaining] = React.useState<string | null>(null)
  const [diff, setDiff] = React.useState<Revision | null>(null)

  const load = React.useCallback(async () => {
    const { data, error } = await api<ReadResponse>('read')
    if (error || !data) {
      setSave({ tone: 'bad', message: error?.message ?? 'Could not read the config' })
      return
    }
    setData(data)
    setProfiles(data.profiles ?? [])
    // Defaulted rather than trusted: an older deployed endpoint answering a
    // newer console should leave the page usable and visibly empty, not throw
    // on the first render.
    const incoming = data.fields ?? []
    setFields(incoming)
    setFieldLabels(Object.fromEntries(incoming.map((f) => [f.id, f.label])))
    setLabels(data.labels)
    setSettings(data.settings)
    setRevisions(data.revisions ?? [])
  }, [])

  React.useEffect(() => {
    void load()
  }, [load])

  const profile = profiles[current]
  /** The profile the last run resolved to — not necessarily the one being edited. */
  const ranAs = result?.profile?.slug
    ? profiles.find((p) => p.slug === result.profile!.slug)
    : undefined

  /** What is about to be written, read back from what was loaded. */
  const changes = React.useMemo(
    () => pendingChanges(data, { profile, fieldLabels, labels, settings }),
    [data, profile, fieldLabels, labels, settings]
  )

  const commit = async (deploy: boolean, who: string) => {
    if (!profile || !labels || !settings) return
    setAsking(null)
    setSave({ tone: 'busy', message: deploy ? 'Committing…' : 'Saving…' })
    const { data, error } = await api<any>('write', {
      deploy,
      author: who,
      slug: profile.slug,
      emailBrand: profile.emailBrand,
      phoneNumber: profile.phoneNumber,
      emailResponsePromise: profile.emailResponsePromise.replace(/\s+/g, ' ').trim(),
      emailFooterLines: profile.emailFooterLines,
      fieldOptions: profile.fieldOptions,
      webhookUrl: profile.webhookUrl,
      clientEmail: profile.clientEmail,
      adminEmail: profile.adminEmail,
      clientCopy: profile.clientCopy,
      adminCopy: profile.adminCopy,
      webhookKeys: profile.webhookKeys,
      emailLabels: labels,
      fieldLabels,
      settings,
    })

    if (error) return setSave({ tone: 'bad', message: error.message })
    if (!data?.changed) {
      return setSave({
        tone: 'idle',
        message: deploy
          ? 'Nothing to change — the repository already matches.'
          : 'Nothing to change — the file already matches.',
      })
    }
    if (data.committed) {
      setSave({
        tone: 'good',
        message: (
          <>
            Committed{' '}
            <a
              href={data.commit.url}
              target="_blank"
              rel="noopener"
              className="underline underline-offset-2"
            >
              {data.commit.sha}
            </a>{' '}
            to {data.commit.branch} — {(data.fields ?? []).join(', ') || 'configuration'}. {host} is
            building; live in a couple of minutes. Recorded against {who} in Revisions.
          </>
        ),
      })
      await load()
      return
    }
    if (data.written) {
      setSave({ tone: 'good', message: `Written to ${data.source}. Recorded against ${who}.` })
      await load()
      return
    }
    setSave({
      tone: 'bad',
      message: `Nothing was written — a deployed build has no writable file. Use Save and deploy, or edit ${data.source} directly.`,
    })
  }

  const confirmWrite = (who: string) => {
    setAuthor(who)
    local.set(STORE.author, who)
    void commit(asking === 'deploy', who)
  }

  const onResult = (next: SubmitResponse) => {
    setResult(next)
    setRan(new Date())
  }

  const go = (item: (typeof RAIL)[number]) => {
    setView(item.view)
    if (item.section) setSection(item.section)
  }

  const activeRail = (item: (typeof RAIL)[number]) =>
    item.view === view && (item.section === undefined || item.section === section)

  const saveBar = (
    <Panel className="flex flex-wrap items-center gap-3 p-3">
      <Button
        variant="secondary"
        size="lg"
        onClick={() => setAsking('save')}
        disabled={save.tone === 'busy' || !data?.writable}
      >
        <Save /> {data?.writable ? 'Save locally' : 'Save'}
      </Button>
      {data?.deployable && (
        <Button size="lg" onClick={() => setAsking('deploy')} disabled={save.tone === 'busy'}>
          {save.tone === 'busy' ? <Loader2 className="animate-spin" /> : <Upload />} Save and
          deploy
        </Button>
      )}
      {changes.length > 0 && save.tone !== 'busy' && (
        <Badge variant="outline" className="rounded-md border-warning/30 bg-warning-surface text-warning-ink">
          {changes.length} unsaved {changes.length === 1 ? 'change' : 'changes'}
        </Badge>
      )}
      <p
        className={cn(
          'm-0 min-w-0 text-[12.5px]',
          save.tone === 'bad'
            ? 'text-destructive'
            : save.tone === 'good'
              ? 'text-success'
              : 'text-muted-foreground'
        )}
        aria-live="polite"
      >
        {save.message ||
          (data?.writable
            ? `Saving rewrites ${configPath} on this machine. Deploying commits it to the production branch.`
            : 'A deployed build has no writable file — use Save and deploy.')}
      </p>
    </Panel>
  )

  const productionWarning = (
    <div className="flex gap-3 rounded-xl border border-warning/25 bg-warning-surface/40 p-3.5">
      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
      <div className="flex min-w-0 flex-col gap-1">
        <span className="text-[13px] font-semibold text-warning-ink">
          Editing here changes production
        </span>
        <p className="m-0 text-[12px] leading-relaxed text-pretty text-warning-ink/85">
          This writes <Mono className="text-[11.5px]">{configPath}</Mono> — the source the live
          site runs on, not a copy of it.
        </p>
        <ul className="m-0 list-disc space-y-1 pl-4 text-[12px] leading-relaxed text-warning-ink/85">
          <li>
            <b>Save and deploy</b> commits straight to the production branch; {host} builds it and
            it is live within a couple of minutes, with no review step.
          </li>
          <li>
            A webhook URL or key that does not match the field mapping on the other end is{' '}
            <b>not an error</b> — {crm} accepts the request and drops the lead, with nothing
            visible on the site.
          </li>
          <li>
            A From address whose domain is not verified in the sending account is rejected
            outright, and the client hears nothing.
          </li>
          {!single && (
            <li>
              Field labels, the subject line and pricing wording are shared by every profile;
              editing them here changes the others.
            </li>
          )}
        </ul>
      </div>
    </div>
  )

  const profileSwitch = !single && (
    <div className="flex flex-wrap items-center gap-2">
      <Eyebrow>Profile</Eyebrow>
      {profiles.map((p, i) => (
        <Button
          key={p.slug}
          variant={i === current ? 'default' : 'outline'}
          size="sm"
          onClick={() => setCurrent(i)}
        >
          {p.name}
        </Button>
      ))}
    </div>
  )

  return (
    <div className="flex min-h-screen flex-col bg-shell text-foreground">
      <header className="flex h-16 shrink-0 flex-wrap items-center gap-3.5 border-b bg-chrome px-6">
        <span className="flex size-8 items-center justify-center rounded-lg border bg-muted">
          <Activity className="size-4 text-primary" />
        </span>
        <span className="flex flex-col">
          <Eyebrow className="text-[9.5px] tracking-[0.18em]">Form console</Eyebrow>
          <Display className="text-[21px] leading-tight">{brand}</Display>
        </span>

        <span className="grow" />

        <span className="inline-flex h-7 items-center gap-2 rounded-full border border-success/25 bg-success-surface/50 px-3">
          <span className="size-1.5 rounded-full bg-success" />
          <span className="text-xs text-success">{host}</span>
        </span>
        <Mono className="text-[11.5px] text-muted-foreground">{configPath}</Mono>
        <Button
          variant="outline"
          size="icon"
          className="border-warning/30 bg-warning-surface/40 text-warning hover:bg-warning-surface"
          aria-label="What editing here affects"
          onClick={() => setWarning(true)}
        >
          <AlertTriangle />
        </Button>
        {user && (
          <span
            className="flex size-8 items-center justify-center rounded-full border bg-muted text-[11.5px] font-semibold text-muted-foreground"
            title={user}
          >
            {user.slice(0, 2).toUpperCase()}
          </span>
        )}
      </header>

      <ArmingStrip armed={armed} onChange={setArmed} />

      <div className="flex grow">
        <nav
          aria-label="Console sections"
          className="flex w-19 shrink-0 flex-col items-center gap-1 border-r bg-chrome py-4"
        >
          {RAIL.map((item) => {
            const active = activeRail(item)
            const Icon = item.icon
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => go(item)}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex h-14 w-15 flex-col items-center justify-center gap-1 rounded-xl border border-transparent transition-colors',
                  active
                    ? 'border-primary/25 bg-primary/12 text-primary'
                    : 'text-muted-foreground hover:bg-accent'
                )}
              >
                <Icon className="size-[1.1875rem]" />
                <span className="text-[10px]">{item.label}</span>
              </button>
            )
          })}
        </nav>

        {view === 'path' ? (
          <>
            <section className="flex w-93 shrink-0 flex-col gap-4 border-r bg-chrome p-5">
              <div className="flex flex-col gap-1">
                <Display className="text-[23px]">Test submission</Display>
                <p className="m-0 text-[12.5px] text-pretty text-muted-foreground">
                  One submission, run through the real code paths the site runs.
                </p>
              </div>
              {fields.length ? (
                <QuoteForm
                  fields={fields}
                  armed={armed}
                  onResult={onResult}
                  busy={busy}
                  setBusy={setBusy}
                />
              ) : (
                <p className="text-sm text-muted-foreground">Loading the form…</p>
              )}
            </section>
            <main className="bg-grid grow p-6">
              <SignalPath
                result={result}
                keys={ranAs?.webhookKeys}
                ran={ran}
                armed={armed}
              />
            </main>
          </>
        ) : (
          <main className="bg-grid flex grow flex-col gap-4 p-6">
            {view === 'editor' && (
              <>
                {productionWarning}
                {profileSwitch}
                {profile && labels ? (
                  <>
                    <Editor
                      profile={profile}
                      fields={fields}
                      fieldLabels={fieldLabels}
                      labels={labels}
                      section={section}
                      onSection={setSection}
                      onProfile={(next) =>
                        setProfiles(profiles.map((p, i) => (i === current ? next : p)))
                      }
                      onFieldLabels={setFieldLabels}
                      onLabels={setLabels}
                    />
                    {saveBar}
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">Loading the configuration…</p>
                )}
              </>
            )}

            {view === 'history' && <Revisions revisions={revisions} onShowDiff={setDiff} />}

            {view === 'settings' && (
              <>
                {productionWarning}
                {settings ? (
                  <>
                    <Settings settings={settings} onChange={setSettings} onExplain={setExplaining} />
                    {saveBar}
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">Loading the settings…</p>
                )}
              </>
            )}
          </main>
        )}
      </div>

      <DeployDialog
        mode={asking}
        changes={changes}
        profileName={profile?.name ?? brand}
        author={author}
        busy={save.tone === 'busy'}
        onClose={() => setAsking(null)}
        onConfirm={confirmWrite}
      />

      <Dialog open={warning} onOpenChange={setWarning}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Editing here changes production</DialogTitle>
            <DialogDescription>
              What each button does, and what fails quietly if it is wrong.
            </DialogDescription>
          </DialogHeader>
          {productionWarning}
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(explaining)} onOpenChange={(open) => !open && setExplaining(null)}>
        <DialogContent className="max-h-[80vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{explaining ? SETTING_INFO[explaining]?.title : ''}</DialogTitle>
            <DialogDescription>
              {explaining ? SETTING_INFO[explaining]?.sub : ''}
            </DialogDescription>
          </DialogHeader>
          {explaining ? SETTING_INFO[explaining]?.body : null}
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(diff)} onOpenChange={(open) => !open && setDiff(null)}>
        <DialogContent className="max-h-[80vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>What changed</DialogTitle>
            <DialogDescription>
              {diff
                ? `${diff.profile} · ${diff.author} · ${new Date(diff.at).toLocaleString()}`
                : ''}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            {(diff?.changes ?? []).map((c, i) => (
              <Panel key={`${c.field}-${i}`} className="flex flex-col gap-1.5 p-3">
                <Mono className="text-[11px] text-muted-foreground">{c.field}</Mono>
                <span className="rounded-md bg-destructive/12 px-2 py-1 font-mono text-[11.5px] text-destructive line-through">
                  {c.before || '(empty)'}
                </span>
                <span className="rounded-md bg-success-surface px-2 py-1 font-mono text-[11.5px] text-success">
                  {c.after || '(empty)'}
                </span>
              </Panel>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

/**
 * The two switches that decide whether a run leaves this machine, across the
 * top of every screen.
 *
 * They read as one instrument with a status word rather than two checkboxes,
 * because the question they answer together — is this safe right now? — is the
 * one worth being able to answer from across the room.
 */
function ArmingStrip({
  armed,
  onChange,
}: {
  armed: { emails: boolean; lead: boolean }
  onChange: (next: { emails: boolean; lead: boolean }) => void
}) {
  const { crm } = boot()
  const live = armed.emails || armed.lead

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-4 border-b bg-chrome px-6 py-2.5">
      <span className="flex items-center gap-3">
        <span
          className={cn(
            'size-2.5 rounded-full',
            live
              ? 'bg-destructive shadow-[0_0_0_5px_color-mix(in_oklab,var(--destructive)_16%,transparent)]'
              : 'bg-success shadow-[0_0_0_5px_color-mix(in_oklab,var(--success)_14%,transparent)]'
          )}
        />
        <span className="flex flex-col">
          <span
            className={cn(
              'font-serif text-lg leading-tight',
              live ? 'text-destructive' : 'text-success'
            )}
          >
            {live ? 'Armed' : 'Safe'}
          </span>
          <span className="text-[11.5px] text-muted-foreground">
            {live
              ? 'A run from here reaches real inboxes and the real CRM.'
              : 'Nothing leaves this machine. Emails render, the webhook is not posted.'}
          </span>
        </span>
      </span>

      <span className="h-8 w-px bg-border" />

      <span className="flex items-center gap-2.5">
        <Switch
          id="arm-emails"
          checked={armed.emails}
          onCheckedChange={(emails) => onChange({ ...armed, emails })}
        />
        <Label htmlFor="arm-emails" className="text-[12.5px]">
          Really send the two emails
        </Label>
      </span>

      <span className="flex items-center gap-2.5">
        <Switch
          id="arm-lead"
          checked={armed.lead}
          onCheckedChange={(lead) => onChange({ ...armed, lead })}
        />
        <Label htmlFor="arm-lead" className="text-[12.5px]">
          Really file the lead in {crm}
        </Label>
      </span>

      <span className="grow" />
      <span className="hidden max-w-80 text-[11.5px] text-pretty text-muted-foreground/80 xl:block">
        Both reset when the page reloads. Nothing else on this page can send anything.
      </span>
    </div>
  )
}
