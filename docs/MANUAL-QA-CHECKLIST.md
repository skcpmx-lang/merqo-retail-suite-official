# MERQO Retail Suite 1.0.0 — Manual Deployment QA Checklist
**For MERQO deployment staff — complete on a real Windows PC before first customer installation.**
Target: Windows 10/11 x64 · Check each box only after actually performing the step. Log any failure with a screenshot and the step number.

---

## A · Installation & First Run
- [ ] 1. **Install** — run `MERQO-Retail-Suite-Setup-1.0.0.exe`; BEFORE installing, right-click the exe → Properties → **Digital Signatures**: signature must show MERQO's legal publisher name, SHA-256 digest and a timestamp (see docs/CODE-SIGNING.md); then install choosing a custom directory; verify EULA shows, desktop + Start-menu shortcuts are created with the MERQO icon; uninstall entry appears in Windows "Apps & features" as *MERQO Retail Suite 1.0.0*; on Windows 11 with Smart App Control ON, the installer must launch WITHOUT a block dialog.
- [ ] 2. **First-run setup** — launch; the **Setup wizard** must open (never a login screen); verify no demo data, demo store, or `owner/merqo123` appears anywhere.
- [ ] 3. **Owner account** — create owner (Bengali name, password); complete business name/address/phone + cash/bank/MFS opening balances → dashboard opens with ৳০ সংখ্যা and no errors.
- [ ] 4. **Restart application** — close and reopen; login screen appears; log in with the owner credentials just created.
- [ ] 5. **PIN lock** — set a PIN in settings; lock (Ctrl+L or menu); unlock with PIN; verify wrong PIN is refused with a Bengali message.

## B · People & Permissions
- [ ] 6. **Staff account** — create a user with the **ক্যাশিয়ার** role; log in on a second session.
- [ ] 7. **Permission test** — as cashier: Finance/P&L, Expenses, Purchases, Settings, Staff, Audit, Backup must be hidden AND their direct API calls must be refused (open DevTools → Network on any denied page load). As owner everything is visible.

## C · Inventory Flow
- [ ] 8. **Add product** — Bengali name, category, brand, unit, prices (৳), opening stock, min stock; appears in list with correct stock.
- [ ] 9. **Purchase product** — create a purchase from a supplier with partial payment; verify stock up, WAC recalculated, supplier due = invoice − paid.
- [ ] 10. **Receive stock** — add another purchase; verify stock adds and WAC blends (products page shows new average).
- [ ] 11. **Barcode scan** — scan a real product with a USB keyboard-wedge scanner on the POS screen: product lands in cart instantly; scan an unknown barcode → Bengali "পাওয়া যায়নি" message, no crash; scan the same item twice → quantity ২.

## D · Selling
- [ ] 12. **Sell product** — cash sale with mixed payments (cash + bKash); invoice number `INV-00000x`; stock drops; dashboard updates.
- [ ] 13. **Customer due** — credit sale to a customer (partial payment); due shows on customer page + dashboard.
- [ ] 14. **Customer payment** — collect due → RCP voucher prints/records; receivable reduces exactly.
- [ ] 15. **Supplier due & payment** — pay a supplier partially; voucher issued; payable matches statement.
- [ ] 16. **Expense** — create an expense from cash; appears in Finance; net profit drops by the amount.
- [ ] 17. **MFS transaction** — bKash cash-in with service charge; agent wallet and cash box move correctly; commission appears as income (NOT revenue).
- [ ] 18. **Return** — return 1 of 3 sold units (restock + cash refund); stock +1, cash decreases, sale shows partially-returned.
- [ ] 19. **Invoice A4** — print an invoice to a real A4 printer: logo, Bengali text, totals, paid/due status all correct, no clipping.
- [ ] 20. **Thermal print** — print the same invoice on an 80mm thermal printer (and 58mm if available): no truncation, page feed correct.
- [ ] 21. **PDF** — save invoice as PDF; open it; fonts render (Bengali correct).

## E · Safety Net
- [ ] 22. **Backup** — create a backup; note the .db file path and size; create a few more transactions (state B).
- [ ] 23. **Restore** — restore the backup; confirm state B transactions are gone and the backup-time numbers are exact; restart the app.
- [ ] 24. **LAN second PC** — enable LAN mode in settings (owner only); on a second PC run the client and connect to `http://<server-ip>:47612`; log in; make a sale from the client; verify the server sees it and stock/dues stay consistent.
- [ ] 25. **Mobile monitoring** — enable the owner monitor; open `http://<server-ip>:47612/monitor?key=…` on a phone; verify read-only dashboard loads; verify NO action on the phone can change data.
- [ ] 26. **Logout / login** — logout returns to login; old session cannot be reused with back-button navigation.
- [ ] 27. **Error handling** — disconnect the printer and print → professional Bengali message (no raw error); stop-and-restart the app mid-day → all data intact.

## Sign-off
| Step range | Tested by | Date | Result |
|---|---|---|---|
| A1–A5 | ____________ | ____ | ☐ pass ☐ fail |
| B6–B7 | ____________ | ____ | ☐ pass ☐ fail |
| C8–C11 | ____________ | ____ | ☐ pass ☐ fail |
| D12–D21 | ____________ | ____ | ☐ pass ☐ fail |
| E22–E27 | ____________ | ____ | ☐ pass ☐ fail |
