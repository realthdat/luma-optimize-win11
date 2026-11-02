import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const catalog = fs.readFileSync('src/catalog.ts', 'utf8')
const engineBytes = fs.readFileSync('scripts/engine.ps1')
if (engineBytes[0] !== 0xef || engineBytes[1] !== 0xbb || engineBytes[2] !== 0xbf) {
  console.error('engine.ps1 must be UTF-8 with BOM so Windows PowerShell 5.1 reads Vietnamese strings')
  process.exit(1)
}
const engine = engineBytes.toString('utf8').replace(/^\uFEFF/, '')
const ids = [...catalog.matchAll(/id: '([a-z0-9-]+)'/g)].map((match) => match[1])
const marked = [...engine.matchAll(/^# id: ([a-z0-9-]+)$/gm)].map((match) => match[1])
const missing = ids.filter((id) => !marked.includes(id))
const extra = marked.filter((id) => !ids.includes(id))
if (missing.length || extra.length || new Set(ids).size !== ids.length) {
  console.error('missing in engine:', missing.join(', '))
  console.error('extra in engine:', extra.join(', '))
  process.exit(1)
}

const banned = ['windows-update', 'vbs', 'svc-diagtrack', 'svc-fax', 'svc-retaildemo', 'svc-maps', 'svc-xbox', 'svc-spooler']
function listed(name) {
  const block = catalog.match(new RegExp(`export const ${name} = \\[([\\s\\S]*?)\\]`))
  if (!block) {
    console.error('missing', name)
    process.exit(1)
  }
  return [...block[1].matchAll(/'([a-z0-9-]+)'/g)].map((match) => match[1])
}
for (const id of [...listed('dailyIds'), ...listed('gamingExtraIds')]) {
  if (banned.includes(id)) {
    console.error('profile includes', id)
    process.exit(1)
  }
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'muot-check-'))
const request = path.join(dir, 'request.json')
const out = path.join(dir, 'result.json')
fs.writeFileSync(request, '{}')
const ran = spawnSync('powershell.exe', [
  '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', 'scripts/engine.ps1',
  '-Action', 'self-test', '-Request', request, '-Out', out,
], { encoding: 'utf8' })
const body = fs.existsSync(out) ? fs.readFileSync(out, 'utf8') : ''
fs.rmSync(dir, { recursive: true, force: true })
if (ran.status !== 0 || !body.includes('"ok":true')) {
  console.error(body || ran.stderr || ran.stdout)
  process.exit(1)
}
console.log(`catalog ok (${ids.length} ids)`)
