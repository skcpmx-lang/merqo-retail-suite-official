import type { DB } from '../db/connection'
import { profitLoss, dailySeries, topProducts } from './reports'

function dayBounds(offsetDays = 0): { from: number; to: number } {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() - offsetDays)
  return { from: d.getTime(), to: d.getTime() + 86_400_000 - 1 }
}

export function dashboard(db: DB, businessId: string) {
  const today = dayBounds()
  const yest = dayBounds(1)
  const monthStart = new Date()
  monthStart.setDate(1)
  monthStart.setHours(0, 0, 0, 0)
  const month = { from: monthStart.getTime(), to: Date.now() }
  const t30 = { from: today.from - 29 * 86_400_000, to: today.to }

  const plToday = profitLoss(db, businessId, today)
  const plYest = profitLoss(db, businessId, yest)
  const plMonth = profitLoss(db, businessId, month)

  const dues = db
    .prepare(
      `SELECT
        COALESCE((SELECT SUM(receivable) FROM customers WHERE business_id=? AND status='active'),0) receivable,
        COALESCE((SELECT SUM(payable) FROM suppliers WHERE business_id=? AND status='active'),0) payable`
    )
    .get(businessId, businessId) as { receivable: number; payable: number }

  const todayDue = db
    .prepare(`SELECT COALESCE(SUM(due),0) v FROM sales WHERE business_id=? AND status<>'voided' AND date>=? AND date<=?`)
    .get(businessId, today.from, today.to) as { v: number }
  const todayCollect = db
    .prepare(`SELECT COALESCE(SUM(amount),0) v FROM payments WHERE business_id=? AND direction='in' AND ref_type='customer' AND date>=? AND date<=?`)
    .get(businessId, today.from, today.to) as { v: number }

  const accounts = db
    .prepare(`SELECT id, name, type, provider, balance FROM accounts WHERE business_id=? AND status='active' ORDER BY type, name`)
    .all(businessId) as Array<{ id: string; name: string; type: string; provider: string | null; balance: number }>
  const position = accounts.reduce(
    (a: { cash: number; bank: number; mfs: number; other: number }, x) => {
      if (x.type === 'cash') a.cash += x.balance
      else if (x.type === 'bank' || x.type === 'card') a.bank += x.balance
      else if (x.type === 'mfs') a.mfs += x.balance
      else a.other += x.balance
      return a
    },
    { cash: 0, bank: 0, mfs: 0, other: 0 }
  )

  const stock = db
    .prepare(
      `SELECT COALESCE(SUM(stock*wac),0) at_cost,
              SUM(CASE WHEN track_stock=1 AND stock<=0 THEN 1 ELSE 0 END) out_count,
              SUM(CASE WHEN track_stock=1 AND stock>0 AND stock<=min_stock THEN 1 ELSE 0 END) low_count
       FROM products WHERE business_id=? AND status='active'`
    )
    .get(businessId) as { at_cost: number; out_count: number; low_count: number }

  const recentSales = db
    .prepare(
      `SELECT s.id, s.invoice_no, s.customer_name, s.total, s.due, s.date, s.payment_method, u.name user_name
       FROM sales s LEFT JOIN users u ON u.id=s.user_id
       WHERE s.business_id=? AND s.status<>'voided' ORDER BY s.date DESC, s.rowid DESC LIMIT 8`
    )
    .all(businessId)

  const recentPurchases = db
    .prepare(
      `SELECT p.id, p.ref_no, s.name supplier_name, p.total, p.due, p.date
       FROM purchases p LEFT JOIN suppliers s ON s.id=p.supplier_id
       WHERE p.business_id=? AND p.status<>'voided' ORDER BY p.date DESC, p.rowid DESC LIMIT 5`
    )
    .all(businessId)

  const recentPayments = db
    .prepare(
      `SELECT p.id, p.voucher_no, p.party_name, p.party_type, p.direction, p.amount, p.method, p.date
       FROM payments p WHERE p.business_id=? AND p.ref_type IN ('customer','supplier') ORDER BY p.date DESC, p.rowid DESC LIMIT 6`
    )
    .all(businessId)

  const top = topProducts(db, businessId, { from: today.from - 6 * 86_400_000, to: today.to }, 5)

  const series = dailySeries(db, businessId, t30)

  const alerts: Array<{ type: string; severity: string; title: string; body?: string }> = []
  if (stock.out_count > 0) alerts.push({ type: 'out_of_stock', severity: 'critical', title: `${stock.out_count} পণ্যের স্টক শেষ` })
  if (stock.low_count > 0) alerts.push({ type: 'low_stock', severity: 'warning', title: `${stock.low_count} পণ্যের স্টক কম` })
  const bigDue = db.prepare(`SELECT c.name, c.receivable FROM customers c WHERE c.business_id=? AND c.receivable >= (SELECT CAST(value AS INTEGER) FROM settings WHERE business_id=? AND key='large_due_threshold' UNION SELECT 500000 WHERE NOT EXISTS (SELECT 1 FROM settings WHERE business_id=? AND key='large_due_threshold') LIMIT 1) ORDER BY c.receivable DESC LIMIT 3`).all(businessId, businessId, businessId) as Array<{ name: string; receivable: number }>
  for (const b of bigDue) alerts.push({ type: 'large_due', severity: 'warning', title: `${b.name} — বড় বকেয়া`, body: `৳${(b.receivable / 100).toLocaleString('en-IN')}` })

  return {
    today: {
      sales: plToday.revenue,
      sales_count: plToday.sales_count,
      cogs: plToday.cogs,
      gross_profit: plToday.gross_profit,
      expenses: plToday.expenses,
      net_profit: plToday.net_profit,
      due: todayDue.v,
      collected: todayCollect.v
    },
    yesterday: { sales: plYest.revenue, gross_profit: plYest.gross_profit },
    month: { sales: plMonth.revenue, gross_profit: plMonth.gross_profit, expenses: plMonth.expenses, net_profit: plMonth.net_profit },
    dues,
    position: { ...position, total: (position.cash + position.bank + position.mfs + position.other) as number },
    stock,
    recent: { sales: recentSales, purchases: recentPurchases, payments: recentPayments },
    top_products: top,
    series,
    alerts
  }
}
