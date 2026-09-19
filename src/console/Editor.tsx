import * as React from 'react'
import { Button } from '../components/ui/button.tsx'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card.tsx'
import { Checkbox } from '../components/ui/checkbox.tsx'
import { Input } from '../components/ui/input.tsx'
import { Label } from '../components/ui/label.tsx'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs.tsx'
import { Textarea } from '../components/ui/textarea.tsx'
import { boot } from './api.ts'
import { MailPreview } from './MailPreview.tsx'
import { WebhookKeys } from './WebhookKeys.tsx'
import type { EditableEnvelope, EditableLocation, EmailLabels } from './types.ts'

/**
 * One location's configuration, as the file declares it.
 *
 * Four sub-tabs because the four things a lead touches are different jobs: who
 * the customer hears from, who internally is told, what the CRM receives, and
 * what the pricing block says. They all save together, since they all live in
 * one entry in one file.
 */

const lines = (v: string[]) => v.join('\n')
const unlines = (v: string) =>
  v
    .split('\n')
    .map((x) => x.trim())
    .filter(Boolean)

export function Editor({
  location,
  labels,
  onLocation,
  onLabels,
}: {
  location: EditableLocation
  labels: EmailLabels
  onLocation: (next: EditableLocation) => void
  onLabels: (next: EmailLabels) => void
}) {
  const { crm, single } = boot()
  const set = (patch: Partial<EditableLocation>) => onLocation({ ...location, ...patch })

  /** A [data-copy-key] edited in the preview maps back to one config field. */
  const applyCopy = (key: string, template: string) => {
    if (key === 'responsePromise') return set({ emailResponsePromise: template })
    if (key.startsWith('rows.')) {
      return onLabels({ ...labels, rows: { ...labels.rows, [key.slice(5)]: template } })
    }
    if (key.startsWith('pricing.')) {
      return onLabels({ ...labels, pricing: { ...labels.pricing, [key.slice(8)]: template } })
    }
    const [group, field] = key.split('.')
    if (group === 'client') return set({ clientCopy: { ...location.clientCopy, [field]: template } })
    if (group === 'admin') return set({ adminCopy: { ...location.adminCopy, [field]: template } })
  }

  return (
    <Tabs defaultValue="client" className="gap-4">
      <TabsList>
        <TabsTrigger value="client">Customer email</TabsTrigger>
        <TabsTrigger value="admin">Team email</TabsTrigger>
        <TabsTrigger value="webhooks">Webhook</TabsTrigger>
        <TabsTrigger value="pricing">Pricing wording</TabsTrigger>
      </TabsList>

      <TabsContent value="client" className="space-y-4">
        <Envelope
          title="Who the confirmation comes from, and who else sees it"
          description="The From domain must be verified in the sending account, or the message is rejected and the customer hears nothing."
          value={location.clientEmail}
          onChange={(clientEmail) => set({ clientEmail })}
        />
        <Card>
          <CardHeader>
            <CardTitle className="text-base">What it says</CardTitle>
            <CardDescription>
              The real email. Edit it where you read it.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <MailPreview
              slug={location.slug}
              kind="client"
              dateFormat={labels.dateFormat}
              onCopyChange={applyCopy}
              onDateFormatChange={(dateFormat) => onLabels({ ...labels, dateFormat })}
            />
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="admin" className="space-y-4">
        <Envelope
          title="Who is told about a new lead"
          description="Everyone listed is on the To line. Leave it empty and nobody is notified — the customer still gets their confirmation, so it fails quietly."
          value={location.adminEmail}
          onChange={(adminEmail) => set({ adminEmail })}
        />
        <Card>
          <CardHeader>
            <CardTitle className="text-base">What it says</CardTitle>
          </CardHeader>
          <CardContent>
            <MailPreview
              slug={location.slug}
              kind="admin"
              dateFormat={labels.dateFormat}
              onCopyChange={applyCopy}
              onDateFormatChange={(dateFormat) => onLabels({ ...labels, dateFormat })}
            />
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="webhooks" className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{crm} webhook</CardTitle>
            <CardDescription>
              Where the lead is filed. The URL and its keys change together or not at all — a
              correct payload sent to the wrong webhook is accepted and dropped.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="webhookUrl">Endpoint</Label>
              <Input
                id="webhookUrl"
                value={location.webhookUrl}
                onChange={(e) => set({ webhookUrl: e.target.value })}
                className="font-mono text-xs"
              />
            </div>
            <WebhookKeys
              keys={location.webhookKeys}
              onChange={(webhookKeys) => set({ webhookKeys })}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">What this location sells</CardTitle>
            <CardDescription>
              gofuse has no indoor/outdoor concept — both collapse to one "store-it" service — so
              the catalog cannot answer this and the form has to be told.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex gap-6">
            {(['indoor', 'outdoor'] as const).map((option) => (
              <div key={option} className="flex items-center gap-2">
                <Checkbox
                  id={`storage-${option}`}
                  checked={location.storageOptions.includes(option)}
                  onCheckedChange={(v) =>
                    set({
                      storageOptions:
                        v === true
                          ? [...location.storageOptions, option]
                          : location.storageOptions.filter((s) => s !== option),
                    })
                  }
                />
                <Label htmlFor={`storage-${option}`} className="capitalize">
                  {option} storage
                </Label>
              </div>
            ))}
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="pricing" className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Pricing wording</CardTitle>
            <CardDescription>
              {single
                ? 'Shared with every email this site sends.'
                : 'Shared by every market — editing here changes the others too.'}{' '}
              <code className="rounded bg-muted px-1 py-0.5 text-xs">{'{amount}'}</code>,{' '}
              <code className="rounded bg-muted px-1 py-0.5 text-xs">{'{monthly}'}</code> and{' '}
              <code className="rounded bg-muted px-1 py-0.5 text-xs">{'{firstMonth}'}</code> are
              filled in from the live quote.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            {Object.entries(labels.pricing).map(([key, value]) => (
              <div key={key} className="space-y-2">
                <Label htmlFor={`pricing-${key}`} className="font-mono text-xs">
                  {key}
                </Label>
                <Input
                  id={`pricing-${key}`}
                  value={value}
                  onChange={(e) =>
                    onLabels({ ...labels, pricing: { ...labels.pricing, [key]: e.target.value } })
                  }
                />
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Row labels</CardTitle>
            <CardDescription>
              The left-hand column of the details block in both emails.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-3">
            {Object.entries(labels.rows).map(([key, value]) => (
              <div key={key} className="space-y-2">
                <Label htmlFor={`row-${key}`} className="font-mono text-xs">
                  {key}
                </Label>
                <Input
                  id={`row-${key}`}
                  value={value}
                  onChange={(e) =>
                    onLabels({ ...labels, rows: { ...labels.rows, [key]: e.target.value } })
                  }
                />
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">This location</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="emailBrand">Subject-line brand</Label>
              <Input
                id="emailBrand"
                value={location.emailBrand}
                onChange={(e) => set({ emailBrand: e.target.value })}
              />
              <p className="text-xs text-muted-foreground">
                Reads "{location.emailBrand} Quote - Keep It".
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="phoneNumber">Phone shown to the customer</Label>
              <Input
                id="phoneNumber"
                value={location.phoneNumber}
                onChange={(e) => set({ phoneNumber: e.target.value })}
              />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="footer">Footer lines</Label>
              <Textarea
                id="footer"
                rows={3}
                value={lines(location.emailFooterLines)}
                onChange={(e) => set({ emailFooterLines: unlines(e.target.value) })}
              />
              <p className="text-xs text-muted-foreground">
                One per line, under the card. A street address belongs here once there is one.
              </p>
            </div>
          </CardContent>
        </Card>
      </TabsContent>
    </Tabs>
  )
}

function Envelope({
  title,
  description,
  value,
  onChange,
}: {
  title: string
  description: string
  value: EditableEnvelope
  onChange: (next: EditableEnvelope) => void
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label>From name</Label>
          <Input
            value={value.fromName}
            onChange={(e) => onChange({ ...value, fromName: e.target.value })}
          />
        </div>
        <div className="space-y-2">
          <Label>From address</Label>
          <Input
            value={value.fromAddress}
            onChange={(e) => onChange({ ...value, fromAddress: e.target.value })}
          />
        </div>
        <div className="space-y-2">
          <Label>To</Label>
          <Textarea
            rows={3}
            value={lines(value.to)}
            onChange={(e) => onChange({ ...value, to: unlines(e.target.value) })}
          />
          <p className="text-xs text-muted-foreground">
            One per line. <code className="rounded bg-muted px-1">{'{{lead.email}}'}</code> is
            whoever submitted the form.
          </p>
        </div>
        <div className="space-y-2">
          <Label>Cc</Label>
          <Textarea
            rows={3}
            value={lines(value.ccs)}
            onChange={(e) => onChange({ ...value, ccs: unlines(e.target.value) })}
          />
          <p className="text-xs text-muted-foreground">Visible to everyone on the message.</p>
        </div>
      </CardContent>
    </Card>
  )
}
