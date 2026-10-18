# Verified staff attendance

**Update — self-hosted option:** The default provider is now the self-hosted OpenCV/MiniFASNet service. It requires no AWS account or AWS face API fees. Follow [the self-hosted setup and pilot guide](SELF_HOSTED_BIOMETRICS.md). AWS remains an optional provider selected with `BIOMETRIC_PROVIDER=aws`; AWS-specific provisioning and data-processing details below apply only to that option.

This change extends the existing vanilla JavaScript site, Supabase staff accounts, and `attendance` table. It is **not production-ready until the configured provider, retention scheduler and real-device pilot have been validated**. No live deployment or live employee enrollment was performed during implementation.

## What changed

- `admin/my-attendance.html`, `.js`, `.css`: red, white and gold tablet interface, signed-in employee identity, IST clock, live check-in and check-out, overnight open shifts, monthly personal history and clear failure states.
- `admin/attendance.html`, `.js`, `.css`: existing daily/week/month attendance management, employee IDs, verification method/results, manual corrections, historic photo review, enrollment and audit history.
- `admin/biometric-ui.mjs`: authenticated service calls, privacy notice, camera lifecycle/error/cancel handling; no biometric web storage.
- `src/biometrics/face-liveness.jsx`, `dist/face-liveness.*`, build script: pinned AWS Amplify camera/liveness component mounted inside the existing pages. The remainder of the site remains vanilla JavaScript. Committed generated assets support the existing static hosting flow.
- `supabase/functions/face-attendance/`: active-account authorization, provider integration, encrypted collection references, enrollment and verification orchestration.
- `supabase/functions/face-attendance-retention/`: authenticated scheduled provider deletion, expired-template cleanup and one-day session cleanup.
- `supabase/functions/delete-staff-user/index.ts`: requires template deletion before deleting an enrolled employee account.
- Database migration, backend/UI tests, isolated PostgreSQL tests, dependency lockfiles and CI checks.

## Architecture and trust boundary

Staff continue to sign in using their existing Supabase account. The employee ID on My Attendance is their authenticated `staff_profiles.user_id`; employees cannot select another person's account. Administrators select employees only for supervised enrollment and authorized corrections. An unlocked shared tablet is insufficient: staff must sign in themselves and pass the face/liveness checks for every punch. Sign out between employees.

The Edge Function validates the access token using Supabase Auth and reads the current active profile/role. It reserves an attempt in the database **before** creating an AWS session. The browser receives a three-minute liveness session and temporary STS credentials restricted to `rekognition:StartFaceLivenessSession`. STS credentials have AWS's minimum 900-second duration and remain in memory. The browser has no create/results/search/index/delete permission.

The completion callback is only a request to the server. The server retrieves the stored AWS session's result itself, requires `SUCCEEDED`, liveness confidence >=95, exactly one high-quality unobscured reference face, and a match similarity >=99. These thresholds are initial acceptance policies, **not accuracy percentages or validated operating points**. Calibrate them on the intended staff/tablets/lighting before approving real use.

Each employee/enrollment generation has a separate opaque AWS collection containing only that person's accepted live samples. `SearchFacesByImage` searches only that selected person's collection, never a roster collection. Subsequent enrollment samples must match the first. The database freezes enrollment as `indexing` before an external vector write. If that write or its commit is interrupted, no further samples can be accepted; delete and start over. Three completed samples activate enrollment.

AWS encrypts collection vectors at rest. The Supabase database stores an AES-256-GCM encrypted provider reference, bound to the employee ID, rather than raw images/embeddings. The application requests no S3 liveness output or audit images, processes reference bytes transiently on the server, and clears buffers on completion/failure. **AWS's effective Rekognition AI-services opt-out must be configured and verified** before real enrollment to avoid service-improvement retention. Session expiry alone does not establish that policy. See the linked primary sources in [provider and India privacy research](biometric-research.md).

## Database changes and permissions

`20261015201100_verified_biometric_attendance.sql` must execute after the repository's existing attendance migrations. It adds `check_in_at`, `check_out_at`, generated `working_seconds`, `updated_at`, `verification_method` and `verification_result` to `attendance`. Old rows remain and their time-only punches are backfilled in Asia/Kolkata; an earlier checkout clock time is interpreted as the following day. Review unusual legacy records before migration. It retains the existing `(staff_id,date)` unique constraint, legacy fields and photo-review history.

New service-only tables are `biometric_enrollments` and `biometric_sessions`. `biometric_audit_events` is append-only for browser users and readable by active administrators. No browser role can read templates or session rows or invoke the provider-completion functions. Active staff can read their own attendance; admins can read all attendance. Direct attendance writes and the old unverified `staff_attendance_action` path are blocked.

Punch functions lock the staff row even before the first daily record exists. They check current enrollment generation, single-use attempt status/expiry, identity, open-shift state and timestamps in the same transaction as the attendance/audit write. The clock and attendance date come from the database. Checkout supports a single open shift crossing midnight up to 24 hours; older/ambiguous shifts require an audited correction. Only one check-in is permitted per employee per IST date.

`admin_correct_attendance` requires an active administrator and a reason of 5–500 characters. It supports server-time manual punches, status changes, explicit retrospective corrections and historic photo review. Corrections cannot create future, overlapping or >24-hour shifts. Audit records include the actor, server time, reason and before/after values. The attendance row's method reflects the last attendance mutation; the audit preserves individual punch provenance, including mixed manual/face shifts.

## Provisioning requirements

Use an isolated Supabase environment first. Applying the migration, deploying functions and publishing pages are deployment actions; do them only after the owner approves deployment. Deploy the migration and updated admin manual path together: the old unchecked punch endpoint is intentionally disabled by the migration.

For the optional AWS provider, an AWS account with paid Rekognition Face Liveness and collection matching in **Mumbai (`ap-south-1`)** is required. Confirm quotas and pricing in the account; no fixed price is assumed here. Provision two separate IAM roles:

1. Backend principal: `rekognition:CreateFaceLivenessSession`, `rekognition:GetFaceLivenessSessionResults`, `rekognition:DetectFaces`, and create/delete/index/search permissions for application collections. Restrict collection resources to this account/region and the `rgc-` prefix where the action supports resource scoping. Permit `sts:AssumeRole` only for the browser liveness role.
2. Browser liveness role: trust only that backend principal; allow only `rekognition:StartFaceLivenessSession` on `*` (the streaming action does not support per-session resource scoping). The backend adds the same restrictive STS session policy. Never use a broad authenticated/anonymous Cognito role here.

Configure these **server-side Edge Function secrets**, never frontend configuration:

| Secret | Purpose |
| --- | --- |
| `AWS_REGION=ap-south-1` | Mumbai liveness and matching |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | Restricted backend AWS credentials; rotate operationally |
| `AWS_SESSION_TOKEN` | Optional temporary backend credential token |
| `AWS_LIVENESS_ROLE_ARN` | Start-session-only browser role |
| `BIOMETRIC_TEMPLATE_KEY` | Base64 encoding of 32 cryptographically random bytes; keep in a managed secret store |
| `BIOMETRIC_PRIVACY_CONTACT` | Actual employer privacy/grievance contact shown before consent |
| `BIOMETRIC_ALLOWED_ORIGINS` | Comma-separated exact HTTPS site origins; no wildcard |
| `BIOMETRIC_RETENTION_TOKEN` | Separate random scheduler secret of at least 32 characters |
| `AWS_AI_OPT_OUT_CONFIRMED=true` | Set only after effective policy verification |
| `BIOMETRIC_RETENTION_READY=true` | Set only after the scheduler and alerts work |
| `BIOMETRIC_VALIDATION_APPROVED=true` | Allow a supervised isolated pilot; production requires completed pilot approval |
| `BIOMETRIC_ATTENDANCE_ENABLED=true` | Final activation switch |

Supabase supplies `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` to deployed functions. The supplied `supabase/config.toml` disables the gateway's legacy JWT check for these two functions; `face-attendance` performs its own Auth validation and the retention function uses its dedicated scheduler secret. Do not remove those application checks.

Generate the template key securely in the deployment environment; do not paste it into a PR or browser. Keep it stable while enrollments exist. Key rotation requires an authenticated controlled decrypt/re-encrypt migration or deletion and reenrollment. Losing the key prevents matching/deletion by reference; maintain a secured recovery inventory of AWS collection ownership and a documented account-level cleanup procedure. Do not store images as a recovery shortcut.

## Retention and withdrawal

Unfinished enrollments expire after 24 hours; completed enrollments expire 90 days after activation. Verification rejects expired templates immediately. Run `POST /functions/v1/face-attendance-retention` from an approved scheduler at least daily with `Authorization: Bearer <BIOMETRIC_RETENTION_TOKEN>`. Keep this token only in the scheduler's protected secret store. With the gateway check disabled, no Supabase service-role token is needed in that scheduler request.

The worker deletes AWS vectors before deleting their database reference. It retries provider failures on later runs. A requested deletion immediately disables matching, records the request and makes the row eligible for the next scheduled cleanup if synchronous deletion fails. Alert on non-2xx responses, `failed>0`, `session_cleanup=false`, missing runs or `more_possible=true`. A batch processes at most 100 templates; invoke again when `more_possible` is true. Healthy daily scheduling means physical deletion can lag expiry/request by up to one scheduling interval; outages require prompt operator remediation. Session rows are removed after one day. Attendance/audit records are separate and require an employer-approved access/retention policy.

An administrator can delete enrollment even when biometric attendance's activation switches are off, provided provider credentials and the template key remain available. After an interrupted index write or a deletion in progress, retry deletion before enrolling again. Account deletion refuses enrolled staff to prevent orphaned provider templates. Deactivation blocks attendance immediately; use the deletion workflow for leavers as part of offboarding.

## First employee enrollment

1. In the approved isolated environment, sign in as an active administrator. Open **Attendance → Face enrollment** and select an existing active cashier or inventory employee.
2. Review the configured notice with the employee. Explain the purpose, AWS Mumbai storage, transient image processing, template expiry/deletion, privacy contact and manual alternative. Obtain the employee's affirmative consent; the supervising administrator must verify the person and confirm the witness checkbox. Declining must route to manual attendance.
3. On the Android tablet, allow the front camera and complete the AWS movement/light challenge in portrait mode. Capture **three** successful live samples; each later sample must match the first. The screen becomes enrolled only after server confirmation.
4. If a challenge fails before indexing, retry the pending sample. If enrollment is interrupted during indexing, delete it with a reason and begin again with fresh consent. Existing enrollments cannot be silently overwritten.
5. Sign out of the administrator account. The employee signs in with their own existing account for attendance.

## Android acceptance test

Use a supported current Android Chrome browser over HTTPS, a front color camera, good even lighting and portrait orientation. AWS documents minimum camera/display/bandwidth requirements in [the research notes](biometric-research.md). Verify local network/firewall access to Supabase, AWS's Mumbai streaming endpoint and the SDK's model/WASM assets. The SDK may load its maintained detection assets from its documented CDN locations; review the effective network/CSP policy on the deployed host.

With informed, consenting test participants, verify all of the following before enabling production:

- Enrolled employee checks in: server confirmation shows name/ID/time/status; the same row appears in admin daily/month reports. Repeat for checkout and inspect working duration.
- Wrong employee, no face, multiple people, dim light, obscured face, denied/unavailable camera and failed liveness never create or modify a punch.
- Authorized controlled presentation-attack tests include a printed image, another screen and recorded video. Record device/browser/lighting, thresholds, outcomes and false acceptance/rejection observations. No guarantee of spoof-proof performance is claimed.
- Repeated taps, parallel completions, replayed/expired sessions, network interruption and authentication expiry do not create duplicate attendance. Refresh persisted attendance after uncertain completion before retrying.
- An overnight shift can check out within 24 hours; stale/overlapping records require an administrator's reasoned correction.
- Refusal/accessibility/service outage: an active administrator verifies the employee through the shop's approved alternative process and records a manual punch with a meaningful reason. Confirm the audit identifies the administrator and marks the result manual.
- Delete/withdraw enrollment, confirm both provider vectors and database reference are removed, test failed-provider retry/alerts, and verify the employee cannot subsequently use face attendance until fresh consent and enrollment.
- Tablet portrait and landscape layouts remain usable, controls are accessible, focus is visible and camera cancellation stops capture. AWS liveness itself may require portrait orientation.

## Verification commands and limits

Install from the committed lockfile with `npm ci --legacy-peer-deps`, then run `npm run lint`, `npm run test:unit`, `npm run test:database`, `npm run check:biometric`, `npm run build`, and `npm run security`.

The unit suite mocks provider evidence and verifies rejection/authorization/cleanup behavior. The database suite runs the actual migration and PL/pgSQL/RLS in isolated PGlite PostgreSQL; it does not touch production. It exercises permissions, constraints, transaction rollback, session/generation protection, timestamps, durations and manual audit. Full remote Supabase integration and authenticated browser tests require separately configured non-production test accounts. Mocked tests and PGlite are **not evidence of real face accuracy, liveness security, actual Android camera behavior or production network concurrency**. The actual provider/device/participant pilot remains required.

The current Indian privacy framework and phased DPDP commencement were checked using official sources; see [the dated research and links](biometric-research.md). Have the employer's privacy/employment adviser approve the actual policy, processor terms, grievance process and retention before recommending production use. This repository does not certify legal compliance.

## Implementation verification results — 16 October 2026

These are the earlier AWS implementation results. The updated self-hosted checks and current totals are in [the self-hosted verification results](SELF_HOSTED_BIOMETRICS.md#verification-completed--17-october-2026).

- Clean lockfile installation, static build, lint and both Edge Function type checks: passed.
- Unit/UI/provider tests: **194 passed**. Provider responses are mocked.
- Actual migration, PL/pgSQL and permission tests in isolated PGlite PostgreSQL: **33 passed**.
- Dependency security audit: **0 known vulnerabilities** at verification time.
- Integration harness: 2 configured-harness checks passed, 1 provider/schema test skipped; no isolated remote Supabase credentials were supplied, so this is not a successful remote integration run.
- Browser layout inspection with mock accounts: portrait 800×1280 and landscape 1280×800 fitted the viewport; no browser console warnings/errors. No real camera, face/liveness API, employee biometric data or physical Android device was used.
- Production migrations, function deployment, merge and website publication: not performed.
