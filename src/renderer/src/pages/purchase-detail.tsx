import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Printer, Ban, Banknote, FileDown } from 'lucide-react'
import { api } from '@/api/client'
import { useSession } from '@/state/session'
import { useToast } from '@/state/toast'
import { t, money, num, fdatetime, ftime } from '@/i18n/bn'
import { PageHeader, Loading, LoadError, Modal, Field, Badge, ConfirmDialog } from '@/ui/components'
import { PERMS } from '../perm'
import { purchaseHtml, printDoc, savePdf } from '@/lib/printing'
import { useBusinessInfo } from '@/lib/useBusinessInfo'

interface PurchaseDetail {
  purchase: {
    id: string; ref_no: string | null; date: number; supplier_id: string; supplier_name: string
    subtotal: number; discount: number; total: number; paid: number; due: number; status: string
    note: string | null; user_name: string | null
  }
  items: Array<{ id: string; product_id: string; name: string; qty: number; unit_cost: number; line_total: number; sku: string | null }>
  payments: Array<{ id: string; voucher_no: string; account_name: string; amount: number; date: number; method: string }>
}

export function PurchaseDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { toast } = useToast()
  const { can } = useSession()
  const { info: bizInfo } = useBusinessInfo()

  const [payOpen, setPayOpen] = useState(false)
  const [voidOpen, setVoidOpen] = useState(false)
  const [amount, setAmount] = useState('')
  const [accountId, setAccountId] = useState('')
  const [busy, setBusy] = useState(false)

  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['purchase', id], queryFn: () => api.get<PurchaseDetail>(`/purchases/${id}`) })
  const { data: accounts } = useQuery({ queryKey: ['accounts'], queryFn: () => api.get<{ rows: Array<{ id: string; name: string; type: string }> }>('/accounts') })

  if (isLoading) return <div className="page"><Loading /></div>
  if (error || !data) return <div className="page"><LoadError onRetry={() => void refetch()} /></div>

  const p = data.purchase
  const voided = p.status === 'voided'

  const doPrint = (save?: boolean) => {
    const html = purchaseHtml(bizInfo, {
      ref_no: p.ref_no, date: p.date, supplier_name: p.supplier_name, supplier_phone: null,
      items: data.items.map((i) => ({ name: i.name, qty: i.qty, unit_cost: i.unit_cost, line_total: i.line_total })),
      invoice_discount: p.discount, total: p.total, paid: p.paid, due: p.due, note: p.note, user_name: p.user_name
    })
    if (save) void savePdf(html, `${p.ref_no}.pdf`)
    else void printDoc(html, { paper: 'A4' })
  }

  const pay = async () => {
    const amt = Math.round(Number(amount) * 100) || 0
    if (amt <= 0 || amt > p.due) { toast(`সর্বোচ্চ ${money(p.due)} পরিশোধ করা যাবে`, 'warning'); return }
    setBusy(true)
    try {
      await api.post(`/suppliers/${p.supplier_id}/pay`, { amount: amt, account_id: accountId, method: 'cash' })
      void qc.invalidateQueries()
      toast('পরিশোধ সম্পন্ন', 'success')
      setPayOpen(false); setAmount('')
    } catch (e) { toast((e as Error).message, 'error') } finally { setBusy(false) }
  }

  return (
    <div className="page">
      <PageHeader
        title={<span className="flex items-center gap-2"><button className="btn btn-ghost btn-sm btn-icon" aria-label="ফিরে যান" onClick={() => navigate('/purchases')}><ArrowLeft size={16} /></button>{t('purchase')} <span className="num">{p.ref_no ?? '—'}</span></span>}
        sub={`${fdatetime(p.date)} · ${p.user_name ?? ''}`}
        actions={
          <>
            <Badge tone={voided ? 'danger' : 'success'}>{voided ? t('sale_status_voided') : 'সম্পন্ন'}</Badge>
            {!voided && p.due > 0 && can(PERMS.DUES_PAY) ? (
              <button className="btn btn-primary" onClick={() => { setAmount(String(p.due / 100)); setAccountId(accounts?.rows.find((a) => a.type === 'cash')?.id ?? ''); setPayOpen(true) }}>
                <Banknote size={15} /> {t('pay_supplier')}
              </button>
            ) : null}
            {can(PERMS.PURCHASES_EDIT) && !voided ? <button className="btn btn-danger" onClick={() => setVoidOpen(true)}><Ban size={15} /> {t('purchase_void')}</button> : null}
            <button aria-label="PDF" className="btn btn-secondary btn-icon" title="PDF" onClick={() => doPrint(true)}><FileDown size={16} /></button>
            <button className="btn btn-secondary" onClick={() => doPrint()}><Printer size={15} /> {t('print_btn')}</button>
          </>
        }
      />

      {voided ? <div className="alert alert-danger" style={{ marginBottom: 14 }}><b>এই ক্রয়টি বাতিল করা হয়েছে।</b> স্টক থেকে পণ্য বাদ দেওয়া হয়েছে এবং পেমেন্ট উল্টে দেওয়া হয়েছে।</div> : null}

      <div className="grid-2fr1">
        <div className="card" style={{ overflow: 'hidden' }}>
          <div className="card-header"><h3>কেনা পণ্য</h3><span className="muted small num">{data.items.length} আইটেম</span></div>
          <table className="tbl">
            <thead><tr><th>{t('product')}</th><th className="ta-r">{t('qty')}</th><th className="ta-r">{t('unit_cost')}</th><th className="ta-r">{t('line_total')}</th></tr></thead>
            <tbody>
              {data.items.map((i) => (
                <tr key={i.id}>
                  <td>{i.name}</td>
                  <td className="ta-r num">{num(i.qty, i.qty % 1 ? 3 : 0)}</td>
                  <td className="ta-r num">{money(i.unit_cost)}</td>
                  <td className="ta-r num td-strong">{money(i.line_total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border)' }}>
            <div className="sum-row"><span>{t('subtotal')}</span><span className="num">{money(p.subtotal)}</span></div>
            {p.discount > 0 ? <div className="sum-row"><span>{t('discount')}</span><span className="num">− {money(p.discount)}</span></div> : null}
            <div className="sum-row big"><span>{t('total')}</span><span className="num">{money(p.total)}</span></div>
            <div className="sum-row"><span>{t('paid')}</span><span className="num pos">{money(p.paid)}</span></div>
            {p.due > 0 ? <div className="sum-row"><span className="neg">সরবরাহকারীর কাছে {t('due')}</span><span className="num neg td-strong">{money(p.due)}</span></div> : null}
          </div>
          {p.note ? <div className="alert alert-info" style={{ margin: 12 }}>{t('note')}: {p.note}</div> : null}
        </div>

        <div className="card">
          <div className="card-header"><h3>{t('payments_made')}</h3></div>
          <div className="recent-list">
            {data.payments.length === 0 ? <div className="empty"><p>কোনো পরিশোধ নেই</p></div> : data.payments.map((pm) => (
              <div key={pm.id} className="recent-row">
                <div className="grow">
                  <div className="strong num" style={{ fontSize: 13 }}>{pm.voucher_no}</div>
                  <div className="small muted">{pm.account_name} · {ftime(pm.date)}</div>
                </div>
                <div className="t-num num">{money(pm.amount)}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <Modal open={payOpen} onClose={() => setPayOpen(false)} title={t('pay_supplier')} sub={p.supplier_name} size="sm"
        footer={
          <>
            <button className="btn btn-secondary" onClick={() => setPayOpen(false)}>{t('cancel')}</button>
            <button className="btn btn-primary" disabled={busy} onClick={() => void pay()}>{busy ? <span className="spinner" /> : null}{t('confirm')}</button>
          </>
        }
      >
        <Field label={`${t('amount')} (৳)`} required hint={`সর্বোচ্চ ${money(p.due)}`}>
          <input className="input input-money input-lg" value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" autoFocus onFocus={(e) => e.target.select()} />
        </Field>
        <Field label={t('pay_from_account')} required style={{ marginTop: 12 }}>
          <select className="select" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            {(accounts?.rows ?? []).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </Field>
      </Modal>

      <ConfirmDialog
        open={voidOpen}
        onClose={() => setVoidOpen(false)}
        title={t('purchase_void')}
        body={t('void_purchase_confirm')}
        requireText={p.ref_no ?? ''}
        confirmLabel={t('void_confirm')}
        busy={busy}
        onConfirm={async () => {
          setBusy(true)
          try {
            await api.post(`/purchases/${p.id}/void`, {})
            void qc.invalidateQueries()
            toast('ক্রয় বাতিল হয়েছে', 'success')
            setVoidOpen(false)
          } catch (e) { toast((e as Error).message, 'error') } finally { setBusy(false) }
        }}
      />
    </div>
  )
}
