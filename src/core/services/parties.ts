import type { DB } from '../db/connection'
import { newId, now } from '../ids'
import { CoreError } from './accounts'
import { audit, type AuditCtx } from './audit'

export interface CustomerRow {
  id: string
  code: string | null
  name: string
  phone: string | null
  address: string | null
  email: string | null
  note: string | null
  opening_due: number
  receivable: number
  status: string
  created_at: number
}

export interface PartyInput {
  name: string
  phone?: string
  address?: string
  email?: string
  note?: string
  opening_due?: number
  code?: string
  company?: string
}

export function createCustomer(db: DB, ctx: AuditCtx, businessId: string, input: PartyInput): CustomerRow {
  return db.transaction(() => {
    if (!input.name?.trim()) throw new CoreError('NAME_REQUIRED', 'গ্রাহকের নাম দিন।')
    if (input.code?.trim()) {
      const dup = db.prepare(`SELECT 1 FROM customers WHERE business_id=? AND code=?`).get(businessId, input.code.trim())
      if (dup) throw new CoreError('DUP_CODE', `কাস্টমার কোড "${input.code}" আগে থেকেই আছে।`)
    }
    const id = newId()
    db.prepare(
      `INSERT INTO customers (id, business_id, code, name, phone, address, email, note, opening_due, receivable, status, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,'active',?)`
    ).run(
      id, businessId, input.code?.trim() || null, input.name.trim(), input.phone?.trim() || null,
      input.address?.trim() || null, input.email?.trim() || null, input.note ?? null,
      input.opening_due ?? 0, input.opening_due ?? 0, now()
    )
    if ((input.opening_due ?? 0) > 0) {
      audit(db, { ...ctx, businessId }, 'customer.opening_due', 'customer', id, null, { opening_due: input.opening_due })
    }
    audit(db, { ...ctx, businessId }, 'customer.create', 'customer', id, null, { name: input.name, phone: input.phone })
    return getCustomer(db, businessId, id)
  })()
}

export function updateCustomer(db: DB, ctx: AuditCtx, businessId: string, id: string, patch: Partial<PartyInput> & { status?: string }): CustomerRow {
  const before = getCustomer(db, businessId, id)
  if (patch.code?.trim() && patch.code.trim() !== before.code) {
    const dup = db.prepare(`SELECT 1 FROM customers WHERE business_id=? AND code=? AND id<>?`).get(businessId, patch.code.trim(), id)
    if (dup) throw new CoreError('DUP_CODE', `কাস্টমার কোড "${patch.code}" আগে থেকেই আছে।`)
  }
  const next = { ...before, ...patch, name: patch.name?.trim() || before.name }
  db.prepare(`UPDATE customers SET code=?, name=?, phone=?, address=?, email=?, note=?, status=? WHERE id=? AND business_id=?`).run(
    next.code, next.name, next.phone, next.address, next.email, next.note, patch.status ?? before.status, id, businessId
  )
  audit(db, { ...ctx, businessId }, 'customer.update', 'customer', id, before, next)
  return getCustomer(db, businessId, id)
}

export function getCustomer(db: DB, businessId: string, id: string): CustomerRow {
  const c = db.prepare(`SELECT * FROM customers WHERE id=? AND business_id=?`).get(id, businessId) as CustomerRow | undefined
  if (!c) throw new CoreError('CUSTOMER_NOT_FOUND', 'গ্রাহক পাওয়া যায়নি।')
  return c
}

export function listCustomers(db: DB, businessId: string, q: { search?: string; status?: string; dueOnly?: boolean; page: number; pageSize: number; sort?: string; dir?: string }) {
  const where: string[] = ['business_id = ?']
  const args: unknown[] = [businessId]
  if (q.status && q.status !== 'all') { where.push(`status = ?`); args.push(q.status) }
  if (q.search) {
    where.push(`(name LIKE ? OR phone LIKE ? OR code LIKE ?)`)
    const like = `%${q.search}%`
    args.push(like, like, like)
  }
  if (q.dueOnly) where.push(`receivable > 0`)
  const w = where.join(' AND ')
  const sortCol = q.sort === 'receivable' ? 'receivable' : 'name COLLATE NOCASE'
  const dir = q.dir === 'desc' ? 'DESC' : 'ASC'
  const total = (db.prepare(`SELECT COUNT(*) c FROM customers WHERE ${w}`).get(...args) as { c: number }).c
  const rows = db.prepare(`SELECT * FROM customers WHERE ${w} ORDER BY ${sortCol} ${dir} LIMIT ? OFFSET ?`).all(...args, q.pageSize, (q.page - 1) * q.pageSize)
  return { rows, total }
}

/* ───────────────────────── suppliers ───────────────────────── */

export interface SupplierRow {
  id: string
  name: string
  company: string | null
  phone: string | null
  email: string | null
  address: string | null
  opening_due: number
  payable: number
  status: string
  created_at: number
}

export function createSupplier(db: DB, ctx: AuditCtx, businessId: string, input: PartyInput): SupplierRow {
  return db.transaction(() => {
    if (!input.name?.trim()) throw new CoreError('NAME_REQUIRED', 'সরবরাহকারীর নাম দিন।')
    const dup = db.prepare(`SELECT 1 FROM suppliers WHERE business_id=? AND name=?`).get(businessId, input.name.trim())
    if (dup) throw new CoreError('DUP_NAME', 'এই নামে আরেকটি সরবরাহকারী আছে।')
    const id = newId()
    db.prepare(
      `INSERT INTO suppliers (id, business_id, name, company, phone, email, address, opening_due, payable, status, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,'active',?)`
    ).run(id, businessId, input.name.trim(), input.company ?? null, input.phone?.trim() || null, input.email ?? null, input.address ?? null, input.opening_due ?? 0, input.opening_due ?? 0, now())
    audit(db, { ...ctx, businessId }, 'supplier.create', 'supplier', id, null, { name: input.name })
    return getSupplier(db, businessId, id)
  })()
}

export function updateSupplier(db: DB, ctx: AuditCtx, businessId: string, id: string, patch: Partial<PartyInput> & { status?: string }): SupplierRow {
  const before = getSupplier(db, businessId, id)
  const name = patch.name?.trim()
  if (name && name !== before.name) {
    const dup = db.prepare(`SELECT 1 FROM suppliers WHERE business_id=? AND name=? AND id<>?`).get(businessId, name, id)
    if (dup) throw new CoreError('DUP_NAME', 'এই নামে আরেকটি সরবরাহকারী আছে।')
  }
  const next = { ...before, ...patch, name: name || before.name }
  db.prepare(`UPDATE suppliers SET name=?, company=?, phone=?, email=?, address=?, status=? WHERE id=? AND business_id=?`).run(
    next.name, next.company, next.phone, next.email, next.address, patch.status ?? before.status, id, businessId
  )
  audit(db, { ...ctx, businessId }, 'supplier.update', 'supplier', id, before, next)
  return getSupplier(db, businessId, id)
}

export function getSupplier(db: DB, businessId: string, id: string): SupplierRow {
  const s = db.prepare(`SELECT * FROM suppliers WHERE id=? AND business_id=?`).get(id, businessId) as SupplierRow | undefined
  if (!s) throw new CoreError('SUPPLIER_NOT_FOUND', 'সরবরাহকারী পাওয়া যায়নি।')
  return s
}

export function listSuppliers(db: DB, businessId: string, q: { search?: string; status?: string; dueOnly?: boolean; page: number; pageSize: number }) {
  const where: string[] = ['business_id = ?']
  const args: unknown[] = [businessId]
  if (q.status && q.status !== 'all') { where.push(`status = ?`); args.push(q.status) }
  if (q.search) {
    where.push(`(name LIKE ? OR phone LIKE ? OR company LIKE ?)`)
    const like = `%${q.search}%`
    args.push(like, like, like)
  }
  if (q.dueOnly) where.push(`payable > 0`)
  const w = where.join(' AND ')
  const total = (db.prepare(`SELECT COUNT(*) c FROM suppliers WHERE ${w}`).get(...args) as { c: number }).c
  const rows = db.prepare(`SELECT * FROM suppliers WHERE ${w} ORDER BY name COLLATE NOCASE LIMIT ? OFFSET ?`).all(...args, q.pageSize, (q.page - 1) * q.pageSize)
  return { rows, total }
}
