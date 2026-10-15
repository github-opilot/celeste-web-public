import { readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const root = path.resolve(process.argv[2] ?? '.')
const ignored = new Set(['.git', 'node_modules', 'dist', '.tmp', '.wrangler'])
const forbiddenNames = /^(?:\.env\.local|\.env\..+\.local|Celeste\.exe|Celeste\.dll|everest\.zip|.*\.(?:zip|tar|tgz|7z|rar|dll|exe|wasm))$/i
const secretPatterns = [
  /sb_secret_[A-Za-z0-9_-]{16,}/,
  /gh[pousr]_[A-Za-z0-9]{30,}/,
  /github_pat_[A-Za-z0-9_]{30,}/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
]
const issues = []

async function walk(directory, prefix = '') {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (ignored.has(entry.name)) continue
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isDirectory()) {
      if (/^(?:Content|Saves|Mods|private-celeste|private-game)$/i.test(entry.name)) {
        issues.push(`répertoire de jeu/données à exclure : ${relative}`)
        continue
      }
      await walk(path.join(directory, entry.name), relative)
      continue
    }
    if (!entry.isFile()) continue
    if (forbiddenNames.test(entry.name)) issues.push(`fichier potentiellement commercial/local : ${relative}`)
    const info = await stat(path.join(directory, entry.name))
    if (info.size > 25 * 1024 * 1024) issues.push(`fichier supérieur à 25 MiB : ${relative} (${info.size} octets)`)
    if (info.size > 2 * 1024 * 1024) continue
    const contents = await readFile(path.join(directory, entry.name), 'utf8').catch(() => '')
    for (const pattern of secretPatterns) {
      if (pattern.test(contents)) issues.push(`valeur qui ressemble à un secret : ${relative}`)
    }
  }
}

await walk(root)
if (issues.length) {
  console.error('Audit du dépôt public : échec')
  for (const issue of issues) console.error(`- ${issue}`)
  process.exitCode = 1
} else {
  console.info('Audit du dépôt public : aucun fichier commercial, binaire >25 MiB ou secret détecté.')
}
