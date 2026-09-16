import type { DB } from '../db/connection'
import { newId, now } from '../ids'
import { CoreError, postEntry } from './accounts'
import { audit, type AuditCtx } from './audit'
import { getSetting, type SettingKey } from './settings'

/**
 * MFS Agent module.
 *
 * Agent economics (correct, separate from retail P&L):
 *  - cash_out: customer hands X cash, agent transfers X from agent balance.
 *      cash account −X·(1+fee%) … actually customer pays amount+charge;
 *      cash += amount + service_charge; agent balance −= amount.
 *  - cash_in: customer hands X cash to load into MFS.
 *      cash −= X; agent balance += X. Commission (earned from provider,
 *      usually accrued) is recorded when claimed: commission txn credits
 *      the chosen account and books MFS income.
 *  - service_charge collected on cash_out is agent income (revenue).
 *
 * Commission defaults are configurable per business (basis points) but never
 * hard-coded law — the agent may always override the amount for a txn.
 */

export interface MfsTxnInput {
  provider: string
  txn_type: 'cash_in' | 'cash_out' | 'send_money' | 'payment' | 'commission' | 'adjustment'
  account_id: string // the MFS agent account
  counter_account_id?: string | null // cash drawer side
  amount: number
  commission?: number
  service_charge?: number
  customer_phone?: string
  reference_no?: string
  note?: string
  date?: number
}

export function createMfsTxn(db: DB, ctx: AuditCtx, businessId: string, input: MfsTxnInput) {
  const acc = db.prepare(`SELECT id, name, balance, provider FROM accounts WHERE id=? AND business_id=? AND status='active'`).get(input.account_id, businessId) as
    | { id: string; name: string; balance: number; provider: string | null }
    | undefined
  if (!acc) throw new CoreError('ACCOUNT_NOT_FOUND', 'এজেন্ট হিসাব নির্বাচন করুন।')
  const amount = Math.round(input.amount)
  if (!(amount > 0)) throw new CoreError('BAD_AMOUNT', 'লেনদেনের পরিমাণ সঠিক নয়।')
  const commission = Math.max(0, Math.round(input.commission ?? 0))
  const charge = Math.max(0, Math.round(input.service_charge ?? 0))
  const t = input.date ?? now()

  let counterId = input.counter_account_id ?? null
  if (input.txn_type === 'cash_in' || input.txn_type === 'cash_out' || input.txn_type === 'send_money') {
    if (!counterId) throw new CoreError('COUNTER_REQUIRED', 'ক্যাশ হিসাব নির্বাচন করুন।')
    const counter = db.prepare(`SELECT id FROM accounts WHERE id=? AND business_id=? AND status='active'`).get(counterId, businessId)
    if (!counter) throw new CoreError('ACCOUNT_NOT_FOUND', 'ক্যাশ হিসাব পাওয়া যায়নি।')
  }

  const id = newId()
  const apply = db.transaction(() => {
    if (input.txn_type === 'cash_in') {
      // customer → MFS: cash leaves drawer, enters agent balance
      postEntry(db, { accountId: acc.id, amount: amount, type: 'mfs_cash_in', refType: 'mfs', refId: id, note: `ক্যাশ-ইন ${input.customer_phone ?? ''}`, userId: ctx.userId, date: t })
      postEntry(db, { accountId: counterId!, amount: -amount, type: 'mfs_cash_in', refType: 'mfs', refId: id, note: `ক্যাশ-ইন ${input.customer_phone ?? ''}`, userId: ctx.userId, date: t })
    } else if (input.txn_type === 'cash_out' || input.txn_type === 'send_money') {
      // MFS → customer: agent balance decreases, cash arrives (+ service charge is income)
      if (acc.balance < amount) throw new CoreError('INSUFFICIENT_BALANCE', `"${acc.name}" হিসাবে পর্যাপ্ত ব্যালেন্স নেই।`)
      postEntry(db, { accountId: acc.id, amount: -amount, type: 'mfs_cash_out', refType: 'mfs', refId: id, note: `${input.txn_type === 'cash_out' ? 'ক্যাশ-আউট' : 'সেন্ড মানি'} ${input.customer_phone ?? ''}`, userId: ctx.userId, date: t })
      postEntry(db, { accountId: counterId!, amount: amount + charge, type: 'mfs_cash_out', refType: 'mfs', refId: id, note: `${input.txn_type === 'cash_out' ? 'ক্যাশ-আউট' : 'সেন্ড মানি'}${charge ? ` (চার্জ ৳${(charge / 100).toFixed(2)})` : ''}`, userId: ctx.userId, date: t })
    } else if (input.txn_type === 'commission') {
      // provider pays commission into the chosen account (usually the agent account)
      if (!(commission > 0)) throw new CoreError('BAD_AMOUNT', 'কমিশনের পরিমাণ দিন।')
      postEntry(db, { accountId: acc.id, amount: commission, type: 'mfs_commission', refType: 'mfs', refId: id, note: 'কমিশন প্রাপ্তি', userId: ctx.userId, date: t })
    } else if (input.txn_type === 'payment') {
      // customer hands cash; the agent wallet pays the biller. Wallet −X, drawer +(X+charge).
      if (acc.balance < amount) throw new CoreError('INSUFFICIENT_BALANCE', `"${acc.name}" হিসাবে পর্যাপ্ত ব্যালেন্স নেই।`)
      postEntry(db, { accountId: acc.id, amount: -amount, type: 'mfs_payment', refType: 'mfs', refId: id, note: `পেমেন্ট ${input.customer_phone ?? ''}`, userId: ctx.userId, date: t })
      if (counterId) postEntry(db, { accountId: counterId, amount: amount + charge, type: 'mfs_payment', refType: 'mfs', refId: id, note: `পেমেন্ট${charge ? ` (চার্জ ৳${(charge / 100).toFixed(2)})` : ''}`, userId: ctx.userId, date: t })
    } else if (input.txn_type === 'adjustment') {
      if (charge) throw new CoreError('BAD_ADJUSTMENT', 'সমন্বয়ে চার্জ প্রযোজ্য নয়।')
      postEntry(db, { accountId: acc.id, amount: amount, type: 'mfs_adjustment', refType: 'mfs', refId: id, note: input.note ?? 'ব্যালেন্স সমন্বয়', userId: ctx.userId, date: t })
    }
    db.prepare(
      `INSERT INTO mfs_txns (id, business_id, provider, txn_type, account_id, counter_account_id, amount, commission, service_charge, customer_phone, reference_no, note, date, user_id, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(
      id, businessId, input.provider, input.txn_type, input.account_id, counterId, amount,
      input.txn_type === 'commission' ? commission : 0, charge, input.customer_phone ?? null,
      input.reference_no ?? null, input.note ?? null, t, ctx.userId ?? null, now()
    )
  })
  apply()

  audit(db, { ...ctx, businessId }, 'mfs.txn', 'mfs_txn', id, null, { provider: input.provider, type: input.txn_type, amount, commission, charge })
  return { id }
}

export function listMfsTxns(db: DB, businessId: string, q: { from?: number; to?: number; provider?: string; txn_type?: string; account_id?: string; page: number; pageSize: number }) {
  const where: string[] = ['m.business_id = ?']
  const args: unknown[] = [businessId]
  if (q.from) { where.push('m.date >= ?'); args.push(q.from) }
  if (q.to) { where.push('m.date <= ?'); args.push(q.to) }
  if (q.provider) { where.push('m.provider = ?'); args.push(q.provider) }
  if (q.txn_type) { where.push('m.txn_type = ?'); args.push(q.txn_type) }
  if (q.account_id) { where.push('m.account_id = ?'); args.push(q.account_id) }
  const w = where.join(' AND ')
  const total = (db.prepare(`SELECT COUNT(*) c FROM mfs_txns m WHERE ${w}`).get(...args) as { c: number }).c
  const rows = db
    .prepare(
      `SELECT m.*, a.name AS account_name, ca.name AS counter_account_name, u.name AS user_name
       FROM mfs_txns m
       LEFT JOIN accounts a ON a.id = m.account_id
       LEFT JOIN accounts ca ON ca.id = m.counter_account_id
       LEFT JOIN users u ON u.id = m.user_id
       WHERE ${w} ORDER BY m.date DESC, m.rowid DESC LIMIT ? OFFSET ?`
    )
    .all(...args, q.pageSize, (q.page - 1) * q.pageSize)
  const sums = db
    .prepare(
      `SELECT
        COALESCE(SUM(CASE WHEN txn_type='cash_in' THEN amount END),0) cash_in,
        COALESCE(SUM(CASE WHEN txn_type IN ('cash_out','send_money') THEN amount END),0) cash_out,
        COALESCE(SUM(commission),0) commission,
        COALESCE(SUM(service_charge),0) charges
       FROM mfs_txns m WHERE ${w}`
    )
    .get(...args) as { cash_in: number; cash_out: number; commission: number; charges: number }
  return { rows, total, sums }
}

/** Suggested commission in poisha from business-configured rates (bps), never mandatory. */
export function suggestCommission(db: DB, businessId: string, provider: string, txnType: 'cash_in' | 'cash_out', amount: number): number {
  const key = (`mfs_commission_${provider}_${txn_type_key(txnType)}_bps`) as SettingKey
  let bps = getSetting<number>(db, businessId, key)
  if (bps == null) {
    bps = getSetting<number>(db, businessId, txnType === 'cash_in' ? 'mfs_commission_cash_in_bps' : 'mfs_commission_cash_out_bps')
  }
  return Math.round((amount * (bps ?? 0)) / 10000)
}

function txn_type_key(t: 'cash_in' | 'cash_out'): string {
  return t
}
