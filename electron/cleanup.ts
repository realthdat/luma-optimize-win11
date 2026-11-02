import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { Stats } from 'node:fs'
import type { CleanupGroup, CleanupGroupId, CleanupResult, CleanupScan } from '../src/cleanup-types'

type Root = { id: CleanupGroupId; root: string }
type Candidate = { group: CleanupGroupId; root: string; file: string; size: number; mtime: number; ctime: number; ino: number; dev: number }
const WEEK = 7 * 86400000
const projects = ['.git', '.svn', 'package.json', 'pyproject.toml', 'Cargo.toml', 'go.mod']
async function projectFolder(directory: string) {
  for (const marker of projects) {
    try { await fs.lstat(path.join(directory, marker)); return true } catch (error) { if (errorCode(error) !== 'ENOENT') return true }
  }
  return false
}
const errorCode = (error: unknown) => (error as NodeJS.ErrnoException)?.code || 'UNKNOWN'
const samePath = (a: string, b: string) => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b

// Never follow any linked ancestor, including the configured root itself.
async function plainPath(target: string) {
  let current = path.resolve(target)
  while (true) {
    const stat = await fs.lstat(current)
    if (stat.isSymbolicLink()) return false
    const parent = path.dirname(current)
    if (parent === current) break
    current = parent
  }
  return samePath(await fs.realpath(target), path.resolve(target))
}
function beneath(root: string, file: string) {
  const relative = path.relative(root, file)
  return !!relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
}
function eligible(stat: Stats, cutoff: number) {
  return stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1 && stat.mtimeMs < cutoff
}

export class CleanupService {
  private snapshot?: { view: CleanupScan; candidates: Candidate[] }
  private busy = false
  constructor(private readonly roots: Root[], private readonly options: { ttlMs?: number; maxEntries?: number } = {}) {}

  async scan(): Promise<CleanupScan> {
    if (this.busy) throw new Error('cleanup-busy')
    this.busy = true
    this.snapshot = undefined
    try {
      const started = Date.now(), cutoff = started - WEEK
      const candidates: Candidate[] = [], groups: CleanupGroup[] = []
      let visited = 0, limited = false, unreadable = 0
      for (const entry of this.roots) {
        const root = path.resolve(entry.root)
        const group: CleanupGroup = { id: entry.id, root, count: 0, bytes: 0, samples: [], unavailable: false }
        groups.push(group)
        try {
          if (!(await plainPath(root)) || !(await fs.lstat(root)).isDirectory()) { group.unavailable = true; continue }
        } catch { group.unavailable = true; continue }
        const queue = [root]
        while (queue.length) {
          if (visited >= (this.options.maxEntries ?? 50000) || Date.now() - started > 60000) { limited = true; break }
          const directory = queue.pop()!
          try {
            if (!(await plainPath(directory))) { unreadable++; continue }
            // opendir streams entries so a single huge directory cannot exhaust memory.
            if (await projectFolder(directory)) continue
            const handle = await fs.opendir(directory)
            for await (const item of handle) {
              if (++visited > (this.options.maxEntries ?? 50000) || Date.now() - started > 60000) { limited = true; break }
              const file = path.join(directory, item.name)
              if (!beneath(root, file) || item.isSymbolicLink()) continue
              try {
                const stat = await fs.lstat(file)
                if (stat.isSymbolicLink()) continue
                if (stat.isDirectory()) { queue.push(file); continue }
                if (!eligible(stat, cutoff) || !(await plainPath(file))) continue
                candidates.push({ group: entry.id, root, file, size: stat.size, mtime: stat.mtimeMs, ctime: stat.ctimeMs, ino: stat.ino, dev: stat.dev })
                group.count++; group.bytes += stat.size
                if (group.samples.length < 8) group.samples.push(file)
              } catch { unreadable++ }
            }
          } catch { unreadable++ }
          if (limited) break
        }
      }
      const view: CleanupScan = { token: randomUUID(), scannedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + (this.options.ttlMs ?? 15 * 60000)).toISOString(), groups, limited, unreadable }
      this.snapshot = { view, candidates }
      return view
    } finally { this.busy = false }
  }

  async clean(token: unknown, ids: unknown, confirm: (count: number, bytes: number) => Promise<boolean>): Promise<CleanupResult> {
    if (this.busy) throw new Error('cleanup-busy')
    const snapshot = this.snapshot
    if (typeof token !== 'string' || !snapshot || token !== snapshot.view.token || Date.now() > Date.parse(snapshot.view.expiresAt)) throw new Error('cleanup-expired')
    if (!Array.isArray(ids) || ids.length === 0 || ids.length > this.roots.length || ids.some(id => !this.roots.some(root => root.id === id))) throw new Error('cleanup-invalid-selection')
    const selected = snapshot.candidates.filter(item => ids.includes(item.group))
    if (!selected.length) throw new Error('cleanup-empty')
    this.busy = true
    const result: CleanupResult = { at: new Date().toISOString(), deleted: 0, bytes: 0, skipped: 0, failed: 0, issues: [] }
    const issue = (file: string, reason: string) => { if (result.issues.length < 30) result.issues.push({ path: file, reason }) }
    try {
      if (!(await confirm(selected.length, selected.reduce((sum, file) => sum + file.size, 0)))) return { ...result, cancelled: true }
      if (Date.now() > Date.parse(snapshot.view.expiresAt)) throw new Error('cleanup-expired')
      this.snapshot = undefined // A confirmed plan can only be executed once.
      for (const item of selected) {
        try {
          if (!beneath(item.root, item.file) || !(await plainPath(item.file))) { result.skipped++; issue(item.file, 'changed'); continue }
          let directory = path.dirname(item.file), project = false
          while (beneath(item.root, directory) || samePath(item.root, directory)) {
            if (await projectFolder(directory)) { project = true; break }
            if (samePath(directory, item.root)) break
            directory = path.dirname(directory)
          }
          if (project) { result.skipped++; issue(item.file, 'changed'); continue }
          const stat = await fs.lstat(item.file)
          if (!eligible(stat, Date.now() - WEEK) || stat.size !== item.size || stat.mtimeMs !== item.mtime || stat.ctimeMs !== item.ctime || stat.ino !== item.ino || stat.dev !== item.dev) { result.skipped++; issue(item.file, 'changed'); continue }
          // No recursive deletion, directory removal, chmod, or elevated privileges.
          await fs.unlink(item.file)
          result.deleted++; result.bytes += item.size
        } catch (error) {
          const code = errorCode(error)
          if (['ENOENT', 'EPERM', 'EACCES', 'EBUSY'].includes(code)) { result.skipped++; issue(item.file, code) }
          else { result.failed++; issue(item.file, code) }
        }
      }
      return result
    } finally { this.busy = false }
  }
}
