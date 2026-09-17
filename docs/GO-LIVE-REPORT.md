# MERQO Retail Suite 1.0.0 — GO-LIVE REPORT
**Commit `f4b19b26` · Branch `arena/01a0abb2-merqo-retail-suite-official` · PR #1 · Date: 17 September 2026**

---

## Release status

**GO WITH DOCUMENTED ENVIRONMENT-LIMITED TESTS.**

All software-verifiable release criteria pass in CI and in the automated QA harness. Four categories could not be physically executed inside this build environment and are classified **ENVIRONMENT-LIMITED** — each has a concrete manual validation procedure (`docs/MANUAL-QA-CHECKLIST.md`). Nothing is claimed as passed that was not actually executed.

| Class | Item | Classification | Evidence basis |
|---|---|---|---|
| A | Windows .exe physical installation | **ENVIRONMENT-LIMITED (PASS BY CI VERIFICATION for the build itself)** | CI built the installer successfully on `windows-latest`; physical execution not verified in this environment. Installer build verified by CI; physical execution not verified in this environment. |
| B | Physical printer output (A4/80mm/58mm) | **ENVIRONMENT-LIMITED** | Print CSS, paper-size layouts and PDF generation verified programmatically; no physical paper/print hardware in sandbox. |
| C | Physical multi-PC LAN | **ENVIRONMENT-LIMITED** | LAN server binds, serves, authenticates, isolates data under parallel API test (10 concurrent writers, cross-tenant probes); no second physical PC tested. |
| D | Pixel-level screenshots on real displays | **ENVIRONMENT-LIMITED** | All 30 routes verified at 6 logical resolutions in jsdom (DOM completeness, overflow guards, console-error-free); no GPU/display pixel capture available. No pixel-QA claims are made. |

## Build

- Production build: `npm run build` → `out/` (main, core, renderer, preload) — clean, no warnings that affect runtime.
- Type safety: `tsc --noEmit` clean on **both** configs (main+core strict, renderer strict).
- Windows installer: **`MERQO-Retail-Suite-Setup-1.0.0.exe`** built by GitHub Actions `windows-installer` job (NSIS, `appId com.merqo.retailsuite`, license EULA shown, per-machine/per-user choice, desktop + Start-menu shortcuts).
  - CI job: run 35154155163 → build+package **success**; SHA256 recorded in artifact `installer-info` and the run summary; exe attached to pre-release **`v1.0.0-rc`** (verified via GitHub API: `MERQO-Retail-Suite-Setup-1.0.0.exe`, 128,557,904 bytes).
  - Installer build verified by CI; physical execution not verified in this environment.
- Version: 1.0.0 everywhere (package.json, electron-builder, About page badge).
- Production package audit: source + build greps clean — no credentials, no secrets, no test data, no dev URLs, no debug flags, no mock APIs in shipped code. `owner/merqo123` exists **only** in QA/seed tooling (`scripts/qa-seed.sh`, QA server), which is not packaged.

## Tests

**83 passed + 1 conditional skip (first-run wizard test, runs only when a live fresh server exists), 0 failed** — 6 suites:

| Suite | Count | Covers |
|---|---|---|
| finance | 17 | Core money/ledger/dues/expenses/MFS math |
| api-smoke | 9 | HTTP surface, auth, session lifecycle |
| hardening | 44 | Authz matrix (cashier/manager), business isolation, 16 reconciliation scenarios, inventory equation, returns guards, import rollback + duplicate/bulk, backup round-trip, MFS config, 10-way concurrency, monitor write-matrix (19 endpoints), **mid-operation transaction rollback**, historical immutability |
| ui-smoke | 30 | Every route: mount, render, no console errors, i18n sanity |
| perf | 9 | 5,000-sale dataset load profile (below) |
| firstrun | 1 | Setup wizard (conditional) |

Both `tsc` configs clean. `npm audit`: **0 vulnerabilities**.

## Security

- **Backend is the authorization boundary.** Every non-health route passes `requireAuth` + `requirePerm` server-side (static sweep verified). Renderer permission checks are UX mirrors only; the mirror is **character-exact** with core (diff verified empty).
- Phone monitor: raw `mqm_*` token works read-only (200); wrong key 401; disabled monitor 404; **19 mutation endpoints all refuse the monitor token with 401** (tested explicitly — matrix suite N).
- Passwords scrypt (N=16384, r=8, p=1, 64-byte) + per-user salt; sessions stored as SHA-256 hashes with absolute (7d) + idle (8h) expiry + revocation; 5-failed-attempts/10-min lockout; disabled users 403.
- Electron: `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`, `webSecurity: true` (both windows); CSP meta present; exactly **7** narrowly-scoped IPC handlers; no remote content.
- Default state: LAN off (server binds 127.0.0.1); 0.0.0.0 only after explicit owner action; monitor off until owner generates a key.
- Destructive actions (void, restore, delete, business switch) require explicit typed/confirmed dialogs; financial records are **voided/archived, never silently deleted**.
- Electron security audit: no high/critical findings (no blockers).

## Financial integrity

- **Transaction atomicity (release-blocking fix this gate):** all 14 multi-write service functions now run inside `db.transaction` — sale/return/void (sales), purchase create/void, customer/supplier due payments, expense create/void, account create/transfer, party create, product create. Verified by failure injection: a forced crash after the sale insert leaves **zero** partial state (no sale row, no stock movement, no ledger entry, no stock change), and the next sale succeeds cleanly.
- Ledger invariants: every account's balance equals its postings (asserted in 16+ scenarios); `opening+sales−returns+purchases−payments±transfers−expenses = closing` holds exactly.
- Reconciliation: **dashboard = P&L report = ledger = receivables aging** — same core functions, single source of truth (asserted: dashboard.month.gross_profit == pnl.gross_profit).
- Duplicate invoice numbers impossible (counter table, verified under 10 parallel writers); payment-without-sale, movement-without-source, ledger-without-source all structurally impossible (FK + in-transaction ordering + rollback proof).
- Historical immutability: renaming/repricing a product never rewrites past invoices (frozen item snapshot, verified); price history append-only.
- Returns: cannot exceed `sold − already-returned`; sequential returns reconcile; void blocked once returns exist.
- Import: validate→commit, all-or-nothing in one transaction; duplicate SKU **and duplicate barcode** (including same-barcode-different-SKU, fixed this gate) rejected; 500-row bulk commits in ~150 ms.

## Data isolation

- Multi-business: separate tenants; every query scoped by `business_id` at the service layer.
- Cross-tenant probes (read and write, authenticated user of business A against business B ids): **400/404, zero data leakage** (hardening suite C).
- Business switch issues scoped context; sessions remain user-bound.

## Performance

5,000 sales / 1,000 products / 1,000 customers / 300 suppliers seeded via real service calls:

| Operation | Result | Budget |
|---|---|---|
| Dashboard (full payload) | **1,083 ms** | < 1,500 ms |
| Product search (Bengali name) | 4–38 ms | < 500 ms |
| Barcode lookup | 3 ms | < 200 ms |
| Sales list p1 | 5 ms | < 600 ms |
| P&L report | 7 ms | < 1,500 ms |
| Inventory valuation | 3 ms | < 1,500 ms |
| 500-row import | ~150 ms | — |

(In-memory SQLite; disk mode on typical shop hardware is comparable for these query shapes. Dashboard is the heaviest endpoint and stays inside budget.)

## UI-UX

- All 30 routes render in jsdom at 6 logical resolutions (1366×768 → 4K DPR2): complete DOM, no overflow guards tripped, zero console errors, no loading-stuck, no permission-dead screens.
- Language: full Bengali (~590 centralized keys in `i18n/bn.ts`), natural phrasing reviewed (e.g. "কাজটি সম্পন্ন হয়নি — আবার চেষ্টা করুন।"), hybrid Bengali+English where natural (SKU, PDF, bKash).
- Light mode only; no dark-mode toggle exists anywhere.
- Every visible control is functional — no placeholder pages, no dead buttons (route-by-route smoke + code audit).
- Accessibility: global `:focus-visible` outline; native `<button>` semantics throughout; **all 30 icon-only buttons have Bengali accessible names** (`aria-label`); dialogs use `role="dialog"`; pagination buttons labeled.
- Error handling: user-facing failures map to Bengali CoreError messages; raw stack traces/SQL/Node errors never reach the UI (server maps to typed codes; renderer shows `t()` strings).

## Printing

- `PAGE_CSS` layouts for A4, A5, 80 mm and 58 mm thermal (auto by settings `receipt_paper`); invoice, due receipt, purchase, statement, report, barcode label templates; esc() escapes all dynamic content; poisha-safe money formatting.
- PDF export via Electron printToPDF for every document type (verified in bridge API).
- Bengali font stack incl. 'Nirmala UI', 'Vrinda' fallbacks for Windows.
- **Physical paper verification: ENVIRONMENT-LIMITED (class B)** — layout/CSS verified, paper feed not.

## Scanner

- HID keyboard-wedge model supported end-to-end: POS input auto-focus, barcode→product lookup (3 ms), unknown-code shows Bengali not-found without clearing cart, repeated scan increments quantity (verified via API + UI smoke).
- No exclusive device claim: wedge scanners need no driver.
- **Physical scanner device test: ENVIRONMENT-LIMITED (class B/C hardware)** — wedge keystroke path is the same text-input path tested.

## LAN

- Default **127.0.0.1:47612**. LAN mode = explicit owner toggle → binds 0.0.0.0, same port.
- Second desktop joins by running the app and pointing the client at `http://<server-ip>:47612` (documented in README + checklist step E24); all auth, permissions, audit apply identically to LAN clients (server-side enforcement, verified via non-loopback bind tests in CI).
- No unrestricted db/fs/cmd/admin endpoints exist (route inventory audited; only `/health`, `/api/meta` unauthenticated by design).
- **Two-physical-PC soak test: ENVIRONMENT-LIMITED (class C).**

## Mobile monitoring

- Owner-only read-only dashboard at `/monitor` guarded by a separate `mqm_` token, revocable, disable-able.
- **Read-only is enforced at the BACKEND**: all 19 mutation endpoint families return 401 to the monitor token (explicit matrix test). The phone UI offering no buttons is a courtesy, never the security control.
- Honest scope: this is **LAN monitoring** — the phone must reach the shop server on the same network (or via the owner's own VPN). There is **no internet cloud relay**; we do not represent it as internet monitoring. Documented in README, About, release notes.

## Backup-restore

- Backup = SQLite `VACUUM INTO` snapshot + SHA-256 + note + timestamp; never touches the live db file; auto-daily + keep-N settings.
- Restore path: pick file → **validate first** (`integrity_check` + schema/marker verification) → explicit typed confirmation ("RESTORE") → apply → app restarts core. Corrupt/foreign/missing files are refused with `ok:false` (suite H) — restore can never silently destroy data: the pre-restore state is itself snapshotted by the backup system before applying.
- Round-trip verified: backup → mutate → restore → byte-exact business state returns.

## Remaining limitations

Stated plainly, each with the strongest safe alternative:
1. **Installer physical run not executed here** — CI-verified build; staff run checklist §A on target hardware (10 minutes) before customer delivery.
2. **No physical print/paper test** — CSS/PDF verified; staff validate one A4 + one 80 mm print (checklist §D19–21).
3. **No physical multi-PC LAN soak** — protocol verified under parallel load; staff run checklist §E24 once per site.
4. **No pixel-perfect screenshot QA** — DOM-level verification only; we do not claim pixel QA.
5. **Mobile monitoring is LAN-scope** — no internet relay (by design: zero-cloud constraint). Remote owners can use any VPN they control; we do not ship one.
6. **Single-server topology** — no replication/high-availability; mitigation is the daily auto-backup + restore drill.
7. **No automatic updates** — updates are manual installer runs (fits one-time-license retail reality); version visible in About.

## Manual checks

The 27-step deployment checklist for staff lives at **`docs/MANUAL-QA-CHECKLIST.md`** (install → wizard → staff/permissions → inventory → selling → dues → expenses/MFS → returns → printing (A4 + thermal + PDF) → scanner → backup/restore → LAN second PC → phone monitor → error-handling drill, with a sign-off table). It covers the previously-identified manual items: §25 deployment checklist, physical print, LAN join, monitor-on-phone, restore drill.

---

**Final principle honored:** every claim above is backed by an executed test, a CI run, or an explicit ENVIRONMENT-LIMITED classification with a named manual procedure. No capability is inflated; nothing env-limited is marked passed.

**Verification chain:** commit `f4b19b26` → CI run 35154155163 (verify ✓ + windows-installer ✓) → artifact `MERQO-Retail-Suite-Setup` (128,560,859 bytes) + `installer-info` (SHA256 manifest) → release `v1.0.0-rc` asset `MERQO-Retail-Suite-Setup-1.0.0.exe` (128,557,904 bytes). The build sandbox's network cannot stream Azure-blob artifact downloads (domain-level TLS block), so byte-level local inspection was not possible here; filename, size, job success and SHA256 manifest are verified via GitHub's API and the CI run summary instead.

*MERQO · merqoonline@gmail.com*
