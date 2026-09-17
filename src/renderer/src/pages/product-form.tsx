import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Plus, CheckCircle2 } from 'lucide-react'
import { api } from '@/api/client'
import { useToast } from '@/state/toast'
import { t, money, num, fdatetime } from '@/i18n/bn'
import { PageHeader, Loading, LoadError, Field, Modal, Badge, type Column, DataTable } from '@/ui/components'

interface ProdForm {
  id?: string
  name: string
  sku: string
  barcode: string
  category_id: string
  brand_id: string
  unit: string
  buying_price: string
  selling_price: string
  opening_stock: string
  low_stock: string
  tax_percent: string
  track_stock: boolean
  status: string
}

export function ProductForm({ mode }: { mode: 'new' | 'edit' }) {
  const { id } = useParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { toast } = useToast()

  const [f, setF] = useState<ProdForm>({
    name: '', sku: '', barcode: '', category_id: '', brand_id: '', unit: '',
    buying_price: '', selling_price: '', opening_stock: '', low_stock: '5', tax_percent: '0', track_stock: true, status: 'active'
  })
  const [busy, setBusy] = useState(false)
  const [newCatOpen, setNewCatOpen] = useState(false)
  const [newBrandOpen, setNewBrandOpen] = useState(false)
  const [newCat, setNewCat] = useState('')
  const [newBrand, setNewBrand] = useState('')

  const { data: catalog } = useQuery({ queryKey: ['catalog'], queryFn: () => api.get<{ categories: Array<{ id: string; name: string }>; brands: Array<{ id: string; name: string }>; units: Array<{ id: string; name: string; short: string }> }>('/catalog') })

  const isEdit = mode === 'edit'
  const { data: prodRes, isLoading, error } = useQuery({
    queryKey: ['product', id],
    queryFn: () => api.get<{ product: ProdFull }>(`/products/${id}`),
    enabled: isEdit && !!id
  })
  const existing = prodRes?.product
  const { data: movements } = useQuery({
    queryKey: ['product-movement', id],
    queryFn: () => api.get<{ rows: Array<{ id: string; created_at: number; type: string; ref_type: string | null; qty: number; balance_after: number; reason: string | null }> }>('/inventory/movements', { product_id: id, pageSize: 50 }),
    enabled: isEdit && !!id
  })
  interface ProdFull {
    id: string; name: string; sku: string | null; barcode: string | null; category_id: string | null; brand_id: string | null
    unit_id: string | null; purchase_price: number; selling_price: number; tax_rate_bps: number
    track_stock: number; min_stock: number; stock: number; wac: number; status: string
  }

  useEffect(() => {
    if (isEdit && existing) {
      setF((x) => ({
        ...x,
        name: existing.name, sku: existing.sku ?? '', barcode: existing.barcode ?? '',
        category_id: existing.category_id ?? '', brand_id: existing.brand_id ?? '',
        buying_price: String(existing.purchase_price / 100), selling_price: String(existing.selling_price / 100),
        low_stock: String(existing.min_stock ?? 0), tax_percent: String((existing.tax_rate_bps ?? 0) / 100),
        track_stock: !!existing.track_stock, status: existing.status
      }))
    }
  }, [existing, isEdit])

  const submit = async () => {
    if (!f.name.trim()) { toast('পণ্যের নাম দিন', 'warning'); return }
    const payload: Record<string, unknown> = {
      name: f.name.trim(), sku: f.sku.trim() || null, barcode: f.barcode.trim() || null,
      category_id: f.category_id || null, brand_id: f.brand_id || null, unit_id: f.unit || null,
      purchase_price: Math.round(Number(f.buying_price || 0) * 100),
      selling_price: Math.round(Number(f.selling_price || 0) * 100),
      min_stock: Number(f.low_stock || 0), tax_rate_bps: Math.round(Number(f.tax_percent || 0) * 100),
      track_stock: f.track_stock, status: f.status
    }
    if (!isEdit) {
      payload.opening_stock = Number(f.opening_stock || 0)
      payload.opening_cost = Math.round(Number(f.buying_price || 0) * 100)
    }
    setBusy(true)
    try {
      if (isEdit && id) await api.patch(`/products/${id}`, payload)
      else await api.post('/products', payload)
      void qc.invalidateQueries()
      toast(isEdit ? 'পণ্য হালনাগাদ হয়েছে' : 'পণ্য যোগ হয়েছে', 'success')
      navigate('/products')
    } catch (e) { toast((e as Error).message, 'error') } finally { setBusy(false) }
  }

  const createCat = async () => {
    if (!newCat.trim()) return
    try {
      const c = await api.post<{ id: string }>('/categories', { name: newCat.trim() })
      void qc.invalidateQueries({ queryKey: ['catalog'] })
      setF((x) => ({ ...x, category_id: c.id }))
      setNewCatOpen(false); setNewCat('')
    } catch (e) { toast((e as Error).message, 'error') }
  }
  const createBrand = async () => {
    if (!newBrand.trim()) return
    try {
      const b = await api.post<{ id: string }>('/brands', { name: newBrand.trim() })
      void qc.invalidateQueries({ queryKey: ['catalog'] })
      setF((x) => ({ ...x, brand_id: b.id }))
      setNewBrandOpen(false); setNewBrand('')
    } catch (e) { toast((e as Error).message, 'error') }
  }

  if (isEdit && isLoading) return <div className="page"><Loading /></div>
  if (isEdit && error) return <div className="page"><LoadError /></div>

  return (
    <div className="page" style={{ maxWidth: 900 }}>
      <PageHeader
        title={<span className="flex items-center gap-2"><button className="btn btn-ghost btn-sm btn-icon" aria-label="ফিরে যান" onClick={() => navigate(-1)}><ArrowLeft size={16} /></button>{isEdit ? t('edit_product') : t('new_product')}</span>}
        sub={isEdit ? 'পণ্যের তথ্য হালনাগাদ করুন' : 'নতুন পণ্য স্টকে যোগ করুন'}
      />

      <div className="grid-2" style={{ alignItems: 'start' }}>
        <div className="card card-pad flex flex-col gap-3">
          <Field label="পণ্যের নাম" required>
            <input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus />
          </Field>
          <div className="grid-2">
            <Field label="SKU" hint="ইউনিক কোড (ঐচ্ছিক)">
              <input className="input num" value={f.sku} onChange={(e) => setF({ ...f, sku: e.target.value })} />
            </Field>
            <Field label="বারকোড" hint="স্ক্যান করে দিন">
              <input className="input num" value={f.barcode} onChange={(e) => setF({ ...f, barcode: e.target.value })}
                onKeyDown={(e) => { if (e.key === 'Enter') e.preventDefault() }} />
            </Field>
          </div>
          <div className="grid-2">
            <Field label={t('cat_brand').split(' · ')[0]}>
              <div style={{ display: 'flex', gap: 6 }}>
                <select className="select" value={f.category_id} onChange={(e) => setF({ ...f, category_id: e.target.value })}>
                  <option value="">—</option>
                  {(catalog?.categories ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <button aria-label="নতুন ক্যাটাগরি" className="btn btn-secondary btn-icon" title="নতুন ক্যাটাগরি" onClick={() => setNewCatOpen(true)}><Plus size={14} /></button>
              </div>
            </Field>
            <Field label={t('cat_brand').split(' · ')[1] ?? 'ব্র্যান্ড'}>
              <div style={{ display: 'flex', gap: 6 }}>
                <select className="select" value={f.brand_id} onChange={(e) => setF({ ...f, brand_id: e.target.value })}>
                  <option value="">—</option>
                  {(catalog?.brands ?? []).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
                <button aria-label="নতুন ব্র্যান্ড" className="btn btn-secondary btn-icon" title="নতুন ব্র্যান্ড" onClick={() => setNewBrandOpen(true)}><Plus size={14} /></button>
              </div>
            </Field>
          </div>
          <div className="grid-2">
            <Field label={t('buying_price')} required hint="সরবরাহকারীর দর (৳)">
              <input className="input input-money" value={f.buying_price} onChange={(e) => setF({ ...f, buying_price: e.target.value.replace(/[^\d.]/g, '') })} inputMode="decimal" />
            </Field>
            <Field label={t('selling_price')} required hint="বিক্রয় দর (৳)">
              <input className="input input-money" value={f.selling_price} onChange={(e) => setF({ ...f, selling_price: e.target.value.replace(/[^\d.]/g, '') })} inputMode="decimal" />
            </Field>
          </div>
          <div className="grid-2">
            <Field label="একক">
              <select className="select" value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })}>
                {(catalog?.units ?? []).map((u) => <option key={u.id} value={u.id}>{u.short || u.name}</option>)}
              </select>
            </Field>
            <Field label="ভ্যাট (%)">
              <input className="input input-money" value={f.tax_percent} onChange={(e) => setF({ ...f, tax_percent: e.target.value.replace(/[^\d.]/g, '') })} inputMode="decimal" />
            </Field>
          </div>
          {!isEdit ? (
            <Field label="শুরুর স্টক" hint="এখন হাতে যতটুকু আছে">
              <input className="input input-money" value={f.opening_stock} onChange={(e) => setF({ ...f, opening_stock: e.target.value.replace(/[^\d.]/g, '') })} inputMode="decimal" />
            </Field>
          ) : null}
          <div className="grid-2">
            <Field label="কম স্টক সতর্কতা (এর নিচে)">
              <input className="input input-money" value={f.low_stock} onChange={(e) => setF({ ...f, low_stock: e.target.value.replace(/[^\d.]/g, '') })} inputMode="decimal" />
            </Field>
            <Field label={t('status')}>
              <select className="select" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
                <option value="active">চালু</option>
                <option value="inactive">বন্ধ</option>
              </select>
            </Field>
          </div>
          <label className="check">
            <input type="checkbox" checked={f.track_stock} onChange={(e) => setF({ ...f, track_stock: e.target.checked })} />
            স্টক হিসাব রাখা হবে (সার্ভিসের মতো জিনিস হলে আনচেক করুন)
          </label>

          <button className="btn btn-primary btn-lg btn-block" style={{ marginTop: 6 }} disabled={busy || !f.name.trim()} onClick={() => void submit()}>
            {busy ? <span className="spinner" /> : <CheckCircle2 size={16} />}{isEdit ? t('save') : t('add_product')}
          </button>
        </div>

        {isEdit && existing ? (
          <div className="card" style={{ overflow: 'hidden' }}>
            <div className="card-header">
              <h3>{t('product_movement')}</h3>
              <Badge tone={existing.stock <= 0 ? 'danger' : existing.stock <= existing.min_stock ? 'warning' : 'neutral'}>
                স্টক {num(existing.stock, existing.stock % 1 ? 3 : 0)}
              </Badge>
            </div>
            <DataTable
              columns={[
                { key: 'created_at', header: t('date'), width: 150, render: (r) => <span className="muted small">{fdatetime(r.created_at)}</span> },
                { key: 'type', header: t('type'), width: 110, render: (r) => ({ opening: 'শুরু', purchase: 'ক্রয়', purchase_return: 'ক্রয় ফেরত', sale: 'বিক্রয়', sale_return: 'বিক্রয় ফেরত', adjustment: 'সমন্বয়', damage: 'ক্ষতি', loss: 'হারানো' }[r.type] ?? r.type) },
                { key: 'reason', header: 'কারণ', render: (r) => <span className="small">{r.reason ?? '—'}</span> },
                { key: 'qty', header: 'পরিমাণ', align: 'right', width: 100, render: (r) => <span className={`num ${r.qty >= 0 ? 'pos' : 'neg'}`}>{r.qty >= 0 ? '+' : '−'}{num(Math.abs(r.qty), Math.abs(r.qty) % 1 ? 3 : 0)}</span> },
                { key: 'balance_after', header: 'অবশিষ্ট', align: 'right', width: 90, render: (r) => <span className="num td-strong">{num(r.balance_after, r.balance_after % 1 ? 3 : 0)}</span> }
              ] as Column<{ id: string; created_at: number; type: string; ref_type: string | null; qty: number; balance_after: number; reason: string | null }>[]}
              rows={movements?.rows ?? []}
              rowKey={(r) => r.id}
              maxHeight={480}
              emptyTitle="কোনো মুভমেন্ট নেই"
            />
          </div>
        ) : null}
      </div>

      <Modal open={newCatOpen} onClose={() => setNewCatOpen(false)} title="নতুন ক্যাটাগরি" size="sm"
        footer={<><button className="btn btn-secondary" onClick={() => setNewCatOpen(false)}>{t('cancel')}</button><button className="btn btn-primary" onClick={() => void createCat()}>{t('save')}</button></>}>
        <Field label="ক্যাটাগরির নাম" required><input className="input" value={newCat} onChange={(e) => setNewCat(e.target.value)} autoFocus /></Field>
      </Modal>
      <Modal open={newBrandOpen} onClose={() => setNewBrandOpen(false)} title="নতুন ব্র্যান্ড" size="sm"
        footer={<><button className="btn btn-secondary" onClick={() => setNewBrandOpen(false)}>{t('cancel')}</button><button className="btn btn-primary" onClick={() => void createBrand()}>{t('save')}</button></>}>
        <Field label="ব্র্যান্ডের নাম" required><input className="input" value={newBrand} onChange={(e) => setNewBrand(e.target.value)} autoFocus /></Field>
      </Modal>
    </div>
  )
}
