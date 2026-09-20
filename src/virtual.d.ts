declare module 'virtual:form-pro/options' {
  import type { ResolvedOptions } from './index.ts'
  const options: ResolvedOptions
  export default options
}

declare module 'virtual:form-pro/config' {
  import type {
    EmailLabels,
    FieldDef,
    Profile,
    QuotingConfig,
    RoutingConfig,
    SiteSettings,
  } from './types.ts'
  export const FIELDS: readonly FieldDef[]
  export const PROFILES: Record<string, Profile>
  export const EMAIL_LABELS: EmailLabels
  export const SITE_SETTINGS: SiteSettings
  export const ROUTING: RoutingConfig | undefined
  export const QUOTING: QuotingConfig | undefined
}

declare module 'virtual:form-pro/mail' {
  import type { MailSender } from './email/send.ts'
  export const sendEmail: MailSender
}

declare module 'virtual:form-pro/quoting' {
  /** False on a site that wired no pricing back end; the rest then throw. */
  export const enabled: boolean
  export const getConfig: (params?: Record<string, unknown>, overrides?: unknown) => Promise<any>
  export const previewQuote: (params: Record<string, unknown>, overrides?: unknown) => Promise<any>
  export const createQuote: (params: Record<string, unknown>, overrides?: unknown) => Promise<any>
}

declare module 'virtual:form-pro/logo' {
  export const getEmailLogoUrl: (hostname?: string) => Promise<string>
}

declare module 'virtual:form-pro/env' {
  export const readEnv: (name: string) => string | undefined
}

declare module 'virtual:form-pro/db' {
  import type { DatabaseHandle } from './db/index.ts'
  export const database: (() => DatabaseHandle | null) | null
}

declare module 'virtual:form-pro/assets' {
  export const js: string
  export const signinJs: string
  export const css: string
}
