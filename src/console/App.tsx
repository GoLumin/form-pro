import * as React from 'react'
import { AlertTriangle, Loader2, Rocket, Save } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '../components/ui/alert.tsx'
import { Badge } from '../components/ui/badge.tsx'
import { Button } from '../components/ui/button.tsx'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog.tsx'
import { Input } from '../components/ui/input.tsx'
import { Label } from '../components/ui/label.tsx'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs.tsx'
import { api, boot, local, STORE } from './api.ts'
import { Editor } from './Editor.tsx'
import { QuoteForm } from './QuoteForm.tsx'
import { Results } from './Results.tsx'
import { Revisions } from './Revisions.tsx'
import { Settings } from './Settings.tsx'
import { SETTING_INFO } from './settingInfo.tsx'
import type {
  EditableProfile,
  EmailLabels,
  FieldDef,
  ReadResponse,
  Revision,
  SiteSettings,
  SubmitResponse,
} from './types.ts'

type SaveState = { tone: 'idle' | 'busy' | 'good' | 'bad'; message: React.ReactNode }

export function App() {
  const { brand, single, crm, host, configPath } = boot()

  const [result, setResult] = React.useState<SubmitResponse | null>(null)
  const [busy, setBusy] = React.useState(false)

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

  const [author, setAuthor] = React.useState(() => local.get(STORE.author) ?? '')
  const [asking, setAsking] = React.useState<null | { deploy: boolean }>(null)
  const [askName, setAskName] = React.useState('')
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

  const commit = async (deploy: boolean, who: string) => {
    if (!profile || !labels || !settings) return
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

  const ask = (deploy: boolean) => {
    setAskName(author)
    setAsking({ deploy })
  }

  const confirmAuthor = (event: React.FormEvent) => {
    event.preventDefault()
    const who = askName.trim()
    if (!who) return
    setAuthor(who)
    local.set(STORE.author, who)
    const deploy = asking?.deploy ?? false
    setAsking(null)
    if (deploy) {
      const ok = window.confirm(
        `Commit ${profile?.name ?? 'this change'} and deploy?\n\n` +
          `This goes live on ${window.location.hostname} in a couple of minutes, with no review step.`
      )
      if (!ok) return
    }
    void commit(deploy, who)
  }

  const saveBar = (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-card p-3">
      <Button onClick={() => ask(false)} disabled={save.tone === 'busy' || !data?.writable}>
        <Save /> {data?.writable ? 'Save locally' : 'Save'}
      </Button>
      {data?.deployable && (
        <Button variant="secondary" onClick={() => ask(true)} disabled={save.tone === 'busy'}>
          {save.tone === 'busy' ? <Loader2 className="animate-spin" /> : <Rocket />} Save and deploy
        </Button>
      )}
      <p
        className={
          save.tone === 'bad'
            ? 'text-sm text-destructive'
            : save.tone === 'good'
              ? 'text-sm text-success'
              : 'text-sm text-muted-foreground'
        }
        aria-live="polite"
      >
        {save.message ||
          (data?.writable
            ? `Saving rewrites ${configPath} on this machine.`
            : `A deployed build has no writable file — use Save and deploy.`)}
      </p>
    </div>
  )

  const productionWarning = (
    <Alert className="border-warning/30 bg-warning-surface text-warning-ink">
      <AlertTriangle className="text-warning" />
      <AlertTitle>Editing here changes production</AlertTitle>
      {/* One <p> around the prose on purpose: AlertDescription lays its
          children out as grid rows, so loose text nodes and an inline <code>
          would each land on a line of their own. */}
      <AlertDescription className="text-warning-ink/90">
        <p>
          The Editor writes{' '}
          <code className="rounded bg-warning/15 px-1 font-mono">{configPath}</code> — the source
          the live site runs on, not a copy of it.
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <b>Save and deploy</b> commits straight to the production branch; {host} builds it and
            it is live within a couple of minutes, with no review step.
          </li>
          <li>
            A webhook URL or key that does not match the field mapping on the other end is{' '}
            <b>not an error</b> — {crm} accepts the request and drops the lead, with nothing visible
            on the site.
          </li>
          <li>
            A From address whose domain is not verified in the sending account is rejected outright,
            and the client hears nothing.
          </li>
          {!single && (
            <li>
              Field labels, the subject line and pricing wording are shared by every profile;
              editing them here changes the others.
            </li>
          )}
        </ul>
      </AlertDescription>
    </Alert>
  )

  return (
    <div className="min-h-screen bg-shell text-foreground">
      <header className="flex flex-wrap items-center gap-3 border-b bg-card px-6 py-4">
        <Badge variant="outline" className="uppercase tracking-wider">
          Form console
        </Badge>
        <h1 className="text-lg font-semibold">{brand}</h1>
        <p className="text-sm text-muted-foreground">
          Nothing is sent and nothing is filed unless you tick the boxes.
        </p>
        <Button
          variant="ghost"
          size="icon"
          className="ml-auto rounded-full text-warning hover:bg-warning-surface"
          aria-label="What editing here affects"
          onClick={() => setWarning(true)}
        >
          <AlertTriangle />
        </Button>
      </header>

      <div className="grid gap-6 p-6 lg:grid-cols-[minmax(320px,1fr)_2fr]">
        <div className="h-fit space-y-5 rounded-xl border bg-card p-5 shadow-xs">
          <div>
            <h2 className="font-semibold">Test submission</h2>
            <p className="text-sm text-muted-foreground">
              One submission, run through the real code paths.
            </p>
          </div>
          {fields.length ? (
            <QuoteForm fields={fields} onResult={setResult} busy={busy} setBusy={setBusy} />
          ) : (
            <p className="text-sm text-muted-foreground">Loading the form…</p>
          )}
        </div>

        <Tabs defaultValue="results" className="gap-4">
          <TabsList>
            <TabsTrigger value="results">Results</TabsTrigger>
            <TabsTrigger value="editor">Editor</TabsTrigger>
            <TabsTrigger value="revisions">Revisions</TabsTrigger>
            <TabsTrigger value="settings">Settings</TabsTrigger>
          </TabsList>

          <TabsContent value="results">
            <Results result={result} />
          </TabsContent>

          <TabsContent value="editor" className="space-y-4">
            {productionWarning}
            {!single && (
              <div className="flex flex-wrap gap-2">
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
            )}
            {profile && labels ? (
              <>
                <Editor
                  profile={profile}
                  fields={fields}
                  fieldLabels={fieldLabels}
                  labels={labels}
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
          </TabsContent>

          <TabsContent value="revisions">
            <Revisions revisions={revisions} onShowDiff={setDiff} />
          </TabsContent>

          <TabsContent value="settings" className="space-y-4">
            {productionWarning}
            {settings ? (
              <>
                <Settings settings={settings} onChange={setSettings} onExplain={setExplaining} />
                {saveBar}
              </>
            ) : (
              <p className="text-sm text-muted-foreground">Loading the settings…</p>
            )}
          </TabsContent>
        </Tabs>
      </div>

      {/* Who is making this change — recorded against it in Revisions. */}
      <Dialog open={Boolean(asking)} onOpenChange={(open) => !open && setAsking(null)}>
        <DialogContent>
          <form onSubmit={confirmAuthor}>
            <DialogHeader>
              <DialogTitle>Who is making this change?</DialogTitle>
              <DialogDescription>
                Recorded against it in Revisions, so the history says who as well as what.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2 py-4">
              <Label htmlFor="who">Name</Label>
              <Input
                id="who"
                value={askName}
                onChange={(e) => setAskName(e.target.value)}
                autoFocus
                required
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setAsking(null)}>
                Cancel
              </Button>
              <Button type="submit">Continue</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

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
              {diff ? `${diff.profile} · ${diff.author} · ${new Date(diff.at).toLocaleString()}` : ''}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {(diff?.changes ?? []).map((c, i) => (
              <div key={`${c.field}-${i}`} className="space-y-1.5 rounded-lg border p-3">
                <p className="font-mono text-xs text-muted-foreground">{c.field}</p>
                <p className="rounded bg-destructive/10 px-2 py-1 font-mono text-xs line-through">
                  {c.before || '(empty)'}
                </p>
                <p className="rounded bg-success-surface px-2 py-1 font-mono text-xs">
                  {c.after || '(empty)'}
                </p>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
