import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Printer, FileDown } from 'lucide-react'
import { api } from '@/api/client'
import { useSession } from '@/state/session'
import { useToast } from '@/state/toast'
import { t, money, fdatetime, presetRange } from '@/i18n/bn'
import { PageHeader, DataTable, Badge, RangePicker, type RangeKind, type Column } from '@/ui/components'
import { PERMS } from '../perm'
import { invoiceHtml, purchaseHtml, printDoc, savePdf, methodBn } from '@/lib/printing'
import { useBusinessInfo } from '@/lib/useBusinessInfo'

type Tab = 'invoices' | 'purchases'

export function Documents() {
  const { toast } = useToast()
  const { can } = useSession()
  const { info: bizInfo } = useBusinessInfo()
  const [tab, setTab] = useState<Tab>('invoices')
  const [range, setRange] = useState<RangeKind>('7d')
  const [from, setFrom] = useState(() => presetRange('7d').from)
  const [to, setTo] = useState(() => presetRange('7d').to)

  const sales = useQuery({
    queryKey: ['documents-sales', from, to],
    queryFn: () => api.get<{ rows: InvRow[] }>('/sales', { from, to, pageSize: 100 }),
    enabled: tab === 'invoices'
  })
  const purchases = useQuery({
    queryKey: ['documents-purchases', from, to],
    queryFn: () => api.get<{ rows: PurRow[] }>('/purchases', { from, to, pageSize: 100 }),
    enabled: tab === 'purchases'
  })

  interface InvRow { id: string; invoice_no: string; customer_name: string | null; date: number; total: number; paid: number; due: number; status: string; payment_method: string }
  interface PurRow { id: string; ref_no: string | null; supplier_name: string; date: number; total: number; paid: number; due: number; status: string }

  const reprintInvoice = async (r: InvRow, save?: boolean) => {
    try {
      const d = await api.get<{
        sale: { invoice_no: string; date: number; subtotal: number; item_discount: number; invoice_discount: number; tax: number; total: number; paid: number; due: number; payment_method: string; note: string | null; customer_name: string | null; user_name: string | null }
        items: Array<{ name: string; qty: number; unit_price: number; discount: number; line_total: number; unit: string | null }>
      }>(`/sales/${r.id}`)
      const s = d.sale
      const html = invoiceHtml(bizInfo, {
        invoice_no: s.invoice_no, date: s.date, customer_name: s.customer_name, customer_phone: null,
        items: d.items.map((i) => ({ name: i.name, qty: i.qty, unit_price: i.unit_price, discount: i.discount, line_total: i.line_total, unit: i.unit })),
        subtotal: s.subtotal, item_discount: s.item_discount, invoice_discount: s.invoice_discount,
        tax: s.tax, total: s.total, paid: s.paid, due: s.due, payment_method: s.payment_method,
        note: s.note, user_name: s.user_name, footer: 'কেনার জন্য ধন্যবাদ!'
      }, '80mm')
      if (save) void savePdf(html, `${s.invoice_no}.pdf`)
      else await printDoc(html, { paper: '80mm' })
    } catch (e) { toast((e as Error).message, 'error') }
  }

  const reprintPurchase = async (r: PurRow, save?: boolean) => {
    try {
      const d = await api.get<{
        purchase: { ref_no: string | null; date: number; supplier_name: string; discount: number; total: number; paid: number; due: number; note: string | null; user_name: string | null }
        items: Array<{ name: string; qty: number; unit_cost: number; line_total: number }>
      }>(`/purchases/${r.id}`)
      const p = d.purchase
      const html = purchaseHtml(bizInfo, {
        ref_no: p.ref_no, date: p.date, supplier_name: p.supplier_name, supplier_phone: null,
        items: d.items, invoice_discount: p.discount, total: p.total, paid: p.paid, due: p.due, note: p.note, user_name: p.user_name
      })
      if (save) void savePdf(html, `${p.ref_no ?? 'purchase'}.pdf`)
      else await printDoc(html, { paper: 'A4' })
    } catch (e) { toast((e as Error).message, 'error') }
  }

  const invCols: Column<InvRow>[] = [
    { key: 'invoice_no', header: t('invoice_no'), width: 140, render: (r) => <span className="td-strong num">{r.invoice_no}</span> },
    { key: 'date', header: t('date'), width: 150, render: (r) => <span className="muted">{fdatetime(r.date)}</span> },
    { key: 'customer_name', header: t('type_customer'), render: (r) => r.customer_name ?? t('walkin_customer') },
    { key: 'payment_method', header: t('payment_method'), width: 100, render: (r) => methodBn(r.payment_method) },
    {
      key: 'status', header: t('status'), width: 110,
      render: (r) => r.status === 'voided' ? <Badge tone="danger">বাতিল</Badge> : <Badge tone="success">সম্পন্ন</Badge>
    },
    { key: 'total', header: t('total'), align: 'right', width: 110, render: (r) => <span className="num td-strong">{money(r.total)}</span> },
    {
      key: 'act', header: '', width: 100,
      render: (r) => can(PERMS.INVOICES_PRINT) ? (
        <div className="flex gap-1" style={{ justifyContent: 'flex-end' }}>
          <button aria-label="PDF" className="btn btn-ghost btn-sm btn-icon" title="PDF" onClick={() => void reprintInvoice(r, true)}><FileDown size={14} /></button>
          <button className="btn btn-secondary btn-sm btn-icon" aria-label={t('print_btn')} title={t('print_btn')} onClick={() => void reprintInvoice(r)}><Printer size={14} /></button>
        </div>
      ) : null
    }
  ]
  const purCols: Column<PurRow>[] = [
    { key: 'ref_no', header: t('purchase_no'), width: 150, render: (r) => <span className="td-strong num">{r.ref_no ?? '—'}</span> },
    { key: 'date', header: t('date'), width: 150, render: (r) => <span className="muted">{fdatetime(r.date)}</span> },
    { key: 'supplier_name', header: t('type_supplier'), render: (r) => r.supplier_name },
    {
      key: 'status', header: t('status'), width: 110,
      render: (r) => r.status === 'voided' ? <Badge tone="danger">বাতিল</Badge> : <Badge tone="success">সম্পন্ন</Badge>
    },
    { key: 'total', header: t('total'), align: 'right', width: 110, render: (r) => <span className="num td-strong">{money(r.total)}</span> },
    {
      key: 'act', header: '', width: 100,
      render: (r) => can(PERMS.INVOICES_PRINT) ? (
        <div className="flex gap-1" style={{ justifyContent: 'flex-end' }}>
          <button aria-label="PDF" className="btn btn-ghost btn-sm btn-icon" title="PDF" onClick={() => void reprintPurchase(r, true)}><FileDown size={14} /></button>
          <button className="btn btn-secondary btn-sm btn-icon" aria-label={t('print_btn')} title={t('print_btn')} onClick={() => void reprintPurchase(r)}><Printer size={14} /></button>
        </div>
      ) : null
    }
  ]

  return (
    <div className="page">
      <PageHeader title={t('documents_title')} sub={t('documents_sub')} />

      <div style={{ display: 'flex', gap: 10, marginBottom: 12, alignItems: 'center' }}>
        <div className="segmented">
          <button className={tab === 'invoices' ? 'active' : ''} onClick={() => setTab('invoices')}>চালান / রসিদ</button>
          <button className={tab === 'purchases' ? 'active' : ''} onClick={() => setTab('purchases')}>ক্রয় পত্র</button>
        </div>
        <RangePicker value={range} onChange={(k, f, tt) => { setRange(k); if (f && tt) { setFrom(f); setTo(tt) } }} />
      </div>

      <div className="alert alert-info" style={{ marginBottom: 12 }}>
        বকেয়া আদায়ের রসিদ প্রিন্ট করতে গ্রাহকের প্রোফাইল বা পেমেন্ট আদায়ের পরের রসিদ স্ক্রিন ব্যবহার করুন।
      </div>

      <DataTable<unknown>
        columns={(tab === 'invoices' ? invCols : purCols) as unknown as Column<unknown>[]}
        rows={(tab === 'invoices' ? (sales.data?.rows ?? []) : (purchases.data?.rows ?? [])) as unknown as unknown[]}
        rowKey={(r) => String((r as { id: string }).id)}
        loading={tab === 'invoices' ? sales.isLoading : purchases.isLoading}
        error={(tab === 'invoices' ? sales.error : purchases.error) ? ((tab === 'invoices' ? sales.error : purchases.error) as Error).message : null}
        onRetry={() => { if (tab === 'invoices') void sales.refetch(); else void purchases.refetch() }}
        emptyTitle="কোনো দস্তাবেজ নেই"
        emptySub="এই সময়ে কোনো বিক্রয়/ক্রয় হয়নি"
        maxHeight="calc(100vh - 380px)"
      />
    </div>
  )
}
