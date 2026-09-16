import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Printer, Ban, RotateCcw, FileDown } from 'lucide-react'
import { api } from '@/api/client'
import { useSession } from '@/state/session'
import { useToast } from '@/state/toast'
import { t, money, num, fdatetime, ftime } from '@/i18n/bn'
import { PageHeader, Loading, LoadError, Modal, Field, Badge, ConfirmDialog, type Column, DataTable } from '@/ui/components'
import { PERMS } from '../perm'
import { invoiceHtml, printDoc, savePdf, methodBn } from '@/lib/printing'
import { useBusinessInfo } from '@/lib/useBusinessInfo'

interface SaleDetail {
  sale: {
    id: string; invoice_no: string; date: number; customer_id: string | null; customer_name: string | null
    customer_phone: string | null; subtotal: number; item_discount: number; invoice_discount: number
    tax: number; total: number; paid: number; due: number; payment_method: string; status: string
    note: string | null; user_name: string | null
  }
  items: Array<{
    id: string; product_id: string; name: string; qty: number; unit_price: number; discount: number
    line_total: number; cost: number; returned_qty: number; unit: string | null
  }>
  payments: Array<{ id: string; account_name: string; method: string; amount: number; date: number }>
  returns: Array<{ id: string; invoice_no: string; date: number; amount: number; refund_mode: string; restock: number; reason: string | null; user_name: string | null }>
  returned_total: number
}

export function SaleDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { toast } = useToast()
  const { can } = useSession()
  const { info: bizInfo } = useBusinessInfo()

  const [returnOpen, setReturnOpen] = useState(false)
  const [voidOpen, setVoidOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['sale', id],
    queryFn: () => api.get<SaleDetail>(`/sales/${id}`)
  })

  const doPrint = (save?: boolean) => {
    if (!data) return
    const s = data.sale
    const html = invoiceHtml(bizInfo, {
      invoice_no: s.invoice_no, date: s.date, customer_name: s.customer_name, customer_phone: s.customer_phone,
      items: data.items.map((i) => ({ name: i.name, qty: i.qty, unit_price: i.unit_price, discount: i.discount, line_total: i.line_total, unit: i.unit })),
      subtotal: s.subtotal, item_discount: s.item_discount, invoice_discount: s.invoice_discount,
      tax: s.tax, total: s.total, paid: s.paid, due: s.due, payment_method: s.payment_method,
      note: s.note, user_name: s.user_name, footer: 'কেনার জন্য ধন্যবাদ!'
    }, '80mm')
    if (save) void savePdf(html, `${s.invoice_no}.pdf`)
    else void printDoc(html, { paper: '80mm' })
  }

  if (isLoading) return <div className="page"><Loading /></div>
  if (error || !data) return <div className="page"><LoadError onRetry={() => void refetch()} /></div>

  const s = data.sale
  const voided = s.status === 'voided'

  return (
    <div className="page">
      <PageHeader
        title={<span className="flex items-center gap-2"><button className="btn btn-ghost btn-sm btn-icon" onClick={() => navigate('/sales')}><ArrowLeft size={16} /></button>{t('invoice')} <span className="num">{s.invoice_no}</span></span>}
        sub={`${fdatetime(s.date)} · ${methodBn(s.payment_method)} · ${s.user_name ?? ''}`}
        actions={
          <>
            <Badge tone={voided ? 'danger' : s.status === 'completed' ? 'success' : 'warning'}>
              {voided ? t('sale_status_voided') : s.status === 'completed' ? t('sale_status_completed') : t('sale_status_partial')}
            </Badge>
            {!voided ? (
              <>
                {can(PERMS.RETURNS_MAKE) ? <button className="btn btn-secondary" onClick={() => setReturnOpen(true)}><RotateCcw size={15} /> {t('sale_return_btn')}</button> : null}
                {can(PERMS.SALES_VOID) ? <button className="btn btn-danger" onClick={() => setVoidOpen(true)}><Ban size={15} /> {t('void_invoice')}</button> : null}
              </>
            ) : null}
            <button className="btn btn-secondary btn-icon" title="PDF" onClick={() => doPrint(true)}><FileDown size={16} /></button>
            <button className="btn btn-primary" onClick={() => doPrint()}><Printer size={15} /> {t('print_btn')}</button>
          </>
        }
      />

      {voided ? (
        <div className="alert alert-danger" style={{ marginBottom: 14 }}>
          <b>এই চালানটি বাতিল করা হয়েছে।</b> স্টক ফেরত নেওয়া হয়েছে এবং পেমেন্ট উল্টে দেওয়া হয়েছে।
        </div>
      ) : null}

      <div className="grid-2fr1" style={{ marginBottom: 16 }}>
        {/* items */}
        <div className="card" style={{ overflow: 'hidden' }}>
          <div className="card-header"><h3>বিক্রীত পণ্য</h3><span className="muted small num">{num(data.items.length)} আইটেম</span></div>
          <table className="tbl">
            <thead><tr><th>{t('product')}</th><th className="ta-r">{t('qty')}</th><th className="ta-r">{t('rate')}</th><th className="ta-r">{t('discount')}</th><th className="ta-r">{t('line_total')}</th></tr></thead>
            <tbody>
              {data.items.map((it) => (
                <tr key={it.id}>
                  <td>
                    <div>{it.name}</div>
                    {it.returned_qty > 0 ? <div className="small neg">ফেরত: {num(it.returned_qty)}</div> : null}
                  </td>
                  <td className="ta-r num">{num(it.qty, it.qty % 1 ? 3 : 0)}{it.unit ? ` ${it.unit}` : ''}</td>
                  <td className="ta-r num">{money(it.unit_price)}</td>
                  <td className="ta-r num">{it.discount > 0 ? money(it.discount) : '—'}</td>
                  <td className="ta-r num td-strong">{money(it.line_total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border)' }}>
            <div className="sum-row"><span>{t('subtotal')}</span><span className="num">{money(s.subtotal)}</span></div>
            {s.item_discount > 0 ? <div className="sum-row"><span>{t('discount')} (আইটেম)</span><span className="num">− {money(s.item_discount)}</span></div> : null}
            {s.invoice_discount > 0 ? <div className="sum-row"><span>{t('discount')} (চালান)</span><span className="num">− {money(s.invoice_discount)}</span></div> : null}
            {s.tax > 0 ? <div className="sum-row"><span>{t('vat')}</span><span className="num">{money(s.tax)}</span></div> : null}
            <div className="sum-row big"><span>{t('total')}</span><span className="num">{money(s.total)}</span></div>
            <div className="sum-row"><span>{t('paid')}</span><span className="num pos">{money(s.paid)}</span></div>
            {s.due > 0 ? <div className="sum-row"><span className="neg">{t('due')}</span><span className="num neg td-strong">{money(s.due)}</span></div> : null}
          </div>
          {s.note ? <div className="alert alert-info" style={{ margin: 12 }}>{t('note')}: {s.note}</div> : null}
        </div>

        <div className="flex flex-col gap-4">
          {/* payments */}
          <div className="card">
            <div className="card-header"><h3>{t('payments_received')}</h3></div>
            <div className="recent-list">
              {data.payments.length === 0 ? <div className="empty"><p>কোনো পেমেন্ট নেই (বাকি বিল)</p></div> : data.payments.map((p) => (
                <div key={p.id} className="recent-row">
                  <div className="grow">
                    <div className="strong" style={{ fontSize: 13 }}>{p.account_name}</div>
                    <div className="small muted">{methodBn(p.method)} · {ftime(p.date)}</div>
                  </div>
                  <div className="t-num num">{money(p.amount)}</div>
                </div>
              ))}
            </div>
          </div>

          {/* returns */}
          <div className="card">
            <div className="card-header">
              <h3>{t('returns_title')}</h3>
              {data.returned_total > 0 ? <Badge tone="warning">{money(data.returned_total)}</Badge> : null}
            </div>
            <div className="recent-list">
              {data.returns.length === 0 ? <div className="empty"><p>কোনো ফেরত নেই</p></div> : data.returns.map((r) => (
                <div key={r.id} className="recent-row">
                  <div className="grow">
                    <div className="strong" style={{ fontSize: 13 }}>{r.invoice_no} {r.restock ? '· স্টকে ফেরত' : ''}</div>
                    <div className="small muted">{fdatetime(r.date)} · {r.refund_mode === 'cash' ? 'নগদ ফেরত' : r.refund_mode === 'due_adjust' ? 'বকেয়া সমন্বয়' : 'হিসাবে ফেরত'}{r.reason ? ` · ${r.reason}` : ''}</div>
                  </div>
                  <div className="t-num num">{money(r.amount)}</div>
                </div>
              ))}
            </div>
          </div>

          {/* customer */}
          <div className="card">
            <div className="card-header"><h3>{t('type_customer')}</h3></div>
            <div style={{ padding: 16 }}>
              {s.customer_id ? (
                <button className="recent-row clickable" style={{ width: '100%' }} onClick={() => navigate(`/customers/${s.customer_id}`)}>
                  <span className="avatar">{(s.customer_name ?? '?').slice(0, 1)}</span>
                  <div className="grow">
                    <div className="strong">{s.customer_name}</div>
                    <div className="small muted num">{s.customer_phone ?? ''}</div>
                  </div>
                </button>
              ) : <span className="muted">{t('walkin_customer')}</span>}
            </div>
          </div>
        </div>
      </div>

      {/* return modal */}
      {returnOpen && data ? (
        <ReturnModal
          sale={data}
          onClose={() => setReturnOpen(false)}
          onDone={() => { setReturnOpen(false); void qc.invalidateQueries(); toast(t('return_success'), 'success') }}
        />
      ) : null}

      <ConfirmDialog
        open={voidOpen}
        onClose={() => setVoidOpen(false)}
        title={t('void_invoice')}
        body={t('void_sale_confirm')}
        requireText={s.invoice_no}
        confirmLabel={t('void_confirm')}
        busy={busy}
        onConfirm={async () => {
          setBusy(true)
          try {
            await api.post(`/sales/${s.id}/void`, {})
            void qc.invalidateQueries()
            toast('চালান বাতিল হয়েছে', 'success')
            setVoidOpen(false)
          } catch (e) { toast((e as Error).message, 'error') } finally { setBusy(false) }
        }}
      />
    </div>
  )
}

function ReturnModal({ sale, onClose, onDone }: { sale: SaleDetail; onClose: () => void; onDone: () => void }) {
  const { toast } = useToast()
  const [qty, setQty] = useState<Record<string, string>>({})
  const [restock, setRestock] = useState(true)
  const [method, setMethod] = useState<'cash' | 'due_adjust' | 'account'>('cash')
  const [accountId, setAccountId] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  const { data: accounts } = useQuery({ queryKey: ['accounts'], queryFn: () => api.get<{ rows: Array<{ id: string; name: string; type: string }> }>('/accounts') })

  const returnable = useMemo(() => sale.items.filter((i) => i.qty - i.returned_qty > 0), [sale])
  const totalReturn = returnable.reduce((a, i) => a + (Number(qty[i.id]) || 0) * i.unit_price, 0)

  const submit = async () => {
    const items = returnable
      .map((i) => ({ sale_item_id: i.id, qty: Number(qty[i.id]) || 0, unit_price: i.unit_price }))
      .filter((i) => i.qty > 0)
    if (items.length === 0) { toast('কমপক্ষে একটি পণ্যের পরিমাণ দিন', 'warning'); return }
    setBusy(true)
    try {
      await api.post('/returns', {
        sale_id: sale.sale.id, items, restock,
        refund_mode: method,
        account_id: method === 'due_adjust' ? undefined : (accountId || accounts?.rows.find((a) => a.type === 'cash')?.id || undefined),
        reason: reason || undefined
      })
      onDone()
    } catch (e) { toast((e as Error).message, 'error') } finally { setBusy(false) }
  }

  return (
    <Modal open onClose={onClose} title={t('sale_return_btn')} sub={`${t('invoice')} ${sale.sale.invoice_no}`} size="lg"
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose}>{t('cancel')}</button>
          <button className="btn btn-primary" disabled={busy || totalReturn <= 0} onClick={() => void submit()}>
            {busy ? <span className="spinner" /> : null}{t('return_confirm')} · {money(totalReturn)}
          </button>
        </>
      }
    >
      <table className="tbl">
        <thead><tr><th>{t('product')}</th><th>বিক্রীত</th><th>ফেরতযোগ্য</th><th style={{ width: 120 }}>ফেরত পরিমাণ</th></tr></thead>
        <tbody>
          {returnable.map((i) => {
            const avail = i.qty - i.returned_qty
            return (
              <tr key={i.id}>
                <td>{i.name}</td>
                <td className="num">{num(i.qty)}</td>
                <td className="num">{num(avail)}</td>
                <td>
                  <input
                    className="input input-money"
                    value={qty[i.id] ?? ''}
                    placeholder="0"
                    inputMode="decimal"
                    onChange={(e) => {
                      const v = Number(e.target.value.replace(/[^\d.]/g, ''))
                      if (v > avail) { toast(`সর্বোচ্চ ${num(avail)} ফেরত দেওয়া যাবে`, 'warning'); return }
                      setQty((q) => ({ ...q, [i.id]: e.target.value }))
                    }}
                  />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>

      <div className="grid-2" style={{ marginTop: 14 }}>
        <Field label={t('return_restock')}>
          <select className="select" value={restock ? '1' : '0'} onChange={(e) => setRestock(e.target.value === '1')}>
            <option value="1">হ্যাঁ — স্টকে ফেরত যোগ হবে</option>
            <option value="0">না — পণ্য ক্ষতিগ্রস্ত/নষ্ট</option>
          </select>
        </Field>
        <Field label={t('return_method')}>
          <select className="select" value={method} onChange={(e) => setMethod(e.target.value as 'cash' | 'due_adjust' | 'account')}>
            <option value="cash">নগদ ফেরত</option>
            <option value="due_adjust">বকেয়া থেকে কাটা হবে</option>
            <option value="account">হিসাবে ফেরত (ব্যাংক/MFS)</option>
          </select>
        </Field>
      </div>
        {method === 'account' ? (
          <Field label="কোন হিসাবে ফেরত" required style={{ marginTop: 12 }}>
            <select className="select" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              {(accounts?.rows ?? []).filter((a) => a.type !== 'cash').map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </Field>
        ) : null}
      <Field label={t('note')} style={{ marginTop: 12 }}>
        <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="যেমন: মান খারাপ, ভুল পণ্য…" />
      </Field>
    </Modal>
  )
}
