import type { DB } from '../db/connection'
import { integrityCheck, migrate } from '../db/connection'
import { SCHEMA_VERSION } from '../db/schema'
import { newId, now } from '../ids'
import fs from 'node:fs'
import path from 'node:path'
import { audit, type AuditCtx } from './audit'

export interface BackupMeta {
  file: string
  size: number
  created_at: number
  version: string
  schema: number
  business?: string
}

/**
 * Backup = consistent SQLite snapshot (online backup API — safe while the
 * server is running), verified by reopening the copy and running
 * integrity_check. No cloud claims: backups live on local disk.
 */
export function createBackup(db: DB, backupDir: string, opts: { note?: string; auto?: boolean; userId?: string; businessId?: string }): BackupMeta {
  fs.mkdirSync(backupDir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const file = path.join(backupDir, `merqo-backup-${stamp}${opts.auto ? '-auto' : ''}-${newId(6)}.db`)
  // VACUUM INTO = synchronous online snapshot (consistent read transaction);
  // better-sqlite3's db.backup() is promise-based and would race the statSync.
  db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`)
  const size = fs.statSync(file).size

  // verify the copy opens and passes integrity check
  let ok = false
  try {
    const check = new (require('better-sqlite3') as typeof import('better-sqlite3'))(file, { readonly: true })
    ok = integrityCheck(check)
    check.close()
  } catch {
    ok = false
  }
  const versionRow = db.prepare(`SELECT value FROM meta WHERE key='app_version'`).get() as { value: string } | undefined
  db.prepare(`INSERT INTO backups (id, business_id, file, size, note, auto, verified, user_id, created_at) VALUES (?,?,?,?,?,?,?,?,?)`)
    .run(newId(), opts.businessId ?? null, file, size, opts.note ?? null, opts.auto ? 1 : 0, ok ? 1 : 0, opts.userId ?? null, now())
  if (!ok) throw new Error('BACKUP_VERIFY_FAILED')
  pruneBackups(db, backupDir)
  return { file, size, created_at: now(), version: versionRow?.value ?? '0', schema: SCHEMA_VERSION, business: opts.businessId }
}

export function listBackups(db: DB) {
  return db.prepare(`SELECT id, file, size, note, auto, verified, created_at FROM backups ORDER BY created_at DESC LIMIT 100`).all()
}

function pruneBackups(db: DB, backupDir: string) {
  const keepSetting = db.prepare(`SELECT value FROM settings WHERE key='backup_keep'`).get() as { value: string } | undefined
  const keep = keepSetting ? Math.max(3, Number(JSON.parse(keepSetting.value)) || 10) : 10
  const rows = db.prepare(`SELECT id, file FROM backups ORDER BY created_at DESC`).all() as Array<{ id: string; file: string }>
  let i = 0
  for (const r of rows) {
    i += 1
    if (i > keep) {
      try {
        if (path.dirname(r.file) === backupDir) fs.rmSync(r.file, { force: true })
        // WAL sidecars
        fs.rmSync(r.file + '-wal', { force: true })
        fs.rmSync(r.file + '-shm', { force: true })
      } catch { /* best effort */ }
      db.prepare(`DELETE FROM backups WHERE id=?`).run(r.id)
    }
  }
}

export function validateBackupFile(file: string): { ok: boolean; schema: number; reason?: string } {
  if (!fs.existsSync(file)) return { ok: false, schema: 0, reason: 'FILE_MISSING' }
  try {
    const check = new (require('better-sqlite3') as typeof import('better-sqlite3'))(file, { readonly: true })
    const ic = check.pragma('integrity_check') as Array<{ integrity_check: string }>
    const hasMeta = check.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='meta'`).get()
    let schema = 0
    if (hasMeta) {
      const row = check.prepare(`SELECT value FROM meta WHERE key='schema_version'`).get() as { value: string } | undefined
      schema = row ? Number(row.value) : 0
    }
    check.close()
    if (ic.length !== 1 || ic[0].integrity_check !== 'ok') return { ok: false, schema, reason: 'CORRUPT' }
    if (!hasMeta) return { ok: false, schema, reason: 'NOT_MERQO_BACKUP' }
    if (schema > SCHEMA_VERSION) return { ok: false, schema, reason: 'NEWER_VERSION' }
    return { ok: true, schema }
  } catch {
    return { ok: false, schema: 0, reason: 'NOT_SQLITE' }
  }
}

/**
 * Restore: validates, snapshots the CURRENT db as a safety backup, then swaps
 * the file atomically. Caller must close the db before and reopen after.
 */
export function prepareRestore(dbFile: string, backupFile: string, backupDir: string): string {
  const check = validateBackupFile(backupFile)
  if (!check.ok) {
    const map: Record<string, string> = {
      FILE_MISSING: 'ব্যাকআপ ফাইলটি পাওয়া যায়নি।',
      CORRUPT: 'ব্যাকআপ ফাইলটি ক্ষতিগ্রস্ত — রিস্টোর করা যাবে না।',
      NOT_MERQO_BACKUP: 'এটি MERQO ব্যাকআপ ফাইল নয়।',
      NEWER_VERSION: 'ব্যাকআপটি আরও নতুন সংস্করণের — অ্যাপ আপডেট করুন।',
      NOT_SQLITE: 'ফাইলটি সঠিক ডেটাবেস নয়।'
    }
    throw new Error(`RESTORE_INVALID:${map[check.reason ?? ''] ?? check.reason}`)
  }
  // safety snapshot of current data
  const current = new (require('better-sqlite3') as typeof import('better-sqlite3'))(dbFile)
  createBackup(current, backupDir, { note: 'রিস্টোরের আগে স্বয়ংক্রিয় সেফটি ব্যাকআপ', userId: undefined })
  current.close()

  const tmp = dbFile + '.restore-tmp'
  fs.rmSync(tmp, { force: true })
  fs.copyFileSync(backupFile, tmp)
  fs.rmSync(dbFile + '-wal', { force: true })
  fs.rmSync(dbFile + '-shm', { force: true })
  fs.renameSync(tmp, dbFile)
  // migrate (in case of older schema) + reopen handled by caller
  const reopen = new (require('better-sqlite3') as typeof import('better-sqlite3'))(dbFile)
  reopen.pragma('journal_mode = WAL')
  migrate(reopen)
  reopen.close()
  return dbFile
}

export function auditRestore(db: DB, ctx: AuditCtx, file: string) {
  audit(db, ctx, 'backup.restore', 'backup', file)
}
