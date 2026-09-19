declare module 'virtual:form-console/options' {
  import type { ResolvedOptions } from './index.ts'
  const options: ResolvedOptions
  export default options
}

declare module 'virtual:form-console/config' {
  import type { EmailLabels, Location, SiteSettings } from './types.ts'
  export const LOCATIONS: Record<string, Location>
  export const EMAIL_LABELS: EmailLabels
  export const SITE_SETTINGS: SiteSettings
  export const ZIP_LOOKUP_ORDER: string[] | undefined
}

declare module 'virtual:form-console/mail' {
  import type { MailSender } from './email/send.ts'
  export const sendEmail: MailSender
}

declare module 'virtual:form-console/quoting' {
  export const getConfig: (params?: Record<string, unknown>, overrides?: unknown) => Promise<any>
  export const previewQuote: (params: Record<string, unknown>, overrides?: unknown) => Promise<any>
  export const createQuote: (params: Record<string, unknown>, overrides?: unknown) => Promise<any>
}

declare module 'virtual:form-console/logo' {
  export const getEmailLogoUrl: (hostname?: string) => Promise<string>
}

declare module 'virtual:form-console/env' {
  export const readEnv: (name: string) => string | undefined
}
