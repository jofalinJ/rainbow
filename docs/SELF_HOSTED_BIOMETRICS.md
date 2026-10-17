# Self-hosted staff face attendance

The self-hosted provider removes AWS face API charges by running face matching and passive anti-spoofing on a server you control. The existing staff sign-in, administrator enrollment, attendance reports, atomic punch checks and audited manual alternative remain in use. This is an implementation for an **isolated, supervised pilot**. No real employee enrollment, physical Android camera validation or production deployment has been completed by the implementation work.

The server runs OpenCV YuNet detection, SFace verification and a MiniFASNet passive anti-spoof ensemble. The algorithms run on the server; the tablet captures a short image sequence. [Source research and license notes](biometric-research.md#self-hosted-option-selected-for-an-isolated-pilot) explain the model choices and limitations. Open-source software removes per-check provider fees; the computer/server, power, internet, HTTPS, backups and ongoing maintenance still need an owner.

## What you need

- An always-on PC or server that supports the supplied Python environment or container. A modern CPU and **4 GB RAM are a starting estimate**, not a measured capacity guarantee. Benchmark the chosen machine and intended number of simultaneous tablets. A GPU is not required by the CPU design.
- A stable HTTPS face-server address reachable by **both the Supabase Edge Function and the Android browser**. A shop-only `192.168.x.x` address cannot normally be reached by a hosted Edge Function. Use an approved HTTPS ingress/reverse proxy or an appropriate reachable server. The production tablet page also needs HTTPS.
- A dedicated data directory on encrypted storage, a protected template-encryption key, server API secret, operating-system updates and an administrator responsible for uptime and deletion alerts.
- The existing non-production Supabase and static site, an exact allowed site origin, a privacy contact and a real description of the server's storage location.

Self-hosting the face worker does not make the existing Supabase-backed attendance system operate offline. A server or network outage routes staff to the administrator's audited manual alternative.

## Trust and request flow

1. The signed-in employee requests a check-in/out through the existing Edge Function. Only administrators can supervise new enrollment. The Edge Function checks the current active account, consent, enrollment generation and permitted attendance action, then reserves a short-lived database attempt.
2. The Edge Function creates a face-server session using its **server API key**. The browser receives only that session's upload URL, expiration and one-use upload token. It never receives the face-server API key, Supabase service-role key or either template-encryption key.
3. The camera module captures six JPEG frames over a few seconds and uploads them directly to the configured face server. The upload contains frames and its scoped token, never an employee-selected collection or a trusted success score. Cancelling, expiring or completing the capture stops camera tracks and clears the application's frame references.
4. The face server checks the upload bounds, session token, face count, image quality, frame consistency and passive anti-spoof evidence. It stores the derived evidence under that session and returns upload acceptance. **An accepted upload is not attendance approval.**
5. The Edge Function retrieves the result through the server-only result API. It uses an opaque evidence token to add an enrollment sample or verify against only the employee's own collection. Three successful, consistent samples are needed for activation. It does not search a collection containing the staff roster.
6. Only the existing server-owned completion transaction can record attendance. It rechecks enrollment/attempt state, consumes the attempt once, derives time on the server and rejects replay or duplicate punches. Manual corrections require the administrator and a reason.

The worker API separates browser upload from privileged operations:

| Route | Caller and purpose |
| --- | --- |
| `POST /v1/collections`, `DELETE /v1/collections/{id}` | API-key authenticated server; create/delete employee template collections |
| `POST /v1/sessions` | API-key authenticated server; create a short-lived capture session |
| `POST /v1/sessions/{id}/capture` | Browser with only its one-use upload token; submit bounded JPEG frames |
| `GET /v1/sessions/{id}/result` | API-key authenticated server; retrieve status and opaque evidence, without raw images |
| `POST /v1/collections/{id}/samples` | API-key authenticated server; add evidence from a verified capture |
| `POST /v1/collections/{id}/verify` | API-key authenticated server; match evidence only within the claimed employee's collection |

Do not expose a generic image-to-score or roster-identification endpoint. CORS is a browser restriction; the session token and API authentication must still be enforced independently.

## Server and Supabase configuration

The worker lives in `services/face-biometric/`. Use Python **3.12** and run these commands from that directory:

```sh
python3.12 -m venv .venv
.venv/bin/pip install -r requirements.txt -r requirements-test.txt
.venv/bin/python download_models.py
.venv/bin/python -m unittest discover -s tests
```

The downloader obtains the pinned models and checks their digests. It does not download staff images. Review the retained licenses before distributing the service or its models. A missing, corrupt or unloadable model leaves the worker **not ready** and blocks biometric operations; `/health` reports the actual model/pilot readiness. An HTTP 200 from that health endpoint alone is not readiness approval. Do not bypass a failed check or replace an artifact from an unreviewed mirror.

Configure the worker environment using a protected service environment file or secret manager:

| Worker variable | Value/purpose |
| --- | --- |
| `FACE_SERVICE_API_KEY` | Dedicated random API secret of at least 32 characters; use the same value for Supabase's `SELF_HOSTED_FACE_API_KEY` |
| `FACE_TEMPLATE_KEY` | Base64 encoding of a separate 32-byte random AES-GCM key; protects local face templates |
| `FACE_ALLOWED_ORIGINS` | Comma-separated exact HTTPS site origins; localhost HTTP is only a development exception |
| `FACE_DATA_DIR` | Persistent private data directory, such as `/data` in the container |
| `FACE_MODEL_DIR` | Downloaded verified model directory, normally `./models` |
| `FACE_PILOT_APPROVED=false` | Default; approve the isolated participant pilot explicitly before setting `true` |
| `FACE_LIVE_THRESHOLD=0.95` | Minimum permitted passive-PAD score; not a measured 95% accuracy claim |
| `FACE_MATCH_THRESHOLD=0.5` | Minimum permitted SFace cosine threshold; not an accuracy percentage |

The direct Python service reads its process environment; a file named `.env` alone is not loaded automatically. Inject these values through the service manager or export them in the shell before running it. After protected environment configuration, start the worker behind your HTTPS ingress with:

```sh
.venv/bin/uvicorn app:app --host 127.0.0.1 --port 8080 --workers 1 --limit-concurrency 16 --no-access-log
```

Alternatively, use the supplied Docker Compose configuration from the worker directory:

```sh
docker compose build
docker compose up -d
```

These are operator setup commands; the presence of a Docker configuration does not imply that a container or public HTTPS endpoint has been provisioned in this development environment. Keep the persistent data directory outside public/static assets. Run **one worker process** against that directory unless the service storage/concurrency model has been explicitly changed and tested. Tightening a threshold is allowed, but changing the operating point requires renewed pilot measurements.

Configure the following **server-side Supabase Edge Function secrets**:

| Secret | Value/purpose |
| --- | --- |
| `BIOMETRIC_PROVIDER=self_hosted` | Select the local provider; this is the default when unset |
| `SELF_HOSTED_FACE_URL` | Stable HTTPS origin of the face worker, with no path, query, username or password |
| `SELF_HOSTED_FACE_API_KEY` | The same dedicated API secret configured on the worker; never frontend configuration |
| `SELF_HOSTED_STORAGE_LOCATION` | Actual location/operator description shown in the consent notice |
| `BIOMETRIC_TEMPLATE_KEY` | Base64 encoding of 32 random bytes; encrypts provider references in Supabase |
| `BIOMETRIC_PRIVACY_CONTACT` | Actual employer privacy/grievance contact |
| `BIOMETRIC_ALLOWED_ORIGINS` | Comma-separated exact HTTPS site origins |
| `BIOMETRIC_RETENTION_TOKEN` | Separate scheduler secret, at least 32 random characters |
| `BIOMETRIC_RETENTION_READY=true` | Set after scheduled template deletion and failure alerts have been verified |
| `BIOMETRIC_VALIDATION_APPROVED=true` | Explicit approval for the intended supervised pilot; production needs completed device/spoof validation |
| `SELF_HOSTED_PAD_VALIDATED=true` | Explicit local PAD review/validation gate; setting it does not validate the model |
| `BIOMETRIC_ATTENDANCE_ENABLED=true` | Final activation switch, enabled only in the approved environment |

Supabase supplies its URL and service-role secret to the deployed functions. The worker does not need those secrets and must not receive them. AWS credentials and `AWS_AI_OPT_OUT_CONFIRMED` are not required for new self-hosted enrollment. Preserve the old provider's credentials until any old AWS collections have been deleted through the supported workflow.

Keep all enablement gates **off** while preparing models, network and retention. First test infrastructure with synthetic data and no real enrollment. Real participant testing needs the correct notice, affirmative consent, administrator witness, an approved isolated pilot and the manual alternative. Publishing pages, applying database changes and deploying functions are separate deployment actions.

## Data, encryption and deletion

The worker persists employee feature vectors in its local SQLite store encrypted with its own key. Supabase persists only a sealed provider/collection reference and enrollment/session metadata. Use a different random worker key from `BIOMETRIC_TEMPLATE_KEY`. Protect the keys separately from the database and source repository. Raw capture frames are processed in memory and are not an intended photo archive. Memory cleanup in a managed runtime is best effort; operating-system swap, crash dumps, proxy capture and monitoring tools require a reviewed host policy.

Configure the reverse proxy and host to enforce request size/rate/concurrency limits, exact browser origins and HTTPS. Disable request/response body logging, sensitive header logging, image tracing, proxy upload buffering to persistent disk, crash dumps and biometric analytics. Logs should record coarse request outcome and timing without photos, face vectors, upload/evidence tokens or API secrets. The application contains upload bounds, but upstream ingress should also reject oversized bodies before buffering them.

The existing retention worker still owns enrollment deletion: incomplete enrollments expire after 24 hours and activated enrollments after 90 days. It resolves the provider from each sealed reference and deletes vectors before removing the Supabase reference. Withdrawal/deletion immediately prevents subsequent matching; failed physical deletion stays eligible for retry. Run the protected retention endpoint at least daily, alert on failed/missing runs and retry until deletion is confirmed. See [the shared retention procedure](BIOMETRIC_ATTENDANCE.md#retention-and-withdrawal).

Back up the encrypted template database only under an approved, short retention schedule. Encrypt backups, restrict operators, protect recovery keys separately and test restoration without real staff data. Template deletion does not retroactively erase old backup copies; expire affected backups and ensure any restoration reapplies deletion/expiry records before verification resumes. Attendance/audit record retention is a separate employer policy.

Changing a template-encryption key without migrating existing ciphertext makes it unreadable. Losing a worker key can prevent both verification and reliable ownership-based cleanup. Maintain a protected recovery inventory; avoid using raw photos as recovery material. The worker's live-session evidence is short-lived and must not be backed up or logged.

## Changing from AWS

AWS face vectors and SFace features are incompatible. Do not re-label an existing AWS collection as local or copy AWS consent into a local enrollment. New local references contain a sealed `self_hosted:` provider prefix; legacy AWS references remain AWS. Status reports a provider mismatch and blocks attendance when the configured provider differs from an existing enrollment. Deletion and retention still route to the reference's original provider. Switching configuration cannot authorize matching an old template with another provider.

Use the supported administrator deletion path while the old provider remains available. Confirm deletion, update the storage-location notice, then obtain fresh consent and record three new local samples. The updated local consent notice is version `2026-10-17-self-hosted-v1`; the AWS notice retains its original version. The unmerged attendance migration accepts both explicit consent versions without adding a new provider column or changing attendance history. Keep historic attendance and audit records. If deletion is interrupted, retry it rather than overwriting enrollment or removing its database reference manually.

## Supervised Android pilot

For the first approved enrollment, sign in as an administrator and open **Attendance → Face enrollment**. Select the existing employee account, review the local-server notice with the employee, obtain affirmative consent and confirm the administrator's witness checkbox. Complete three separate successful camera captures; each capture sends six frames and later samples must match the first. If indexing is interrupted, delete the pending enrollment with a reason before starting again. After activation, sign out; the employee signs in with their own account and opens **My Attendance** to check in or out.

Use consenting participants and the actual intended tablet/browser, network and shop lighting. Record the device/browser versions, model hashes, thresholds and tested conditions without retaining raw face images by default. Confirm at least:

- The same enrolled employee can complete all three enrollment samples, sign in personally, check in/out, and see the correct server time/history. Verify admin reports and overnight checkout.
- A different employee, mixed identities across frames or enrollment samples, no face, multiple faces, dark/blurred/obscured images and altered scores cannot create a punch.
- Under authorized controlled conditions, test printed photos, phone/tablet screen replays and recorded video. Include altered-client/substituted-frame testing: the token proves session authorization, not a fresh physical camera source. Record both accepted spoofs and legitimate rejections; use the manual alternative if results fail the approved policy.
- Camera denial, cancellation, navigation, server timeout, network interruption and session expiration stop capture and produce a clear recoverable failure. A fresh attempt is needed after consumed or expired evidence.
- Double taps, concurrent completion, reused tokens, wrong session/collection, stale consent, disabled staff and provider changes do not create duplicate or unauthorized attendance.
- Deletion removes worker vectors and their sealed Supabase reference; simulated worker downtime produces a visible retry/alert and matching remains blocked. Test expiry, backup restore and offboarding procedures.
- Employees can decline, withdraw or use an accessible manual alternative without needing face capture. Administrators record a meaningful correction reason and remain identifiable in the audit.

The browser has no hardware camera attestation. A modified client can submit substitute pixels even though normal UI capture is camera-only. Passive PAD and frame consistency reduce some presentation attacks but do not prove a fresh physical person or provide an AWS-equivalent assurance level. No benchmark, mock test or configuration flag is evidence of local spoof resistance. Keep the pilot supervised; approve production only after the employer reviews measured outcomes and the remaining injection risk. If that risk is unacceptable, use a suitable trusted capture system or supervised attendance.

## Verification completed — 17 October 2026

- App, camera and provider unit tests: **259 passed**. Biometric responses are mocked.
- Actual migration, PL/pgSQL, permissions and attendance transactions in isolated PGlite PostgreSQL: **34 passed**.
- Python worker authentication, session lifecycle and encrypted-storage tests: **14 passed**.
- JavaScript adapter to the actual Python HTTP service: **1 contract test passed**, using an explicitly synthetic inference engine and temporary encrypted storage. Run `npm run test:self-hosted-contract` after installing the worker test dependencies; `SELF_HOSTED_TEST_PYTHON` can select the prepared interpreter. CI runs this test and the lightweight worker suite.
- Separate preprocessing/model-stack tests: **5 passed**. All four pinned models loaded and executed on CPU. Two checksum-pinned public upstream samples exercised detection, 128-dimensional SFace features and the real PAD ensemble; one passed and one was rejected. These are software compatibility checks using still images, not evidence of fresh-camera liveness or measured attack resistance.
- Lint, static build, both Edge Function type checks and dependency compatibility checks: passed. npm and Python dependency audits reported **zero known vulnerabilities** at verification time.

To repeat the optional real-model smoke, run `.venv/bin/python download_models.py --include-smoke`, `.venv/bin/python -m unittest discover -s model_tests -v` and `.venv/bin/python smoke_models.py` from the worker directory. The downloaded weights and public sample JPEGs stay outside Git. No employee photos were used.

A container build, remote Supabase integration, real tablet camera/attack pilot and production concurrency/capacity test remain outstanding. No merge, production deployment or live employee biometric collection has been performed. The code is part of draft PR #11.
