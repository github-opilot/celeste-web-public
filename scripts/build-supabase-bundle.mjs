import { readFile } from 'node:fs/promises'
import { build } from 'esbuild'

const root = new URL('../', import.meta.url)

function parseEnv(contents) {
  const values = Object.create(null)
  for (const line of contents.split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z\d_]*)\s*=\s*(.*?)\s*$/.exec(line)
    if (!match || match[1].startsWith('#')) continue
    let value = match[2]
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    } else {
      value = value.replace(/\s+#.*$/, '').trim()
    }
    values[match[1]] = value
  }
  return values
}

let fileEnv = {}
try {
  fileEnv = parseEnv(await readFile(new URL('.env.local', root), 'utf8'))
} catch (error) {
  if (error.code !== 'ENOENT') throw error
}

const supabaseUrl = process.env.SUPABASE_URL ?? fileEnv.SUPABASE_URL ?? ''
const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY ?? fileEnv.SUPABASE_PUBLISHABLE_KEY ?? ''
const runtimeBaseUrl = process.env.CELESTE_RUNTIME_BASE_URL ?? fileEnv.CELESTE_RUNTIME_BASE_URL ?? ''

if (Boolean(supabaseUrl) !== Boolean(publishableKey)) {
  throw new Error('Configure SUPABASE_URL et SUPABASE_PUBLISHABLE_KEY ensemble dans .env.local.')
}
if (supabaseUrl) {
  const parsed = new URL(supabaseUrl)
  if (parsed.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(parsed.hostname)) {
    throw new Error('SUPABASE_URL doit utiliser HTTPS, sauf sur localhost.')
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error('SUPABASE_URL ne doit contenir ni identifiant, ni mot de passe, ni paramètres.')
  }
  if (!publishableKey.startsWith('sb_publishable_')) {
    throw new Error('SUPABASE_PUBLISHABLE_KEY doit être une clé publishable sb_publishable_ ; aucune clé secrète ne sera intégrée au bundle.')
  }
}

if (runtimeBaseUrl) {
  const parsedRuntime = new URL(runtimeBaseUrl)
  if (parsedRuntime.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(parsedRuntime.hostname)) {
    throw new Error('CELESTE_RUNTIME_BASE_URL doit utiliser HTTPS, sauf sur localhost.')
  }
  if (parsedRuntime.username || parsedRuntime.password || parsedRuntime.search || parsedRuntime.hash) {
    throw new Error('CELESTE_RUNTIME_BASE_URL ne doit contenir ni identifiant, ni mot de passe, ni paramètres.')
  }
}

await build({
  absWorkingDir: new URL('../', import.meta.url).pathname,
  entryPoints: ['src/demo/supabase.ts'],
  outfile: 'dist/supabase.js',
  alias: { '@wasm-gaming/celeste-wasm/tar': './dist/celeste/celeste.tar.js' },
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  sourcemap: false,
  logLevel: 'warning',
  define: {
    __SUPABASE_URL__: JSON.stringify(supabaseUrl),
    __SUPABASE_PUBLISHABLE_KEY__: JSON.stringify(publishableKey),
  },
})

console.info(`[supabase] browser client bundle built (${supabaseUrl ? 'configured' : 'not configured'})`)

await build({
  absWorkingDir: new URL('../', import.meta.url).pathname,
  entryPoints: ['src/demo/public-config.ts'],
  outfile: 'dist/public-config.js',
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  sourcemap: false,
  logLevel: 'warning',
  define: { __CELESTE_RUNTIME_BASE_URL__: JSON.stringify(runtimeBaseUrl) },
})

console.info(`[runtime] public base URL ${runtimeBaseUrl ? 'configured' : 'not configured'}`)
