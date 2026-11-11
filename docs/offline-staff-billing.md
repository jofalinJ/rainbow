# Rainbow staff offline cash billing — operating procedure

## Preparing a device while online

1. Sign in to the existing Staff Billing page as the owner or an authorized cashier.
2. Choose the physical shop for that tablet. Check that the product and branch stock data are current.
3. Select **Prepare / refresh offline billing**. Set a distinct offline passphrase of at least 10 characters and confirm it. Do not use the staff account password. If a device already has a vault, enter its existing offline passphrase to refresh it. A device can have **only one staff account and branch** enrolled at a time.
4. Open **Offline Billing** from that page, unlock it with the offline passphrase, and verify product codes and available stock. Keep the browser/app open and unlocked if you want automatic synchronization when connectivity returns.

The service worker precaches a standalone offline interface. Product/stock snapshots and cash-record queue are **encrypted locally** via IndexedDB, not stored in the browser's plain localStorage. Supabase credentials are not cached by the service worker. The browser must support HTTPS service workers, IndexedDB, and Web Crypto.

**Practical safeguards:** Use one designated offline billing tablet per branch, keep it physically locked when not in use, avoid incognito/private mode, never clear the app's site data while transactions are pending, keep its passphrase safely, and reconnect to synchronize regularly. Browser storage may be evicted by the operating system; a pending record is not a substitute for regular online synchronization or shop reconciliation.

## When internet goes down

1. Navigate to **Offline Billing** (the Billing navigation fallback also opens this screen). Enter the offline-device passphrase.
2. Search or type/scan a barcode using a USB/Bluetooth keyboard scanner. Products and visible availability come from the last prepared snapshot minus unsynced sales from **this device**. Live stock from other devices or shops is unknown.
3. Add products, verify the *estimated* discounted price and tax, and select **I confirm cash has been received**.
4. Choose **Save offline cash record**. The record is encrypted locally and a provisional receipt can be printed. It is clearly marked **PENDING SYNC — NOT A TAX INVOICE**; the customer does **not** yet have a confirmed GST invoice.
5. The cash queue continues to work while offline for up to **24 hours after the last online refresh**. If the access window expires, reconnect and refresh the device before creating further records.

**Only confirmed cash sales can be recorded in this offline mode.** Card, UPI, bank transfer and Razorpay verification must be performed online; they are not marked paid based on a device-local record.

## Synchronizing after reconnect

When the offline page remains **open and unlocked**, it automatically retries queued cash records on network restoration, browser re-visibility and every 30 seconds. You can also press **Sync pending sales now**. A browser that's closed or an offline vault that's locked cannot synchronize automatically, because the app intentionally does **not** persist its encryption key.

Synchronization requires the original signed-in staff account to still have active billing permission for the same branch. Each sale retains its stable UUID as the `p_request` argument to `erp_create_local_sale`. Supabase checks current product prices and available branch stock, generates the official invoice, records the cash payment and deducts stock **atomically**. Repeating the same request ID cannot issue a second invoice. Successfully synchronized records show the real invoice number and link.

If the server rejects a record because of changed pricing, insufficient stock or lost permissions, the record remains **NEEDS OWNER REVIEW**. The client does not silently issue an invoice, overwrite the product price or invent stock. The owner must reconcile the cash, product and location. Do not retry by making a new sale for the same cash transaction.

## Limitations before using it for a busy store

- A last-known stock snapshot is not a guaranteed reservation. **Two disconnected devices can sell the same last item**. Use one offline device per shop, or implement a server-reserved per-device stock allocation before expanding offline billing to multiple tablets.
- The local queue is encrypted, but remote account revocation cannot be enforced until reconnect; offline access automatically expires after the prepared window.
- PIN/district lookup and photo updates require internet. Manual customer name and phone entries can be saved in the encrypted offline cash record.
- Physical printer support depends on the tablet, OS/browser and connected print service. The printable provisional receipt is not a GST tax invoice. Final invoices are only available after server synchronization.
- No background syncing happens while the app is closed/locked; open and unlock to resume.

## Release validation

Automated tests cover cache allowlisting, stock/price guards, cash-only restrictions, stable request UUIDs, network retry vs. owner review, storage encryption checks and a local Chromium offline navigation + persistent queue fixture. A real Android tablet/PWA/printer connectivity test and an isolated Supabase integration test must still be completed before relying on this for business-critical outages.
