// The integration. Adding it to astro.config gives a site the console at
// /form-preview and the virtual modules the rest of the package reads.
//
// The site keeps two files of its own: src/config/form.ts, which declares what
// the form collects and where a lead goes — and which the console edits and
// commits — and src/config/revisions.json, which records who changed what. Everything else — the page, the editor, the templates, the
// daily check — comes from here, so a fix lands once and every site gets it on
// its next install.

import type { AstroIntegration } from 'astro'
import { adapterKind, databaseModule, envModule } from './generated.ts'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

export interface FormConsoleOptions {
  /**
   * The site's config module, relative to the project root. It must export
   * FIELDS, PROFILES, EMAIL_LABELS and SITE_SETTINGS (see SiteConfigModule).
   * @default "src/config/form.ts"
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
   * A pricing back end, for the few sites that price what they collect.
   *
   * `true` uses the `virtual:quoting` module the quote-experience integration
   * provides; a path points at the site's own client, which must export
   * `getConfig`, `previewQuote` and `createQuote`.
   *
   * Off by default, and that is the point: most forms price nothing, and a site
   * that has no such back end should neither import one nor carry it in the
   * bundle. The site's QUOTING export says which of its fields the calls are
   * built from.
   */
  quoting?: string | boolean
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
   * really sends email and really files leads, so set the environment variables
   * on anything that matters.
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
   * Brand shown in the console's own chrome. Defaults to the first profile's
   * name, which is right for a single-profile site.
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
        const configPath = path.resolve(root, options.config ?? 'src/config/form.ts')
        const revisionsPath = path.resolve(
          root,
          options.revisions ?? 'src/config/revisions.json'
        )
        const mailPath = options.mail ? path.resolve(root, options.mail) : null
        const logoPath = options.logoResolver ? path.resolve(root, options.logoResolver) : null
        const envPath = options.env ? path.resolve(root, options.env) : null
        const adapter = adapterKind(config.adapter?.name)
        // Which optional exports the site actually declares. Read from the file
        // rather than reached for through a named import that may not exist —
        // which the bundler is right to warn about.
        const configSource = readFileSync(configPath, 'utf8')
        const declares = (name: string) =>
          new RegExp(`export\\s+const\\s+${name}\\b`).test(configSource)
        const dbSource =
          options.database?.enabled === false
            ? 'export const database = null'
            : databaseModule(adapter, options.database ?? {})
        const quotingPath =
          typeof options.quoting === 'string' ? path.resolve(root, options.quoting) : null
        const quotingEnabled = options.quoting === true || quotingPath !== null
        const route = (options.route ?? '/form-preview').replace(/\/+$/, '') || '/form-preview'
        const packageRoot = path.resolve(fileURLToPath(import.meta.url), '../..')

        const resolved: ResolvedOptions = {
          route,
          // Repo-relative, because the editor commits through the GitHub API and
          // GitHub knows nothing about this machine's directory layout.
          configPath: path.relative(root, configPath).split(path.sep).join('/'),
          revisionsPath: path.relative(root, revisionsPath).split(path.sep).join('/'),
          user: options.user ?? 'form',
          password: options.password ?? 'form-console',
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

        // The modules the package imports, written to disk and aliased rather
        // than served from a Vite plugin as `virtual:` ids.
        //
        // A plugin's resolveId is never consulted for an import that appears
        // *inside* node_modules, so once the package is installed rather than
        // linked, dependency optimisation hands those ids straight to esbuild
        // and the build fails. An alias to a real file is resolved by every
        // stage, including that one.
        const generatedDir = path.join(root, '.astro', 'form-pro')
        mkdirSync(generatedDir, { recursive: true })

        const emit = (name: string, contents: string): string => {
          const file = path.join(generatedDir, `${name}.mjs`)
          // Only written when it differs, so a watching dev server is not
          // restarted by a build that changed nothing.
          const next = `${contents.trim()}\n`
          try {
            if (readFileSync(file, 'utf8') === next) return file
          } catch {
            // Not written yet.
          }
          writeFileSync(file, next)
          return file
        }

        // The array form with anchored patterns, not an object: a string alias
        // matches by prefix, so `virtual:quoting/config` would resolve under
        // `virtual:quoting`'s file. Arrays also concatenate when two
        // integrations both add aliases, which is what we want.
        const alias: { find: RegExp; replacement: string }[] = [
          {
            find: /^virtual:form-pro\/options$/,
            replacement: emit('options', `export default ${JSON.stringify(resolved)}`),
          },
          {
            find: /^virtual:form-pro\/config$/,
            replacement: emit(
            'config',
            [
              `export * from ${JSON.stringify(configPath)}`,
              // The optional exports are filled in here so every consumer can
              // import them unconditionally, rather than each one guarding.
              declares('ROUTING') ? '' : 'export const ROUTING = undefined',
              declares('QUOTING') ? '' : 'export const QUOTING = undefined',
            ]
              .filter(Boolean)
              .join('\n')
          ),
          },
          {
            find: /^virtual:form-pro\/mail$/,
            // Imported lazily, not re-exported. A static re-export puts the
            // site's transport — and whatever virtual ids it imports, such as
            // its mail integration's — on a path the dependency scanner walks
            // in from this package, where it cannot resolve them. Deferring to
            // the first send keeps the scanner out and costs one cached import.
            replacement: emit(
              'mail',
              mailPath
                ? `let impl
                   export async function sendEmail(message) {
                     impl ??= (await import(${JSON.stringify(mailPath)})).sendEmail
                     return impl(message)
                   }`
                : `export const sendEmail = async () => {
                     throw new Error(
                       'form-pro: no mail transport configured. Pass mail: "./src/utils/sendEmail.ts" to the integration.'
                     )
                   }`
            ),
          },
          {
            find: /^virtual:form-pro\/env$/,
            replacement: emit(
              'env',
              envPath ? `export { readEnv } from ${JSON.stringify(envPath)}` : envModule(adapter)
            ),
          },
          { find: /^virtual:form-pro\/db$/, replacement: emit('db', dbSource) },
          {
            find: /^virtual:form-pro\/logo$/,
            // Lazy for the same reason as the transport above.
            replacement: emit(
              'logo',
              logoPath
                ? `let impl
                   export async function getEmailLogoUrl(hostname) {
                     impl ??= (await import(${JSON.stringify(logoPath)})).getEmailLogoUrl
                     return impl(hostname)
                   }`
                : `import options from ${JSON.stringify(path.join(generatedDir, 'options.mjs'))}
                   export const getEmailLogoUrl = async () => options.logo`
            ),
          },
          {
            find: /^virtual:form-pro\/assets$/,
            replacement: emit(
              'assets',
              // Read here and written out as strings. The console's bundle is
              // built with this package, so its contents are fixed by the time
              // a site builds.
              ['js', 'signinJs', 'css']
                .map((name, i) => {
                  const file = ['console.js', 'signin.js', 'console.css'][i]
                  const body = readFileSync(
                    fileURLToPath(new URL(`./console/${file}`, import.meta.url)),
                    'utf8'
                  )
                  return `export const ${name} = ${JSON.stringify(body)}`
                })
                .join('\n')
            ),
          },
          {
            find: /^virtual:form-pro\/quoting$/,
            // A site with no pricing back end gets a module that says so rather
            // than one that imports something it does not have. Everything that
            // would call these checks `enabled` first, so the throwing stubs
            // exist only to make a mistake loud.
            replacement: emit(
              'quoting',
              quotingEnabled
                ? [
                    `export const enabled = true`,
                    `export * from ${JSON.stringify(quotingPath ?? 'virtual:quoting')}`,
                  ].join('\n')
                : [
                    `export const enabled = false`,
                    `const off = () => {`,
                    `  throw new Error(`,
                    `    'form-pro: no pricing back end configured. Pass quoting: true to the integration.'`,
                    `  )`,
                    `}`,
                    `export const getConfig = off`,
                    `export const previewQuote = off`,
                    `export const createQuote = off`,
                  ].join('\n')
            ),
          },
        ]

        updateConfig({
          vite: {
            // .astro and .tsx ship as source, so Vite has to compile them
            // rather than hand the file to the Node loader.
            ssr: { noExternal: [NAME] },
            // Excluded from dependency pre-bundling as well. With the
            // aliases above the optimiser can now follow this package's
            // imports, which means it walks on into the site's own modules and
            // their virtual ids — and those it cannot resolve. Nothing here
            // needs pre-bundling anyway: it is compiled with the app.
            optimizeDeps: { exclude: [NAME] },
            resolve: { alias },
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
  import type {
    EmailLabels,
    FieldDef,
    Profile,
    QuotingConfig,
    RoutingConfig,
    SiteSettings,
  } from '@golumin/form-pro/types'
  export const FIELDS: readonly FieldDef[]
  export const PROFILES: Record<string, Profile>
  export const EMAIL_LABELS: EmailLabels
  export const SITE_SETTINGS: SiteSettings
  export const ROUTING: RoutingConfig | undefined
  export const QUOTING: QuotingConfig | undefined
}
`

export type {
  EmailEnvelope,
  EmailLabels,
  FieldDef,
  FieldOption,
  FieldType,
  Lead,
  Profile,
  ProfileProbe,
  QuotingConfig,
  RoutingConfig,
  SiteConfigModule,
  SiteSettings,
} from './types.ts'
