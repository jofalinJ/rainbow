# WhatsApp paid-invoice production sender — staged configuration

This workflow is **off by default** and must be approved before it can send to real customers. Do not turn on any switch until Meta onboarding, template approval, and the test recipient's signed consent are verified.

## How it works

- Existing checkout has an optional, unchecked customer consent checkbox.
- Server-side production claim RPC selects only paid, confirmed online orders with Razorpay capture, a verified paid payment, no refunds/released stock, exact invoice token URL and explicit WhatsApp opt-in.
- Worker checks payment mode, live release flag, a separate WhatsApp production approval switch, and the **actual sender number returned by Meta** from the configured phone number ID.
- The Worker never initiates payments or refunds and does not read/send any customer invoice outside the confirmed outbox.
- Meta returning a message ID means **accepted**, not delivered. The delivery-status callback must be configured and tested separately before treating a message as successfully received.

## Configuration

Keep these values in Worker secrets/secure environment, not in browser JavaScript or public GitHub:

- `WHATSAPP_SEND_ENABLED=true`: allow the cron sender to run at all; set only after confirmation.
- `WHATSAPP_PRODUCTION_APPROVED=true`: separate explicit merchant approval, **unset/false by default**.
- `PAYMENTS_MODE=live`, `LIVE_PAYMENTS_RELEASED=true`, and the existing **live Razorpay key ID** must match the deployed payment mode. This does not bypass the payment provider signature checks.
- `WHATSAPP_ACCESS_TOKEN`: production Meta system-user token with messaging permission.
- `WHATSAPP_PHONE_NUMBER_ID`: registered, verified Meta phone number ID.
- `WHATSAPP_EXPECTED_SENDER_E164`: **verified business sender**, digits with country code, e.g. `919999999998`; must match Meta's fetched display phone number. Do not assume an unregistered requested number is active.
- `WHATSAPP_TEMPLATE_NAME` and `WHATSAPP_TEMPLATE_LANGUAGE`: an approved utility template with three body variables in order: customer name, order number, invoice URL.
- `WHATSAPP_GRAPH_VERSION`: supported Meta Graph API version.
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`: existing secured service configuration.

## Safe release

1. Review and merge the DB migration only after SQL isolation tests and backup/rollback planning. Until installed, the production claim RPC is unavailable.
2. Validate Meta number ID and the exact sender via read-only Meta Graph API. Confirm the approved utility template placeholders/language and WABA permission.
3. Keep the production flag OFF while staging: run the unit/API and disposable PostgreSQL tests with fake credentials.
4. Register delivery-status webhook and test receipt updates for the approved test recipient; a provider acknowledgement is not proof of delivery.
5. Set the two sender flags ON only after merchant permission and one controlled, opted-in production recipient. Inspect outbox and message delivery logs without exposing customer numbers or invoice tokens.
6. On unexpected issues, set `WHATSAPP_SEND_ENABLED=false` immediately. Previously claimed messages must be reconciled manually; do not blindly resend invoices.

Existing test-mode allowlist behavior is preserved. No existing pending message is sent by this pull request, and installing the SQL alone does not send anything.
