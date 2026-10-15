# Storefront refinements and optional staff face preview

These changes use the existing Rainbow Gold Covering repository and Supabase database.

## Storefront

- **Header:** Cart moved immediately after the customer account button. The redundant Professional Couriers tracking icon was removed from the header; tracking remains in the existing customer/account and navigation flows.
- **Menu:** Larger hamburger button, consistent font in quick links, and genuine product-image thumbnails for available product categories. Categories without an image show a neutral symbol instead of generic photography.
- **Checkout:** Responsive navigation layout with centered brand and aligned links/actions.
- **Promotional carousel:** Uses the administrator's saved product selection/order in `storefront_promotion_items` and rotates every five seconds when two or more eligible product images are selected. The display is image-only.
- **Product gallery:** Tap a thumbnail or swipe left/right on a mobile device to see the next real product photo. Advance after 10 seconds if the user isn't interacting and hasn't requested reduced motion.
- **Product help:** Contact Rainbow opens a `wa.me` URL with that product's name and code prefilled. It is shown below Product details. Opening WhatsApp does not send the message automatically.

**Current storefront setup:** Only one product was selected for the banner at the time of development. Admins can add/reorder more under **Dashboard → Rotating promotional images** to enable rotation.

## Optional experimental face preview

An optional on-device preview is shown inside employee **My Attendance**. It uses a pinned Human JS library and a privately stored reference photo; it requests browser camera permission only when employees explicitly start a test. A staff member must consent, and consent is persisted and can be withdrawn by unticking the option. No face image or descriptor is intentionally uploaded or retained by this preview.

**This is NOT payroll-grade biometric verification.** A browser-only result is not trusted to record attendance. Existing **Check in** and **Check out** buttons and their authenticated database RPC remain authoritative. Employees can use those buttons without facial verification. Admins do not personally check in.

### Shop-owner actions

1. As admin, open **Staff** and provide a clear reference photo for each staff member who has agreed to participate. Stored path: `staff-private/profiles/<user_id>/reference`; no reference photos existed in the bucket at the time of development.
2. Staff open **My Attendance**, read the privacy notice, opt in once, and click **Verify face (preview)**. A browser may ask for camera permission. Do not attempt to bypass browser permission prompts.
3. Staff use ordinary attendance buttons regardless of a failed/unavailable face preview. Withdraw consent in the same card when desired.
4. To use actual biometric-gated attendance, first commission trusted liveness/identity verification, biometric privacy/retention controls, and independent security testing. Do not enable authoritative recording based solely on browser code.

## Delivery, tests and limits

- Supabase migration `supabase/migrations/20261015195500_optional_staff_face_preview_consent.sql` adds consent records and a narrow policy letting consenting active non-admin employees read only their own enrolled reference photo.
- Updated: `index.html`, `content.js`, `content.css`, `order.html`, `order.css`, `admin/my-attendance.html`, `admin/my-attendance.css`.
- Added: `admin/face-preview.mjs`.
- Tests: `tests/unit/storefrontInteractionsFacePreview.test.mjs`, updated `tests/unit/simpleAttendance.test.mjs` and `tests/e2e/selenium/tests/public.test.mjs`.
- GitHub CI runs unit tests, lint, static validation and security checks. Isolated Selenium and Supabase integration stages are disabled until their test environment is configured.
- No real camera, swipe, WhatsApp app, or staff enrollment session was exercised as part of this change. Perform an authorized mobile/browser acceptance test before depending on those features.
