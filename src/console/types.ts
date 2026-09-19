export interface EditableEnvelope {
  fromName: string
  fromAddress: string
  to: string[]
  ccs: string[]
}

export interface EditableKey {
  key: string
  mode: 'field' | 'value'
  from: string
  value: string
  transform: string
  map: Record<string, string>
  hasWhenEmpty: boolean
  whenEmpty: string
}

export interface EditableLocation {
  slug: string
  name: string
  emailBrand: string
  phoneNumber: string
  emailResponsePromise: string
  emailFooterLines: string[]
  storageOptions: string[]
  webhookUrl: string
  clientEmail: EditableEnvelope
  adminEmail: EditableEnvelope
  clientCopy: Record<string, string>
  adminCopy: Record<string, string>
  webhookKeys: EditableKey[]
}

export interface EmailLabels {
  dateFormat: string
  rows: Record<string, string>
  pricing: Record<string, string>
}

export interface SiteSettings {
  canaryEnabled: boolean
  canaryEmailTo: string
  canarySendEmails: boolean
  marketingCc: string
  franchiseAdminTo: string[]
}

export interface RevisionChange {
  field: string
  before: string
  after: string
}

export interface Revision {
  at: string
  author: string
  slug: string
  market: string
  fields: string[]
  kind: 'local' | 'deploy'
  commit?: { sha: string; url: string; branch: string } | null
  changes?: RevisionChange[]
}

export interface ReadResponse {
  locations: EditableLocation[]
  labels: EmailLabels
  settings: SiteSettings
  revisions: Revision[]
  writable: boolean
  deployable: boolean
}

export interface SubmitResponse {
  served: boolean
  message?: string
  market?: { slug: string; name: string; baseUrl: string; phoneNumber: string; fromPage: boolean }
  emailSubject?: string
  clientEnvelope?: { from: string; to: string[]; cc: string[] }
  adminEnvelope?: { from: string; to: string[]; cc: string[] }
  zip?: string
  leadEmail?: string
  webhook?: { url: string; payload: Record<string, string> }
  clientHtml?: string
  adminHtml?: string
  sent?: boolean
  posted?: boolean
  quoteId?: string | null
  thankYouUrl?: string
  notes: string[]
}
