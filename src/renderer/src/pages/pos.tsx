import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import {
  Search, Plus, Minus, X, Tag, UserPlus, Pause, Play, Trash2, ScanBarcode, PackageSearch, Wallet, Banknote,
  Landmark, CreditCard, Smartphone, CheckCircle2, FileText, ReceiptText
} from 'lucide-react'
import { api } from '@/api/client'
import { useSession } from '@/state/session'
import { useToast } from '@/state/toast'
import { t, money, num } from '@/i18n/bn'
import { Modal, Field, Spinner, Badge, EmptyState, Menu, MenuItem, Kbd, ConfirmDialog } from '@/ui/components'
import { PERMS } from '../perm'
import { invoiceHtml, printDoc, dueReceiptHtml, methodBn } from '@/lib/printing'
import { useBusinessInfo } from '@/lib/useBusinessInfo'

interface Prod {
  id: string
  name: string
  sku: string | null
  barcode: string | null
  selling_price: number
  stock: number
  track_stock: number
  unit_short: string | null
  category_name: string | null
  tax_rate_bps: number
  wac: number
}
interface CartLine {
  product_id: string
  name: string
  qty: number
  unit_price: number
  discount: number
  stock: number
  track_stock: boolean
  unit: string | null
}
interface CustomerOpt { id: string; name: string; phone: string | null; receivable: number }
interface HeldSale { id: string; label: string; cart_json: string; created_at: number }

const PAY_METHODS = [
  { key: 'cash', label: 'ক্যাশ', icon: <Banknote size={15} /> },
  { key: 'bkash', label: 'বিকাশ', icon: <Smartphone size={15} /> },
  { key: 'nagad', label: 'নগদ', icon: <Smartphone size={15} /> },
  { key: 'rocket', label: 'রকেট', icon: <Smartphone size={15} /> },
  { key: 'upay', label: 'Upay', icon: <Smartphone size={15} /> },
  { key: 'bank', label: 'ব্যাংক', icon: <Landmark size={15} /> },
  { key: 'card', label: 'কার্ড', icon: <CreditCard size={15} /> }
]

let heldRestore: { lines: CartLine[]; customer_id: string | null; invoice_discount: number } | null = null
export { heldRestore }

export function POS() {
  const { business, can, me } = useSession()
  const { toast } = useToast()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const biz = useBusinessInfo()

  const [search, setSearch] = useState('')
  const [category, setCategory] = useState<string>('')
  const [cart, setCart] = useState<CartLine[]>([])
  const [customerId, setCustomerId] = useState<string | null>(null)
  const [invoiceDiscount, setInvoiceDiscount] = useState(0)
  const [payOpen, setPayOpen] = useState(false)
  const [clearOpen, setClearOpen] = useState(false)
  const [custOpen, setCustOpen] = useState(false)
  const [custSearch, setCustSearch] = useState('')
  const [newCustOpen, setNewCustOpen] = useState(false)
  const [heldOpen, setHeldOpen] = useState(false)
  const [priceEdit, setPriceEdit] = useState<{ line: CartLine; value: string } | null>(null)
  const [discountEdit, setDiscountEdit] = useState<{ line: CartLine; value: string } | null>(null)
  const [completing, setCompleting] = useState(false)
  const [lastSale, setLastSale] = useState<{ invoice_no: string; total: number; due: number } | null>(null)
  const scanRef = useRef<HTMLInputElement>(null)

  const { data: catalog } = useQuery({ queryKey: ['catalog'], queryFn: () => api.get<{ categories: Array<{ id: string; name: string }>; customers: CustomerOpt[] }>('/catalog') })
  const { data: productData, isLoading } = useQuery({
    queryKey: ['pos-products', search, category],
    queryFn: () => api.get<{ rows: Prod[] }>('/products', { search: search || undefined, category_id: category || undefined, pageSize: 60, sort: 'name' }),
    staleTime: 10_000
  })
  const { data: accounts } = useQuery({ queryKey: ['accounts'], queryFn: () => api.get<{ rows: Array<{ id: string; name: string; type: string; provider: string | null }> }>('/accounts') })
  const { data: held } = useQuery({ queryKey: ['held'], queryFn: () => api.get<{ rows: HeldSale[] }>('/held'), enabled: heldOpen })
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: () => api.get<{ values: Record<string, unknown> }>('/settings') })

  const customer = catalog?.customers.find((c) => c.id === customerId) ?? null
  const vatEnabled = !!settings?.values?.vat_enabled
  const vatPercent = Number(settings?.values?.vat_percent ?? 0)

  const subtotal = cart.reduce((a, l) => a + l.qty * l.unit_price, 0)
  const itemDiscount = cart.reduce((a, l) => a + l.discount, 0)
  const invDisc = Math.min(invoiceDiscount, subtotal - itemDiscount)
  const taxable = subtotal - itemDiscount - invDisc
  const tax = vatEnabled ? Math.round((taxable * vatPercent * 100) / 10000) : 0
  const total = taxable + tax

  const filteredProducts = productData?.rows ?? []
  const products = useMemo(() => filteredProducts, [filteredProducts])

  const addProduct = (p: Prod, qty = 1) => {
    setCart((c) => {
      const idx = c.findIndex((l) => l.product_id === p.id)
      if (idx >= 0) {
        const next = [...c]
        next[idx] = { ...next[idx], qty: Math.round((next[idx].qty + qty) * 1000) / 1000 }
        return next
      }
      return [...c, {
        product_id: p.id, name: p.name, qty, unit_price: p.selling_price, discount: 0,
        stock: p.stock, track_stock: !!p.track_stock, unit: p.unit_short
      }]
    })
  }

  const findByBarcode = async (code: string) => {
    try {
      const res = await api.get<{ product: Prod | null }>(`/products/barcode/${encodeURIComponent(code)}`)
      if (res.product) {
        addProduct(res.product)
        setSearch('')
        return true
      }
    } catch { /* fallthrough */ }
    return false
  }

  const onScanEnter = async () => {
    const q = search.trim()
    if (!q) return
    const found = await findByBarcode(q)
    if (!found) {
      // not a barcode → treat as search; if exactly one match add it
      const matches = (productData?.rows ?? []).filter((p) => p.name.toLowerCase().includes(q.toLowerCase()) || p.sku?.toLowerCase() === q.toLowerCase())
      if (matches.length === 1) addProduct(matches[0])
      else if (matches.length === 0) toast(`"${q}" — এই বারকোড/পণ্য পাওয়া যায়নি`, 'warning')
    }
  }

  const setQty = (pid: string, qty: number) => {
    setCart((c) => c.map((l) => (l.product_id === pid ? { ...l, qty: Math.max(0, Math.round(qty * 1000) / 1000) } : l)).filter((l) => l.qty > 0))
  }

  const cartCount = cart.reduce((a, l) => a + l.qty, 0)

  const clearCart = () => { setCart([]); setCustomerId(null); setInvoiceDiscount(0) }

  const holdSale = async () => {
    if (cart.length === 0) return
    try {
      await api.post('/held', { label: `${cartCount} আইটেম · ${money(total)}`, cart: { lines: cart, customer_id: customerId, invoice_discount: invoiceDiscount } })
      clearCart()
      toast('বিল হোল্ড করা হয়েছে', 'success')
      void qc.invalidateQueries({ queryKey: ['held'] })
    } catch (e) { toast((e as Error).message, 'error') }
  }

  const resumeSale = (h: HeldSale) => {
    try {
      const parsed = JSON.parse(h.cart_json) as { lines: CartLine[]; customer_id: string | null; invoice_discount: number }
      setCart(parsed.lines)
      setCustomerId(parsed.customer_id)
      setInvoiceDiscount(parsed.invoice_discount ?? 0)
      setHeldOpen(false)
      void api.del(`/held/${h.id}`)
      void qc.invalidateQueries({ queryKey: ['held'] })
    } catch { toast('হোল্ড করা বিলটি পড়া যায়নি', 'error') }
  }

  /* ───────────── keyboard shortcuts (F-keys don't clash with OS) ───────────── */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (payOpen || custOpen || newCustOpen || heldOpen) return
      if (e.key === 'F2') { e.preventDefault(); scanRef.current?.focus(); scanRef.current?.select() }
      if (e.key === 'F4' && cart.length > 0) { e.preventDefault(); setPayOpen(true) }
      if (e.key === 'F8' && cart.length > 0) { e.preventDefault(); void holdSale() }
      if (e.key === 'F9' && cart.length > 0) { e.preventDefault(); setPayOpen(true) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const completeSale = async (payments: Array<{ account_id: string; amount: number; method: string }>, printReceipt: boolean) => {
    setCompleting(true)
    try {
      const res = await api.post<{ sale: { id: string; invoice_no: string; total: number; due: number; paid: number; payment_method: string; date: number; note: string | null; customer_name: string | null }; items: Array<{ name: string; qty: number; unit_price: number; discount: number; line_total: number; unit: string | null }> }>('/sales', {
        customer_id: customerId,
        items: cart.map((l) => ({ product_id: l.product_id, qty: l.qty, unit_price: l.unit_price, discount: l.discount })),
        invoice_discount: invDisc,
        payments
      })
      const s = res.sale
      clearCart()
      setPayOpen(false)
      setLastSale({ invoice_no: s.invoice_no, total: s.total, due: s.due })
      toast(`${t('pos_sale_complete')} — ${s.invoice_no}`, 'success')
      void qc.invalidateQueries()

      if (printReceipt && business) {
        const html = invoiceHtml(
          biz.info,
          {
            invoice_no: s.invoice_no, date: s.date, customer_name: customer?.name ?? null, customer_phone: customer?.phone ?? null,
            items: res.items.map((i) => ({ ...i })), subtotal, item_discount: itemDiscount, invoice_discount: invDisc,
            tax, total: s.total, paid: s.paid, due: s.due, payment_method: s.payment_method,
            note: s.note, user_name: me?.user.name ?? '', footer: String(settings?.values?.receipt_footer ?? 'কেনার জন্য ধন্যবাদ!')
          },
          (String(settings?.values?.receipt_paper ?? '80mm') as '80mm')
        )
        void printDoc(html, { paper: String(settings?.values?.receipt_paper ?? '80mm') as '80mm', printer: String(settings?.values?.default_printer ?? '') || undefined })
      }
      scanRef.current?.focus()
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally { setCompleting(false) }
  }

  return (
    <div className="pos-grid">
      {/* LEFT — search + catalog */}
      <div className="pos-left">
        <div style={{ display: 'flex', gap: 8 }}>
          <div className="search-box grow">
            <ScanBarcode size={17} />
            <input
              ref={scanRef}
              className="input"
              style={{ height: 42, fontSize: 15, paddingLeft: 38 }}
              placeholder={t('pos_scan_ph')}
              value={search}
              autoFocus
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void onScanEnter() }}
            />
          </div>
          <button className="btn btn-secondary" style={{ height: 42 }} onClick={() => setHeldOpen(true)}>
            <Pause size={16} /> {t('pos_resume')}
          </button>
        </div>

        <div className="pos-cats">
          <button className={`chip ${category === '' ? 'active' : ''}`} onClick={() => setCategory('')}>সব</button>
          {catalog?.categories.map((c) => (
            <button key={c.id} className={`chip ${category === c.id ? 'active' : ''}`} onClick={() => setCategory(category === c.id ? '' : c.id)}>{c.name}</button>
          ))}
        </div>

        <div className="pos-results">
          {isLoading ? (
            <div style={{ padding: 40, textAlign: 'center' }}><Spinner size={20} /></div>
          ) : products.length === 0 ? (
            <EmptyState
              title="কোনো পণ্য পাওয়া যায়নি"
              sub={search ? 'বানান বদলে খুঁজুন বা বারকোড স্ক্যান করুন' : 'পণ্য যোগ করে POS শুরু করুন'}
              icon={<PackageSearch size={22} />}
              action={<button className="btn btn-secondary btn-sm" onClick={() => navigate('/products/new')}>{t('add_product')}</button>}
            />
          ) : (
            <div className="pos-prod-list">
              {products.map((p) => {
                const out = p.track_stock && p.stock <= 0
                const low = p.track_stock && p.stock > 0 && p.stock <= 5
                return (
                  <button key={p.id} className="pos-prod-row" onClick={() => addProduct(p)} disabled={!!out}>
                    <div className="grow" style={{ minWidth: 0 }}>
                      <div className="pos-prod-name ellip">{p.name}</div>
                      <div className="pos-prod-meta">
                        {p.sku ? `SKU ${p.sku} · ` : ''}
                        {p.track_stock ? (
                          <span style={{ color: out ? 'var(--danger-text)' : low ? 'var(--warning-text)' : undefined }}>
                            {out ? t('pos_out_of_stock') : `${t('pos_stock_left')} ${num(p.stock, p.stock % 1 ? 2 : 0)}`}
                          </span>
                        ) : 'স্টক হিসাব নেই'}
                        {p.category_name ? ` · ${p.category_name}` : ''}
                      </div>
                    </div>
                    <div className="pos-prod-price num">{money(p.selling_price)}</div>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* RIGHT — cart */}
      <div className="pos-right">
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <div className="grow">
            <div className="strong" style={{ fontSize: 15 }}>{t('pos_cart')}</div>
            <div className="small muted num">{num(cartCount)} আইটেম</div>
          </div>
          {cart.length > 0 ? (
            <>
              <button className="btn btn-ghost btn-sm" onClick={() => setClearOpen(true)}>
                <Trash2 size={14} /> খালি
              </button>
              <button className="btn btn-secondary btn-sm" onClick={() => void holdSale()}>
                <Pause size={14} /> {t('pos_hold')} <Kbd>F8</Kbd>
              </button>
            </>
          ) : null}
        </div>

        {/* customer bar */}
        <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8 }}>
          {customer ? (
            <>
              <span className="avatar" style={{ width: 28, height: 28, fontSize: 12 }}>{customer.name.slice(0, 1)}</span>
              <div className="grow ellip">
                <div className="strong ellip" style={{ fontSize: 13 }}>{customer.name}</div>
                <div className="small muted">{customer.phone ?? ''} {customer.receivable > 0 ? `· বকেয়া ${money(customer.receivable)}` : ''}</div>
              </div>
              <button className="btn btn-ghost btn-sm" onClick={() => setCustomerId(null)}><X size={13} /></button>
            </>
          ) : (
            <>
              <div className="grow small muted">নগদ গ্রাহক — বাকিতে দিতে চাইলে গ্রাহক বাছুন</div>
              <button className="btn btn-secondary btn-sm" onClick={() => { setCustSearch(''); setCustOpen(true) }}>
                <Tag size={13} /> {t('pos_select_customer')}
              </button>
              <button className="btn btn-ghost btn-sm btn-icon" aria-label={t('pos_add_customer')} title={t('pos_add_customer')} onClick={() => setNewCustOpen(true)}>
                <UserPlus size={15} />
              </button>
            </>
          )}
        </div>

        {/* cart lines */}
        <div className="cart-list">
          {cart.length === 0 ? (
            <EmptyState title={t('pos_empty_cart')} sub={t('pos_empty_cart_sub')} icon={<ScanBarcode size={22} />} />
          ) : cart.map((l) => (
            <div key={l.product_id} className="cart-row">
              <div className="grow" style={{ minWidth: 0 }}>
                <div className="cart-name ellip">{l.name}</div>
                <div className="cart-meta num">
                  {money(l.unit_price)}{l.unit ? `/${l.unit}` : ''}
                  {l.discount > 0 ? ` − ${money(l.discount)} ছাড়` : ''}
                  {l.track_stock && l.qty > l.stock ? <span style={{ color: 'var(--danger-text)' }}> · স্টক {num(l.stock, l.stock % 1 ? 2 : 0)}!</span> : ''}
                </div>
              </div>
              <div className="cart-qty">
                <button onClick={() => setQty(l.product_id, l.qty - 1)} aria-label={t('pos_qty_minus')}><Minus size={12} /></button>
                <input
                  value={l.qty}
                  onChange={(e) => { const v = Number(e.target.value.replace(/[^\d.]/g, '')); if (!Number.isNaN(v)) setQty(l.product_id, v) }}
                  onFocus={(e) => e.target.select()}
                />
                <button onClick={() => setQty(l.product_id, l.qty + 1)} aria-label={t('pos_qty_plus')}><Plus size={12} /></button>
              </div>
              <div className="cart-line-total num">{money(l.qty * l.unit_price - l.discount)}</div>
              <Menu trigger={<button className="btn btn-ghost btn-sm btn-icon" aria-label="আরও"><FileText size={14} /></button>}>
                {can(PERMS.POS_PRICE_OVERRIDE) ? (
                  <MenuItem icon={<Tag size={14} />} onClick={() => setPriceEdit({ line: l, value: String(l.unit_price / 100) })}>{t('pos_price_edit')}</MenuItem>
                ) : null}
                {can(PERMS.POS_DISCOUNT) ? (
                  <MenuItem icon={<ReceiptText size={14} />} onClick={() => setDiscountEdit({ line: l, value: String(l.discount / 100) })}>{t('pos_item_discount')}</MenuItem>
                ) : null}
                <div className="menu-sep" />
                <MenuItem icon={<Trash2 size={14} />} danger onClick={() => setQty(l.product_id, 0)}>{t('pos_remove_item')}</MenuItem>
              </Menu>
            </div>
          ))}
        </div>

        {/* summary */}
        <div className="cart-summary">
          <div className="sum-row">
            <span>{t('subtotal')}</span>
            <span className="num">{money(subtotal)}</span>
          </div>
          {itemDiscount > 0 || invDisc > 0 ? (
            <div className="sum-row" style={{ color: 'var(--success-text)' }}>
              <span>{t('discount')}</span>
              <span className="num">− {money(itemDiscount + invDisc)}</span>
            </div>
          ) : null}
          {vatEnabled ? (
            <div className="sum-row">
              <span>{t('vat')} ({vatPercent}%)</span>
              <span className="num">{money(tax)}</span>
            </div>
          ) : null}
          {can(PERMS.POS_DISCOUNT) ? (
            <div className="sum-row" style={{ marginTop: 4 }}>
              <span className="small">{t('pos_invoice_discount')}</span>
              <input
                className="input input-money"
                style={{ height: 28, width: 110, fontSize: 12.5 }}
                value={invoiceDiscount ? String(invoiceDiscount / 100) : ''}
                placeholder="০"
                onChange={(e) => setInvoiceDiscount(Math.round(Number(e.target.value.replace(/[^\d.]/g, '')) * 100) || 0)}
                onFocus={(e) => e.target.select()}
              />
            </div>
          ) : null}
          <div className="sum-row big">
            <span>{t('pos_total_payable')}</span>
            <span className="num">{money(total)}</span>
          </div>
          <button
            className="btn btn-primary btn-lg btn-block"
            style={{ marginTop: 10 }}
            disabled={cart.length === 0 || completing}
            onClick={() => setPayOpen(true)}
          >
            {completing ? <Spinner size={16} /> : <Wallet size={17} />}
            {t('pos_pay_now')} · {money(total)} <Kbd>F4</Kbd>
          </button>
          <div className="small muted text-center" style={{ marginTop: 8 }}>{t('pos_keyboard_hint')}</div>
        </div>
      </div>

      {/* ───────────── overlays ───────────── */}
      {payOpen ? (
        <PaymentModal
          total={total}
          accounts={accounts?.rows ?? []}
          customer={customer}
          busy={completing}
          vatNote={vatEnabled ? `ভ্যাট অন্তর্ভুক্ত ${money(tax)}` : undefined}
          onClose={() => setPayOpen(false)}
          onDone={(payments, print) => void completeSale(payments, print)}
        />
      ) : null}

      {/* customer picker */}
      <Modal open={custOpen} onClose={() => setCustOpen(false)} title={t('pos_select_customer')} size="md"
        footer={<button className="btn btn-secondary" onClick={() => { setCustOpen(false); setNewCustOpen(true) }}><UserPlus size={14} /> {t('pos_add_customer')}</button>}>
        <SearchInline value={custSearch} onChange={setCustSearch} />
        <div style={{ marginTop: 10, maxHeight: 320, overflowY: 'auto' }} className="flex flex-col gap-1">
          {(catalog?.customers ?? [])
            .filter((c) => !custSearch || c.name.toLowerCase().includes(custSearch.toLowerCase()) || c.phone?.includes(custSearch))
            .slice(0, 30)
            .map((c) => (
              <button key={c.id} className="recent-row clickable" style={{ borderRadius: 8 }} onClick={() => { setCustomerId(c.id); setCustOpen(false) }}>
                <span className="avatar" style={{ width: 28, height: 28, fontSize: 12 }}>{c.name.slice(0, 1)}</span>
                <div className="grow ellip">
                  <div className="strong ellip" style={{ fontSize: 13 }}>{c.name}</div>
                  <div className="small muted">{c.phone ?? ''}</div>
                </div>
                {c.receivable > 0 ? <Badge tone="warning">{money(c.receivable)}</Badge> : null}
              </button>
            ))}
          {(catalog?.customers ?? []).length === 0 ? <div className="empty"><p>কোনো গ্রাহক নেই — নতুন যোগ করুন</p></div> : null}
        </div>
      </Modal>

      {/* quick customer create */}
      <NewCustomerModal
        open={newCustOpen}
        onClose={() => setNewCustOpen(false)}
        onCreated={(c) => { setCustomerId(c.id); setNewCustOpen(false); void qc.invalidateQueries({ queryKey: ['catalog'] }) }}
      />

      {/* held sales */}
      <Modal open={heldOpen} onClose={() => setHeldOpen(false)} title={t('pos_held_sales')} size="md">
        {(held?.rows ?? []).length === 0 ? (
          <EmptyState title={t('pos_no_held')} icon={<Pause size={20} />} />
        ) : (
          <div className="flex flex-col gap-2">
            {held!.rows.map((h) => (
              <div key={h.id} className="recent-row" style={{ border: '1px solid var(--border)', borderRadius: 10 }}>
                <Play size={15} color="var(--primary)" />
                <div className="grow">
                  <div className="strong" style={{ fontSize: 13 }}>{h.label}</div>
                  <div className="small muted">হোল্ড: {new Date(h.created_at).toLocaleTimeString('bn-BD')}</div>
                </div>
                <button className="btn btn-primary btn-sm" onClick={() => resumeSale(h)}>{t('pos_resume')}</button>
              </div>
            ))}
          </div>
        )}
      </Modal>

      {/* price edit */}
      <Modal
        open={!!priceEdit}
        onClose={() => setPriceEdit(null)}
        title={t('pos_price_edit')}
        sub={priceEdit?.line.name}
        size="sm"
        footer={
          <>
            <button className="btn btn-secondary" onClick={() => setPriceEdit(null)}>{t('cancel')}</button>
            <button
              className="btn btn-primary"
              onClick={() => {
                const v = Math.round(Number(priceEdit!.value.replace(/[^\d.]/g, '')) * 100) || 0
                setCart((c) => c.map((x) => (x.product_id === priceEdit!.line.product_id ? { ...x, unit_price: v } : x)))
                setPriceEdit(null)
              }}
            >
              {t('save')}
            </button>
          </>
        }
      >
        <Field label={`${t('selling_price')} (৳)`} required>
          <input
            className="input input-money"
            value={priceEdit?.value ?? ''}
            onChange={(e) => setPriceEdit((p) => (p ? { ...p, value: e.target.value } : p))}
            autoFocus
            onFocus={(e) => e.target.select()}
            onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
          />
        </Field>
      </Modal>

      {/* line discount */}
      <Modal
        open={!!discountEdit}
        onClose={() => setDiscountEdit(null)}
        title={t('pos_item_discount')}
        sub={discountEdit?.line.name}
        size="sm"
        footer={
          <>
            <button className="btn btn-secondary" onClick={() => setDiscountEdit(null)}>{t('cancel')}</button>
            <button
              className="btn btn-primary"
              onClick={() => {
                const v = Math.round(Number(discountEdit!.value.replace(/[^\d.]/g, '')) * 100) || 0
                setCart((c) => c.map((x) => (x.product_id === discountEdit!.line.product_id ? { ...x, discount: Math.min(v, Math.round(x.qty * x.unit_price)) } : x)))
                setDiscountEdit(null)
              }}
            >
              {t('save')}
            </button>
          </>
        }
      >
        <Field label={`${t('discount')} (৳)`} required hint="আইটেমের মোট মূল্যের মধ্যে সীমাবদ্ধ">
          <input
            className="input input-money"
            value={discountEdit?.value ?? ''}
            onChange={(e) => setDiscountEdit((p) => (p ? { ...p, value: e.target.value } : p))}
            autoFocus
            onFocus={(e) => e.target.select()}
          />
        </Field>
      </Modal>

      <ConfirmDialog
        open={clearOpen}
        onClose={() => setClearOpen(false)}
        onConfirm={() => { setClearOpen(false); clearCart() }}
        title={t('pos_clear_confirm')}
        body="কার্টের সব আইটেম মুছে যাবে। এটি ফেরানো যাবে না।"
        confirmLabel="খালি করুন"
        danger
      />

      {/* last sale success */}
      {lastSale ? (
        <div className="modal-overlay" style={{ background: 'rgba(15,23,41,.55)' }} onClick={() => setLastSale(null)}>
          <div className="modal modal-sm" style={{ textAlign: 'center', padding: 28 }} onClick={(e) => e.stopPropagation()}>
            <CheckCircle2 size={44} color="var(--success)" style={{ margin: '0 auto 10px' }} />
            <h2 style={{ fontSize: 18 }}>{t('pos_sale_complete')}</h2>
            <p className="muted" style={{ marginTop: 4, fontSize: 13 }}>{t('pos_sale_complete_sub')}</p>
            <div className="card card-pad" style={{ margin: '16px 0', textAlign: 'left' }}>
              <div className="sum-row"><span>{t('invoice_no')}</span><b className="num">{lastSale.invoice_no}</b></div>
              <div className="sum-row"><span>{t('total')}</span><b className="num">{money(lastSale.total)}</b></div>
              {lastSale.due > 0 ? <div className="sum-row"><span className="neg strong">{t('due')}</span><b className="num neg">{money(lastSale.due)}</b></div> : null}
            </div>
            <div className="flex gap-2">
              <button className="btn btn-secondary grow" onClick={() => navigate(`/sales?invoice=${lastSale.invoice_no}`)}>{t('view_invoice')}</button>
              <button className="btn btn-primary grow" onClick={() => setLastSale(null)}>{t('pos_next_sale')}</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function SearchInline({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="search-box">
      <Search size={15} />
      <input className="input" placeholder="নাম বা ফোন…" value={value} onChange={(e) => onChange(e.target.value)} autoFocus />
    </div>
  )
}

export function NewCustomerModal({ open, onClose, onCreated }: {
  open: boolean
  onClose: () => void
  onCreated: (c: CustomerOpt) => void
}) {
  const { toast } = useToast()
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [due, setDue] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => { if (open) { setName(''); setPhone(''); setDue('') } }, [open])

  const create = async () => {
    if (!name.trim()) return
    setBusy(true)
    try {
      const c = await api.post<CustomerOpt>('/customers', { name: name.trim(), phone: phone.trim() || undefined, opening_due: Math.round(Number(due || 0) * 100) || 0 })
      toast(`${c.name} যোগ হয়েছে`, 'success')
      onCreated(c)
    } catch (e) { toast((e as Error).message, 'error') } finally { setBusy(false) }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('pos_add_customer')}
      size="sm"
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose}>{t('cancel')}</button>
          <button className="btn btn-primary" disabled={!name.trim() || busy} onClick={() => void create()}>{busy ? <Spinner size={14} /> : null}{t('save')}</button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label="নাম" required>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </Field>
        <Field label="ফোন">
          <input className="input" value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="numeric" />
        </Field>
        <Field label="পুরনো বকেয়া (৳)">
          <input className="input input-money" value={due} onChange={(e) => setDue(e.target.value)} inputMode="decimal" />
        </Field>
      </div>
    </Modal>
  )
}


/* ───────────── payment modal — the cash drawer moment ───────────── */

function PaymentModal({ total, accounts, customer, busy, onClose, onDone, vatNote }: {
  total: number
  accounts: Array<{ id: string; name: string; type: string; provider: string | null }>
  customer: CustomerOpt | null
  busy: boolean
  onClose: () => void
  onDone: (payments: Array<{ account_id: string; amount: number; method: string }>, print: boolean) => void
  vatNote?: string
}) {
  const { can } = useSession()
  const cashAccount = accounts.find((a) => a.type === 'cash') ?? accounts[0]
  const [method, setMethod] = useState('cash')
  const [received, setReceived] = useState(total / 100)
  const [accountId, setAccountId] = useState(cashAccount?.id ?? '')
  const [print, setPrint] = useState(true)
  const [rows, setRows] = useState<Array<{ method: string; amount: number; account_id: string }>>([])

  const dueAllowed = can(PERMS.POS_USE) // due governed by customer presence
  const receivedPoisha = Math.round((Number(received) || 0) * 100)
  const change = Math.max(0, receivedPoisha - total)
  const remainDue = Math.max(0, total - receivedPoisha)
  const isFullDue = receivedPoisha === 0
  const dueNeedsCustomer = remainDue > 0 && !customer
  const overpay = receivedPoisha > total

  useEffect(() => {
    const acc = method === 'cash' ? (cashAccount?.id ?? '') : (accounts.find((a) => a.provider === method || a.name.toLowerCase().includes(method))?.id ?? cashAccount?.id ?? '')
    setAccountId(acc)
  }, [method, accounts, cashAccount])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Enter' && !busy && !dueNeedsCustomer && !overpay) submit() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const submit = () => {
    const payments = isFullDue && dueAllowed
      ? []
      : [{ account_id: accountId || cashAccount?.id || '', amount: Math.min(receivedPoisha, total), method }]
    if (!isFullDue && (!payments[0].account_id || payments[0].amount <= 0)) return
    onDone(payments, print)
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={t('pos_payment')}
      sub={vatNote}
      size="md"
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose}>{t('cancel')}</button>
          <button className="btn btn-primary btn-lg" disabled={busy || dueNeedsCustomer || overpay} onClick={submit}>
            {busy ? <Spinner size={15} /> : <CheckCircle2 size={16} />}
            {t('pos_confirm_sale')} · {money(Math.min(receivedPoisha, total))}
          </button>
        </>
      }
    >
      <div style={{ background: 'var(--surface-2)', borderRadius: 12, padding: '14px 18px', marginBottom: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div className="small muted">{t('pos_total_payable')}</div>
          <div style={{ fontSize: 26, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{money(total)}</div>
        </div>
        <label className="check"><input type="checkbox" checked={print} onChange={(e) => setPrint(e.target.checked)} /> {t('pos_print_receipt')}</label>
      </div>

      <Field label={t('payment_method')} required>
        <div className="pay-grid">
          {PAY_METHODS.map((m) => (
            <button key={m.key} className={`pay-opt ${method === m.key ? 'active' : ''}`} onClick={() => setMethod(m.key)}>
              <span style={{ display: 'flex', justifyContent: 'center', marginBottom: 3 }}>{m.icon}</span>
              {m.label}
            </button>
          ))}
        </div>
      </Field>

      {method !== 'cash' ? (
        <Field label="কোন হিসাবে জমা হবে" style={{ marginTop: 12 }}>
          <select className="select" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            {accounts.filter((a) => a.type !== 'cash').map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            {accounts.filter((a) => a.type === 'cash').map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </Field>
      ) : null}

      <Field label={`${t('pos_amount_received')} (৳)`} style={{ marginTop: 12 }} error={overpay ? 'গৃহীত টাকা মোটের চেয়ে বেশি হতে পারে না' : dueNeedsCustomer ? t('pos_shortcash_note') : undefined}>
        <input
          className="input input-money"
          style={{ height: 44, fontSize: 20, fontWeight: 700 }}
          value={String(received)}
          inputMode="decimal"
          onChange={(e) => setReceived(Number(e.target.value.replace(/[^\d.]/g, '')) || 0)}
          autoFocus
          onFocus={(e) => e.target.select()}
        />
      </Field>

      <div className="quick-cash" style={{ marginTop: 8 }}>
        <button onClick={() => setReceived(total / 100)}>সম্পূর্ণ</button>
        <button onClick={() => setReceived(0)}>{t('pos_full_due')}</button>
        {[100, 200, 500, 1000, 2000, 5000].map((v) => (
          <button key={v} onClick={() => setReceived((r) => (Number(r) || 0) + v)}>+{v}</button>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
        {change > 0 ? (
          <div className="alert alert-success grow" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
            <b>{t('pos_change_return')}</b>
            <b style={{ fontSize: 18, fontVariantNumeric: 'tabular-nums' }}>{money(change)}</b>
          </div>
        ) : null}
        {remainDue > 0 ? (
          <div className={`alert ${customer ? 'alert-warning' : 'alert-danger'} grow`} style={{ justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <b>{t('pos_remaining_due')}</b>
              {!customer ? <div className="small">{t('pos_shortcash_note')}</div> : null}
            </div>
            <b style={{ fontSize: 18, fontVariantNumeric: 'tabular-nums' }}>{money(remainDue)}</b>
          </div>
        ) : null}
      </div>
    </Modal>
  )
}
