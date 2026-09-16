import type { DB } from '../db/connection'
import { newId, now } from '../ids'
import { audit, type AuditCtx } from './audit'

export type AccountType = 'cash' | 'bank' | 'card' | 'mfs' | 'other'
export type MfsProvider = 'bkash' | 'nagad' | 'rocket' | 'upay' | 'other'

export interface AccountRow {
  id: string
  name: string
  type: AccountType
  provider: string | null
  account_no: string | null
  agent_number: string | null
  note: string | null
  opening_balance: number
  balance: number
  is_system: number
  status: string
}

/**
 * Append a signed ledger entry (poisha) to an account and slide its cached balance.
 * MUST be invoked inside the caller's transaction.
 */
export function postEntry(
  db: DB,
  opts: {
    accountId: string
    amount: number // signed poisha (+in / −out)
    type: string
    refType?: string
    refId?: string
    note?: string
    userId?: string
    date?: number
  }
): { balanceAfter: number } {
  const acc = db.prepare(`SELECT balance, business_id FROM accounts WHERE id=?`).get(opts.accountId) as
    | { balance: number; business_id: string }
    | undefined
  if (!acc) throw new CoreError('ACCOUNT_NOT_FOUND', 'হিসাবটি পাওয়া যায়নি।')
  const balanceAfter = acc.balance + opts.amount
  db.prepare(`UPDATE accounts SET balance=? WHERE id=?`).run(balanceAfter, opts.accountId)
  db.prepare(
    `INSERT INTO account_txns (id, business_id, account_id, amount, balance_after, type, ref_type, ref_id, note, user_id, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`
  ).run(
    newId(), acc.business_id, opts.accountId, opts.amount, balanceAfter, opts.type,
    opts.refType ?? null, opts.refId ?? null, opts.note ?? null, opts.userId ?? null, opts.date ?? now()
  )
  return { balanceAfter }
}

export class CoreError extends Error {
  constructor(public code: string, public bn: string, public status = 400) {
    super(bn)
    this.name = 'CoreError'
  }
}

export function listAccounts(db: DB, businessId: string, includeArchived = false): AccountRow[] {
  return db
    .prepare(`SELECT * FROM accounts WHERE business_id=? ${includeArchived ? '' : `AND status='active'`} ORDER BY is_system DESC, type, name`)
    .all(businessId) as AccountRow[]
}

export function getAccount(db: DB, businessId: string, accountId: string): AccountRow {
  const acc = db.prepare(`SELECT * FROM accounts WHERE id=? AND business_id=?`).get(accountId, businessId) as AccountRow | undefined
  if (!acc) throw new CoreError('ACCOUNT_NOT_FOUND', 'হিসাবটি পাওয়া যায়নি।')
  return acc
}

export function createAccount(
  db: DB, ctx: AuditCtx, businessId: string,
  input: { name: string; type: AccountType; provider?: string; accountNo?: string; agentNumber?: string; note?: string; openingBalance?: number }
): AccountRow {
  return db.transaction(() => {
    const dup = db.prepare(`SELECT 1 FROM accounts WHERE business_id=? AND name=?`).get(businessId, input.name.trim())
    if (dup) throw new CoreError('DUPLICATE', 'এই নামে আরেকটি হিসাব আছে।')
    const id = newId()
    const opening = input.openingBalance ?? 0
    db.prepare(
      `INSERT INTO accounts (id, business_id, name, type, provider, account_no, agent_number, note, opening_balance, balance, is_system, status, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,0,0,'active',?)`
    ).run(id, businessId, input.name.trim(), input.type, input.provider ?? null, input.accountNo ?? null, input.agentNumber ?? null, input.note ?? null, opening, now())
    postEntry(db, { accountId: id, amount: opening, type: 'opening', note: 'শুরুর ব্যালেন্স', userId: ctx.userId })
    audit(db, { ...ctx, businessId }, 'account.create', 'account', id, null, { name: input.name, type: input.type, opening })
    return getAccount(db, businessId, id)
  })()
}

export function updateAccount(
  db: DB, ctx: AuditCtx, businessId: string, id: string,
  patch: { name?: string; type?: AccountType; provider?: string; accountNo?: string; agentNumber?: string; note?: string; status?: string }
): AccountRow {
  const before = getAccount(db, businessId, id)
  const next = { ...before, ...patch, name: patch.name?.trim() || before.name }
  if (patch.name && patch.name.trim() !== before.name) {
    const dup = db.prepare(`SELECT 1 FROM accounts WHERE business_id=? AND name=? AND id<>?`).get(businessId, patch.name.trim(), id)
    if (dup) throw new CoreError('DUPLICATE', 'এই নামে আরেকটি হিসাব আছে।')
  }
  db.prepare(
    `UPDATE accounts SET name=?, type=?, provider=?, account_no=?, agent_number=?, note=?, status=? WHERE id=? AND business_id=?`
  ).run(next.name, next.type, next.provider, next.account_no, next.agent_number, next.note, patch.status ?? before.status, id, businessId)
  audit(db, { ...ctx, businessId }, 'account.update', 'account', id, before, next)
  return getAccount(db, businessId, id)
}

/** Internal transfer — never touches revenue or expense. */
export function transferFunds(
  db: DB, ctx: AuditCtx, businessId: string,
  input: { from: string; to: string; amount: number; fee?: number; date?: number; note?: string }
): void {
  return db.transaction(() => {
    if (input.from === input.to) throw new CoreError('SAME_ACCOUNT', 'একই হিসাবে ট্রান্সফার করা যায় না।')
    if (input.amount <= 0) throw new CoreError('BAD_AMOUNT', 'ট্রান্সফারের পরিমাণ সঠিক নয়।')
    const from = getAccount(db, businessId, input.from)
    if (from.balance < input.amount + (input.fee ?? 0)) {
      throw new CoreError('INSUFFICIENT_BALANCE', `"${from.name}" হিসাবে পর্যাপ্ত ব্যালেন্স নেই।`)
    }
    const id = newId()
    const t = input.date ?? now()
    const fee = input.fee ?? 0
    postEntry(db, { accountId: input.from, amount: -(input.amount + fee), type: 'transfer_out', refType: 'transfer', refId: id, note: input.note, userId: ctx.userId, date: t })
    postEntry(db, { accountId: input.to, amount: input.amount, type: 'transfer_in', refType: 'transfer', refId: id, note: input.note, userId: ctx.userId, date: t })
    db.prepare(
      `INSERT INTO transfers (id, business_id, from_account, to_account, amount, fee, date, note, user_id, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`
    ).run(id, businessId, input.from, input.to, input.amount, fee, t, input.note ?? null, ctx.userId ?? null, now())
    audit(db, { ...ctx, businessId }, 'account.transfer', 'transfer', id, null, input)
  })()
}

export interface LedgerQuery {
  accountId?: string
  from?: number
  to?: number
  type?: string
  page: number
  pageSize: number
}

export function accountLedger(db: DB, businessId: string, q: LedgerQuery) {
  const where: string[] = [`t.business_id = ?`]
  const args: unknown[] = [businessId]
  if (q.accountId) { where.push(`t.account_id = ?`); args.push(q.accountId) }
  if (q.from) { where.push(`t.created_at >= ?`); args.push(q.from) }
  if (q.to) { where.push(`t.created_at <= ?`); args.push(q.to) }
  if (q.type) { where.push(`t.type = ?`); args.push(q.type) }
  const w = where.join(' AND ')
  const total = (db.prepare(`SELECT COUNT(*) c FROM account_txns t WHERE ${w}`).get(...args) as { c: number }).c
  const rows = db
    .prepare(
      `SELECT t.*, a.name AS account_name, a.type AS account_type FROM account_txns t
       JOIN accounts a ON a.id = t.account_id
       WHERE ${w} ORDER BY t.created_at DESC, t.rowid DESC LIMIT ? OFFSET ?`
    )
    .all(...args, q.pageSize, (q.page - 1) * q.pageSize)
  const totals = db
    .prepare(`SELECT COALESCE(SUM(CASE WHEN amount>0 THEN amount ELSE 0 END),0) inflow, COALESCE(SUM(CASE WHEN amount<0 THEN -amount ELSE 0 END),0) outflow FROM account_txns t WHERE ${w}`)
    .get(...args) as { inflow: number; outflow: number }
  return { rows, total, inflow: totals.inflow, outflow: totals.outflow }
}
