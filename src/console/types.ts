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

export interface EditableProfile {
  slug: string
  name: string
  emailBrand: string
  phoneNumber: string
  emailResponsePromise: string
  emailFooterLines: string[]
  /** Which of each choice field's options this profile offers, by field id. */
  fieldOptions: Record<string, string[]>
  webhookUrl: string
  clientEmail: EditableEnvelope
  adminEmail: EditableEnvelope
  clientCopy: Record<string, string>
  adminCopy: Record<string, string>
  webhookKeys: EditableKey[]
}

/** The browser's copy of a field: the same declaration, minus its functions. */
export interface FieldDef {
  id: string
  label: string
  type: 'text' | 'email' | 'phone' | 'date' | 'zip' | 'number' | 'choice' | 'textarea'
  required?: boolean
  placeholder?: string
  options?: { value: string; label: string }[]
  showWhen?: Record<string, string | string[]>
  sample?: string
  /** Collected, but kept out of the emails' detail rows. */
  hidden?: boolean
  /** Computed from the others, so never asked for. */
  derived?: boolean
  headline?: boolean
  audience?: 'both' | 'admin'
}

export interface EmailLabels {
  dateFormat: string
  subjectTemplate: string
  adminSubjectPrefix?: string
  pricing?: Record<string, string>
}

export interface SiteSettings {
  canaryEnabled: boolean
  canaryEmailTo: string
  canarySendEmails: boolean
  marketingCc: string
  consoleUsers?: string[]
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
  profile: string
  fields: string[]
  kind: 'local' | 'deploy'
  commit?: { sha: string; url: string; branch: string } | null
  changes?: RevisionChange[]
}

export interface ReadResponse {
  profiles: EditableProfile[]
  fields: FieldDef[]
  labels: EmailLabels
  settings: SiteSettings
  revisions: Revision[]
  writable: boolean
  deployable: boolean
}

/** What the options endpoint knows about one profile, once it has resolved. */
export interface OptionsResponse {
  served: boolean
  slug: string | null
  name: string | null
  incomplete: boolean
  fieldOptions: Record<string, string[]>
  catalog: { field: string; dependsOn: string; byValue: Record<string, string[]> } | null
}

export interface SubmitResponse {
  served: boolean
  message?: string
  profile?: { slug: string; name: string; phoneNumber: string; fromPage: boolean }
  emailSubject?: string
  clientEnvelope?: { from: string; to: string[]; cc: string[] }
  adminEnvelope?: { from: string; to: string[]; cc: string[] }
  lead?: Record<string, string>
  leadEmail?: string
  webhook?: { url: string; payload: Record<string, string> }
  clientHtml?: string
  adminHtml?: string
  sent?: boolean
  posted?: boolean
  quoteId?: string | null
  thankYouUrl?: string | null
  notes: string[]
}
