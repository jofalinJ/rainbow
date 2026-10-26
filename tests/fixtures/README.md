# Isolated checkout checks

Run `node --test tests/fixtures/checkout-flow.test.mjs` for the checkout integration checks.

Run `node scripts/checkout-fixture-server.mjs`, then open
`http://127.0.0.1:8844/order.html` for manual browser checks. An optional
`CHECKOUT_FIXTURE_PORT` selects another loopback port.

The server runs the real storefront modules, payment Worker routes, and payment
PostgreSQL migrations in an in-memory PGlite database. Only the Razorpay SDK and
HTTP provider transport are simulated. Supabase HTTP calls execute the actual
SQL functions against the disposable database. The payment API keeps its HTTPS
requirement; the fixture maps reserved `.invalid` hosts to loopback transport.

The browser displays an explicit simulator banner and controls for captured,
authorized, declined, dismissed, and duplicate callbacks. The browser CSP and
both transports block external requests. Invoice links are mapped to the local
invoice viewer after the production URL validation runs. No provider request,
real charge, production product, or production order is created.

The database starts with one synthetic ₹100 product and five units. A Tamil Nadu
order totals ₹149.92 after the existing 3% discount, GST, and ₹50 delivery fee.
Reset discards all local rows. Stopping the process discards the database.

Automated checks cover confirmation, invoice access, idempotency, authorization
before capture, retry after a temporary verification error, signature rejection,
reservation expiry and stock release, stock limits, authoritative pricing,
opt-in receipt queuing, and webhook settlement. Manual browser checks must still
exercise visible feedback and layout. These checks do not prove actual Razorpay
delivery or actual payment-provider settlement.

The Pages build explicitly excludes `scripts/` and `tests/`; this fixture is
never part of the public website.
