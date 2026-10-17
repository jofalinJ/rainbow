# Rainbow Gold Covering — Cloudflare API

A deliberately small, separately deployable Cloudflare Worker. Its Cloudflare project name **must** be `rainbow-api` to match the Worker already created in the dashboard.

## Implemented now

- `GET /` and `GET /api/health`: non-sensitive JSON health check, same fields as the manually deployed Worker.
- `HEAD /` and `HEAD /api/health`: successful health probe without a body.
- All other paths: HTTP 404. Unauthorized or unimplemented business APIs are **not exposed**.
- No third-party secrets are needed and no production payment, stock, WhatsApp or staff data is accessed.

## Relationship with the existing project

The root of this repository is the existing static shop website and admin UI. The database, roles, billing logic and WhatsApp invoicing already have Supabase code under `supabase/`. **Do not deploy the repository root as this Worker.** Do not migrate the existing WhatsApp function or enable Razorpay here until its final backend owner is explicitly chosen; duplicate payment and messaging implementations invite inconsistent records.

## Local developer commands

From `backend/rainbow-api`:

```sh
npm install
npm run check
npm test
npm run dev
```

Do not run `npm run deploy` until the deployment configuration has been reviewed. `wrangler dev` is local; `wrangler deploy` updates the named Cloudflare Worker.

## Cloudflare Git connection — after branch review and merge

Cloudflare dashboard → Workers & Pages → **rainbow-api** → Settings → Builds → Connect.

- Repository: `jofalinJ/rainbow`
- Production branch: `main` (only after merging the reviewed Worker folder)
- **Root directory: `backend/rainbow-api`** (required for this monorepo)
- Build command: `npm run check && npm test`
- Deploy command: `npx wrangler deploy`
- Preview command: `npx wrangler preview` when preview builds are enabled
- Optionally configure **watch paths** to include `backend/rainbow-api/**` only, so unrelated storefront changes do not trigger Worker deployments.

The Wrangler `name` is `rainbow-api`, matching the dashboard deployment. Keep builds disconnected until the reviewed branch is ready; connecting the repository root without the right root directory can deploy the wrong code.

## API secrets

Cloudflare Worker → Settings → Variables and Secrets → Add variable → mark **Secret**.
Only set **real test credentials** when an integration is implemented, never placeholders or live merchant credentials during testing.

- Razorpay (if payment processing is moved to this Worker): `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`.
- WhatsApp (if the existing Supabase sending function is deliberately migrated): `WHATSAPP_ACCESS_TOKEN` plus the provider's sender settings.
- Supabase privileged key (only if the Worker truly needs it): `SUPABASE_SECRET_KEY`; never put it in frontend config.

Runtime secrets are different from build-time secrets. Keep real values out of the repository, Worker logs, screenshots, and preview environments. If a provider is still handled by Supabase Edge Functions, its secret **stays in Supabase**.

## Security requirements before adding routes

Require authenticated customer/staff identity; authorize actions on the server; never trust browser-supplied prices; verify Razorpay/Meta webhooks against their signatures and raw request payloads; use idempotency for payments and stock writes; configure narrow origin allowlists if browser CORS is needed; rate-limit abuse; and return generic errors without leaking secrets. The public health endpoint is **not** a substitute for these protections.
