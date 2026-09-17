import { useEffect, useRef, useState, type ReactNode } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard, ShoppingCart, Receipt, ArrowLeftRight, Package, Boxes, Users, Truck,
  Wallet, ReceiptText, Coins, Landmark, Smartphone, BarChart3, FileText, UserCog, Bell,
  DatabaseBackup, Settings, Info, ChevronDown, ChevronRight, Search, Plus, Lock, LogOut,
  Building2, Check, PanelLeftClose, PanelLeft, ScanBarcode, ClipboardList
} from 'lucide-react'
import { useSession } from '@/state/session'
import { useToast } from '@/state/toast'
import { api } from '@/api/client'
import { t, money, fdatetime } from '@/i18n/bn'
import { Menu, MenuItem, Modal, Field, Spinner, Badge, Kbd, Tip } from '@/ui/components'
import { PERMS } from '../perm'

interface NavItem { to: string; label: string; icon: ReactNode; perm?: string; end?: boolean }
interface NavGroup { label?: string; items: NavItem[] }

const NAV: NavGroup[] = [
  {
    items: [{ to: '/', label: t('nav_dashboard'), icon: <LayoutDashboard size={18} />, end: true }]
  },
  {
    label: t('group_operations'),
    items: [
      { to: '/pos', label: t('nav_pos'), icon: <ScanBarcode size={18} />, perm: PERMS.POS_USE },
      { to: '/sales', label: t('nav_sales_list'), icon: <ShoppingCart size={18} />, perm: PERMS.SALES_VIEW },
      { to: '/returns', label: t('nav_returns'), icon: <Receipt size={18} />, perm: PERMS.SALES_VIEW },
      { to: '/purchases', label: t('nav_purchases'), icon: <ArrowLeftRight size={18} />, perm: PERMS.PURCHASES_VIEW },
      { to: '/products', label: t('nav_products_list'), icon: <Package size={18} />, perm: PERMS.PRODUCTS_VIEW },
      { to: '/inventory', label: t('nav_inventory'), icon: <Boxes size={18} />, perm: PERMS.INVENTORY_VIEW }
    ]
  },
  {
    label: t('group_people'),
    items: [
      { to: '/customers', label: t('nav_customers'), icon: <Users size={18} />, perm: PERMS.CUSTOMERS_VIEW },
      { to: '/suppliers', label: t('nav_suppliers'), icon: <Truck size={18} />, perm: PERMS.SUPPLIERS_VIEW }
    ]
  },
  {
    label: t('group_money'),
    items: [
      { to: '/accounts', label: t('nav_accounts'), icon: <Landmark size={18} />, perm: PERMS.ACCOUNTS_VIEW },
      { to: '/payments', label: t('nav_payments_list'), icon: <Wallet size={18} /> },
      { to: '/expenses', label: t('nav_expenses'), icon: <ReceiptText size={18} />, perm: PERMS.EXPENSES_VIEW },
      { to: '/finance', label: t('nav_finance'), icon: <Coins size={18} />, perm: PERMS.FINANCE_VIEW },
      { to: '/mfs', label: t('nav_mfs'), icon: <Smartphone size={18} />, perm: PERMS.MFS_VIEW }
    ]
  },
  {
    label: t('group_insights'),
    items: [
      { to: '/reports', label: t('nav_reports'), icon: <BarChart3 size={18} />, perm: PERMS.REPORTS_VIEW },
      { to: '/documents', label: t('nav_documents'), icon: <FileText size={18} />, perm: PERMS.SALES_VIEW },
      { to: '/staff', label: t('nav_staff'), icon: <UserCog size={18} />, perm: PERMS.STAFF_VIEW },
      { to: '/notifications', label: t('nav_notifications'), icon: <Bell size={18} />, perm: PERMS.NOTIFICATIONS_VIEW }
    ]
  },
  {
    label: t('group_system'),
    items: [
      { to: '/data', label: t('nav_data'), icon: <DatabaseBackup size={18} /> },
      { to: '/audit', label: t('nav_audit'), icon: <ClipboardList size={18} />, perm: PERMS.AUDIT_VIEW },
      { to: '/settings', label: t('nav_settings'), icon: <Settings size={18} /> },
      { to: '/about', label: t('nav_about'), icon: <Info size={18} /> }
    ]
  }
]

function SidebarItem({ item, collapsed }: { item: NavItem; collapsed: boolean }) {
  const active = (() => {
    // NavLink active handled internally; this only used for title tooltip
    return false
  })()
  void active
  const link = (
    <NavLink
      to={item.to}
      end={item.end}
      className={({ isActive }) => `side-item ${isActive ? 'active' : ''}`}
      title={collapsed ? item.label : undefined}
    >
      <span className="side-icon">{item.icon}</span>
      {!collapsed ? <span className="side-label">{item.label}</span> : null}
    </NavLink>
  )
  return collapsed ? <Tip label={item.label}>{link}</Tip> : link
}

function Sidebar({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const { can, business } = useSession()
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() => {
    const saved = localStorage.getItem('mq_nav_groups')
    if (saved) { try { return JSON.parse(saved) } catch { /* */ } }
    return { g0: true, g1: true, g2: true, g3: true, g4: true }
  })

  const toggle = (k: string) => {
    setOpenGroups((g) => {
      const next = { ...g, [k]: !g[k] }
      localStorage.setItem('mq_nav_groups', JSON.stringify(next))
      return next
    })
  }

  return (
    <aside className={`sidebar ${collapsed ? 'collapsed' : ''}`}>
      <div className="side-brand">
        <div className="brand-mark">M<span className="brand-dot">.</span></div>
        {!collapsed ? (
          <div className="brand-text">
            <div className="brand-name">MERQO<span className="brand-dot">.</span></div>
            <div className="brand-sub">{business?.name ?? ''}</div>
          </div>
        ) : null}
      </div>

      <nav className="side-nav">
        {NAV.map((group, gi) => {
          const items = group.items.filter((i) => !i.perm || can(i.perm))
          if (items.length === 0) return null
          if (!group.label) {
            return <div key={gi} className="side-group">{items.map((it) => <SidebarItem key={it.to} item={it} collapsed={collapsed} />)}</div>
          }
          const open = collapsed ? true : openGroups[`g${gi}`] !== false
          return (
            <div key={gi} className="side-group">
              {!collapsed ? (
                <button className="side-group-head" onClick={() => toggle(`g${gi}`)}>
                  <span>{group.label}</span>
                  {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                </button>
              ) : (
                <div className="side-group-sep" />
              )}
              {open ? items.map((it) => <SidebarItem key={it.to} item={it} collapsed={collapsed} />) : null}
            </div>
          )
        })}
      </nav>

      <div className="side-footer">
        <button className="side-item" onClick={onToggle} title={collapsed ? 'মেনু বড় করুন' : 'মেনু ছোট করুন'}>
          <span className="side-icon">{collapsed ? <PanelLeft size={18} /> : <PanelLeftClose size={18} />}</span>
          {!collapsed ? <span className="side-label">মেনু ছোট করুন</span> : null}
        </button>
      </div>
    </aside>
  )
}

interface SearchHit { type: string; id: string; title: string; subtitle: string }

function GlobalSearch() {
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<SearchHit[]>([])
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [active, setActive] = useState(0)
  const boxRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const navigate = useNavigate()
  const timer = useRef<number>(0)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        inputRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [])

  useEffect(() => {
    window.clearTimeout(timer.current)
    if (!q.trim()) { setHits([]); setOpen(false); return }
    setBusy(true)
    timer.current = window.setTimeout(async () => {
      try {
        const res = await api.get<{ hits: SearchHit[] }>('/search', { q })
        setHits(res.hits)
        setOpen(true)
        setActive(0)
      } catch { /* */ } finally { setBusy(false) }
    }, 180)
    return () => window.clearTimeout(timer.current)
  }, [q])

  const go = (hit: SearchHit) => {
    setOpen(false)
    setQ('')
    switch (hit.type) {
      case 'product': navigate('/products'); break
      case 'customer': navigate(`/customers/${hit.id}`); break
      case 'supplier': navigate(`/suppliers/${hit.id}`); break
      case 'sale': navigate(`/sales/${hit.id}`); break
      case 'purchase': navigate(`/purchases/${hit.id}`); break
      case 'account': navigate('/accounts'); break
      case 'user': navigate('/staff'); break
      default: break
    }
  }

  const typeLabels: Record<string, string> = {
    product: t('type_product'), customer: t('type_customer'), supplier: t('type_supplier'),
    sale: t('type_sale'), purchase: t('type_purchase'), user: t('type_user'), account: t('type_account')
  }

  return (
    <div className="gsearch" ref={boxRef}>
      <Search size={15} className="gsearch-icon" />
      <input
        ref={inputRef}
        className="gsearch-input"
        placeholder={t('global_search_ph')}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => { if (hits.length) setOpen(true) }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, hits.length - 1)) }
          if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)) }
          if (e.key === 'Enter' && hits[active]) go(hits[active])
          if (e.key === 'Escape') { setOpen(false); inputRef.current?.blur() }
        }}
      />
      <Kbd>Ctrl K</Kbd>
      {busy ? <span style={{ position: 'absolute', right: 74, top: 8 }}><Spinner size={14} /></span> : null}
      {open && q.trim() ? (
        <div className="gsearch-pop">
          {hits.length === 0 ? (
            <div className="gsearch-empty">{t('no_results')}</div>
          ) : hits.map((h, i) => (
            <button key={`${h.type}-${h.id}`} className={`gsearch-hit ${i === active ? 'active' : ''}`} onClick={() => go(h)} onMouseEnter={() => setActive(i)}>
              <Badge tone={h.type === 'sale' ? 'info' : h.type === 'customer' ? 'success' : 'neutral'}>{typeLabels[h.type] ?? h.type}</Badge>
              <div className="grow ellip">
                <div className="strong ellip">{h.title}</div>
                <div className="small muted ellip">{h.subtitle}</div>
              </div>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function BusinessSwitcher() {
  const { business, businesses, switchBusiness } = useSession()
  const navigate = useNavigate()
  if (!business) return null
  return (
    <Menu
      trigger={
        <button className="biz-switch">
          <div className="biz-avatar">{business.name.slice(0, 1)}</div>
          <div className="biz-name ellip">{business.name}</div>
          <ChevronDown size={14} />
        </button>
      }
    >
      <div className="menu-head">{t('switch_business')}</div>
      {businesses.map((b) => (
        <MenuItem
          key={b.id}
          icon={b.id === business.id ? <Check size={14} /> : <Building2 size={14} />}
          onClick={() => { if (b.id !== business.id) void switchBusiness(b.id) }}
        >
          {b.name}
        </MenuItem>
      ))}
      <div className="menu-sep" />
      <MenuItem icon={<Plus size={14} />} onClick={() => navigate('/settings/business/new')}>{t('new_business')}</MenuItem>
    </Menu>
  )
}

function UserMenu() {
  const { me, logout } = useSession()
  const [lockOpen, setLockOpen] = useState(false)
  const [pin, setPin] = useState('')
  const [pinErr, setPinErr] = useState('')
  const [busy, setBusy] = useState(false)
  const navigate = useNavigate()
  if (!me) return null
  const initial = me.user.name.trim().slice(0, 1) || '?'

  const unlock = async () => {
    setBusy(true); setPinErr('')
    try {
      await api.post('/auth/pin/verify', { pin })
      setLockOpen(false)
      setPin('')
    } catch (e) {
      setPinErr((e as Error).message || t('wrong_pin'))
    } finally { setBusy(false) }
  }

  return (
    <>
      <Menu
        trigger={
          <button className="user-btn">
            <span className="avatar" style={{ width: 30, height: 30, fontSize: 13 }}>{initial}</span>
            <span className="ellip user-name">{me.user.name}</span>
            <ChevronDown size={13} />
          </button>
        }
      >
        <div className="menu-head">{me.user.name} · @{me.user.username}</div>
        <MenuItem icon={<Lock size={14} />} onClick={() => setLockOpen(true)} disabled={!me.has_pin}>{t('lock_screen')}</MenuItem>
        <MenuItem icon={<UserCog size={14} />} onClick={() => navigate('/settings/security')}>{t('change_password')}</MenuItem>
        <div className="menu-sep" />
        <MenuItem icon={<LogOut size={14} />} danger onClick={() => void logout()}>{t('logout')}</MenuItem>
      </Menu>

      <Modal
        open={lockOpen}
        onClose={() => setLockOpen(false)}
        title={t('lock_screen')}
        sub={t('enter_pin')}
        size="sm"
        footer={
          <>
            <button className="btn btn-secondary" onClick={() => setLockOpen(false)}>{t('cancel')}</button>
            <button className="btn btn-primary" onClick={() => void unlock()} disabled={busy || pin.length < 4}>
              {busy ? <Spinner size={14} /> : null}{t('unlock')}
            </button>
          </>
        }
      >
        <Field label={t('quick_pin')} error={pinErr}>
          <input
            className="input"
            type="password"
            inputMode="numeric"
            style={{ letterSpacing: 8, fontSize: 20, textAlign: 'center', maxWidth: 200 }}
            maxLength={6}
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
            autoFocus
            onKeyDown={(e) => { if (e.key === 'Enter') void unlock() }}
          />
        </Field>
      </Modal>
    </>
  )
}

function NotifBell() {
  const [unread, setUnread] = useState(0)
  const navigate = useNavigate()
  const { can } = useSession()

  useEffect(() => {
    if (!can(PERMS.NOTIFICATIONS_VIEW)) return
    let stop = false
    const load = async () => {
      try {
        const res = await api.get<{ unread: number }>('/notifications', { page: 1, pageSize: 1, unread: '1' })
        if (!stop) setUnread(res.unread)
      } catch { /* */ }
    }
    void load()
    const iv = window.setInterval(load, 60_000)
    return () => { stop = true; window.clearInterval(iv) }
  }, [can])

  return (
    <button className="icon-btn" onClick={() => navigate('/notifications')} aria-label={t('notifications_title')}>
      <Bell size={17} />
      {unread > 0 ? <span className="notif-dot num">{unread > 9 ? '৯+' : unread}</span> : null}
    </button>
  )
}

export function AppShell() {
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('mq_side_collapsed') === '1')
  const { business } = useSession()
  const navigate = useNavigate()

  const toggle = () => {
    setCollapsed((c) => {
      localStorage.setItem('mq_side_collapsed', c ? '0' : '1')
      return !c
    })
  }

  useEffect(() => {
    document.title = business ? `${business.name} — ${t('app_name')}` : t('app_name')
  }, [business])

  return (
    <div className="shell">
      <Sidebar collapsed={collapsed} onToggle={toggle} />
      <div className="main-col">
        <header className="topbar">
          <GlobalSearch />
          <div className="topbar-right">
            <NotifBell />
            <BusinessSwitcher />
            <UserMenu />
          </div>
        </header>
        <main className="content" id="main-scroll">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
