import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSession } from '@/state/session'
import { useToast } from '@/state/toast'
import { api, pingServer } from '@/api/client'
import { t } from '@/i18n/bn'
import { Field, Spinner, ConfirmDialog } from '@/ui/components'

const BIZ_TYPES = ['সুপার শপ', 'মুদি দোকান', 'খুচরা দোকান', 'মিনি মার্ট', 'জেনারেল স্টোর', 'কনভিনিয়েন্স স্টোর', 'ফার্মেসি', 'ইলেকট্রনিক্স', 'অন্যান্য']

export function Setup() {
  const { refresh } = useSession()
  const { toast } = useToast()
  const navigate = useNavigate()

  const [step, setStep] = useState(0)
  const [busy, setBusy] = useState(false)
  const [serverMode, setServerMode] = useState(false)
  const [serverAddr, setServerAddr] = useState('')
  const [serverCheck, setServerCheck] = useState<null | boolean>(null)

  // owner
  const [ownerName, setOwnerName] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [password2, setPassword2] = useState('')

  // business
  const [bizName, setBizName] = useState('')
  const [bizType, setBizType] = useState(BIZ_TYPES[0])
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [address, setAddress] = useState('')

  // accounts
  const [cashOpen, setCashOpen] = useState('0')
  const [hasBank, setHasBank] = useState(false)
  const [bankName, setBankName] = useState('')
  const [bankOpen, setBankOpen] = useState('0')
  const [hasMfs, setHasMfs] = useState(false)
  const [mfsProvider, setMfsProvider] = useState('bkash')
  const [mfsOpen, setMfsOpen] = useState('0')

  const [err, setErr] = useState('')
  const [alreadyInit, setAlreadyInit] = useState(false)

  const checkServer = async () => {
    if (!serverAddr.trim()) return
    let url = serverAddr.trim()
    if (!/^https?:\/\//.test(url)) url = `http://${url}`
    if (!/:\d+$/.test(url)) url += ':47612'
    const res = await pingServer(url)
    setServerCheck(res.ok)
    if (res.ok) {
      localStorage.setItem('mq_server_addr', url)
      const { setBaseUrl } = await import('@/api/client')
      setBaseUrl(url)
      if (res.initialized) {
        setAlreadyInit(true)
      }
    }
  }

  const submit = async () => {
    setErr('')
    if (!ownerName.trim() || !username.trim() || password.length < 6) { setErr('মালিকের তথ্য পূরণ করুন (পাসওয়ার্ড ৬+ অক্ষর)।'); return }
    if (password !== password2) { setErr('দুটি পাসওয়ার্ড মিলছে না।'); return }
    if (!bizName.trim()) { setErr('ব্যবসার নাম দিন।'); return }
    if (!/^[a-z0-9._-]{3,32}$/.test(username.trim().toLowerCase())) { setErr('ইউজারনেম ৩–৩২ অক্ষর (a-z, 0-9, . _ -)।'); return }

    setBusy(true)
    try {
      const accounts: Array<{ name: string; type: string; provider?: string; opening_balance: number }> = [
        { name: 'ক্যাশ বক্স', type: 'cash', opening_balance: Math.round(Number(cashOpen || 0) * 100) }
      ]
      if (hasBank && bankName.trim()) accounts.push({ name: bankName.trim(), type: 'bank', opening_balance: Math.round(Number(bankOpen || 0) * 100) })
      if (hasMfs) {
        const label = { bkash: 'bKash', nagad: 'Nagad', rocket: 'Rocket', upay: 'Upay' }[mfsProvider] ?? 'MFS'
        accounts.push({ name: `${label} এজেন্ট`, type: 'mfs', provider: mfsProvider, opening_balance: Math.round(Number(mfsOpen || 0) * 100) })
      }
      await api.post('/setup', {
        owner: { name: ownerName.trim(), username: username.trim().toLowerCase(), password },
        business: { name: bizName.trim(), biz_type: bizType, phone, email, address, accounts }
      })
      await refresh()
      toast('সেটআপ সম্পন্ন — স্বাগতম!', 'success')
      navigate('/')
    } catch (ex) {
      setErr((ex as Error).message || 'সেটআপ সম্পন্ন হয়নি')
    } finally { setBusy(false) }
  }

  const num = (v: string) => Number(v.replace(/[^\d.]/g, '') || 0)

  if (serverMode) {
    return (
      <div className="setup-wrap">
        <div className="setup-card">
          <Brand />
          <h2 style={{ margin: '18px 0 6px' }}>সার্ভারে সংযোগ</h2>
          <p className="muted" style={{ fontSize: 13 }}>{t('client_mode_hint')}</p>
          <div style={{ marginTop: 18 }} className="flex flex-col gap-3">
            <Field label={t('server_address')} error={serverCheck === false ? t('cannot_reach_server') : undefined} hint={serverCheck ? '✓ সংযোগ ঠিক আছে' : undefined}>
              <div style={{ display: 'flex', gap: 8 }}>
                <input className="input" placeholder="192.168.0.100" value={serverAddr} onChange={(e) => { setServerAddr(e.target.value); setServerCheck(null) }} />
                <button className="btn btn-secondary" onClick={() => void checkServer()}>যাচাই</button>
              </div>
            </Field>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <button className="btn btn-ghost" onClick={() => setServerMode(false)}>← পিছনে</button>
              <button className="btn btn-primary" disabled={!serverCheck} onClick={() => { setServerMode(false); setStep(0) }}>
                {alreadyInit ? 'লগইনে যান' : 'সেটআপ চালিয়ে যান'}
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="setup-wrap">
      <div className="setup-card">
        <Brand />
        <h2 style={{ margin: '18px 0 4px' }}>{t('setup_welcome')}</h2>
        <p className="muted" style={{ fontSize: 13 }}>{t('setup_sub')}</p>

        <div className="setup-steps">
          {[0, 1, 2].map((i) => (
            <div key={i} className={`setup-step ${i < step ? 'done' : i === step ? 'active' : ''}`} />
          ))}
        </div>

        {step === 0 ? (
          <div className="flex flex-col gap-3 fade-in">
            <div className="strong" style={{ fontSize: 14 }}>{t('setup_owner')}</div>
            <div className="hint">{t('setup_owner_sub')}</div>
            <div className="grid-2">
              <Field label="মালিকের নাম" required>
                <input className="input" value={ownerName} onChange={(e) => setOwnerName(e.target.value)} autoFocus />
              </Field>
              <Field label="ইউজারনেম" required hint="a-z, 0-9, . _ -">
                <input className="input" value={username} onChange={(e) => setUsername(e.target.value)} />
              </Field>
            </div>
            <div className="grid-2">
              <Field label="পাসওয়ার্ড" required>
                <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
              </Field>
              <Field label="পাসওয়ার্ড আবার" required>
                <input className="input" type="password" value={password2} onChange={(e) => setPassword2(e.target.value)} />
              </Field>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6 }}>
              <button className="btn btn-ghost" onClick={() => setServerMode(true)}>সার্ভারে সংযোগ করতে চান?</button>
              <button className="btn btn-primary" disabled={!ownerName || !username || password.length < 6} onClick={() => setStep(1)}>পরবর্তী →</button>
            </div>
          </div>
        ) : null}

        {step === 1 ? (
          <div className="flex flex-col gap-3 fade-in">
            <div className="strong" style={{ fontSize: 14 }}>{t('setup_business')}</div>
            <div className="hint">{t('setup_business_sub')}</div>
            <Field label="ব্যবসার নাম" required>
              <input className="input" value={bizName} onChange={(e) => setBizName(e.target.value)} autoFocus />
            </Field>
            <div className="grid-2">
              <Field label="ব্যবসার ধরন">
                <select className="select" value={bizType} onChange={(e) => setBizType(e.target.value)}>
                  {BIZ_TYPES.map((b) => <option key={b}>{b}</option>)}
                </select>
              </Field>
              <Field label="ফোন">
                <input className="input" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="01712345678" />
              </Field>
            </div>
            <Field label="ইমেইল">
              <input className="input" value={email} onChange={(e) => setEmail(e.target.value)} />
            </Field>
            <Field label="ঠিকানা">
              <input className="input" value={address} onChange={(e) => setAddress(e.target.value)} />
            </Field>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6 }}>
              <button className="btn btn-secondary" onClick={() => setStep(0)}>← পিছনে</button>
              <button className="btn btn-primary" disabled={!bizName.trim()} onClick={() => setStep(2)}>পরবর্তী →</button>
            </div>
          </div>
        ) : null}

        {step === 2 ? (
          <div className="flex flex-col gap-3 fade-in">
            <div className="strong" style={{ fontSize: 14 }}>{t('setup_accounts')}</div>
            <div className="hint">{t('setup_accounts_sub')}</div>

            <Field label="ক্যাশ বক্সে শুরুর টাকা (৳)">
              <input className="input input-money" value={cashOpen} onChange={(e) => setCashOpen(e.target.value)} inputMode="decimal" />
            </Field>

            <label className="check"><input type="checkbox" checked={hasBank} onChange={(e) => setHasBank(e.target.checked)} /> ব্যাংক হিসাব আছে</label>
            {hasBank ? (
              <div className="grid-2">
                <Field label="ব্যাংকের নাম"><input className="input" value={bankName} onChange={(e) => setBankName(e.target.value)} placeholder="যেমন: City Bank" /></Field>
                <Field label="শুরুর ব্যালেন্স (৳)"><input className="input input-money" value={bankOpen} onChange={(e) => setBankOpen(e.target.value)} inputMode="decimal" /></Field>
              </div>
            ) : null}

            <label className="check"><input type="checkbox" checked={hasMfs} onChange={(e) => setHasMfs(e.target.checked)} /> মোবাইল ব্যাংকিং এজেন্ট হিসাব আছে</label>
            {hasMfs ? (
              <div className="grid-2">
                <Field label="প্রদানকারী">
                  <select className="select" value={mfsProvider} onChange={(e) => setMfsProvider(e.target.value)}>
                    <option value="bkash">bKash</option>
                    <option value="nagad">Nagad</option>
                    <option value="rocket">Rocket</option>
                    <option value="upay">Upay</option>
                  </select>
                </Field>
                <Field label="শুরুর ব্যালেন্স (৳)"><input className="input input-money" value={mfsOpen} onChange={(e) => setMfsOpen(e.target.value)} inputMode="decimal" /></Field>
              </div>
            ) : null}

            {err ? <div className="alert alert-danger">{err}</div> : null}
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6 }}>
              <button className="btn btn-secondary" onClick={() => setStep(1)}>← পিছনে</button>
              <button className="btn btn-primary btn-lg" onClick={() => void submit()} disabled={busy}>
                {busy ? <Spinner size={15} /> : null}সেটআপ সম্পন্ন করুন
              </button>
            </div>
          </div>
        ) : null}
      </div>

      <ConfirmDialog
        open={alreadyInit}
        onClose={() => setAlreadyInit(false)}
        title="সার্ভারে ইতিমধ্যে সেটআপ আছে"
        body="এই সার্ভারে অ্যাকাউন্ট তৈরি হয়ে গেছে। লগইন পেজ থেকে ঢুকুন।"
        confirmLabel="লগইনে যান"
        onConfirm={() => { setAlreadyInit(false); navigate('/login') }}
      />
    </div>
  )
}

function Brand() {
  return (
    <div className="login-logo" style={{ marginBottom: 0 }}>
      <div className="brand-mark" style={{ width: 40, height: 40, fontSize: 20, borderRadius: 11 }}>M<span className="brand-dot" style={{ color: '#dbe7ff' }}>.</span></div>
      <div>
        <div className="login-title">MERQO<span style={{ color: 'var(--primary)' }}>.</span> Retail Suite</div>
        <div className="login-sub">ব্যবসা শুরুর প্রাথমিক সেটআপ</div>
      </div>
    </div>
  )
}
