import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Pencil, Banknote, Printer, FileDown } from 'lucide-react'
import { api } from '@/api/client'
import { useSession } from '@/state/session'
import { t, money, fdatetime, presetRange } from '@/i18n/bn'
import { PageHeader, Loading, LoadError, StatCard, RangePicker, DataTable, type RangeKind, type Column } from '@/ui/components'
import { PERMS } from '../perm'
import { statementHtml, printDoc, savePdf, methodBn } from '@/lib/printing'
import { useBusinessInfo } from '@/lib/useBusinessInfo'
import { CustomerModal, CollectModal } from './customers'

interface Cust {
  id: string
  code: string | null
  name: string
  phone: string | null
  address: string | null
  opening_due: number
  receivable: number
  status: string
  created_at: number
}
interface SaleRow { id: string; invoice_no: string; date: number; total: number; paid: number; due: number; status: string }
interface PayRow { id: string; voucher_no: string; date: number; amount: number; method: string; note: string | null }
interface LedRow { date: number; ref: string; description: string; debit: number; credit: number; balance: number }

export function CustomerDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { can } = useSession()
  const { info: bizInfo } = useBusinessInfo()

  const [editOpen, setEditOpen] = useState(false)
  const [collectOpen, setCollectOpen] = useState(false)
  const [range, setRange] = useState<RangeKind>('30d')
  const [from, setFrom] = useState(() => presetRange('30d').from)
  const [to, setTo] = useState(() => presetRange('30d').to)
  const [tab, setTab] = useState<'sales' | 'payments' | 'ledger'>('sales')

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['customer', id],
    queryFn: () => api.get<{ customer: Cust; sales: SaleRow[]; payments: PayRow[] }>(`/customers/${id}`)
  })

  const totalPurchase = useMemo(() => (data?.sales ?? []).reduce((a, s) => a + s.total, 0), [data])
  const totalPaid = useMemo(() => (data?.payments ?? []).reduce((a, p) => a + p.amount, 0), [data])

  // ledger built from the same numbers the ledger page shows — sales add due, payments clear it
  const ledger = useMemo<LedRow[]>(() => {
    if (!data) return []
    const events: Array<{ date: number; ref: string; description: string; debit: number; credit: number }> = [
      { date: data.customer.created_at, ref: '', description: 'পুরনো বকেয়া (শুরু)', debit: data.customer.opening_due, credit: 0 }
    ]
    for (const s of data.sales) events.push({ date: s.date, ref: s.invoice_no, description: 'বিক্রয় (বাকি সহ)', debit: s.total, credit: 0 })
    for (const p of data.payments) events.push({ date: p.date, ref: p.voucher_no, description: `বকেয়া আদায় · ${methodBn(p.method)}`, debit: 0, credit: p.amount })
    events.sort((a, b) => a.date - b.date)
    let bal = 0
    return events.map((e) => {
      bal += e.debit - e.credit
      return { ...e, balance: bal }
    })
  }, [data])

  if (isLoading) return <div className="page"><Loading /></div>
  if (error || !data) return <div className="page"><LoadError onRetry={() => void refetch()} /></div>

  const c = data.customer

  const printStatement = (save?: boolean) => {
    const html = statementHtml(bizInfo, {
      party_name: c.name, party_phone: c.phone, date: Date.now(),
      opening_due: c.opening_due,
      rows: ledger,
      closing_due: c.receivable
    })
    if (save) void savePdf(html, `statement-${c.name}.pdf`); else void printDoc(html, { paper: 'A4' })
  }

  const salesCols: Column<SaleRow>[] = [
    { key: 'invoice_no', header: t('invoice_no'), width: 140, render: (r) => <span className="td-strong num">{r.invoice_no}</span> },
    { key: 'date', header: t('date'), width: 150, render: (r) => <span className="muted">{fdatetime(r.date)}</span> },
    { key: 'total', header: t('total'), align: 'right', width: 110, render: (r) => <span className="num td-strong">{money(r.total)}</span> },
    { key: 'due', header: t('due'), align: 'right', width: 110, render: (r) => r.due > 0 ? <span className="num neg">{money(r.due)}</span> : <span className="muted-2">—</span> },
    { key: 'go', header: '', width: 80, render: (r) => <button className="btn btn-ghost btn-sm" onClick={() => navigate(`/sales/${r.id}`)}>{t('view')}</button> }
  ]
  const payCols: Column<PayRow>[] = [
    { key: 'voucher_no', header: t('voucher_no'), width: 140, render: (r) => <span className="td-strong num">{r.voucher_no}</span> },
    { key: 'date', header: t('date'), width: 150, render: (r) => <span className="muted">{fdatetime(r.date)}</span> },
    { key: 'method', header: t('payment_method'), width: 110, render: (r) => methodBn(r.method) },
    { key: 'note', header: t('note'), render: (r) => <span className="muted small">{r.note ?? '—'}</span> },
    { key: 'amount', header: t('amount'), align: 'right', width: 120, render: (r) => <span className="num pos td-strong">{money(r.amount)}</span> }
  ]
  const ledCols: Column<LedRow>[] = [
    { key: 'date', header: t('date'), width: 150, render: (r) => <span className="muted">{fdatetime(r.date)}</span> },
    { key: 'description', header: t('details'), render: (r) => <span>{r.description}{r.ref ? <span className="muted num small"> · {r.ref}</span> : null}</span> },
    { key: 'debit', header: 'বাকি (+)', align: 'right', width: 110, render: (r) => r.debit > 0 ? <span className="num neg">{money(r.debit)}</span> : '' },
    { key: 'credit', header: 'পরিশোধ (−)', align: 'right', width: 110, render: (r) => r.credit > 0 ? <span className="num pos">{money(r.credit)}</span> : '' },
    { key: 'balance', header: 'জমা', align: 'right', width: 120, render: (r) => <span className="num td-strong">{money(r.balance)}</span> }
  ]

  return (
    <div className="page">
      <PageHeader
        title={<span className="flex items-center gap-2"><button className="btn btn-ghost btn-sm btn-icon" aria-label="ফিরে যান" onClick={() => navigate('/customers')}><ArrowLeft size={16} /></button>{c.name}</span>}
        sub={[c.phone, c.address].filter(Boolean).join(' · ') || '—'}
        actions={
          <>
            {can(PERMS.DUES_COLLECT) && c.receivable > 0 ? (
              <button className="btn btn-primary" onClick={() => setCollectOpen(true)}><Banknote size={15} /> {t('collect_due')}</button>
            ) : null}
            <button aria-label="PDF" className="btn btn-secondary btn-icon" title="PDF" onClick={() => printStatement(true)}><FileDown size={16} /></button>
            <button className="btn btn-secondary" onClick={() => printStatement()}><Printer size={15} /> স্টেটমেন্ট</button>
            {can(PERMS.CUSTOMERS_MANAGE) ? <button className="btn btn-secondary" onClick={() => setEditOpen(true)}><Pencil size={15} /> {t('edit')}</button> : null}
          </>
        }
      />

      <div className="grid-stats" style={{ marginBottom: 16 }}>
        <StatCard label={t('due')} value={money(c.receivable)} tone={c.receivable > 0 ? 'warning' : 'success'} />
        <StatCard label="মোট কেনা" value={money(totalPurchase)} />
        <StatCard label="মোট আদায়" value={money(totalPaid)} tone="success" />
        <StatCard label="গ্রাহক হয়েছে" value={<span style={{ fontSize: 15 }}>{fdatetime(c.created_at)}</span>} />
      </div>

      <div style={{ display: 'flex', gap: 10, marginBottom: 12, alignItems: 'center' }}>
        <div className="segmented">
          <button className={tab === 'sales' ? 'active' : ''} onClick={() => setTab('sales')}>বিক্রয়</button>
          <button className={tab === 'payments' ? 'active' : ''} onClick={() => setTab('payments')}>{t('payments_title')}</button>
          <button className={tab === 'ledger' ? 'active' : ''} onClick={() => setTab('ledger')}>{t('ledger')}</button>
        </div>
        <RangePicker value={range} onChange={(k, f, tt) => { setRange(k); if (f && tt) { setFrom(f); setTo(tt) } }} />
      </div>

      <DataTable<unknown>
        columns={(tab === 'sales' ? salesCols : tab === 'payments' ? payCols : ledCols) as unknown as Column<unknown>[]}
        rows={(tab === 'sales' ? data.sales : tab === 'payments' ? data.payments : ledger) as unknown as unknown[]}
        rowKey={(_, i) => String(i)}
        maxHeight="calc(100vh - 420px)"
        emptyTitle="কোনো রেকর্ড নেই"
      />

      {editOpen ? <CustomerModal existing={c} onClose={() => setEditOpen(false)} /> : null}
      {collectOpen ? <CollectModal customer={c} bizInfo={bizInfo} onClose={() => setCollectOpen(false)} /> : null}
    </div>
  )
}
