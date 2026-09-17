import type { DB } from '../db/connection'

export interface SearchHit {
  type: 'product' | 'customer' | 'supplier' | 'sale' | 'purchase' | 'user' | 'account'
  id: string
  title: string
  subtitle: string
}

/** Global search across entities. Bengali + English both work — plain LIKE is
 *  correct for SQLite (case-insensitive ASCII) and fast with our indexes at
 *  retail scale; trigram/indexed-search complexity is unnecessary here. */
export function globalSearch(db: DB, businessId: string, term: string, limitPerType = 5): SearchHit[] {
  const q = term.trim()
  if (!q) return []
  const like = `%${q}%`
  const hits: SearchHit[] = []

  for (const p of db
    .prepare(`SELECT id, name, sku, stock, selling_price FROM products WHERE business_id=? AND status='active' AND (name LIKE ? OR sku LIKE ? OR barcode LIKE ?) LIMIT ?`)
    .all(businessId, like, like, like, limitPerType) as Array<{ id: string; name: string; sku: string | null; stock: number; selling_price: number }>) {
    hits.push({ type: 'product', id: p.id, title: p.name, subtitle: `SKU ${p.sku ?? '—'} · স্টক ${p.stock} · ৳${(p.selling_price / 100).toLocaleString('en-IN')}` })
  }
  for (const c of db
    .prepare(`SELECT id, name, phone, receivable FROM customers WHERE business_id=? AND status='active' AND (name LIKE ? OR phone LIKE ? OR code LIKE ?) LIMIT ?`)
    .all(businessId, like, like, like, limitPerType) as Array<{ id: string; name: string; phone: string | null; receivable: number }>) {
    hits.push({ type: 'customer', id: c.id, title: c.name, subtitle: `${c.phone ?? '—'} · বকেয়া ৳${(c.receivable / 100).toLocaleString('en-IN')}` })
  }
  for (const s of db
    .prepare(`SELECT id, name, phone, payable FROM suppliers WHERE business_id=? AND status='active' AND (name LIKE ? OR phone LIKE ? OR company LIKE ?) LIMIT ?`)
    .all(businessId, like, like, like, limitPerType) as Array<{ id: string; name: string; phone: string | null; payable: number }>) {
    hits.push({ type: 'supplier', id: s.id, title: s.name, subtitle: `${s.phone ?? '—'} · বকেয়া ৳${(s.payable / 100).toLocaleString('en-IN')}` })
  }
  for (const s of db
    .prepare(`SELECT id, invoice_no, customer_name, total, date FROM sales WHERE business_id=? AND status<>'voided' AND invoice_no LIKE ? ORDER BY date DESC LIMIT ?`)
    .all(businessId, like, limitPerType) as Array<{ id: string; invoice_no: string; customer_name: string | null; total: number; date: number }>) {
    hits.push({ type: 'sale', id: s.id, title: `চালান ${s.invoice_no}`, subtitle: `${s.customer_name ?? 'নগদ গ্রাহক'} · ৳${(s.total / 100).toLocaleString('en-IN')}` })
  }
  for (const p of db
    .prepare(`SELECT p.id, p.ref_no, s.name supplier_name, p.total, p.date FROM purchases p LEFT JOIN suppliers s ON s.id=p.supplier_id WHERE p.business_id=? AND p.status<>'voided' AND (p.ref_no LIKE ? OR s.name LIKE ?) ORDER BY p.date DESC LIMIT ?`)
    .all(businessId, like, like, limitPerType) as Array<{ id: string; ref_no: string | null; supplier_name: string; total: number; date: number }>) {
    hits.push({ type: 'purchase', id: p.id, title: `ক্রয় ${p.ref_no ?? ''}`.trim(), subtitle: `${p.supplier_name} · ৳${(p.total / 100).toLocaleString('en-IN')}` })
  }
  for (const u of db
    .prepare(`SELECT id, name, username FROM users WHERE (name LIKE ? OR username LIKE ?) LIMIT ?`)
    .all(like, like, 3) as Array<{ id: string; name: string; username: string }>) {
    hits.push({ type: 'user', id: u.id, title: u.name, subtitle: `@${u.username}` })
  }
  for (const a of db
    .prepare(`SELECT id, name, balance FROM accounts WHERE business_id=? AND status='active' AND name LIKE ? LIMIT 3`)
    .all(businessId, like) as Array<{ id: string; name: string; balance: number }>) {
    hits.push({ type: 'account', id: a.id, title: a.name, subtitle: `ব্যালেন্স ৳${(a.balance / 100).toLocaleString('en-IN')}` })
  }
  return hits
}
