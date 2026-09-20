// The quoting integration: a `virtual:quoting` client bound to one gofuse
// instance, plus the per-site presentation config the quote pages read.
//
// It is a server module. The token is never written into it — see runtime.ts —
// and importing it from browser code is refused outright rather than silently
// shipping a client that cannot authenticate.

import type { AstroIntegration } from 'astro'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { loadEnv } from 'vite'
import { adapterKind, envModule } from '../generated.ts'

export interface QuotePhone {
  label: string
  number: string
}

export interface QuoteExperienceOptions {
  /** gofuse host root, no trailing slash. */
  baseUrl?: string
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
const VIRTUAL_ID = 'virtual:quoting'
const RESOLVED_VIRTUAL_ID = '\0' + VIRTUAL_ID
const CONFIG_ID = 'virtual:quoting/config'
const RESOLVED_CONFIG_ID = '\0' + CONFIG_ID
// Its own id rather than the console's, so the quoting integration works on a
// site that has not installed the console.
const ENV_ID = 'virtual:form-pro/quoting-env'
const RESOLVED_ENV_ID = '\0' + ENV_ID

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
  options: QuoteExperienceOptions = {}
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
        const baseUrl = options.baseUrl ?? 'https://mulebox.gofuse.app'

        if (!env[tokenEnv]) {
          logger.warn(
            `no Quoting API token found — set \`${tokenEnv}\` in the environment. ` +
              'Stored-quote lookups (?q=…) and quote persistence will be skipped; ' +
              'the page falls back to URL params and default pricing.'
          )
        }

        const envPath = options.env ? path.resolve(root, options.env) : null
        const envSource = envModule(adapterKind(config.adapter?.name))

        updateConfig({
          vite: {
            ssr: { noExternal: ['@golumin/form-pro'] },
            // Excluded from dependency pre-bundling, not just from SSR
            // externalisation. Pre-bundling runs esbuild directly and never
            // calls a plugin's resolveId, so it cannot resolve the virtual
            // modules these files import — and it only kicks in once the
            // package is a real directory in node_modules, which is why a
            // linked checkout never hit it and a git install did.
            optimizeDeps: { exclude: ['@golumin/form-pro'] },
            plugins: [
              {
                name: 'form-pro:quoting',
                resolveId(id) {
                  if (id === VIRTUAL_ID) return RESOLVED_VIRTUAL_ID
                  if (id === CONFIG_ID) return RESOLVED_CONFIG_ID
                  if (id === ENV_ID) return RESOLVED_ENV_ID
                  return null
                },
                load(id) {
                  if (id === RESOLVED_ENV_ID) return envSource
                  if (id === RESOLVED_CONFIG_ID) {
                    // Presentation only — safe anywhere, including the browser.
                    return `export default ${JSON.stringify({ phones, logo })};`
                  }
                  if (id !== RESOLVED_VIRTUAL_ID) return null

                  // A build for the browser must not get this module at all.
                  // There is no secret in it to leak any more, but a client that
                  // silently cannot authenticate is worse than a build that
                  // stops and names the file importing it.
                  //
                  // Only the `client` environment is refused: Astro runs the
                  // server through both `ssr` and `prerender`, and a page that
                  // prerenders a quote is doing so on the server.
                  const environment = (this as { environment?: { name?: string } })
                    .environment?.name
                  if (environment === 'client') {
                    this.error(
                      `${VIRTUAL_ID} is a server module and was imported from ` +
                        `the "${environment}" build. Move the import into a ` +
                        `component's frontmatter, an endpoint, or an action.`
                    )
                  }

                  return [
                    // A package specifier, not a machine-local path to a .ts
                    // file: the published layout has to resolve this too.
                    `import { createQuotingClient, formatCents } from '@golumin/form-pro/quoting/client';`,
                    envPath ? '' : `import { readEnv as __formProEnv } from 'virtual:form-pro/quoting-env';`,
                    envPath
                      ? `import { readEnv } from ${JSON.stringify(envPath)};`
                      : `const readEnv = (n) => __formProEnv(n);`,
                    `const client = createQuotingClient({`,
                    `  baseUrl: ${JSON.stringify(baseUrl)},`,
                    `  tokenEnv: ${JSON.stringify(tokenEnv)},`,
                    `  readEnv,`,
                    `});`,
                    `export const previewQuote = client.previewQuote;`,
                    `export const createQuote = client.createQuote;`,
                    `export const getQuote = client.getQuote;`,
                    `export const getForm = client.getForm;`,
                    `export const getConfig = client.getConfig;`,
                    `export { formatCents };`,
                  ].join('\n')
                },
              },
            ],
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
