import { app, BrowserWindow, dialog, ipcMain, Menu } from 'electron'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { CleanupService } from './cleanup'
import { formatBytes, type DiskInfo } from '../src/cleanup-types'
import { labelFor } from '../src/catalog'
import { idNeedsAdmin, isKnownId } from '../src/guard'
import { parseStartupId } from '../src/startup-id'
import { trustedFolderError } from '../src/paths'
import type { ApplyResult, Change, OpResult, Scan } from '../src/types'

const appData = process.env.APPDATA
if (!appData) throw new Error('APPDATA is missing')
const userData = path.join(appData, 'Trim')
const previousState = path.join(appData, 'Mượt', 'state.json')
if (!fs.existsSync(path.join(userData, 'state.json')) && fs.existsSync(previousState)) {
  fs.mkdirSync(userData, { recursive: true })
  fs.copyFileSync(previousState, path.join(userData, 'state.json'))
}
app.setPath('userData', userData)

const localData = process.env.LOCALAPPDATA || path.join(app.getPath('home'), 'AppData', 'Local')
const cleanup = new CleanupService([
  { id: 'temp', root: path.join(localData, 'Temp') },
  { id: 'reports', root: path.join(localData, 'Microsoft', 'Windows', 'WER', 'ReportArchive') },
])

let lang: 'en' | 'vi' = 'en'
function say(en: string, vi: string) {
  return lang === 'vi' ? vi : en
}

const pathCopy: Record<string, [string, string]> = {
  missing: ['Missing path', 'Thiếu đường dẫn'],
  invalid: ['Invalid path', 'Đường dẫn không hợp lệ'],
  'not-dir': ['Not an existing folder', 'Không phải thư mục đang tồn tại'],
  root: ['Cannot exclude a whole drive', 'Không loại trừ cả ổ đĩa'],
  system: ['Cannot exclude a system folder', 'Không loại trừ thư mục hệ thống'],
}

type StateFile = { changes: Change[]; restorePointAt?: string; keptStartup?: string[] }
type EngineRaw = {
  ok?: boolean
  message?: string
  needsConfirm?: boolean
  skipped?: boolean
  path?: string
  results?: OpResult | OpResult[]
  startup?: Scan['startup'] | Scan['startup'][number]
  apps?: Scan['apps'] | Scan['apps'][number]
  tweaks?: Scan['tweaks']
  update?: Scan['update']
  exclusions?: string | string[]
  exclusionError?: string
  hasBattery?: boolean
}

const ACTIONS = new Set(['scan', 'apply', 'set-startup', 'revert', 'restore-point', 'add-exclusion', 'remove-exclusion', 'self-test'])

function statePath() {
  return path.join(app.getPath('userData'), 'state.json')
}

function readState(): StateFile {
  try {
    if (!fs.existsSync(statePath())) return { changes: [], keptStartup: [] }
    const parsed = JSON.parse(fs.readFileSync(statePath(), 'utf8')) as StateFile
    if (!Array.isArray(parsed.changes)) throw new Error('Invalid history file')
    return { changes: Array.isArray(parsed.changes) ? parsed.changes : [], restorePointAt: parsed.restorePointAt, keptStartup: Array.isArray(parsed.keptStartup) ? parsed.keptStartup.filter(id => typeof id === 'string' && parseStartupId(id)) : [] }
  } catch {
    throw new Error(say('Cannot read change history. The existing file has been preserved.', 'Không đọc được lịch sử thay đổi. File hiện có được giữ nguyên.'))
  }
}

function writeState(state: StateFile) {
  fs.mkdirSync(path.dirname(statePath()), { recursive: true })
  const temporary = `${statePath()}.tmp`
  fs.writeFileSync(temporary, JSON.stringify(state, null, 2))
  fs.renameSync(temporary, statePath())
}

function engineFile() {
  if (app.isPackaged) return path.join(process.resourcesPath, 'engine.ps1')
  return path.join(app.getAppPath(), 'scripts', 'engine.ps1')
}

function asArray<T>(value: T | T[] | null | undefined): T[] {
  if (value == null) return []
  return Array.isArray(value) ? value : [value]
}

function opNeedsAdmin(id: string) {
  return id.startsWith('exclusion:') || idNeedsAdmin(id)
}

function exclusionId(folder: string) {
  return `exclusion:${Buffer.from(folder, 'utf8').toString('base64url')}`
}

function runPs(args: string[], elevateFile?: string) {
  const target = elevateFile ? ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', elevateFile] : args
  return new Promise<{ code: number; stderr: string }>((resolve) => {
    const child = spawn('powershell.exe', target, { windowsHide: true })
    let stderr = ''
    child.stderr.on('data', (chunk) => { stderr += chunk.toString() })
    child.on('error', error => resolve({ code: 1, stderr: error.message }))
    child.on('close', (code) => resolve({ code: code ?? 1, stderr }))
  })
}

function writeElevator(file: string, engine: string, action: string, request: string, out: string) {
  const q = (value: string) => `'${value.replace(/'/g, "''")}'`
  const body = `
$ErrorActionPreference = 'Stop'
$engine = ${q(engine)}
$action = ${q(action)}
$request = ${q(request)}
$out = ${q(out)}
$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = Join-Path $PSHOME 'powershell.exe'
$psi.Arguments = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $engine + '" -Action ' + $action + ' -Request "' + $request + '" -Out "' + $out + '"'
$psi.Verb = 'runas'
$psi.UseShellExecute = $true
$psi.WindowStyle = 'Hidden'
try { $proc = [Diagnostics.Process]::Start($psi) } catch { exit 1223 }
if (-not $proc) { exit 1223 }
$proc.WaitForExit()
exit $proc.ExitCode
`
  fs.writeFileSync(file, body, 'utf8')
}

async function runEngine(action: string, payload: unknown, elevate: boolean): Promise<EngineRaw> {
  if (!ACTIONS.has(action)) return { ok: false, message: say('Command not allowed', 'Lệnh không được phép') }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trim-'))
  const request = path.join(dir, 'request.json')
  const out = path.join(dir, 'result.json')
  const body = payload && typeof payload === 'object' ? { ...(payload as Record<string, unknown>) } : {}
  body.lang = lang
  fs.writeFileSync(request, JSON.stringify(body))
  try {
    const engine = engineFile()
    let code = 1
    let stderr = ''
    if (elevate) {
      const elevator = path.join(dir, 'elevate.ps1')
      writeElevator(elevator, engine, action, request, out)
      const ran = await runPs([], elevator)
      code = ran.code
      stderr = ran.stderr
    } else {
      const ran = await runPs(['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', engine, '-Action', action, '-Request', request, '-Out', out])
      code = ran.code
      stderr = ran.stderr
    }
    if (fs.existsSync(out)) {
      const text = fs.readFileSync(out, 'utf8').replace(/^\uFEFF/, '')
      return JSON.parse(text) as EngineRaw
    }
    if (code === 1223) return { ok: false, message: say('Permission prompt was cancelled', 'Đã hủy hộp kiểm quyền') }
    return { ok: false, message: stderr.trim() || say('The command did not run', 'Không chạy được lệnh') }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : say('Operation failed', 'Thao tác thất bại') }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

function record(results: OpResult[]) {
  const state = readState()
  for (const result of results) {
    if (!result.ok || result.skipped || result.before === undefined) continue
    if (state.changes.some((change) => change.id === result.id)) continue
    state.changes.push({
      id: result.id,
      at: new Date().toISOString(),
      label: labelFor(result.id, result.label),
      before: result.before,
    })
  }
  writeState(state)
}

function dropChanges(ids: string[]) {
  const state = readState()
  state.changes = state.changes.filter((change) => !ids.includes(change.id))
  writeState(state)
}

async function ensureRestore(skip: boolean): Promise<{ ok: true } | { ok: false; needsConfirm: true; message: string }> {
  const state = readState()
  if (skip) return { ok: true }
  const point = await runEngine('restore-point', {}, true)
  if (!point.ok) {
    return { ok: false, needsConfirm: true, message: point.message || say('Could not create a restore point', 'Không tạo được điểm khôi phục') }
  }
  state.restorePointAt = new Date().toISOString()
  writeState(state)
  return { ok: true }
}

function finish(results: OpResult[], failed?: string): ApplyResult {
  return {
    ok: !failed && results.every((result) => result.ok),
    message: failed || results.find((result) => !result.ok)?.message,
    reboot: results.some((result) => result.reboot),
    results,
    changes: readState().changes,
  }
}

async function runApply(ids: string[], elevate: boolean): Promise<{ results: OpResult[]; failed?: string }> {
  const raw = await runEngine('apply', { ids }, elevate)
  if (!raw.ok && raw.results == null) return { results: [], failed: raw.message || say('Could not apply', 'Không áp dụng được') }
  return { results: asArray(raw.results) }
}

async function apply(ids: string[], skipRestore = false): Promise<ApplyResult> {
  const kept = new Set(readState().keptStartup ?? [])
  const ignored: OpResult[] = ids.filter(id => kept.has(id)).map(id => ({ id, ok: true, skipped: true, message: say('Kept by your preference', 'Đã bỏ qua theo lựa chọn Luôn giữ') }))
  const clean = [...new Set(ids)].filter(id => !kept.has(id))
  if (clean.some((id) => !isKnownId(id))) {
    return finish([], say('That item is not in the list', 'Mục không có trong danh sách'))
  }
  const adminIds = clean.filter(opNeedsAdmin)
  const userIds = clean.filter((id) => !opNeedsAdmin(id))
  if (adminIds.length) {
    const gate = await ensureRestore(skipRestore)
    if (!gate.ok) return { ...gate, ok: false, changes: readState().changes }
  }
  const results: OpResult[] = [...ignored]
  for (const [batch, elevate] of [[adminIds, true], [userIds, false]] as const) {
    if (!batch.length) continue
    const next = await runApply(batch, elevate)
    const complete = batch.map(id => next.results.find(result => result.id === id) ?? {
      id, ok: false, message: next.failed || say('No result returned; check the current state before retrying.', 'Chưa nhận được kết quả; kiểm tra trạng thái trước khi thử lại.'),
    })
    // Persist each completed batch before starting another process.
    record(complete)
    results.push(...complete)
  }
  return finish(results)
}

async function setStartup(id: string, enabled: boolean, skipRestore: boolean): Promise<ApplyResult> {
  if (!parseStartupId(id)) return finish([], say('Invalid startup item', 'Mục khởi động không hợp lệ'))
  const elevate = opNeedsAdmin(id)
  if (elevate) {
    const gate = await ensureRestore(skipRestore)
    if (!gate.ok) return { ...gate, ok: false, changes: readState().changes }
  }
  const raw = await runEngine('set-startup', { id, enabled }, elevate)
  if (!raw.ok && raw.results == null) return finish([], raw.message || say('Could not change startup', 'Không đổi được trạng thái khởi động'))
  const results = asArray(raw.results)
  record(results)
  return finish(results)
}

async function revert(ids: string[], skipRestore = false): Promise<ApplyResult> {
  const state = readState()
  const items: { id: string; before: unknown }[] = []
  for (const id of [...new Set(ids)]) {
    const change = state.changes.find((entry) => entry.id === id)
    if (change) {
      items.push({ id, before: change.before })
      continue
    }
    if (id === 'windows-update') {
      items.push({ id, before: { useDefaults: true } })
      continue
    }
    return finish([], say('Nothing to undo', 'Không có gì để hoàn tác'))
  }
  if (items.some((item) => opNeedsAdmin(item.id))) {
    const gate = await ensureRestore(skipRestore)
    if (!gate.ok) return { ...gate, ok: false, changes: readState().changes }
  }
  const adminItems = items.filter((item) => opNeedsAdmin(item.id))
  const userItems = items.filter((item) => !opNeedsAdmin(item.id))
  const results: OpResult[] = []
  for (const [batch, elevate] of [[adminItems, true], [userItems, false]] as const) {
    if (!batch.length) continue
    const raw = await runEngine('revert', { items: batch }, elevate)
    const returned = asArray(raw.results)
    const complete = batch.map(item => returned.find(result => result.id === item.id) ?? {
      id: item.id, ok: false, message: raw.message || say('No undo result returned', 'Chưa nhận được kết quả hoàn tác'),
    })
    dropChanges(complete.filter(result => result.ok).map(result => result.id))
    results.push(...complete)
  }
  dropChanges(results.filter((result) => result.ok).map((result) => result.id))
  return finish(results)
}

function normalizeScan(raw: EngineRaw): Scan {
  const startup = asArray(raw.startup)
  const apps = asArray(raw.apps)
  return {
    ok: raw.ok !== false,
    message: raw.message,
    startup,
    keptStartup: readState().keptStartup ?? [],
    tweaks: raw.tweaks ?? {},
    apps,
    update: raw.update ?? { disabled: false, revived: false },
    exclusions: asArray(raw.exclusions).filter((item) => typeof item === 'string' && item.length > 0),
    exclusionError: raw.exclusionError,
    hasBattery: raw.hasBattery === true,
    changes: readState().changes,
  }
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1180,
    height: 860,
    minWidth: 860,
    minHeight: 560,
    show: false,
    title: 'Luma',
    backgroundColor: '#f7f8f5',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  window.once('ready-to-show', () => window.show())
  const devUrl = process.env.VITE_DEV_SERVER_URL
  if (devUrl) void window.loadURL(devUrl)
  else void window.loadFile(path.join(__dirname, '../dist/index.html'))
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null)
  ipcMain.handle('cleanupScan', () => cleanup.scan())
  ipcMain.handle('cleanupRun', (_event, token: unknown, ids: unknown) => cleanup.clean(token, ids, async (count, bytes) => {
    const answer = await dialog.showMessageBox({
      type: 'warning', title: 'Luma',
      message: say(`Delete ${count} files (${formatBytes(bytes)})?`, `Xóa ${count} file (${formatBytes(bytes)})?`),
      detail: say('Only the selected scanned files will be deleted. This cannot be undone. Files changed since scanning will be skipped.', 'Chỉ xóa file đã quét thuộc nhóm được chọn. Không thể hoàn tác. File đã thay đổi sau khi quét sẽ được bỏ qua.'),
      buttons: [say('Cancel', 'Hủy'), say('Delete files', 'Xóa file')], defaultId: 0, cancelId: 0, noLink: true,
    })
    return answer.response === 1
  }))
  ipcMain.handle('storageInfo', async (): Promise<DiskInfo> => {
    const drive = path.parse(process.env.SystemRoot || 'C:\\Windows').root
    const info = await fs.promises.statfs(drive)
    return { drive, total: info.blocks * info.bsize, free: info.bavail * info.bsize }
  })
  ipcMain.handle('openCleanupTool', (_event, tool: unknown) => {
    const windows = process.env.SystemRoot || 'C:\\Windows'
    if (tool !== 'disk' && tool !== 'recycle') throw new Error('Invalid Windows tool')
    return new Promise<void>((resolve, reject) => {
      const child = spawn(path.join(windows, tool === 'disk' ? 'System32/cleanmgr.exe' : 'explorer.exe'), tool === 'disk' ? [] : ['shell:RecycleBinFolder'], { windowsHide: false, detached: true, stdio: 'ignore' })
      child.once('error', reject)
      child.once('spawn', () => { child.unref(); resolve() })
    })
  })
  ipcMain.handle('scan', async () => {
    const raw = await runEngine('scan', {}, false)
    if (raw.ok === false && !raw.startup) return normalizeScan({ ...raw, ok: false, startup: [], apps: [], tweaks: {}, exclusions: [] })
    return normalizeScan(raw)
  })
  ipcMain.handle('apply', (_event, ids: unknown, skipRestore: unknown) => {
    if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string')) return finish([], say('Invalid list', 'Danh sách không hợp lệ'))
    return apply(ids, skipRestore === true)
  })
  ipcMain.handle('setStartupKept', (_event, id: unknown, kept: unknown) => {
    if (typeof id !== 'string' || !parseStartupId(id) || typeof kept !== 'boolean') throw new Error('Invalid startup preference')
    const state = readState()
    const ids = new Set(state.keptStartup ?? [])
    if (kept) ids.add(id)
    else ids.delete(id)
    state.keptStartup = [...ids]
    writeState(state)
    return state.keptStartup
  })
  ipcMain.handle('setStartup', (_event, id: unknown, enabled: unknown, skipRestore: unknown) => {
    if (typeof id !== 'string' || typeof enabled !== 'boolean') return finish([], 'Invalid startup request')
    return setStartup(id, enabled, skipRestore === true)
  })
  ipcMain.handle('revert', (_event, ids: unknown, skipRestore: unknown) => {
    if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string')) return finish([], say('Invalid list', 'Danh sách không hợp lệ'))
    return revert(ids, skipRestore === true)
  })
  ipcMain.handle('createRestorePoint', () => ensureRestore(false).then((gate) => ({
    ...gate,
    changes: readState().changes,
  })))
  ipcMain.handle('pickFolder', async () => {
    const picked = await dialog.showOpenDialog({ properties: ['openDirectory'] })
    if (picked.canceled || !picked.filePaths[0]) return null
    return picked.filePaths[0]
  })
  ipcMain.handle('setLang', (_event, value: unknown) => {
    lang = value === 'vi' ? 'vi' : 'en'
  })
  ipcMain.handle('addExclusion', async (_event, folder: unknown, skipRestore: unknown) => {
    if (typeof folder !== 'string') return finish([], say('Missing path', 'Thiếu đường dẫn'))
    const reason = trustedFolderError(folder)
    if (reason) {
      const copy = pathCopy[reason]
      return finish([], copy ? say(copy[0], copy[1]) : reason)
    }
    const full = path.resolve(folder).replace(/[\\/]+$/, '')
    const gate = await ensureRestore(skipRestore === true)
    if (!gate.ok) return { ...gate, changes: readState().changes }
    const raw = await runEngine('add-exclusion', { path: full }, true)
    if (!raw.ok) return finish([], raw.message || say('Could not add the folder', 'Không thêm được thư mục'))
    if (raw.skipped) return { ok: true, message: say('That folder is already excluded', 'Thư mục đã nằm trong danh sách'), changes: readState().changes }
    record([{ id: exclusionId(full), ok: true, before: { path: full, existed: false }, label: full }])
    return finish([])
  })
  ipcMain.handle('removeExclusion', async (_event, folder: unknown, skipRestore: unknown) => {
    if (typeof folder !== 'string') return finish([], say('Missing path', 'Thiếu đường dẫn'))
    const full = path.resolve(folder).replace(/[\\/]+$/, '')
    const id = exclusionId(full)
    const existing = readState().changes.find((change) => change.id === id)
    const before = existing?.before as { existed?: boolean } | undefined
    if (existing && before?.existed === false) return revert([id], skipRestore === true)
    const gate = await ensureRestore(skipRestore === true)
    if (!gate.ok) return { ...gate, changes: readState().changes }
    const raw = await runEngine('remove-exclusion', { path: full }, true)
    if (!raw.ok) return finish([], raw.message || say('Could not remove the folder', 'Không gỡ được thư mục'))
    record([{ id, ok: true, before: { path: full, existed: true }, label: full }])
    return finish([])
  })
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
