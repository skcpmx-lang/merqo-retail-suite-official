/** Permission constants mirrored from the core (visibility only — the server enforces). */
export const PERMS = {
  DASHBOARD_VIEW: 'dashboard.view',
  POS_USE: 'pos.use',
  POS_DISCOUNT: 'pos.discount',
  POS_PRICE_OVERRIDE: 'pos.price_override',
  POS_NEGATIVE_STOCK: 'pos.negative_stock',
  SALES_VIEW: 'sales.view',
  SALES_EDIT: 'sales.edit',
  SALES_VOID: 'sales.void',
  RETURNS_MAKE: 'returns.make',
  PRODUCTS_VIEW: 'products.view',
  PRODUCTS_CREATE: 'products.create',
  PRODUCTS_EDIT: 'products.edit',
  PRODUCTS_DELETE: 'products.delete',
  PRODUCTS_EXPORT: 'products.export',
  PRODUCTS_IMPORT: 'products.import',
  LABELS_PRINT: 'labels.print',
  INVENTORY_VIEW: 'inventory.view',
  INVENTORY_ADJUST: 'inventory.adjust',
  PURCHASES_VIEW: 'purchases.view',
  PURCHASES_CREATE: 'purchases.create',
  PURCHASES_EDIT: 'purchases.edit',
  SUPPLIERS_VIEW: 'suppliers.view',
  SUPPLIERS_MANAGE: 'suppliers.manage',
  CUSTOMERS_VIEW: 'customers.view',
  CUSTOMERS_MANAGE: 'customers.manage',
  DUES_VIEW: 'dues.view',
  DUES_COLLECT: 'dues.collect',
  DUES_PAY: 'dues.pay',
  ACCOUNTS_VIEW: 'accounts.view',
  ACCOUNTS_MANAGE: 'accounts.manage',
  ACCOUNTS_TRANSFER: 'accounts.transfer',
  EXPENSES_VIEW: 'expenses.view',
  EXPENSES_CREATE: 'expenses.create',
  EXPENSES_DELETE: 'expenses.delete',
  FINANCE_VIEW: 'finance.view',
  REPORTS_VIEW: 'reports.view',
  REPORTS_EXPORT: 'reports.export',
  MFS_VIEW: 'mfs.view',
  MFS_OPERATE: 'mfs.operate',
  MFS_MANAGE: 'mfs.manage',
  INVOICES_PRINT: 'invoices.print',
  IMPORT: 'data.import',
  EXPORT: 'data.export',
  BACKUP_CREATE: 'backup.create',
  BACKUP_RESTORE: 'backup.restore',
  STAFF_VIEW: 'staff.view',
  STAFF_MANAGE: 'staff.manage',
  ROLES_MANAGE: 'roles.manage',
  AUDIT_VIEW: 'audit.view',
  NOTIFICATIONS_VIEW: 'notifications.view',
  SETTINGS_VIEW: 'settings.view',
  SETTINGS_MANAGE: 'settings.manage'
} as const

/** Stable grouping used by the role editor. */
export const PERM_GROUPS: Array<{ key: string; label: string; perms: Array<[string, string]> }> = [
  {
    key: 'pos', label: 'perm_group_pos',
    perms: [
      [PERMS.POS_USE, 'POS ব্যবহার'],
      [PERMS.POS_DISCOUNT, 'ডিসকাউন্ট প্রয়োগ'],
      [PERMS.POS_PRICE_OVERRIDE, 'দাম পরিবর্তন'],
      [PERMS.POS_NEGATIVE_STOCK, 'স্টক ছাড়া বিক্রয়']
    ]
  },
  {
    key: 'sales', label: 'perm_group_sales',
    perms: [
      [PERMS.SALES_VIEW, 'বিক্রয় দেখা'],
      [PERMS.SALES_VOID, 'বিক্রয় বাতিল'],
      [PERMS.RETURNS_MAKE, 'রিটার্ন গ্রহণ'],
      [PERMS.INVOICES_PRINT, 'চালান/রসিদ প্রিন্ট']
    ]
  },
  {
    key: 'products', label: 'perm_group_products',
    perms: [
      [PERMS.PRODUCTS_VIEW, 'পণ্য দেখা'],
      [PERMS.PRODUCTS_CREATE, 'পণ্য তৈরি'],
      [PERMS.PRODUCTS_EDIT, 'পণ্য সম্পাদনা'],
      [PERMS.PRODUCTS_DELETE, 'পণ্য মুছে ফেলা'],
      [PERMS.PRODUCTS_IMPORT, 'পণ্য ইমপোর্ট'],
      [PERMS.PRODUCTS_EXPORT, 'পণ্য এক্সপোর্ট'],
      [PERMS.INVENTORY_VIEW, 'ইনভেন্টরি দেখা'],
      [PERMS.INVENTORY_ADJUST, 'স্টক সমন্বয়'],
      [PERMS.LABELS_PRINT, 'লেবেল প্রিন্ট']
    ]
  },
  {
    key: 'purchase', label: 'perm_group_purchase',
    perms: [
      [PERMS.PURCHASES_VIEW, 'ক্রয় দেখা'],
      [PERMS.PURCHASES_CREATE, 'ক্রয় যোগ'],
      [PERMS.PURCHASES_EDIT, 'ক্রয় বাতিল/সংশোধন'],
      [PERMS.SUPPLIERS_VIEW, 'সরবরাহকারী দেখা'],
      [PERMS.SUPPLIERS_MANAGE, 'সরবরাহকারী পরিচালনা'],
      [PERMS.DUES_PAY, 'সরবরাহকারী বকেয়া পরিশোধ']
    ]
  },
  {
    key: 'customers', label: 'perm_group_customers',
    perms: [
      [PERMS.CUSTOMERS_VIEW, 'গ্রাহক দেখা'],
      [PERMS.CUSTOMERS_MANAGE, 'গ্রাহক পরিচালনা'],
      [PERMS.DUES_VIEW, 'বকেয়া দেখা'],
      [PERMS.DUES_COLLECT, 'বকেয়া আদায়']
    ]
  },
  {
    key: 'money', label: 'perm_group_money',
    perms: [
      [PERMS.ACCOUNTS_VIEW, 'হিসাব ও ব্যালেন্স দেখা'],
      [PERMS.ACCOUNTS_MANAGE, 'হিসাব যোগ/সম্পাদনা'],
      [PERMS.ACCOUNTS_TRANSFER, 'হিসাবে ট্রান্সফার'],
      [PERMS.EXPENSES_VIEW, 'খরচ দেখা'],
      [PERMS.EXPENSES_CREATE, 'খরচ যোগ'],
      [PERMS.EXPENSES_DELETE, 'খরচ বাতিল'],
      [PERMS.FINANCE_VIEW, 'লাভ-ক্ষতি ও আর্থিক রিপোর্ট'],
      [PERMS.MFS_VIEW, 'MFS দেখা'],
      [PERMS.MFS_OPERATE, 'MFS লেনদেন'],
      [PERMS.MFS_MANAGE, 'MFS কনফিগারেশন']
    ]
  },
  {
    key: 'reports', label: 'perm_group_reports',
    perms: [
      [PERMS.DASHBOARD_VIEW, 'ড্যাশবোর্ড'],
      [PERMS.REPORTS_VIEW, 'রিপোর্ট দেখা'],
      [PERMS.REPORTS_EXPORT, 'রিপোর্ট এক্সপোর্ট'],
      [PERMS.EXPORT, 'ডেটা এক্সপোর্ট'],
      [PERMS.IMPORT, 'ডেটা ইমপোর্ট']
    ]
  },
  {
    key: 'admin', label: 'perm_group_admin',
    perms: [
      [PERMS.STAFF_VIEW, 'স্টাফ দেখা'],
      [PERMS.STAFF_MANAGE, 'স্টাফ পরিচালনা'],
      [PERMS.ROLES_MANAGE, 'রোল ও অনুমতি'],
      [PERMS.AUDIT_VIEW, 'অডিট লগ'],
      [PERMS.NOTIFICATIONS_VIEW, 'নোটিফিকেশন'],
      [PERMS.SETTINGS_VIEW, 'সেটিংস দেখা'],
      [PERMS.SETTINGS_MANAGE, 'সেটিংস পরিবর্তন'],
      [PERMS.BACKUP_CREATE, 'ব্যাকআপ'],
      [PERMS.BACKUP_RESTORE, 'রিস্টোর']
    ]
  }
]
