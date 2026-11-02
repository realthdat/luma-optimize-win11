export type StartupKey = {
  hive: 'HKCU' | 'HKLM'
  kind: 'Run' | 'StartupFolder'
  name: string
}

export function parseStartupId(id: string): StartupKey | null {
  if (!id.startsWith('startup:')) return null
  try {
    const raw = id.slice('startup:'.length).replace(/-/g, '+').replace(/_/g, '/')
    const pad = raw + '='.repeat((4 - (raw.length % 4)) % 4)
    const json = JSON.parse(Buffer.from(pad, 'base64').toString('utf8')) as Partial<StartupKey>
    if (json.hive !== 'HKCU' && json.hive !== 'HKLM') return null
    if (json.kind !== 'Run' && json.kind !== 'StartupFolder') return null
    if (typeof json.name !== 'string' || json.name.length === 0 || json.name.length > 260) return null
    return { hive: json.hive, kind: json.kind, name: json.name }
  } catch {
    return null
  }
}
