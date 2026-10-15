# Professional Couriers tracking & WhatsApp — Rainbow Gold Covering

## Admin setup (no paid services or credentials required)
1. Sign in using an active **admin** account, open **Orders**.
2. Confirm payment received using the existing payment-verification workflow.
3. Click **Manage Shipment** on that order. Customer name, WhatsApp number, order number and delivery address come from the existing database.
4. Select **Packed** while preparing the parcel. After handing it to **The Professional Couriers**, enter the actual consignment/AWB number, dispatch date and **Shipped** status; select **Save Shipment**.
5. Review the saved, read-only WhatsApp message preview. Click **Send Tracking Details**; WhatsApp Web or the app opens with the correct normalized Indian number and prefilled tracking message. **This does not send automatically.**
6. Send the message manually. Return to the Orders editor, click **Confirm I sent it** and confirm the prompt. Supabase records the administrator's user ID and confirmation timestamp. **This is a manual attestation, not proof of delivery.**
7. The editor disables further tracking-message launches for that consignment after manual confirmation. If the AWB changes legitimately, the corrected AWB can be shared and confirmed separately, with previous history retained.
8. Update **In transit**, **Out for delivery**, **Delivered** or **Delivery issue** manually as appropriate. These are staff-entered, **not live courier statuses**.

## Customer tracking
- Signed-in customers open the existing **Account → My Orders** panel. It uses `track_my_order_shipments()` and only returns online orders matching their authenticated account email.
- Guest orders still require a matching ordered product code and full phone number. The new `track_guest_order_shipments()` returns no customer phone number, name or address.
- The five milestones are: **Order Placed → Confirmed → Packed → Shipped → Delivered**.
- When an AWB has been saved, customers see the courier name, AWB, dispatch date, **latest staff-recorded status**, and [The Professional Couriers website](https://www.tpcindia.com/default.aspx).
- The courier website link is not tied to a verified live-tracking API. Customers enter their consignment number on the official site.

## Database and security
Migration: `supabase/migrations/20261015193000_professional_couriers_tracking.sql` (applied to Rainbow Supabase).
- `order_shipments`: **one row per order** (unique FK), consignment (also unique), manual status, dispatch date, creator/updater and timestamps.
- `shipment_events`: append-only trigger-maintained audit log of shipment changes and actor.
- `shipment_notifications`: separate manually confirmed notification history, unique for each shipment/AWB, with actor and timestamp.
- Tables permit authenticated SELECT **only to active admins** via RLS; no browser role has direct table writes. Only admin-guarded SECURITY DEFINER functions save a shipment or record confirmation.
- Customer data is exposed only through narrow security-definer tracking functions, not through public table grants.
- Only **paid online orders** may be dispatched. Cancelled/refunded orders are rejected.
- No new WhatsApp API, courier API, billing update, payment processing or invoice logic was introduced. Existing orders and stock are untouched.

## Validation
- Unit tests: `tests/unit/shipmentTracking.test.mjs`, including phone normalization, content and encoding, missing AWBs/phone numbers, duplicate-notification guards, milestones and database policy contracts.
- Selenium (isolated test environment): admin modal, per-order details and narrow viewport at 430px.
- CI: lint, unit, static verification and security audit on each main push. Integration and authenticated browser suites need their existing isolated test environment enabled.
- Real-world acceptance remains necessary: save one genuine paid test shipment, open WhatsApp, verify recipient/AWB, confirm manually, and verify the customer's order timeline. Do not test with live customer messages without approval.

## Operational note
WhatsApp browser launches can be blocked by pop-up settings. Use the **Copy message** fallback. A record marked manually confirmed should never be interpreted as WhatsApp delivery confirmation. If the customer's WhatsApp number is missing/invalid or a shipment has not yet been dispatched, the Send Tracking Details control remains disabled.
