# MERQO Retail Suite — স্থাপত্য সিদ্ধান্ত ও প্রযুক্তি নির্বাচন (ADR)

> Document version: 1.0 · Status: Adopted · Owner: MERQO Engineering

This document records the binding architecture and technology decisions for
MERQO Retail Suite, made after full inspection of the repository and the build
environment. It is the source of truth for why the product is built the way it
is built.

---

## 1. Repository inspection findings

| Item | Finding |
| --- | --- |
| Repository content | Empty — a single 30-byte stub `README.md` (commit `587b81b`) |
| Existing source / config / assets | None |
| Build environment | Debian 12 sandbox · Node.js v22.22 · npm 10.9 · Python 3.11 · gcc/g++/make 12.2 · 2 vCPU · 3.8 GB RAM · 20 GB disk |
| Network | npm registry, GitHub releases and googleapis reachable |
| .NET / Java / Rust / Go / Wine | Not installed |

Because the repository is empty, every technology decision below was made from
first principles against the product requirements (offline-first retail,
Windows .exe deliverable, zero paid services, Bengali UI, multi-device
operation) and the realities of the build environment.

## 2. Technology decisions

### 2.1 Desktop framework — Electron + TypeScript

**Decision:** Electron (MIT) with TypeScript everywhere; packaged with
electron-builder into a Windows NSIS installer.

**Rationale:**
- The only runtime toolchains available in the build environment are Node.js
  and Python. Electron is the only production-grade desktop framework that can
  be **built and verified end-to-end in this environment** (Tauri needs a Rust
  + MinGW cross toolchain; .NET MAUI/WinUI and WPF need the .NET Windows
  workload; Qt needs C++/Qt licensing review and a much heavier toolchain).
- Electron is proven in commercial desktop products (VS Code, Slack, 1Password)
  and has first-class Windows packaging, printing (`webContents.print`,
  `printToPDF`), keyboard-event handling (barcode scanners present as HID
  keyboards), and Chromium-grade Bengali text shaping out of the box.
- MIT license — commercially safe. No runtime fees, no paid services.

**Consequences:** ~85–95 MB installer; ~200 MB installed size. Accepted for a
flagship product; verified against the packaging budget.

### 2.2 UI stack — React 18 + Vite + a first-party design system

**Decision:** React 18 + TypeScript + react-router + TanStack Query, compiled
by electron-vite (Vite). The visual layer is a **first-party design system**
(`merqo-ui`) built on CSS custom-property tokens — no third-party component
kit.

**Rationale:**
- A generic admin kit (MUI/Ant) would make the product look like a template —
  explicitly forbidden by the brand brief. A token-driven first-party system
  gives full control of the premium light-only theme, Bengali typography, and
  consistent tables/forms/modals.
- TanStack Query (MIT) provides cache, retries and loading/error state
  discipline for every server call — the correct backbone for a
  client/server architecture.

### 2.3 Database — SQLite (better-sqlite3) with WAL, embedded in the app server

**Decision:** SQLite via better-sqlite3 (MIT), WAL journal mode, foreign keys
ON, transactional writes, code-first migrations.

**Rationale:**
- Reliable single-file embedded database; battle-tested for desktop POS.
- WAL gives concurrent readers with one writer — sufficient for a LAN mode of
  a small retail chain (documented limits below).
- better-sqlite3 is synchronous and extremely fast, has prebuilt binaries for
  Electron, and a compiler toolchain is available as fallback.
- Money is stored as **integer poisha (1 ৳ = 100 poisha)** to eliminate
  floating-point drift; quantities are REAL with 3-dp rounding. Inventory
  costing uses **weighted average cost (WAC)**, recomputed on every purchase;
  COGS is snapshotted onto each sale line.

### 2.4 Application topology — “always a client of an API server”

**Decision:** The Electron main process embeds a **local HTTP API server**
(the *MERQO core*: Express + domain services + SQLite). The renderer is a pure
SPA that talks REST over loopback. In **Server Mode** the same core binds to
`0.0.0.0`, and other desktops run the identical app in **Client Mode**
pointing at the server host.

**Rationale:**
- One code path for single-PC, LAN multi-device, and read-only owner
  monitoring. No unsafe file-copy “sync”.
- Business logic, validation, permissions and audit live **only** in the core —
  the UI cannot bypass them. Data consistency (spec §39–40, §80) is enforced
  server-side inside SQLite transactions.
- Sessions are HTTP bearer tokens (random 256-bit, stored hashed) with expiry
  and role-based route guards.

### 2.5 Multi-device & owner monitoring — self-hosted, zero paid services

- **Single PC:** core bound to `127.0.0.1:<port>` (default 47612).
- **LAN server mode:** owner enables Server Mode; binds `0.0.0.0`; other PCs
  connect by host name/IP. SQLite WAL + per-request transactions prevent lost
  updates; invoice numbers are allocated inside the sale transaction, so
  concurrent sales cannot duplicate numbers.
- **Owner phone monitoring:** the core serves a **read-only, token-gated
  mobile dashboard** at `http://<server>:<port>/monitor`. Access works on the
  shop LAN, or remotely via the owner's own network path (port-forward/VPN —
  documented in `docs/MONITORING.md`). The monitor token is separate from
  login credentials, is view-limited, and can be revoked. No third-party
  cloud, no paid API.

### 2.6 Printing, PDF, barcodes

- Printing: Electron `webContents.print` against print-template windows
  (A4/A5/80 mm/58 mm CSS templates — never a screenshot of the UI). Failed/
  disconnected printers surface a Bengali error and the job stays replayable.
- PDF: `printToPDF` for invoices/statements/reports; saved by the user.
- Barcodes/QR: JsBarcode (MIT) + node-qrcode (MIT) generate CODE128/EAN-13/
  QR locally; scanners are consumed as keyboard-wedge HID input in the POS
  (universal across USB/BT scanners — no proprietary SDKs).

### 2.7 Security posture

- Passwords: scrypt (N=16384) with per-user salt; never stored in plaintext.
- Sessions: opaque bearer tokens; only SHA-256 hashes stored; idle expiry +
  absolute expiry; failed-login lockout with exponential cool-down.
- RBAC enforced in the core on every route; permission constants shared with
  the UI only for visibility (visibility is never the security boundary).
- Electron: `contextIsolation: true`, `nodeIntegration: false`, minimal
  contextBridge IPC, strict CSP, no remote content.
- SQL injection: prepared statements only; identifiers whitelisted.
- Files: imports validated + parsed in memory; backups written to the app
  data directory; paths resolved and checked (no traversal).

### 2.8 Testing

Vitest (MIT) with an in-memory SQLite database running the real migrations and
real services: financial-engine scenario suite (spec §55), permission matrix,
inventory/WAC invariants, returns, due flows, transfers, backup/restore
round-trip, CSV import/export, and numbering/integrity checks. Renderer logic
that is pure (formatting, cart reducer) is unit-tested the same way.

### 2.9 Versioning & release

Semantic versioning (current: **1.0.0**), build number stamped at build time,
release notes per version. electron-builder produces
`MERQO Retail Suite Setup <version>.exe` (NSIS, per-user or per-machine,
branded, uninstallable). Artifacts are attached to a GitHub Release.

## 3. Dependency licence register (runtime)

| Package | Licence | Use |
| --- | --- | --- |
| electron | MIT | Desktop shell |
| better-sqlite3 | MIT | Embedded database |
| express | MIT | Embedded API server |
| react / react-dom | MIT | UI |
| react-router-dom | MIT | Navigation |
| @tanstack/react-query | MIT | Server-state cache |
| recharts | MIT | Charts |
| lucide-react | ISC | Icons |
| jsbarcode | MIT | Barcode generation |
| qrcode | MIT | QR generation |
| papaparse | MIT | CSV import/export |

All are permissively licensed (MIT/ISC), free for commercial use, actively
maintained, and run fully offline. Fonts: Hind Siliguri & Inter (SIL OFL) —
bundled locally; OFL permits bundling and redistribution with the fonts
(non-sellable standalone). No dependency above requires a paid account,
key, or cloud service.

## 4. Forbidden-by-design

- No paid API/cloud/SaaS anywhere in the runtime path.
- No dark mode, no fake licensing calls, no telemetry.
- No “sync by copying files”. No client-trusted business logic.
- No feature exists in the UI without a working implementation behind it.

---

## 5. Environment constraint & build-farm decision (binding)

Direct downloads from GitHub's release asset CDN (`release-assets.githubusercontent.com`)
and most third-party CDNs are firewalled in the build sandbox. Git over HTTPS and
`api.github.com` remain open. Therefore:

- **The Windows .exe production build runs on GitHub Actions (`windows-latest`)**
  and is attached to the GitHub Release by CI — this is standard practice for
  cross-platform product teams and removes any dependence on sandbox network
  policy for release artifacts.
- **UI QA runs on GitHub Actions (`ubuntu-latest` + Xvfb + Electron)**: an
  automated screenshot suite captures every major screen at all required
  desktop resolutions and commits the images to a `ci/qa` branch, where the
  engineering agent fetches and visually inspects them (git transport is open).
- Locally: full TypeScript typecheck, the complete Vitest business-logic suite
  (in-memory SQLite), renderer production build, and packaging dry-runs.

---

## 8. Verification record (September 2026)

Executed in the build sandbox against the completed codebase:

| Check | Command | Result |
| --- | --- | --- |
| Typecheck (main+core+tests) | `npx tsc --noEmit -p tsconfig.json` | 0 errors |
| Typecheck (renderer) | `npx tsc --noEmit -p src/renderer/tsconfig.json` | 0 errors |
| Core + API smoke + hardening + perf tests | `npx vitest run --config tests/vitest.config.ts` | 83 pass + 1 conditional skip (first-run wizard, needs live fresh server) |
| Production build | `npm run build` (electron-vite) | out/{main,preload,renderer} |
| API smoke over real HTTP | `tests/api-smoke.test.ts` (boots core on ephemeral port) | 9/9 scenarios |
| Full UI smoke — 30 routes | `tests/ui-smoke.test.tsx` (real React app in jsdom vs live QA server) | 30/30 mounts, 0 render errors |
| Release hardening suite | `tests/hardening.test.ts` — authz matrix, manager tier, business isolation, 16 reconciliation scenarios, inventory equation, returns guards, import rollback, backup round-trip, MFS config, concurrency, phone-monitor write matrix (19 endpoints), mid-operation transaction rollback (failure injection), historical immutability, import duplicate/barcode + 500-row bulk | 44/44 pass |
| Performance gate | `tests/perf.test.ts` — 1,000 products / 1,000 customers / 5,000 sales | dashboard 877 ms; all other queries ≤ 40 ms |
| First-run UI | `tests/firstrun-ui.test.tsx` — fresh install lands on setup wizard, no demo credentials | pass |
| Production bundle purity | grep of `out/` for demo data / credentials | clean |
| npm dependency audit | `npm audit` | 0 vulnerabilities |
| Number consistency | dashboard vs `reports/pnl` vs account ledger vs `reports/receivables` | exact match (one source of truth) |
| Windows installer | `npm run dist` on GitHub Actions (`windows-latest`) | CI workflow `.github/workflows/ci.yml` |

QA harness: `scripts/qa-server.ts` serves the production-built SPA and the real
core API on a single origin; `scripts/qa-seed.sh` populates realistic Bengali
demo data **through the app's own HTTP API** (no direct DB writes), so the seed
exercises the same validation, ledger postings and audit paths as production.
