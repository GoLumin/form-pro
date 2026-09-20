// The integration. Adding it to astro.config gives a site the console at
// /form-preview and the virtual modules the rest of the package reads.
//
// The site keeps two files of its own: src/config/locations.ts, which the
// console edits and commits, and src/config/revisions.json, which records who
// changed what. Everything else — the page, the editor, the templates, the
// daily check — comes from here, so a fix lands once and every site gets it on
// its next install.

import type { AstroIntegration } from 'astro'
import { adapterKind, databaseModule, envModule } from './generated.ts'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
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
   * Where the console keeps sign-ins, the revision log and the daily check's
   * history.
   *
   * The two hosts have different native storage and neither is reachable from
   * the other, so the plugin writes the right client for the adapter this site
   * deploys with — a D1 binding on Cloudflare, a Postgres connection on
   * Netlify — and the other one is never in the bundle. Sites pass nothing
   * unless they want different names.
   *
   * With no database reachable the console keeps its shared-password gate and
   * the Settings tab says so, which is a supported state rather than a fault.
   */
  database?: {
    /** Cloudflare: the D1 binding's name. @default "CONSOLE_DB" */
    binding?: string
    /** Netlify and Node: the variable holding the connection string. */
    urlEnv?: string
    /** Set false to keep the shared password even where storage exists. */
    enabled?: boolean
  }
  /**
   * A module exporting `readEnv(name)`, for a host whose variables this plugin
   * does not already know how to read.
   *
   * Rarely needed: Cloudflare and Node are both handled, generated per adapter
   * for the same reason the database client is. Pass one only for a runtime
   * neither covers.
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

const NAME = '@golumin/form-pro'




/**
 * A cache key for the console bundle, taken from the bundle's own contents.
 *
 * Not the package version: during development the files change constantly and
 * the version does not, so a version key serves a stale console from cache and
 * every edit looks like it did nothing. A content hash moves whenever the
 * output does and never when it doesn't, which is also what makes it safe to
 * serve the assets as immutable.
 */
const VERSION: string = (() => {
  try {
    const hash = createHash('sha1')
    for (const name of ['console.js', 'signin.js', 'console.css']) {
      hash.update(readFileSync(fileURLToPath(new URL(`./console/${name}`, import.meta.url))))
    }
    return hash.digest('hex').slice(0, 12)
  } catch {
    return String(Date.now())
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
  /** Whether the site handed in a database module at all. */
  hasDb: boolean
  /** The adapter this site deploys with, so the console can name its storage. */
  adapter: 'cloudflare' | 'netlify' | 'node' | 'unknown'
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
        const adapter = adapterKind(config.adapter?.name)
        // A single-location site has nothing to order and should not have to
        // say so; a multi-market one declares the order beside the markets.
        const declaresLookupOrder = /export\s+const\s+ZIP_LOOKUP_ORDER/.test(
          readFileSync(configPath, 'utf8')
        )
        const dbSource =
          options.database?.enabled === false
            ? 'export const database = null'
            : databaseModule(adapter, options.database ?? {})
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
          hasDb: options.database?.enabled !== false,
          adapter,
        }

        updateConfig({
          vite: {
            // .astro and .tsx ship as source, so Vite has to compile them
            // rather than hand the file to the Node loader.
            ssr: { noExternal: [NAME] },
            // Excluded from dependency pre-bundling, not just from SSR
            // externalisation. Pre-bundling runs esbuild directly and never
            // calls a plugin's resolveId, so it cannot resolve the virtual
            // modules these files import — and it only kicks in once the
            // package is a real directory in node_modules, which is why a
            // linked checkout never hit it and a git install did.
            optimizeDeps: { exclude: [NAME] },
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
                  if (id.startsWith('virtual:form-pro/')) return '\0' + id
                  return null
                },
                load(id: string) {
                  if (id === '\0virtual:form-pro/config') {
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
                      // Whether the site declares an order is settled here, by
                      // reading the file, rather than by reaching for a named
                      // export that may not exist — which the bundler is right
                      // to warn about.
                      declaresLookupOrder
                        ? ''
                        : [
                            `import { LOCATIONS as __locations } from ${JSON.stringify(configPath)}`,
                            `export const ZIP_LOOKUP_ORDER = Object.keys(__locations)`,
                          ].join('\n'),
                    ].join('\n')
                  }
                  if (id === '\0virtual:form-pro/options') {
                    return `export default ${JSON.stringify(resolved)}`
                  }
                  if (id === '\0virtual:form-pro/mail') {
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
                  if (id === '\0virtual:form-pro/db') return dbSource
                  if (id === '\0virtual:form-pro/env') {
                    return envPath
                      ? `export { readEnv } from ${JSON.stringify(envPath)}`
                      : envModule(adapter)
                  }
                  if (id === '\0virtual:form-pro/logo') {
                    return logoPath
                      ? `export { getEmailLogoUrl } from ${JSON.stringify(logoPath)}`
                      : `import options from 'virtual:form-pro/options'
                         export const getEmailLogoUrl = async () => options.logo`
                  }
                  if (id === '\0virtual:form-pro/quoting') {
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
        // Better Auth's own endpoints, under the console's route rather than
        // the site's /api/auth, so installing this cannot collide with an
        // authentication the site already has.
        injectRoute({
          pattern: `${route}/auth/[...all]`,
          entrypoint: `${NAME}/routes/auth.ts`,
        })
        injectRoute({ pattern: `${route}/sign-in`, entrypoint: `${NAME}/routes/sign-in.astro` })
        for (const endpoint of ['read', 'write', 'preview', 'submit', 'options', 'database']) {
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

      // Declared by the integration rather than shipped as a .d.ts the consumer
      // has to remember to include.
      'astro:config:done': ({ injectTypes }) => {
        injectTypes({ filename: 'form-pro.d.ts', content: CONSOLE_TYPES })
      },
    },
  }
}

const CONSOLE_TYPES = `declare module 'virtual:form-pro/config' {
  import type { EmailLabels, Location, SiteSettings } from '@golumin/form-pro/types'
  export const LOCATIONS: Record<string, Location>
  export const EMAIL_LABELS: EmailLabels
  export const SITE_SETTINGS: SiteSettings
  export const ZIP_LOOKUP_ORDER: string[]
}
`

export type { Location, Lead, EmailEnvelope, SiteSettings, EmailLabels } from './types.ts'
