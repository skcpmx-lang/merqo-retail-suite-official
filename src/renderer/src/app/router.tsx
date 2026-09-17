import { Navigate, Route, Routes } from 'react-router-dom'
import { useSession } from '@/state/session'
import { AppShell } from './shell'
import { Login } from '@/pages/login'
import { Setup } from '@/pages/setup'
import { Dashboard } from '@/pages/dashboard'
import { POS } from '@/pages/pos'
import { SalesList } from '@/pages/sales'
import { SaleDetailPage } from '@/pages/sale-detail'
import { ReturnsList } from '@/pages/returns'
import { PurchasesList } from '@/pages/purchases'
import { PurchaseNew } from '@/pages/purchase-new'
import { PurchaseDetailPage } from '@/pages/purchase-detail'
import { ProductsList } from '@/pages/products'
import { ProductForm } from '@/pages/product-form'
import { Inventory } from '@/pages/inventory'
import { CustomersList } from '@/pages/customers'
import { CustomerDetailPage } from '@/pages/customer-detail'
import { SuppliersList } from '@/pages/suppliers'
import { SupplierDetailPage } from '@/pages/supplier-detail'
import { Accounts } from '@/pages/accounts'
import { Payments } from '@/pages/payments'
import { Expenses } from '@/pages/expenses'
import { Finance } from '@/pages/finance'
import { Mfs } from '@/pages/mfs'
import { Reports } from '@/pages/reports'
import { Documents } from '@/pages/documents'
import { Staff } from '@/pages/staff'
import { Notifications } from '@/pages/notifications'
import { Data } from '@/pages/data'
import { Audit } from '@/pages/audit'
import { Settings } from '@/pages/settings'
import { About } from '@/pages/about'
import { Loading } from '@/ui/components'
import { PERMS } from '../perm'

function Guard({ perm, children }: { perm?: string; children: React.ReactNode }) {
  const { can } = useSession()
  if (perm && !can(perm)) {
    return (
      <div className="page">
        <div className="empty" style={{ paddingTop: 120 }}>
          <div className="empty-icon">🔒</div>
          <h4>অনুমতি নেই</h4>
          <p>এই অংশটি দেখার অনুমতি আপনার রোলে নেই। প্রয়োজনে মালিকের সাথে যোগাযোগ করুন।</p>
        </div>
      </div>
    )
  }
  return <>{children}</>
}

function FullScreen({ children }: { children: React.ReactNode }) {
  return <div style={{ height: '100vh' }}>{children}</div>
}

export function AppRouter() {
  const { ready, me } = useSession()

  if (!ready) {
    return <FullScreen><Loading label="MERQO চালু হচ্ছে…" /></FullScreen>
  }

  if (!me) {
    return (
      <Routes>
        <Route path="/setup" element={<Setup />} />
        <Route path="*" element={<Login />} />
      </Routes>
    )
  }

  return (
    <Routes>
      <Route path="/setup" element={<Setup />} />
      <Route element={<AppShell />}>
        <Route index element={<Guard perm={PERMS.DASHBOARD_VIEW}><Dashboard /></Guard>} />
        <Route path="/pos" element={<Guard perm={PERMS.POS_USE}><POS /></Guard>} />
        <Route path="/sales" element={<Guard perm={PERMS.SALES_VIEW}><SalesList /></Guard>} />
        <Route path="/sales/:id" element={<Guard perm={PERMS.SALES_VIEW}><SaleDetailPage /></Guard>} />
        <Route path="/returns" element={<Guard perm={PERMS.SALES_VIEW}><ReturnsList /></Guard>} />
        <Route path="/purchases" element={<Guard perm={PERMS.PURCHASES_VIEW}><PurchasesList /></Guard>} />
        <Route path="/purchases/new" element={<Guard perm={PERMS.PURCHASES_CREATE}><PurchaseNew /></Guard>} />
        <Route path="/purchases/:id" element={<Guard perm={PERMS.PURCHASES_VIEW}><PurchaseDetailPage /></Guard>} />
        <Route path="/products" element={<Guard perm={PERMS.PRODUCTS_VIEW}><ProductsList /></Guard>} />
        <Route path="/products/new" element={<Guard perm={PERMS.PRODUCTS_CREATE}><ProductForm mode="new" /></Guard>} />
        <Route path="/products/:id" element={<Guard perm={PERMS.PRODUCTS_VIEW}><ProductForm mode="edit" /></Guard>} />
        <Route path="/inventory" element={<Guard perm={PERMS.INVENTORY_VIEW}><Inventory /></Guard>} />
        <Route path="/customers" element={<Guard perm={PERMS.CUSTOMERS_VIEW}><CustomersList /></Guard>} />
        <Route path="/customers/:id" element={<Guard perm={PERMS.CUSTOMERS_VIEW}><CustomerDetailPage /></Guard>} />
        <Route path="/suppliers" element={<Guard perm={PERMS.SUPPLIERS_VIEW}><SuppliersList /></Guard>} />
        <Route path="/suppliers/:id" element={<Guard perm={PERMS.SUPPLIERS_VIEW}><SupplierDetailPage /></Guard>} />
        <Route path="/accounts" element={<Guard perm={PERMS.ACCOUNTS_VIEW}><Accounts /></Guard>} />
        <Route path="/payments" element={<Guard perm={PERMS.SALES_VIEW}><Payments /></Guard>} />
        <Route path="/expenses" element={<Guard perm={PERMS.EXPENSES_VIEW}><Expenses /></Guard>} />
        <Route path="/finance" element={<Guard perm={PERMS.FINANCE_VIEW}><Finance /></Guard>} />
        <Route path="/mfs" element={<Guard perm={PERMS.MFS_VIEW}><Mfs /></Guard>} />
        <Route path="/reports" element={<Guard perm={PERMS.REPORTS_VIEW}><Reports /></Guard>} />
        <Route path="/documents" element={<Guard perm={PERMS.SALES_VIEW}><Documents /></Guard>} />
        <Route path="/staff" element={<Guard perm={PERMS.STAFF_VIEW}><Staff /></Guard>} />
        <Route path="/notifications" element={<Guard perm={PERMS.NOTIFICATIONS_VIEW}><Notifications /></Guard>} />
        <Route path="/data" element={<Data />} />
        <Route path="/audit" element={<Guard perm={PERMS.AUDIT_VIEW}><Audit /></Guard>} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/settings/business/new" element={<Settings />} />
        <Route path="/about" element={<About />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
