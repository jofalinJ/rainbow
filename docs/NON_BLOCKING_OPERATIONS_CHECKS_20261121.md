# Rainbow Gold Covering — non-blocking operations checks
Checked: 21 November 2026. This branch does not alter live shop availability, production inventory, customer data, or payment processing.

## Read-only production baseline
- ERP stock: Thuckalay 5; Verkilambi 0; Online Store 5. Total 10 database on-hand units; physical count NOT verified. Online Store is a logical allocation, not necessarily a separate physical shelf.
- Three transfers recorded as received; no currently in transit.
- Two ERP stock-balance rows: no negatives or reservation above on-hand.
- Razorpay records: one paid (INR 50.99) and three failed (combined attempted INR 3927.54). Failed amounts are NOT revenue.
- No paid orders without invoices, unpaid orders with invoices, or paid orders lacking a matching paid payment row.
- No refunded orders; the public.audit_logs table is absent. Stock, online order and shipment events provide only partial audit coverage.
- This is a snapshot, not proof of Razorpay settlement, a backup restore, or physical stock count.

## 1. Reconcile physical stock
Count real units per shop and SKU/variant. Compare receipts, branch transfer acknowledgements and logical online stock allocations with the ERP ledger. Never create extra physical stock merely because a variant also appears in the Online Store virtual location. Use authorized inventory adjustments only after owner review.

## 2. Backups and restore
The existing encrypted-database-backup.sh is operator-run, not scheduled. Backups require secure PGHOST, PGUSER, PGDATABASE, AGE_RECIPIENT and database authentication; the output must be protected and stored offsite.
An operator may validate an existing encrypted archive without touching a database using:
AGE_IDENTITY_FILE=/secure/key.txt bash scripts/verify-encrypted-backup.sh /secure/archive.pgcustom.age
This only checks decryption and archive table of contents, not a full recovery. Restore to an isolated, non-production database to prove recovery. Never upload private keys or a database dump to the public repository.

## 3. Payment recovery and duplication
Check declined payments, duplicated webhook events, callback loss, delayed capture, expired reservation, stock rollback and a single final invoice in an isolated payment environment. Reconcile Razorpay captured, settled and refunded states against the provider dashboard. Never issue a live refund or replay real payments merely to test.

## 4. Offline reconciliation
The offline queue already reuses the same idempotent sale UUID and pins the initial authorized sync actor. This branch highlights a confirmed server invoice with a different cash total and stores the review warning in the encrypted device vault. Do not generate a replacement invoice because an amount mismatch exists. Two disconnected tablets cannot reliably share their last-known stock; use one designated offline device per branch until per-device allocations are implemented.

## 5. Returns, refunds and exchanges
Require a link to the original order and receipt, inspect and record physical returned items, and reconcile the actual provider refund before marking a payment refunded. Return stock through an authorized movement only once the item is physically received. There are no live refunded orders to validate, and this branch does not introduce automatic refunds.

## 6. Cash closing
The reports page on this branch includes paid, non-cancelled/non-refunded orders only, uses the Asia/Kolkata shop day, and loads all orders in pages instead of silently truncating at 1,000. Each day compare physical cash, confirmed POS cash, pending provisional receipts, non-cash local payments, online Razorpay capture, and the gateway settlement report. Record unresolved differences for owner sign-off.

## 7. Admin audit and roles
A general audit_logs table was not found. Existing stock/order/shipment event tables are partial history. Add restricted audit coverage for price edits, stock adjustments, user role changes and refunds only after reviewing migration, RLS, retention and performance. Test guest, customer, same-branch cashier, other-branch staff and owner roles using isolated credentials. Review warnings for privileged functions individually; do not blindly revoke required RPC access.

## 8. Real devices
Test Android tablet Chrome/PWA, airplane-mode offline billing and reconnection, keyboard-type scanner, receipt printer, login/branch boundaries, and phone/tablet viewport widths 320/360/390/428/768/1280/1440. A green fixture run cannot replace real device acceptance.

## Do not interrupt service
Keep the storefront public and the existing live checkout running. This work is a draft pull request for review, CI and approved deployment. Do not introduce a maintenance page or launch-blocking flag. Physical counts, real payment tests, offsite backup configuration and restore verification still require an authorized operator and real equipment.
