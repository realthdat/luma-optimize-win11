export type Risk = 'safe' | 'choice' | 'reboot' | 'risk'
export type Group = 'feel' | 'power' | 'service' | 'play' | 'except'

export type Tweak = {
  id: string
  risk: Risk
  needsAdmin: boolean
  group: Group
  confirm?: boolean
}

export type InboxApp = { id: string }

export const tweaks: Tweak[] = [
  { id: 'suggestions', risk: 'safe', needsAdmin: false, group: 'feel' },
  { id: 'spotlight', risk: 'safe', needsAdmin: false, group: 'feel' },
  { id: 'widgets', risk: 'safe', needsAdmin: false, group: 'feel' },
  { id: 'animations', risk: 'safe', needsAdmin: false, group: 'feel' },
  { id: 'gamedvr', risk: 'safe', needsAdmin: false, group: 'feel' },
  { id: 'power-ac', risk: 'choice', needsAdmin: true, group: 'power' },
  { id: 'svc-diagtrack', risk: 'choice', needsAdmin: true, group: 'service' },
  { id: 'svc-fax', risk: 'choice', needsAdmin: true, group: 'service' },
  { id: 'svc-retaildemo', risk: 'choice', needsAdmin: true, group: 'service' },
  { id: 'svc-maps', risk: 'choice', needsAdmin: true, group: 'service' },
  { id: 'svc-xbox', risk: 'choice', needsAdmin: true, group: 'service' },
  { id: 'svc-spooler', risk: 'choice', needsAdmin: true, group: 'service' },
  { id: 'gamemode', risk: 'choice', needsAdmin: false, group: 'play' },
  { id: 'hags', risk: 'reboot', needsAdmin: true, group: 'play' },
  { id: 'vbs', risk: 'risk', needsAdmin: true, group: 'play', confirm: true },
  { id: 'windows-update', risk: 'risk', needsAdmin: true, group: 'except', confirm: true },
]

export const dailyIds = ['suggestions', 'widgets', 'animations', 'spotlight', 'gamedvr']
export const gamingExtraIds = ['gamemode', 'hags']

export const apps: InboxApp[] = [
  { id: 'app-widgets' },
  { id: 'app-copilot' },
  { id: 'app-teams' },
  { id: 'app-news' },
  { id: 'app-clipchamp' },
  { id: 'app-devhome' },
  { id: 'app-xbox' },
  { id: 'app-gamebar' },
]

const tweakById = new Map(tweaks.map((tweak) => [tweak.id, tweak]))
const appById = new Map(apps.map((app) => [app.id, app]))

export function findTweak(id: string): Tweak | undefined {
  return tweakById.get(id)
}

export function findApp(id: string): InboxApp | undefined {
  return appById.get(id)
}

export function labelFor(id: string, fallback?: string): string {
  return fallback || id
}
