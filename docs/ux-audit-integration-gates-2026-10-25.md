# Rainbow Gold Covering — isolated UX audit integration gates

**Status: BLOCKED — do not merge or deploy**  
**Review date:** 2026-10-25  
**Work branch:** `fix/ux-audit`  
**Main HEAD observed:** `d9e1706274bedf66de4854627a39ef793908e461`  
**Comparison observed:** audit branch was 106 commits ahead and 30 behind `main` at the start of reconciliation. Recompute before integrating.

## Scope and preserved behaviour

UX-01–UX-21 customer-facing changes are staged on the audit branch without
deliberate redesign, staff/admin changes, production SQL, Worker deployments
or actual payment actions.

- `rainbow_cart_v1` is preserved. Buy now uses a separate tab selection.
- Manual UPI is **pending verification**, never `paid` on UTR submission.
- `/api/upi/prepare`, `/api/upi/submit`, `/api/upi/status` and
  `/api/upi/correct` are proposed-only Worker contracts. Do not permit
  the browser to call privileged Supabase RPCs directly or fall back to
  `create_online_order`.
- Razorpay TEST remains hidden on ordinary production checkout; LIVE can be
  offered on the production host **only after server config and provider check**.
  The customer chooses Razorpay explicitly; provider mode flips demand
  another choice. The gateway rechecks expected TEST/LIVE mode at purchase
  time. Amount comparison is exact in integer paise.
- Razorpay's payment-failed event cannot create a confirmed order or clear
  the cart. The server must independently verify a successful payment.
- The merchant's UPI ID/payee details have **not** been verified separately
  from the legacy static QR. UX-08 same-phone deep link must stay blocked.

## Main divergence — conflict review REQUIRED

As of this review, `main` includes later Razorpay LIVE work not originally
present in `fix/ux-audit`. Its changes touch:

- `order.js` and `order-razorpay.mjs`
- `backend/rainbow-api/src/routes/razorpay.js`
- `backend/rainbow-api/src/payment-crypto.js`
- `.github/workflows/razorpay-live-smoke.yml`
- payment readiness, checkout and gateway event tests

The branch now copies the LIVE-capable `order-razorpay.mjs` contract from
`main` plus an exact-paise rejection guard. The branch `order.js` was
adapted to use server `razorpayAvailability`, provider-mode gating, an
explicitly acknowledged mode and `beginRazorpayPayment`.
**Do not use a blind GitHub merge or automatically accept either file at a
conflict.** Inspect the newest `main` and compare backend assumptions.
Do not copy production secrets, deploy or run real payment smoke operations
as part of this review.

## Isolated tests: coverage and requirements

Safe source/in-memory checks are in:

- `tests/unit/uxAuditBaseline.test.mjs`
- `tests/unit/uxPhase1Safety.test.mjs`
- `tests/unit/uxPhase2Checkout.test.mjs`
- `tests/unit/uxPhase3Safety.test.mjs`
- `tests/unit/uxPhase4Safety.test.mjs`
- `tests/unit/checkoutPaymentUX.test.mjs`
- `tests/unit/checkoutGatewaySelection.test.mjs`
- `tests/unit/razorpayGatewayModes.test.mjs`
- `tests/unit/razorpayGatewayEvents.test.mjs`

The gateway tests **stub** config, provider checks and creation. Simulated
LIVE/TEST provider transitions, rejected credentials, amount mismatches,
failed-payment events, and checkout startup do **not** issue network requests.

From a local, isolated branch checkout:

```bash
git switch fix/ux-audit
npm ci --legacy-peer-deps
npx vitest run \
  tests/unit/uxAuditBaseline.test.mjs \
  tests/unit/uxPhase1Safety.test.mjs \
  tests/unit/uxPhase2Checkout.test.mjs \
  tests/unit/uxPhase3Safety.test.mjs \
  tests/unit/uxPhase4Safety.test.mjs \
  tests/unit/checkoutPaymentUX.test.mjs \
  tests/unit/checkoutGatewaySelection.test.mjs \
  tests/unit/razorpayGatewayModes.test.mjs \
  tests/unit/razorpayGatewayEvents.test.mjs
```

**Do not run an unreviewed full test suite** against configured production
Supabase or Razorpay. Ensure all integration/external route tests use mocks.

For local browser QA, install Playwright and axe-core as dev-only tooling
and serve this branch from `http://127.0.0.1:4173`. Every Playwright suite
must set `E2E_ISOLATED_ENV=true`, enforce a localhost origin, block all
external requests, and replace the scannable merchant QR with a mock.

```bash
E2E_ISOLATED_ENV=true E2E_BASE_URL=http://127.0.0.1:4173 \
  npx playwright test \
  tests/e2e/ux-phase1-isolated.spec.mjs \
  tests/e2e/ux-phase3-isolated.spec.mjs \
  tests/e2e/ux-phase4-isolated.spec.mjs
```

Required environments: Chromium + WebKit at 320×568, 360×800, 390×844,
430×932; keyboard-only navigation; 200% zoom; offline/error/loading; axe-core
WCAG 2.2 AA; no horizontal overflow or hidden fixed-bar controls. Produce
**genuine** 390×844 before/after screenshots of the QR lock, clear-bag
dialog, back navigation, error state and pending-order banner.

## Hard blockers, not release-ready

1. **Manual UPI backend missing:** implement private server-priced pending
   checkout, idempotent UTR correction and authenticated status operations in
   an isolated database/Worker and verify it under concurrency. No production
   SQL/Worker change until separately reviewed and authorized.
2. **Existing pending order reconciliation:** retry/expiry/decline and stock
   restoration must not create duplicate orders or free uncertain payments.
3. **Verified merchant identity missing:** do not invent `upi://` recipients,
   account information or a deep link.
4. **Full browser and real-device QA not executed:** source-only checks do not
   establish responsive/no-overflow, axe, WebKit or safe-area compliance.
5. **Branch history and drift:** multiple file-level commits per UX finding,
   not the requested one-per-finding history; reconcile the newest `main`
   changes and perform review before any merge.
6. **Protected payment operations:** real checkout verification, printer,
   WhatsApp invoicing, actual bank/UPI handoff and production payment webhooks
   have not been executed in the isolated audit.

## Owner-device checks

On real Android and iOS: iOS focus zoom, mobile keyboard overlap, landscape
and safe areas, Touch Exploration/VoiceOver, 200% text scaling, one-handed
reach, actual no-photo product rendering, and handoff to a **verified** UPI
merchant account (separate authorized device session). Do not use a real bank
transfer merely to certify this branch.

## Rollback

No production rollback is required because this branch has not been deployed.
For branch-specific rollback, revert selected `fix(UX-xx)` commits, including
their associated tests/cache-bust commits. Never delete pending payment/order
records, silently restore uncertain reservations, or downgrade Razorpay LIVE
code during a revert. If the proposed backend is later isolated-tested and
deployed with permission, use the feature-flag and reconciliation rollback in
`proposed-backend/ux-02-manual-upi-A2-contract.md`.
