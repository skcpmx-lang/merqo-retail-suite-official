import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Printer, FileDown, TrendingUp, TrendingDown } from 'lucide-react'
import { api } from '@/api/client'
import { useSession } from '@/state/session'
import { t, money, num, presetRange } from '@/i18n/bn'
import { PageHeader, Loading, LoadError, StatCard, RangePicker, type RangeKind } from '@/ui/components'
import { PERMS } from '../perm'
import { reportHtml, printDoc, savePdf } from '@/lib/printing'
import { useBusinessInfo } from '@/lib/useBusinessInfo'

interface Pnl {
  from: number
  to: number
  revenue: number
  cogs: number
  gross_profit: number
  mfs_income: { commission: number; service_charge: number; total: number }
  expenses: Array<{ category: string; amount: number }>
  expenses_total: number
  net_profit: number
  discounts: number
  returns: number
  vat: number
  sales_count: number
  purchases: number
  receivable: number
  payable: number
  cashflow: { inflow: number; outflow: number; net: number }
}

export function Finance() {
  const { can } = useSession()
  const { info: bizInfo } = useBusinessInfo()
  const [range, setRange] = useState<RangeKind>('month')
  const [from, setFrom] = useState(() => presetRange('month').from)
  const [to, setTo] = useState(() => presetRange('month').to)

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['pnl', from, to],
    queryFn: () => api.get<Pnl>('/reports/pnl', { from, to }),
    enabled: can(PERMS.FINANCE_VIEW)
  })

  if (!can(PERMS.FINANCE_VIEW)) return null
  if (isLoading) return <div className="page"><Loading /></div>
  if (error || !data) return <div className="page"><LoadError onRetry={() => void refetch()} /></div>

  const grossMargin = data.revenue > 0 ? Math.round((data.gross_profit / data.revenue) * 1000) / 10 : 0
  const netMargin = data.revenue > 0 ? Math.round((data.net_profit / data.revenue) * 1000) / 10 : 0

  const print = (save?: boolean) => {
    const html = reportHtml(bizInfo, {
      title: 'লাভ-ক্ষতি বিবরণী', date: Date.now(), user_name: '',
      columns: ['খাত', 'পরিমাণ (৳)'],
      rows: [
        ['বিক্রয় (মোট)', money(data.revenue)],
        ['বিক্রীত পণ্যের ব্যয় (COGS)', `− ${money(data.cogs)}`],
        ['গ্রস লাভ', money(data.gross_profit)],
        ['MFS কমিশন', money(data.mfs_income.commission)],
        ['MFS সার্ভিস চার্জ', money(data.mfs_income.service_charge)],
        ...data.expenses.map((e) => [`খরচ — ${e.category}`, `− ${money(e.amount)}`]),
        ['মোট খরচ', `− ${money(data.expenses_total)}`],
        ['নিট লাভ', money(data.net_profit)]
      ]
    })
    if (save) void savePdf(html, 'pnl.pdf'); else void printDoc(html, { paper: 'A4' })
  }

  return (
    <div className="page">
      <PageHeader
        title={t('finance_title')}
        sub={t('finance_sub')}
        actions={
          <>
            <button aria-label="PDF" className="btn btn-secondary btn-icon" title="PDF" onClick={() => print(true)}><FileDown size={16} /></button>
            <button className="btn btn-secondary" onClick={() => print()}><Printer size={15} /> প্রিন্ট</button>
          </>
        }
      />

      <div style={{ marginBottom: 14 }}>
        <RangePicker value={range} onChange={(k, f, tt) => { setRange(k); if (f && tt) { setFrom(f); setTo(tt) } }} />
      </div>

      {/* P&L statement */}
      <div className="card card-pad" style={{ marginBottom: 16, maxWidth: 640 }}>
        <h3 style={{ marginBottom: 12 }}>লাভ-ক্ষতি বিবরণী</h3>
        <div className="sum-row big"><span>বিক্রয়</span><span className="num">{money(data.revenue)}</span></div>
        {data.discounts > 0 ? <div className="sum-row"><span className="muted">ছাড় প্রদত্ত</span><span className="num muted">− {money(data.discounts)}</span></div> : null}
        {data.returns > 0 ? <div className="sum-row"><span className="muted">ফেরত</span><span className="num muted">− {money(data.returns)}</span></div> : null}
        <div className="sum-row"><span>বিক্রীত পণ্যের ব্যয় (COGS)</span><span className="num neg">− {money(data.cogs)}</span></div>
        <div className="sum-row big" style={{ borderTop: '1px solid var(--border)', paddingTop: 8 }}>
          <span>গ্রস লাভ</span>
          <span className={`num ${data.gross_profit >= 0 ? 'pos' : 'neg'}`}>{money(data.gross_profit)} <span className="small muted">({grossMargin}%)</span></span>
        </div>

        <div className="sum-row" style={{ marginTop: 10 }}><span>📱 MFS কমিশন</span><span className="num pos">+ {money(data.mfs_income.commission)}</span></div>
        <div className="sum-row"><span>📱 MFS সার্ভিস চার্জ</span><span className="num pos">+ {money(data.mfs_income.service_charge)}</span></div>

        <div className="strong" style={{ marginTop: 14, marginBottom: 4, fontSize: 13 }}>খরচসমূহ</div>
        {data.expenses.length === 0 ? <div className="sum-row"><span className="muted">কোনো খরচ নেই</span><span /></div>
          : data.expenses.map((e) => (
            <div key={e.category} className="sum-row"><span className="muted">{e.category}</span><span className="num neg">− {money(e.amount)}</span></div>
          ))}
        <div className="sum-row"><span>মোট খরচ</span><span className="num neg td-strong">− {money(data.expenses_total)}</span></div>

        <div className="sum-row big" style={{ borderTop: '2px solid var(--border)', paddingTop: 10, marginTop: 8 }}>
          <span>নিট লাভ</span>
          <span className={`num ${data.net_profit >= 0 ? 'pos' : 'neg'}`} style={{ fontSize: 20 }}>
            {money(data.net_profit)} <span className="small muted">({netMargin}%)</span>
          </span>
        </div>
      </div>

      <div className="grid-stats" style={{ marginBottom: 16 }}>
        <StatCard compact label="বিল সংখ্যা" value={num(data.sales_count)} icon={<TrendingUp size={13} />} />
        <StatCard compact label="ক্রয় (সময়কাল)" value={money(data.purchases)} icon={<TrendingDown size={13} />} />
        <StatCard compact label="ভ্যাট আদায়" value={money(data.vat)} />
        <StatCard compact label={t('receivable_total')} value={money(data.receivable)} tone="warning" />
        <StatCard compact label={t('payable_total')} value={money(data.payable)} tone="danger" />
      </div>

      <div className="grid-2">
        <div className="card card-pad">
          <h3 style={{ marginBottom: 10 }}>নগদ প্রবাহ</h3>
          <div className="sum-row"><span>টাকা ঢুকেছে (বিক্রয়+আদায়+অন্যান্য)</span><span className="num pos">{money(data.cashflow.inflow)}</span></div>
          <div className="sum-row"><span>টাকা বের হয়েছে (ক্রয়+খরচ+পরিশোধ)</span><span className="num neg">{money(data.cashflow.outflow)}</span></div>
          <div className="sum-row big"><span>নিট</span><span className={`num ${data.cashflow.net >= 0 ? 'pos' : 'neg'}`}>{money(data.cashflow.net)}</span></div>
        </div>
        <div className="card card-pad">
          <h3 style={{ marginBottom: 10 }}>দ্রষ্টব্য</h3>
          <ul className="small muted" style={{ lineHeight: 1.9, paddingLeft: 18 }}>
            <li>বিক্রয় ও COGS ওয়েটেড এভারেজ (WAC) পদ্ধতিতে হিসাব করা</li>
            <li>MFS আয় কমিশন ও সার্ভিস চার্জ — বিক্রয়ের অংশ নয়</li>
            <li>বাতিল (void) বিল ও খরচ এই হিসাবে আসে না</li>
            <li>ফেরত বিয়োগ করা হয়েছে</li>
          </ul>
        </div>
      </div>
    </div>
  )
}
