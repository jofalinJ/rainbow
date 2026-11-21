# Meta WhatsApp Cloud API delivery status callback — staged

The existing automatic invoice sender currently treats a Meta message ID as accepted, **not delivered**. The new callback makes delivery statuses inspectable and handles a status arriving before the sender has saved its message ID.

## Route and secrets
- Meta callback URL (after approved Worker deployment): `https://rainbow-api.jofalin2005.workers.dev/api/whatsapp/status`.
- Configure `WHATSAPP_WEBHOOK_VERIFY_TOKEN` to a strong unique, non-public shared token in the Meta app and Worker secret store. GET verification requires the exact token and returns only the numeric Meta challenge.
- Configure `WHATSAPP_APP_SECRET` to the Meta app's secret. POST callbacks require a valid `X-Hub-Signature-256` HMAC SHA-256 over the raw body.
- Existing `WHATSAPP_PHONE_NUMBER_ID` is used to filter status events to the registered sender. It is **not** a telephone number.
- Existing Supabase URL and service-role key are needed only inside the Worker to record updates.
- Subscribe to the WhatsApp `messages` webhook field to receive status arrays. Test the sender using an explicitly consented recipient.

## Security and behavior
- Unsigned callbacks do nothing. No browser endpoint accepts phone numbers, customer details or invoice URLs.
- The worker accepts only Meta statuses `sent`, `delivered`, `read`, and `failed`. Failed deliveries are marked failed without storing customer-facing error strings.
- A service-role-only database RPC stores the provider message ID and latest status; out-of-order events cannot overwrite newer status timestamps. A pre-ack status is staged in a private table and applied once the provider ID is attached to the invoice notification.
- Audit only provider acknowledgment and delivery status, never print access tokens, recipient addresses or invoice URLs to logs.
- An event recorded as `sent` does not mean delivered. `delivered` and `read` require verified Meta callbacks.
- Status events are not payment or stock events. They do not charge, refund, restock or resend anything.

## Tests and release
Run Cloudflare Worker unit tests and the disposable PostgreSQL status workflow. Review retention of provider-message-ID-only inbox entries, set Meta verify token and secret, and validate signed callbacks in test mode. Deploy the Worker route and migration together only with explicit approval.

This code is staged only. Without an approved Meta app, verified sender, approved utility invoice template and customer opt-in, it cannot demonstrate real WhatsApp delivery.
