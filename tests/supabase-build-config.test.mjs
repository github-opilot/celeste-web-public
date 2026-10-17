import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const buildScript = fileURLToPath(new URL('../scripts/build-supabase-bundle.mjs', import.meta.url))

test('Cloudflare Pages build fails if Supabase browser config is missing', () => {
  const result = spawnSync(process.execPath, [buildScript], {
    cwd: root,
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH,
      CF_PAGES: '1',
      SUPABASE_URL: '',
      SUPABASE_PUBLISHABLE_KEY: '',
    },
  })

  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /Cloudflare Pages build requires SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY/)
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /sb_publishable_|service_role|sb_secret_/i)
})
