import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const root = new URL('../', import.meta.url)
const read = (name) => readFile(new URL(name, root), 'utf8')

const [html, demo, server, makefile, envExample, configScript] = await Promise.all([
  read('src/demo/index.html'),
  read('src/demo/demo.ts'),
  read('scripts/preview-server.py'),
  read('Makefile'),
  read('.env.example'),
  read('scripts/build-supabase-bundle.mjs'),
])

test('fresh browsers must import a ZIP and valid OPFS installs skip the importer', () => {
  assert.match(html, /const staged = await stagedInstall\(\)/)
  assert.match(html, /if \(staged\.ok\) \{[\s\S]*?stagedReady = true/)
  assert.match(html, /if \(!stagedReady && demo\?\.hasFile\('rom'\)\) return/)
  assert.match(html, /assets: \{ game: archive \}/)
  assert.match(html, /Importe le ZIP de ta propre copie de Celeste/)
  assert.doesNotMatch(html, /showDirectoryPicker|pickGameDirectory|gameDirectory:/)
  assert.doesNotMatch(demo, /showDirectoryPicker|pickGameDirectory|gameDirectory/)
})

test('public launcher and preview server have no private game download path', () => {
  for (const contents of [html, server, makefile]) {
    assert.doesNotMatch(contents, /CELESTE_PRIVATE_ARCHIVE|__celeste_private_install__|installFromPrivateSource/)
  }
  assert.match(server, /Cross-Origin-Embedder-Policy/)
  assert.match(makefile, /preview: build-sdk/)
})

test('cloud-save service exports only save data and runtime URL is public config', async () => {
  const cloud = await read('src/demo/cloud-saves.ts')
  assert.match(cloud, /this\.sdk\.exportSaves\(\)/)
  assert.match(html, /new CloudSaveService\([\s\S]*\{ exportSaves, importSaves \}/)
  assert.match(envExample, /SUPABASE_PUBLISHABLE_KEY=/)
  assert.doesNotMatch(envExample, /service_role|sb_secret/i)
  assert.match(configScript, /CELESTE_RUNTIME_BASE_URL/)
  assert.match(html, /runtimeBaseUrl: PUBLIC_CONFIG\.runtimeBaseUrl \|\| undefined/)
})
