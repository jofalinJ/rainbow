# Rainbow staff offline cash billing — operating procedure

## Preparing a device while online

1. **Admin only:** Sign in to the existing Staff Billing page with an active **admin** account.
2. Choose the physical shop for the tablet. Check that the product and branch stock data are current.
3. Select **Prepare / refresh offline billing**. Create and confirm a strong **shared shop-device passcode** with at least 10 characters. Do not reuse an account password. If the device already has an encrypted vault, the admin must enter its existing code to refresh the catalogue. A prepared browser/device supports **one branch at a time**; existing encrypted pending sales must never be wiped during staff handovers.
4. Open **Offline Billing** on the same tablet/browser, verify the saved catalogue and stock, then give the passcode **only to authorized shop staff**. The code is **not shared between devices**: each shop tablet must be prepared by an admin while connected.
5. Staff can open that already-installed offline billing page later without an internet connection or online login. Keep the browser/app open and unlocked if you want automatic synchronization when connectivity returns.

The service worker precaches a standalone offline interface. Product/stock snapshots and cash-record queue are **encrypted locally** via IndexedDB, not stored in the browser's plain localStorage. Supabase credentials are not cached by the service worker. The browser must support HTTPS service workers, IndexedDB, and Web Crypto.

**Practical safeguards:** Use one designated offline billing tablet per branch, keep it physically locked when not in use, avoid incognito/private mode, never clear the app's site data while transactions are pending, keep its passphrase safely, and reconnect to synchronize regularly. Browser storage may be evicted by the operating system; a pending record is not a substitute for regular online synchronization or shop reconciliation.

## When internet goes down

1. Open **Offline Billing** (the Billing navigation fallback also offers this screen) on the **same prepared device/browser**. Enter the **admin-created shared shop passcode**. Individual online staff login is **not required to unlock while disconnected**.
2. Search or type/scan a barcode using a USB/Bluetooth keyboard scanner. Products and visible availability come from the last prepared snapshot minus unsynced sales from **this device**. Live stock from other devices or shops is unknown.
3. Enter the staff member's **self-reported name or ID** for the provisional record. Add products, verify the *estimated* discounted price and tax, collect cash and select **I confirm cash has been received**.
4. Choose **Save offline cash record**. The record is encrypted locally and a provisional receipt can be printed. It is clearly marked **PENDING SYNC — NOT A TAX INVOICE**; the customer does **not** yet have a confirmed GST invoice.
5. The cash queue continues to work while offline for up to **24 hours after the last online refresh**. If the access window expires, reconnect and refresh the device before creating further records.

**Only confirmed cash sales can be recorded in this offline mode.** Card, UPI, bank transfer and Razorpay verification must be performed online; they are not marked paid based on a device-local record.

## Synchronizing after reconnect

When the offline page remains **open and unlocked**, it automatically retries queued cash records on network restoration, browser re-visibility and every 30 seconds. You can also press **Sync pending sales now**. A browser that's closed or an offline vault that's locked cannot synchronize automatically, because the app intentionally does **not** persist its encryption key.

Synchronization of **new shared-passcode records** requires **any currently signed-in, active admin or authorized cashier assigned to that branch**. The first permitted online account that attempts to synchronize a record is **pinned** to that record because the existing server RPC also binds its idempotency UUID to the original online actor. If the connection drops mid-sync, **the same signed-in account must finish retrying that individual record** to prevent duplicates. The current app pauses a record when a different account tries to resubmit it rather than marking it paid or issuing a second invoice. Records created before this shared-passcode upgrade retain their original creator-account restriction.

Each sale retains its stable UUID as the `p_request` argument to `erp_create_local_sale`. Supabase checks current product prices and available branch stock, generates the official invoice, records the cash payment and deducts stock **atomically**. Repeating the same request ID under the same authorized account cannot issue a second invoice. Successfully synchronized records show the real invoice number and link.

The provisional receipt shows the **self-reported offline staff name**; the final server invoice/audit actor is the **authenticated staff member who synchronized the sale**. A shared offline passcode does **not** cryptographically identify which individual used the device.

If the server rejects a record because of changed pricing, insufficient stock or lost permissions, the record remains **NEEDS OWNER REVIEW**. The client does not silently issue an invoice, overwrite the product price or invent stock. The owner must reconcile the cash, product and location. Do not retry by making a new sale for the same cash transaction.

## Limitations before using it for a busy store

- A last-known stock snapshot is not a guaranteed reservation. **Two disconnected devices can sell the same last item**. Use one offline device per shop, or implement a server-reserved per-device stock allocation before expanding offline billing to multiple tablets.
- The local queue is encrypted, but the shared passcode allows **any holder of that code with access to the prepared device** to view saved products and use offline cash billing. Keep the device locked, share the code only with authorized staff and update store procedures immediately if a code is exposed. Offline mode cannot check live role revocations; offline access expires after 24 hours without an admin/device refresh.
- PIN/district lookup and photo updates require internet. Manual customer name and phone entries can be saved in the encrypted offline cash record.
- Physical printer support depends on the tablet, OS/browser and connected print service. The printable provisional receipt is not a GST tax invoice. Final invoices are only available after server synchronization.
- No background syncing happens while the app is closed/locked; open and unlock to resume. If a different staff member is signed in from the one who started syncing a particular sale, sign in with the original synchronizing account to resume it. Do not clear local site data with pending sales.
- The passcode is stored **only as the key to encrypted local data** on this prepared browser/device. Provisioning is restricted to verified admins in the official UI, but no local-only offline system can remotely enforce staff revocation when disconnected. Keep an owner reconciliation procedure.

## Release validation

Automated tests cover cache allowlisting, stock/price guards, cash-only restrictions, stable request UUIDs, network retry vs. owner review, storage encryption checks and a local Chromium offline navigation + persistent queue fixture. A real Android tablet/PWA/printer connectivity test and an isolated Supabase integration test must still be completed before relying on this for business-critical outages. New browser tests also check that cashier setup is denied while admin provisioning succeeds and that shared-code staff sales survive offline reloads.
