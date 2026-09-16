import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'
import { SCHEMA_VERSION, DDL } from './schema'

export type DB = Database.Database

let currentFile = ':memory:'

export function dbFile(): string {
  return currentFile
}

/**
 * Open (and initialise) the MERQO database.
 * - WAL journal for concurrent readers (LAN server mode)
 * - foreign_keys enforced on every connection
 * - schema migrations are idempotent and version-tracked in `meta`
 */
export function openDatabase(file: string): DB {
  currentFile = file
  if (file !== ':memory:') {
    fs.mkdirSync(path.dirname(file), { recursive: true })
  }
  const db = new Database(file)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.pragma('synchronous = NORMAL')
  db.pragma('busy_timeout = 5000')
  migrate(db)
  return db
}

export function migrate(db: DB): void {
  const row = db.prepare(`SELECT value FROM meta WHERE key='schema_version'`).get() as { value: string } | undefined
  const current = row ? Number(row.value) : 0
  if (current > SCHEMA_VERSION) {
    throw new Error(`DATABASE_NEWER: ডেটাবেস সংস্করণ (${current}) এই অ্যাপের চেয়ে নতুন (${SCHEMA_VERSION})।`)
  }
  if (current < 1) {
    const apply = db.transaction(() => {
      db.exec(DDL)
      db.prepare(`INSERT INTO meta (key, value) VALUES ('schema_version', ?)`).run(String(SCHEMA_VERSION))
      db.prepare(`INSERT OR REPLACE INTO meta (key, value) VALUES ('installed_at', ?)`).run(String(Date.now()))
    })
    apply()
  }
  // future migrations: if (current < 2) { ... }
}

export function integrityCheck(db: DB): boolean {
  const r = db.pragma('integrity_check') as Array<{ integrity_check: string }>
  return r.length === 1 && r[0].integrity_check === 'ok'
}
