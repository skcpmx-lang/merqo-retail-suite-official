import type { DB } from '../db/connection'
import { newId, now } from '../ids'
import { SYSTEM_ROLES } from '../permissions'
import { CoreError } from './accounts'
import { postEntry } from './accounts'
import { audit, type AuditCtx } from './audit'
import { seedBusinessDefaults } from './settings'

export interface BusinessRow {
  id: string
  name: string
  owner_name: string | null
  phone: string | null
  email: string | null
  address: string | null
  biz_type: string | null
  logo_data: string | null
  currency: string
  timezone: string
  opening_at: number
  status: string
  created_at: number
}

export interface CreateBusinessInput {
  name: string
  owner_name?: string
  phone?: string
  email?: string
  address?: string
  biz_type?: string
  logo_data?: string | null
  currency?: string
  timezone?: string
  opening_at?: number
  /** শুরুর ব্যালেন্স — প্রতিটির সাথে হিসাব তৈরি হয় */
  accounts?: Array<{ name: string; type: 'cash' | 'bank' | 'card' | 'mfs' | 'other'; provider?: string; opening_balance?: number }>
}

export function createBusiness(db: DB, ctx: AuditCtx, ownerId: string, input: CreateBusinessInput): BusinessRow {
  if (!input.name?.trim()) throw new CoreError('NAME_REQUIRED', 'ব্যবসার নাম দিন।')
  const id = newId()
  const t = now()
  const apply = db.transaction(() => {
    db.prepare(
      `INSERT INTO businesses (id, name, owner_name, phone, email, address, biz_type, logo_data, currency, timezone, opening_at, status, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?, 'active', ?)`
    ).run(id, input.name.trim(), input.owner_name ?? null, input.phone ?? null, input.email ?? null, input.address ?? null, input.biz_type ?? null, input.logo_data ?? null, input.currency ?? 'BDT', input.timezone ?? 'Asia/Dhaka', input.opening_at ?? t, t)

    // system roles
    const insRole = db.prepare(`INSERT INTO roles (id, business_id, name, note, permissions, is_system, created_at) VALUES (?,?,?,?,?,1,?)`)
    insRole.run(newId(), id, SYSTEM_ROLES.OWNER.name, SYSTEM_ROLES.OWNER.description, JSON.stringify(SYSTEM_ROLES.OWNER.permissions), t)
    insRole.run(newId(), id, SYSTEM_ROLES.MANAGER.name, SYSTEM_ROLES.MANAGER.description, JSON.stringify(SYSTEM_ROLES.MANAGER.permissions), t)
    insRole.run(newId(), id, SYSTEM_ROLES.CASHIER.name, SYSTEM_ROLES.CASHIER.description, JSON.stringify(SYSTEM_ROLES.CASHIER.permissions), t)

    // owner membership
    db.prepare(`INSERT INTO memberships (id, user_id, business_id, role_id, is_owner, status, created_at) VALUES (?,?,?,NULL,1,'active',?)`)
      .run(newId(), ownerId, id, t)

    // default accounts with opening balances
    const defaults: Array<{ name: string; type: 'cash' | 'bank' | 'card' | 'mfs' | 'other'; provider?: string; opening_balance?: number }> =
      input.accounts?.length ? input.accounts : [{ name: 'ক্যাশ বক্স', type: 'cash', opening_balance: 0 }]
    const insAcc = db.prepare(
      `INSERT INTO accounts (id, business_id, name, type, provider, opening_balance, balance, is_system, status, created_at)
       VALUES (?,?,?,?,?,?,0,0,'active',?)`
    )
    for (const a of defaults) {
      const accId = newId()
      insAcc.run(accId, id, a.name, a.type, a.provider ?? null, a.opening_balance ?? 0, t)
      if ((a.opening_balance ?? 0) > 0) {
        postEntry(db, { accountId: accId, amount: a.opening_balance ?? 0, type: 'opening', note: 'শুরুর ব্যালেন্স', userId: ownerId, date: t })
      }
    }

    seedBusinessDefaults(db, id)
  })
  apply()
  audit(db, { ...ctx, businessId: id }, 'business.create', 'business', id, null, { name: input.name })
  return getBusiness(db, id)
}

export function getBusiness(db: DB, id: string): BusinessRow {
  const b = db.prepare(`SELECT * FROM businesses WHERE id=?`).get(id) as BusinessRow | undefined
  if (!b) throw new CoreError('BUSINESS_NOT_FOUND', 'ব্যবসা পাওয়া যায়নি।')
  return b
}

export function updateBusiness(db: DB, ctx: AuditCtx, id: string, patch: Partial<CreateBusinessInput>) {
  const before = getBusiness(db, id)
  const next = { ...before, ...patch, name: patch.name?.trim() || before.name }
  db.prepare(`UPDATE businesses SET name=?, owner_name=?, phone=?, email=?, address=?, biz_type=?, logo_data=?, currency=?, timezone=? WHERE id=?`)
    .run(next.name, next.owner_name, next.phone, next.email, next.address, next.biz_type, next.logo_data, next.currency, next.timezone, id)
  audit(db, { ...ctx, businessId: id }, 'business.update', 'business', id, before, next)
  return getBusiness(db, id)
}

/** Businesses a user may access (owner first). */
export function businessesForUser(db: DB, userId: string): BusinessRow[] {
  return db
    .prepare(
      `SELECT b.* FROM businesses b JOIN memberships m ON m.business_id=b.id
       WHERE m.user_id=? AND m.status='active' AND b.status='active'
       ORDER BY m.is_owner DESC, b.name`
    )
    .all(userId) as BusinessRow[]
}
