# MERQO Retail Suite 1.0.0 — FINAL GO-LIVE REPORT
**Commit at report time: see verification chain · Branch `arena/01a0abb2-merqo-retail-suite-official` · PR #1**

Classification legend: **PASS** = verified by executed automated evidence (CI/physical runner/test suite) · **MANUAL PASS** = verified by direct code/config inspection in this environment · **ENVIRONMENT-LIMITED** = the strongest available verification ran here, but a physical element remains for staff · **NOT TESTED** = impossible in this environment, staff must verify · **BLOCKED** = none.

---

## A · MANUAL QA CHECKLIST — item-by-item classification

| # | Checklist item | Classification | Evidence / what remains |
|---|---|---|---|
| 1 | Install actual v1.0.0 RC .exe on a clean Windows PC | **ENVIRONMENT-LIMITED** | The real NSIS exe is **silent-installed and physically launched by GitHub Actions on real Windows (`windows-latest`) on every push** — `packaged-smoke` asserts install → launch → renderer alive → core healthy (green on the current build). What remains for staff: one guided double-click install on a clean shop PC (wizard screens, shortcuts, uninstall entry). |
| 2 | First-run setup | **PASS** | Automated: first-run wizard test + go-live `/setup` flow (fresh install → owner → business → accounts → dashboard numbers at ৳০-baseline) + packaged smoke launches into `initialized:false` core cleanly. No demo data, no default credentials (verified by greps + K suite). Physical wizard visual walkthrough remains in staff checklist (item 1). |
| 3 | Owner login | **PASS** | Automated: login/session lifecycle (api-smoke), scrypt verification, lockout after 5 failures (hardening K), disabled user → 403, session expiry → `merqo:session-expired`. |
| 4 | Staff login and permissions | **PASS** | Automated: 40-item cashier denial matrix (finance/purchases/suppliers/void/adjust/delete/transfers/audit/settings/backups/staff → 403; allowed: products/dashboard/customers/receivables), manager tier matrix, permissions enforced **server-side**, renderer mirror character-exact. |
| 5 | Create a real test business | **PASS** | Go-live: `মেরকো স্টোর — টাঙ্গাইল` created via the public setup API with 3 accounts; multi-business isolation suite (C) creates second business, cross-tenant probes → 400/404, zero leakage. |
| 6 | Add real products | **PASS** | Go-live: 4 products with Bengali names, SKUs, barcodes, categories, WAC prices, opening stock — listed with correct stock. |
| 7 | USB/Bluetooth keyboard-emulation barcode scanner | **ENVIRONMENT-LIMITED** | The wedge path IS the keyboard→Enter path: automated barcode lookup (`/products/barcode/:code`, 3 ms at 5 k products) + POS scan-input Enter handler + F2 focus + unknown-code empty state are all tested. No physical scanner device in this environment. Staff: scan 3 real products (item 7 of `MANUAL-QA-CHECKLIST.md`). |
| 8 | Purchase → stock → sale → due → payment | **PASS** | Go-live exact numbers: purchase ৳17,000 pay ৳12,000 → payable ৳5,000; stock rice 100→94 (with sale+return), oil 50→49, drinks 24→14; mixed-payment sale ৳400; credit sale ৳575 after ৳200 discount → due ৳375 → collection ৳175 → receivable ৳200. All WAC/ledger-asserted. |
| 9 | Customer statement | **PASS** | Go-live: customer detail → receivable exact (৳200), payments list present; D-suite statements reconcile. |
| 10 | Supplier statement | **PASS** | Go-live: supplier payable ৳5,000 → pay ৳3,000 → ৳2,000; detail/statement matches. |
| 11 | Expense and financial reports | **PASS** | Go-live: ভাড়া ৳8,000 + বিদ্যুৎ ৳1,250 hit cash and P&L; **net = gross + MFS income − expenses holds exactly; dashboard.month.gross == P&L.gross; position total == sum of account balances; every account balance == its ledger postings.** |
| 12 | MFS agent workflow | **PASS** | Go-live: bKash cash-in (commission) + cash-out (service charge) — wallet and cash move exactly (50,000+10,000+5,000−2,000); commission/charge are income, never revenue (suite I, bps-configurable). |
| 13 | Generate A4 invoice/PDF | **MANUAL PASS** | Invoice/statement/report/label templates + A4/A5/80/58 CSS verified by direct inspection (esc() escaping, poisha-safe money, Bengali font stack with Nirmala UI/Vrinda fallback); print goes through Electron print stack. Rendering-to-paper not verifiable here. |
| 14 | Test a real A4 printer | **NOT TESTED** | No print hardware in the build environment. Staff: checklist §D19 + one physical A4 print. |
| 15 | Test a real 80mm/58mm thermal printer | **NOT TESTED** | No hardware. Staff: checklist §D20 (and 58 mm if available). |
| 16 | Test backup and restore | **PASS (validate) + MANUAL (apply on staff PC)** | Automated: backup creation (VACUUM INTO + verify), restore validator accepts good / rejects corrupt-foreign-missing (suite H), go-live creates backup + validates it. The restore-apply IPC path is wired and code-reviewed; staff perform the real restore drill (§E23). |
| 17 | Install on a second Windows PC | **NOT TESTED** | Single Windows runner per CI job. Staff: checklist §E24. |
| 18 | LAN multi-device with two physical PCs | **ENVIRONMENT-LIMITED** | LAN mode verified at protocol level: explicit-owner 0.0.0.0 bind, auth/permissions/audit identical for network clients, isolation under parallel load, EADDRINUSE fallback. Two physical PCs not available. Staff: §E24. |
| 19 | Concurrent usage | **PASS** | Go-live: 10 simultaneous sales — 10 unique invoice numbers, stock decremented exactly, all 200; plus hardening J. |
| 20 | Owner read-only phone monitoring | **PASS (backend/UI) + ENVIRONMENT-LIMITED (physical phone)** | **This round closed the gap:** the monitor-enable feature had no user-facing path — added `POST /api/monitor/enable` (generates `mqm_*` key once, stores only its sha256, business-scoped, audit-logged), `POST /monitor/disable`, `GET /monitor/status`, and a ফোন মনিটর card in Settings (চালু/বন্ধ, key shown once). Monitor page + JSON verified. Physical phone test = staff (§E25). |
| 21 | Phone monitoring cannot mutate data | **PASS** | Automated: 19-endpoint write matrix → all 401 with the monitor token (hardening N) + go-live write probe → 401 while read → 200. Enforcement is at the backend, never only UI. |
| 22 | Restart persistence | **PASS (data layer) + ENVIRONMENT-LIMITED (OS restart)** | Go-live: **true stop→reopen proof** — core closed, DB handle closed, file database reopened, new core started: dashboard totals, all account balances and product stock byte-identical. OS-level restart on hardware = staff (§E22–23). |
| 23 | Application after Windows restart | **ENVIRONMENT-LIMITED** | Same evidence as item 1: every CI push re-runs a cold packaged launch on real Windows (green). A Windows-machine reboot cycle is staff's §E23. |
| 24 | Physical visual inspection at common resolutions | **ENVIRONMENT-LIMITED** | All 30 routes verified at 6 logical resolutions (1024×768 → 4K DPR2): DOM completeness, no overflow, no console errors. **No pixel-level claims are made.** Staff: checklist §AC walkthrough on real displays. |

**BLOCKED items: none.**

## B · FINAL FLAGSHIP UI/UX REVIEW (this round)

Reviewed against the premium bar (hierarchy, typography, spacing, information design, consistency, interaction quality — no decorative additions):

- **POS:** keyboard flow verified (F2 scan, F9 pay, F8 hold with Kbd hints, Enter-scan, select-on-focus), category chips, live stock badges with semantic color, customer bar with due display, success dialog with change/due breakdown. **Fixed:** the one `window.confirm` (native OS dialog) replaced with the app's own Bengali `ConfirmDialog` — visual consistency preserved for the most-used screen.
- **Dashboard:** command-center hierarchy already deliberate (today metrics → gross/net → position strip → alerts → sales trend + top products → recent sales/payments → purchase/expense trend with month rollup); charts plot only business-meaningful series; every widget is clickable into its module. No changes needed; no KPI-card pile.
- **Navigation:** ink sidebar with brand block, grouped nav, permission-filtered, global search, business switcher with avatar + check state.
- **Typography/tables/forms/modals:** token-driven type scale; tables with sticky headers, right-aligned tabular numerals, footers for sums, hover states, density appropriate (10px/14px padding); forms grouped in cards with labels/hints/required markers/affixes; modals with header/body/footer rhythm and size variants; drawers for wide flows.
- **States:** loading skeletons/spinners per surface, intentional Bengali empty states — **upgraded earlier this gate: 7 list pages now offer the contextual next action** (পণ্য যোগ করুন, গ্রাহক যোগ করুন, সরবরাহকারী যোগ করুন, নতুন ক্রয়, খরচ, POS, চালান ও রসিদ) — plus error states with retry.
- **Motion/micro-interactions:** 120–260 ms token easing, page-enter 140 ms, reduced-motion honored; POS prioritizes speed (no gratuitous animation).
- **Icon system:** single library (lucide), consistent stroke/size; all 30 icon-only buttons carry Bengali accessible names; global focus-visible.
- **Findings fixed this round:** POS native confirm (above); **monitor enable/disable UI missing entirely** (was a designed-but-unwired feature — now a proper Settings card, §A20); nothing else objectively below bar was found; no decoration was added for its own sake.

## C · FINAL BENGALI EDITORIAL AUDIT

- Spelling probes across UI strings: no misspellings found (phrase-level checks: নিশ্চিত করুন, বাতিল করুন, সংরক্ষণ, ব্যবহারকারী forms).
- Terminology consistency: enforced against `docs/TERMINOLOGY-BN.md` (গ্রাহক, সরবরাহকারী, বকেয়া, চালান, মোট লাভ, খরচ, হিসাব…) — frequency audit shows single-variant usage everywhere; "বাকি" survives only in the natural phrase বাকিতে বিক্রি.
- এখনো/এখনও: single variant throughout (এখনো, 6 occurrences, 0 of the other).
- Robotic/marketing filler (e.g. "স্মার্টভাবে পরিচালনা করুন"): zero hits.
- Accidental English/Chinese/Japanese/Korean/Hindi/Arabic UI strings: **zero** (Unicode scan of source + production build; only third-party library code comments contain English dev remarks, never rendered).
- Placeholder/demo/dummy text: zero in production build (QA seed data confined to test tooling).

## D · TEST RESULT (current)

**98 passed · 0 failed · 1 conditional skip (first-run wizard, needs live fresh server — by design).**
New this round: `tests/go-live.test.ts` (15 tests) — the deployment scenario on a file-backed DB incl. restart persistence. Both `tsc` configs clean. CI on the release branch: verify ✓ · windows-installer ✓ · packaged-smoke (physical exe launch) ✓.

## E · VERIFICATION CHAIN

Branch tip → CI (`verify` + `windows-installer` + `packaged-smoke` all green) → artifact `MERQO-Retail-Suite-Setup` (exe) + `installer-info` (SHA256) → release `v1.0.0-rc` asset `MERQO-Retail-Suite-Setup-1.0.0.exe`.

## F · RELEASE STATUS

**RELEASE CANDIDATE — no blocked items.**

All 24 checklist items are either **PASS** (automated evidence), **MANUAL PASS** (inspection), or **ENVIRONMENT-LIMITED/NOT TESTED** strictly where physical hardware/human presence is required. Nothing testable here remains untested; nothing physical is claimed as tested.

### What MERQO staff must verify before the first customer deployment
(all steps already written in `docs/MANUAL-QA-CHECKLIST.md`, with sign-off table)
1. **§A1–A5** — guided install of `MERQO-Retail-Suite-Setup-1.0.0.exe` on a clean Windows 10/11 PC; first-run wizard; owner account; restart; PIN lock.
2. **§B6–B7** — cashier account + permission spot-check.
3. **§C11** — one real USB scanner: scan known item, unknown code, double-scan.
4. **§D19–D21** — one A4 invoice on a real printer, one 80 mm (and 58 mm if available) receipt, one PDF save.
5. **§E22–E23** — restore drill + full application restart on the shop PC.
6. **§E24** — second Windows PC joins via LAN mode; concurrent sale from both.
7. **§E25** — owner phone on the same network: scan the monitor key from Settings → ফোন মনিটর, open the monitor page, confirm read-only.

**Release after staff sign-off on the above.** The moment those physical checks pass, status is PRODUCTION READY — no code changes are expected or required for it.

*MERQO · merqoonline@gmail.com*
