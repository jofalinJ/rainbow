# WhatsApp bill PDF integration

## What the app now does

1. Bills are rendered with the shared `invoice-template.js` + `invoice-template.css`.
2. `html2canvas` captures the rendered bill DOM.
3. `jsPDF` places that captured bill image into an 80 mm PDF.
4. The authenticated admin/cashier sends the PDF to the Supabase Edge Function `send-whatsapp-bill`.
5. The Edge Function verifies the staff session, resolves the invoice/customer from the database, uploads the PDF to WhatsApp Cloud API, sends it as a document, and records delivery status in `whatsapp_notifications`.

## Supabase Edge Function secrets

Set these in Supabase Edge Function Secrets. Never put them in `admin/config.js` or browser JavaScript.

```
WHATSAPP_ACCESS_TOKEN=<Meta user/system access token>
WHATSAPP_PHONE_NUMBER_ID=<registered WhatsApp phone number ID>
WHATSAPP_GRAPH_VERSION=<your current Meta Graph API version>
APP_PUBLIC_URL=https://jofalinj.github.io/rainbow
```

Optional for reliable business-initiated messages outside the 24-hour customer-care window:

```
WHATSAPP_TEMPLATE_NAME=<approved utility template name>
WHATSAPP_TEMPLATE_LANGUAGE=en_US
```

The template should have a document header and no body variables, or the Edge Function must be extended to match the template's variables.

## Meta WhatsApp setup

1. Create/use a Meta Business account and a WhatsApp Business Account.
2. Add the WhatsApp Business Platform / Cloud API product.
3. Register the business phone number.
4. Create a production access token with `whatsapp_business_messaging`.
5. Copy the registered phone number ID.
6. Create and approve a UTILITY message template with a document header for messages that can be sent outside the customer-care window.
7. Put the credentials in Supabase Edge Function Secrets.
8. Test with a real customer number after the Meta sender is fully approved.

Meta's official WhatsApp Business Platform collection uses the `/{{Phone-Number-ID}}/messages` endpoint for text, media and templates and requires a user access token with the `whatsapp_business_messaging` permission.

## Browser fallback

When direct API sending is not configured, the app should not expose credentials. The existing standard WhatsApp link remains available for a manual one-click message containing the bill link.

## Security

The browser only receives the Supabase publishable key. WhatsApp access tokens stay inside the Edge Function. Supabase documents storing third-party API credentials as Edge Function secrets and keeping secret keys out of browser code.

## Test configuration

Authenticated Selenium tests are intentionally gated behind an isolated test environment. Production billing data is not used as the E2E test database.
