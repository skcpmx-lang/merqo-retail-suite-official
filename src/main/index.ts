import { BrowserWindow, app, ipcMain, dialog, shell, screen } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import http from 'node:http'
import { startCore, DEFAULT_PORT, type CoreHandle } from '@core/index'
import { openDatabase, integrityCheck, type DB } from '@core/db/connection'
import { getSetting, setSetting } from '@core/services/settings'
import { prepareRestore } from '@core/services/backup'
import { loadConfig, saveConfig, paths, logLine, type AppConfig } from './config'

let db: DB | null = null
let core: CoreHandle | null = null
let mainWindow: BrowserWindow | null = null
let splash: BrowserWindow | null = null
let mode: 'standalone' | 'client' = 'standalone'
let coreError = ''
let rendererAliveSeen = false
let watchdog: NodeJS.Timeout | null = null

const DEV_URL = process.env['VITE_DEV_SERVER_URL']
/** CI packaged-launch smoke mode: physical proof the installed app renders + serves. */
const SMOKE = process.env['MQ_SMOKE'] === '1'
const SMOKE_OUT = process.env['MQ_SMOKE_OUT'] ?? ''
// must run BEFORE app ready — disable GPU in CI/headless smoke runs
if (SMOKE) app.disableHardwareAcceleration()

function writeSmokeReport(result: Record<string, unknown>): void {
  try {
    if (SMOKE_OUT) fs.writeFileSync(SMOKE_OUT, JSON.stringify({ time: new Date().toISOString(), pid: process.pid, version: app.getVersion(), ...result }, null, 2))
    logLine(`[smoke] ${JSON.stringify(result)}`)
  } catch { /* */ }
}

function smokeReport(result: Record<string, unknown>, exitCode: number): void {
  writeSmokeReport(result)
  app.exit(exitCode)
}

function coreHealth(timeoutMs = 1500): Promise<{ ok: boolean; detail: string }> {
  const port = core ? core.port : 0
  if (!port) return Promise.resolve({ ok: false, detail: coreError || 'core-not-running' })
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/api/meta', timeout: timeoutMs }, (res) => {
      let body = ''
      res.on('data', (c) => { body += c })
      res.on('end', () => resolve({ ok: res.statusCode === 200, detail: body.slice(0, 300) }))
    })
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, detail: 'timeout' }) })
    req.on('error', (e) => resolve({ ok: false, detail: e.message }))
  })
}

/* ───────────────────── splash (never a blank white window) ───────────────────── */

function splashHtml(): string {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;height:100%;background:#f6f7f9;font-family:'Hind Siliguri','Nirmala UI',sans-serif;
      display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;color:#1a2332;user-select:none}
    .logo{font-size:30px;font-weight:700;letter-spacing:2px}
    .logo span{color:#0e7c66}
    .sub{font-size:13px;color:#5a6675;margin-bottom:8px}
    .spin{width:22px;height:22px;border:3px solid #d7dde6;border-top-color:#0e7c66;border-radius:50%;animation:s .8s linear infinite}
    @keyframes s{to{transform:rotate(360deg)}}
    .msg{font-size:14px;color:#40506a}
  </style></head><body>
    <div class="logo">MERQO<span>.</span></div><div class="sub">Retail Suite</div>
    <div class="spin"></div><div class="msg">ব্যবসার পরিবেশ প্রস্তুত করা হচ্ছে…</div>
  </body></html>`
}

function createSplash(): void {
  splash = new BrowserWindow({
    width: 380, height: 240, frame: false, resizable: false, show: true,
    backgroundColor: '#f6f7f9', autoHideMenuBar: true,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false }
  })
  void splash.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(splashHtml())}`)
}

function closeSplash(): void {
  try { splash?.destroy() } catch { /* */ }
  splash = null
}

/* ───────────────────── recovery (fatal startup error — Bengali, no raw errors) ───────────────────── */

function loadRecoveryWindow(reason: string): void {
  rendererAliveSeen = false
  if (watchdog) { clearTimeout(watchdog); watchdog = null }
  closeSplash()
  const ref = `MQ-${Date.now().toString(36).toUpperCase()}`
  logLine(`[fatal] startup recovery shown — reason: ${reason} ref: ${ref} coreError: ${coreError}`)
  const target = mainWindow ?? createWindow()
  void target?.loadFile(path.join(__dirname, '../renderer/recovery.html'), { search: `ref=${encodeURIComponent(ref)}` })
  target?.show()
}

/* ───────────────────── core lifecycle ───────────────────── */

function bootCore(cfg: AppConfig): void {
  if (core) { core.close(); core = null }
  if (db) { try { db.close() } catch { /* */ } db = null }
  if (cfg.mode !== 'standalone') { mode = 'client'; return }

  mode = 'standalone'
  const p = paths()
  try {
    db = openDatabase(p.dbFile)
  } catch (e) {
    db = null
    coreError = `database: ${(e as Error).message}`
    logLine(`[boot] database open failed: ${(e as Error).stack ?? e}`)
    return
  }
  const integ = integrityCheck(db)
  if (!integ) logLine('[boot] WARNING: database integrity_check failed — running in read-cautious mode')

  try {
    core = startCore({
      db,
      port: cfg.lanServer ? cfg.lanPort : DEFAULT_PORT,
      host: cfg.lanServer ? '0.0.0.0' : '127.0.0.1',
      backupDir: p.backupDir,
      log: logLine
    })
    coreError = ''
    logLine(`[boot] core listening on ${cfg.lanServer ? '0.0.0.0' : '127.0.0.1'}:${core.port} (lanServer=${cfg.lanServer})`)
  } catch (e) {
    core = null
    coreError = `core: ${(e as Error).message}`
    logLine(`[boot] core start failed: ${(e as Error).stack ?? e}`)
    return
  }
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

function createWindow(): BrowserWindow {
  const cfg = loadConfig()
  const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize
  const w = Math.min(cfg.window.width || 1366, sw)
  const h = Math.min(cfg.window.height || 800, sh)
  const iconFile = path.join(process.resourcesPath ?? '', 'icons', 'icon.ico')
  const devIcon = path.join(app.getAppPath(), 'resources', 'icons', 'icon.ico')

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
    icon: DEV_URL ? devIcon : iconFile,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true
    }
  })

  // ── startup contract: every failure mode lands on a Bengali recovery screen ──
  rendererAliveSeen = false
  mainWindow.webContents.on('did-fail-load', (_e, code, desc, url, isMain) => {
    if (!isMain || code === -3) return // -3 = aborted (redirect) — not fatal
    logLine(`[fatal] did-fail-load code=${code} desc=${desc} url=${url}`)
    loadRecoveryWindow(`did-fail-load:${code}`)
  })
  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    logLine(`[fatal] renderer gone: ${details.reason}`)
    loadRecoveryWindow(`render-gone:${details.reason}`)
  })
  mainWindow.webContents.on('preload-error', (_e, p, err) => {
    logLine(`[fatal] preload error: ${p} :: ${err.message}`)
    loadRecoveryWindow('preload-error')
  })
  mainWindow.webContents.on('did-finish-load', () => {
    if (watchdog) clearTimeout(watchdog)
    // 20s without a live renderer signal ⇒ blank-page class failure ⇒ recovery
    watchdog = setTimeout(() => {
      if (!rendererAliveSeen) loadRecoveryWindow('renderer-ready-timeout')
    }, 20_000)
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
  // the renderer is an SPA served from our own build — never let it navigate away
  mainWindow.webContents.on('will-navigate', (e, url) => {
    const appUrl = DEV_URL ?? 'file://'
    if (!url.startsWith(appUrl)) {
      e.preventDefault()
      if (url.startsWith('http')) shell.openExternal(url)
    }
  })

  if (DEV_URL) mainWindow.loadURL(DEV_URL)
  else mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  return mainWindow
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

  /* ── startup contract IPC ── */
  ipcMain.on('merqo:renderer-alive', () => {
    rendererAliveSeen = true
    if (watchdog) { clearTimeout(watchdog); watchdog = null }
    closeSplash()
    logLine('[boot] renderer alive — app ready')
    if (SMOKE) {
      void coreHealth().then((h) => {
        smokeReport({ rendererAlive: true, coreHealthOk: h.ok, coreDetail: h.detail.slice(0, 120) }, h.ok ? 0 : 1)
      })
    }
  })
  ipcMain.handle('merqo:core-health', () => coreHealth())
  ipcMain.handle('merqo:retry-startup', () => {
    logLine('[boot] retry-startup requested from recovery screen')
    bootCore(loadConfig())
    return { ok: !!core || mode === 'client' }
  })
  ipcMain.on('merqo:relaunch', () => {
    logLine('[boot] relaunch requested')
    app.relaunch()
    app.exit(0)
  })
  ipcMain.handle('merqo:open-logs', async () => {
    const { logDir } = paths()
    fs.mkdirSync(logDir, { recursive: true })
    await shell.openPath(logDir)
    return true
  })
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
    logLine(`[boot] MERQO Retail Suite v${app.getVersion()} starting (smoke=${SMOKE ? '1' : '0'})`)
    // packaged-launch pre-check: native sqlite must load inside Electron's ABI
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      require('better-sqlite3')
      logLine('[boot] native better-sqlite3 loaded OK')
    } catch (e) {
      logLine(`[boot] NATIVE SQLITE LOAD FAILED: ${(e as Error).stack ?? e}`)
      if (SMOKE) smokeReport({ rendererAlive: false, coreHealthOk: false, error: 'native-sqlite-load', detail: String((e as Error).message).slice(0, 200) }, 1)
    }
    createSplash()
    try {
      const cfg = loadConfig()
      bootCore(cfg)
    } catch (e) {
      coreError = `boot: ${(e as Error).message}`
      logLine(`[boot] bootCore threw: ${(e as Error).stack ?? e}`)
    }
    registerIpc()
    createWindow()
    // smoke watchdog: physical launch must render within 45s; heartbeat proves main is alive
    if (SMOKE) {
      let beat = 0
      const hb = setInterval(() => {
        beat++
        if (rendererAliveSeen || beat > 8) { clearInterval(hb); return }
        writeSmokeReport({ heartbeat: beat, rendererAlive: false, coreError: coreError.slice(0, 160) })
      }, 5_000)
      setTimeout(() => { if (!rendererAliveSeen) smokeReport({ rendererAlive: false, coreHealthOk: false, error: '45s-timeout', coreError: coreError.slice(0, 160) }, 1) }, 45_000)
    }

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
