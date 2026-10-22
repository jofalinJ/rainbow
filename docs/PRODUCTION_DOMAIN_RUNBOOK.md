# Rainbow production domain rollout

## Architecture and verified starting state

Preserve the existing static HTML/CSS/JavaScript storefront on GitHub Pages,
Supabase database/Auth/Edge Functions, and `rainbow-api` Cloudflare Worker.
Hostinger supplies registration and authoritative DNS. No additional hosting
purchase is needed.

The 22 October 2026 resumption audit found the domain registration active,
expiring on 18 October 2027, with nameservers `horizon.dns-parking.com` and
`orbit.dns-parking.com`. The apex serves the existing website over valid HTTPS
from GitHub Pages. The repository's `CNAME` already names the apex. Although
`build:pages` can prepare a Cloudflare Pages artifact, it does not establish
production hosting on Cloudflare Pages.

The same starting-state audit found a certificate hostname mismatch at `www`,
HTTP redirects that did not enforce HTTPS, and no DNS answer for `api`.
Recheck these after configuration changes and record final results separately.
Apex HTTPS success does not verify either other hostname.

| Address | Intended destination |
| --- | --- |
| `https://rainbowgoldcovering.com` | Existing GitHub Pages storefront at site root |
| `https://www.rainbowgoldcovering.com` | GitHub Pages HTTPS redirect to the apex |
| `https://rainbowgoldcovering.com/staff/` | Existing `/admin/login.html` |
| `https://api.rainbowgoldcovering.com` | Existing Worker after hostname binding is verified |

Public configuration identifies the existing Worker as
`https://rainbow-api.jofalin2005.workers.dev`. Verify that actual deployment
before routing a custom hostname. Its current source implements health,
Razorpay TEST checkout/verification/webhooks, and an opt-in WhatsApp invoice
outbox. Most catalogue, staff, billing and order permissions remain in Supabase.
Health alone does not establish database or payment-provider readiness.

## DNS, TLS and cutover

The 22 October authoritative DNS snapshot contained these traffic records:

| Type | Name | Value |
| --- | --- | --- |
| A | `@` | `185.199.108.153` |
| A | `@` | `185.199.109.153` |
| A | `@` | `185.199.110.153` |
| A | `@` | `185.199.111.153` |
| CNAME | `www` | `jofalinj.github.io` |

Read the complete authoritative zone and save a rollback snapshot before any
change. Preserve mail, TXT ownership verification, CAA and unrelated records.
Keep nameservers unless a separately verified architecture requires a change.
Do not reset the zone or purchase a service for this rollout.

Verify the Pages custom domain, DNS checks, certificate coverage and **Enforce
HTTPS**. Repair `www` certificate provisioning before claiming its redirect
works. Recheck hostname validation and HTTP/HTTPS redirect chains. An accepted
settings response does not establish a working certificate. If GitHub requests
account domain verification, use the exact TXT challenge issued for `jofalinJ`
and retain it. Avoid wildcard DNS and `/rainbow` in CNAME values.

At resumption, GitHub Pages reported `https_enforced=false` and its certificate
state `dns_changed`, with only the apex listed. The connected token's attempt to
enable HTTPS returned HTTP 403, `Resource not accessible by personal access
token`. Repair requires suitable Pages settings access. Preserve the current
custom domain rather than removing/readding it and interrupting the live site.

The Worker read-only health, public payment config and provider check succeeded
for TEST mode with release `paid-invoice-20261021-v4`. The apex Origin was allowed
by CORS; an unknown origin received no access-control allowance. This does not
verify the missing custom API hostname or authorize a payment test.

For `api`, verify the Worker account/deployment, HTTPS and read-only endpoints.
Bind the hostname using Cloudflare's supported custom-domain or routed-zone
procedure for the actual DNS setup. An arbitrary CNAME to a `workers.dev` host
does not configure its custom certificate or routing. Keep the working
`workers.dev` URL in browser config until the custom endpoint is proven. Do not
create an unbound API record or interrupt the working backend.

## Configuration and secrets

`admin/config.js` contains public Supabase settings, `config.js` public business
details, and `payment-config.js` the public HTTPS Worker URL. Public Supabase
keys require correct RLS and RPC authorization. Privileged credentials must
remain in platform secret stores.

Current Worker source reads these server settings:

- Secrets: `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`,
  `SUPABASE_SERVICE_ROLE_KEY`.
- Payment config: `SUPABASE_URL`, TEST `RAZORPAY_KEY_ID`, `PAYMENTS_ENABLED`,
  optional `PAYMENTS_SUSPENDED`, and exact `ALLOWED_ORIGINS`.
- Binding: `CHECKOUT_RATE_LIMITER`. `wrangler.jsonc` enables `keep_vars` to
  preserve dashboard variables.
- Optional WhatsApp secrets: `WHATSAPP_ACCESS_TOKEN`,
  `WHATSAPP_PHONE_NUMBER_ID`. Sending also requires `WHATSAPP_SEND_ENABLED`,
  `WHATSAPP_TEMPLATE_NAME`, and `WHATSAPP_TEST_RECIPIENT_ALLOWLIST`; optional
  `WHATSAPP_TEMPLATE_LANGUAGE` and `WHATSAPP_GRAPH_VERSION`.

Read secret presence without exposing values. Preserve Supabase Edge Function
secrets and endpoints; the Worker does not replace them. The WhatsApp bill
function's `APP_PUBLIC_URL` must use the intended HTTPS storefront when enabled.
Keep WhatsApp sending disabled until explicitly configured and verified for
consenting allowlisted test recipients.

The storefront offers manual UPI and Razorpay **TEST** mode. Manual UPI orders
remain pending until staff verification. The browser enables Razorpay only
after the Worker verifies the TEST credential pair with the provider. Never add
live payment credentials to this TEST-only Worker. Readiness probes do not
establish capture, invoice generation, refunds or WhatsApp delivery. See the
existing Razorpay and paid-order runbooks for those workflows.

Review Supabase Auth's site URL and exact HTTPS callback allowlist while
preserving working redirects. Avoid wildcard callbacks.

## Security readiness gate

Complete authorization, customer ownership and reservation-abuse checks in an
isolated environment before declaring production readiness. Keep unresolved
audit details in the private operational report. RLS being enabled does not
establish complete authorization security.

## Publishing and verification

Use a deployment branch based on current production, preserving unrelated work.
Run `npm ci --legacy-peer-deps`, lint, unit tests, static/build checks, dependency
audit, Worker checks/tests and public browser smoke tests. Review the final diff
and CI before merge. The static artifact includes `staff/` and `robots.txt`
while excluding backend code, Supabase resources, operational docs and tests.

The bootstrap-policy regression runs only in disposable PGlite, verifying
customer denial and legitimate administrator/service-role provisioning. Check
live migration history before any schema action. Do not replay migrations or
write production records to run tests.

The `/staff/` entry grants no session or role. Staff PWA/service-worker scope
stays under `/admin/`. A new origin requires signing in and reinstalling the PWA
from that origin. Check manifest/install behavior, offline warnings and logout
cleanup; never cache sensitive customer, invoice or account responses.

After release, verify apex and `www` DNS/certificates/redirects; homepage,
catalogue/images/search, standalone product pages, cart, login and staff guards;
browser errors and failed requests; read-only Worker health, payment readiness
and Supabase connectivity. Verify the API custom domain separately if configured.

Authenticated order tracking, inventory edits, staff/customer management,
billing, invoice/printing, attendance and payment transactions require an
isolated test environment or separately authorized business transaction. Do not
add test users, products, orders or transactions to production. Label unavailable
checks unverified. Viewport emulation does not establish physical Android/iOS,
tablet, camera, printer or PWA compatibility.

On failure restore only reviewed frontend/settings/DNS changes from the saved
snapshot. Preserve the working database and backend services.

References:

- [GitHub Pages custom domains](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site)
- [GitHub Pages ownership verification](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/verifying-your-custom-domain-for-github-pages)
- [Cloudflare Worker custom domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)
