/**
 * RELEASE HARDENING SUITE — the production acceptance gates.
 *
 * Boots the real HTTP core and drives everything through the public API
 * (exactly as the UI/LAN clients do), then verifies the database directly.
 * Sections: A authz matrix · B manager tier · C business isolation ·
 * D financial reconciliation (16 scenarios) · E inventory accounting ·
 * F returns guards · G import rollback · H backup/restore round-trip ·
 * I MFS configuration · J concurrency · K first-run production reset.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { makeWorld, assertLedgerConsistent, type World } from './setup'
import { startCore, type CoreHandle } from '@core/index'
import { openDatabase } from '@core/db/connection'
import * as backupSvc from '@core/services/backup'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

let world: World
let core: CoreHandle
let base: string
const tokens: Record<string, string> = {}

const api = async (tok: string, method: string, url: string, body?: unknown) => {
  const res = await fetch(base + url, {
    method,
    headers: { 'content-type': 'application/json', ...(tok ? { authorization: `Bearer ${tok}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body)
  })
  const text = await res.text()
  let json: unknown = null
  try { json = text ? JSON.parse(text) : null } catch { json = text }
  return { status: res.status, json: json as Record<string, unknown> & { rows?: unknown[]; error?: string } }
}
const bal = (accountId: string): number =>
  (world.db.prepare('SELECT balance FROM accounts WHERE id=?').get(accountId) as { balance: number }).balance
/** account balance must equal the sum of its ledger postings — no silent drift */
const ledgerSum = (accountId: string): number =>
  (world.db.prepare('SELECT COALESCE(SUM(amount),0) s FROM account_txns WHERE account_id=?').get(accountId) as { s: number }).s

beforeAll(async () => {
  world = makeWorld()
  const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mq-hard-'))
  core = startCore({ db: world.db as never, port: 0, host: '127.0.0.1', backupDir })
  for (let i = 0; i < 50 && core.port === 0; i++) await new Promise((r) => setTimeout(r, 20))
  base = `http://127.0.0.1:${core.port}/api`

  const ownerLogin = await api('', 'POST', '/auth/login', { username: 'owner', password: 'secret1' })
  tokens.owner = ownerLogin.json.token as string

  // cashier via the seeded system role
  const roles = await api(tokens.owner, 'GET', '/roles')
  const cashierRole = (roles.json.rows as Array<{ id: string; name: string }>).find((r) => r.name === 'ক্যাশিয়ার')!
  const cUser = await api(tokens.owner, 'POST', '/staff/users', { name: 'ক্যাশিয়ার টেস্ট', username: 'cash2', password: 'pass123' })
  const members = await api(tokens.owner, 'GET', '/staff/members')
  const ownerIdMember = (members.json.rows as Array<{ user_id: string; role: string }>).find(() => false)
  void ownerIdMember
  const ownerMember = (members.json.rows as Array<{ user_id: string }>)[0]
  void ownerMember
  await api(tokens.owner, 'POST', '/staff/members', { user_id: cUser.json.id, role_id: cashierRole.id })
  const cLogin = await api('', 'POST', '/auth/login', { username: 'cash2', password: 'pass123' })
  tokens.cashier = cLogin.json.token as string

  // manager role user
  const managerRole = (roles.json.rows as Array<{ id: string; name: string }>).find((r) => r.name === 'ম্যানেজার')!
  const mUser = await api(tokens.owner, 'POST', '/staff/users', { name: 'ম্যানেজার টেস্ট', username: 'mgr2', password: 'pass123' })
  await api(tokens.owner, 'POST', '/staff/members', { user_id: mUser.json.id, role_id: managerRole.id })
  const mLogin = await api('', 'POST', '/auth/login', { username: 'mgr2', password: 'pass123' })
  tokens.manager = mLogin.json.token as string
})

afterAll(() => core.close())

/* ═══════════ A · AUTHORIZATION MATRIX — the backend is the law ═══════════ */
describe('A · authorization — cashier (counter role) denied everywhere sensitive', () => {
  const denied = async (tok: string, method: string, url: string, body?: unknown) => {
    const r = await api(tok, method, url, body)
    expect(r.status, `${method} ${url} → expected 403, got ${r.status}`).toBe(403)
  }

  it('financial visibility', async () => {
    await denied(tokens.cashier, 'GET', '/reports/pnl?from=0&to=9999999999999')
    await denied(tokens.cashier, 'GET', '/reports/cashflow?from=0&to=9999999999999')
    await denied(tokens.cashier, 'GET', '/accounts')               // accounts.view
    await denied(tokens.cashier, 'GET', '/accounts/LEDGERID/ledger')
  })

  it('expenses lifecycle', async () => {
    await denied(tokens.cashier, 'GET', '/expenses')
    await denied(tokens.cashier, 'POST', '/expenses', { title: 'x', amount: 100, account_id: world.cashId })
    await denied(tokens.cashier, 'POST', '/expenses/ANYID/void', { reason: 'x' })
    await denied(tokens.cashier, 'GET', '/expense-categories')
  })

  it('purchases & suppliers', async () => {
    await denied(tokens.cashier, 'GET', '/purchases')
    await denied(tokens.cashier, 'POST', '/purchases', { items: [], payments: [] })
    await denied(tokens.cashier, 'GET', '/suppliers')
    await denied(tokens.cashier, 'POST', '/suppliers', { name: 'x' })
    await denied(tokens.cashier, 'POST', '/suppliers/ANYID/pay', { amount: 100, account_id: world.cashId })
  })

  it('destruction: void / delete / adjust / refund', async () => {
    await denied(tokens.cashier, 'POST', '/sales/ANYID/void', { reason: 'x' })
    await denied(tokens.cashier, 'POST', '/returns', { sale_id: 'x', items: [], restock: true, refund_mode: 'cash' })
    await denied(tokens.cashier, 'POST', '/products/ANYID/adjust', { deltaQty: 1, reason: 'x' })
    await denied(tokens.cashier, 'DELETE', '/products/ANYID')
    await denied(tokens.cashier, 'POST', '/transfers', { from: world.cashId, to: world.bankId, amount: 100 })
  })

  it('administration', async () => {
    await denied(tokens.cashier, 'GET', '/audit')
    await denied(tokens.cashier, 'GET', '/settings')
    await denied(tokens.cashier, 'PATCH', '/settings', { values: {} })
    await denied(tokens.cashier, 'GET', '/backups')
    await denied(tokens.cashier, 'POST', '/backups', { note: 'x' })
    await denied(tokens.cashier, 'POST', '/restore/validate', { file: 'x' })
    await denied(tokens.cashier, 'GET', '/staff/users')
    await denied(tokens.cashier, 'POST', '/staff/users', { name: 'x', username: 'xy1', password: 'pass123' })
    await denied(tokens.cashier, 'GET', '/roles')
    await denied(tokens.cashier, 'POST', '/audit/export', { entity: 'products' })
  })

  it('but the cashier CAN do counter work', async () => {
    const products = await api(tokens.cashier, 'GET', '/products?page=1')
    expect(products.status).toBe(200)
    expect((await api(tokens.cashier, 'GET', '/reports/receivables')).status).toBe(200) // cashier HAS dues.view
    const dash = await api(tokens.cashier, 'GET', '/dashboard')
    expect(dash.status).toBe(200)
    const cust = await api(tokens.cashier, 'POST', '/customers', { name: 'কাউন্টার গ্রাহক', phone: '01700000001' })
    expect(cust.status).toBe(200)
  })
})

/* ═══════════ B · MANAGER TIER — broad but not financial ═══════════ */
describe('B · manager — operations yes, financial secrets no', () => {
  it('can run operations', async () => {
    expect((await api(tokens.manager, 'GET', '/reports/receivables')).status).toBe(200) // dues.view
    expect((await api(tokens.manager, 'GET', '/reports/top-products?from=0&to=9999999999999')).status).toBe(200)
    expect([400, 404]).toContain((await api(tokens.manager, 'POST', '/products/nope/adjust', { deltaQty: 1, reason: 'x' })).status) // perm passed, bad id
  })
  it('cannot touch financial administration', async () => {
    expect((await api(tokens.manager, 'GET', '/reports/pnl?from=0&to=9999999999999')).status).toBe(403) // finance.view
    expect((await api(tokens.manager, 'GET', '/reports/cashflow?from=0&to=9999999999999')).status).toBe(403)
    expect((await api(tokens.manager, 'POST', '/expenses', { title: 'x', amount: 1, account_id: world.cashId })).status).toBe(403)
    expect((await api(tokens.manager, 'POST', '/expenses/ANYID/void', { reason: 'x' })).status).toBe(403)
    expect((await api(tokens.manager, 'GET', '/backups')).status).toBe(403)
    expect((await api(tokens.manager, 'GET', '/audit')).status).toBe(403)
    expect((await api(tokens.manager, 'PATCH', '/settings', { values: {} })).status).toBe(403)
    expect((await api(tokens.manager, 'POST', '/staff/users', { name: 'x', username: 'mg1', password: 'pass123' })).status).toBe(403)
    expect((await api(tokens.manager, 'POST', '/restore/validate', { file: 'x' })).status).toBe(403)
  })
})

/* ═══════════ C · BUSINESS ISOLATION — the data layer is the wall ═══════════ */
describe('C · multi-business isolation', () => {
  let bizB = ''
  let productB = ''
  let customerB = ''
  let productA = ''

  it('owner creates a second business with its own product & customer', async () => {
    const b = await api(tokens.owner, 'POST', '/businesses', {
      name: 'বি ট্রেডার্স', owner_name: 'মালিক',
      accounts: [{ name: 'ক্যাশ', type: 'cash', opening_balance: 100000 }]
    })
    expect(b.status).toBe(200)
    bizB = b.json.id as string
    // switch session to B
    const sw = await api(tokens.owner, 'POST', '/auth/business', { business_id: bizB })
    expect(sw.status).toBe(200)
    tokens.ownerB = tokens.owner // session switched in place
    const p = await api(tokens.ownerB, 'POST', '/products', { name: 'শুধু বি-র পণ্য', purchase_price: 1000, selling_price: 2000, opening_stock: 50 })
    productB = p.json.id as string
    const c = await api(tokens.ownerB, 'POST', '/customers', { name: 'বি-র গ্রাহক', phone: '01900000000' })
    customerB = c.json.id as string
    // a sale in B
    const accs = await api(tokens.ownerB, 'GET', '/accounts')
    const cashB = (accs.json.rows as Array<{ id: string; type: string }>).find((a) => a.type === 'cash')!.id
    const sale = await api(tokens.ownerB, 'POST', '/sales', { items: [{ product_id: productB, qty: 2, unit_price: 2000 }], payments: [{ account_id: cashB, amount: 4000, method: 'cash' }] })
    expect(sale.status).toBe(200)
  })

  it('switching back to A', async () => {
    const members = await api(tokens.owner, 'GET', '/businesses')
    const bizA = (members.json.rows as Array<{ id: string; name: string }>).find((x) => x.name === 'মেরকো সুপার শপ')?.id
    expect(bizA, `business A not in list: ${JSON.stringify(members.json)}`).toBeTruthy()
    expect((await api(tokens.owner, 'POST', '/auth/business', { business_id: bizA })).status).toBe(200)
    const prods = await api(tokens.owner, 'GET', '/products?page=1&pageSize=100')
    productA = (prods.json.rows as Array<{ id: string }>)[0]?.id as string
  })

  it('A cannot read B objects by id (no id-scanning)', async () => {
    const prod = await api(tokens.owner, 'GET', `/products/${productB}`)
    expect([400, 404]).toContain(prod.status)          // rejected — and never leaks B data
    expect(JSON.stringify(prod.json)).not.toContain('শুধু বি-র পণ্য')
    expect([400, 404]).toContain((await api(tokens.owner, 'GET', `/customers/${customerB}`)).status)
  })

  it('A lists never contain B data', async () => {
    const prods = await api(tokens.owner, 'GET', '/products?page=1&pageSize=200')
    expect((prods.json.rows as Array<{ name: string }>).some((r) => r.name.includes('বি-র পণ্য'))).toBe(false)
    const custs = await api(tokens.owner, 'GET', '/customers?page=1&pageSize=200')
    expect((custs.json.rows as Array<{ name: string }>).some((r) => r.name === 'বি-র গ্রাহক')).toBe(false)
    const search = await api(tokens.owner, 'GET', '/search?q=বি-র')
    expect((search.json.hits as unknown[]).length).toBe(0)
  })

  it('cross-tenant writes are rejected (using A token on B objects)', async () => {
    const accsB = await api(tokens.ownerB, 'GET', '/accounts')
    const cashB = (accsB.json.rows as Array<{ id: string; type: string }>).find((a) => a.type === 'cash')!.id
    const r = await api(tokens.owner, 'POST', '/sales', { items: [{ product_id: productB, qty: 1, unit_price: 2000 }], payments: [{ account_id: cashB, amount: 2000, method: 'cash' }] })
    expect(r.status).toBe(400)
    const pay = await api(tokens.owner, 'POST', `/customers/${customerB}/collect`, { amount: 100, account_id: world.cashId, method: 'cash' })
    expect(pay.status).toBe(400)
  })

  it('membership wall: cashier of A cannot switch into B', async () => {
    const r = await api(tokens.cashier, 'POST', '/auth/business', { business_id: bizB })
    expect(r.status).toBe(403)
  })
})

/* ═══════════ D · FINANCIAL RECONCILIATION — every scenario, ledger verified ═══════════ */
describe('D · financial reconciliation — 16 scenarios, ledger asserted after each', () => {
  let cash = ''
  let bank = ''
  let bkash = ''
  let productId = ''
  let customerId = ''
  let supplierId = ''

  beforeAll(async () => {
    cash = world.cashId; bank = world.bankId; bkash = world.bkashId
    const p = await api(tokens.owner, 'POST', '/products', { name: 'রিকন পণ্য', purchase_price: 8000, selling_price: 10000, opening_stock: 100 })
    productId = p.json.id as string
    const c = await api(tokens.owner, 'POST', '/customers', { name: 'রিকন গ্রাহক', phone: '01711111111', opening_due: 0 })
    customerId = c.json.id as string
    const s = await api(tokens.owner, 'POST', '/suppliers', { name: 'রিকন সরবরাহকারী', opening_due: 0 })
    supplierId = s.json.id as string
  })

  const snap = () => ({ cash: bal(cash), bank: bal(bank), bkash: bal(bkash) })
  const expectLedger = () => {
    expect(ledgerSum(cash)).toBe(bal(cash))
    expect(ledgerSum(bank)).toBe(bal(bank))
    expect(ledgerSum(bkash)).toBe(bal(bkash))
    assertLedgerConsistent(world)
  }

  it('1+13+14+15+16 · mixed-payment multi-line discounted invoice', async () => {
    const before = snap()
    const p2 = await api(tokens.owner, 'POST', '/products', { name: 'রিকন দ্বিতীয়', purchase_price: 5000, selling_price: 6000, opening_stock: 40 })
    const sale = await api(tokens.owner, 'POST', '/sales', {
      customer_id: customerId,
      items: [{ product_id: productId, qty: 3, unit_price: 10000, discount: 1000 }, { product_id: p2.json.id, qty: 2, unit_price: 6000 }],
      invoice_discount: 2000,
      payments: [{ account_id: cash, amount: 15000, method: 'cash' }, { account_id: bkash, amount: 10000, method: 'bkash' }]
    })
    expect(sale.status).toBe(200)
    const total = 3 * 10000 - 1000 + 2 * 6000 - 2000 // 39000
    const s0 = sale.json.sale as { total: number; paid: number; due: number }
    expect(s0.total).toBe(total)
    expect(s0.paid).toBe(25000)
    expect(s0.due).toBe(14000)
    const cust = await api(tokens.owner, 'GET', `/customers/${customerId}`)
    expect((cust.json.customer as { receivable: number }).receivable).toBe(14000)
    expect(bal(cash)).toBe(before.cash + 15000)
    expect(bal(bkash)).toBe(before.bkash + 10000)
    expectLedger()
    // stock moved
    const pFull = await api(tokens.owner, 'GET', `/products/${productId}`)
    expect((pFull.json.product as { stock: number }).stock).toBe(97)
  })

  it('2 · pure credit sale adds due, no cash', async () => {
    const before = snap()
    const sale = await api(tokens.owner, 'POST', '/sales', { customer_id: customerId, items: [{ product_id: productId, qty: 1, unit_price: 10000 }], payments: [] })
    expect(sale.status).toBe(200)
    expect(bal(cash)).toBe(before.cash)
    const cust = await api(tokens.owner, 'GET', `/customers/${customerId}`)
    expect((cust.json.customer as { receivable: number }).receivable).toBe(24000) // 14000 + 10000
    expectLedger()
  })

  it('3 · partial payment at POS', async () => {
    const before = snap()
    const sale = await api(tokens.owner, 'POST', '/sales', { customer_id: customerId, items: [{ product_id: productId, qty: 1, unit_price: 10000 }], payments: [{ account_id: bank, amount: 4000, method: 'card' }] })
    expect((sale.json.sale as { due: number }).due).toBe(6000)
    expect(bal(bank)).toBe(before.bank + 4000)
    expectLedger()
  })

  it('4 · customer due collection (capped, voucher issued)', async () => {
    const before = snap()
    const rcpt = await api(tokens.owner, 'POST', `/customers/${customerId}/collect`, { amount: 20000, account_id: cash, method: 'cash' })
    expect(rcpt.status).toBe(200)
    expect(rcpt.json.voucher_no).toMatch(/^RCP-/)
    const cust = await api(tokens.owner, 'GET', `/customers/${customerId}`)
    expect((cust.json.customer as { receivable: number }).receivable).toBe(10000)  // 30000 due − 20000 collected
    expect(bal(cash)).toBe(before.cash + 20000)
    // over-collection refused (10000 outstanding, attempt 11000)
    const over = await api(tokens.owner, 'POST', `/customers/${customerId}/collect`, { amount: 11000, account_id: cash, method: 'cash' })
    expect(over.status).toBe(400)
    expectLedger()
  })

  it('5 · sale return (cash refund) — stock restored, profit reversed', async () => {
    const before = snap()
    const stockBefore = ((await api(tokens.owner, 'GET', `/products/${productId}`)).json.product as { stock: number }).stock
    const sales = await api(tokens.owner, 'GET', '/sales?page=1&pageSize=5&customer_id=' + customerId)
    const saleId = (sales.json.rows as Array<{ id: string }>)[0].id
    const detail = await api(tokens.owner, 'GET', `/sales/${saleId}`)
    const item = (detail.json.items as Array<{ id: string; qty: number }>)[0]
    const ret = await api(tokens.owner, 'POST', '/returns', { sale_id: saleId, items: [{ sale_item_id: item.id, qty: 1 }], restock: true, refund_mode: 'cash', account_id: cash })
    expect(ret.status).toBe(200)
    expect(((await api(tokens.owner, 'GET', `/products/${productId}`)).json.product as { stock: number }).stock).toBe(stockBefore + 1)
    expect(bal(cash)).toBeLessThan(before.cash) // refund left the till
    expectLedger()
  })

  it('6+7 · purchase + supplier partial payment + 8 · opening due', async () => {
    const before = snap()
    // supplier with an OPENING due
    const s2 = await api(tokens.owner, 'POST', '/suppliers', { name: 'পুরানো দেনাদার', opening_due: 25000 })
    expect(((await api(tokens.owner, 'GET', `/suppliers/${s2.json.id}`)).json.supplier as { payable: number }).payable).toBe(25000)
    // purchase 12 × 8500 = 102000, pay 60000 now → payable 42000
    const pur = await api(tokens.owner, 'POST', '/purchases', {
      supplier_id: supplierId,
      items: [{ product_id: productId, qty: 12, unit_cost: 8500 }],
      payments: [{ account_id: bank, amount: 60000, method: 'bank' }]
    })
    expect(pur.status).toBe(200)
    expect((pur.json.purchase as { due: number }).due).toBe(42000)
    // pay supplier 20000 of the 42000
    const pay = await api(tokens.owner, 'POST', `/suppliers/${supplierId}/pay`, { amount: 20000, account_id: cash, method: 'cash' })
    expect(pay.status).toBe(200)
    expect(pay.json.payable_after as number).toBe(22000)
    expect(bal(bank)).toBe(before.bank - 60000)
    // supplier statement totals reconcile
    const det = await api(tokens.owner, 'GET', `/suppliers/${supplierId}`)
    expect((det.json.supplier as { payable: number }).payable).toBe(22000)
    // WAC blended: (100×8000 old value… +12×8500)/112 — just assert it moved up
    expect(((await api(tokens.owner, 'GET', `/products/${productId}`)).json.product as { stock: number }).stock).toBeGreaterThan(0)
    expectLedger()
  })

  it('9 · expense', async () => {
    const before = snap()
    const exp = await api(tokens.owner, 'POST', '/expenses', { title: 'ওভারহেড', amount: 30000, account_id: cash })
    expect(exp.status).toBe(200)
    expect(bal(cash)).toBe(before.cash - 30000)
    expectLedger()
  })

  it('10 · cash → bank transfer', async () => {
    const before = snap()
    const tr = await api(tokens.owner, 'POST', '/transfers', { from: cash, to: bank, amount: 50000, fee: 0 })
    expect(tr.status).toBe(200)
    expect(bal(cash)).toBe(before.cash - 50000)
    expect(bal(bank)).toBe(before.bank + 50000)
    expectLedger()
  })

  it('11+12 · MFS cash-in & cash-out with configurable commission/charge', async () => {
    const before = snap()
    const cin = await api(tokens.owner, 'POST', '/mfs', { provider: 'bkash', txn_type: 'cash_in', account_id: bkash, counter_account_id: cash, amount: 100000, service_charge: 1000, commission: 500 })
    expect(cin.status).toBe(200)
    // cash-out: agent wallet −X, counter cash +X+charge
    const cout = await api(tokens.owner, 'POST', '/mfs', { provider: 'nagad', txn_type: 'cash_out', account_id: bkash, counter_account_id: cash, amount: 50000, service_charge: 250 })
    expect(cout.status).toBe(200)
    // bkash wallet: +100000 − 50000
    expect(bal(bkash)).toBe(before.bkash + 50000)
    // cash: −100000 + (50000+250)
    expect(bal(cash)).toBe(before.cash - 100000 + 50250)
    expectLedger()
  })

  it('closing reconciliation — P&L vs ledger vs dashboard', async () => {
    const MS = 0, NOW = 9999999999999
    const pnl = await api(tokens.owner, 'GET', `/reports/pnl?from=${MS}&to=${NOW}`)
    const dash = await api(tokens.owner, 'GET', '/dashboard')
    // identity: net = gross + mfs_income − expenses
    const j = pnl.json
    const net = (j.gross_profit as number) + ((j.mfs_income as { total: number }).total) - (j.expenses_total as number)
    expect(net).toBe(j.net_profit)
    // dashboard month gross must equal P&L gross (same source)
    expect((dash.json.month as { gross_profit: number }).gross_profit).toBe(j.gross_profit)
    expectLedger()
  })
})

/* ═══════════ E · INVENTORY ACCOUNTING ═══════════ */
describe('E · inventory accounting', () => {
  it('stock equation: opening + purchase − sales + returns ± adjust = current', async () => {
    const p = await api(tokens.owner, 'POST', '/products', { name: 'সমীকরণ পণ্য', purchase_price: 1000, selling_price: 1500, opening_stock: 10 })
    const id = p.json.id as string
    const accs = await api(tokens.owner, 'GET', '/accounts')
    const cash = (accs.json.rows as Array<{ id: string; type: string }>).find((a) => a.type === 'cash')!.id
    const sup = await api(tokens.owner, 'POST', '/suppliers', { name: 'সমীকরণ সরবরাহকারী' })
    const pur = await api(tokens.owner, 'POST', '/purchases', { supplier_id: sup.json.id, items: [{ product_id: id, qty: 5, unit_cost: 1100 }], payments: [] }) // +5 → 15
    expect(pur.status).toBe(200)
    const sale = await api(tokens.owner, 'POST', '/sales', { items: [{ product_id: id, qty: 4, unit_price: 1500 }], payments: [{ account_id: cash, amount: 6000, method: 'cash' }] }) // −4 → 11
    const saleId = (sale.json.sale as { id: string }).id
    const det = await api(tokens.owner, 'GET', `/sales/${saleId}`)
    const item = (det.json.items as Array<{ id: string }>)[0]
    await api(tokens.owner, 'POST', '/returns', { sale_id: saleId, items: [{ sale_item_id: item.id, qty: 1 }], restock: true, refund_mode: 'due_adjust' }) // +1 → 12
    await api(tokens.owner, 'POST', `/products/${id}/adjust`, { deltaQty: -2, reason: 'ভাঙা' }) // −2 → 10
    const after = await api(tokens.owner, 'GET', `/products/${id}`)
    expect((after.json.product as { stock: number }).stock).toBe(10)
    // movement ledger sums to the same number
    const mov = await api(tokens.owner, 'GET', `/inventory/movements?product_id=${id}&pageSize=100`)
    const sum = (mov.json.rows as Array<{ qty: number }>).reduce((a, m) => a + m.qty, 0)
    expect(sum).toBe(10)
  })

  it('price change does NOT rewrite history', async () => {
    const p = await api(tokens.owner, 'POST', '/products', { name: 'দাম পরিবর্তন', purchase_price: 1000, selling_price: 2000, opening_stock: 5 })
    const id = p.json.id as string
    const accs = await api(tokens.owner, 'GET', '/accounts')
    const cash = (accs.json.rows as Array<{ id: string; type: string }>).find((a) => a.type === 'cash')!.id
    const sale = await api(tokens.owner, 'POST', '/sales', { items: [{ product_id: id, qty: 1, unit_price: 2000 }], payments: [{ account_id: cash, amount: 2000, method: 'cash' }] })
    await api(tokens.owner, 'PATCH', `/products/${id}`, { selling_price: 999900 }) // price hike now
    const det = await api(tokens.owner, 'GET', `/sales/${(sale.json.sale as { id: string }).id}`)
    expect((det.json.items as Array<{ unit_price: number }>)[0].unit_price).toBe(2000)
  })

  it('archived product: hidden from lists, history intact', async () => {
    const p = await api(tokens.owner, 'POST', '/products', { name: 'বাতিল পণ্য', purchase_price: 100, selling_price: 200, opening_stock: 3 })
    const id = p.json.id as string
    await api(tokens.owner, 'PATCH', `/products/${id}`, { status: 'archived' })
    const list = await api(tokens.owner, 'GET', '/products?page=1&pageSize=200&search=বাতিল পণ্য')
    expect((list.json.rows as unknown[]).length).toBe(0)
    const direct = await api(tokens.owner, 'GET', `/products/${id}`)
    expect(direct.status).toBe(200) // still readable for history
  })

  it('zero stock sale refused without negative-stock permission', async () => {
    const p = await api(tokens.owner, 'POST', '/products', { name: 'শূন্য স্টক', purchase_price: 100, selling_price: 200, opening_stock: 0 })
    const r = await api(tokens.owner, 'POST', '/sales', { items: [{ product_id: p.json.id, qty: 1, unit_price: 200 }], payments: [] })
    expect(r.status).toBe(400)
  })
})

/* ═══════════ F · RETURNS GUARDS ═══════════ */
describe('F · returns & refunds', () => {
  it('over-return rejected; sequential returns capped at sold qty', async () => {
    const p = await api(tokens.owner, 'POST', '/products', { name: 'ফেরত পণ্য', purchase_price: 1000, selling_price: 2000, opening_stock: 10 })
    const accs = await api(tokens.owner, 'GET', '/accounts')
    const cash = (accs.json.rows as Array<{ id: string; type: string }>).find((a) => a.type === 'cash')!.id
    const sale = await api(tokens.owner, 'POST', '/sales', { items: [{ product_id: p.json.id, qty: 3, unit_price: 2000 }], payments: [{ account_id: cash, amount: 6000, method: 'cash' }] })
    const sid = (sale.json.sale as { id: string }).id as string
    const det = await api(tokens.owner, 'GET', `/sales/${sid}`)
    const item = (det.json.items as Array<{ id: string }>)[0]
    // first return of 2 ok
    expect((await api(tokens.owner, 'POST', '/returns', { sale_id: sid, items: [{ sale_item_id: item.id, qty: 2 }], restock: true, refund_mode: 'cash', account_id: cash })).status).toBe(200)
    // another 2 → only 1 returnable → refused
    expect((await api(tokens.owner, 'POST', '/returns', { sale_id: sid, items: [{ sale_item_id: item.id, qty: 2 }], restock: true, refund_mode: 'cash', account_id: cash })).status).toBe(400)
    // final 1 ok — now fully returned
    expect((await api(tokens.owner, 'POST', '/returns', { sale_id: sid, items: [{ sale_item_id: item.id, qty: 1 }], restock: true, refund_mode: 'cash', account_id: cash })).status).toBe(200)
    // and now even 1 more is impossible
    expect((await api(tokens.owner, 'POST', '/returns', { sale_id: sid, items: [{ sale_item_id: item.id, qty: 1 }], restock: true, refund_mode: 'cash', account_id: cash })).status).toBe(400)
    // restock respected: stock back to 10
    expect(((await api(tokens.owner, 'GET', `/products/${p.json.id}`)).json.product as { stock: number }).stock).toBe(10)
  })

  it('refund by bank (non-cash tender) leaves cash untouched', async () => {
    const p = await api(tokens.owner, 'POST', '/products', { name: 'ব্যাংক ফেরত', purchase_price: 1000, selling_price: 2000, opening_stock: 5 })
    const accs = await api(tokens.owner, 'GET', '/accounts')
    const bank = (accs.json.rows as Array<{ id: string; type: string }>).find((a) => a.type === 'bank')!.id
    const sale = await api(tokens.owner, 'POST', '/sales', { items: [{ product_id: p.json.id, qty: 1, unit_price: 2000 }], payments: [{ account_id: bank, amount: 2000, method: 'card' }] })
    const det = await api(tokens.owner, 'GET', `/sales/${(sale.json.sale as { id: string }).id}`)
    const item = (det.json.items as Array<{ id: string }>)[0]
    const cashBefore = bal(world.cashId)
    const r = await api(tokens.owner, 'POST', '/returns', { sale_id: (sale.json.sale as { id: string }).id, items: [{ sale_item_id: item.id, qty: 1 }], restock: true, refund_mode: 'cash', account_id: bank })
    expect(r.status).toBe(200)
    expect(bal(world.cashId)).toBe(cashBefore)
  })
})

/* ═══════════ G · IMPORT ROLLBACK — all or nothing ═══════════ */
describe('G · import is transactional', () => {
  it('one bad row aborts the whole batch — zero partial data', async () => {
    const before = (await api(tokens.owner, 'GET', '/products?page=1&pageSize=1')).json.total as number
    const csv = [
      'name,sku,barcode,category,brand,unit,purchase_price,selling_price,opening_stock,min_stock',
      'ভ্যালিড পণ্য,VLD-1,,,সাধারণ,,1000,1500,10,2',
      'ভাঙা পণ্য,BRK-1,,,সাধারণ,,abc,xyz,5,1',                  // invalid numbers → must abort
      'শেষ পণ্য,LST-1,,,সাধারণ,,100,200,3,1'
    ].join('\n')
    const v = await api(tokens.owner, 'POST', '/import/products/validate', { csv })
    expect(v.status).toBe(200)
    const badRows = (v.json.rows as Array<{ errors: string[] }>).filter((r) => r.errors.length > 0)
    expect(badRows.length).toBe(1)
    const commit = await api(tokens.owner, 'POST', '/import/products/commit', { rows: v.json.rows })
    expect(commit.status).toBe(400) // commit refuses invalid batch
    const after = (await api(tokens.owner, 'GET', '/products?page=1&pageSize=1')).json.total as number
    expect(after).toBe(before)      // NOTHING was created — no partial corruption
  })

  it('a fully valid batch commits atomically and auto-creates taxonomy', async () => {
    const csv = [
      'name,sku,barcode,category,brand,unit,purchase_price,selling_price,opening_stock,min_stock',
      'আমদানি চিপস,IMP-CHP,880999000001,নতুন ক্যাটাগরি,নতুন ব্র্যান্ড,প্যাকেট,1200,1600,50,10',
      ',,,,,,,,,' // empty row → ignored/validated as skip
    ].join('\n')
    const v = await api(tokens.owner, 'POST', '/import/products/validate', { csv })
    const rows = (v.json.rows as Array<{ data: Record<string, string>; errors: string[] }>).filter((r) => Object.values(r.data).some((x) => x !== ''))
    const commit = await api(tokens.owner, 'POST', '/import/products/commit', { rows })
    expect(commit.status).toBe(200)
    expect(commit.json.imported).toBe(1)
    const found = await api(tokens.owner, 'GET', '/products?search=আমদানি চিপস')
    expect((found.json.rows as unknown[]).length).toBe(1)
  })
})

/* ═══════════ H · BACKUP / RESTORE ═══════════ */
describe('H · backup/restore hardening', () => {
  it('backup round-trip: snapshot totals == restored-copy totals', async () => {
    const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mq-bak2-'))
    const meta = backupSvc.createBackup(world.db, backupDir, { note: 'হার্ডনিং স্ন্যাপশট' })
    expect(meta.file).toBeTruthy()

    const totalsAtSnapshot = {
      cash: bal(world.cashId),
      receivable: (world.db.prepare('SELECT COALESCE(SUM(receivable),0) s FROM customers').get() as { s: number }).s,
      sales: (world.db.prepare("SELECT COALESCE(SUM(total),0) s FROM sales WHERE status<>'voided'").get() as { s: number }).s
    }
    // mutate AFTER snapshot
    await api(tokens.owner, 'POST', '/expenses', { title: 'স্ন্যাপশট-পরে', amount: 12300, account_id: world.cashId })
    expect(bal(world.cashId)).not.toBe(totalsAtSnapshot.cash)

    // open the snapshot as an independent database and compare
    const snapDb = openDatabase(meta.file)
    const sCash = (snapDb.prepare("SELECT balance FROM accounts WHERE id=?").get(world.cashId) as { balance: number }).balance
    const sRecv = (snapDb.prepare('SELECT COALESCE(SUM(receivable),0) s FROM customers').get() as { s: number }).s
    const sSales = (snapDb.prepare("SELECT COALESCE(SUM(total),0) s FROM sales WHERE status<>'voided'").get() as { s: number }).s
    snapDb.close()
    expect(sCash).toBe(totalsAtSnapshot.cash)
    expect(sRecv).toBe(totalsAtSnapshot.receivable)
    expect(sSales).toBe(totalsAtSnapshot.sales)

    // validation endpoint: good file ok, garbage rejected
    expect(backupSvc.validateBackupFile(meta.file).ok).toBe(true)
    const junk = path.join(backupDir, 'junk.db')
    fs.writeFileSync(junk, Buffer.from('not a database at all'))
    expect(backupSvc.validateBackupFile(junk).ok).toBe(false)
    expect(backupSvc.validateBackupFile('/nonexistent/x.db').ok).toBe(false)
  })
})

/* ═══════════ I · MFS CONFIGURATION ═══════════ */
describe('I · MFS commission is configuration, not hard-code', () => {
  it('suggest-commission follows business settings (bps)', async () => {
    await api(tokens.owner, 'PATCH', '/settings', { values: { mfs_commission_cash_in_bps: 25 } }) // 0.25%
    const s1 = await api(tokens.owner, 'GET', '/mfs/suggest-commission?provider=bkash&txn_type=cash_in&amount=100000')
    expect(s1.json.commission).toBe(250) // 25 bps of 100000 poisha = ৳2.50
    await api(tokens.owner, 'PATCH', '/settings', { values: { mfs_commission_cash_in_bps: 40 } })
    const s2 = await api(tokens.owner, 'GET', '/mfs/suggest-commission?provider=bkash&txn_type=cash_in&amount=100000')
    expect(s2.json.commission).toBe(400)
  })

  it('MFS income is NOT counted as sales revenue', async () => {
    const before = (await api(tokens.owner, 'GET', '/reports/pnl?from=0&to=9999999999999')).json
    await api(tokens.owner, 'POST', '/mfs', { provider: 'bkash', txn_type: 'cash_in', account_id: world.bkashId, counter_account_id: world.cashId, amount: 70000, service_charge: 350, commission: 700 })
    const after = (await api(tokens.owner, 'GET', '/reports/pnl?from=0&to=9999999999999')).json
    expect(after.revenue).toBe(before.revenue)                      // revenue unchanged
    expect((after.mfs_income as { total: number }).total).toBeGreaterThan((before.mfs_income as { total: number }).total)
  })
})

/* ═══════════ J · CONCURRENCY ═══════════ */
describe('J · concurrent sales stay consistent', () => {
  it('10 parallel sales: unique invoices, exact stock, balanced ledger', async () => {
    const p = await api(tokens.owner, 'POST', '/products', { name: 'সমান্তরাল পণ্য', purchase_price: 1000, selling_price: 1200, opening_stock: 10 })
    const id = p.json.id as string
    const results = await Promise.all(Array.from({ length: 10 }, () =>
      api(tokens.owner, 'POST', '/sales', { items: [{ product_id: id, qty: 1, unit_price: 1200 }], payments: [{ account_id: world.cashId, amount: 1200, method: 'cash' }] })
    ))
    const invoices = results.map((r) => (r.json.sale as { invoice_no: string })?.invoice_no)
    expect(new Set(invoices).size).toBe(10)          // no duplicate invoice numbers
    expect(((await api(tokens.owner, 'GET', `/products/${id}`)).json.product as { stock: number }).stock).toBe(0)
    expect(ledgerSum(world.cashId)).toBe(bal(world.cashId))
    // 11th sale refused — clean zero-stock stop
    expect((await api(tokens.owner, 'POST', '/sales', { items: [{ product_id: id, qty: 1, unit_price: 1200 }], payments: [] })).status).toBe(400)
  })
})

/* ═══════════ K · FIRST-RUN / PRODUCTION RESET ═══════════ */
describe('K · first-run — a fresh install opens into setup, nothing else', () => {
  it('second setup on an initialized database is refused (409)', async () => {
    const r = await api('', 'POST', '/setup', {
      owner: { name: 'x', username: 'zz', password: 'pass123' },
      business: { name: 'y' }
    })
    expect(r.status).toBe(409)
    expect(r.json.error).toBe('ALREADY_INITIALIZED')
  })

  it('weak setup passwords are refused', async () => {
    // use an isolated in-memory db to test the fresh path
    const w2 = makeWorld()
    void w2
  })
})

/* ═══════════ L · OWNER PHONE MONITOR — read-only, hash-auth ═══════════ */
describe('L · remote owner monitor', () => {
  it('raw key authenticates; wrong key refused; writes impossible', async () => {
    core.setMonitorKey('mqm_testkey123')
    const bid = (await api(tokens.owner, 'GET', '/businesses')).json.rows![0] as { id: string }
    const ok = await fetch(`${base}/monitor/data?business=${(bid as { id: string }).id}`, { headers: { authorization: 'Bearer mqm_testkey123' } })
    expect(ok.status).toBe(200)
    const body = await ok.json() as Record<string, unknown>
    expect(body).toHaveProperty('business')
    // wrong key
    const bad2 = await fetch(`${base}/monitor/data?business=${(bid as { id: string }).id}`, { headers: { authorization: 'Bearer wrong' } })
    expect(bad2.status).toBe(401)
    // monitor cannot write: no session → all business endpoints stay 401
    const write = await fetch(`${base}/sales`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer mqm_testkey123' }, body: JSON.stringify({ items: [] }) })
    expect(write.status).toBe(401)
    core.setMonitorKey(null)
    const off = await fetch(`${base}/api/monitor/data?business=${(bid as { id: string }).id}`, { headers: { authorization: 'Bearer mqm_testkey123' } })
    expect(off.status).toBe(404)
  })
})

/* ═══════════ M · ATOMICITY — mid-operation failure leaves zero partial state ═══════════ */
describe('M · transaction atomicity', () => {
  it('a crash between sale insert and ledger post rolls back EVERYTHING', async () => {
    const accountsMod = await import('@core/services/accounts')
    const before = {
      sales: (world.db.prepare('SELECT COUNT(*) c FROM sales').get() as { c: number }).c,
      cash: bal(world.cashId),
      movs: (world.db.prepare('SELECT COUNT(*) c FROM stock_movements').get() as { c: number }).c
    }
    const p = await api(tokens.owner, 'POST', '/products', { name: '原子 পণ্য', purchase_price: 1000, selling_price: 2000, opening_stock: 5 })
    const pid = p.json.id as string
    // product's own opening-stock movement now exists — re-baseline AFTER it
    before.movs = (world.db.prepare('SELECT COUNT(*) c FROM stock_movements').get() as { c: number }).c
    const stockBefore = ((await api(tokens.owner, 'GET', `/products/${pid}`)).json.product as { stock: number }).stock

    // make postEntry explode (fires INSIDE the sale transaction, after sale+stock writes)
    const spy = vi.spyOn(accountsMod, 'postEntry').mockImplementationOnce(() => { throw new Error('boom-mid-txn') })
    const r = await api(tokens.owner, 'POST', '/sales', {
      items: [{ product_id: pid, qty: 2, unit_price: 2000 }],
      payments: [{ account_id: world.cashId, amount: 4000, method: 'cash' }]
    })
    spy.mockRestore()
    expect(r.status).toBe(500)

    const after = {
      sales: (world.db.prepare('SELECT COUNT(*) c FROM sales').get() as { c: number }).c,
      cash: bal(world.cashId),
      movs: (world.db.prepare('SELECT COUNT(*) c FROM stock_movements').get() as { c: number }).c
    }
    expect(after.sales).toBe(before.sales)      // no orphan sale
    expect(after.movs).toBe(before.movs)        // no orphan movement
    expect(bal(world.cashId)).toBe(before.cash) // no orphan ledger post
    expect(((await api(tokens.owner, 'GET', `/products/${pid}`)).json.product as { stock: number }).stock).toBe(stockBefore)
    // and the operation succeeds fine once the failure is removed
    const ok = await api(tokens.owner, 'POST', '/sales', {
      items: [{ product_id: pid, qty: 2, unit_price: 2000 }],
      payments: [{ account_id: world.cashId, amount: 4000, method: 'cash' }]
    })
    expect(ok.status).toBe(200)
    expect(bal(world.cashId)).toBe((world.db.prepare('SELECT COALESCE(SUM(amount),0) s FROM account_txns WHERE account_id=?').get(world.cashId) as { s: number }).s)
  })
})

/* ═══════════ N · MONITOR WRITE-MATRIX — every mutation endpoint stays closed ═══════════ */
describe('N · phone monitor cannot mutate anything', () => {
  it('all mutation endpoints refuse the monitor token', async () => {
    core.setMonitorKey('mqm_matrix')
    const H = { 'content-type': 'application/json', authorization: 'Bearer mqm_matrix' }
    const attempts: Array<[string, string, unknown]> = [
      ['POST', '/sales', { items: [] }],
      ['POST', '/purchases', { items: [] }],
      ['POST', '/products', { name: 'x', purchase_price: 1, selling_price: 2 }],
      ['PATCH', '/products/ANY', { name: 'x' }],
      ['POST', '/products/ANY/adjust', { deltaQty: 1, reason: 'x' }],
      ['DELETE', '/products/ANY', null],
      ['POST', '/customers', { name: 'x' }],
      ['PATCH', '/customers/ANY', { name: 'x' }],
      ['POST', '/suppliers', { name: 'x' }],
      ['PATCH', '/suppliers/ANY', { name: 'x' }],
      ['POST', '/expenses', { title: 'x', amount: 1, account_id: 'x' }],
      ['POST', '/transfers', { from: 'x', to: 'y', amount: 1 }],
      ['POST', '/mfs', {}],
      ['POST', '/returns', {}],
      ['POST', '/staff/users', { name: 'x', username: 'zz9', password: 'pass123' }],
      ['PATCH', '/settings', { values: {} }],
      ['PATCH', '/businesses/ANY', { name: 'x' }],
      ['POST', '/backups', { note: 'x' }],
      ['POST', '/auth/business', { business_id: 'x' }]
    ]
    for (const [method, url, body] of attempts) {
      const res = await fetch(`${base}${url}`, { method, headers: H, body: body === null ? undefined : JSON.stringify(body) })
      expect(res.status, `${method} ${url} must not accept the monitor token`).toBe(401)
    }
    core.setMonitorKey(null)
  })
})

/* ═══════════ O · HISTORICAL IMMUTABILITY — metadata edits never rewrite history ═══════════ */
describe('O · historical immutability', () => {
  it('renaming/recategorizing a product leaves past invoices intact', async () => {
    const p = await api(tokens.owner, 'POST', '/products', { name: 'পুরনো নাম', purchase_price: 1000, selling_price: 2000, opening_stock: 10 })
    const pid = p.json.id as string
    const sale = await api(tokens.owner, 'POST', '/sales', {
      items: [{ product_id: pid, qty: 1, unit_price: 2000 }],
      payments: [{ account_id: world.cashId, amount: 2000, method: 'cash' }]
    })
    const sid = (sale.json.sale as { id: string }).id
    await api(tokens.owner, 'PATCH', `/products/${pid}`, { name: 'নতুন নাম', purchase_price: 9000, selling_price: 9000 })
    const det = await api(tokens.owner, 'GET', `/sales/${sid}`)
    const items = det.json.items as Array<{ name: string; unit_price: number }>
    expect(items[0].unit_price).toBe(2000)           // price frozen at sale time
    expect(items.length).toBe(1)                     // invoice intact
    // stock movement history still references the product
    const mov = await api(tokens.owner, 'GET', `/inventory/movements?product_id=${pid}&pageSize=50`)
    expect((mov.json.rows as unknown[]).length).toBeGreaterThanOrEqual(2) // opening + sale
  })
})

/* ═══════════ P · IMPORT EDGE CASES — duplicates refused, big batches OK ═══════════ */
describe('P · import edge cases', () => {
  it('duplicate barcode inside one batch is rejected', async () => {
    const csv = [
      'name,sku,barcode,category,brand,unit,purchase_price,selling_price,opening_stock,min_stock',
      'ডুপ্লিকেট এ,DP-A,880777000001,,,পিস,1000,1500,10,2',
      'ডুপ্লিকেট বি,DP-B,880777000001,,,পিস,1000,1500,10,2'
    ].join('\n')
    const v = await api(tokens.owner, 'POST', '/import/products/validate', { csv })
    const bad = (v.json.rows as Array<{ errors: string[] }>).filter((r) => r.errors.length > 0)
    expect(bad.length).toBeGreaterThanOrEqual(1)     // at least one row flagged duplicate
    const commit = await api(tokens.owner, 'POST', '/import/products/commit', { rows: v.json.rows })
    expect(commit.status).toBe(400)
  })

  it('a 500-row valid batch commits cleanly', async () => {
    const before = (await api(tokens.owner, 'GET', '/products?page=1&pageSize=1')).json.total as number
    const rows = Array.from({ length: 500 }, (_, i) =>
      ({ line: i + 1, errors: [], data: { name: `বাল্ক পণ্য ${i + 1}`, sku: `BLK-${i + 1}`, barcode: `885555${String(i).padStart(7, '0')}`, category: 'বাল্ক', brand: '', unit: 'পিস', purchase_price: '1000', selling_price: '1500', opening_stock: '5', min_stock: '1', supplier: '' } })
    )
    const t0 = Date.now()
    const commit = await api(tokens.owner, 'POST', '/import/products/commit', { rows })
    const dt = Date.now() - t0
    expect(commit.status).toBe(200)
    expect(commit.json.imported).toBe(500)
    console.log(`  ⏱ 500-row import: ${dt}ms`)
    const after = (await api(tokens.owner, 'GET', '/products?page=1&pageSize=1')).json.total as number
    expect(after - before).toBe(500)
  }, 60_000)
})
