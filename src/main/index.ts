import { BrowserWindow, app, ipcMain, dialog, shell, screen } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { startCore, DEFAULT_PORT, type CoreHandle } from '@core/index'
import { openDatabase, integrityCheck, type DB } from '@core/db/connection'
import { getSetting, setSetting } from '@core/services/settings'
import { prepareRestore } from '@core/services/backup'
import { loadConfig, saveConfig, paths, logLine, type AppConfig } from './config'

let db: DB | null = null
let core: CoreHandle | null = null
let mainWindow: BrowserWindow | null = null
let mode: 'standalone' | 'client' = 'standalone'

const DEV_URL = process.env['VITE_DEV_SERVER_URL']

/* ───────────────────── core lifecycle ───────────────────── */

function bootCore(cfg: AppConfig): void {
  if (core) { core.close(); core = null }
  if (db) { try { db.close() } catch { /* */ } db = null }
  if (cfg.mode !== 'standalone') { mode = 'client'; return }

  mode = 'standalone'
  const p = paths()
  db = openDatabase(p.dbFile)
  const integ = integrityCheck(db)
  if (!integ) logLine('[boot] WARNING: database integrity_check failed — running in read-cautious mode')

  core = startCore({
    db,
    port: cfg.lanServer ? cfg.lanPort : DEFAULT_PORT,
    host: cfg.lanServer ? '0.0.0.0' : '127.0.0.1',
    backupDir: p.backupDir,
    log: logLine
  })
  // restore persisted monitor key (hash) — read-only phone dashboard
  try {
    const bizRows = db.prepare(`SELECT id FROM businesses WHERE status='active'`).all() as Array<{ id: string }>
    for (const b of bizRows) {
      const hash = getSetting<string | null>(db, b.id, 'monitor_key_hash')
      if (hash) core.setMonitorKeyHash(hash)
    }
  } catch (e) { logLine(`[boot] monitor key restore failed: ${e}`) }
}

function activePort(): number {
  return core ? core.port : 0
}

/* ───────────────────── printing ───────────────────── */

interface PrintRequest {
  html: string
  paper: 'A4' | 'A5' | '80mm' | '58mm'
  landscape?: boolean
  marginsMm?: { top: number; bottom: number; left: number; right: number }
  printer?: string
  copies?: number
  savePdf?: boolean
  fileName?: string
}

const PAPER_MM: Record<string, { width: number; height: number }> = {
  A4: { width: 210, height: 297 },
  A5: { width: 148, height: 210 },
  '80mm': { width: 80, height: 297 },
  '58mm': { width: 58, height: 297 }
}

async function doPrint(req: PrintRequest): Promise<{ ok: boolean; pdfPath?: string; message?: string }> {
  const p = paths()
  fs.mkdirSync(path.join(p.userData, 'tmp'), { recursive: true })
  const tmp = path.join(p.userData, 'tmp', `print-${Date.now()}.html`)
  fs.writeFileSync(tmp, req.html, 'utf8')

  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } })
  try {
    await win.loadFile(tmp)
    const paper = PAPER_MM[req.paper] ?? PAPER_MM['A4']
    const mm = (v: number) => Math.round((v / 25.4) * 25400) // microns
    const margins = {
      marginType: 'custom' as const,
      top: mm(req.marginsMm?.top ?? 8),
      bottom: mm(req.marginsMm?.bottom ?? 8),
      left: mm(req.marginsMm?.left ?? 8),
      right: mm(req.marginsMm?.right ?? 8)
    }

    if (req.savePdf) {
      const { canceled, filePath } = await dialog.showSaveDialog(win, {
        defaultPath: (req.fileName || 'merqo-document') + '.pdf',
        filters: [{ name: 'PDF', extensions: ['pdf'] }]
      })
      if (canceled || !filePath) return { ok: false, message: 'PDF সংরক্ষণ বাতিল হয়েছে।' }
      const data = await win.webContents.printToPDF({
        landscape: req.landscape ?? false,
        pageSize: req.paper === '80mm' || req.paper === '58mm'
          ? { width: mm(paper.width), height: mm(paper.height) }
          : (req.paper === 'A5' ? 'A5' : 'A4'),
        printBackground: true,
        margins: { top: req.marginsMm?.top ?? 0.35, bottom: req.marginsMm?.bottom ?? 0.35, left: req.marginsMm?.left ?? 0.35, right: req.marginsMm?.right ?? 0.35 }
      })
      fs.writeFileSync(filePath, data)
      return { ok: true, pdfPath: filePath }
    }

    return await new Promise((resolve) => {
      win.webContents.print(
        {
          silent: true,
          printBackground: true,
          copies: Math.max(1, req.copies ?? 1),
          deviceName: req.printer && req.printer !== '' ? req.printer : undefined,
          landscape: req.landscape ?? false,
          pageSize: req.paper === 'A5' ? 'A5' : req.paper === 'A4' ? 'A4' : { width: mm(paper.width), height: mm(paper.height) },
          margins
        },
        (success, failureReason) => {
          if (!success) logLine(`[print] failed: ${failureReason}`)
          resolve(success
            ? { ok: true }
            : { ok: false, message: `প্রিন্ট হয়নি — প্রিন্টার সংযোগ ও কাগজ যাচাই করুন। (${failureReason})` })
        }
      )
    })
  } catch (e) {
    logLine(`[print] error: ${e}`)
    return { ok: false, message: 'প্রিন্ট করতে সমস্যা হয়েছে — প্রিন্টার সেটিংস দেখুন।' }
  } finally {
    try { win.destroy() } catch { /* */ }
    try { fs.rmSync(tmp, { force: true }) } catch { /* */ }
  }
}

/* ───────────────────── window ───────────────────── */

function createWindow(): void {
  const cfg = loadConfig()
  const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize
  const w = Math.min(cfg.window.width || 1366, sw)
  const h = Math.min(cfg.window.height || 800, sh)

  mainWindow = new BrowserWindow({
    width: w,
    height: h,
    x: cfg.window.x,
    y: cfg.window.y,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    backgroundColor: '#f6f7f9',
    title: 'MERQO Retail Suite',
    icon: path.join(process.env.VITE_DEV === 'true' ? '' : process.resourcesPath ?? '', 'icon.ico'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true
    }
  })

  mainWindow.once('ready-to-show', () => {
    if (cfg.window.maximized) mainWindow?.maximize()
    else mainWindow?.show()
  })

  mainWindow.on('resize', () => {
    const b = mainWindow?.getNormalBounds()
    if (b) saveConfig({ window: { ...b, maximized: !!mainWindow?.isMaximized() } })
  })
  mainWindow.on('close', () => {
    const b = mainWindow?.getNormalBounds()
    if (b) saveConfig({ window: { ...b, maximized: !!mainWindow?.isMaximized() } })
  })
  mainWindow.on('closed', () => { mainWindow = null })

  // external links open in the system browser, never inside the app
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http')) shell.openExternal(url)
    return { action: 'deny' }
  })

  if (DEV_URL) mainWindow.loadURL(DEV_URL)
  else mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
}

/* ───────────────────── IPC ───────────────────── */

function registerIpc(): void {
  ipcMain.handle('merqo:serverInfo', () => ({
    mode,
    port: activePort(),
    lanServer: loadConfig().lanServer,
    lanPort: loadConfig().lanPort,
    serverUrl: loadConfig().serverUrl,
    version: app.getVersion(),
    electron: process.versions.electron,
    platform: process.platform,
    dbFile: mode === 'standalone' ? paths().dbFile : null
  }))

  ipcMain.handle('merqo:setMode', (_e, patch: Partial<AppConfig>) => {
    const cfg = saveConfig(patch)
    bootCore(cfg)
    return { mode, port: activePort(), cfg }
  })

  ipcMain.handle('merqo:restartCore', () => {
    bootCore(loadConfig())
    return { mode, port: activePort() }
  })

  ipcMain.handle('merqo:print', (_e, req: PrintRequest) => doPrint(req))

  ipcMain.handle('merqo:pickFile', async (_e, opts: { title: string; filters?: { name: string; extensions: string[] }[] }) => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: opts.title,
      properties: ['openFile'],
      filters: opts.filters
    })
    return canceled ? null : filePaths[0]
  })

  ipcMain.handle('merqo:restoreBackup', async (_e, file: string) => {
    if (mode !== 'standalone') return { ok: false, message: 'ক্লায়েন্ট মোডে রিস্টোর করা যায় না।' }
    try {
      if (core) { core.close(); core = null }
      if (db) { try { db.close() } catch { /* */ } db = null }
      const p = paths()
      prepareRestore(p.dbFile, file, p.backupDir)
      bootCore(loadConfig())
      return { ok: true }
    } catch (err) {
      bootCore(loadConfig())
      const msg = (err as Error).message ?? ''
      const friendly = msg.startsWith('RESTORE_INVALID:') ? msg.split(':').slice(1).join(':') : 'রিস্টোর করা যায়নি — ফাইলটি যাচাই করুন।'
      logLine(`[restore] failed: ${msg}`)
      return { ok: false, message: friendly }
    }
  })

  ipcMain.handle('merqo:revealPath', (_e, p: string) => { shell.showItemInFolder(p); return true })
}

/* ───────────────────── app lifecycle ───────────────────── */

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus() }
  })

  app.whenReady().then(() => {
    logLine(`[boot] MERQO Retail Suite v${app.getVersion()} starting`)
    const cfg = loadConfig()
    bootCore(cfg)
    registerIpc()
    createWindow()

    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('before-quit', () => {
    try { core?.close() } catch { /* */ }
    try { db?.close() } catch { /* */ }
  })
}

process.on('uncaughtException', (e) => logLine(`[crash] ${e.stack ?? e.message}`))
process.on('unhandledRejection', (e) => logLine(`[rejection] ${e}`))
