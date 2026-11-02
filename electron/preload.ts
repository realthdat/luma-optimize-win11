import { contextBridge, ipcRenderer } from 'electron'
import type { CleanupScan, CleanupResult, CleanupGroupId, DiskInfo } from '../src/cleanup-types'
import type { ApplyResult, Scan } from '../src/types'

const api = {
  cleanupScan: () => ipcRenderer.invoke('cleanupScan') as Promise<CleanupScan>,
  cleanupRun: (token: string, ids: CleanupGroupId[]) => ipcRenderer.invoke('cleanupRun', token, ids) as Promise<CleanupResult>,
  storageInfo: () => ipcRenderer.invoke('storageInfo') as Promise<DiskInfo>,
  openCleanupTool: (tool: 'disk' | 'recycle') => ipcRenderer.invoke('openCleanupTool', tool) as Promise<void>,
  scan: () => ipcRenderer.invoke('scan') as Promise<Scan>,
  apply: (ids: string[], skipRestore?: boolean) => ipcRenderer.invoke('apply', ids, skipRestore === true) as Promise<ApplyResult>,
  revert: (ids: string[], skipRestore?: boolean) => ipcRenderer.invoke('revert', ids, skipRestore === true) as Promise<ApplyResult>,
  setStartup: (id: string, enabled: boolean, skipRestore?: boolean) => ipcRenderer.invoke('setStartup', id, enabled, skipRestore === true) as Promise<ApplyResult>,
  setStartupKept: (id: string, kept: boolean) => ipcRenderer.invoke('setStartupKept', id, kept) as Promise<string[]>,
  createRestorePoint: () => ipcRenderer.invoke('createRestorePoint') as Promise<ApplyResult>,
  pickFolder: () => ipcRenderer.invoke('pickFolder') as Promise<string | null>,
  addExclusion: (folder: string, skipRestore?: boolean) => ipcRenderer.invoke('addExclusion', folder, skipRestore === true) as Promise<ApplyResult>,
  removeExclusion: (folder: string, skipRestore?: boolean) => ipcRenderer.invoke('removeExclusion', folder, skipRestore === true) as Promise<ApplyResult>,
  setLang: (lang: 'en' | 'vi') => ipcRenderer.invoke('setLang', lang) as Promise<void>,
}

contextBridge.exposeInMainWorld('muot', api)

export type MuotApi = typeof api
