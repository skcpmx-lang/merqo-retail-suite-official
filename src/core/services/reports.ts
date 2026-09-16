import type { DB } from '../db/connection'

export interface Range { from: number; to: number }

/** Retail P&L: revenue recognised at sale (net of returns), COGS at WAC, expenses, MFS income. */
export function profitLoss(db: DB, businessId: string, r: Range) {
  const sales = db
    .prepare(
      `SELECT COALESCE(SUM(total),0) revenue, COALESCE(SUM(cogs),0) cogs, COALESCE(SUM(item_discount+invoice_discount),0) discounts,
              COALESCE(SUM(tax),0) tax, COUNT(*) count
       FROM sales WHERE business_id=? AND status<>'voided' AND date>=? AND date<=?`
    )
    .get(businessId, r.from, r.to) as { revenue: number; cogs: number; discounts: number; tax: number; count: number }

  const rets = db
    .prepare(`SELECT COALESCE(SUM(amount),0) amount, COALESCE(SUM(cogs_return),0) cogs, COUNT(*) count FROM returns_ WHERE business_id=? AND date>=? AND date<=?`)
    .get(businessId, r.from, r.to) as { amount: number; cogs: number; count: number }

  const expenses = db
    .prepare(`SELECT COALESCE(SUM(amount),0) amount FROM expenses WHERE business_id=? AND status='approved' AND date>=? AND date<=?`)
    .get(businessId, r.from, r.to) as { amount: number }

  const mfs = db
    .prepare(
      `SELECT COALESCE(SUM(commission),0) commission, COALESCE(SUM(service_charge),0) charges FROM mfs_txns
       WHERE business_id=? AND date>=? AND date<=? AND txn_type NOT IN ('adjustment')`
    )
    .get(businessId, r.from, r.to) as { commission: number; charges: number }

  const revenue = sales.revenue - rets.amount
  const cogs = sales.cogs - rets.cogs
  const grossProfit = revenue - cogs
  const mfsIncome = mfs.commission + mfs.charges
  const netProfit = grossProfit + mfsIncome - expenses.amount
  return {
    revenue, cogs, gross_profit: grossProfit,
    discounts: sales.discounts, tax: sales.tax, sales_count: sales.count,
    returns_amount: rets.amount, returns_count: rets.count,
    mfs_income: mfsIncome, mfs_commission: mfs.commission, mfs_charges: mfs.charges,
    expenses: expenses.amount, net_profit: netProfit,
    margin: revenue > 0 ? grossProfit / revenue : 0
  }
}

/** Daily series for trend charts. */
export function dailySeries(db: DB, businessId: string, r: Range) {
  const sales = db
    .prepare(
      `SELECT date(date/1000, 'unixepoch', 'localtime') d, SUM(total) total, SUM(cogs) cogs, COUNT(*) c
       FROM sales WHERE business_id=? AND status<>'voided' AND date>=? AND date<=? GROUP BY d`
    )
    .all(businessId, r.from, r.to) as Array<{ d: string; total: number; cogs: number; c: number }>
  const purchases = db
    .prepare(
      `SELECT date(date/1000, 'unixepoch', 'localtime') d, SUM(total) total FROM purchases
       WHERE business_id=? AND status<>'voided' AND date>=? AND date<=? GROUP BY d`
    )
    .all(businessId, r.from, r.to) as Array<{ d: string; total: number }>
  const expenses = db
    .prepare(
      `SELECT date(date/1000, 'unixepoch', 'localtime') d, SUM(amount) total FROM expenses
       WHERE business_id=? AND status='approved' AND date>=? AND date<=? GROUP BY d`
    )
    .all(businessId, r.from, r.to) as Array<{ d: string; total: number }>
  const map = new Map<string, { date: string; sales: number; profit: number; purchases: number; expenses: number; count: number }>()
  for (const s of sales) {
    const e = map.get(s.d) ?? { date: s.d, sales: 0, profit: 0, purchases: 0, expenses: 0, count: 0 }
    e.sales = s.total; e.profit = s.total - s.cogs; e.count = s.c
    map.set(s.d, e)
  }
  for (const p of purchases) {
    const e = map.get(p.d) ?? { date: p.d, sales: 0, profit: 0, purchases: 0, expenses: 0, count: 0 }
    e.purchases = p.total
    map.set(p.d, e)
  }
  for (const x of expenses) {
    const e = map.get(x.d) ?? { date: x.d, sales: 0, profit: 0, purchases: 0, expenses: 0, count: 0 }
    e.expenses = x.total
    map.set(x.d, e)
  }
  return Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date))
}

export function topProducts(db: DB, businessId: string, r: Range, limit = 10, by: 'revenue' | 'qty' = 'revenue') {
  return db
    .prepare(
      `SELECT si.product_id, si.name, SUM(si.qty) qty, SUM(si.line_total) revenue,
              SUM(si.cogs_total) cogs, SUM(si.line_total - si.cogs_total) profit
       FROM sale_items si JOIN sales s ON s.id=si.sale_id
       WHERE si.business_id=? AND s.status<>'voided' AND s.date>=? AND s.date<=?
       GROUP BY si.product_id, si.name ORDER BY ${by === 'qty' ? 'qty' : 'revenue'} DESC LIMIT ?`
    )
    .all(businessId, r.from, r.to, limit)
}

export function categorySales(db: DB, businessId: string, r: Range) {
  return db
    .prepare(
      `SELECT COALESCE(c.name, 'অন্যান্য') category, SUM(si.line_total) revenue, SUM(si.qty) qty
       FROM sale_items si
       JOIN sales s ON s.id=si.sale_id
       LEFT JOIN products p ON p.id=si.product_id
       LEFT JOIN categories c ON c.id=p.category_id
       WHERE si.business_id=? AND s.status<>'voided' AND s.date>=? AND s.date<=?
       GROUP BY c.name ORDER BY revenue DESC`
    )
    .all(businessId, r.from, r.to)
}

export function staffSales(db: DB, businessId: string, r: Range) {
  return db
    .prepare(
      `SELECT s.user_id, COALESCE(u.name,'অজানা') staff, SUM(s.total) revenue, COUNT(*) count, SUM(s.due) due
       FROM sales s LEFT JOIN users u ON u.id=s.user_id
       WHERE s.business_id=? AND s.status<>'voided' AND s.date>=? AND s.date<=?
       GROUP BY s.user_id ORDER BY revenue DESC`
    )
    .all(businessId, r.from, r.to)
}

export function methodSales(db: DB, businessId: string, r: Range) {
  return db
    .prepare(
      `SELECT method, SUM(amount) amount, COUNT(*) count FROM payments
       WHERE business_id=? AND direction='in' AND ref_type IN ('sale','customer') AND date>=? AND date<=?
       GROUP BY method ORDER BY amount DESC`
    )
    .all(businessId, r.from, r.to)
}

export function customerSales(db: DB, businessId: string, r: Range, limit = 50) {
  return db
    .prepare(
      `SELECT s.customer_id, COALESCE(s.customer_name,'নগদ গ্রাহক') name, SUM(s.total) revenue, COUNT(*) count, SUM(s.due) due
       FROM sales s WHERE s.business_id=? AND s.status<>'voided' AND s.date>=? AND s.date<=? AND s.customer_id IS NOT NULL
       GROUP BY s.customer_id ORDER BY revenue DESC LIMIT ?`
    )
    .all(businessId, r.from, r.to, limit)
}

export function supplierPurchases(db: DB, businessId: string, r: Range) {
  return db
    .prepare(
      `SELECT p.supplier_id, s.name supplier, SUM(p.total) total, SUM(p.paid) paid, SUM(p.due) due, COUNT(*) count
       FROM purchases p JOIN suppliers s ON s.id=p.supplier_id
       WHERE p.business_id=? AND p.status<>'voided' AND p.date>=? AND p.date<=?
       GROUP BY p.supplier_id ORDER BY total DESC`
    )
    .all(businessId, r.from, r.to)
}

export function productPurchases(db: DB, businessId: string, r: Range, limit = 100) {
  return db
    .prepare(
      `SELECT pi.product_id, pi.name, SUM(pi.qty) qty, SUM(pi.line_total) cost
       FROM purchase_items pi JOIN purchases p ON p.id=pi.purchase_id
       WHERE pi.business_id=? AND p.status<>'voided' AND p.date>=? AND p.date<=?
       GROUP BY pi.product_id, pi.name ORDER BY cost DESC LIMIT ?`
    )
    .all(businessId, r.from, r.to, limit)
}

/** Products with no sales in `days` (dead stock), with their current stock value. */
export function deadStock(db: DB, businessId: string, days = 60, limit = 100) {
  const cutoff = Date.now() - days * 86_400_000
  return db
    .prepare(
      `SELECT p.id, p.name, p.stock, p.wac, (p.stock*p.wac) value, MAX(si.rowid) last_sale_rowid
       FROM products p
       LEFT JOIN sale_items si ON si.product_id=p.id
       LEFT JOIN sales s ON s.id=si.sale_id AND s.date>=?
       WHERE p.business_id=? AND p.status='active' AND p.track_stock=1
       GROUP BY p.id
       HAVING SUM(CASE WHEN s.id IS NOT NULL THEN 1 ELSE 0 END)=0 AND p.stock>0
       ORDER BY value DESC LIMIT ?`
    )
    .all(cutoff, businessId, limit)
}

export function receivables(db: DB, businessId: string) {
  return db
    .prepare(
      `SELECT c.id, c.name, c.phone, c.receivable, c.opening_due,
              (SELECT MAX(date) FROM sales s WHERE s.customer_id=c.id) last_sale_at,
              (SELECT MAX(date) FROM payments p WHERE p.party_id=c.id AND p.party_type='customer' AND p.direction='in') last_paid_at
       FROM customers c WHERE c.business_id=? AND c.status='active' AND c.receivable>0 ORDER BY c.receivable DESC`
    )
    .all(businessId)
}

export function payables(db: DB, businessId: string) {
  return db
    .prepare(
      `SELECT s.id, s.name, s.phone, s.payable, s.opening_due,
              (SELECT MAX(date) FROM purchases p WHERE p.supplier_id=s.id) last_purchase_at,
              (SELECT MAX(date) FROM payments p WHERE p.party_id=s.id AND p.party_type='supplier' AND p.direction='out') last_paid_at
       FROM suppliers s WHERE s.business_id=? AND s.status='active' AND s.payable>0 ORDER BY s.payable DESC`
    )
    .all(businessId)
}

export function cashflow(db: DB, businessId: string, r: Range) {
  const rows = db
    .prepare(
      `SELECT a.id, a.name, a.type, a.provider,
              COALESCE(SUM(CASE WHEN t.amount>0 THEN t.amount END),0) inflow,
              COALESCE(SUM(CASE WHEN t.amount<0 THEN -t.amount END),0) outflow
       FROM account_txns t JOIN accounts a ON a.id=t.account_id
       WHERE t.business_id=? AND t.created_at>=? AND t.created_at<=?
       GROUP BY a.id ORDER BY a.type, a.name`
    )
    .all(businessId, r.from, r.to) as Array<{ id: string; name: string; type: string; provider: string | null; inflow: number; outflow: number }>
  const totals = rows.reduce((acc: { inflow: number; outflow: number }, x) => ({ inflow: acc.inflow + x.inflow, outflow: acc.outflow + x.outflow }), { inflow: 0, outflow: 0 })
  return { rows, inflow: totals.inflow, outflow: totals.outflow, net: totals.inflow - totals.outflow }
}

export function lowStockReport(db: DB, businessId: string) {
  return db
    .prepare(
      `SELECT p.id, p.name, p.sku, p.stock, p.min_stock, p.reorder_level, c.name category,
              (SELECT COALESCE(SUM(qty),0) FROM stock_movements m WHERE m.product_id=p.id AND m.type='sale' AND m.created_at>=?) sold_30d
       FROM products p LEFT JOIN categories c ON c.id=p.category_id
       WHERE p.business_id=? AND p.status='active' AND p.track_stock=1 AND p.stock <= p.min_stock
       ORDER BY (p.min_stock - p.stock) DESC`
    )
    .all(Date.now() - 30 * 86_400_000, businessId)
}

export function outOfStockReport(db: DB, businessId: string) {
  return db
    .prepare(
      `SELECT p.id, p.name, p.sku, p.min_stock, c.name category FROM products p
       LEFT JOIN categories c ON c.id=p.category_id
       WHERE p.business_id=? AND p.status='active' AND p.track_stock=1 AND p.stock<=0 ORDER BY p.name`
    )
    .all(businessId)
}

export function stockValuationByCategory(db: DB, businessId: string) {
  return db
    .prepare(
      `SELECT COALESCE(c.name,'অন্যান্য') category, SUM(p.stock*p.wac) at_cost, SUM(CASE WHEN p.stock>0 THEN p.stock*p.selling_price ELSE 0 END) at_price, SUM(p.stock) qty
       FROM products p LEFT JOIN categories c ON c.id=p.category_id
       WHERE p.business_id=? AND p.status='active' GROUP BY c.name ORDER BY at_cost DESC`
    )
    .all(businessId)
}

export function expiryReport(db: DB, businessId: string, withinDays: number) {
  const until = Date.now() + withinDays * 86_400_000
  return db
    .prepare(
      `SELECT p.id, p.name, p.stock, p.expiry_date FROM products p
       WHERE p.business_id=? AND p.status='active' AND p.expiry_date IS NOT NULL AND p.expiry_date<=? AND p.stock>0
       ORDER BY p.expiry_date ASC`
    )
    .all(businessId, until)
}

export function mfsSummary(db: DB, businessId: string, r: Range) {
  return db
    .prepare(
      `SELECT provider,
              COALESCE(SUM(CASE WHEN txn_type='cash_in' THEN amount END),0) cash_in,
              COALESCE(SUM(CASE WHEN txn_type IN ('cash_out','send_money') THEN amount END),0) cash_out,
              COALESCE(SUM(commission),0) commission,
              COALESCE(SUM(service_charge),0) charges,
              COUNT(*) count
       FROM mfs_txns WHERE business_id=? AND date>=? AND date<=? AND txn_type<>'adjustment'
       GROUP BY provider ORDER BY provider`
    )
    .all(businessId, r.from, r.to)
}
