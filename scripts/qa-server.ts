/**
 * QA harness — serves the production-built renderer (out/renderer) and the real
 * core API on ONE origin, mirroring exactly how the Electron main mounts the
 * core (same auth middleware, same routes). Used for UI smoke-testing in a
 * plain browser; not part of the shipped app.
 *
 *   npx esbuild scripts/qa-server.ts --bundle --platform=node --format=cjs \
 *     --external:better-sqlite3 --external:express --outfile=out/qa/server.cjs
 *   node out/qa/server.cjs
 */
import express from 'express'
import path from 'node:path'
import fs from 'node:fs'
import { openDatabase } from '../src/core/db/connection'
import { buildRoutes } from '../src/core/api/routes'
import { authMiddleware, errorHandler } from '../src/core/api/http'

const root = path.resolve(__dirname, '..', '..')  // out/qa/server.cjs → repo root
const dataDir = process.env.MQ_QA_DATA ?? path.join(root, 'out', 'qa-data')
const backupDir = path.join(dataDir, 'backups')
fs.mkdirSync(backupDir, { recursive: true })

const dbPath = process.env.MQ_QA_DB ?? path.join(dataDir, 'merqo.db')
if (process.env.MQ_QA_FRESH === '1') {
  for (const suffix of ['', '-wal', '-shm']) {
    const f = dbPath + suffix
    if (fs.existsSync(f)) fs.rmSync(f)
  }
}
const db = openDatabase(dbPath)

const app = express()
app.disable('x-powered-by')
app.use(express.json({ limit: '25mb' }))

app.use('/api', authMiddleware(db))
app.use('/api', buildRoutes(db, {
  initialized: () => ((db.prepare('SELECT COUNT(*) c FROM users').get() as { c: number }).c > 0),
  monitorToken: () => null,
  setMonitorToken: () => { /* monitor disabled in QA harness */ }
}, backupDir))
app.use('/api', (_req, res) => res.status(404).json({ error: 'NOT_FOUND', message: 'রিসোর্সটি পাওয়া যায়নি।' }))
app.use(errorHandler((m) => console.log('[core]', m)))

/* built SPA */
const staticDir = path.join(root, 'out', 'renderer')
app.use(express.static(staticDir))
app.use((_req, res) => res.sendFile(path.join(staticDir, 'index.html')))

const port = Number(process.env.MQ_QA_PORT ?? 8080)
app.listen(port, '0.0.0.0', () => {
  console.log(`[qa] MERQO QA server — http://0.0.0.0:${port}  (db: ${dbPath})`)
})
