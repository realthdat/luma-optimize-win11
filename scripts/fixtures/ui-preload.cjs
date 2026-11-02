const { contextBridge } = require('electron')
let cleanupCalls = 0, scanned = false
const machine = { ok: true, changes: [], keptStartup: [], hasBattery: false, update: { disabled: false, revived: false }, exclusions: [], apps: [], tweaks: Object.fromEntries(['suggestions', 'widgets', 'animations', 'spotlight', 'gamedvr', 'gamemode', 'hags'].map(id => [id, { available: true, applied: false }])), startup: [
 { id: 'startup:alpha', name: 'Alpha Music', publisher: 'Alpha', command: 'C:\\Alpha\\music.exe', impact: 'high', enabled: true, protected: false },
 { id: 'startup:beta', name: 'Beta Chat', publisher: 'Beta', command: 'C:\\Beta\\chat.exe', impact: 'mid', enabled: false, protected: false },
] }
const delay = () => new Promise(resolve => setTimeout(resolve, 180))
contextBridge.exposeInMainWorld('muot', {
 scan: async () => machine, setLang: async () => {},
 storageInfo: async () => ({ drive: 'C:\\', total: 512 * 1024 ** 3, free: 124 * 1024 ** 3 }),
 cleanupScan: async () => { await delay(); scanned = true; return { token: 'test', scannedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 900000).toISOString(), limited: false, unreadable: 0, groups: [
  { id: 'temp', root: 'fixture/temp', count: 426, bytes: 1.2 * 1024 ** 3, samples: ['fixture/temp/old.tmp'], unavailable: false },
  { id: 'reports', root: 'fixture/reports', count: 18, bytes: 600 * 1024 ** 2, samples: ['fixture/reports/error.wer'], unavailable: false },
 ] } },
 cleanupRun: async (token, ids) => { if (!scanned || token !== 'test') throw Error('cleanup-expired'); cleanupCalls++; await delay(); if (cleanupCalls === 1) return { cancelled: true }; return { at: new Date().toISOString(), bytes: 1000000, deleted: 420, skipped: 6, failed: 0, issues: [{ path: 'fixture/temp/locked.tmp', reason: 'EBUSY' }] } },
 openCleanupTool: async () => {},
 apply: async ids => ({ ok: true, changes: [], results: ids.map(id => ({ id, ok: true })) }),
 revert: async ids => ({ ok: true, changes: [], results: ids.map(id => ({ id, ok: true })) }),
 setStartup: async (id, enabled) => { machine.startup.find(item => item.id === id).enabled = enabled; return { ok: true, changes: [], results: [{ id, ok: true }] } },
 setStartupKept: async (id, kept) => { machine.keptStartup = kept ? [id] : []; return machine.keptStartup },
 testCalls: () => cleanupCalls,
})
