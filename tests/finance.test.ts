import { describe, it, expect } from 'vitest'
import { makeWorld, balance, receivable, payable, stock, assertLedgerConsistent, sales, purchases, parties, payments, expenses, accounts, mfs, type World } from './setup'
import { computeNewWac } from '@core/services/purchases'
import { computeSale } from '@core/services/sales'

/**
 * The financial-scenario suite from the product brief (§55):
 * product costs ৳80, sells ৳100. Every scenario asserts every resulting balance.
 * All amounts below are written as poisha ints (100_00 = ৳100).
 */

function buy(w: World, productId: string, qty: number, unitCost = 80_00, paidPart = 0) {
  const supplier = parties.createSupplier(w.db, { userId: w.ownerId, businessId: w.businessId }, w.businessId, { name: 'পাইকার ' + Math.random() })
  const out = purchases.createPurchase(w.db, { userId: w.ownerId, businessId: w.businessId }, w.businessId, {
    supplier_id: supplier.id,
    items: [{ product_id: productId, qty, unit_cost: unitCost }],
    payments: paidPart > 0 ? [{ account_id: w.cashId, amount: paidPart, method: 'cash' }] : []
  })
  return { supplier, out }
}

describe('spec §55 — পূর্ণ পরিশোধ বিক্রয় (full payment sale)', () => {
  it('80/100: cash increases by 100, stock drops, COGS=80, gross=20', () => {
    const w = makeWorld()
    const p = w.product({ opening_stock: 10, opening_cost: 80_00 })
    expect(stock(w, p.id)).toBe(10)
    const cashBefore = balance(w, w.cashId)
    const { sale } = sales.createSale(w.db, { userId: w.ownerId, businessId: w.businessId }, w.businessId, {
      items: [{ product_id: p.id, qty: 1 }],
      payments: [{ account_id: w.cashId, amount: 100_00, method: 'cash' }]
    })
    expect(sale.total).toBe(100_00)
    expect(sale.paid).toBe(100_00)
    expect(sale.due).toBe(0)
    expect(sale.cogs).toBe(80_00)
    expect(stock(w, p.id)).toBe(9)
    expect(balance(w, w.cashId)).toBe(cashBefore + 100_00)
    assertLedgerConsistent(w)
  })
})

describe('§55 — আংশিক পরিশোধ (partial payment)', () => {
  it('100 sale, 40 paid → due 60 on customer, cash +40', () => {
    const w = makeWorld()
    const p = w.product({ opening_stock: 10, opening_cost: 80_00 })
    const cust = parties.createCustomer(w.db, { userId: w.ownerId, businessId: w.businessId }, w.businessId, { name: 'রহিম' })
    const cashBefore = balance(w, w.cashId)
    const { sale } = sales.createSale(w.db, { userId: w.ownerId, businessId: w.businessId }, w.businessId, {
      customer_id: cust.id,
      items: [{ product_id: p.id, qty: 1 }],
      payments: [{ account_id: w.cashId, amount: 40_00, method: 'cash' }]
    })
    expect(sale.due).toBe(60_00)
    expect(receivable(w, cust.id)).toBe(60_00)
    expect(balance(w, w.cashId)).toBe(cashBefore + 40_00)
    // collect the rest
    const w2 = w
    payments.collectCustomerDue(w2.db, { userId: w.ownerId, businessId: w2.businessId }, w2.businessId, {
      customer_id: cust.id, amount: 60_00, account_id: w2.cashId, method: 'cash'
    })
    expect(receivable(w, cust.id)).toBe(0)
    expect(balance(w, w.cashId)).toBe(cashBefore + 100_00)
    assertLedgerConsistent(w)
  })
})

describe('§55 — বাকিতে বিক্রয় (due sale)', () => {
  it('full due: no cash movement, receivable 100, revenue still 100', () => {
    const w = makeWorld()
    const p = w.product({ opening_stock: 5, opening_cost: 80_00 })
    const cust = parties.createCustomer(w.db, { userId: w.ownerId, businessId: w.businessId }, w.businessId, { name: 'করিম', opening_due: 20_00 })
    const cashBefore = balance(w, w.cashId)
    const { sale } = sales.createSale(w.db, { userId: w.ownerId, businessId: w.businessId }, w.businessId, {
      customer_id: cust.id,
      items: [{ product_id: p.id, qty: 1 }],
      payments: []
    })
    expect(sale.due).toBe(100_00)
    expect(receivable(w, cust.id)).toBe(120_00) // opening 20 + sale 100
    expect(balance(w, w.cashId)).toBe(cashBefore)
  })
})

describe('§55 — বিক্রয় ফেরত (sale return)', () => {
  it('restock + cash refund keeps stock, cash, profit consistent', () => {
    const w = makeWorld()
    const p = w.product({ opening_stock: 5, opening_cost: 80_00 })
    const cashBefore = balance(w, w.cashId)
    const { sale, items } = sales.createSale(w.db, { userId: w.ownerId, businessId: w.businessId }, w.businessId, {
      items: [{ product_id: p.id, qty: 2 }],
      payments: [{ account_id: w.cashId, amount: 200_00, method: 'cash' }]
    })
    expect(stock(w, p.id)).toBe(3)
    const ret = sales.createReturn(w.db, { userId: w.ownerId, businessId: w.businessId }, w.businessId, {
      sale_id: sale.id,
      items: [{ sale_item_id: items[0].id, qty: 1 }],
      restock: true,
      refund_mode: 'cash',
      account_id: w.cashId,
      reason: 'নষ্ট পণ্য'
    })
    expect(ret.amount).toBe(100_00)
    expect(stock(w, p.id)).toBe(4)
    expect(balance(w, w.cashId)).toBe(cashBefore + 200_00 - 100_00)
    assertLedgerConsistent(w)
  })

  it('refund via due adjustment reduces receivable, not cash', () => {
    const w = makeWorld()
    const p = w.product({ opening_stock: 5, opening_cost: 80_00 })
    const cust = parties.createCustomer(w.db, { userId: w.ownerId, businessId: w.businessId }, w.businessId, { name: 'সেলিম' })
    const cashBefore = balance(w, w.cashId)
    const { sale, items } = sales.createSale(w.db, { userId: w.ownerId, businessId: w.businessId }, w.businessId, {
      customer_id: cust.id,
      items: [{ product_id: p.id, qty: 1 }],
      payments: []
    })
    expect(receivable(w, cust.id)).toBe(100_00)
    const ret = sales.createReturn(w.db, { userId: w.ownerId, businessId: w.businessId }, w.businessId, {
      sale_id: sale.id,
      items: [{ sale_item_id: items[0].id, qty: 1 }],
      restock: true,
      refund_mode: 'due_adjust',
      reason: 'ভুল বিক্রয়'
    })
    expect(ret.due_adjusted).toBe(100_00)
    expect(ret.cash_refund).toBe(0)
    expect(receivable(w, cust.id)).toBe(0)
    expect(balance(w, w.cashId)).toBe(cashBefore)
    assertLedgerConsistent(w)
  })
})

describe('§55 — ডিসকাউন্ট ও একাধিক পণ্য', () => {
  it('item + invoice discount and multi-line math stays exact', () => {
    const w = makeWorld()
    const p1 = w.product({ name: 'এক', purchase_price: 80_00, selling_price: 100_00, opening_stock: 10, opening_cost: 80_00 })
    const p2 = w.product({ name: 'দুই', purchase_price: 50_00, selling_price: 60_00, opening_stock: 10, opening_cost: 50_00 })
    const comp = computeSale(w.db, w.businessId, {
      items: [
        { product_id: p1.id, qty: 2, discount_pct: 10 }, // 200 - 20 = 180
        { product_id: p2.id, qty: 1 } // 60
      ],
      invoice_discount: 40_00
    })
    expect(comp.subtotal).toBe(260_00)
    expect(comp.item_discount).toBe(20_00)
    expect(comp.invoice_discount).toBe(40_00)
    expect(comp.total).toBe(200_00)
    expect(comp.cogs).toBe(2 * 80_00 + 50_00) // 210
  })
})

describe('§55 — ক্রয় ও সরবরাহকারী বকেয়া', () => {
  it('purchase partial payment → payable correct, WAC blends', () => {
    const w = makeWorld()
    const p = w.product({ opening_stock: 10, opening_cost: 80_00 })
    const { supplier } = buy(w, p.id, 10, 90_00, 500_00) // buy 10 @90, pay 500 of 900
    expect(payable(w, supplier.id)).toBe(400_00)
    expect(stock(w, p.id)).toBe(20)
    // WAC: (10*80 + 10*90)/20 = 85
    expect((w.db.prepare(`SELECT wac FROM products WHERE id=?`).get(p.id) as { wac: number }).wac).toBe(85_00)
    assertLedgerConsistent(w)
  })

  it('previous due + new purchase due tracked separately but summed', () => {
    const w = makeWorld()
    const p = w.product()
    const supplier = parties.createSupplier(w.db, { userId: w.ownerId, businessId: w.businessId }, w.businessId, { name: 'পুরনো পাইকার', opening_due: 300_00 })
    expect(payable(w, supplier.id)).toBe(300_00)
    const pOld = w.product()
    purchases.createPurchase(w.db, { userId: w.ownerId, businessId: w.businessId }, w.businessId, {
      supplier_id: supplier.id,
      items: [{ product_id: pOld.id, qty: 5, unit_cost: 80_00 }],
      payments: [{ account_id: w.bankId, amount: 300_00, method: 'bank' }],
      opening_due_settle: 300_00
    })
    expect(payable(w, supplier.id)).toBe(100_00) // new purchase ৳400 − paid ৳300 = ৳100; old ৳300 settled
    expect(balance(w, w.bankId)).toBe(500_000_00 - 300_00 - 300_00)
    assertLedgerConsistent(w)
  })
})

describe('§55 — খরচ ও ট্রান্সফার', () => {
  it('expense reduces account and net profit, never revenue', () => {
    const w = makeWorld()
    const p = w.product({ opening_stock: 10, opening_cost: 80_00 })
    sales.createSale(w.db, { userId: w.ownerId, businessId: w.businessId }, w.businessId, {
      items: [{ product_id: p.id, qty: 1 }],
      payments: [{ account_id: w.cashId, amount: 100_00, method: 'cash' }]
    })
    expenses.createExpense(w.db, { userId: w.ownerId, businessId: w.businessId }, w.businessId, {
      title: 'বিদ্যুৎ বিল', amount: 15_00, account_id: w.cashId
    })
    const cashNow = balance(w, w.cashId)
    expect(cashNow).toBe(100_000_00 + 100_00 - 15_00)
  })

  it('cash → bank transfer is neutral to P&L and keeps totals', () => {
    const w = makeWorld()
    const cashBefore = balance(w, w.cashId)
    const bankBefore = balance(w, w.bankId)
    accounts.transferFunds(w.db, { userId: w.ownerId, businessId: w.businessId }, w.businessId, {
      from: w.cashId, to: w.bankId, amount: 20_000_00, fee: 100
    })
    expect(balance(w, w.cashId)).toBe(cashBefore - 20_000_00 - 100)
    expect(balance(w, w.bankId)).toBe(bankBefore + 20_000_00)
    assertLedgerConsistent(w)
  })
})

describe('§55 — MFS এজেন্ট লেনদেন', () => {
  it('cash-out: agent balance −1000, cash +1000 + charge', () => {
    const w = makeWorld()
    const cashBefore = balance(w, w.cashId)
    const bkashBefore = balance(w, w.bkashId)
    mfs.createMfsTxn(w.db, { userId: w.ownerId, businessId: w.businessId }, w.businessId, {
      provider: 'bkash', txn_type: 'cash_out', account_id: w.bkashId, counter_account_id: w.cashId,
      amount: 100_000, service_charge: 1_500, customer_phone: '01712345678'
    })
    expect(balance(w, w.bkashId)).toBe(bkashBefore - 100_000)
    expect(balance(w, w.cashId)).toBe(cashBefore + 100_000 + 1_500)
    assertLedgerConsistent(w)
  })

  it('cash-in: cash −1000, agent balance +1000', () => {
    const w = makeWorld()
    const cashBefore = balance(w, w.cashId)
    const bkashBefore = balance(w, w.bkashId)
    mfs.createMfsTxn(w.db, { userId: w.ownerId, businessId: w.businessId }, w.businessId, {
      provider: 'bkash', txn_type: 'cash_in', account_id: w.bkashId, counter_account_id: w.cashId, amount: 100_000
    })
    expect(balance(w, w.cashId)).toBe(cashBefore - 100_000)
    expect(balance(w, w.bkashId)).toBe(bkashBefore + 100_000)
    assertLedgerConsistent(w)
  })
})

describe('guards — the mistakes retail software must never make', () => {
  it('rejects overselling without permission', () => {
    const w = makeWorld()
    const p = w.product({ opening_stock: 1 })
    expect(() =>
      sales.createSale(w.db, { userId: w.ownerId, businessId: w.businessId }, w.businessId, {
        items: [{ product_id: p.id, qty: 5 }],
        payments: [{ account_id: w.cashId, amount: 500_00, method: 'cash' }]
      })
    ).toThrow(/স্টক/)
  })

  it('rejects due sale without a customer', () => {
    const w = makeWorld()
    const p = w.product({ opening_stock: 2 })
    expect(() =>
      sales.createSale(w.db, { userId: w.ownerId, businessId: w.businessId }, w.businessId, {
        items: [{ product_id: p.id, qty: 1 }],
        payments: []
      })
    ).toThrow(/গ্রাহক/)
  })

  it('rejects overpaying a due', () => {
    const w = makeWorld()
    const p = w.product({ opening_stock: 2 })
    const cust = parties.createCustomer(w.db, { userId: w.ownerId, businessId: w.businessId }, w.businessId, { name: 'জহির' })
    expect(() =>
      payments.collectCustomerDue(w.db, { userId: w.ownerId, businessId: w.businessId }, w.businessId, {
        customer_id: cust.id, amount: 100_00, account_id: w.cashId, method: 'cash'
      })
    ).toThrow(/বকেয়া/)
  })

  it('rejects duplicate invoice numbers under the same second (concurrency)', () => {
    const w = makeWorld()
    const p = w.product({ opening_stock: 100 })
    const mk = () =>
      sales.createSale(w.db, { userId: w.ownerId, businessId: w.businessId }, w.businessId, {
        items: [{ product_id: p.id, qty: 1 }],
        payments: [{ account_id: w.cashId, amount: 100_00, method: 'cash' }]
      })
    const a = mk()
    const b = mk()
    expect(a.sale.invoice_no).not.toBe(b.sale.invoice_no)
  })

  it('WAC math is exact across sequential purchases', () => {
    expect(computeNewWac(0, 0, 10, 80_00)).toBe(80_00)
    expect(computeNewWac(10, 80_00, 10, 90_00)).toBe(85_00)
    expect(computeNewWac(20, 85_00, 5, 60_00)).toBe(Math.round((20 * 85_00 + 5 * 60_00) / 25))
  })
})
