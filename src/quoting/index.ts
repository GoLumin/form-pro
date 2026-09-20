// The quoting integration: a `virtual:quoting` client bound to one gofuse
// instance, plus the per-site presentation config the quote pages read.
//
// It is a server module. The token is never written into it — see runtime.ts —
// and importing it from browser code is refused outright rather than silently
// shipping a client that cannot authenticate.

import type { AstroIntegration } from 'astro'
import { fileURLToPath } from 'node:url'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { loadEnv } from 'vite'
import { adapterKind, envModule } from '../generated.ts'

export interface QuotePhone {
  label: string
  number: string
}

export interface QuoteExperienceOptions {
  /** gofuse host root, no trailing slash. Required. */
  baseUrl: string
  /**
   * The variable holding the API token. Read at request time, not baked into
   * the bundle, so rotating it needs no deploy.
   * @default "QUOTING_API_TOKEN"
   */
  tokenEnv?: string
  /**
   * A module exporting `readEnv(name)`, for a host this plugin does not already
   * know how to read. Rarely needed — Cloudflare and Node are both handled,
   * written out per adapter at build time.
   */
  env?: string
  /** Numbers shown on the quote pages. */
  phones?: QuotePhone[]
  /**
   * Path (served from public/) of the logo the WebGL shader decals onto the
   * container's side faces.
   * @default "/logo.png"
   */
  logo?: string
}

const NAME = '@golumin/form-pro/quoting'
const TYPES = `declare module 'virtual:quoting' {
  import type {
    QuoteConfig,
    QuoteParams,
    QuotePreview,
    QuoteRequestOverrides,
  } from '@golumin/form-pro/quoting/client'

  export const previewQuote: (
    params: QuoteParams,
    overrides?: QuoteRequestOverrides,
  ) => Promise<QuotePreview>
  export const createQuote: (
    params: QuoteParams,
    overrides?: QuoteRequestOverrides,
  ) => Promise<any>
  export const getQuote: (uuid: string, overrides?: QuoteRequestOverrides) => Promise<any>
  export const getForm: (slug: string, overrides?: QuoteRequestOverrides) => Promise<any>
  export const getConfig: (
    params?: { service_type?: string; product_type?: string; zip_code?: string },
    overrides?: QuoteRequestOverrides,
  ) => Promise<QuoteConfig>
  export const formatCents: (cents: number | null | undefined) => string
}

declare module 'virtual:quoting/config' {
  const config: {
    phones: { label: string; number: string }[]
    logo: string
  }
  export default config
}
`

export default function quoteExperience(
  options: QuoteExperienceOptions
): AstroIntegration {
  const {
    tokenEnv = 'QUOTING_API_TOKEN',
    phones = [],
    logo = '/logo.png',
  } = options

  return {
    name: NAME,
    hooks: {
      'astro:config:setup': ({ command, config, updateConfig, logger }) => {
        // Resolved against the project root, not the working directory: an
        // `astro dev --root apps/site`, or any script run from a parent folder,
        // otherwise reads a .env that belongs to something else. `config.root`
        // is a URL, so it has to be converted rather than passed through.
        const root = fileURLToPath(config.root)

        // `preview` and `sync` are treated as production, because they operate
        // on built output and should read the same variables the build did.
        const mode = command === 'dev' ? 'development' : 'production'

        // The empty prefix is what makes this see the whole environment, shell
        // exports included, and not just the `.env` files: Vite folds every
        // matching `process.env` key in, and every key matches "".
        const env = loadEnv(mode, root, '')
        // No default: a wrong instance answers, prices a quote against someone
        // else's catalog and is never noticed. An absent one has to be named.
        const baseUrl = options.baseUrl
        if (!baseUrl) {
          throw new Error(
            '@golumin/form-pro/quoting: baseUrl is required — pass the instance root.'
          )
        }

        if (!env[tokenEnv]) {
          logger.warn(
            `no Quoting API token found — set \`${tokenEnv}\` in the environment. ` +
              'Stored-quote lookups (?q=…) and quote persistence will be skipped; ' +
              'the page falls back to URL params and default pricing.'
          )
        }

        const envPath = options.env ? path.resolve(root, options.env) : null
        const envSource = envModule(adapterKind(config.adapter?.name))

        // Written to disk and aliased rather than served as `virtual:` ids, for
        // the same reason the console's modules are: a plugin's resolveId is
        // never consulted for an import inside node_modules, so a published
        // install would hand these straight to esbuild.
        const generatedDir = path.join(root, '.astro', 'form-pro')
        mkdirSync(generatedDir, { recursive: true })
        const emit = (name: string, contents: string): string => {
          const file = path.join(generatedDir, `${name}.mjs`)
          const next = `${contents.trim()}\n`
          try {
            if (readFileSync(file, 'utf8') === next) return file
          } catch {
            // Not written yet.
          }
          writeFileSync(file, next)
          return file
        }

        const envFile = emit(
          'quoting-env',
          envPath ? `export { readEnv } from ${JSON.stringify(envPath)}` : envSource
        )

        updateConfig({
          vite: {
            ssr: { noExternal: ['@golumin/form-pro'] },
            optimizeDeps: { exclude: ['@golumin/form-pro'] },
            resolve: {
              // Anchored patterns in array form: a string alias matches by
              // prefix, so `virtual:quoting/config` would resolve under
              // `virtual:quoting`'s file.
              alias: [
                { find: /^virtual:quoting$/, replacement: emit(
                  'quoting-client',
                  [
                    // A package specifier, not a machine-local path to a .ts
                    // file: the published layout has to resolve this too.
                    `import { createQuotingClient, formatCents } from '@golumin/form-pro/quoting/client'`,
                    `import { readEnv } from ${JSON.stringify(envFile)}`,
                    `const client = createQuotingClient({`,
                    `  baseUrl: ${JSON.stringify(baseUrl)},`,
                    `  tokenEnv: ${JSON.stringify(tokenEnv)},`,
                    `  readEnv,`,
                    `})`,
                    `export const previewQuote = client.previewQuote`,
                    `export const createQuote = client.createQuote`,
                    `export const getQuote = client.getQuote`,
                    `export const getForm = client.getForm`,
                    `export const getConfig = client.getConfig`,
                    `export { formatCents }`,
                  ].join('\n')
                ) },
                { find: /^virtual:quoting\/config$/, replacement: emit(
                  'quoting-config',
                  // Presentation only — safe anywhere, including the browser.
                  `export default ${JSON.stringify({ phones, logo })}`
                ) },
              ],
            },
          },
        })
      },

      // Declared here rather than shipped as a .d.ts for the consumer to
      // remember to include.
      'astro:config:done': ({ injectTypes }) => {
        injectTypes({ filename: 'quoting.d.ts', content: TYPES })
      },
    },
  }
}

export type {
  CatalogProduct,
  QuoteConfig,
  QuoteParams,
  QuotePreview,
  QuoteRequestOverrides,
  QuotingClient,
} from './runtime.ts'
