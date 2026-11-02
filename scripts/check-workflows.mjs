import fs from 'node:fs'
import vm from 'node:vm'
import assert from 'node:assert/strict'
import ts from 'typescript'
const source = fs.readFileSync('electron/main.ts', 'utf8')
const ast = ts.createSourceFile('main.ts', source, ts.ScriptTarget.Latest, true)
const names = ['apply', 'revert', 'record', 'dropChanges', 'ensureRestore', 'finish']
const functions = ast.statements.filter(node => ts.isFunctionDeclaration(node) && names.includes(node.name?.text)).map(node => node.getText(ast)).join('\n')
assert.equal(functions.match(/(?:async )?function /g).length, names.length)
const code = ts.transpileModule(functions, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
let state, engine, applyRunner, writes
const context = vm.createContext({
  Date, Set, Error,
  readState: () => structuredClone(state),
  writeState: next => { state = structuredClone(next); writes++ },
  say: en => en,
  labelFor: (id, label) => label || id,
  isKnownId: () => true,
  opNeedsAdmin: id => id.startsWith('admin'),
  asArray: value => value == null ? [] : Array.isArray(value) ? value : [value],
  runEngine: (...args) => engine(...args),
  runApply: (...args) => applyRunner(...args),
})
vm.runInContext(code, context)
const reset = () => { state = { changes: [], keptStartup: [] }; writes = 0 }
reset()
engine = async () => ({ ok: true })
applyRunner = async ids => {
  if (ids[0] === 'admin-one') return { results: [{ id: ids[0], ok: true, before: { value: 1 } }] }
  assert(state.changes.some(item => item.id === 'admin-one'), 'first batch must be persisted before second batch')
  return { results: [], failed: 'User batch process failed' }
}
let result = await context.apply(['admin-one', 'user-two'], true)
assert.equal(result.ok, false)
assert.equal(state.changes.length, 1)
assert.equal(result.results.length, 2)
assert.equal(result.results[1].ok, false)
reset()
state.keptStartup = ['startup:kept']
applyRunner = async () => { throw Error('Kept item must never execute') }
result = await context.apply(['startup:kept'], true)
assert(result.results[0].skipped)
assert.equal(state.changes.length, 0)
reset()
state.changes = [{ id: 'admin-one', before: { value: 1 } }, { id: 'user-two', before: { value: 2 } }]
engine = async (action, { items }) => {
  if (items[0].id === 'admin-one') return { ok: true, results: [{ id: 'admin-one', ok: true }] }
  assert(!state.changes.some(item => item.id === 'admin-one'), 'successful undo must be saved before next batch')
  return { ok: false, message: 'Second undo failed' }
}
result = await context.revert(['admin-one', 'user-two'], true)
assert.equal(result.ok, false)
assert.equal(state.changes.length, 1)
assert.equal(state.changes[0].id, 'user-two')
reset()
context.record([{ id: 'one', ok: true, before: { enabled: false } }])
context.record([{ id: 'one', ok: true, before: { enabled: true } }, { id: 'bad', ok: false, before: {} }, { id: 'skip', ok: true, skipped: true, before: {} }])
assert.equal(state.changes.length, 1)
assert.equal(state.changes[0].before.enabled, false)
reset()
state.restorePointAt = new Date().toISOString()
let checks = 0
engine = async action => { assert.equal(action, 'restore-point'); checks++; return { ok: false, message: 'No verified restore point' } }
result = await context.ensureRestore(false)
assert.equal(checks, 1)
assert(result.needsConfirm)
await context.ensureRestore(true)
assert.equal(checks, 1)
console.log('Workflow tests passed: partial apply/undo persistence, kept items, original snapshots, verified restore gate')
// Exercise the real state-file functions with an in-memory filesystem.
const stateFunctions = ast.statements.filter(node => ts.isFunctionDeclaration(node) && ['readState', 'writeState'].includes(node.name?.text)).map(node => node.getText(ast)).join('\n')
const files = new Map()
let failRename = false
const disk = vm.createContext({
  fs: {
    existsSync: file => files.has(file),
    readFileSync: file => files.get(file),
    mkdirSync: () => {},
    writeFileSync: (file, value) => files.set(file, value),
    renameSync: (from, to) => { if (failRename) throw Error('Write interrupted'); files.set(to, files.get(from)); files.delete(from) },
  },
  path: { dirname: () => 'data' },
  statePath: () => 'data/state.json',
  parseStartupId: id => id.startsWith('startup:') ? {} : null,
  say: en => en,
})
vm.runInContext(ts.transpileModule(stateFunctions, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, disk)
disk.writeState({ changes: [{ id: 'original', before: { value: 7 } }], keptStartup: ['startup:keep'] })
assert.equal(disk.readState().keptStartup[0], 'startup:keep')
assert.equal(disk.readState().changes[0].before.value, 7)
const original = files.get('data/state.json')
failRename = true
assert.throws(() => disk.writeState({ changes: [] }), /interrupted/)
assert.equal(files.get('data/state.json'), original)
files.set('data/state.json', '{broken')
assert.throws(() => disk.readState(), /preserved/)
assert.equal(files.get('data/state.json'), '{broken')
console.log('Storage tests passed: persistent preferences, interrupted write preserves original, corrupt history is not silently replaced')
