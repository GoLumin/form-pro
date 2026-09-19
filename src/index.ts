// The integration. Adding it to astro.config gives a site the console at
// /form-preview and the virtual modules the rest of the package reads.
//
// The site keeps two files of its own: src/config/locations.ts, which the
// console edits and commits, and src/config/revisions.json, which records who
// changed what. Everything else — the page, the editor, the templates, the
// daily check — comes from here, so a fix lands once and every site gets it on
// its next install.

import type { AstroIntegration } from 'astro'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'
import path from 'node:path'

export interface FormConsoleOptions {
  /**
   * The site's config module, relative to the project root. It must export
   * LOCATIONS, EMAIL_LABELS and SITE_SETTINGS (see SiteConfigModule).
   */
  config?: string
  /** Where the revision log lives, relative to the project root. */
  revisions?: string
  /**
   * The site's mail transport, relative to the project root. It must export
   * `sendEmail`. The package renders every message and sends none of its own,
   * so a preview and the daily check go out the same way a real lead does —
   * including through a dev outbox, which a private sender would bypass.
   */
  mail?: string
  /**
   * The site's quoting client, relative to the project root, exporting
   * `getConfig` and `previewQuote`. Defaults to the `virtual:quoting` module
   * the quote-experience integration provides.
   */
  quoting?: string
  /**
   * A module exporting `readEnv(name)`, for a runtime whose variables are not
   * on `process.env`. A Cloudflare site needs one — since Astro 6 the only way
   * to its secrets is `import { env } from 'cloudflare:workers'`, which this
   * package cannot import because that specifier does not resolve elsewhere.
   * Without it, `process.env` and `import.meta.env` are all that is read.
   */
  env?: string
  /** Where the console is served. */
  route?: string
  /**
   * Basic auth for the console. FORM_CONSOLE_USER / FORM_CONSOLE_PASSWORD in
   * the environment win over these, which is how you rotate without a deploy.
   *
   * Treat a value written here for what it is: a shared password in a public-ish
   * repository. It keeps the page away from crawlers and casual hands. The page
   * can spend money on a real gofuse quote, so set the environment variables on
   * anything that matters.
   */
  user?: string
  password?: string
  /** Inject GET /api/canary, the daily form check this site runs against itself. */
  canary?: boolean
  /** "owner/repo" for Save and deploy. GITHUB_REPO in the environment wins. */
  repo?: string
  /** Branch the console commits to. GITHUB_BRANCH in the environment wins. */
  branch?: string
  /**
   * Brand shown in the console's own chrome. Defaults to the first location's
   * name, which is right for a single-location site.
   */
  title?: string
  /**
   * The logo at the top of every email: an absolute URL, or a site-root path
   * resolved against the request's own origin.
   */
  logo?: string
  /**
   * What the CRM at the end of the webhook is called, so the console names it
   * instead of saying "the CRM" — the console's job is to be read by whoever
   * owns that inbox, and they know it by its name.
   */
  crm?: string
  /** Who builds and deploys this site, named in the deploy warnings. */
  host?: string
  /**
   * A module exporting `getEmailLogoUrl(hostname)`, for a site whose logo
   * varies by host. It wins over `logo` when both are given.
   */
  logoResolver?: string
}

const NAME = '@golumin/astro-form-console'

/** This package's own version, read once, for the console bundle's cache key. */
const VERSION: string = (() => {
  try {
    return JSON.parse(
      readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8')
    ).version
  } catch {
    return '0'
  }
})()

/** Resolved options, frozen into a virtual module the runtime reads. */
export interface ResolvedOptions {
  route: string
  configPath: string
  revisionsPath: string
  user: string
  password: string
  canary: boolean
  repo: string
  branch: string
  title: string
  logo: string
  /** Cache-busts the console bundle when the package is upgraded. */
  version: string
  crm: string
  host: string
}

export default function formConsole(options: FormConsoleOptions = {}): AstroIntegration {
  return {
    name: NAME,
    hooks: {
      'astro:config:setup': ({ config, injectRoute, updateConfig, logger }) => {
        const root = fileURLToPath(config.root)
        const configPath = path.resolve(root, options.config ?? 'src/config/locations.ts')
        const revisionsPath = path.resolve(
          root,
          options.revisions ?? 'src/config/revisions.json'
        )
        const mailPath = options.mail ? path.resolve(root, options.mail) : null
        const logoPath = options.logoResolver ? path.resolve(root, options.logoResolver) : null
        const envPath = options.env ? path.resolve(root, options.env) : null
        const quotingPath = options.quoting ? path.resolve(root, options.quoting) : null
        const route = (options.route ?? '/form-preview').replace(/\/+$/, '') || '/form-preview'
        const packageRoot = path.resolve(fileURLToPath(import.meta.url), '../..')

        const resolved: ResolvedOptions = {
          route,
          // Repo-relative, because the editor commits through the GitHub API and
          // GitHub knows nothing about this machine's directory layout.
          configPath: path.relative(root, configPath).split(path.sep).join('/'),
          revisionsPath: path.relative(root, revisionsPath).split(path.sep).join('/'),
          user: options.user ?? 'MuleBox',
          password: options.password ?? 'MuleBox@2026',
          canary: options.canary ?? true,
          repo: options.repo ?? '',
          branch: options.branch ?? 'main',
          title: options.title ?? '',
          logo: options.logo ?? '/logo.webp',
          version: VERSION,
          crm: options.crm ?? 'the CRM',
          host: options.host ?? 'your host',
        }

        updateConfig({
          vite: {
            // .astro and .tsx ship as source, so Vite has to compile them
            // rather than hand the file to the Node loader.
            ssr: { noExternal: [NAME] },
            // A linked checkout of this package sits outside the project root,
            // and the dev server refuses to serve a client island from there.
            // The root is listed too because naming `allow` at all replaces
            // Vite's default rather than adding to it. Harmless once installed
            // from the registry, where the package is already inside
            // node_modules.
            server: { fs: { allow: [root, packageRoot] } },
            plugins: [
              {
                name: 'form-console:virtual',
                resolveId(id: string) {
                  if (id.startsWith('virtual:form-console/')) return '\0' + id
                  return null
                },
                load(id: string) {
                  if (id === '\0virtual:form-console/config') {
                    // Re-exported rather than copied: the console reads exactly
                    // the module the site's own form reads, so a preview can
                    // never describe a config the form is not using.
                    //
                    // ZIP_LOOKUP_ORDER is defaulted here rather than left
                    // missing, because a single-location site has nothing to
                    // order and should not have to say so. An explicit export
                    // wins over the star, so a site that does declare one keeps
                    // it.
                    return [
                      `export * from ${JSON.stringify(configPath)}`,
                      `import * as __site from ${JSON.stringify(configPath)}`,
                      `export const ZIP_LOOKUP_ORDER =`,
                      `  __site.ZIP_LOOKUP_ORDER ?? Object.keys(__site.LOCATIONS)`,
                    ].join('\n')
                  }
                  if (id === '\0virtual:form-console/options') {
                    return `export default ${JSON.stringify(resolved)}`
                  }
                  if (id === '\0virtual:form-console/mail') {
                    // No transport configured: rendering still works, and
                    // anything that would send says so rather than silently
                    // dropping the message.
                    return mailPath
                      ? `export { sendEmail } from ${JSON.stringify(mailPath)}`
                      : `export const sendEmail = async () => {
                           throw new Error(
                             'form-console: no mail transport configured. Pass mail: "./src/utils/sendEmail.ts" to the integration.'
                           )
                         }`
                  }
                  if (id === '\0virtual:form-console/env') {
                    return envPath
                      ? `export { readEnv } from ${JSON.stringify(envPath)}`
                      : `export const readEnv = () => undefined`
                  }
                  if (id === '\0virtual:form-console/logo') {
                    return logoPath
                      ? `export { getEmailLogoUrl } from ${JSON.stringify(logoPath)}`
                      : `import options from 'virtual:form-console/options'
                         export const getEmailLogoUrl = async () => options.logo`
                  }
                  if (id === '\0virtual:form-console/quoting') {
                    return `export * from ${JSON.stringify(quotingPath ?? 'virtual:quoting')}`
                  }
                  return null
                },
              },
            ],
          },
        })

        injectRoute({
          pattern: route,
          entrypoint: `${NAME}/routes/console.astro`,
        })
        // The console's own bundle, versioned so a new package release busts
        // the cache and an unchanged one does not.
        injectRoute({
          pattern: `${route}/assets/[file]`,
          entrypoint: `${NAME}/routes/assets.ts`,
        })
        for (const endpoint of ['read', 'write', 'preview', 'submit', 'options']) {
          injectRoute({
            pattern: `${route}/api/${endpoint}`,
            entrypoint: `${NAME}/routes/api/${endpoint}.ts`,
          })
        }
        if (resolved.canary) {
          injectRoute({ pattern: '/api/canary', entrypoint: `${NAME}/routes/api/canary.ts` })
        }

        if (config.output === 'static') {
          logger.warn(
            'The console is server-rendered and its endpoints are API routes. ' +
              'This site is output: "static", so /form-preview will not run.'
          )
        }
      },
    },
  }
}

export type { Location, Lead, EmailEnvelope, SiteSettings, EmailLabels } from './types.ts'
