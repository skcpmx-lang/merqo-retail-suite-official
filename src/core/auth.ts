import crypto from 'node:crypto'
import type { DB } from './db/connection'
import { newId, now } from './ids'
import { getSetting } from './services/settings'

/* ─────────────────────────── password hashing (scrypt) ─────────────────────────── */

const SCRYPT_N = 16384
const SCRYPT_r = 8
const SCRYPT_p = 1
const KEYLEN = 64

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16)
  const key = crypto.scryptSync(password, salt, KEYLEN, { N: SCRYPT_N, r: SCRYPT_r, p: SCRYPT_p })
  return `scrypt$${SCRYPT_N}$${SCRYPT_r}$${SCRYPT_p}$${salt.toString('base64')}$${key.toString('base64')}`
}

export function verifyPassword(password: string, stored: string): boolean {
  try {
    const [scheme, n, r, p, saltB64, keyB64] = stored.split('$')
    if (scheme !== 'scrypt') return false
    const salt = Buffer.from(saltB64, 'base64')
    const expected = Buffer.from(keyB64, 'base64')
    const key = crypto.scryptSync(password, salt, expected.length, { N: +n, r: +r, p: +p })
    return crypto.timingSafeEqual(key, expected)
  } catch {
    return false
  }
}

/* ─────────────────────────── sessions ─────────────────────────── */

export interface SessionInfo {
  token: string
  userId: string
  businessId: string | null
  expiresAt: number
  idleTimeout: number
}

const LOCK_MEM = new Map<string, { count: number; until: number }>()

export function loginLockState(key: string): { locked: boolean; retryAfterSec: number } {
  const e = LOCK_MEM.get(key)
  if (e && e.until > Date.now()) return { locked: true, retryAfterSec: Math.ceil((e.until - Date.now()) / 1000) }
  return { locked: false, retryAfterSec: 0 }
}

export function recordLoginFailure(key: string, maxAttempts: number, lockMinutes: number): void {
  const e = LOCK_MEM.get(key) ?? { count: 0, until: 0 }
  e.count += 1
  if (e.count >= maxAttempts) {
    e.until = Date.now() + lockMinutes * 60_000
    e.count = 0
  }
  LOCK_MEM.set(key, e)
}

export function clearLoginFailures(key: string): void {
  LOCK_MEM.delete(key)
}

export function createSession(
  db: DB,
  userId: string,
  businessId: string | null,
  meta: { ip?: string; userAgent?: string }
): SessionInfo {
  const idleMin = getSetting<number>(db, businessId ?? '', 'session_idle_minutes') || 480
  const absDays = getSetting<number>(db, businessId ?? '', 'session_absolute_days') || 7
  const token = crypto.randomBytes(32).toString('base64url')
  const id = sha256(token)
  const t = now()
  db.prepare(
    `INSERT INTO sessions (id, user_id, business_id, created_at, expires_at, idle_timeout, last_seen_at, ip, user_agent)
     VALUES (?,?,?,?,?,?,?,?,?)`
  ).run(id, userId, businessId, t, t + absDays * 86_400_000, idleMin * 60_000, t, meta.ip ?? null, meta.userAgent ?? null)
  return { token, userId, businessId, expiresAt: t + absDays * 86_400_000, idleTimeout: idleMin * 60_000 }
}

export interface AuthedSession {
  sessionId: string
  userId: string
  businessId: string | null
}

/** Validate a bearer token; slides the idle window. Returns null when invalid/expired. */
export function resolveSession(db: DB, token: string | null | undefined): AuthedSession | null {
  if (!token) return null
  const id = sha256(token)
  const s = db
    .prepare(`SELECT * FROM sessions WHERE id=? AND revoked=0`)
    .get(id) as
    | { id: string; user_id: string; business_id: string | null; expires_at: number; idle_timeout: number; last_seen_at: number }
    | undefined
  if (!s) return null
  const t = now()
  if (s.expires_at < t || s.last_seen_at + s.idle_timeout < t) return null
  db.prepare(`UPDATE sessions SET last_seen_at=? WHERE id=?`).run(t, id)
  return { sessionId: s.id, userId: s.user_id, businessId: s.business_id }
}

export function revokeSession(db: DB, token: string | null | undefined): void {
  if (!token) return
  db.prepare(`UPDATE sessions SET revoked=1 WHERE id=?`).run(sha256(token))
}

export function setSessionBusiness(db: DB, sessionId: string, businessId: string | null): void {
  db.prepare(`UPDATE sessions SET business_id=? WHERE id=?`).run(businessId, sessionId)
}

export function sha256(s: string): string {
  return crypto.createHash('sha256').update(s).digest('hex')
}

/** Constant-time random token for the owner-monitor (read-only) key. */
export function newMonitorToken(): string {
  return 'mqm_' + crypto.randomBytes(24).toString('base64url')
}
