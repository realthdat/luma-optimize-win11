export type CleanupGroupId = 'temp' | 'reports'
export type DiskInfo = { drive: string; total: number; free: number }
export type CleanupGroup = { id: CleanupGroupId; root: string; count: number; bytes: number; samples: string[]; unavailable: boolean }
export type CleanupScan = { token: string; scannedAt: string; expiresAt: string; groups: CleanupGroup[]; limited: boolean; unreadable: number }
export type CleanupResult = { cancelled?: boolean; at: string; deleted: number; bytes: number; skipped: number; failed: number; issues: { path: string; reason: string }[] }
export function formatBytes(value: number) {
  if (!Number.isFinite(value) || value < 0) return '—'
  if (value < 1024) return `${value} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let amount = value / 1024, index = 0
  while (amount >= 1024 && index < units.length - 1) { amount /= 1024; index++ }
  return `${amount.toFixed(amount >= 100 ? 0 : 1)} ${units[index]}`
}
