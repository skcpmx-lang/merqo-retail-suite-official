import type { DB } from '../db/connection'
import { newId, now } from '../ids'

/** Typed settings with defaults. Values are stored as JSON strings. */
export const SETTING_DEFAULTS = {
  invoice_prefix: 'INV',
  invoice_padding: 6,
  receipt_prefix: 'RCP',
  receipt_padding: 6,
  purchase_prefix: 'PUR',
  return_prefix: 'RET',
  expense_prefix: 'EXP',
  voucher_prefix: 'VCH',
  vat_enabled: false,
  vat_percent: 0,
  vat_mode: 'exclusive' as 'exclusive' | 'inclusive',
  allow_negative_stock: false,
  allow_decimal_qty: true,
  low_stock_alert_default: 5,
  large_due_threshold: 5000_00, // 5000 tk poisha
  expiry_alert_days: 30,
  session_idle_minutes: 480,
  session_absolute_days: 7,
  login_max_attempts: 5,
  lockout_minutes: 10,
  backup_keep: 10,
  backup_auto_daily: true,
  expense_approval_required: false,
  invoice_footer: 'কেনার জন্য ধন্যবাদ!',
  receipt_footer: 'কেনার জন্য ধন্যবাদ!',
  invoice_template: 'a4',
  receipt_paper: '80mm',
  default_printer: '',
  default_payment_methods: JSON.stringify(['cash', 'bkash', 'nagad', 'rocket', 'upay', 'bank', 'card', 'cheque', 'other']),
  mfs_commission_cash_in_bps: 0, // per-provider basis points, configurable
  mfs_commission_cash_out_bps: 0,
  dashboard_widgets: '[]',
  notifications_prefs: '[]'
}

export type SettingKey = keyof typeof SETTING_DEFAULTS | (string & {})

export function getSetting<T = unknown>(db: DB, businessId: string, key: SettingKey): T {
  const row = db.prepare(`SELECT value FROM settings WHERE business_id=? AND key=?`).get(businessId, key) as { value: string } | undefined
  if (!row) return (SETTING_DEFAULTS as Record<string, unknown>)[key] as T
  try {
    return JSON.parse(row.value) as T
  } catch {
    return row.value as unknown as T
  }
}

export function setSetting(db: DB, businessId: string, key: SettingKey, value: unknown): void {
  db.prepare(
    `INSERT INTO settings (business_id, key, value) VALUES (?,?,?)
     ON CONFLICT(business_id, key) DO UPDATE SET value=excluded.value`
  ).run(businessId, key, JSON.stringify(value ?? null))
}

export function getAllSettings(db: DB, businessId: string): Record<string, unknown> {
  const rows = db.prepare(`SELECT key, value FROM settings WHERE business_id=?`).all(businessId) as Array<{ key: string; value: string }>
  const out: Record<string, unknown> = { ...SETTING_DEFAULTS }
  for (const r of rows) {
    try {
      out[r.key] = JSON.parse(r.value)
    } catch {
      out[r.key] = r.value
    }
  }
  return out
}

/** Atomic document-number allocator: INV-000001 style. */
export function nextNumber(db: DB, businessId: string, kind: 'invoice' | 'receipt' | 'purchase' | 'return' | 'expense' | 'voucher'): string {
  const prefixMap: Record<string, SettingKey> = {
    invoice: 'invoice_prefix',
    receipt: 'receipt_prefix',
    purchase: 'purchase_prefix',
    return: 'return_prefix',
    expense: 'expense_prefix',
    voucher: 'voucher_prefix'
  }
  const padMap: Record<string, SettingKey> = {
    invoice: 'invoice_padding',
    receipt: 'receipt_padding',
    purchase: 'invoice_padding',
    return: 'invoice_padding',
    expense: 'invoice_padding',
    voucher: 'invoice_padding'
  }
  const prefix = getSetting<string>(db, businessId, prefixMap[kind]) || 'NO'
  const pad = Number(getSetting<number>(db, businessId, padMap[kind])) || 6
  const row = db
    .prepare(`INSERT INTO counters (business_id, key, value) VALUES (?, ?, 1)
              ON CONFLICT(business_id, key) DO UPDATE SET value = value + 1
              RETURNING value`)
    .get(businessId, `num_${kind}`) as { value: number }
  return `${prefix}-${String(row.value).padStart(pad, '0')}`
}

export function seedBusinessDefaults(db: DB, businessId: string): void {
  // default units
  const units: Array<[string, string, number]> = [
    ['পিস', 'pcs', 0],
    ['কেজি', 'kg', 1],
    ['গ্রাম', 'gm', 1],
    ['লিটার', 'ltr', 1],
    ['মিলিলিটার', 'ml', 1],
    ['প্যাকেট', 'pkt', 0],
    ['ডজন', 'dz', 0],
    ['বস্তা', 'bag', 0],
    ['কার্টন', 'ctn', 0],
    ['ফুট', 'ft', 1]
  ]
  const ins = db.prepare(`INSERT OR IGNORE INTO units (id, business_id, name, short, allow_decimal, status, created_at) VALUES (?,?,?,?,?,'active',?)`)
  for (const [name, short, dec] of units) ins.run(newId(), businessId, name, short, dec, now())

  // default expense categories
  const cats = ['দোকান ভাড়া', 'বিদ্যুৎ বিল', 'ইন্টারনেট', 'পরিবহন', 'স্টাফ বেতন', 'সংস্কার', 'প্যাকেজিং', 'ডেলিভারি', 'বিবিধ']
  const insC = db.prepare(`INSERT OR IGNORE INTO expense_categories (id, business_id, name, status, created_at) VALUES (?,?,?,'active',?)`)
  for (const c of cats) insC.run(newId(), businessId, c, now())
}
