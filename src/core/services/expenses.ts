import type { DB } from '../db/connection'
import { newId, now } from '../ids'
import { CoreError, postEntry } from './accounts'
import { audit, type AuditCtx } from './audit'
import { nextNumber } from './settings'

export interface ExpenseInput {
  category_id?: string | null
  title: string
  amount: number
  account_id: string
  method?: string
  date?: number
  reference?: string
  note?: string
}

export function createExpense(db: DB, ctx: AuditCtx, businessId: string, input: ExpenseInput) {
  if (!input.title?.trim()) throw new CoreError('TITLE_REQUIRED', 'খরচের বিষয় লিখুন।')
  const amount = Math.round(input.amount)
  if (!(amount > 0)) throw new CoreError('BAD_AMOUNT', 'খরচের পরিমাণ সঠিক নয়।')
  const acc = db.prepare(`SELECT id, name, balance FROM accounts WHERE id=? AND business_id=? AND status='active'`).get(input.account_id, businessId) as { id: string; name: string; balance: number } | undefined
  if (!acc) throw new CoreError('ACCOUNT_NOT_FOUND', 'হিসাব নির্বাচন করুন।')
  if (acc.balance < amount) throw new CoreError('INSUFFICIENT_BALANCE', `"${acc.name}" হিসাবে পর্যাপ্ত ব্যালেন্স নেই।`)
  if (input.category_id) {
    const cat = db.prepare(`SELECT 1 FROM expense_categories WHERE id=? AND business_id=?`).get(input.category_id, businessId)
    if (!cat) throw new CoreError('CATEGORY_NOT_FOUND', 'খরচের খাত পাওয়া যায়নি।')
  }
  const t = input.date ?? now()
  const id = newId()
  const no = nextNumber(db, businessId, 'expense')
  db.prepare(
    `INSERT INTO expenses (id, business_id, category_id, title, amount, account_id, method, date, reference, note, status, user_id, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?, 'approved', ?, ?)`
  ).run(id, businessId, input.category_id ?? null, input.title.trim(), amount, input.account_id, input.method ?? 'cash', t, input.reference ?? null, input.note ?? null, ctx.userId ?? null, now())
  postEntry(db, { accountId: input.account_id, amount: -amount, type: 'expense', refType: 'expense', refId: id, note: input.title.trim(), userId: ctx.userId, date: t })
  audit(db, { ...ctx, businessId }, 'expense.create', 'expense', id, null, { title: input.title, amount, category: input.category_id })
  return { id, no }
}

export function voidExpense(db: DB, ctx: AuditCtx, businessId: string, id: string, reason: string) {
  const e = db.prepare(`SELECT * FROM expenses WHERE id=? AND business_id=?`).get(id, businessId) as
    | { id: string; title: string; amount: number; account_id: string; status: string }
    | undefined
  if (!e) throw new CoreError('NOT_FOUND', 'খরচটি পাওয়া যায়নি।')
  if (e.status === 'voided') throw new CoreError('ALREADY_VOID', 'এই খরচটি আগেই বাতিল।')
  if (!reason?.trim()) throw new CoreError('REASON_REQUIRED', 'বাতিলের কারণ লিখুন।')
  db.prepare(`UPDATE expenses SET status='voided' WHERE id=?`).run(id)
  postEntry(db, { accountId: e.account_id, amount: e.amount, type: 'void', refType: 'expense', refId: id, note: `খরচ বাতিল: ${reason.trim()}`, userId: ctx.userId })
  audit(db, { ...ctx, businessId }, 'expense.void', 'expense', id, e, null, reason.trim())
}

export function listExpenses(db: DB, businessId: string, q: { from?: number; to?: number; category_id?: string; account_id?: string; search?: string; page: number; pageSize: number }) {
  const where: string[] = ["e.business_id = ? AND e.status <> 'voided'"]
  const args: unknown[] = [businessId]
  if (q.from) { where.push('e.date >= ?'); args.push(q.from) }
  if (q.to) { where.push('e.date <= ?'); args.push(q.to) }
  if (q.category_id) { where.push('e.category_id = ?'); args.push(q.category_id) }
  if (q.account_id) { where.push('e.account_id = ?'); args.push(q.account_id) }
  if (q.search) { where.push('(e.title LIKE ? OR e.reference LIKE ?)'); const like = `%${q.search}%`; args.push(like, like) }
  const w = where.join(' AND ')
  const total = (db.prepare(`SELECT COUNT(*) c FROM expenses e WHERE ${w}`).get(...args) as { c: number }).c
  const rows = db
    .prepare(
      `SELECT e.*, c.name AS category_name, a.name AS account_name, u.name AS user_name
       FROM expenses e
       LEFT JOIN expense_categories c ON c.id = e.category_id
       LEFT JOIN accounts a ON a.id = e.account_id
       LEFT JOIN users u ON u.id = e.user_id
       WHERE ${w} ORDER BY e.date DESC, e.rowid DESC LIMIT ? OFFSET ?`
    )
    .all(...args, q.pageSize, (q.page - 1) * q.pageSize)
  const sums = db.prepare(`SELECT COALESCE(SUM(e.amount),0) total FROM expenses e WHERE ${w}`).get(...args) as { total: number }
  return { rows, total, sums }
}

export function listExpenseCategories(db: DB, businessId: string) {
  return db.prepare(`SELECT * FROM expense_categories WHERE business_id=? AND status='active' ORDER BY name`).all(businessId)
}

export function createExpenseCategory(db: DB, ctx: AuditCtx, businessId: string, name: string) {
  if (!name?.trim()) throw new CoreError('NAME_REQUIRED', 'খাতের নাম দিন।')
  const dup = db.prepare(`SELECT 1 FROM expense_categories WHERE business_id=? AND name=?`).get(businessId, name.trim())
  if (dup) throw new CoreError('DUPLICATE', 'এই নামে খাত আছে।')
  const id = newId()
  db.prepare(`INSERT INTO expense_categories (id, business_id, name, status, created_at) VALUES (?,?,?,'active',?)`).run(id, businessId, name.trim(), now())
  audit(db, { ...ctx, businessId }, 'expense_category.create', 'expense_category', id, null, { name })
  return id
}
