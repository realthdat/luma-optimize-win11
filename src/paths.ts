import fs from 'node:fs'
import path from 'node:path'

/** Reject drive roots and anything under Windows or Program Files. */
export function trustedFolderError(input: string): string | null {
  if (!input?.trim()) return 'missing'
  let full: string
  try {
    full = path.resolve(input)
  } catch {
    return 'invalid'
  }
  if (!fs.existsSync(full) || !fs.statSync(full).isDirectory()) return 'not-dir'
  const root = path.parse(full).root.replace(/[\\/]+$/, '')
  const trimmed = full.replace(/[\\/]+$/, '')
  if (trimmed.toLowerCase() === root.toLowerCase()) return 'root'
  const win = process.env.SystemRoot || 'C:\\Windows'
  const blocked = [
    win,
    path.join(win, 'System32'),
    path.join(win, 'SysWOW64'),
    process.env.ProgramFiles || 'C:\\Program Files',
    process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)',
  ]
  const norm = trimmed.toLowerCase()
  for (const block of blocked) {
    if (!block) continue
    const base = block.replace(/[\\/]+$/, '').toLowerCase()
    if (norm === base || norm.startsWith(base + '\\')) return 'system'
  }
  return null
}
