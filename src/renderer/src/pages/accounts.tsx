import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, ArrowLeftRight, Wallet, Landmark, Smartphone, MoreHorizontal, Pencil, ChevronDown } from 'lucide-react'
import { api } from '@/api/client'
import { useSession } from '@/state/session'
import { useToast } from '@/state/toast'
import { t, money, fdatetime, presetRange, num } from '@/i18n/bn'
import { PageHeader, StatCard, Modal, Field, Menu, MenuItem, DataTable, RangePicker, type RangeKind, type Column } from '@/ui/components'
import { PERMS } from '../perm'

interface Account {
  id: string
  name: string
  type: string
  provider: string | null
  account_no: string | null
  balance: number
  opening_balance: number
  is_active: number
}

const TYPE_BN: Record<string, string> = { cash: 'ক্যাশ', bank: 'ব্যাংক', mfs: 'মোবাইল ব্যাংকিং', other: 'অন্যান্য' }
const typeIcon = (t: string) => t === 'cash' ? <Wallet size={15} /> : t === 'bank' ? <Landmark size={15} /> : <Smartphone size={15} />

export function Accounts() {
  const { can } = useSession()
  const qc = useQueryClient()
  const { toast } = useToast()

  const [newOpen, setNewOpen] = useState(false)
  const [editFor, setEditFor] = useState<Account | null>(null)
  const [transferOpen, setTransferOpen] = useState(false)
  const [ledgerFor, setLedgerFor] = useState<Account | null>(null)
  const [range, setRange] = useState<RangeKind>('30d')
  const [from, setFrom] = useState(() => presetRange('30d').from)
  const [to, setTo] = useState(() => presetRange('30d').to)

  const { data, isLoading, refetch, error } = useQuery({ queryKey: ['accounts-full'], queryFn: () => api.get<{ rows: Account[] }>('/accounts') })

  const accounts = data?.rows ?? []
  const total = accounts.reduce((a, x) => a + x.balance, 0)
  const byType = (t: string) => accounts.filter((a) => a.type === t).reduce((a, x) => a + x.balance, 0)

  const ledger = useQuery({
    queryKey: ['ledger', ledgerFor?.id, from, to],
    queryFn: () => api.get<{ rows: LedRow[]; inflow: number; outflow: number }>('/ledger', { account_id: ledgerFor?.id, from, to, pageSize: 500 }),
    enabled: !!ledgerFor
  })
  interface LedRow { id: string; date: number; created_at: number; account_name: string; type: string; note: string | null; ref_type: string | null; ref_id: string | null; amount: number; balance_after: number }

  const ledCols = useMemo<Column<LedRow>[]>(() => [
    { key: 'date', header: t('date'), width: 150, render: (r) => <span className="muted">{fdatetime(r.created_at)}</span> },
    { key: 'type', header: t('type'), width: 110, render: (r) => ({ opening: 'শুরু', sale: 'বিক্রয়', purchase: 'ক্রয়', transfer_in: 'ট্রান্সফার ইন', transfer_out: 'ট্রান্সফার আউট', supplier_payment: 'সরবরাহকারী পেমেন্ট', customer_payment: 'বকেয়া আদায়', refund: 'ফেরত', void: 'বাতিল', expense: 'খরচ', mfs_cash_in: 'MFS ক্যাশ-ইন', mfs_cash_out: 'MFS ক্যাশ-আউট', mfs_payment: 'MFS পেমেন্ট', mfs_commission: 'MFS কমিশন', mfs_adjustment: 'MFS সমন্বয়' }[r.type] ?? r.type) },
    { key: 'note', header: t('details'), render: (r) => <span>{r.note ?? '—'}{r.ref_type ? <span className="muted small"> · {r.ref_type}</span> : null}</span> },
    { key: 'amount', header: 'প্রবাহ', align: 'right', width: 130, render: (r) => <span className={`num td-strong ${r.amount >= 0 ? 'pos' : 'neg'}`}>{r.amount >= 0 ? '+' : '−'}{money(Math.abs(r.amount))}</span> },
    { key: 'balance_after', header: 'ব্যালেন্স', align: 'right', width: 130, render: (r) => <span className="num td-strong">{money(r.balance_after)}</span> }
  ], [])

  return (
    <div className="page">
      <PageHeader
        title={t('accounts_title')}
        sub={t('accounts_sub')}
        actions={
          <>
            {can(PERMS.ACCOUNTS_TRANSFER) && accounts.length >= 2 ? (
              <button className="btn btn-secondary" onClick={() => setTransferOpen(true)}><ArrowLeftRight size={15} /> {t('transfer_btn')}</button>
            ) : null}
            {can(PERMS.ACCOUNTS_MANAGE) ? <button className="btn btn-primary" onClick={() => setNewOpen(true)}><Plus size={16} /> {t('add_account')}</button> : null}
          </>
        }
      />

      <div className="grid-stats" style={{ marginBottom: 16 }}>
        <StatCard label="মোট নগদ সম্পদ" value={money(total)} tone="primary" />
        <StatCard compact label="ক্যাশ" value={money(byType('cash'))} icon={<Wallet size={13} />} />
        <StatCard compact label="ব্যাংক" value={money(byType('bank'))} icon={<Landmark size={13} />} />
        <StatCard compact label="মোবাইল ব্যাংকিং" value={money(byType('mfs'))} icon={<Smartphone size={13} />} />
      </div>

      <div className="account-cards">
        {accounts.map((a) => (
          <div key={a.id} className="card card-pad account-card">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span className="avatar" style={{ background: 'var(--primary-soft)', color: 'var(--primary-text)' }}>{typeIcon(a.type)}</span>
              <div className="grow">
                <div className="strong">{a.name}</div>
                <div className="small muted">{TYPE_BN[a.type] ?? a.type}{a.account_no ? ` · ${a.account_no}` : ''}</div>
              </div>
              <Menu align="right" trigger={<button className="btn btn-ghost btn-sm btn-icon"><MoreHorizontal size={15} /></button>}>
                <MenuItem icon={<ChevronDown size={14} />} onClick={() => setLedgerFor(a)}>{t('ledger')}</MenuItem>
                {can(PERMS.ACCOUNTS_MANAGE) ? <MenuItem icon={<Pencil size={14} />} onClick={() => setEditFor(a)}>{t('edit')}</MenuItem> : null}
              </Menu>
            </div>
            <div className="stat-value num" style={{ marginTop: 10, fontSize: 22 }}>{money(a.balance)}</div>
            <div className="small muted" style={{ marginTop: 2 }}>শুরু: {money(a.opening_balance)}</div>
            <button className="btn btn-ghost btn-sm" style={{ marginTop: 8 }} onClick={() => setLedgerFor(a)}>{t('view_ledger')}</button>
          </div>
        ))}
        {accounts.length === 0 && !isLoading ? <div className="empty card card-pad"><p>কোনো হিসাব নেই</p></div> : null}
      </div>

      {/* ledger drawer */}
      <Modal open={!!ledgerFor} onClose={() => setLedgerFor(null)} title={`${t('ledger')} — ${ledgerFor?.name ?? ''}`} size="xl"
        footer={<button className="btn btn-secondary" onClick={() => setLedgerFor(null)}>{t('cancel')}</button>}>
        <div style={{ marginBottom: 10 }}>
          <RangePicker value={range} onChange={(k, f, tt) => { setRange(k); if (f && tt) { setFrom(f); setTo(tt) } }} />
        </div>
        <DataTable
          columns={ledCols}
          rows={ledger.data?.rows ?? []}
          rowKey={(r) => r.id}
          loading={ledger.isLoading}
          maxHeight={420}
          emptyTitle="কোনো লেনদেন নেই"
        />
      </Modal>

      <AccountModal open={newOpen} onClose={() => setNewOpen(false)} />
      {editFor ? <AccountModal existing={editFor} onClose={() => setEditFor(null)} /> : null}
      {transferOpen ? <TransferModal accounts={accounts} onClose={() => setTransferOpen(false)} /> : null}
    </div>
  )
}

function AccountModal({ existing, open, onClose }: { existing?: Account; open?: boolean; onClose: () => void }) {
  const qc = useQueryClient()
  const { toast } = useToast()
  const [name, setName] = useState(existing?.name ?? '')
  const [type, setType] = useState(existing?.type ?? 'cash')
  const [provider, setProvider] = useState(existing?.provider ?? '')
  const [accountNo, setAccountNo] = useState(existing?.account_no ?? '')
  const [opening, setOpening] = useState(existing ? String(existing.opening_balance / 100) : '')
  const [busy, setBusy] = useState(false)
  const isOpen = open ?? !!existing

  const save = async () => {
    if (!name.trim()) { toast('হিসাবের নাম দিন', 'warning'); return }
    setBusy(true)
    try {
      if (existing) await api.patch(`/accounts/${existing.id}`, { name: name.trim(), type, provider: type === 'mfs' ? provider : undefined, accountNo: accountNo.trim() || undefined })
      else await api.post('/accounts', { name: name.trim(), type, provider: type === 'mfs' ? provider : undefined, accountNo: accountNo.trim() || undefined, openingBalance: Math.round(Number(opening || 0) * 100) || 0 })
      void qc.invalidateQueries()
      toast(existing ? 'হিসাব হালনাগাদ হয়েছে' : 'হিসাব যোগ হয়েছে', 'success')
      onClose()
    } catch (e) { toast((e as Error).message, 'error') } finally { setBusy(false) }
  }

  return (
    <Modal open={isOpen} onClose={onClose} title={existing ? t('edit_account') : t('add_account')} size="sm"
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose}>{t('cancel')}</button>
          <button className="btn btn-primary" disabled={busy} onClick={() => void save()}>{busy ? <span className="spinner" /> : null}{t('save')}</button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label="হিসাবের নাম" required><input className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus /></Field>
        <Field label="ধরন" required>
          <select className="select" value={type} onChange={(e) => setType(e.target.value)} disabled={!!existing}>
            <option value="cash">ক্যাশ বক্স</option>
            <option value="bank">ব্যাংক</option>
            <option value="mfs">মোবাইল ব্যাংকিং</option>
            <option value="other">অন্যান্য</option>
          </select>
        </Field>
        {type === 'mfs' ? (
          <Field label="প্রদানকারী" required>
            <select className="select" value={provider} onChange={(e) => setProvider(e.target.value)}>
              <option value="">—</option>
              <option value="bkash">bKash</option>
              <option value="nagad">Nagad</option>
              <option value="rocket">Rocket</option>
              <option value="upay">Upay</option>
            </select>
          </Field>
        ) : null}
        {type === 'bank' ? <Field label="হিসাব নং"><input className="input num" value={accountNo} onChange={(e) => setAccountNo(e.target.value)} /></Field> : null}
        {!existing ? <Field label="শুরুর ব্যালেন্স (৳)"><input className="input input-money" value={opening} onChange={(e) => setOpening(e.target.value)} inputMode="decimal" placeholder="0" /></Field> : null}
      </div>
    </Modal>
  )
}

function TransferModal({ accounts, onClose }: { accounts: Account[]; onClose: () => void }) {
  const qc = useQueryClient()
  const { toast } = useToast()
  const [fromAcc, setFromAcc] = useState(accounts[0]?.id ?? '')
  const [toAcc, setToAcc] = useState(accounts[1]?.id ?? '')
  const [amount, setAmount] = useState('')
  const [charge, setCharge] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    const amt = Math.round(Number(amount) * 100) || 0
    const ch = Math.round(Number(charge) * 100) || 0
    if (amt <= 0) { toast('পরিমাণ দিন', 'warning'); return }
    if (fromAcc === toAcc) { toast('একই হিসাবে ট্রান্সফার করা যায় না', 'warning'); return }
    setBusy(true)
    try {
      await api.post('/transfers', { from: fromAcc, to: toAcc, amount: amt, fee: ch, note: note || undefined })
      void qc.invalidateQueries()
      toast('ট্রান্সফার সম্পন্ন', 'success')
      onClose()
    } catch (e) { toast((e as Error).message, 'error') } finally { setBusy(false) }
  }

  return (
    <Modal open onClose={onClose} title={t('transfer_btn')} sub="এক হিসাব থেকে আরেক হিসাবে টাকা সরান" size="sm"
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose}>{t('cancel')}</button>
          <button className="btn btn-primary" disabled={busy} onClick={() => void submit()}>{busy ? <span className="spinner" /> : null}{t('confirm')}</button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label="যেখান থেকে" required>
          <select className="select" value={fromAcc} onChange={(e) => setFromAcc(e.target.value)}>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.name} ({money(a.balance)})</option>)}
          </select>
        </Field>
        <Field label="যেখানে" required>
          <select className="select" value={toAcc} onChange={(e) => setToAcc(e.target.value)}>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </Field>
        <Field label={`${t('amount')} (৳)`} required><input className="input input-money input-lg" value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" autoFocus onFocus={(e) => e.target.select()} /></Field>
        <Field label="চার্জ/ফি (৳)" hint="যেমন ব্যাংক/বিকাশ ট্রান্সফার ফি — প্রেরক হিসাব থেকে অতিরিক্ত কাটা হবে"><input className="input input-money" value={charge} onChange={(e) => setCharge(e.target.value)} inputMode="decimal" placeholder="0" /></Field>
        <Field label={t('note')}><input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="ঐচ্ছিক" /></Field>
      </div>
    </Modal>
  )
}
