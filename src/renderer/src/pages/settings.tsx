import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Building2, Save, KeyRound, Lock, Printer, Server } from 'lucide-react'
import { api } from '@/api/client'
import { useSession } from '@/state/session'
import { useToast } from '@/state/toast'
import { t, money } from '@/i18n/bn'
import { PageHeader, Field, Modal, Badge } from '@/ui/components'
import { PERMS } from '../perm'

export function Settings() {
  const { can, business, me, refresh } = useSession()
  const qc = useQueryClient()
  const { toast } = useToast()

  const canManage = can(PERMS.SETTINGS_MANAGE)
  const [values, setValues] = useState<Record<string, unknown>>({})
  const [biz, setBiz] = useState({ name: '', owner_name: '', phone: '', email: '', address: '' })
  const [busy, setBusy] = useState(false)
  const [pwOpen, setPwOpen] = useState(false)
  const [pinOpen, setPinOpen] = useState(false)

  const { data: settingsData } = useQuery({
    queryKey: ['settings-full'],
    queryFn: () => api.get<{ values: Record<string, unknown> }>('/settings'),
    enabled: can(PERMS.SETTINGS_VIEW)
  })

  useEffect(() => {
    if (settingsData?.values) setValues(settingsData.values)
  }, [settingsData])

  useEffect(() => {
    if (business) {
      setBiz({
        name: business.name ?? '', owner_name: business.owner_name ?? '',
        phone: business.phone ?? '', email: business.email ?? '', address: business.address ?? ''
      })
    }
  }, [business])

  const set = (k: string, v: unknown) => setValues((s) => ({ ...s, [k]: v }))
  const n = (k: string) => Number(values[k] ?? 0)
  const str = (k: string) => String(values[k] ?? '')
  const bool = (k: string) => !!values[k]

  const saveSettings = async () => {
    setBusy(true)
    try {
      await api.patch('/settings', { values })
      void qc.invalidateQueries({ queryKey: ['settings-full'] })
      toast('সেটিংস সংরক্ষিত হয়েছে', 'success')
    } catch (e) { toast((e as Error).message, 'error') } finally { setBusy(false) }
  }

  const saveBusiness = async () => {
    setBusy(true)
    try {
      await api.patch(`/businesses/${business!.id}`, biz)
      await refresh()
      toast('ব্যবসার তথ্য হালনাগাদ হয়েছে', 'success')
    } catch (e) { toast((e as Error).message, 'error') } finally { setBusy(false) }
  }

  if (!can(PERMS.SETTINGS_VIEW)) return null

  return (
    <div className="page" style={{ maxWidth: 940 }}>
      <PageHeader
        title={t('settings_title')}
        sub={t('settings_sub')}
        actions={canManage ? <button className="btn btn-primary" disabled={busy} onClick={() => void saveSettings()}><Save size={15} /> সেটিংস সংরক্ষণ</button> : null}
      />

      <div className="grid-2" style={{ alignItems: 'start' }}>
        {/* business info */}
        <div className="card card-pad">
          <h3 style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}><Building2 size={17} /> ব্যবসার তথ্য</h3>
          <div className="flex flex-col gap-3">
            <Field label="ব্যবসার নাম" required>
              <input className="input" value={biz.name} disabled={!canManage} onChange={(e) => setBiz({ ...biz, name: e.target.value })} />
            </Field>
            <Field label="মালিকের নাম">
              <input className="input" value={biz.owner_name} disabled={!canManage} onChange={(e) => setBiz({ ...biz, owner_name: e.target.value })} />
            </Field>
            <div className="grid-2">
              <Field label="ফোন"><input className="input num" value={biz.phone} disabled={!canManage} onChange={(e) => setBiz({ ...biz, phone: e.target.value })} /></Field>
              <Field label="ইমেইল"><input className="input" value={biz.email} disabled={!canManage} onChange={(e) => setBiz({ ...biz, email: e.target.value })} /></Field>
            </div>
            <Field label="ঠিকানা"><input className="input" value={biz.address} disabled={!canManage} onChange={(e) => setBiz({ ...biz, address: e.target.value })} /></Field>
            {canManage ? <button className="btn btn-secondary" disabled={busy} onClick={() => void saveBusiness()}>ব্যবসার তথ্য সংরক্ষণ</button> : null}
          </div>
        </div>

        <div className="flex flex-col gap-4">
          {/* receipt & invoice */}
          <div className="card card-pad">
            <h3 style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}><Printer size={17} /> চালান ও প্রিন্ট</h3>
            <div className="flex flex-col gap-3">
              <div className="grid-2">
                <Field label="রসিদের কাগজ">
                  <select className="select" value={str('receipt_paper') || '80mm'} disabled={!canManage} onChange={(e) => set('receipt_paper', e.target.value)}>
                    <option value="80mm">থার্মাল ৮০ মিমি</option>
                    <option value="58mm">থার্মাল ৫৮ মিমি</option>
                    <option value="A4">A4</option>
                    <option value="A5">A5</option>
                  </select>
                </Field>
                <Field label="চালানের টেমপ্লেট">
                  <select className="select" value={str('invoice_template') || 'a4'} disabled={!canManage} onChange={(e) => set('invoice_template', e.target.value)}>
                    <option value="a4">A4</option>
                    <option value="a5">A5</option>
                  </select>
                </Field>
              </div>
              <Field label="ডিফল্ট প্রিন্টার (খালি = সিস্টেম ডিফল্ট)">
                <input className="input" value={str('default_printer')} disabled={!canManage} onChange={(e) => set('default_printer', e.target.value)} placeholder="Windows প্রিন্টারের নাম" />
              </Field>
              <Field label="রসিদের ফুটার">
                <input className="input" value={str('receipt_footer')} disabled={!canManage} onChange={(e) => set('receipt_footer', e.target.value)} />
              </Field>
              <label className="check">
                <input type="checkbox" checked={bool('vat_enabled')} disabled={!canManage} onChange={(e) => set('vat_enabled', e.target.checked)} />
                ভ্যাট চালু (বিক্রয়ের উপর)
              </label>
              {bool('vat_enabled') ? (
                <Field label="ভ্যাট হার (%)">
                  <input className="input input-money" value={String(n('vat_percent'))} disabled={!canManage} onChange={(e) => set('vat_percent', Number(e.target.value.replace(/[^\d.]/g, '')) || 0)} />
                </Field>
              ) : null}
            </div>
          </div>

          {/* business rules */}
          <div className="card card-pad">
            <h3 style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}><Lock size={17} /> ব্যবসায়িক নিয়ম</h3>
            <div className="flex flex-col gap-3">
              <label className="check">
                <input type="checkbox" checked={bool('allow_negative_stock')} disabled={!canManage} onChange={(e) => set('allow_negative_stock', e.target.checked)} />
                স্টক ঋণাত্মক হতে দেওয়া হবে (না দিলে স্টক শেষে বিক্রি আটকাবে)
              </label>
              <div className="grid-2">
                <Field label="বড় বকেয়া সতর্কতা (৳)" hint={money(n('large_due_threshold'))}>
                  <input className="input input-money" value={String(n('large_due_threshold') / 100)} disabled={!canManage} onChange={(e) => set('large_due_threshold', Math.round(Number(e.target.value.replace(/[^\d.]/g, '')) * 100) || 0)} />
                </Field>
                <Field label="মেয়াদ সতর্কতা (দিন আগে)">
                  <input className="input input-money" value={String(n('expiry_alert_days'))} disabled={!canManage} onChange={(e) => set('expiry_alert_days', Number(e.target.value.replace(/[^\d.]/g, '')) || 0)} />
                </Field>
              </div>
              <div className="grid-2">
                <Field label="MFS ক্যাশ-ইন কমিশন (bps)" hint={`${(n('mfs_commission_cash_in_bps') / 100).toFixed(2)}%`}>
                  <input className="input input-money" value={String(n('mfs_commission_cash_in_bps'))} disabled={!canManage} onChange={(e) => set('mfs_commission_cash_in_bps', Number(e.target.value.replace(/[^\d.]/g, '')) || 0)} />
                </Field>
                <Field label="MFS ক্যাশ-আউট কমিশন (bps)" hint={`${(n('mfs_commission_cash_out_bps') / 100).toFixed(2)}%`}>
                  <input className="input input-money" value={String(n('mfs_commission_cash_out_bps'))} disabled={!canManage} onChange={(e) => set('mfs_commission_cash_out_bps', Number(e.target.value.replace(/[^\d.]/g, '')) || 0)} />
                </Field>
              </div>
              <div className="grid-2">
                <Field label="ব্যাকআপ সংখ্যা (কতটা রাখা হবে)">
                  <input className="input input-money" value={String(n('backup_keep'))} disabled={!canManage} onChange={(e) => set('backup_keep', Number(e.target.value.replace(/[^\d.]/g, '')) || 10)} />
                </Field>
                <Field label="চালান প্রিফিক্স">
                  <input className="input num" value={str('invoice_prefix')} disabled={!canManage} onChange={(e) => set('invoice_prefix', e.target.value)} />
                </Field>
              </div>
              <label className="check">
                <input type="checkbox" checked={bool('backup_auto_daily')} disabled={!canManage} onChange={(e) => set('backup_auto_daily', e.target.checked)} />
                প্রতিদিন স্বয়ংক্রিয় ব্যাকআপ
              </label>
            </div>
          </div>
        </div>
      </div>

      {/* security */}
      <div className="card card-pad" style={{ marginTop: 16 }}>
        <h3 style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}><KeyRound size={17} /> নিরাপত্তা</h3>
        <div className="flex flex-col gap-3" style={{ maxWidth: 460 }}>
          <div className="sum-row"><span>অ্যাকাউন্ট</span><b>{me?.user.name} (@{me?.user.username})</b></div>
          <button className="btn btn-secondary" onClick={() => setPwOpen(true)}><KeyRound size={15} /> পাসওয়ার্ড বদলান</button>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button className="btn btn-secondary" onClick={() => setPinOpen(true)}><Lock size={15} /> {me?.has_pin ? 'পিন বদলান' : 'পিন সেট করুন'}</button>
            {me?.has_pin ? <Badge tone="success">পিন সেট করা আছে</Badge> : <Badge tone="warning">পিন নেই</Badge>}
          </div>
          <p className="small muted">পিন দিয়ে স্ক্রিন দ্রুত লক/আনলক করা যায় — কাউন্টারে চলে যাওয়ার সময় কাজে লাগে।</p>
        </div>
      </div>

      {/* device / LAN */}
      <div className="card card-pad" style={{ marginTop: 16 }}>
        <h3 style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}><Server size={17} /> ডিভাইস ও নেটওয়ার্ক</h3>
        <DeviceSection />
      </div>

      <PasswordModal open={pwOpen} onClose={() => setPwOpen(false)} />
      <PinModal open={pinOpen} hasPin={!!me?.has_pin} onClose={() => setPinOpen(false)} />
    </div>
  )
}

function DeviceSection() {
  const { toast } = useToast()
  const [info, setInfo] = useState<{ mode: string; lanServer: boolean; lanPort: number; serverUrl: string | null; dbFile: string; version: string } | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const bridge = (window as unknown as { merqo?: { serverInfo: () => Promise<Record<string, unknown>> } }).merqo
    bridge?.serverInfo().then((s) => setInfo(s as never)).catch(() => setInfo(null))
  }, [])

  const toggleLan = async () => {
    const bridge = (window as unknown as { merqo?: { setMode: (p: Record<string, unknown>) => Promise<unknown>; restartCore: () => Promise<unknown> } }).merqo
    if (!bridge) { toast('শুধু ডেস্কটপ অ্যাপে সার্ভার মোড বদলানো যায়।', 'warning'); return }
    setBusy(true)
    try {
      await bridge.setMode({ lanServer: !info?.lanServer })
      await bridge.restartCore()
      toast('মোড বদলেছে — অ্যাপ পুনরায় সংযোগ নিচ্ছে…', 'success')
      setTimeout(() => window.location.reload(), 1200)
    } catch (e) { toast((e as Error).message, 'error') } finally { setBusy(false) }
  }

  if (!info) return <p className="small muted">ডিভাইস তথ্য শুধু ডেস্কটপ অ্যাপে দেখা যায়।</p>

  return (
    <div style={{ maxWidth: 520 }}>
      <div className="sum-row"><span>মোড</span><b>{info.mode === 'client' ? 'ক্লায়েন্ট (অন্য পিসির সার্ভার)' : 'স্বয়ংসম্পূর্ণ (এই পিসিতে ডেটা)'}</b></div>
      <div className="sum-row"><span>ডেটাবেস ফাইল</span><span className="num small" style={{ maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis' }}>{info.dbFile}</span></div>
      {info.mode !== 'client' ? (
        <>
          <div className="sum-row"><span>LAN সার্ভার (অন্য ডিভাইস থেকে ব্যবহার)</span>
            <b style={{ color: info.lanServer ? 'var(--success-text)' : undefined }}>{info.lanServer ? 'চালু' : 'বন্ধ'}</b>
          </div>
          <button className="btn btn-secondary" disabled={busy} onClick={() => void toggleLan()}>{info.lanServer ? 'LAN সার্ভার বন্ধ করুন' : 'LAN সার্ভার চালু করুন'}</button>
          {info.lanServer ? (
            <p className="small muted" style={{ marginTop: 8 }}>
              অন্য ডিভাইস থেকে একই নেটওয়ার্কে এই পিসির IP: <code className="num">{info.lanPort}</code> পোর্ট দিয়ে সংযোগ করুন (লগইন স্ক্রিনে "সার্ভার মোড")।
            </p>
          ) : null}
        </>
      ) : (
        <div className="sum-row"><span>সার্ভার ঠিকানা</span><b className="num">{info.serverUrl}</b></div>
      )}
      <div className="sum-row"><span>ভার্সন</span><b className="num">MERQO Retail Suite {info.version}</b></div>
    </div>
  )
}

function PasswordModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { toast } = useToast()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [busy, setBusy] = useState(false)

  return (
    <Modal open={open} onClose={onClose} title="পাসওয়ার্ড বদলান" size="sm"
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose}>{t('cancel')}</button>
          <button
            className="btn btn-primary"
            disabled={busy || next.length < 6}
            onClick={async () => {
              setBusy(true)
              try {
                await api.post('/auth/change-password', { current_password: current, new_password: next })
                toast('পাসওয়ার্ড বদলে গেছে', 'success')
                setCurrent(''); setNext(''); onClose()
              } catch (e) { toast((e as Error).message, 'error') } finally { setBusy(false) }
            }}
          >{busy ? <span className="spinner" /> : null}বদলান</button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label="বর্তমান পাসওয়ার্ড" required><input className="input" type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoFocus /></Field>
        <Field label="নতুন পাসওয়ার্ড" required hint="৬+ অক্ষর"><input className="input" type="password" value={next} onChange={(e) => setNext(e.target.value)} /></Field>
      </div>
    </Modal>
  )
}

function PinModal({ open, hasPin, onClose }: { open: boolean; hasPin: boolean; onClose: () => void }) {
  const { toast } = useToast()
  const { refresh } = useSession()
  const qc = useQueryClient()
  const [pin, setPin] = useState('')
  const [current, setCurrent] = useState('')
  const [busy, setBusy] = useState(false)

  return (
    <Modal open={open} onClose={onClose} title={hasPin ? 'পিন বদলান' : 'পিন সেট করুন'} size="sm"
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose}>{t('cancel')}</button>
          <button
            className="btn btn-primary"
            disabled={busy || pin.length < 4 || (hasPin && current.length < 4)}
            onClick={async () => {
              setBusy(true)
              try {
                await api.post('/auth/pin/setup', { pin, current_pin: current || undefined })
                await refresh()
                void qc.invalidateQueries()
                toast('পিন সংরক্ষিত হয়েছে', 'success')
                setPin(''); setCurrent(''); onClose()
              } catch (e) { toast((e as Error).message, 'error') } finally { setBusy(false) }
            }}
          >{busy ? <span className="spinner" /> : null}সংরক্ষণ</button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {hasPin ? <Field label="বর্তমান পিন" required><input className="input num" type="password" inputMode="numeric" maxLength={6} value={current} onChange={(e) => setCurrent(e.target.value.replace(/\D/g, ''))} autoFocus /></Field> : null}
        <Field label="নতুন পিন (৪–৬ সংখ্যা)" required><input className="input num" type="password" inputMode="numeric" maxLength={6} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} /></Field>
      </div>
    </Modal>
  )
}
