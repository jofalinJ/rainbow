# Attendance camera and preview investigation — 17 October 2026

The published page at `https://jofalinj.github.io/rainbow/admin/my-attendance.html` is the existing optional, on-device Human 3.3.6 preview. It is separate from official check-in/out. The stronger self-hosted flow in draft PR #11 is not live: the published page does not load it, the verification Edge Function is absent from the live function list and the biometric migration is absent from live migration history. Do not represent an optional preview match as authoritative attendance verification.

## What was verified

- Chrome's site controls initially showed Camera off. After allowing the camera and reloading, Chrome showed Camera on and Recently used. The user confirmed the camera now opens, and the page visibly showed its live camera preview and Camera recording state.
- The next failure was “Anti-spoofing check has not passed.” This happens before identity comparison and does not prove the employee's reference photo is incorrect or that an attack occurred.
- The exact Human 3.3.6 source shows that model loading can catch an error without throwing. An unavailable anti-spoofing model can therefore be presented as an ordinary rejected frame. Object presence or `models.loaded()` alone does not prove executable weights are available.
- The old engine was cached before loading completed, so a failed initialization could persist across retries. Its loop also allowed only 18 inferences, with no live recovery guidance.

This investigation has not established whether the user's particular anti-spoof rejection was a low valid score or an unavailable model. No employee frames, embeddings or scores were retained for debugging.

## Targeted preview repair

The repair validates executable models and loaded weights before comparison, caches only a successfully initialized engine, keeps initialization retryable, and distinguishes camera/model availability from frame rejection. It shows live positioning feedback and allows a bounded 30-second capture window. It preserves the existing acceptance thresholds and three consecutive passing frames. No outcome from this preview authorizes a database attendance write.

Model loading and private reference preparation happen before that capture window and have a separate 90-second setup limit. Stalled work releases the camera and shows explicit reload guidance; a second inference is not started while older model work is still pending.

For camera denial, use Chrome's site controls → Camera → Allow, then reload. On Android, verify the Android app permission for Chrome as well. Operating-system restrictions and embedded browser restrictions cannot be bypassed by site JavaScript. [Chrome camera permission guidance](https://support.google.com/chrome/answer/2693767)

## Accuracy and live use

Neither “the camera opens” nor a passing unit test proves accurate identity matching or anti-spoofing. The upstream project describes its small anti-spoof/liveness models as quick checks used alongside other indicators. The live preview remains experimental. [Upstream FaceID example and limitations](https://github.com/vladmandic/human/tree/main/demo/faceid), [model loading source](https://github.com/vladmandic/human/blob/main/src/tfjs/load.ts)

For authoritative face attendance, provision and test the self-hosted service in PR #11, obtain fresh supervised enrollment, and measure genuine acceptance/rejection and false acceptance using the actual tablets, enrolled staff and shop lighting. Include consenting participants and controlled photo, screen/video and substituted-frame attacks. Do not lower acceptance checks to make one failing demonstration pass. Document the measured error rates and operating conditions before choosing production thresholds. No numeric accuracy claim is supported by this work.

The preview repair does not deploy the self-hosted service, apply a production migration or merge a pull request. Publication remains subject to the user's existing approval requirement.

## Repair verification

The 127 unit tests passed, including 34 new recovery tests and four daily-status tests. Lint, static build and whitespace checks passed. Camera/model tests use mocked responses. The optional localhost browser model-load check was declined and was not run through another browser or automation route. The temporary local server was stopped. This repair has not been tested on the user's physical camera or published to the live site.

## Daily attendance polish — 18 October 2026

The user confirmed that the face preview is now working and requested daily check-in polish. The existing live database was inspected read-only: `attendance_staff_date_unique` enforces one row per staff/date, and `staff_attendance_action` rejects another check-in, uses the authenticated staff ID and derives the India date/time on the server. No employee attendance was written during this verification.

The screen now labels a saved check-in **Checked in today**, keeps it disabled after checkout, labels completed checkout, and refreshes a new India date when a tablet is left open. Face-preview guidance points to the existing attendance button. These changes preserve the optional-preview boundary: they do not convert a browser face result into trusted server verification. The separate secure flow in PR #11 uses server evidence for mandatory face attendance.
