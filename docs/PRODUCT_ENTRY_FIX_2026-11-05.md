# Product entry and online display fix

Prepared 5 November 2026 (Asia/Kolkata). Based on `a291463`.

The live Products page made initial stock read-only whenever multi-shop mode was enabled. The only explanation was a tooltip directing staff to Inventory. Its Published/Stock labels also conflated an enabled product, physical shop stock and allocated online stock. Staff saw an Online action that rejected their role.

## Resulting behavior

- New products and new variants accept an opening quantity and an explicit authorized physical shop. New variant rows still start with zero online stock; the existing `erp_adjust_stock` RPC records the physical receipt. Online locations are excluded.
- Invalid quantities, unassigned shops and positive receipts for disabled products fail before product creation. Zero opening stock remains valid.
- Stock requests retain their identifier and payload across retries/reloads. Retrying confirms the same request without creating a product or receiving the quantity again.
- Uncertain product/variant insertions preserve the original ID/payload in a user-scoped session marker and block another create. Verify saved record resolves/retries that same insertion; it does not silently receive stock or upload photos.
- The product list provides Manage stock and Online display actions. Staff can read an online status explanation; admin-only publication retains existing permissions. Product status and online stock have distinct labels.
- Product list, View online shop, Online display and Manage existing stock shortcuts are prominent. Category display and bulk/health tools are collapsible. Phone layouts use the full page width.

## Verification

- `npm run test:unit`: 337 passed across 40 files.
- `npm run lint`: passed.
- `npm run build:pages`: static verification and publish-tree generation passed.
- Browser against a network-isolated synthetic fixture: created one product and received seven units at its selected shop; product count increased by one, stock receipt by seven.
- Lost stock response after applying seven units, followed by reload/retry: product remained saved; applied stock stayed seven; one duplicate-safe response was observed.
- Regression tests cover lost insert response plus failed verification, reloading an unresolved insertion, stable product/variant IDs, stock-only retry, blocked storage and malformed recovery data.
- Staff online status dialog opened without an access-error popup. Category shortcuts expand their target.
- Phone viewport 390 x 844: document width 390, page width 390, main width 390, stock control width 332. The product table scrolls within its own region.

## Review and release

No production product, stock, listing, schema, credentials or hosting setting was changed by this work. Live authenticated writes were not exercised. Tests use the existing RPC contract with a synthetic transport; validate the intended staff role on a staging database before release. The production database remains the authority for shop assignment and stock permissions.

Local preview: `node scripts/product-editor-fixture-server.mjs`, then open `http://127.0.0.1:8848/admin/products.html?fixtureRole=cashier`. The fixture uses synthetic data and blocks production connections. Its scripts/tests/docs are excluded from the published asset tree.
