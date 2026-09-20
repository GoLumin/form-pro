declare module 'virtual:form-pro/options' {
  import type { ResolvedOptions } from './index.ts'
  const options: ResolvedOptions
  export default options
}

declare module 'virtual:form-pro/config' {
  import type { EmailLabels, Location, SiteSettings } from './types.ts'
  export const LOCATIONS: Record<string, Location>
  export const EMAIL_LABELS: EmailLabels
  export const SITE_SETTINGS: SiteSettings
  export const ZIP_LOOKUP_ORDER: string[] | undefined
}

declare module 'virtual:form-pro/mail' {
  import type { MailSender } from './email/send.ts'
  export const sendEmail: MailSender
}

declare module 'virtual:form-pro/quoting' {
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
