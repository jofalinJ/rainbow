# Automated Testing

## Test layers

- **Unit:** Vitest for domain rules.
- **Integration:** Vitest + Supabase against a dedicated non-production database.
- **Public browser E2E:** Selenium + Chrome against the deployed customer site. This is now run automatically by a separate workflow after a successful GitHub Pages deployment.
- **Authenticated browser E2E:** Selenium + Chrome against a dedicated test Supabase environment. This remains gated because it requires private test credentials and must never touch production.
- **Static build verification:** required files, local assets and obvious secret detection.
- **Security:** npm audit in CI.

## Commands

`npm install`
`npm run lint`
`npm run build`
`npm run test:unit`
`npm run test:integration`
`npm run test:e2e:public`
`npm run test:e2e:authenticated`
`npm run test:e2e`

## Why authenticated tests are still gated

Authenticated integration/E2E tests need an isolated Supabase project plus test credentials. They must not use the production database. GitHub environment secrets are therefore required before those tests can safely run.

The public browser suite does **not** need private credentials. It now runs automatically after a successful deployment, so the browser layer is no longer entirely conditional.

## Required test environment

Create a GitHub environment named `test` and add:

- `SUPABASE_TEST_URL`
- `SUPABASE_TEST_SERVICE_ROLE_KEY`
- `SUPABASE_TEST_PUBLISHABLE_KEY`
- `E2E_ADMIN_USERNAME`
- `E2E_ADMIN_PASSWORD`
- optional `BILL_E2E_TOKEN`

Then set repository/environment variables:

- `RAINBOW_TEST_ENV_READY=true`
- `RAINBOW_E2E_READY=true`

The integration and authenticated E2E workflows reject the production Supabase URL.

## CI policy

- Every push to `main`: quality, unit, static-build and security checks.
- Every pull request: quality, unit, static-build and security checks.
- Every successful GitHub Pages deployment: public Selenium smoke tests.
- When the isolated test environment is configured: Supabase integration + authenticated Selenium E2E.
- Selenium failures upload screenshots/logs.
- Authenticated tests never silently fall back to production.
