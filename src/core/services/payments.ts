import type { DB } from '../db/connection'
import { newId, now } from '../ids'
import { CoreError, postEntry } from './accounts'
import { audit, type AuditCtx } from './audit'
import { nextNumber } from './settings'

/**
 * Due settlement (customer collection / supplier payment).
 * These are NOT revenue/expense — revenue is recognised at sale time;
 * this only moves the receivable/payable and the till balance.
 */
export function collectCustomerDue(
  db: DB, ctx: AuditCtx, businessId: string,
  input: { customer_id: string; amount: number; account_id: string; method: string; date?: number; note?: string }
) {
  const c = db.prepare(`SELECT id, name, receivable FROM customers WHERE id=? AND business_id=? AND status='active'`).get(input.customer_id, businessId) as
    | { id: string; name: string; receivable: number }
    | undefined
  if (!c) throw new CoreError('CUSTOMER_NOT_FOUND', 'গ্রাহক পাওয়া যায়নি।')
  const amount = Math.round(input.amount)
  if (amount <= 0) throw new CoreError('BAD_AMOUNT', 'পরিশোধের পরিমাণ সঠিক নয়।')
  if (amount > c.receivable) throw new CoreError('OVERPAY', `মোট বকেয়া ৳${(c.receivable / 100).toFixed(2)} — এর চেয়ে বেশি নেওয়া যাবে না।`)
  const acc = db.prepare(`SELECT id FROM accounts WHERE id=? AND business_id=? AND status='active'`).get(input.account_id, businessId)
  if (!acc) throw new CoreError('ACCOUNT_NOT_FOUND', 'হিসাব নির্বাচন করুন।')
  const t = input.date ?? now()
  const voucher = nextNumber(db, businessId, 'receipt')

  db.prepare(`UPDATE customers SET receivable = receivable - ? WHERE id=?`).run(amount, c.id)
  postEntry(db, { accountId: input.account_id, amount, type: 'customer_payment', refType: 'customer', refId: c.id, note: `বকেয়া আদায় — ${c.name}`, userId: ctx.userId, date: t })
  const pid = newId()
  db.prepare(
    `INSERT INTO payments (id, business_id, voucher_no, party_type, party_id, party_name, direction, amount, account_id, method, ref_type, ref_id, date, note, user_id, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).run(pid, businessId, voucher, 'customer', c.id, c.name, 'in', amount, input.account_id, input.method, 'customer', c.id, t, input.note ?? null, ctx.userId ?? null, now())
  audit(db, { ...ctx, businessId }, 'customer.payment', 'customer', c.id, { receivable: c.receivable }, { receivable: c.receivable - amount }, input.note)
  return { voucher_no: voucher, payment_id: pid, receivable_after: c.receivable - amount, customer_name: c.name, amount, method: input.method, date: t }
}

export function paySupplierDue(
  db: DB, ctx: AuditCtx, businessId: string,
  input: { supplier_id: string; amount: number; account_id: string; method: string; date?: number; note?: string }
) {
  const s = db.prepare(`SELECT id, name, payable FROM suppliers WHERE id=? AND business_id=? AND status='active'`).get(input.supplier_id, businessId) as
    | { id: string; name: string; payable: number }
    | undefined
  if (!s) throw new CoreError('SUPPLIER_NOT_FOUND', 'সরবরাহকারী পাওয়া যায়নি।')
  const amount = Math.round(input.amount)
  if (amount <= 0) throw new CoreError('BAD_AMOUNT', 'পরিশোধের পরিমাণ সঠিক নয়।')
  if (amount > s.payable) throw new CoreError('OVERPAY', `মোট বকেয়া ৳${(s.payable / 100).toFixed(2)} — এর চেয়ে বেশি দেওয়া যাবে না।`)
  const acc = db.prepare(`SELECT id FROM accounts WHERE id=? AND business_id=? AND status='active'`).get(input.account_id, businessId)
  if (!acc) throw new CoreError('ACCOUNT_NOT_FOUND', 'হিসাব নির্বাচন করুন।')
  const t = input.date ?? now()
  const voucher = nextNumber(db, businessId, 'voucher')

  db.prepare(`UPDATE suppliers SET payable = payable - ? WHERE id=?`).run(amount, s.id)
  postEntry(db, { accountId: input.account_id, amount: -amount, type: 'supplier_payment', refType: 'supplier', refId: s.id, note: `বকেয়া পরিশোধ — ${s.name}`, userId: ctx.userId, date: t })
  const pid = newId()
  db.prepare(
    `INSERT INTO payments (id, business_id, voucher_no, party_type, party_id, party_name, direction, amount, account_id, method, ref_type, ref_id, date, note, user_id, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).run(pid, businessId, voucher, 'supplier', s.id, s.name, 'out', amount, input.account_id, input.method, 'supplier', s.id, t, input.note ?? null, ctx.userId ?? null, now())
  audit(db, { ...ctx, businessId }, 'supplier.payment', 'supplier', s.id, { payable: s.payable }, { payable: s.payable - amount }, input.note)
  return { voucher_no: voucher, payment_id: pid, payable_after: s.payable - amount }
}

export function listPayments(
  db: DB, businessId: string,
  q: { from?: number; to?: number; party_type?: string; party_id?: string; direction?: string; account_id?: string; method?: string; ref_type?: string; page: number; pageSize: number }
) {
  const where: string[] = ['p.business_id = ?']
  const args: unknown[] = [businessId]
  if (q.from) { where.push('p.date >= ?'); args.push(q.from) }
  if (q.to) { where.push('p.date <= ?'); args.push(q.to) }
  if (q.party_type) { where.push('p.party_type = ?'); args.push(q.party_type) }
  if (q.party_id) { where.push('p.party_id = ?'); args.push(q.party_id) }
  if (q.direction) { where.push('p.direction = ?'); args.push(q.direction) }
  if (q.account_id) { where.push('p.account_id = ?'); args.push(q.account_id) }
  if (q.method) { where.push('p.method = ?'); args.push(q.method) }
  if (q.ref_type) { where.push('p.ref_type = ?'); args.push(q.ref_type) }
  const w = where.join(' AND ')
  const total = (db.prepare(`SELECT COUNT(*) c FROM payments p WHERE ${w}`).get(...args) as { c: number }).c
  const rows = db
    .prepare(
      `SELECT p.*, a.name AS account_name FROM payments p LEFT JOIN accounts a ON a.id=p.account_id
       WHERE ${w} ORDER BY p.date DESC, p.rowid DESC LIMIT ? OFFSET ?`
    )
    .all(...args, q.pageSize, (q.page - 1) * q.pageSize)
  const sums = db.prepare(`SELECT COALESCE(SUM(CASE WHEN direction='in' THEN amount END),0) cash_in, COALESCE(SUM(CASE WHEN direction='out' THEN amount END),0) cash_out FROM payments p WHERE ${w}`).get(...args) as { cash_in: number; cash_out: number }
  return { rows, total, sums }
}
