# Repository dead-code and asset audit — 11 November 2026

## Scope and inventory
The recursive `main` Git tree contained 300 tracked files (approximately 2.38 MB), including 29 HTML, 48 JavaScript, 99 MJS, 17 CSS, and 53 SQL files. Reviewed the public page entrypoints, their declared assets, the Cloudflare Pages manifest, script loading, repository lint configuration and CI protections. An installed dependency, a historic migration, a module used through `import()`, and an intentionally addressable HTML page are **not** classified as dead merely because they are not loaded by `index.html`.

## Confirmed removals
- `content.js`: remove the unreferenced private functions `isMenProduct`, `matchesTextSearch`, and `openTrackingOverlay`. Remove unused `productsLoading`, `productsReloadRequested`, `discovery` and an ignored account-list argument.
- `admin/app.js`: remove the unused `enableStableNavigation` helper. Navigation still uses the existing role-checked shared sidebar.
- `shop-discovery.js`: retire a browser helper whose only runtime reference was the unused `discovery` assignment. Delete its obsolete unit test; remove the script from the homepage and from the Pages allowlist. The real catalogue continues using `shop-catalogue.js`.

## Regression prevention
- ESLint now checks unused variables in private storefront modules instead of silently allowing new unused helpers.
- `npm run audit:assets` reports unreferenced public JS/CSS candidates across the files actually shipped by the Pages allowlist; `--strict` can be used after reviewing any dynamic-load exceptions.
- CI runs the static asset audit alongside lint, browser fixtures, checkout, offline cash POS, static builds, and security checks.

## Intentionally not deleted
- All 53 SQL migration files: migration history, ordering and restoration matter even if old routines are overridden later.
- Authentication, Razorpay, checkout, ERP inventory and offline POS code: no deletion based on simplistic reference counts.
- CSS selectors with duplicate strings in different responsive blocks: cascade order and media context must be validated visually before removal.
- The admin attendance page's `bindDailyActions` is **currently not called** while it is associated with visible manual attendance controls. This is a potential functional defect, not proof that the controls should be deleted. Audit of admin attendance write permissions and end-to-end behavior is needed before wiring or removing it.
- The global `comingSoon` helper in `admin/app.js`: retained conservatively because cross-page/inline usage must be ruled out before removal.

## Non-goals
No changes to production database schema, existing orders, inventory, stock reservation, payments or customer data. No removal of the existing admin/staff screens or product-entry features. This audit does not claim every dynamic code path is exercised by CI.
