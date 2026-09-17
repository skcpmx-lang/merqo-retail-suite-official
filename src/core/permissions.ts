/**
 * MERQO Retail Suite — permission registry.
 *
 * Permissions are enforced ONLY in the core (server side). The renderer uses
 * the same constants purely for showing/hiding affordances; hiding UI is
 * convenience, never the security boundary.
 */

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

  FINANCE_VIEW: 'finance.view', // লাভ/ক্ষতি, COGS, নিট — owner-level visibility
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

export type Perm = (typeof PERMS)[keyof typeof PERMS]

export const ALL_PERMS: Perm[] = Object.values(PERMS)

/** Roles every business gets. */
export const SYSTEM_ROLES = {
  OWNER: {
    name: 'মালিক',
    description: 'সম্পূর্ণ অ্যাক্সেস',
    permissions: ALL_PERMS
  },
  MANAGER: {
    name: 'ম্যানেজার',
    description: 'পরিচালনা ও পরিবেশন — আর্থিক সংবেদনশীল তথ্য বাদে',
    permissions: [
      PERMS.DASHBOARD_VIEW, PERMS.POS_USE, PERMS.POS_DISCOUNT, PERMS.POS_PRICE_OVERRIDE, PERMS.SALES_VIEW,
      PERMS.RETURNS_MAKE, PERMS.PRODUCTS_VIEW, PERMS.PRODUCTS_CREATE, PERMS.PRODUCTS_EDIT, PERMS.PRODUCTS_EXPORT,
      PERMS.INVENTORY_VIEW, PERMS.INVENTORY_ADJUST, PERMS.PURCHASES_VIEW, PERMS.PURCHASES_CREATE,
      PERMS.SUPPLIERS_VIEW, PERMS.SUPPLIERS_MANAGE, PERMS.CUSTOMERS_VIEW, PERMS.CUSTOMERS_MANAGE,
      PERMS.DUES_VIEW, PERMS.DUES_COLLECT, PERMS.DUES_PAY, PERMS.ACCOUNTS_VIEW, PERMS.REPORTS_VIEW,
      PERMS.REPORTS_EXPORT, PERMS.INVOICES_PRINT, PERMS.EXPORT, PERMS.NOTIFICATIONS_VIEW,
      PERMS.SETTINGS_VIEW, PERMS.LABELS_PRINT, PERMS.MFS_VIEW, PERMS.MFS_OPERATE, PERMS.PURCHASES_EDIT,
      PERMS.STAFF_VIEW
    ]
  },
  CASHIER: {
    name: 'ক্যাশিয়ার',
    description: 'বিক্রয় ও কাউন্টার কার্যক্রম',
    permissions: [
      PERMS.DASHBOARD_VIEW, PERMS.POS_USE, PERMS.SALES_VIEW, PERMS.PRODUCTS_VIEW,
      PERMS.CUSTOMERS_VIEW, PERMS.CUSTOMERS_MANAGE, PERMS.DUES_VIEW, PERMS.DUES_COLLECT,
      PERMS.INVENTORY_VIEW, PERMS.INVOICES_PRINT, PERMS.NOTIFICATIONS_VIEW
    ]
  }
} as const

/** Check helper — tolerant of role objects stored as JSON. */
export function hasPerm(perms: string[], required: string): boolean {
  return perms.includes(required)
}

export function hasAll(perms: string[], required: string[]): boolean {
  return required.every((r) => perms.includes(r))
}

export function hasAny(perms: string[], required: string[]): boolean {
  return required.some((r) => perms.includes(r))
}
