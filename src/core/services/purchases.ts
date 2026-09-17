import type { DB } from '../db/connection'
import { newId, now } from '../ids'
import { allocateProportionally, roundQty } from '../money'
import { CoreError, postEntry } from './accounts'
import { audit, type AuditCtx } from './audit'
import { nextNumber } from './settings'

export interface PurchaseItemInput {
  product_id: string
  qty: number
  unit_cost: number // poisha
}

export interface PurchaseInput {
  supplier_id: string
  ref_no?: string
  items: PurchaseItemInput[]
  discount?: number
  other_cost?: number
  payments?: Array<{ account_id: string; amount: number; method: string }>
  opening_due_settle?: number // pay supplier's previous due in the same flow
  note?: string
  date?: number
}

export interface PurchaseRow {
  id: string
  supplier_id: string
  supplier_name?: string
  ref_no: string | null
  date: number
  subtotal: number
  discount: number
  other_cost: number
  total: number
  paid: number
  due: number
  note: string | null
  status: string
  user_id: string
  user_name?: string
}

/**
 * Weighted-average-cost recomputation (single costing method, used everywhere):
 *   new_wac = (old_qty·old_wac + purchased_qty·effective_cost) / (old_qty + purchased_qty)
 * Purchase discount & other cost are prorated across lines into effective_cost.
 */
export function computeNewWac(oldQty: number, oldWac: number, qty: number, effectiveUnitCost: number): number {
  const totalQty = oldQty + qty
  if (totalQty <= 0) return oldWac
  return Math.round((oldQty * oldWac + qty * effectiveUnitCost) / totalQty)
}

export function createPurchase(db: DB, ctx: AuditCtx, businessId: string, input: PurchaseInput): { purchase: PurchaseRow; id: string } {
  return db.transaction(() => {
    if (!input.items?.length) throw new CoreError('EMPTY_ITEMS', 'ক্রয়ের আইটেম যোগ করুন।')
    const sup = db.prepare(`SELECT id, name, payable FROM suppliers WHERE id=? AND business_id=?`).get(input.supplier_id, businessId) as { id: string; name: string; payable: number } | undefined
    if (!sup) throw new CoreError('SUPPLIER_NOT_FOUND', 'সরবরাহকারী নির্বাচন করুন।')

    let subtotal = 0
    const lines: Array<{ product_id: string; name: string; qty: number; unit_cost: number; line_total: number }> = []
    for (const it of input.items) {
      const p = db.prepare(`SELECT id, name, stock, track_stock, wac FROM products WHERE id=? AND business_id=?`).get(it.product_id, businessId) as
        | { id: string; name: string; stock: number; track_stock: number; wac: number }
        | undefined
      if (!p) throw new CoreError('PRODUCT_NOT_FOUND', 'ক্রয়ের একটি পণ্য পাওয়া যায়নি।')
      const qty = roundQty(it.qty)
      const cost = Math.max(0, Math.round(it.unit_cost))
      if (qty <= 0 || cost < 0) throw new CoreError('BAD_LINE', `"${p.name}" এর পরিমাণ বা দাম সঠিক নয়।`)
      const line_total = Math.round(qty * cost)
      subtotal += line_total
      lines.push({ product_id: p.id, name: p.name, qty, unit_cost: cost, line_total })
    }

    const discount = Math.min(Math.max(0, Math.round(input.discount ?? 0)), subtotal)
    const other_cost = Math.max(0, Math.round(input.other_cost ?? 0))
    const total = subtotal - discount + other_cost

    // effective per-unit cost per line after discount/other-cost proration (largest-remainder exact)
    const weights = lines.map((l) => l.line_total)
    const allocatedOther = other_cost > 0 ? allocateProportionally(other_cost, weights) : lines.map(() => 0)
    const allocatedDisc = discount > 0 ? allocateProportionally(discount, weights) : lines.map(() => 0)
    const effCosts = lines.map((l, i) => Math.round((l.line_total - allocatedDisc[i] + allocatedOther[i]) / l.qty))

    const paidTotal = (input.payments ?? []).reduce((a, p) => a + Math.max(0, Math.round(p.amount)), 0)
    const settle = Math.max(0, Math.round(input.opening_due_settle ?? 0))
    const grandPay = paidTotal + settle
    const due = total - paidTotal
    if (due < 0) throw new CoreError('OVERPAID', 'পরিশোধ মোট ক্রয়ের চেয়ে বেশি হতে পারে না।')
    if (settle > sup.payable) throw new CoreError('BAD_SETTLE', 'পূর্বের বকেয়ার চেয়ে বেশি পরিশোধ করা হয়েছে।')
    for (const p of input.payments ?? []) {
      const acc = db.prepare(`SELECT 1 FROM accounts WHERE id=? AND business_id=? AND status='active'`).get(p.account_id, businessId)
      if (!acc) throw new CoreError('ACCOUNT_NOT_FOUND', 'পেমেন্ট হিসাব পাওয়া যায়নি।')
    }

    const t = input.date ?? now()
    const id = newId()
    const refNo = input.ref_no?.trim() || null
    const primaryMethod = (input.payments ?? []).sort((a, b) => b.amount - a.amount)[0]?.method ?? 'cash'

    db.prepare(
      `INSERT INTO purchases (id, business_id, supplier_id, ref_no, date, subtotal, discount, other_cost, total, paid, due, note, user_id, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(id, businessId, sup.id, refNo, t, subtotal, discount, other_cost, total, paidTotal, due, input.note ?? null, ctx.userId ?? null, now())

    const insItem = db.prepare(
      `INSERT INTO purchase_items (id, business_id, purchase_id, product_id, name, qty, unit_cost, line_total)
       VALUES (?,?,?,?,?,?,?,?)`
    )
    const insMove = db.prepare(
      `INSERT INTO stock_movements (id, business_id, product_id, qty, type, ref_type, ref_id, balance_after, cost_at_move, user_id, created_at)
       VALUES (?,?,?,?,'purchase','purchase',?,?,?,?,?)`
    )

    for (let i = 0; i < lines.length; i++) {
      const l = lines[i]
      insItem.run(newId(), businessId, id, l.product_id, l.name, l.qty, l.unit_cost, l.line_total)
      const p = db.prepare(`SELECT stock, track_stock, wac, purchase_price FROM products WHERE id=?`).get(l.product_id) as
        { stock: number; track_stock: number; wac: number; purchase_price: number }
      if (p.track_stock) {
        const newWac = computeNewWac(p.stock, p.wac, l.qty, effCosts[i])
        const nextStock = roundQty(p.stock + l.qty)
        db.prepare(`UPDATE products SET stock=?, wac=?, purchase_price=?, updated_at=? WHERE id=?`).run(nextStock, newWac, l.unit_cost, t, l.product_id)
        insMove.run(newId(), businessId, l.product_id, l.qty, id, nextStock, newWac, ctx.userId ?? null, t)
      } else {
        db.prepare(`UPDATE products SET purchase_price=?, updated_at=? WHERE id=?`).run(l.unit_cost, t, l.product_id)
      }
    }

    for (const p of input.payments ?? []) {
      if (p.amount <= 0) continue
      postEntry(db, { accountId: p.account_id, amount: -p.amount, type: 'purchase', refType: 'purchase', refId: id, note: `ক্রয় ${refNo ?? ''}`.trim(), userId: ctx.userId, date: t })
      db.prepare(
        `INSERT INTO payments (id, business_id, voucher_no, party_type, party_id, party_name, direction, amount, account_id, method, ref_type, ref_id, date, note, user_id, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
      ).run(newId(), businessId, nextNumber(db, businessId, 'voucher'), 'supplier', sup.id, sup.name, 'out', p.amount, p.account_id, p.method, 'purchase', id, t, null, ctx.userId ?? null, now())
    }

    if (due > 0) {
      db.prepare(`UPDATE suppliers SET payable = payable + ? WHERE id=?`).run(due, sup.id)
    }

    // previous-due settlement recorded as a normal supplier payment
    if (settle > 0) {
      db.prepare(`UPDATE suppliers SET payable = payable - ? WHERE id=?`).run(settle, sup.id)
      const acc = input.payments?.[0]?.account_id
      if (!acc) throw new CoreError('ACCOUNT_REQUIRED', 'পূর্বের বকেয়া পরিশোধের হিসাব নির্বাচন করুন।')
      db.prepare(
        `INSERT INTO payments (id, business_id, voucher_no, party_type, party_id, party_name, direction, amount, account_id, method, ref_type, ref_id, date, note, user_id, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
      ).run(newId(), businessId, nextNumber(db, businessId, 'voucher'), 'supplier', sup.id, sup.name, 'out', settle, acc, input.payments?.[0]?.method ?? 'cash', 'purchase', id, t, 'পূর্বের বকেয়া পরিশোধ', ctx.userId ?? null, now())
      postEntry(db, { accountId: acc, amount: -settle, type: 'supplier_payment', refType: 'purchase', refId: id, note: `পূর্বের বকেয়া পরিশোধ — ${sup.name}`, userId: ctx.userId, date: t })
    }

    audit(db, { ...ctx, businessId }, 'purchase.create', 'purchase', id, null, { supplier: sup.name, total, paid: paidTotal, due, grandPay, primaryMethod })
    return { purchase: getPurchase(db, businessId, id), id }
  })()
}

export function getPurchase(db: DB, businessId: string, id: string): PurchaseRow {
  const p = db
    .prepare(`SELECT p.*, s.name AS supplier_name, u.name AS user_name FROM purchases p
              LEFT JOIN suppliers s ON s.id=p.supplier_id LEFT JOIN users u ON u.id=p.user_id
              WHERE p.id=? AND p.business_id=?`)
    .get(id, businessId) as PurchaseRow | undefined
  if (!p) throw new CoreError('PURCHASE_NOT_FOUND', 'ক্রয়টি পাওয়া যায়নি।')
  return p
}

export function listPurchases(db: DB, businessId: string, q: { from?: number; to?: number; supplier_id?: string; dueOnly?: boolean; search?: string; page: number; pageSize: number }) {
  const where: string[] = ["p.business_id = ? AND p.status <> 'voided'"]
  const args: unknown[] = [businessId]
  if (q.from) { where.push('p.date >= ?'); args.push(q.from) }
  if (q.to) { where.push('p.date <= ?'); args.push(q.to) }
  if (q.supplier_id) { where.push('p.supplier_id = ?'); args.push(q.supplier_id) }
  if (q.dueOnly) where.push('p.due > 0')
  if (q.search) { where.push('(p.ref_no LIKE ? OR s.name LIKE ?)'); const like = `%${q.search}%`; args.push(like, like) }
  const w = where.join(' AND ')
  const total = (db.prepare(`SELECT COUNT(*) c FROM purchases p LEFT JOIN suppliers s ON s.id=p.supplier_id WHERE ${w}`).get(...args) as { c: number }).c
  const rows = db
    .prepare(`SELECT p.*, s.name AS supplier_name, u.name AS user_name FROM purchases p
              LEFT JOIN suppliers s ON s.id=p.supplier_id LEFT JOIN users u ON u.id=p.user_id
              WHERE ${w} ORDER BY p.date DESC, p.rowid DESC LIMIT ? OFFSET ?`)
    .all(...args, q.pageSize, (q.page - 1) * q.pageSize)
  const sums = db.prepare(`SELECT COALESCE(SUM(p.total),0) total, COALESCE(SUM(p.paid),0) paid, COALESCE(SUM(p.due),0) due FROM purchases p LEFT JOIN suppliers s ON s.id=p.supplier_id WHERE ${w}`).get(...args) as { total: number; paid: number; due: number }
  return { rows, total, sums }
}

export function getPurchaseItems(db: DB, purchaseId: string) {
  return db.prepare(`SELECT pi.*, p.sku FROM purchase_items pi LEFT JOIN products p ON p.id=pi.product_id WHERE pi.purchase_id=?`).all(purchaseId)
}

/** Reverse an erroneous purchase completely (permission-gated). Stock, WAC-impact is documented; stock is decremented. */
export function voidPurchase(db: DB, ctx: AuditCtx, businessId: string, purchaseId: string, reason: string) {
  return db.transaction(() => {
    const purchase = getPurchase(db, businessId, purchaseId)
    if (!reason?.trim()) throw new CoreError('REASON_REQUIRED', 'বাতিলের কারণ লিখুন।')
    const items = db.prepare(`SELECT * FROM purchase_items WHERE purchase_id=?`).all(purchaseId) as Array<{ product_id: string; qty: number }>
    const t = now()
    for (const it of items) {
      const p = db.prepare(`SELECT stock, track_stock FROM products WHERE id=?`).get(it.product_id) as { stock: number; track_stock: number } | undefined
      if (!p || !p.track_stock) continue
      const nextStock = roundQty(p.stock - it.qty)
      if (nextStock < 0) throw new CoreError('STOCK_USED', 'এই ক্রয়ের পণ্য বিক্রি হয়ে গেছে — বাতিল করলে স্টক ঋণাত্মক হবে।')
      db.prepare(`UPDATE products SET stock=?, updated_at=? WHERE id=?`).run(nextStock, t, it.product_id)
      db.prepare(
        `INSERT INTO stock_movements (id, business_id, product_id, qty, type, ref_type, ref_id, balance_after, cost_at_move, reason, user_id, created_at)
         VALUES (?,?,?,?,'purchase_return','void',?,?,?,?,?,?)`
      ).run(newId(), businessId, it.product_id, -it.qty, purchaseId, nextStock, null, `ক্রয় বাতিল: ${reason}`, ctx.userId ?? null, t)
    }
    // reverse ledger payments
    const pays = db.prepare(`SELECT * FROM payments WHERE ref_type='purchase' AND ref_id=?`).all(purchaseId) as Array<{ id: string; account_id: string; amount: number }>
    for (const pay of pays) {
      if (pay.account_id) postEntry(db, { accountId: pay.account_id, amount: pay.amount, type: 'void', refType: 'void', refId: purchaseId, note: `ক্রয় বাতিল`, userId: ctx.userId, date: t })
      db.prepare(`UPDATE payments SET note=COALESCE(note,'') || ' [বাতিল]' WHERE id=?`).run(pay.id)
    }
    if (purchase.due > 0) {
      db.prepare(`UPDATE suppliers SET payable = payable - ? WHERE id=?`).run(purchase.due, purchase.supplier_id)
    }
    db.prepare(`UPDATE purchases SET status='voided', note=COALESCE(note,'') || ? WHERE id=?`).run(` [বাতিল: ${reason.trim()}]`, purchaseId)
    audit(db, { ...ctx, businessId }, 'purchase.void', 'purchase', purchaseId, purchase, null, reason.trim())
  })()
}
