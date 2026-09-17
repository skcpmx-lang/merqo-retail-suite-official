import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowDownToLine, ArrowUpFromLine, Send, Percent } from 'lucide-react'
import { api } from '@/api/client'
import { useSession } from '@/state/session'
import { useToast } from '@/state/toast'
import { t, money, fdatetime, presetRange } from '@/i18n/bn'
import { PageHeader, StatCard, DataTable, Pagination, Modal, Field, RangePicker, type RangeKind, type Column } from '@/ui/components'
import { PERMS } from '../perm'

interface MfsAccount { id: string; name: string; type: string; provider: string | null; balance: number }
interface MfsTx {
  id: string
  date: number
  provider: string
  txn_type: string
  account_name: string
  counter_account_name: string | null
  amount: number
  commission: number
  service_charge: number
  customer_phone: string | null
  note: string | null
  user_name: string | null
}

const PROV_BN: Record<string, string> = { bkash: 'বিকাশ', nagad: 'নগদ', rocket: 'রকেট', upay: 'Upay' }
const TYPE_BN: Record<string, string> = {
  cash_in: 'ক্যাশ ইন',
  cash_out: 'ক্যাশ আউট',
  send_money: 'সেন্ড মানি',
  payment: 'পেমেন্ট',
  commission: 'কমিশন গ্রহণ',
  adjustment: 'সমন্বয়'
}

export function Mfs() {
  const { can } = useSession()
  const [txOpen, setTxOpen] = useState<null | { type: 'cash_in' | 'cash_out' | 'send_money' | 'payment' | 'commission' }>(null)
  const [range, setRange] = useState<RangeKind>('7d')
  const [from, setFrom] = useState(() => presetRange('7d').from)
  const [to, setTo] = useState(() => presetRange('7d').to)
  const [page, setPage] = useState(1)
  const pageSize = 25

  const { data: accounts } = useQuery({ queryKey: ['accounts-full'], queryFn: () => api.get<{ rows: MfsAccount[] }>('/accounts') })
  const { data, isLoading, refetch, error } = useQuery({
    queryKey: ['mfs-tx', from, to, page],
    queryFn: () => api.get<{ rows: MfsTx[]; total: number; sums: { cash_in: number; cash_out: number; commission: number; charges: number } }>('/mfs', { from, to, page, pageSize }),
    refetchInterval: 45_000
  })
  const { data: summaryToday } = useQuery({
    queryKey: ['mfs-summary-today'],
    queryFn: () => api.get<{ rows: Array<{ provider: string; commission: number; charges: number; cash_in: number; cash_out: number; count: number }> }>('/mfs/summary', { from: presetRange('today').from, to: presetRange('today').to })
  })
  const { data: summaryMonth } = useQuery({
    queryKey: ['mfs-summary-month'],
    queryFn: () => api.get<{ rows: Array<{ provider: string; commission: number; charges: number }> }>('/mfs/summary', { from: presetRange('month').from, to: presetRange('month').to })
  })

  const mfsAccounts = (accounts?.rows ?? []).filter((a) => a.type === 'mfs')
  const cashAccounts = (accounts?.rows ?? []).filter((a) => a.type === 'cash')

  const columns = useMemo<Column<MfsTx>[]>(() => [
    { key: 'date', header: t('date'), width: 150, render: (r) => <span className="muted">{fdatetime(r.date)}</span> },
    { key: 'provider', header: 'ওয়ালেট', width: 110, render: (r) => <span className="td-strong">{PROV_BN[r.provider] ?? r.provider}</span> },
    { key: 'txn_type', header: 'কাজ', width: 120, render: (r) => TYPE_BN[r.txn_type] ?? r.txn_type },
    { key: 'customer_phone', header: 'গ্রাহক নং', width: 120, render: (r) => <span className="num muted">{r.customer_phone ?? '—'}</span> },
    { key: 'amount', header: 'পরিমাণ', align: 'right', width: 110, render: (r) => <span className="num td-strong">{money(r.amount)}</span> },
    { key: 'service_charge', header: 'চার্জ নেওয়া', align: 'right', width: 100, render: (r) => r.service_charge > 0 ? <span className="num pos">{money(r.service_charge)}</span> : '—' },
    { key: 'commission', header: 'কমিশন', align: 'right', width: 100, render: (r) => r.commission > 0 ? <span className="num pos">{money(r.commission)}</span> : '—' },
    { key: 'user_name', header: 'করেছেন', width: 100, render: (r) => <span className="muted small">{r.user_name ?? ''}</span> }
  ], [])

  const commissionToday = (summaryToday?.rows ?? []).reduce((a, r) => a + r.commission, 0)
  const commissionMonth = (summaryMonth?.rows ?? []).reduce((a, r) => a + r.commission, 0)
  const chargesMonth = (summaryMonth?.rows ?? []).reduce((a, r) => a + r.charges, 0)

  return (
    <div className="page">
      <PageHeader
        title={t('mfs_title')}
        sub={t('mfs_sub')}
        actions={
          can(PERMS.MFS_OPERATE) ? (
            <>
              <button className="btn btn-secondary" onClick={() => setTxOpen({ type: 'cash_in' })}><ArrowDownToLine size={15} /> {t('mfs_cash_in')}</button>
              <button className="btn btn-primary" onClick={() => setTxOpen({ type: 'cash_out' })}><ArrowUpFromLine size={15} /> {t('mfs_cash_out')}</button>
              <button className="btn btn-secondary" onClick={() => setTxOpen({ type: 'send_money' })}><Send size={15} /> {t('mfs_send_money')}</button>
              <button className="btn btn-secondary" onClick={() => setTxOpen({ type: 'payment' })}><Percent size={15} /> {t('mfs_payment')}</button>
              <button className="btn btn-secondary" onClick={() => setTxOpen({ type: 'commission' })}>কমিশন গ্রহণ</button>
            </>
          ) : undefined
        }
      />

      <div className="grid-stats" style={{ marginBottom: 16 }}>
        {mfsAccounts.map((a) => (
          <StatCard key={a.id} compact label={`${PROV_BN[a.provider ?? ''] ?? a.name} এজেন্ট`} value={money(a.balance)} />
        ))}
        {mfsAccounts.length === 0 ? (
          <div className="card card-pad" style={{ gridColumn: '1 / -1' }}>
            <div className="empty" style={{ padding: 20 }}>
              <p>মোবাইল ব্যাংকিং ওয়ালেট যোগ করা নেই — {t('accounts_title')} থেকে MFS হিসাব (প্রদানকারীসহ) খুলুন</p>
            </div>
          </div>
        ) : null}
      </div>

      <div className="grid-stats" style={{ marginBottom: 14 }}>
        <StatCard compact label="আজকের কমিশন" value={money(commissionToday)} tone="success" />
        <StatCard compact label="এই মাসের কমিশন" value={money(commissionMonth)} />
        <StatCard compact label="মাসিক সার্ভিস চার্জ আয়" value={money(chargesMonth)} />
        <StatCard compact label="ক্যাশ-ইন (সময়কাল)" value={money(data?.sums.cash_in ?? 0)} />
        <StatCard compact label="ক্যাশ-আউট (সময়কাল)" value={money(data?.sums.cash_out ?? 0)} />
      </div>

      <div style={{ marginBottom: 12 }}>
        <RangePicker value={range} onChange={(k, f, tt) => { setRange(k); if (f && tt) { setFrom(f); setTo(tt) }; setPage(1) }} />
      </div>

      <DataTable
        columns={columns}
        rows={data?.rows ?? []}
        rowKey={(r) => r.id}
        loading={isLoading}
        error={error ? (error as Error).message : null}
        onRetry={() => void refetch()}
        emptyTitle="কোনো MFS লেনদেন নেই"
        emptySub="ক্যাশ ইন/আউট, সেন্ড মানি, বিল পেমেন্ট — সব এখানে জমা হবে"
        maxHeight="calc(100vh - 500px)"
      />
      <div className="card" style={{ borderTop: 'none', borderRadius: '0 0 var(--r-xl) var(--r-xl)' }}>
        <Pagination page={page} pageSize={pageSize} total={data?.total ?? 0} onPage={setPage} />
      </div>

      {txOpen ? <TxModal kind={txOpen.type} wallets={mfsAccounts} cashAccounts={cashAccounts} onClose={() => setTxOpen(null)} /> : null}
    </div>
  )
}

function TxModal({ kind, wallets, cashAccounts, onClose }: {
  kind: 'cash_in' | 'cash_out' | 'send_money' | 'payment' | 'commission'
  wallets: MfsAccount[]
  cashAccounts: MfsAccount[]
  onClose: () => void
}) {
  const qc = useQueryClient()
  const { toast } = useToast()
  const [accountId, setAccountId] = useState(wallets[0]?.id ?? '')
  const [counterId, setCounterId] = useState(cashAccounts[0]?.id ?? '')
  const [amount, setAmount] = useState('')
  const [charge, setCharge] = useState('0')
  const [commission, setCommission] = useState('')
  const [phone, setPhone] = useState('')
  const [reference, setReference] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  const title = { cash_in: t('mfs_cash_in'), cash_out: t('mfs_cash_out'), send_money: t('mfs_send_money'), payment: t('mfs_payment'), commission: 'কমিশন গ্রহণ' }[kind]
  const hint = {
    cash_in: 'গ্রাহক থেকে ক্যাশ নিয়ে ওয়ালেটে বসানো হলো (ক্যাশ বক্স থেকে যাবে, এজেন্ট ব্যালেন্সে আসবে)',
    cash_out: 'এজেন্ট ব্যালেন্স থেকে তুলে গ্রাহককে ক্যাশ দেওয়া হলো (চার্জসহ ক্যাশ বক্সে আসবে)',
    send_money: 'এজেন্ট ব্যালেন্স থেকে অন্য নম্বরে পাঠানো হলো — টাকা ক্যাশে আসে না',
    payment: 'গ্রাহকের বিল ওয়ালেট দিয়ে দেওয়া হলো; গ্রাহক ক্যাশ + চার্জ দেবে',
    commission: 'প্রতিষ্ঠান থেকে প্রাপ্ত কমিশন এজেন্ট ব্যালেন্সে যোগ হবে'
  }[kind]

  const needsCounter = kind === 'cash_in' || kind === 'cash_out' || kind === 'send_money'

  const suggest = async (amt: string) => {
    setAmount(amt)
    const a = Math.round(Number(amt) * 100) || 0
    const wallet = wallets.find((w) => w.id === accountId)
    if (!a || !wallet?.provider) return
    try {
      const res = await api.get<{ commission: number }>('/mfs/suggest-commission', {
        provider: wallet.provider,
        txn_type: kind === 'cash_in' ? 'cash_in' : 'cash_out',
        amount: a
      })
      if (res.commission > 0) setCommission(String(res.commission / 100))
    } catch { /* settings not set — leave manual */ }
  }

  const submit = async () => {
    const acc = wallets.find((w) => w.id === accountId)
    const amt = Math.round(Number(amount) * 100) || 0
    const ch = Math.round(Number(charge) * 100) || 0
    const cm = Math.round(Number(commission) * 100) || 0
    if (!acc) { toast('ওয়ালেট বাছুন', 'warning'); return }
    if (amt <= 0 && !(kind === 'commission' && cm > 0)) { toast('পরিমাণ দিন', 'warning'); return }
    if (needsCounter && !counterId) { toast('ক্যাশ হিসাব বাছুন', 'warning'); return }
    setBusy(true)
    try {
      await api.post('/mfs', {
        provider: acc.provider ?? 'other',
        txn_type: kind,
        account_id: accountId,
        counter_account_id: needsCounter || kind === 'payment' ? counterId : undefined,
        amount: kind === 'commission' ? cm : amt,
        commission: kind === 'commission' ? cm : cm,
        service_charge: ch,
        customer_phone: phone.trim() || undefined,
        reference_no: reference.trim() || undefined,
        note: note.trim() || undefined
      })
      void qc.invalidateQueries()
      toast('লেনদেন সম্পন্ন', 'success')
      onClose()
    } catch (e) { toast((e as Error).message, 'error') } finally { setBusy(false) }
  }

  return (
    <Modal open onClose={onClose} title={title} sub={hint} size="sm"
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose}>{t('cancel')}</button>
          <button className="btn btn-primary" disabled={busy} onClick={() => void submit()}>{busy ? <span className="spinner" /> : null}{t('confirm')}</button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label="MFS ওয়ালেট" required>
          <select className="select" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            {wallets.map((w) => <option key={w.id} value={w.id}>{PROV_BN[w.provider ?? ''] ?? w.name} — ব্যালেন্স {money(w.balance)}</option>)}
          </select>
        </Field>
        {needsCounter || kind === 'payment' ? (
          <Field label={kind === 'cash_in' ? 'কোন ক্যাশ বক্স থেকে যাবে' : 'কোন ক্যাশ বক্সে আসবে'} required={needsCounter}>
            <select className="select" value={counterId} onChange={(e) => setCounterId(e.target.value)}>
              {(kind === 'payment' ? [...cashAccounts] : cashAccounts).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </Field>
        ) : null}
        {kind !== 'commission' ? (
          <Field label={`${t('amount')} (৳)`} required>
            <input className="input input-money input-lg" value={amount} onChange={(e) => void suggest(e.target.value.replace(/[^\d.]/g, ''))} inputMode="decimal" autoFocus onFocus={(e) => e.target.select()} />
          </Field>
        ) : null}
        {kind === 'commission' ? (
          <Field label="কমিশনের পরিমাণ (৳)" required>
            <input className="input input-money input-lg" value={commission} onChange={(e) => setCommission(e.target.value.replace(/[^\d.]/g, ''))} inputMode="decimal" autoFocus onFocus={(e) => e.target.select()} />
          </Field>
        ) : null}
        <Field label="গ্রাহকের মোবাইল নং (ঐচ্ছিক)">
          <input className="input num" value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="numeric" placeholder="01…" />
        </Field>
        {kind === 'cash_out' || kind === 'send_money' || kind === 'payment' ? (
          <Field label="গ্রাহক থেকে অতিরিক্ত চার্জ নিলে (৳)" hint="চার্জ ক্যাশ বক্সে আয় হিসেবে জমা হবে">
            <input className="input input-money" value={charge} onChange={(e) => setCharge(e.target.value.replace(/[^\d.]/g, '') || '0')} inputMode="decimal" onFocus={(e) => e.target.select()} />
          </Field>
        ) : null}
        {kind === 'cash_in' || kind === 'cash_out' ? (
          <Field label="প্রতিষ্ঠানের কমিশন (৳, ঐচ্ছিক)" hint="হিসাবের জন্য লিখে রাখুন — কমিশন গ্রহণের সময় আসলে যোগ হবে">
            <input className="input input-money" value={commission} onChange={(e) => setCommission(e.target.value.replace(/[^\d.]/g, ''))} inputMode="decimal" onFocus={(e) => e.target.select()} />
          </Field>
        ) : null}
        {kind === 'commission' ? null : (
          <Field label="রেফারেন্স/TrxID (ঐচ্ছিক)">
            <input className="input num" value={reference} onChange={(e) => setReference(e.target.value)} />
          </Field>
        )}
      </div>
    </Modal>
  )
}
