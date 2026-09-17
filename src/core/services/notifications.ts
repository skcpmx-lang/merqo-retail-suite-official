import type { DB } from '../db/connection'
import { newId, now } from '../ids'
import { getSetting } from './settings'

/**
 * Meaningful, de-duplicated notifications — raised by real business events,
 * never per-insignificant-event noise. dedup_key prevents repeats (e.g. one
 * low-stock notification per product per 24h window: key includes day bucket).
 */

export type Severity = 'info' | 'warning' | 'critical'

export function notify(
  db: DB,
  businessId: string,
  input: { type: string; severity?: Severity; title: string; body?: string; refType?: string; refId?: string; dedupKey?: string }
): void {
  try {
    db.prepare(
      `INSERT INTO notifications (id, business_id, type, severity, title, body, ref_type, ref_id, dedup_key, is_read, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,0,?)`
    ).run(newId(), businessId, input.type, input.severity ?? 'info', input.title, input.body ?? null, input.refType ?? null, input.refId ?? null, input.dedupKey ?? null, now())
  } catch {
    // unique(dedup_key) hit — notification already raised; silence is correct
  }
}

function dayBucket(): string {
  return String(Math.floor(Date.now() / 86_400_000))
}

/** Evaluate stock + due + expiry rules after transactions. Cheap, indexed queries. */
export function runNotificationRules(db: DB, businessId: string, productIds?: string[]): void {
  const bucket = dayBucket()
  const ids = productIds?.length ? productIds : null
  if (ids) {
    const q = db.prepare(
      `SELECT id, name, stock, min_stock FROM products WHERE business_id=? AND status='active' AND track_stock=1 AND id IN (${ids.map(() => '?').join(',')})`
    )
    for (const p of q.all(businessId, ...ids) as Array<{ id: string; name: string; stock: number; min_stock: number }>) {
      checkStock(db, businessId, p, bucket)
    }
  } else {
    for (const p of db
      .prepare(`SELECT id, name, stock, min_stock FROM products WHERE business_id=? AND status='active' AND track_stock=1 AND stock<=min_stock`)
      .all(businessId) as Array<{ id: string; name: string; stock: number; min_stock: number }>) {
      checkStock(db, businessId, p, bucket)
    }
  }

  // large customer dues
  const threshold = getSetting<number>(db, businessId, 'large_due_threshold') ?? 5000_00
  const bigDues = db
    .prepare(`SELECT id, name, receivable FROM customers WHERE business_id=? AND receivable>=? ORDER BY receivable DESC LIMIT 5`)
    .all(businessId, threshold) as Array<{ id: string; name: string; receivable: number }>
  for (const c of bigDues) {
    notify(db, businessId, {
      type: 'large_due',
      severity: 'warning',
      title: `${c.name} — বড় বকেয়া`,
      body: `মোট বকেয়া ৳${(c.receivable / 100).toLocaleString('en-IN')}`,
      refType: 'customer',
      refId: c.id,
      dedupKey: `due:${c.id}:${bucket}`
    })
  }

  // expiring products
  const days = getSetting<number>(db, businessId, 'expiry_alert_days') ?? 30
  const until = Date.now() + days * 86_400_000
  const expiring = db
    .prepare(`SELECT id, name, expiry_date FROM products WHERE business_id=? AND status='active' AND expiry_date IS NOT NULL AND expiry_date<=? AND stock>0 LIMIT 10`)
    .all(businessId, until) as Array<{ id: string; name: string; expiry_date: number }>
  for (const p of expiring) {
    notify(db, businessId, {
      type: 'expiry',
      severity: 'warning',
      title: `${p.name} — মেয়াদ শেষ হচ্ছে`,
      body: `মেয়াদ: ${new Date(p.expiry_date).toLocaleDateString('bn-BD')}`,
      refType: 'product',
      refId: p.id,
      dedupKey: `expiry:${p.id}:${bucket}`
    })
  }
}

function checkStock(db: DB, businessId: string, p: { id: string; name: string; stock: number; min_stock: number }, bucket: string) {
  if (p.stock <= 0) {
    notify(db, businessId, { type: 'out_of_stock', severity: 'critical', title: `${p.name} — স্টক শেষ`, refType: 'product', refId: p.id, dedupKey: `oos:${p.id}:${bucket}` })
  } else if (p.min_stock > 0 && p.stock <= p.min_stock) {
    notify(db, businessId, { type: 'low_stock', severity: 'warning', title: `${p.name} — স্টক কম`, body: `বর্তমান স্টক ${p.stock}, সর্বনিম্ন ${p.min_stock}`, refType: 'product', refId: p.id, dedupKey: `low:${p.id}:${bucket}` })
  }
}

export function listNotifications(db: DB, businessId: string, q: { unreadOnly?: boolean; page: number; pageSize: number }) {
  const w = `business_id=? ${q.unreadOnly ? 'AND is_read=0' : ''}`
  const total = (db.prepare(`SELECT COUNT(*) c FROM notifications WHERE ${w}`).get(businessId) as { c: number }).c
  const unread = (db.prepare(`SELECT COUNT(*) c FROM notifications WHERE business_id=? AND is_read=0`).get(businessId) as { c: number }).c
  const rows = db
    .prepare(`SELECT * FROM notifications WHERE ${w} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
    .all(businessId, q.pageSize, (q.page - 1) * q.pageSize)
  return { rows, total, unread }
}

export function markRead(db: DB, businessId: string, id: string) {
  db.prepare(`UPDATE notifications SET is_read=1, read_at=? WHERE id=? AND business_id=?`).run(now(), id, businessId)
}

export function markAllRead(db: DB, businessId: string) {
  db.prepare(`UPDATE notifications SET is_read=1, read_at=? WHERE business_id=? AND is_read=0`).run(now(), businessId)
}

export function dismiss(db: DB, businessId: string, id: string) {
  db.prepare(`DELETE FROM notifications WHERE id=? AND business_id=?`).run(id, businessId)
}
