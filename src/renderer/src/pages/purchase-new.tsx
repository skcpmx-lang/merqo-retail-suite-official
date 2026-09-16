import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Plus, Minus, Trash2, ScanBarcode, CheckCircle2, Search } from 'lucide-react'
import { api } from '@/api/client'
import { useToast } from '@/state/toast'
import { t, money, num } from '@/i18n/bn'
import { Modal, Field, Spinner, EmptyState } from '@/ui/components'
import { PERMS } from '../perm'
import { useSession } from '@/state/session'
import { purchaseHtml, printDoc } from '@/lib/printing'
import { useBusinessInfo } from '@/lib/useBusinessInfo'

interface Prod { id: string; name: string; sku: string | null; buying_price: number; selling_price: number; stock: number; track_stock: boolean; unit_short: string | null }
interface Sup { id: string; name: string; phone: string | null; payable: number }

export function PurchaseNew() {
  const { can } = useSession()
  const { toast } = useToast()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const { info: bizInfo } = useBusinessInfo()

  const [search, setSearch] = useState('')
  const [supplierId, setSupplierId] = useState<string | null>(null)
  const [cart, setCart] = useState<Array<{ product_id: string; name: string; qty: number; unit_cost: number }>>([])
  const [invoiceDiscount, setInvoiceDiscount] = useState(0)
  const [payNow, setPayNow] = useState(0)
  const [note, setNote] = useState('')
  const [scanOpen, setScanOpen] = useState(false)
  const [scanCode, setScanCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [printAfter, setPrintAfter] = useState(false)
  const [done, setDone] = useState<{ ref_no: string; total: number; due: number } | null>(null)
  const scanRef = useRef<HTMLInputElement>(null)

  const { data: catalog } = useQuery({ queryKey: ['catalog-sup'], queryFn: () => api.get<{ suppliers: Sup[] }>('/catalog') })
  const { data: productData } = useQuery({
    queryKey: ['purchase-products', search],
    queryFn: () => api.get<{ rows: Prod[] }>('/products', { search: search || undefined, pageSize: 30, sort: 'name' }),
    staleTime: 10_000
  })
  const { data: accounts } = useQuery({ queryKey: ['accounts'], queryFn: () => api.get<{ rows: Array<{ id: string; name: string; type: string }> }>('/accounts') })

  const supplier = catalog?.suppliers.find((s) => s.id === supplierId) ?? null
  const total = cart.reduce((a, l) => a + l.qty * l.unit_cost, 0)
  const disc = Math.min(invoiceDiscount, total)
  const grand = total - disc

  const addProduct = (p: Prod, qty = 1, cost?: number) => {
    setCart((c) => {
      const idx = c.findIndex((l) => l.product_id === p.id)
      if (idx >= 0) {
        const n = [...c]
        n[idx] = { ...n[idx], qty: Math.round((n[idx].qty + qty) * 1000) / 1000 }
        return n
      }
      return [...c, { product_id: p.id, name: p.name, qty, unit_cost: cost ?? p.buying_price }]
    })
  }

  const setQty = (pid: string, qty: number) =>
    setCart((c) => c.map((l) => (l.product_id === pid ? { ...l, qty: Math.max(0, Math.round(qty * 1000) / 1000) } : l)).filter((l) => l.qty > 0))
  const setCost = (pid: string, cost: number) =>
    setCart((c) => c.map((l) => (l.product_id === pid ? { ...l, unit_cost: Math.max(0, Math.round(cost)) } : l)))

  const scanAdd = async () => {
    const code = scanCode.trim()
    if (!code) return
    try {
      const res = await api.get<{ product: Prod | null }>(`/products/barcode/${encodeURIComponent(code)}`)
      if (res.product) { addProduct(res.product); setScanCode(''); scanRef.current?.focus() }
      else toast('এই বারকোডের পণ্য নেই', 'warning')
    } catch (e) { toast((e as Error).message, 'error') }
  }

  const submit = async () => {
    if (!supplierId) { toast(t('err_supplier_required'), 'warning'); return }
    if (cart.length === 0) { toast('কমপক্ষে একটি পণ্য যোগ করুন', 'warning'); return }
    setBusy(true)
    try {
      const res = await api.post<{ purchase: { id: string; ref_no: string; total: number; due: number } }>('/purchases', {
        supplier_id: supplierId,
        items: cart.map((l) => ({ product_id: l.product_id, qty: l.qty, unit_cost: l.unit_cost })),
        discount: disc,
        payments: payNow > 0 ? [{ account_id: accounts?.rows.find((a) => a.type === 'cash')?.id ?? '', amount: Math.min(payNow, grand), method: 'cash' }] : [],
        note: note || undefined
      })
      void qc.invalidateQueries()
      setDone({ ref_no: res.purchase.ref_no, total: res.purchase.total, due: res.purchase.due })
      if (printAfter && supplier) {
        const html = purchaseHtml(bizInfo, {
          ref_no: res.purchase.ref_no, date: Date.now(), supplier_name: supplier.name, supplier_phone: supplier.phone,
          items: cart.map((l) => ({ name: l.name, qty: l.qty, unit_cost: l.unit_cost, line_total: l.qty * l.unit_cost })),
          invoice_discount: disc, total: grand, paid: Math.min(payNow, grand), due: res.purchase.due, note: note || null, user_name: ''
        })
        void printDoc(html, { paper: 'A4' })
      }
    } catch (e) { toast((e as Error).message, 'error') } finally { setBusy(false) }
  }

  if (done) {
    return (
      <div className="page" style={{ maxWidth: 520, margin: '60px auto' }}>
        <div className="card card-pad" style={{ textAlign: 'center' }}>
          <CheckCircle2 size={44} color="var(--success)" style={{ margin: '0 auto 10px' }} />
          <h2 style={{ fontSize: 18 }}>ক্রয় সম্পন্ন</h2>
          <p className="muted" style={{ fontSize: 13, marginTop: 4 }}>স্টকে পণ্য যোগ হয়েছে</p>
          <div style={{ margin: '16px 0', textAlign: 'left' }}>
            <div className="sum-row"><span>{t('purchase_no')}</span><b className="num">{done.ref_no}</b></div>
            <div className="sum-row"><span>{t('total')}</span><b className="num">{money(done.total)}</b></div>
            {done.due > 0 ? <div className="sum-row"><span className="neg">{t('due')}</span><b className="num neg">{money(done.due)}</b></div> : null}
          </div>
          <div className="flex gap-2">
            <button className="btn btn-secondary grow" onClick={() => navigate('/purchases')}>{t('purchases_title')}</button>
            <button className="btn btn-primary grow" onClick={() => { setDone(null); setCart([]); setSupplierId(null); setPayNow(0); setNote(''); setInvoiceDiscount(0) }}>নতুন ক্রয়</button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="page pos-grid" style={{ height: 'calc(100vh - var(--header-h) - 1px)', maxWidth: 'none', padding: 0 }}>
      {/* left: products */}
      <div className="pos-left">
        <div style={{ display: 'flex', gap: 8 }}>
          <div className="search-box grow">
            <Search size={16} />
            <input className="input" style={{ height: 40, paddingLeft: 36 }} placeholder={t('search_products_ph')} value={search} onChange={(e) => setSearch(e.target.value)} autoFocus />
          </div>
          <button className="btn btn-secondary" onClick={() => { setScanOpen(true); setTimeout(() => scanRef.current?.focus(), 60) }}>
            <ScanBarcode size={16} /> {t('scan_btn')}
          </button>
        </div>
        <div className="pos-results">
          {(productData?.rows ?? []).length === 0 ? (
            <EmptyState title="পণ্য পাওয়া যায়নি" icon={<ScanBarcode size={20} />} />
          ) : (
            <div className="pos-prod-list">
              {(productData?.rows ?? []).map((p) => (
                <button key={p.id} className="pos-prod-row" onClick={() => addProduct(p)}>
                  <div className="grow" style={{ minWidth: 0 }}>
                    <div className="pos-prod-name ellip">{p.name}</div>
                    <div className="pos-prod-meta num">স্টক {num(p.stock, p.stock % 1 ? 2 : 0)} · কেনা {money(p.buying_price)}</div>
                  </div>
                  <div className="pos-prod-price num">{money(p.buying_price)}</div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* right: form */}
      <div className="pos-right">
        <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)' }}>
          <Field label={t('select_supplier')} required>
            <select className="select" value={supplierId ?? ''} onChange={(e) => setSupplierId(e.target.value || null)}>
              <option value="">— সরবরাহকারী বাছুন —</option>
              {(catalog?.suppliers ?? []).map((s) => (
                <option key={s.id} value={s.id}>{s.name}{s.payable > 0 ? ` (পাওনা ${money(s.payable)})` : ''}</option>
              ))}
            </select>
          </Field>
        </div>

        <div className="cart-list">
          {cart.length === 0 ? <EmptyState title="কার্ট খালি" sub="বাম দিক থেকে পণ্য যোগ করুন" icon={<ScanBarcode size={20} />} /> : cart.map((l) => (
            <div key={l.product_id} className="cart-row">
              <div className="grow" style={{ minWidth: 0 }}>
                <div className="cart-name ellip">{l.name}</div>
                <div className="cart-meta num">দর {money(l.unit_cost)}</div>
              </div>
              <div className="cart-qty">
                <button onClick={() => setQty(l.product_id, l.qty - 1)}><Minus size={12} /></button>
                <input value={l.qty} onChange={(e) => setQty(l.product_id, Number(e.target.value.replace(/[^\d.]/g, '')) || 0)} onFocus={(e) => e.target.select()} />
                <button onClick={() => setQty(l.product_id, l.qty + 1)}><Plus size={12} /></button>
              </div>
              <input
                className="input input-money"
                style={{ width: 84, height: 26, fontSize: 12.5 }}
                value={String(l.unit_cost / 100)}
                onChange={(e) => setCost(l.product_id, Math.round(Number(e.target.value.replace(/[^\d.]/g, '')) * 100) || 0)}
                onFocus={(e) => e.target.select()}
              />
              <div className="cart-line-total num">{money(l.qty * l.unit_cost)}</div>
              <button className="btn btn-ghost btn-sm btn-icon" onClick={() => setQty(l.product_id, 0)}><Trash2 size={13} /></button>
            </div>
          ))}
        </div>

        <div className="cart-summary">
          <div className="sum-row"><span>{t('subtotal')}</span><span className="num">{money(total)}</span></div>
          <div className="sum-row">
            <span className="small">চালান ছাড় (৳)</span>
            <input className="input input-money" style={{ height: 28, width: 100, fontSize: 12.5 }} value={invoiceDiscount ? String(invoiceDiscount / 100) : ''} onChange={(e) => setInvoiceDiscount(Math.round(Number(e.target.value.replace(/[^\d.]/g, '')) * 100) || 0)} onFocus={(e) => e.target.select()} />
          </div>
          <div className="sum-row big"><span>{t('total')}</span><span className="num">{money(grand)}</span></div>
          <div className="sum-row">
            <span className="small">এখনই পরিশোধ (৳)</span>
            <input className="input input-money" style={{ height: 28, width: 100, fontSize: 12.5 }} value={payNow ? String(payNow / 100) : ''} onChange={(e) => setPayNow(Math.round(Number(e.target.value.replace(/[^\d.]/g, '')) * 100) || 0)} onFocus={(e) => e.target.select()} placeholder="0" />
          </div>
          {grand - payNow > 0 ? <div className="sum-row"><span className="neg">{t('due')} (সরবরাহকারীকে)</span><span className="num neg">{money(grand - payNow)}</span></div> : null}
          <Field label={t('note')} style={{ marginTop: 8 }}>
            <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="ঐচ্ছিক" />
          </Field>
          <div className="hint" style={{ marginTop: 2 }}>কেনার দর অনুযায়ী পণ্যের গড় মূল্য (WAC) স্বয়ংক্রিয়ভাবে হালনাগাদ হবে</div>
          <label className="check">
            <input type="checkbox" checked={printAfter} onChange={(e) => setPrintAfter(e.target.checked)} />
            সম্পন্ন করার পর প্রিন্ট
          </label>
          <button className="btn btn-primary btn-lg btn-block" style={{ marginTop: 10 }} disabled={busy || !supplierId || cart.length === 0} onClick={() => void submit()}>
            {busy ? <Spinner size={15} /> : <CheckCircle2 size={16} />} {t('purchase_create')} · {money(grand)}
          </button>
        </div>
      </div>

      {/* scan modal */}
      <Modal open={scanOpen} onClose={() => setScanOpen(false)} title={t('scan_btn')} sub="বারকোড স্ক্যানারে স্ক্যান করুন বা টাইপ করে Enter চাপুন" size="sm"
        footer={<button className="btn btn-secondary" onClick={() => setScanOpen(false)}>{t('cancel')}</button>}>
        <input ref={scanRef} className="input input-lg" value={scanCode} onChange={(e) => setScanCode(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void scanAdd() }} placeholder="বারকোড…" autoFocus />
        <div className="small muted" style={{ marginTop: 8 }}>প্রতিটি স্ক্যানে ১টি করে পণ্য যোগ হবে</div>
      </Modal>
    </div>
  )
}
