import { findApp, findTweak } from './catalog'
import { parseStartupId } from './startup-id'

export function isKnownId(id: string): boolean {
  return findTweak(id) !== undefined || findApp(id) !== undefined || parseStartupId(id) !== null
}

export function idNeedsAdmin(id: string): boolean {
  const tweak = findTweak(id)
  if (tweak) return tweak.needsAdmin
  if (findApp(id)) return true
  return parseStartupId(id)?.hive === 'HKLM'
}