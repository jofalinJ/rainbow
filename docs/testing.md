# Automated Testing

## Existing baseline

The repository is a plain HTML/CSS/JavaScript static site backed by Supabase. Before this integration there was no package manager, test runner, build system, or GitHub Actions workflow.

The testing layer is additive. Existing GitHub Pages deployment remains unchanged.

## Test layers

- Unit: Vitest for shared domain rules used by the application.
- Integration: Vitest + Supabase against an isolated non-production database.
- Browser E2E: Selenium WebDriver + Chrome with Page Objects.
- Static build verification: required files, local assets, and obvious secret detection.
- Security: npm audit in CI.

## Commands

`npm install`

`npm run lint`

`npm run build`

`npm run test:unit`

`npm run test:integration`

`npm run test:e2e`

`npm test` runs unit + integration.

`npm run test:all` runs unit + integration + Selenium E2E.

`npm run test:coverage` produces domain-layer coverage.

## Isolated integration environment

Never point integration tests at production.

Set `SUPABASE_TEST_URL` and `SUPABASE_TEST_SERVICE_ROLE_KEY` for integration tests. Set `SUPABASE_TEST_PUBLISHABLE_KEY` when running the static site against the test database.

The integration suite refuses the current production Supabase URL and cleans up its temporary records.

A Supabase development branch is the preferred test database because it is isolated from production. Provisioning that branch is intentionally outside CI until its lifecycle and cost are explicitly approved.

## Authenticated Selenium

Set `E2E_ENABLED=true`, `E2E_ISOLATED_ENV=true`, `E2E_ADMIN_USERNAME`, `E2E_ADMIN_PASSWORD`, and `E2E_BASE_URL`.

Authenticated E2E must run only against an isolated environment.

For a local test deployment, use `node scripts/write-test-config.mjs`, then start `node scripts/static-server.mjs` and run `npm run test:e2e`.

## CI

GitHub Actions runs lint, unit tests, static build verification, and dependency security checks on every push and pull request.

Integration and authenticated E2E jobs are provisioned but gated by repository variables until an isolated Supabase test environment and test credentials are configured.

## Current limitations

The application does not yet contain the order, billing, payment, return, or atomic inventory-deduction service layers, so those workflows are not fabricated as passing tests. Tests will be added when those domains are implemented.

The current application is plain JavaScript, so an artificial TypeScript type-checking layer was not introduced. Syntax and static build verification are used instead.

Branch protection should eventually require the CI checks before merging.
