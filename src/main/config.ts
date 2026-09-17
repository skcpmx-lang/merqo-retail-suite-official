import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'

export interface AppConfig {
  /** standalone = local database + local core; client = connect to a LAN server */
  mode: 'standalone' | 'client'
  /** server mode: bind 0.0.0.0 so LAN devices can connect */
  lanServer: boolean
  lanPort: number
  /** client mode target */
  serverUrl: string
  window: { x?: number; y?: number; width: number; height: number; maximized: boolean }
}

const DEFAULTS: AppConfig = {
  mode: 'standalone',
  lanServer: false,
  lanPort: 47612,
  serverUrl: '',
  window: { width: 1366, height: 800, maximized: true }
}

let cfgPath = ''
let cache: AppConfig | null = null

export function paths() {
  const userData = app.getPath('userData')
  return {
    userData,
    dbFile: path.join(userData, 'data', 'business.db'),
    backupDir: path.join(userData, 'backups'),
    logDir: path.join(userData, 'logs'),
    config: path.join(userData, 'app-config.json')
  }
}

export function loadConfig(): AppConfig {
  if (cache) return cache
  cfgPath = paths().config
  try {
    const raw = JSON.parse(fs.readFileSync(cfgPath, 'utf8'))
    cache = { ...DEFAULTS, ...raw, window: { ...DEFAULTS.window, ...(raw.window ?? {}) } }
  } catch {
    cache = { ...DEFAULTS }
  }
  return cache!
}

export function saveConfig(patch: Partial<AppConfig>): AppConfig {
  const cfg = { ...loadConfig(), ...patch }
  cfgPath = paths().config
  fs.mkdirSync(path.dirname(cfgPath), { recursive: true })
  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2))
  cache = cfg
  return cfg
}

export function logLine(msg: string): void {
  try {
    const { logDir } = paths()
    fs.mkdirSync(logDir, { recursive: true })
    const line = `[${new Date().toISOString()}] ${msg}\n`
    fs.appendFileSync(path.join(logDir, 'main.log'), line)
    if (process.env.MERQO_DEV) process.stdout.write(line)
  } catch { /* never crash on logging */ }
}
