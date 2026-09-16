import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar
} from 'recharts'
import {
  TrendingUp, TrendingDown, Wallet, Landmark, Smartphone, Boxes, Users, Truck,
  ArrowUpRight, ArrowDownRight, AlertTriangle, ShoppingBag, Receipt, Banknote, ChevronRight
} from 'lucide-react'
import { api } from '@/api/client'
import { useSession } from '@/state/session'
import { t, money, num, fdatetime, ftime } from '@/i18n/bn'
import { PageHeader, StatCard, Loading, LoadError, Badge } from '@/ui/components'
import { PERMS } from '../perm'

interface DashData {
  today: { sales: number; sales_count: number; cogs: number; gross_profit: number; expenses: number; net_profit: number; due: number; collected: number }
  yesterday: { sales: number; gross_profit: number }
  month: { sales: number; gross_profit: number; expenses: number; net_profit: number }
  dues: { receivable: number; payable: number }
  position: { cash: number; bank: number; mfs: number; other: number; total: number }
  stock: { at_cost: number; out_count: number; low_count: number }
  recent: {
    sales: Array<{ id: string; invoice_no: string; customer_name: string | null; total: number; due: number; date: number; payment_method: string; user_name: string | null }>
    purchases: Array<{ id: string; ref_no: string | null; supplier_name: string; total: number; due: number; date: number }>
    payments: Array<{ id: string; voucher_no: string; party_name: string | null; party_type: string; direction: string; amount: number; method: string; date: number }>
  }
  top_products: Array<{ product_id: string; name: string; qty: number; revenue: number; profit: number }>
  series: Array<{ date: string; sales: number; profit: number; purchases: number; expenses: number; count: number }>
  alerts: Array<{ type: string; severity: string; title: string; body?: string }>
}

export function Dashboard() {
  const { can } = useSession()
  const navigate = useNavigate()
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api.get<DashData>('/dashboard'),
    refetchInterval: 60_000
  })

  if (isLoading) return <div className="page"><Loading /></div>
  if (error || !data) return <div className="page"><LoadError onRetry={() => void refetch()} /></div>

  const salesDelta = data.yesterday.sales > 0 ? (data.today.sales - data.yesterday.sales) / data.yesterday.sales : null

  const chartData = data.series.map((s) => ({
    ...s,
    label: s.date.slice(8) + '/' + s.date.slice(5, 7)
  }))

  return (
    <div className="page">
      <PageHeader
        title={t('dash_title')}
        sub={t('dash_sub')}
      />

      {/* KPI row — today's heart of the business */}
      <div className="grid-stats" style={{ marginBottom: 16 }}>
        <StatCard
          label={t('today_sales')}
          value={money(data.today.sales)}
          icon={<ShoppingBag size={13} />}
          sub={
            salesDelta !== null ? (
              <span className={salesDelta >= 0 ? 'pos' : 'neg'} style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                {salesDelta >= 0 ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
                {Math.abs(Math.round(salesDelta * 100))}% {t('yesterday_compare')}
              </span>
            ) : undefined
          }
          onClick={() => navigate('/sales')}
        />
        {can(PERMS.FINANCE_VIEW) ? (
          <>
            <StatCard label={t('today_gross')} value={money(data.today.gross_profit)} tone={data.today.gross_profit >= 0 ? 'success' : 'danger'} icon={<TrendingUp size={13} />} sub={`বিল ${num(data.today.sales_count)} টি`} />
            <StatCard label={t('today_net')} value={money(data.today.net_profit)} tone={data.today.net_profit >= 0 ? 'success' : 'danger'} icon={<TrendingUp size={13} />} sub={`খরচ ${money(data.today.expenses)}`} />
          </>
        ) : (
          <StatCard label={t('today_due')} value={money(data.today.due)} tone="warning" icon={<Receipt size={13} />} />
        )}
        <StatCard label={t('today_collected')} value={money(data.today.collected)} icon={<Banknote size={13} />} sub={`নতুন বাকি ${money(data.today.due)}`} onClick={() => navigate('/payments')} />
        <StatCard label={t('receivable_total')} value={money(data.dues.receivable)} tone="warning" icon={<Users size={13} />} onClick={() => navigate('/reports?r=receivables')} />
        <StatCard label={t('payable_total')} value={money(data.dues.payable)} tone="danger" icon={<Truck size={13} />} onClick={() => navigate('/reports?r=payables')} />
      </div>

      {/* position row */}
      <div className="grid-stats" style={{ marginBottom: 16 }}>
        <StatCard compact label={t('cash_position')} value={money(data.position.cash)} icon={<Wallet size={12} />} onClick={() => navigate('/accounts')} />
        <StatCard compact label={t('bank_position')} value={money(data.position.bank)} icon={<Landmark size={12} />} />
        <StatCard compact label={t('mfs_position')} value={money(data.position.mfs)} icon={<Smartphone size={12} />} onClick={() => navigate('/mfs')} />
        <StatCard compact label={t('stock_value')} value={money(data.stock.at_cost)} icon={<Boxes size={12} />} onClick={() => navigate('/inventory')} />
        <StatCard compact label={t('low_stock_count')} value={num(data.stock.low_count)} tone={data.stock.low_count > 0 ? 'warning' : 'default'} icon={<Boxes size={12} />} />
        <StatCard compact label={t('out_stock_count')} value={num(data.stock.out_count)} tone={data.stock.out_count > 0 ? 'danger' : 'default'} icon={<Boxes size={12} />} />
      </div>

      {data.alerts.length > 0 ? (
        <div style={{ marginBottom: 16 }} className="flex flex-col gap-2">
          {data.alerts.slice(0, 4).map((a, i) => (
            <div key={i} className={`alert ${a.severity === 'critical' ? 'alert-danger' : 'alert-warning'}`} style={{ alignItems: 'center' }}>
              <AlertTriangle size={15} />
              <div className="grow">
                <b>{a.title}</b>{a.body ? ` — ${a.body}` : ''}
              </div>
              {a.type === 'low_stock' || a.type === 'out_of_stock' ? (
                <button className="btn btn-secondary btn-sm" onClick={() => navigate('/inventory')}>{t('view_all')}</button>
              ) : a.type === 'large_due' ? (
                <button className="btn btn-secondary btn-sm" onClick={() => navigate('/customers?due=1')}>{t('view_all')}</button>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      <div className="dash-grid">
        {/* sales trend */}
        <div className="card span-8" style={{ overflow: 'hidden' }}>
          <div className="card-header">
            <div>
              <h3>{t('sales_trend')}</h3>
              {can(PERMS.FINANCE_VIEW) ? <div className="sub">নীল: বিক্রয় · সবুজ: গ্রস লাভ</div> : <div className="sub">বিক্রয়ের ধারা</div>}
            </div>
          </div>
          <div style={{ height: 260, padding: '12px 8px 4px' }}>
            {chartData.length === 0 ? (
              <div className="empty" style={{ height: '100%' }}><p>এখনো পর্যাপ্ত লেনদেন হয়নি</p></div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData} margin={{ top: 4, right: 16, bottom: 0, left: 8 }}>
                  <defs>
                    <linearGradient id="gSales" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#1d4ed8" stopOpacity={0.18} />
                      <stop offset="100%" stopColor="#1d4ed8" stopOpacity={0.01} />
                    </linearGradient>
                    <linearGradient id="gProfit" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#0b8a47" stopOpacity={0.16} />
                      <stop offset="100%" stopColor="#0b8a47" stopOpacity={0.01} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 6" stroke="#eceef1" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#98a2b3' }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                  <YAxis tick={{ fontSize: 11, fill: '#98a2b3' }} axisLine={false} tickLine={false} width={56} tickFormatter={(v: number) => money(v, { decimals: false })} />
                  <Tooltip
                    formatter={((value: unknown, name: unknown) => [money(Number(value)), name === 'sales' ? 'বিক্রয়' : name === 'profit' ? 'লাভ' : String(name)]) as never}
                    contentStyle={{ borderRadius: 10, border: '1px solid #e4e7ec', fontSize: 12, boxShadow: '0 4px 16px rgba(16,24,40,.12)' }}
                  />
                  <Area type="monotone" dataKey="sales" stroke="#1d4ed8" strokeWidth={2} fill="url(#gSales)" name="sales" />
                  {can(PERMS.FINANCE_VIEW) ? <Area type="monotone" dataKey="profit" stroke="#0b8a47" strokeWidth={2} fill="url(#gProfit)" name="profit" /> : null}
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* top products */}
        <div className="card span-4" style={{ overflow: 'hidden' }}>
          <div className="card-header"><h3>{t('top_products')}</h3></div>
          <div className="recent-list">
            {data.top_products.length === 0 ? (
              <div className="empty" style={{ padding: '40px 16px' }}><p>এখনো বিক্রয় হয়নি</p></div>
            ) : data.top_products.map((p, i) => (
              <div key={p.product_id ?? i} className="recent-row">
                <span className="avatar" style={{ width: 26, height: 26, fontSize: 12 }}>{i + 1}</span>
                <div className="grow ellip">
                  <div className="strong ellip">{p.name}</div>
                  <div className="small muted num">{num(p.qty, p.qty % 1 ? 2 : 0)} পরিমাণ</div>
                </div>
                <div className="t-num strong num">{money(p.revenue)}</div>
              </div>
            ))}
          </div>
        </div>

        {/* recent sales */}
        <div className="card span-6" style={{ overflow: 'hidden' }}>
          <div className="card-header">
            <h3>{t('recent_sales')}</h3>
            <button className="btn btn-ghost btn-sm" onClick={() => navigate('/sales')}>{t('view_all')} <ChevronRight size={13} /></button>
          </div>
          <div className="recent-list">
            {data.recent.sales.length === 0 ? (
              <div className="empty" style={{ padding: '40px 16px' }}><p>এখনো বিক্রয় হয়নি</p></div>
            ) : data.recent.sales.map((s) => (
              <div key={s.id} className="recent-row clickable" onClick={() => navigate(`/sales/${s.id}`)}>
                <div className="grow ellip">
                  <div className="strong num">{s.invoice_no}</div>
                  <div className="small muted ellip">{s.customer_name ?? 'নগদ গ্রাহক'} · {s.user_name ?? ''} · {ftime(s.date)}</div>
                </div>
                {s.due > 0 ? <Badge tone="warning">বাকি {money(s.due, { decimals: false })}</Badge> : null}
                <div className="t-num strong num">{money(s.total)}</div>
              </div>
            ))}
          </div>
        </div>

        {/* recent payments */}
        <div className="card span-6" style={{ overflow: 'hidden' }}>
          <div className="card-header">
            <h3>{t('recent_payments')}</h3>
            <button className="btn btn-ghost btn-sm" onClick={() => navigate('/payments')}>{t('view_all')} <ChevronRight size={13} /></button>
          </div>
          <div className="recent-list">
            {data.recent.payments.length === 0 ? (
              <div className="empty" style={{ padding: '40px 16px' }}><p>এখনো পেমেন্ট হয়নি</p></div>
            ) : data.recent.payments.map((p) => (
              <div key={p.id} className="recent-row">
                <span className={`avatar`} style={{ width: 26, height: 26, fontSize: 11, background: p.direction === 'in' ? 'var(--success-soft)' : 'var(--danger-soft)', color: p.direction === 'in' ? 'var(--success-text)' : 'var(--danger-text)' }}>
                  {p.direction === 'in' ? <ArrowDownRight size={13} /> : <ArrowUpRight size={13} />}
                </span>
                <div className="grow ellip">
                  <div className="strong ellip">{p.party_name ?? '—'}</div>
                  <div className="small muted">{p.party_type === 'customer' ? 'বকেয়া আদায়' : 'সরবরাহকারীকে পরিশোধ'} · {p.method === 'cash' ? 'ক্যাশ' : p.method} · {fdatetime(p.date)}</div>
                </div>
                <div className={`t-num strong num ${p.direction === 'in' ? 'pos' : 'neg'}`}>{p.direction === 'in' ? '+' : '−'}{money(p.amount)}</div>
              </div>
            ))}
          </div>
        </div>

        {/* month chart */}
        {can(PERMS.FINANCE_VIEW) && data.series.length > 2 ? (
          <div className="card span-12" style={{ overflow: 'hidden' }}>
            <div className="card-header">
              <div>
                <h3>ক্রয়-খরচের ধারা (৩০ দিন)</h3>
                <div className="sub">কমলা: ক্রয় · ধূসর: খরচ</div>
              </div>
              <div className="flex gap-3 small muted num">
                <span>মাসিক বিক্রয় <b className="strong">{money(data.month.sales)}</b></span>
                <span>গ্রস <b className="strong pos">{money(data.month.gross_profit)}</b></span>
                <span>খরচ <b className="strong">{money(data.month.expenses)}</b></span>
                <span>নিট <b className={`strong ${data.month.net_profit >= 0 ? 'pos' : 'neg'}`}>{money(data.month.net_profit)}</b></span>
              </div>
            </div>
            <div style={{ height: 180, padding: '10px 8px 4px' }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 4, right: 16, bottom: 0, left: 8 }} barGap={0}>
                  <CartesianGrid strokeDasharray="3 6" stroke="#eceef1" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#98a2b3' }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                  <YAxis tick={{ fontSize: 11, fill: '#98a2b3' }} axisLine={false} tickLine={false} width={56} tickFormatter={(v: number) => money(v, { decimals: false })} />
                  <Tooltip formatter={((value: unknown, name: unknown) => [money(Number(value)), name === 'purchases' ? 'ক্রয়' : 'খরচ']) as never} contentStyle={{ borderRadius: 10, border: '1px solid #e4e7ec', fontSize: 12 }} cursor={{ fill: 'rgba(29,78,216,0.04)' }} />
                  <Bar dataKey="purchases" fill="#f59e0b" radius={[3, 3, 0, 0]} maxBarSize={14} />
                  <Bar dataKey="expenses" fill="#98a2b3" radius={[3, 3, 0, 0]} maxBarSize={14} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}
