import { build } from 'esbuild'
import { execFileSync } from 'node:child_process'
import { statSync } from 'node:fs'

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
  entryPoints: ['src/console/mount.tsx'],
  outfile: 'src/console/console.js',
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

for (const file of ['src/console/console.js', 'src/console/console.css']) {
  console.log(`${file}: ${(statSync(file).size / 1024).toFixed(1)} kB`)
}
