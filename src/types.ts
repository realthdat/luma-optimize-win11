export type Impact = 'high' | 'mid' | 'none'

export type StartupItem = {
  id: string
  name: string
  command: string
  publisher: string
  impact: Impact
  enabled: boolean
  protected: boolean
  hive: 'HKCU' | 'HKLM'
}

export type TweakState = {
  applied: boolean
  available: boolean
  reboot?: boolean
}

export type AppRow = {
  id: string
  installed: boolean
}

export type UpdateState = {
  disabled: boolean
  revived: boolean
}

export type Change = {
  id: string
  at: string
  label: string
  before: unknown
}

export type Scan = {
  ok: boolean
  message?: string
  startup: StartupItem[]
  tweaks: Record<string, TweakState>
  apps: AppRow[]
  update: UpdateState
  exclusions: string[]
  exclusionError?: string
  hasBattery: boolean
  changes: Change[]
  keptStartup?: string[]
}

export type OpResult = {
  id: string
  ok: boolean
  message?: string
  before?: unknown
  label?: string
  reboot?: boolean
  skipped?: boolean
}

export type ApplyResult = {
  ok: boolean
  needsConfirm?: boolean
  message?: string
  reboot?: boolean
  results?: OpResult[]
  changes: Change[]
}
