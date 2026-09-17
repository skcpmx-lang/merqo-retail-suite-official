import { contextBridge, ipcRenderer } from 'electron'

/**
 * Minimal, typed bridge. The renderer is untrusted (sandboxed) — every
 * capability is an explicit, narrow IPC surface here.
 */
const api = {
  serverInfo: (): Promise<{ mode: string; port: number; lanServer: boolean; lanPort: number; serverUrl: string; version: string; electron: string; platform: string; dbFile: string | null }> =>
    ipcRenderer.invoke('merqo:serverInfo'),
  setMode: (patch: Record<string, unknown>): Promise<unknown> => ipcRenderer.invoke('merqo:setMode', patch),
  restartCore: (): Promise<unknown> => ipcRenderer.invoke('merqo:restartCore'),
  print: (req: Record<string, unknown>): Promise<{ ok: boolean; pdfPath?: string; message?: string }> => ipcRenderer.invoke('merqo:print', req),
  pickFile: (opts: Record<string, unknown>): Promise<string | null> => ipcRenderer.invoke('merqo:pickFile', opts),
  restoreBackup: (file: string): Promise<{ ok: boolean; message?: string }> => ipcRenderer.invoke('merqo:restoreBackup', file),
  revealPath: (p: string): Promise<void> => ipcRenderer.invoke('merqo:revealPath', p),
  /* startup contract — renderer reports liveness; recovery page can retry/relaunch */
  rendererAlive: (): void => ipcRenderer.send('merqo:renderer-alive'),
  coreHealth: (): Promise<{ ok: boolean; detail: string }> => ipcRenderer.invoke('merqo:core-health'),
  retryStartup: (): Promise<{ ok: boolean }> => ipcRenderer.invoke('merqo:retry-startup'),
  relaunchApp: (): Promise<void> => { ipcRenderer.send('merqo:relaunch'); return Promise.resolve() },
  openLogs: (): Promise<boolean> => ipcRenderer.invoke('merqo:open-logs')
}

contextBridge.exposeInMainWorld('merqo', api)

export type MerqoBridge = typeof api
