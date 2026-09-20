import { build } from 'esbuild'
import { execFileSync } from 'node:child_process'
import { readFileSync, statSync, writeFileSync } from 'node:fs'

/**
 * Builds the console into two self-contained files: console.js and console.css.
 *
 * It is shipped pre-bundled rather than as source because the host site's own
 * build would otherwise compile it — and the hosts disagree about what that
 * means. A Preact site's plugin rewrites `react/jsx-runtime` to Preact's, and
 * then React 19's createRoot is handed Preact vnodes; a React site injects a
 * refresh preamble this page never receives. Bundling here ends the argument:
 * by the time a site sees the console it is plain JavaScript with its own React
 * inside, and nothing in the host's pipeline has an opinion about it.
 *
 * The same reasoning applies to the stylesheet, which is why the console needs
 * no Tailwind config from the site either.
 */

await build({
  entryPoints: ['src/console/console.tsx', 'src/console/signin.tsx'],
  outdir: 'src/console',
  entryNames: '[name]',
  bundle: true,
  format: 'esm',
  target: 'es2022',
  jsx: 'automatic',
  minify: true,
  legalComments: 'none',
  define: { 'process.env.NODE_ENV': '"production"' },
})

execFileSync(
  'npx',
  ['@tailwindcss/cli', '-i', './src/console/styles.css', '-o', './src/console/console.css', '--minify'],
  { stdio: 'inherit' }
)

flattenLayers('./src/console/console.css')

/**
 * Strips the cascade layers out of the compiled stylesheet.
 *
 * The console is a standalone page, but it is served by a site that puts its
 * own global stylesheet on every page and gives us no way to opt out. Where
 * that site runs Tailwind v3 those rules are *unlayered*, and an unlayered rule
 * beats a layered one however specific the layered one is — which is how the
 * primary button ended up with its white text overridden by the host's
 * near-black body colour.
 *
 * Flattening puts both sides back on specificity, where a class beats a bare
 * element or universal selector and the console looks the way it was written.
 * It costs nothing: the console's CSS has no other stylesheet of its own to
 * order against, and within it utilities are classes while the base layer is
 * mostly element selectors, so the precedence that mattered still holds.
 */
function flattenLayers(file) {
  const css = readFileSync(file, 'utf8')
  let out = ''
  let i = 0

  while (i < css.length) {
    const at = css.indexOf('@layer', i)
    if (at === -1) {
      out += css.slice(i)
      break
    }
    out += css.slice(i, at)

    // `@layer a, b, c;` only declares an order — drop it outright.
    const semicolon = css.indexOf(';', at)
    const brace = css.indexOf('{', at)
    if (semicolon !== -1 && (brace === -1 || semicolon < brace)) {
      i = semicolon + 1
      continue
    }

    // `@layer name { … }` — keep the contents, drop the wrapper.
    let depth = 0
    let j = brace
    for (; j < css.length; j += 1) {
      if (css[j] === '{') depth += 1
      else if (css[j] === '}') {
        depth -= 1
        if (depth === 0) break
      }
    }
    out += css.slice(brace + 1, j)
    i = j + 1
  }

  writeFileSync(file, out)
}

for (const file of ['src/console/console.js', 'src/console/signin.js', 'src/console/console.css']) {
  console.log(`${file}: ${(statSync(file).size / 1024).toFixed(1)} kB`)
}
