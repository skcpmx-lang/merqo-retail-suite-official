import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Pencil, Printer, FileDown } from 'lucide-react'
import { api } from '@/api/client'
import { useSession } from '@/state/session'
import { t, money, fdatetime, presetRange } from '@/i18n/bn'
import { PageHeader, Loading, LoadError, StatCard, RangePicker, DataTable, type RangeKind, type Column } from '@/ui/components'
import { PERMS } from '../perm'
import { statementHtml, printDoc, savePdf } from '@/lib/printing'
import { useBusinessInfo } from '@/lib/useBusinessInfo'
import { SupplierModal } from './suppliers'

interface Sup {
  id: string
  name: string
  phone: string | null
  address: string | null
  opening_due: number
  payable: number
  status: string
  created_at: number
}
interface PurRow { id: string; ref_no: string | null; date: number; total: number; paid: number; due: number; status: string }
interface PayRow { id: string; voucher_no: string; date: number; amount: number; method: string; note: string | null }
interface LedRow { date: number; ref: string; description: string; debit: number; credit: number; balance: number }

export function SupplierDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { can } = useSession()
  const { info: bizInfo } = useBusinessInfo()

  const [editOpen, setEditOpen] = useState(false)
  const [tab, setTab] = useState<'purchases' | 'payments' | 'ledger'>('purchases')
  const [range, setRange] = useState<RangeKind>('30d')
  const [from, setFrom] = useState(() => presetRange('30d').from)
  const [to, setTo] = useState(() => presetRange('30d').to)

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['supplier', id],
    queryFn: () => api.get<{ supplier: Sup; purchases: PurRow[]; payments: PayRow[] }>(`/suppliers/${id}`)
  })

  const totalPurchase = useMemo(() => (data?.purchases ?? []).reduce((a, p) => a + p.total, 0), [data])
  const totalPaid = useMemo(() => (data?.payments ?? []).reduce((a, p) => a + p.amount, 0), [data])

  const ledger = useMemo<LedRow[]>(() => {
    if (!data) return []
    const events: Array<{ date: number; ref: string; description: string; debit: number; credit: number }> = [
      { date: data.supplier.created_at, ref: '', description: 'পুরনো পাওনা (শুরু)', debit: data.supplier.opening_due, credit: 0 }
    ]
    for (const p of data.purchases) events.push({ date: p.date, ref: p.ref_no ?? '', description: 'ক্রয় (বাকি সহ)', debit: p.total, credit: 0 })
    for (const p of data.payments) events.push({ date: p.date, ref: p.voucher_no, description: 'পরিশোধ', debit: 0, credit: p.amount })
    events.sort((a, b) => a.date - b.date)
    let bal = 0
    return events.map((e) => {
      bal += e.debit - e.credit
      return { ...e, balance: bal }
    })
  }, [data])

  if (isLoading) return <div className="page"><Loading /></div>
  if (error || !data) return <div className="page"><LoadError onRetry={() => void refetch()} /></div>

  const s = data.supplier

  const printStatement = (save?: boolean) => {
    const html = statementHtml(bizInfo, {
      title: 'পাওনা স্টেটমেন্ট', party_name: s.name, party_phone: s.phone, date: Date.now(),
      opening_due: s.opening_due,
      rows: ledger,
      closing_due: s.payable
    })
    if (save) void savePdf(html, `statement-${s.name}.pdf`); else void printDoc(html, { paper: 'A4' })
  }

  const purCols: Column<PurRow>[] = [
    { key: 'ref_no', header: t('purchase_no'), width: 150, render: (r) => <span className="td-strong num">{r.ref_no ?? '—'}</span> },
    { key: 'date', header: t('date'), width: 150, render: (r) => <span className="muted">{fdatetime(r.date)}</span> },
    { key: 'total', header: t('total'), align: 'right', width: 110, render: (r) => <span className="num td-strong">{money(r.total)}</span> },
    { key: 'due', header: 'বাকি', align: 'right', width: 110, render: (r) => r.due > 0 ? <span className="num neg">{money(r.due)}</span> : <span className="muted-2">—</span> },
    { key: 'go', header: '', width: 80, render: (r) => <button className="btn btn-ghost btn-sm" onClick={() => navigate(`/purchases/${r.id}`)}>{t('view')}</button> }
  ]
  const payCols: Column<PayRow>[] = [
    { key: 'voucher_no', header: t('voucher_no'), width: 140, render: (r) => <span className="td-strong num">{r.voucher_no}</span> },
    { key: 'date', header: t('date'), width: 150, render: (r) => <span className="muted">{fdatetime(r.date)}</span> },
    { key: 'method', header: t('payment_method'), width: 110, render: (r) => ({ cash: 'ক্যাশ', bank: 'ব্যাংক', bkash: 'বিকাশ', nagad: 'নগদ' }[r.method] ?? r.method) },
    { key: 'note', header: t('note'), render: (r) => <span className="muted small">{r.note ?? '—'}</span> },
    { key: 'amount', header: t('amount'), align: 'right', width: 120, render: (r) => <span className="num td-strong">{money(r.amount)}</span> }
  ]
  const ledCols: Column<LedRow>[] = [
    { key: 'date', header: t('date'), width: 150, render: (r) => <span className="muted">{fdatetime(r.date)}</span> },
    { key: 'description', header: t('details'), render: (r) => <span>{r.description}{r.ref ? <span className="muted num small"> · {r.ref}</span> : null}</span> },
    { key: 'debit', header: 'পাওনা (+)', align: 'right', width: 110, render: (r) => r.debit > 0 ? <span className="num neg">{money(r.debit)}</span> : '' },
    { key: 'credit', header: 'পরিশোধ (−)', align: 'right', width: 110, render: (r) => r.credit > 0 ? <span className="num pos">{money(r.credit)}</span> : '' },
    { key: 'balance', header: 'জমা', align: 'right', width: 120, render: (r) => <span className="num td-strong">{money(r.balance)}</span> }
  ]

  return (
    <div className="page">
      <PageHeader
        title={<span className="flex items-center gap-2"><button className="btn btn-ghost btn-sm btn-icon" aria-label="ফিরে যান" onClick={() => navigate('/suppliers')}><ArrowLeft size={16} /></button>{s.name}</span>}
        sub={[s.phone, s.address].filter(Boolean).join(' · ') || '—'}
        actions={
          <>
            <button aria-label="PDF" className="btn btn-secondary btn-icon" title="PDF" onClick={() => printStatement(true)}><FileDown size={16} /></button>
            <button className="btn btn-secondary" onClick={() => printStatement()}><Printer size={15} /> স্টেটমেন্ট</button>
            {can(PERMS.SUPPLIERS_MANAGE) ? <button className="btn btn-secondary" onClick={() => setEditOpen(true)}><Pencil size={15} /> {t('edit')}</button> : null}
          </>
        }
      />

      <div className="grid-stats" style={{ marginBottom: 16 }}>
        <StatCard label="আমাদের পাওনা" value={money(s.payable)} tone={s.payable > 0 ? 'danger' : 'success'} />
        <StatCard label="মোট কেনা" value={money(totalPurchase)} />
        <StatCard label="মোট পরিশোধ" value={money(totalPaid)} />
        <StatCard label="যোগ হয়েছে" value={<span style={{ fontSize: 15 }}>{fdatetime(s.created_at)}</span>} />
      </div>

      <div style={{ display: 'flex', gap: 10, marginBottom: 12, alignItems: 'center' }}>
        <div className="segmented">
          <button className={tab === 'purchases' ? 'active' : ''} onClick={() => setTab('purchases')}>ক্রয়</button>
          <button className={tab === 'payments' ? 'active' : ''} onClick={() => setTab('payments')}>{t('payments_title')}</button>
          <button className={tab === 'ledger' ? 'active' : ''} onClick={() => setTab('ledger')}>{t('ledger')}</button>
        </div>
        <RangePicker value={range} onChange={(k, f, tt) => { setRange(k); if (f && tt) { setFrom(f); setTo(tt) } }} />
      </div>

      <DataTable<unknown>
        columns={(tab === 'purchases' ? purCols : tab === 'payments' ? payCols : ledCols) as unknown as Column<unknown>[]}
        rows={(tab === 'purchases' ? data.purchases : tab === 'payments' ? data.payments : ledger) as unknown as unknown[]}
        rowKey={(_, i) => String(i)}
        maxHeight="calc(100vh - 420px)"
        emptyTitle="কোনো রেকর্ড নেই"
      />

      {editOpen ? <SupplierModal existing={s} onClose={() => setEditOpen(false)} /> : null}
    </div>
  )
}
