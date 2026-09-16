import type { DB } from '../db/connection'
import { newId, now } from '../ids'
import { allocateProportionally, roundQty } from '../money'
import { CoreError, postEntry } from './accounts'
import { audit, type AuditCtx } from './audit'
import { nextNumber, getSetting } from './settings'
import type { ProductRow } from './products'

export interface SaleItemInput {
  product_id: string
  qty: number
  unit_price?: number // override (poisha) — permission-checked at API layer
  discount?: number // poisha
  discount_pct?: number
}

export interface SalePaymentInput {
  account_id: string
  amount: number
  method: string
}

export interface SaleInput {
  customer_id?: string | null
  items: SaleItemInput[]
  invoice_discount?: number
  payments: SalePaymentInput[]
  note?: string
  date?: number
}

export interface ComputedLine {
  product: ProductRow
  qty: number
  unit_price: number
  discount: number
  discount_pct: number | null
  tax: number
  line_total: number
  cogs_unit: number
  cogs_total: number
}

export interface ComputedSale {
  lines: ComputedLine[]
  subtotal: number
  item_discount: number
  invoice_discount: number
  tax: number
  total: number
  cogs: number
}

/** Pure pricing math — shared by create, void and tests. */
export function computeSale(db: DB, businessId: string, input: SaleInput): ComputedSale {
  if (!input.items?.length) throw new CoreError('EMPTY_CART', 'কার্টে কোনো পণ্য নেই।')
  const vatEnabled = getSetting<boolean>(db, businessId, 'vat_enabled')
  const lines: ComputedLine[] = []
  for (const it of input.items) {
    const p = db.prepare(`SELECT * FROM products WHERE id=? AND business_id=?`).get(it.product_id, businessId) as ProductRow | undefined
    if (!p) throw new CoreError('PRODUCT_NOT_FOUND', 'কার্টের একটি পণ্য আর পাওয়া যায়নি।')
    if (p.status !== 'active') throw new CoreError('PRODUCT_INACTIVE', `"${p.name}" পণ্যটি নিষ্ক্রিয়।`)
    const qty = roundQty(it.qty)
    if (qty <= 0) throw new CoreError('BAD_QTY', `"${p.name}" এর পরিমাণ সঠিক নয়।`)
    const unit_price = it.unit_price ?? p.selling_price
    let discount = Math.max(0, Math.round(it.discount ?? 0))
    if (it.discount_pct != null) discount = Math.max(0, Math.round((qty * unit_price * it.discount_pct) / 100))
    if (discount > qty * unit_price) discount = Math.round(qty * unit_price)
    const tax = vatEnabled ? Math.round(((qty * unit_price - discount) * p.tax_rate_bps) / 10000) : 0
    const cogs_unit = p.track_stock ? p.wac : p.purchase_price
    lines.push({
      product: p,
      qty,
      unit_price,
      discount,
      discount_pct: it.discount_pct ?? null,
      tax,
      line_total: qty * unit_price - discount + tax,
      cogs_unit,
      cogs_total: Math.round(qty * cogs_unit)
    })
  }
  const subtotal = lines.reduce((a, l) => a + l.qty * l.unit_price, 0)
  const item_discount = lines.reduce((a, l) => a + l.discount, 0)
  const tax = lines.reduce((a, l) => a + l.tax, 0)
  let invoice_discount = Math.max(0, Math.round(input.invoice_discount ?? 0))
  if (invoice_discount > subtotal - item_discount) invoice_discount = subtotal - item_discount
  const total = subtotal - item_discount - invoice_discount + tax
  const cogs = lines.reduce((a, l) => a + l.cogs_total, 0)
  return { lines, subtotal, item_discount, invoice_discount, tax, total, cogs }
}

export function createSale(db: DB, ctx: AuditCtx, businessId: string, input: SaleInput): { sale: SaleRow; items: SaleItemRow[] } {
  const t = input.date ?? now()
  const allowNegative = getSetting<boolean>(db, businessId, 'allow_negative_stock')

  const comp = computeSale(db, businessId, input)

  // stock availability
  for (const l of comp.lines) {
    if (l.product.track_stock && !allowNegative && l.product.stock < l.qty) {
      throw new CoreError('INSUFFICIENT_STOCK', `"${l.product.name}" এর স্টক যথেষ্ট নেই (আছে ${l.product.stock})।`)
    }
  }

  // payments
  const paid = (input.payments ?? []).reduce((a, p) => a + Math.max(0, Math.round(p.amount)), 0)
  if (paid > comp.total) throw new CoreError('OVERPAID', 'পরিশোধ মোট বিলের চেয়ে বেশি হতে পারে না।')
  const due = comp.total - paid
  let customer = null as { id: string; name: string; receivable: number } | null
  if (input.customer_id) {
    customer = db.prepare(`SELECT id, name, receivable FROM customers WHERE id=? AND business_id=?`).get(input.customer_id, businessId) as typeof customer
    if (!customer) throw new CoreError('CUSTOMER_NOT_FOUND', 'গ্রাহক পাওয়া যায়নি।')
  }
  if (due > 0 && !customer) throw new CoreError('DUE_NEEDS_CUSTOMER', 'বাকিতে বিক্রয়ের জন্য গ্রাহক নির্বাচন করুন।')
  for (const p of input.payments ?? []) {
    const acc = db.prepare(`SELECT 1 FROM accounts WHERE id=? AND business_id=? AND status='active'`).get(p.account_id, businessId)
    if (!acc) throw new CoreError('ACCOUNT_NOT_FOUND', 'পেমেন্ট হিসাব পাওয়া যায়নি।')
  }

  const invoice_no = nextNumber(db, businessId, 'invoice')
  const saleId = newId()
  const primaryMethod = (input.payments ?? []).sort((a, b) => b.amount - a.amount)[0]?.method ?? 'cash'

  db.prepare(
    `INSERT INTO sales (id, business_id, invoice_no, customer_id, customer_name, date, subtotal, item_discount,
      invoice_discount, tax, total, paid, due, cogs, payment_method, note, status, user_id, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'completed', ?, ?)`
  ).run(
    saleId, businessId, invoice_no, customer?.id ?? null, customer?.name ?? null, t,
    comp.subtotal, comp.item_discount, comp.invoice_discount, comp.tax, comp.total, paid, due, comp.cogs,
    primaryMethod, input.note ?? null, ctx.userId ?? null, now()
  )

  const insItem = db.prepare(
    `INSERT INTO sale_items (id, business_id, sale_id, product_id, name, sku, unit, qty, unit_price, discount, discount_pct, tax, line_total, cogs_unit, cogs_total)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  )
  const insMove = db.prepare(
    `INSERT INTO stock_movements (id, business_id, product_id, qty, type, ref_type, ref_id, balance_after, cost_at_move, user_id, created_at)
     VALUES (?,?,?,?,'sale','sale',?,?,?,?,?)`
  )
  const updStock = db.prepare(`UPDATE products SET stock=?, updated_at=? WHERE id=?`)

  for (const l of comp.lines) {
    const unit = db.prepare(`SELECT short FROM units WHERE id=?`).get(l.product.unit_id) as { short: string } | undefined
    const itemId = newId()
    insItem.run(
      itemId, businessId, saleId, l.product.id, l.product.name, l.product.sku, unit?.short ?? null,
      l.qty, l.unit_price, l.discount, l.discount_pct, l.tax, l.line_total, l.cogs_unit, l.cogs_total
    )
    if (l.product.track_stock) {
      const nextStock = roundQty(l.product.stock - l.qty)
      updStock.run(nextStock, t, l.product.id)
      insMove.run(newId(), businessId, l.product.id, -l.qty, saleId, nextStock, l.cogs_unit, ctx.userId ?? null, t)
    }
  }

  for (const p of input.payments ?? []) {
    if (p.amount <= 0) continue
    postEntry(db, { accountId: p.account_id, amount: p.amount, type: 'sale', refType: 'sale', refId: saleId, note: `বিক্রয় ${invoice_no}`, userId: ctx.userId, date: t })
    db.prepare(
      `INSERT INTO payments (id, business_id, voucher_no, party_type, party_id, party_name, direction, amount, account_id, method, ref_type, ref_id, date, note, user_id, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(
      newId(), businessId, nextNumber(db, businessId, 'voucher'), 'customer', customer?.id ?? '', customer?.name ?? null,
      'in', p.amount, p.account_id, p.method, 'sale', saleId, t, null, ctx.userId ?? null, now()
    )
  }

  if (due > 0 && customer) {
    db.prepare(`UPDATE customers SET receivable = receivable + ? WHERE id=?`).run(due, customer.id)
  }

  const sale = getSale(db, businessId, saleId)
  const items = db.prepare(`SELECT * FROM sale_items WHERE sale_id=?`).all(saleId) as SaleItemRow[]
  audit(db, { ...ctx, businessId }, 'sale.create', 'sale', saleId, null, { invoice_no, total: comp.total, paid, due, cogs: comp.cogs })
  return { sale, items }
}

export interface SaleRow {
  id: string
  invoice_no: string
  customer_id: string | null
  customer_name: string | null
  date: number
  subtotal: number
  item_discount: number
  invoice_discount: number
  tax: number
  total: number
  paid: number
  due: number
  cogs: number
  payment_method: string
  note: string | null
  status: string
  returned_amount: number
  user_id: string
  user_name?: string
}

export interface SaleItemRow {
  id: string
  product_id: string | null
  name: string
  sku: string | null
  unit: string | null
  qty: number
  unit_price: number
  discount: number
  tax: number
  line_total: number
  cogs_total: number
  returned_qty: number
}

export function getSale(db: DB, businessId: string, id: string): SaleRow {
  const s = db
    .prepare(`SELECT s.*, u.name AS user_name FROM sales s LEFT JOIN users u ON u.id=s.user_id WHERE s.id=? AND s.business_id=?`)
    .get(id, businessId) as SaleRow | undefined
  if (!s) throw new CoreError('SALE_NOT_FOUND', 'বিক্রয়টি পাওয়া যায়নি।')
  return s
}

export function getSaleByInvoice(db: DB, businessId: string, invoiceNo: string): SaleRow | undefined {
  return db.prepare(`SELECT * FROM sales WHERE business_id=? AND invoice_no=?`).get(businessId, invoiceNo) as SaleRow | undefined
}

export function listSales(db: DB, businessId: string, q: {
  from?: number; to?: number; customer_id?: string; user_id?: string; method?: string; dueOnly?: boolean; search?: string; status?: string;
  page: number; pageSize: number
}) {
  const where: string[] = ['s.business_id = ?']
  const args: unknown[] = [businessId]
  if (q.from) { where.push('s.date >= ?'); args.push(q.from) }
  if (q.to) { where.push('s.date <= ?'); args.push(q.to) }
  if (q.customer_id) { where.push('s.customer_id = ?'); args.push(q.customer_id) }
  if (q.user_id) { where.push('s.user_id = ?'); args.push(q.user_id) }
  if (q.method) { where.push('s.payment_method = ?'); args.push(q.method) }
  if (q.dueOnly) where.push('s.due > 0')
  if (q.status) { where.push('s.status = ?'); args.push(q.status) }
  if (q.search) { where.push('(s.invoice_no LIKE ? OR s.customer_name LIKE ?)'); const like = `%${q.search}%`; args.push(like, like) }
  const w = where.join(' AND ')
  const total = (db.prepare(`SELECT COUNT(*) c FROM sales s WHERE ${w}`).get(...args) as { c: number }).c
  const rows = db
    .prepare(`SELECT s.*, u.name AS user_name, c.phone AS customer_phone FROM sales s
              LEFT JOIN users u ON u.id = s.user_id
              LEFT JOIN customers c ON c.id = s.customer_id
              WHERE ${w} ORDER BY s.date DESC, s.rowid DESC LIMIT ? OFFSET ?`)
    .all(...args, q.pageSize, (q.page - 1) * q.pageSize)
  const sums = db.prepare(`SELECT COALESCE(SUM(total),0) total, COALESCE(SUM(paid),0) paid, COALESCE(SUM(due),0) due, COALESCE(SUM(cogs),0) cogs FROM sales s WHERE ${w}`).get(...args) as { total: number; paid: number; due: number; cogs: number }
  return { rows, total, sums }
}

/* ───────────────────────── returns ───────────────────────── */

export interface ReturnInput {
  sale_id: string
  items: Array<{ sale_item_id: string; qty: number }>
  restock: boolean
  refund_mode: 'cash' | 'due_adjust' | 'account'
  account_id?: string
  reason?: string
  note?: string
}

export function createReturn(db: DB, ctx: AuditCtx, businessId: string, input: ReturnInput) {
  const sale = getSale(db, businessId, input.sale_id)
  if (sale.status === 'voided') throw new CoreError('SALE_VOIDED', 'বাতিল বিক্রয়ের রিটার্ন করা যায় না।')
  if (!input.items?.length) throw new CoreError('EMPTY_RETURN', 'রিটার্নের জন্য অন্তত একটি পণ্য নির্বাচন করুন।')
  if (input.refund_mode !== 'due_adjust' && !input.account_id) {
    throw new CoreError('ACCOUNT_REQUIRED', 'ফেরত দেওয়ার হিসাব নির্বাচন করুন।')
  }

  const items = db.prepare(`SELECT * FROM sale_items WHERE sale_id=?`).all(sale.id) as SaleItemRow[]
  const lineById = new Map(items.map((i) => [i.id, i]))

  const retLines: Array<{ item: SaleItemRow; qty: number; amount: number; cogs: number }> = []
  for (const r of input.items) {
    const item = lineById.get(r.sale_item_id)
    if (!item) throw new CoreError('ITEM_NOT_IN_SALE', 'এই পণ্যটি সংশ্লিষ্ট চালানে নেই।')
    const qty = roundQty(r.qty)
    if (qty <= 0) throw new CoreError('BAD_QTY', 'রিটার্নের পরিমাণ সঠিক নয়।')
    const returnable = roundQty(item.qty - item.returned_qty)
    if (qty > returnable) throw new CoreError('TOO_MUCH', `"${item.name}" এর জন্য সর্বোচ্চ ${returnable} পরিমাণ ফেরত দেওয়া যাবে।`)
    // net-of-invoice-discount unit refund, proportional
    const share = sale.subtotal > 0 ? item.line_total / sale.subtotal : 1
    const invDiscShare = Math.round(sale.invoice_discount * share)
    const amount = Math.max(0, Math.round(((item.line_total - invDiscShare) / item.qty) * qty))
    const cogs = Math.round((item.cogs_total / item.qty) * qty)
    retLines.push({ item, qty, amount, cogs })
  }

  const amount = retLines.reduce((a, l) => a + l.amount, 0)
  const cogsReturn = retLines.reduce((a, l) => a + l.cogs, 0)
  const t = now()
  const retId = newId()
  const retNo = nextNumber(db, businessId, 'return')

  let dueAdjusted = 0
  let cashRefund = 0
  if (input.refund_mode === 'due_adjust' && sale.customer_id) {
    dueAdjusted = Math.min(amount, sale.due > 0 ? getCurrentReceivable(db, businessId, sale.customer_id) : 0)
    cashRefund = amount - dueAdjusted
  } else {
    cashRefund = amount
  }

  db.prepare(
    `INSERT INTO returns_ (id, business_id, sale_id, customer_id, invoice_no, date, amount, cogs_return, restock, refund_mode, account_id, reason, note, user_id, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).run(
    retId, businessId, sale.id, sale.customer_id, sale.invoice_no, t, amount, cogsReturn,
    input.restock ? 1 : 0, input.refund_mode, input.account_id ?? null, input.reason ?? null, input.note ?? null, ctx.userId ?? null, t
  )

  const insRItem = db.prepare(
    `INSERT INTO return_items (id, business_id, return_id, sale_item_id, product_id, name, qty, unit_price, amount, cogs)
     VALUES (?,?,?,?,?,?,?,?,?,?)`
  )
  for (const l of retLines) {
    insRItem.run(newId(), businessId, retId, l.item.id, l.item.product_id, l.item.name, l.qty, Math.round(l.amount / l.qty), l.amount, l.cogs)
    db.prepare(`UPDATE sale_items SET returned_qty = returned_qty + ? WHERE id=?`).run(l.qty, l.item.id)
    if (input.restock && l.item.product_id) {
      const p = db.prepare(`SELECT * FROM products WHERE id=?`).get(l.item.product_id) as ProductRow | undefined
      if (p && p.track_stock) {
        const nextStock = roundQty(p.stock + l.qty)
        db.prepare(`UPDATE products SET stock=?, updated_at=? WHERE id=?`).run(nextStock, t, p.id)
        db.prepare(
          `INSERT INTO stock_movements (id, business_id, product_id, qty, type, ref_type, ref_id, balance_after, cost_at_move, user_id, created_at)
           VALUES (?,?,?,?,'sale_return','return',?,?,?,?,?)`
        ).run(newId(), businessId, p.id, l.qty, retId, nextStock, p.wac, ctx.userId ?? null, t)
      }
    }
  }

  // ledger: cash refund leaves the till
  if (cashRefund > 0 && input.account_id) {
    postEntry(db, { accountId: input.account_id, amount: -cashRefund, type: 'refund', refType: 'return', refId: retId, note: `রিটার্ন ${retNo} (${sale.invoice_no})`, userId: ctx.userId, date: t })
  }
  // due adjustment reduces receivable
  if (dueAdjusted > 0 && sale.customer_id) {
    db.prepare(`UPDATE customers SET receivable = receivable - ? WHERE id=?`).run(dueAdjusted, sale.customer_id)
    db.prepare(
      `INSERT INTO payments (id, business_id, voucher_no, party_type, party_id, party_name, direction, amount, account_id, method, ref_type, ref_id, date, note, user_id, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(
      newId(), businessId, nextNumber(db, businessId, 'voucher'), 'customer', sale.customer_id, sale.customer_name,
      'out', dueAdjusted, input.account_id ?? null, 'due_adjust', 'return', retId, t, 'রিটার্নে বকেয়া সমন্বয়', ctx.userId ?? null, now()
    )
  }

  const returnedTotal = sale.returned_amount + amount
  const status = returnedTotal >= sale.total ? 'returned' : 'partially_returned'
  db.prepare(`UPDATE sales SET returned_amount=?, status=?, updated_at=? WHERE id=?`).run(returnedTotal, status, t, sale.id)

  audit(db, { ...ctx, businessId }, 'sale.return', 'return', retId, null, { sale: sale.invoice_no, amount, restock: input.restock, refund_mode: input.refund_mode })
  return { id: retId, no: retNo, amount, due_adjusted: dueAdjusted, cash_refund: cashRefund }
}

function getCurrentReceivable(db: DB, businessId: string, customerId: string): number {
  const c = db.prepare(`SELECT receivable FROM customers WHERE id=? AND business_id=?`).get(customerId, businessId) as { receivable: number } | undefined
  return c?.receivable ?? 0
}

/** Void an entire sale (permission-gated at API). Reverses stock, ledger and receivable. */
export function voidSale(db: DB, ctx: AuditCtx, businessId: string, saleId: string, reason: string) {
  const sale = getSale(db, businessId, saleId)
  if (sale.status === 'voided') throw new CoreError('ALREADY_VOID', 'এই বিক্রয়টি আগেই বাতিল হয়েছে।')
  const retCount = (db.prepare(`SELECT COUNT(*) c FROM returns_ WHERE sale_id=?`).get(saleId) as { c: number }).c
  if (retCount > 0) throw new CoreError('HAS_RETURN', 'রিটার্ন থাকা বিক্রয় বাতিল করা যায় না — আংশিক রিটার্ন ব্যবহার করুন।')
  if (!reason?.trim()) throw new CoreError('REASON_REQUIRED', 'বাতিলের কারণ লিখুন।')
  const t = now()
  const items = db.prepare(`SELECT * FROM sale_items WHERE sale_id=?`).all(saleId) as SaleItemRow[]
  for (const item of items) {
    if (item.product_id) {
      const p = db.prepare(`SELECT * FROM products WHERE id=?`).get(item.product_id) as ProductRow | undefined
      if (p && p.track_stock) {
        const nextStock = roundQty(p.stock + item.qty)
        db.prepare(`UPDATE products SET stock=?, updated_at=? WHERE id=?`).run(nextStock, t, p.id)
        db.prepare(
          `INSERT INTO stock_movements (id, business_id, product_id, qty, type, ref_type, ref_id, balance_after, cost_at_move, reason, user_id, created_at)
           VALUES (?,?,?,?,'sale_return','void',?,?,?,?,?,?)`
        ).run(newId(), businessId, p.id, item.qty, saleId, nextStock, p.wac, `বিক্রয় বাতিল: ${reason}`, ctx.userId ?? null, t)
      }
    }
  }
  // reverse ledger entries of original payments
  const pays = db.prepare(`SELECT * FROM payments WHERE ref_type='sale' AND ref_id=?`).all(saleId) as Array<{ id: string; account_id: string; amount: number; party_id: string }>
  for (const pay of pays) {
    postEntry(db, { accountId: pay.account_id, amount: -pay.amount, type: 'void', refType: 'void', refId: saleId, note: `বিক্রয় বাতিল ${sale.invoice_no}`, userId: ctx.userId, date: t })
    db.prepare(`UPDATE payments SET note=COALESCE(note,'') || ' [বাতিল]' WHERE id=?`).run(pay.id)
  }
  if (sale.customer_id && sale.due > 0) {
    db.prepare(`UPDATE customers SET receivable = receivable - ? WHERE id=?`).run(sale.due, sale.customer_id)
  }
  db.prepare(`UPDATE sales SET status='voided', updated_at=? WHERE id=?`).run(t, saleId)
  audit(db, { ...ctx, businessId }, 'sale.void', 'sale', saleId, sale, null, reason.trim())
}
