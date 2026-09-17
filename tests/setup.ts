import Database from 'better-sqlite3'
import { openDatabase } from '@core/db/connection'
import { startCore, DEFAULT_PORT, type CoreHandle } from '@core/index'
import * as staff from '@core/services/staff'
import * as biz from '@core/services/businesses'
import * as products from '@core/services/products'
import * as purchases from '@core/services/purchases'
import * as sales from '@core/services/sales'
import * as parties from '@core/services/parties'
import * as accounts from '@core/services/accounts'
import * as expenses from '@core/services/expenses'
import * as payments from '@core/services/payments'
import * as mfs from '@core/services/mfs'
import * as settings from '@core/services/settings'
import { setDbRef } from '@core/api/routes'

export { Database }

export interface World {
  db: Database.Database
  ownerId: string
  businessId: string
  cashId: string
  bankId: string
  bkashId: string
  cashierId: string
  product: (over?: Partial<products.ProductInput>) => products.ProductRow
}

/** Spin up a fully initialised in-memory world: owner, business, accounts, roles, a cashier. */
export function makeWorld(): World {
  const db = openDatabase(':memory:')
  setDbRef(db)
  const owner = staff.createUser(db, {}, { name: 'মালিক সাহেব', username: 'owner', password: 'secret1' })
  const business = biz.createBusiness(db, { userId: owner.id, userName: owner.name }, owner.id, {
    name: 'মেরকো সুপার শপ',
    accounts: [
      { name: 'ক্যাশ বক্স', type: 'cash', opening_balance: 100_000_00 },
      { name: 'City Bank', type: 'bank', opening_balance: 500_000_00 },
      { name: 'bKash এজেন্ট', type: 'mfs', provider: 'bkash', opening_balance: 50_000_00 }
    ]
  })
  const cashier = staff.createUser(db, {}, { name: 'ক্যাশিয়ার', username: 'cashier', password: 'secret1' })
  const roles = staff.listRoles(db, business.id) as Array<{ id: string; name: string }>
  const cashierRole = roles.find((r) => r.name === 'ক্যাশিয়ার')!
  staff.addMember(db, { userId: owner.id, businessId: business.id }, business.id, { user_id: cashier.id, role_id: cashierRole.id })

  const accs = accounts.listAccounts(db, business.id)
  const byName = (n: string) => accs.find((a) => a.name === n)!.id

  const product = (over: Partial<products.ProductInput> = {}) =>
    products.createProduct(db, { userId: owner.id, businessId: business.id }, business.id, {
      name: 'টেস্ট পণ্য',
      purchase_price: 80_00,
      selling_price: 100_00,
      ...over
    })

  return {
    db,
    ownerId: owner.id,
    businessId: business.id,
    cashId: byName('ক্যাশ বক্স'),
    bankId: byName('City Bank'),
    bkashId: byName('bKash এজেন্ট'),
    cashierId: cashier.id,
    product
  }
}

export function balance(w: World, accountId: string): number {
  return (w.db.prepare(`SELECT balance FROM accounts WHERE id=?`).get(accountId) as { balance: number }).balance
}

export function receivable(w: World, customerId: string): number {
  return (w.db.prepare(`SELECT receivable FROM customers WHERE id=?`).get(customerId) as { receivable: number }).receivable
}

export function payable(w: World, supplierId: string): number {
  return (w.db.prepare(`SELECT payable FROM suppliers WHERE id=?`).get(supplierId) as { payable: number }).payable
}

export function stock(w: World, productId: string): number {
  return (w.db.prepare(`SELECT stock FROM products WHERE id=?`).get(productId) as { stock: number }).stock
}

/** Assert the ledger cache never drifts from the append-only ledger truth. */
export function assertLedgerConsistent(w: World) {
  const rows = w.db
    .prepare(
      `SELECT a.id, a.balance, (SELECT balance_after FROM account_txns t WHERE t.account_id=a.id ORDER BY created_at DESC, rowid DESC LIMIT 1) last
       FROM accounts a WHERE a.business_id=?`
    )
    .all(w.businessId) as Array<{ id: string; balance: number; last: number | null }>
  for (const r of rows) {
    if (r.last != null && r.balance !== r.last) throw new Error(`ledger drift on account ${r.id}: cache=${r.balance} ledger=${r.last}`)
  }
}

export { sales, purchases, products, parties, accounts, expenses, payments, mfs, staff, settings, biz }
export { DEFAULT_PORT, startCore, type CoreHandle }
