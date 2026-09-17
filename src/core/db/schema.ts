/**
 * MERQO Retail Suite — SQLite schema v1.
 *
 * Conventions:
 *  - ids: 22-char url-safe random (crypto)
 *  - money: INTEGER poisha · qty: REAL (3 dp) · timestamps: epoch ms
 *  - every business-scoped table has business_id with FK + index
 *  - ledger (account_txns) and stock_movements are append-only truth;
 *    balances on parents are transactionally-maintained caches.
 */

export const SCHEMA_VERSION = 1

export const DDL = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  username      TEXT NOT NULL UNIQUE,
  phone         TEXT,
  password_hash TEXT NOT NULL,
  pin_hash      TEXT,
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  created_at    INTEGER NOT NULL,
  last_login_at INTEGER
);

CREATE TABLE IF NOT EXISTS businesses (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  owner_name   TEXT,
  phone        TEXT,
  email        TEXT,
  address      TEXT,
  biz_type     TEXT,
  logo_data    TEXT,
  currency     TEXT NOT NULL DEFAULT 'BDT',
  timezone     TEXT NOT NULL DEFAULT 'Asia/Dhaka',
  opening_at   INTEGER NOT NULL,
  status       TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  created_at   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS memberships (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  role_id     TEXT,
  is_owner    INTEGER NOT NULL DEFAULT 0,
  status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')),
  created_at  INTEGER NOT NULL,
  UNIQUE (user_id, business_id)
);
CREATE INDEX IF NOT EXISTS ix_memb_user ON memberships(user_id);
CREATE INDEX IF NOT EXISTS ix_memb_biz  ON memberships(business_id);

CREATE TABLE IF NOT EXISTS roles (
  id          TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  note        TEXT,
  permissions TEXT NOT NULL DEFAULT '[]',
  is_system   INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,
  UNIQUE (business_id, name)
);
CREATE INDEX IF NOT EXISTS ix_roles_biz ON roles(business_id);

CREATE TABLE IF NOT EXISTS categories (
  id          TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  note        TEXT,
  status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  created_at  INTEGER NOT NULL,
  UNIQUE (business_id, name)
);
CREATE INDEX IF NOT EXISTS ix_cat_biz ON categories(business_id);

CREATE TABLE IF NOT EXISTS brands (
  id          TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  created_at  INTEGER NOT NULL,
  UNIQUE (business_id, name)
);
CREATE INDEX IF NOT EXISTS ix_brand_biz ON brands(business_id);

CREATE TABLE IF NOT EXISTS units (
  id            TEXT PRIMARY KEY,
  business_id   TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  short         TEXT NOT NULL,
  allow_decimal INTEGER NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  created_at    INTEGER NOT NULL,
  UNIQUE (business_id, name)
);
CREATE INDEX IF NOT EXISTS ix_unit_biz ON units(business_id);

CREATE TABLE IF NOT EXISTS suppliers (
  id          TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  company     TEXT,
  phone       TEXT,
  email       TEXT,
  address     TEXT,
  opening_due INTEGER NOT NULL DEFAULT 0,
  payable     INTEGER NOT NULL DEFAULT 0,
  status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  created_at  INTEGER NOT NULL,
  UNIQUE (business_id, name)
);
CREATE INDEX IF NOT EXISTS ix_sup_biz ON suppliers(business_id);

CREATE TABLE IF NOT EXISTS customers (
  id          TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  code        TEXT,
  name        TEXT NOT NULL,
  phone       TEXT,
  address     TEXT,
  email       TEXT,
  note        TEXT,
  opening_due INTEGER NOT NULL DEFAULT 0,
  receivable  INTEGER NOT NULL DEFAULT 0,
  status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_cus_biz   ON customers(business_id);
CREATE INDEX IF NOT EXISTS ix_cus_phone ON customers(business_id, phone);
CREATE UNIQUE INDEX IF NOT EXISTS ux_cus_code ON customers(business_id, code) WHERE code IS NOT NULL AND code <> '';

CREATE TABLE IF NOT EXISTS products (
  id               TEXT PRIMARY KEY,
  business_id      TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  sku              TEXT,
  barcode          TEXT,
  category_id      TEXT REFERENCES categories(id) ON DELETE SET NULL,
  brand_id         TEXT REFERENCES brands(id) ON DELETE SET NULL,
  unit_id          TEXT REFERENCES units(id) ON DELETE SET NULL,
  supplier_id      TEXT REFERENCES suppliers(id) ON DELETE SET NULL,
  purchase_price   INTEGER NOT NULL DEFAULT 0,
  selling_price    INTEGER NOT NULL DEFAULT 0,
  wholesale_price  INTEGER,
  min_selling_price INTEGER,
  tax_rate_bps     INTEGER NOT NULL DEFAULT 0,
  track_stock      INTEGER NOT NULL DEFAULT 1,
  min_stock        REAL NOT NULL DEFAULT 0,
  reorder_level    REAL NOT NULL DEFAULT 0,
  description      TEXT,
  image_data       TEXT,
  expiry_date      INTEGER,
  batch_no         TEXT,
  stock            REAL NOT NULL DEFAULT 0,
  wac              INTEGER NOT NULL DEFAULT 0,
  status           TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_prod_biz  ON products(business_id);
CREATE INDEX IF NOT EXISTS ix_prod_bar  ON products(business_id, barcode);
CREATE INDEX IF NOT EXISTS ix_prod_sku  ON products(business_id, sku);
CREATE INDEX IF NOT EXISTS ix_prod_cat  ON products(business_id, category_id);
CREATE INDEX IF NOT EXISTS ix_prod_name ON products(business_id, name);

CREATE TABLE IF NOT EXISTS product_barcodes (
  id          TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  product_id  TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  barcode     TEXT NOT NULL,
  type        TEXT NOT NULL DEFAULT 'CODE128',
  created_at  INTEGER NOT NULL,
  UNIQUE (business_id, barcode)
);
CREATE INDEX IF NOT EXISTS ix_pbar_prod ON product_barcodes(product_id);

CREATE TABLE IF NOT EXISTS stock_movements (
  id            TEXT PRIMARY KEY,
  business_id   TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  product_id    TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  qty           REAL NOT NULL,
  type          TEXT NOT NULL CHECK (type IN ('opening','purchase','purchase_return','sale','sale_return','adjustment','damage','loss')),
  ref_type      TEXT,
  ref_id        TEXT,
  balance_after REAL NOT NULL,
  cost_at_move  INTEGER,
  reason        TEXT,
  note          TEXT,
  user_id       TEXT,
  created_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_mv_prod ON stock_movements(business_id, product_id, created_at);
CREATE INDEX IF NOT EXISTS ix_mv_ref  ON stock_movements(ref_type, ref_id);
CREATE INDEX IF NOT EXISTS ix_mv_date ON stock_movements(business_id, created_at);

CREATE TABLE IF NOT EXISTS accounts (
  id              TEXT PRIMARY KEY,
  business_id     TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  type            TEXT NOT NULL CHECK (type IN ('cash','bank','card','mfs','other')),
  provider        TEXT,
  account_no      TEXT,
  agent_number    TEXT,
  note            TEXT,
  opening_balance INTEGER NOT NULL DEFAULT 0,
  balance         INTEGER NOT NULL DEFAULT 0,
  is_system       INTEGER NOT NULL DEFAULT 0,
  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  created_at      INTEGER NOT NULL,
  UNIQUE (business_id, name)
);
CREATE INDEX IF NOT EXISTS ix_acc_biz ON accounts(business_id);

CREATE TABLE IF NOT EXISTS account_txns (
  id            TEXT PRIMARY KEY,
  business_id   TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  account_id    TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  amount        INTEGER NOT NULL,
  balance_after INTEGER NOT NULL,
  type          TEXT NOT NULL,
  ref_type      TEXT,
  ref_id        TEXT,
  note          TEXT,
  user_id       TEXT,
  created_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_atx_acc  ON account_txns(account_id, created_at);
CREATE INDEX IF NOT EXISTS ix_atx_biz  ON account_txns(business_id, created_at);
CREATE INDEX IF NOT EXISTS ix_atx_ref  ON account_txns(ref_type, ref_id);

CREATE TABLE IF NOT EXISTS transfers (
  id           TEXT PRIMARY KEY,
  business_id  TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  from_account TEXT NOT NULL REFERENCES accounts(id),
  to_account   TEXT NOT NULL REFERENCES accounts(id),
  amount       INTEGER NOT NULL,
  fee          INTEGER NOT NULL DEFAULT 0,
  date         INTEGER NOT NULL,
  note         TEXT,
  user_id      TEXT,
  created_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_tr_biz ON transfers(business_id, date);

CREATE TABLE IF NOT EXISTS sales (
  id               TEXT PRIMARY KEY,
  business_id      TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  invoice_no       TEXT NOT NULL,
  customer_id      TEXT REFERENCES customers(id) ON DELETE SET NULL,
  customer_name    TEXT,
  date             INTEGER NOT NULL,
  subtotal         INTEGER NOT NULL DEFAULT 0,
  item_discount    INTEGER NOT NULL DEFAULT 0,
  invoice_discount INTEGER NOT NULL DEFAULT 0,
  tax              INTEGER NOT NULL DEFAULT 0,
  total            INTEGER NOT NULL,
  paid             INTEGER NOT NULL DEFAULT 0,
  due              INTEGER NOT NULL DEFAULT 0,
  cogs             INTEGER NOT NULL DEFAULT 0,
  payment_method   TEXT NOT NULL DEFAULT 'cash',
  note             TEXT,
  status           TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('completed','returned','partially_returned','voided')),
  returned_amount  INTEGER NOT NULL DEFAULT 0,
  user_id          TEXT NOT NULL,
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER
);
CREATE INDEX IF NOT EXISTS ix_sale_biz  ON sales(business_id, date DESC);
CREATE INDEX IF NOT EXISTS ix_sale_cust ON sales(business_id, customer_id);
CREATE INDEX IF NOT EXISTS ix_sale_inv  ON sales(invoice_no);
CREATE INDEX IF NOT EXISTS ix_sale_user ON sales(business_id, user_id);

CREATE TABLE IF NOT EXISTS sale_items (
  id           TEXT PRIMARY KEY,
  business_id  TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  sale_id      TEXT NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  product_id   TEXT REFERENCES products(id) ON DELETE SET NULL,
  name         TEXT NOT NULL,
  sku          TEXT,
  unit         TEXT,
  qty          REAL NOT NULL,
  unit_price   INTEGER NOT NULL,
  discount     INTEGER NOT NULL DEFAULT 0,
  discount_pct REAL,
  tax          INTEGER NOT NULL DEFAULT 0,
  line_total   INTEGER NOT NULL,
  cogs_unit    INTEGER NOT NULL DEFAULT 0,
  cogs_total   INTEGER NOT NULL DEFAULT 0,
  returned_qty REAL NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS ix_sitem_sale ON sale_items(sale_id);
CREATE INDEX IF NOT EXISTS ix_sitem_prod ON sale_items(business_id, product_id);

CREATE TABLE IF NOT EXISTS returns_ (
  id           TEXT PRIMARY KEY,
  business_id  TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  sale_id      TEXT NOT NULL REFERENCES sales(id),
  customer_id  TEXT REFERENCES customers(id) ON DELETE SET NULL,
  invoice_no   TEXT NOT NULL,
  date         INTEGER NOT NULL,
  amount       INTEGER NOT NULL,
  cogs_return  INTEGER NOT NULL DEFAULT 0,
  restock      INTEGER NOT NULL DEFAULT 1,
  refund_mode  TEXT NOT NULL DEFAULT 'cash' CHECK (refund_mode IN ('cash','due_adjust','account')),
  account_id   TEXT REFERENCES accounts(id) ON DELETE SET NULL,
  reason       TEXT,
  note         TEXT,
  user_id      TEXT NOT NULL,
  created_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_ret_biz  ON returns_(business_id, date DESC);
CREATE INDEX IF NOT EXISTS ix_ret_sale ON returns_(sale_id);

CREATE TABLE IF NOT EXISTS return_items (
  id           TEXT PRIMARY KEY,
  business_id  TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  return_id    TEXT NOT NULL REFERENCES returns_(id) ON DELETE CASCADE,
  sale_item_id TEXT NOT NULL REFERENCES sale_items(id),
  product_id   TEXT REFERENCES products(id) ON DELETE SET NULL,
  name         TEXT NOT NULL,
  qty          REAL NOT NULL,
  unit_price   INTEGER NOT NULL,
  amount       INTEGER NOT NULL,
  cogs         INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS ix_ritem_ret ON return_items(return_id);

CREATE TABLE IF NOT EXISTS purchases (
  id          TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  supplier_id TEXT NOT NULL REFERENCES suppliers(id),
  ref_no      TEXT,
  date        INTEGER NOT NULL,
  subtotal    INTEGER NOT NULL DEFAULT 0,
  discount    INTEGER NOT NULL DEFAULT 0,
  other_cost  INTEGER NOT NULL DEFAULT 0,
  total       INTEGER NOT NULL,
  paid        INTEGER NOT NULL DEFAULT 0,
  due         INTEGER NOT NULL DEFAULT 0,
  note        TEXT,
  status      TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('completed','voided')),
  user_id     TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_pur_biz  ON purchases(business_id, date DESC);
CREATE INDEX IF NOT EXISTS ix_pur_sup  ON purchases(business_id, supplier_id);

CREATE TABLE IF NOT EXISTS purchase_items (
  id          TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  purchase_id TEXT NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
  product_id  TEXT NOT NULL REFERENCES products(id),
  name        TEXT NOT NULL,
  qty         REAL NOT NULL,
  unit_cost   INTEGER NOT NULL,
  line_total  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_pitem_pur  ON purchase_items(purchase_id);
CREATE INDEX IF NOT EXISTS ix_pitem_prod ON purchase_items(business_id, product_id);

CREATE TABLE IF NOT EXISTS payments (
  id          TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  voucher_no  TEXT NOT NULL,
  party_type  TEXT NOT NULL CHECK (party_type IN ('customer','supplier')),
  party_id    TEXT NOT NULL,
  party_name  TEXT,
  direction   TEXT NOT NULL CHECK (direction IN ('in','out')),
  amount      INTEGER NOT NULL,
  account_id  TEXT REFERENCES accounts(id),
  method      TEXT NOT NULL,
  ref_type    TEXT,
  ref_id      TEXT,
  date        INTEGER NOT NULL,
  note        TEXT,
  user_id     TEXT,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_pay_biz   ON payments(business_id, date DESC);
CREATE INDEX IF NOT EXISTS ix_pay_party ON payments(business_id, party_type, party_id);
CREATE INDEX IF NOT EXISTS ix_pay_ref   ON payments(ref_type, ref_id);

CREATE TABLE IF NOT EXISTS expense_categories (
  id          TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  created_at  INTEGER NOT NULL,
  UNIQUE (business_id, name)
);
CREATE INDEX IF NOT EXISTS ix_excat_biz ON expense_categories(business_id);

CREATE TABLE IF NOT EXISTS expenses (
  id          TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  category_id TEXT REFERENCES expense_categories(id) ON DELETE SET NULL,
  title       TEXT NOT NULL,
  amount      INTEGER NOT NULL,
  account_id  TEXT NOT NULL REFERENCES accounts(id),
  method      TEXT,
  date        INTEGER NOT NULL,
  reference   TEXT,
  note        TEXT,
  status      TEXT NOT NULL DEFAULT 'approved' CHECK (status IN ('approved','voided')),
  user_id     TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_exp_biz ON expenses(business_id, date DESC);

CREATE TABLE IF NOT EXISTS mfs_txns (
  id                 TEXT PRIMARY KEY,
  business_id        TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  provider           TEXT NOT NULL,
  txn_type           TEXT NOT NULL CHECK (txn_type IN ('cash_in','cash_out','send_money','payment','commission','adjustment')),
  account_id         TEXT NOT NULL REFERENCES accounts(id),
  counter_account_id TEXT REFERENCES accounts(id),
  amount             INTEGER NOT NULL,
  commission         INTEGER NOT NULL DEFAULT 0,
  service_charge     INTEGER NOT NULL DEFAULT 0,
  customer_phone     TEXT,
  reference_no       TEXT,
  note               TEXT,
  date               INTEGER NOT NULL,
  user_id            TEXT,
  created_at         INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_mfs_biz  ON mfs_txns(business_id, date DESC);
CREATE INDEX IF NOT EXISTS ix_mfs_prov ON mfs_txns(business_id, provider);

CREATE TABLE IF NOT EXISTS counters (
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  key         TEXT NOT NULL,
  value       INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (business_id, key)
);

CREATE TABLE IF NOT EXISTS held_sales (
  id          TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  label       TEXT NOT NULL,
  cart_json   TEXT NOT NULL,
  user_id     TEXT,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_held_biz ON held_sales(business_id);

CREATE TABLE IF NOT EXISTS notifications (
  id          TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  type        TEXT NOT NULL,
  severity    TEXT NOT NULL DEFAULT 'info' CHECK (severity IN ('info','warning','critical')),
  title       TEXT NOT NULL,
  body        TEXT,
  ref_type    TEXT,
  ref_id      TEXT,
  dedup_key   TEXT,
  is_read     INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,
  read_at     INTEGER
);
CREATE INDEX IF NOT EXISTS ix_notif_biz ON notifications(business_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS ux_notif_dedup ON notifications(business_id, dedup_key) WHERE dedup_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS audit_logs (
  id           TEXT PRIMARY KEY,
  business_id  TEXT,
  user_id      TEXT,
  user_name    TEXT,
  action       TEXT NOT NULL,
  entity_type  TEXT,
  entity_id    TEXT,
  before_json  TEXT,
  after_json   TEXT,
  note         TEXT,
  created_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_audit_biz  ON audit_logs(business_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_audit_user ON audit_logs(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS sessions (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  business_id  TEXT,
  created_at   INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL,
  idle_timeout INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  ip           TEXT,
  user_agent   TEXT,
  revoked      INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS ix_sess_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS settings (
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  key         TEXT NOT NULL,
  value       TEXT,
  PRIMARY KEY (business_id, key)
);

CREATE TABLE IF NOT EXISTS backups (
  id          TEXT PRIMARY KEY,
  business_id TEXT,
  file        TEXT NOT NULL,
  size        INTEGER NOT NULL,
  note        TEXT,
  auto        INTEGER NOT NULL DEFAULT 0,
  verified    INTEGER NOT NULL DEFAULT 0,
  user_id     TEXT,
  created_at  INTEGER NOT NULL
);
`
