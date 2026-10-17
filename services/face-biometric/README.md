# Self-hosted face attendance worker (pilot)

This CPU service replaces per-check cloud calls with OpenCV YuNet detection,
OpenCV SFace 1:1 matching and the official two-model Silent-Face-Anti-Spoofing
ensemble. It is disabled until `FACE_PILOT_APPROVED=true`. That flag must only
follow validation with consenting participants on the actual Android camera,
lighting and network, including printed photos, screen/video replay and a
second person. Passive RGB PAD cannot authenticate the camera or guarantee
resistance to replay, injected browser frames or deepfakes. Do not treat a
successful software smoke test as real-world liveness validation.

Python 3.12 is required. No cloud subscription or GPU is required. A computer,
stable HTTPS endpoint, electricity, administration, backups and device testing
are still needed. This folder is the worker; the app's backend remains the only
attendance decision authority.

```sh
python3.12 -m venv .venv
.venv/bin/pip install -r requirements.txt -r requirements-test.txt
.venv/bin/python download_models.py --include-smoke
.venv/bin/python -m unittest discover -s tests -v
.venv/bin/python -m unittest discover -s model_tests -v
.venv/bin/python smoke_models.py
```

`models.manifest.json` pins official upstream commits, sizes and SHA-256 hashes.
The downloader fails on altered/truncated files, the worker verifies all four
weights again at startup and loads PyTorch state dictionaries with
`weights_only=True`. Weights and downloaded public samples are ignored by Git.
`vendor/minifasnet.py` is the unchanged upstream architecture; notices and model
licenses are in `licenses/` and `NOTICE.md`. No employee images are test fixtures.

Copy `env.example` to `.env`, generate separate random secrets and fill exact
browser origins. Keep `.env` private and outside Git. Then run:

```sh
.venv/bin/uvicorn app:app --host 127.0.0.1 --port 8080 --workers 1 --limit-concurrency 16 --no-access-log
# Or: docker compose up --build -d
```

The native command requires variables exported into the environment. Compose
reads `.env` automatically. Set the public app backend's
`SELF_HOSTED_FACE_URL` to the HTTPS reverse-proxy origin and
`SELF_HOSTED_FACE_API_KEY` to the same secret as `FACE_SERVICE_API_KEY`.
Only the short-lived upload token goes to browsers. Use HTTPS for the frontend
and worker. Do not expose port 8080 directly; the example binds localhost.
Configure the proxy with an 8 MiB request limit, a 30-second upload timeout,
connection limits, no request-body logging and a 120-second processing timeout.

| Variable | Requirement |
| --- | --- |
| `FACE_SERVICE_API_KEY` | Separate random server-only secret, at least 32 characters |
| `FACE_TEMPLATE_KEY` | Base64 encoding of exactly 32 random bytes; keep stable and backed up securely |
| `FACE_ALLOWED_ORIGINS` | Comma-separated exact HTTPS frontend origins, no path/trailing slash; HTTP localhost allowed for development |
| `FACE_DATA_DIR` | Persistent private directory, default `./data`, Docker `/data` |
| `FACE_MODEL_DIR` | Verified weight directory, default `./models` |
| `FACE_PILOT_APPROVED` | Defaults false; exact `true` enables only after device/attack pilot approval |
| `FACE_LIVE_THRESHOLD` | Default/minimum `0.95`, each frame's ensemble live-class probability |
| `FACE_MATCH_THRESHOLD` | Default/minimum `0.5`, OpenCV cosine threshold (not a percentage) |

Run **exactly one worker and one instance**. Capture sessions are short-lived,
in-memory state; restarts cancel them. Do not load balance multiple instances
against this SQLite database. SQLite contains only opaque collection references
and up to three SFace vectors per employee. Every stored vector uses a random
AES-256-GCM nonce and authenticated collection/sample binding; changing the
collection or ciphertext fails authentication. Keys are never stored alongside
the database. Transient session vectors are encrypted in memory, expire within
three minutes and are removed by a five-second cleanup sweep. Request frames
exist only in transient processing memory, are never written to disk or returned
by any endpoint. Python does not guarantee cryptographic erasure of process RAM;
disable core dumps/swap or use encrypted swap on the host. Do not log uploads.

Collection deletion deletes all enrolled vectors and invalidates pending
sessions immediately. The app's retention cleanup must call this operation for
expired/withdrawn enrollment. Encrypted backups need their own deletion policy;
copying the database is not a substitute for managing retention.

## API contract

All endpoints except health and capture require
`Authorization: Bearer FACE_SERVICE_API_KEY`. No public endpoint returns photos
or vectors. Browser responses never decide identity or attendance.

- `GET /health`: public, reports `provider`, `models_ready`, `pilot_approved`,
  `ready`. Missing/corrupt weights yield not-ready; biometric writes reject with
  503. Invalid secrets or the wrong database encryption key prevent startup.
- `POST /v1/collections` with `{collection_id}` creates an opaque employee
  collection. `DELETE /v1/collections/{id}` deletes it idempotently, even while
  models/pilot are unavailable.
- `POST /v1/sessions` with `{collection_id, mode}` where mode is `enrollment`,
  `check_in` or `check_out` returns `{session_id, upload_token, expires_at,
  challenge:{type:'passive_multiframe',frame_count:6,interval_ms:600}}`.
- Browser `POST /v1/sessions/{id}/capture` with upload-token Bearer, exact allowed
  `Origin`, and JSON `{frames:[six base64 JPEG strings]}`. The token is bound to
  this session, expires after three minutes, and is used once. The reply is
  `{accepted:true}` after processing; it conveys no identity decision. Invalid
  capture/PAD produces a server-visible FAILED result. Malformed upload returns
  4xx and consumes its token. A busy worker returns 429; create a fresh session.
- Backend `GET /v1/sessions/{id}/result` returns status PENDING/FAILED/SUCCEEDED,
  provider and `template_token` equal to the session ID. Successful results add
  `confidence` (PAD score ×100), `live_score`, `face_count:1`,
  `quality_passed:true`, `frames_verified:6`.
- Backend `POST /v1/collections/{id}/samples` with `{session_id}` consumes a
  successful enrollment capture. Later samples must match every existing
  vector; maximum three. Returns `{indexed:true,sample_count}`.
- Backend `POST /v1/collections/{id}/verify` with `{session_id}` consumes a
  successful check capture for the same collection, requires three enrolled
  vectors, compares against all three, and returns `{matched,similarity}`.

Requests are limited to 8 MiB, each decoded JPEG to 1 MiB, each image to
4096px per side and 8 megapixels. Exactly six distinct decoded frames must each
contain exactly one complete, adequately lit, sharp, near-frontal face; every
frame must pass PAD and match every preceding frame. Six identical frames are
rejected, but six varied frames do not prove camera authenticity. No client
scores, embeddings or blink assertions are accepted. Session limits are 512
per instance and eight per collection; use proxy rate limits too.

## Validation scope

`tests/` exercises server and upload-token authentication, allowed origins,
single-use sessions, expiry, collection/purpose binding, same-person enrollment,
three-sample verification, deletion, size limits and AES-GCM tamper detection
with a test engine. `model_tests/` additionally requires the real model stack
and compares crop and BGR 0..255 tensor preprocessing against unchanged,
checksum-pinned official upstream helpers. These tests prevent accidental
normalization or crop changes from silently invalidating PAD scores.

`smoke_models.py` loads and executes all four real models on two public images
from the pinned Silent-Face repository. It prints detection counts, SFace
self-match and PAD scores, and checks their fixed fixture outcomes. It never
creates employee records. The score from a public still image does not establish
production accuracy or resistance to photos/videos; the actual Android pilot
remains required before `FACE_PILOT_APPROVED=true`.
