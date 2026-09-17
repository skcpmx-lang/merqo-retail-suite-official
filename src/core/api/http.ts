import type { Request, Response, NextFunction } from 'express'
import type { DB } from '../db/connection'
import { resolveSession, type AuthedSession } from '../auth'
import { effectivePermissions } from '../services/staff'
import { CoreError } from '../services/accounts'
import { hasPerm, hasAny } from '../permissions'

export interface Authed {
  sessionId: string
  userId: string
  businessId: string
  perms: string[]
  userName: string
}

declare module 'express-serve-static-core' {
  interface Request {
    session?: AuthedSession
    auth?: Authed
  }
}

export function authMiddleware(db: DB) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const header = req.headers['authorization']
    const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined
    const session = resolveSession(db, token)
    if (session) {
      req.session = session
      if (session.businessId) {
        const user = db.prepare(`SELECT name FROM users WHERE id=?`).get(session.userId) as { name: string } | undefined
        req.auth = {
          sessionId: session.sessionId,
          userId: session.userId,
          businessId: session.businessId,
          perms: effectivePermissions(db, session.userId, session.businessId),
          userName: user?.name ?? ''
        }
      }
    }
    next()
  }
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  if (!req.auth) return next(new CoreError('UNAUTHENTICATED', 'অনুগ্রহ করে লগইন করুন।', 401))
  if (!req.auth.businessId) return next(new CoreError('NO_BUSINESS', 'কোনো ব্যবসা নির্বাচিত নয়।', 403))
  next()
}

export function requirePerm(...perms: string[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.auth) return next(new CoreError('UNAUTHENTICATED', 'অনুগ্রহ করে লগইন করুন।', 401))
    if (!hasAny(req.auth.perms, perms)) {
      return next(new CoreError('FORBIDDEN', 'এই কাজের অনুমতি আপনার নেই।', 403))
    }
    next()
  }
}

export function ctxOf(req: Request) {
  return { userId: req.auth!.userId, userName: req.auth!.userName, businessId: req.auth!.businessId }
}

export function has(req: Request, perm: string): boolean {
  return hasPerm(req.auth?.perms ?? [], perm)
}

/** Central error mapper — users see Bengali guidance, logs keep the stack. */
export function errorHandler(log?: (msg: string) => void) {
  return (err: unknown, req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof CoreError) {
      res.status(err.status).json({ error: err.code, message: err.bn })
      return
    }
    const anyErr = err as { code?: string; message?: string }
    if (anyErr?.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      res.status(400).json({ error: 'DUPLICATE', message: 'একই তথ্য আগে থেকেই আছে।' })
      return
    }
    if (anyErr?.code === 'SQLITE_CONSTRAINT_FOREIGNKEY') {
      res.status(400).json({ error: 'FK', message: 'সংশ্লিষ্ট রেকর্ডটি পাওয়া যায়নি বা ব্যবহৃত হচ্ছে।' })
      return
    }
    log?.(`[api] ${req.method} ${req.path} failed: ${anyErr?.message}\n${(err as Error)?.stack}`)
    res.status(500).json({ error: 'INTERNAL', message: 'দুঃখিত — কাজটি সম্পন্ন হয়নি। ডেটা অক্ষত আছে; আবার চেষ্টা করুন। সমস্যা থাকলে সাপোর্টে যোগাযোগ করুন (merqoonline@gmail.com)।' })
  }
}

/** Wrap async handlers so rejections reach the error mapper. */
export function h(fn: (req: Request, res: Response) => unknown | Promise<unknown>) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res)).then(() => undefined).catch(next)
  }
}

/** Read a path param as string (Express 5 types allow arrays). */
export function prm(req: Request, key: string): string {
  const v = (req.params as Record<string, unknown>)[key]
  return Array.isArray(v) ? String(v[0] ?? '') : String(v ?? '')
}

/** Read a query param as string (Express 5 types allow arrays). */
export function qs(req: Request, key: string): string | undefined {
  const v = req.query[key]
  if (Array.isArray(v)) return typeof v[0] === 'string' ? v[0] : undefined
  return typeof v === 'string' ? v : undefined
}

export function paging(req: Request, defaultSize = 25) {
  const page = Math.max(1, Number(req.query.page) || 1)
  const pageSize = Math.min(200, Math.max(5, Number(req.query.pageSize) || defaultSize))
  return { page, pageSize }
}

export function rangeFromQuery(req: Request): { from?: number; to?: number } {
  const from = req.query.from ? Number(req.query.from) : undefined
  const to = req.query.to ? Number(req.query.to) : undefined
  return { from, to }
}
