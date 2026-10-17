const MAX_SESSION_MS = 180_000;
const CAMERA_ERRORS = {
  NotAllowedError: 'Camera permission was denied. Allow camera access and start again.',
  PermissionDeniedError: 'Camera permission was denied. Allow camera access and start again.',
  NotFoundError: 'No camera is available. Connect a front camera and start again.',
  DevicesNotFoundError: 'No camera is available. Connect a front camera and start again.',
  NotReadableError: 'The camera is in use. Close other camera apps and start again.',
  TrackStartError: 'The camera is in use. Close other camera apps and start again.',
  OverconstrainedError: 'This camera cannot use the required video settings. Try another camera.',
};
const UPLOAD_ERRORS = {
  NO_FACE: 'No face was found. Keep your whole face inside the guide and try again.',
  MULTIPLE_FACES: 'More than one face was found. Only the employee should be in view.',
  POOR_LIGHTING: 'The image is too dark or unclear. Use even lighting and try again.',
  LIVENESS_FAILED: 'The server could not verify a live face. Improve lighting and try again.',
  SPOOF_DETECTED: 'The server could not verify a live face. Start a fresh camera capture.',
  SESSION_EXPIRED: 'This camera session expired. Start a new attendance check.',
  CAPTURE_REJECTED: 'The server rejected this capture. Improve lighting and start again.',
};
const failure = (code, message, name = code) => ({code, name, message});
const localHost = hostname => ['localhost', '127.0.0.1', '[::1]', '::1'].includes(hostname);

/**
 * Capture only. Identity and passive anti-spoof checks happen on the configured server.
 * onComplete means the upload was accepted; the caller must fetch the server result.
 */
export function mountSelfHostedCapture(container, {
  sessionId, credentials, capture = {}, onComplete, onError, onCancel,
}, dependencies = {}) {
  const document = dependencies.document ?? globalThis.document;
  const navigator = dependencies.navigator ?? globalThis.navigator;
  const fetch = dependencies.fetch ?? globalThis.fetch;
  const now = dependencies.now ?? Date.now;
  const setTimer = dependencies.setTimeout ?? globalThis.setTimeout;
  const clearTimer = dependencies.clearTimeout ?? globalThis.clearTimeout;
  const hostname = dependencies.hostname ?? globalThis.location?.hostname;
  const frameCount = capture.frameCount ?? 6;
  const intervalMs = capture.intervalMs ?? 600;
  let uploadUrl, uploadToken, expiresAt;
  try {
    const parsed = new URL(credentials?.uploadUrl);
    const developmentUrl = parsed.protocol === 'http:' && localHost(parsed.hostname) && localHost(hostname);
    if ((parsed.protocol !== 'https:' && !developmentUrl) || parsed.username || parsed.password || parsed.hash) throw new Error();
    if (typeof credentials?.uploadToken !== 'string' || !credentials.uploadToken || credentials.uploadToken.length > 4096 || [...credentials.uploadToken].some(character => character.charCodeAt(0) <= 32 || character.charCodeAt(0) === 127)) throw new Error();
    if (typeof sessionId !== 'string' || !sessionId || sessionId.length > 256) throw new Error();
    if (!Number.isInteger(frameCount) || frameCount < 3 || frameCount > 12 || !Number.isInteger(intervalMs) || intervalMs < 300 || intervalMs > 2000) throw new Error();
    expiresAt = new Date(credentials.expiration).getTime();
    if (!Number.isFinite(expiresAt) || expiresAt <= now() + (frameCount - 1) * intervalMs + 1000) throw new Error();
    uploadUrl = parsed.href;
    uploadToken = credentials.uploadToken;
  } catch {
    credentials = null;
    onError?.(failure('CAPTURE_CONFIG_INVALID', 'The camera session is unavailable or expired. Start a new attendance check.'));
    return () => {};
  }
  credentials = null;

  const panel = document.createElement('section');
  const preview = document.createElement('div');
  const video = document.createElement('video');
  const guide = document.createElement('div');
  const instruction = document.createElement('p');
  const privacy = document.createElement('p');
  const status = document.createElement('p');
  const start = document.createElement('button');
  const cancel = document.createElement('button');
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  panel.setAttribute('aria-label', 'Staff face capture');
  video.autoplay = true;
  video.muted = true;
  video.playsInline = true;
  video.setAttribute('playsinline', '');
  video.setAttribute('aria-label', 'Front camera preview');
  Object.assign(preview.style, {position: 'relative', maxWidth: '640px', margin: '0 auto', background: '#111827', borderRadius: '12px', overflow: 'hidden'});
  Object.assign(video.style, {display: 'block', width: '100%', minHeight: '240px', transform: 'scaleX(-1)'});
  Object.assign(guide.style, {position: 'absolute', inset: '10% 22%', border: '3px solid #ffffff', borderRadius: '48%', pointerEvents: 'none'});
  guide.setAttribute('aria-hidden', 'true');
  instruction.textContent = 'Keep only your face inside the guide. Face the camera, keep still and use even lighting.';
  privacy.textContent = 'A short sequence of images is sent securely to your shop’s face server for verification. Images stay out of browser storage. Attendance is confirmed only by the server.';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  status.textContent = 'Press Start camera when you are ready.';
  start.type = cancel.type = 'button';
  start.textContent = 'Start camera';
  cancel.textContent = 'Cancel';
  preview.append(video, guide);
  panel.append(preview, instruction, privacy, status, start, cancel);
  container.replaceChildren(panel);

  let active = true;
  let started = false;
  let stream = null;
  let frames = [];
  let body = null;
  let readyCancel = null;
  let delayCancel = null;
  const controller = new AbortController();
  let deadlineTimer;
  const stopTracks = value => {
    for (const track of value?.getTracks?.() ?? []) {
      try { track.stop(); } catch { /* Continue releasing the remaining camera tracks. */ }
    }
  };
  const release = () => {
    clearTimer(deadlineTimer);
    readyCancel?.();
    delayCancel?.();
    controller.abort();
    stopTracks(stream);
    stream = null;
    video.pause?.();
    video.srcObject = null;
    frames.fill('');
    frames.length = 0;
    body = null;
    context?.clearRect(0, 0, canvas.width, canvas.height);
    canvas.width = canvas.height = 0;
    uploadToken = uploadUrl = null;
    start.disabled = cancel.disabled = true;
    start.removeEventListener('click', startCapture);
    cancel.removeEventListener('click', cancelCapture);
  };
  const end = (kind, error) => {
    if (!active) return;
    active = false;
    release();
    if (kind === 'error') {
      status.textContent = error.message;
      onError?.(error);
    } else if (kind === 'cancel') {
      status.textContent = 'Camera capture cancelled.';
      onCancel?.();
    } else if (kind === 'complete') {
      status.textContent = 'Capture uploaded. Waiting for the server verification result.';
      return onComplete?.();
    }
  };
  const delay = milliseconds => new Promise(resolve => {
    const timer = setTimer(() => { delayCancel = null; resolve(); }, milliseconds);
    delayCancel = () => { clearTimer(timer); delayCancel = null; resolve(); };
  });
  const ready = () => new Promise(resolve => {
    if (video.readyState >= 2) { resolve(); return; }
    const loaded = () => { video.removeEventListener('loadeddata', loaded); readyCancel = null; resolve(); };
    readyCancel = loaded;
    video.addEventListener('loadeddata', loaded);
  });
  function cancelCapture() { end('cancel'); }
  async function startCapture() {
    if (!active || started) return;
    started = true;
    start.disabled = true;
    status.textContent = 'Opening the front camera…';
    try {
      if (!navigator?.mediaDevices?.getUserMedia || !context || typeof fetch !== 'function') {
        end('error', failure('CAMERA_UNAVAILABLE', 'Camera capture is unavailable in this browser. Try an up-to-date browser with camera access.'));
        return;
      }
      const acquired = await navigator.mediaDevices.getUserMedia({video: {facingMode: 'user', width: {ideal: 640}, height: {ideal: 480}}, audio: false});
      if (!active) { stopTracks(acquired); return; }
      stream = acquired;
      video.srcObject = stream;
      await video.play();
      if (!active) return;
      await ready();
      if (!active) return;
      if (!video.videoWidth || !video.videoHeight) throw failure('CAMERA_UNAVAILABLE', 'The camera did not provide a clear image. Start again.');
      const scale = Math.min(1, 640 / Math.max(video.videoWidth, video.videoHeight));
      canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
      canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
      for (let index = 0; index < frameCount; index++) {
        if (!active) return;
        status.textContent = `Keep still. Capturing image ${index + 1} of ${frameCount}…`;
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        const encoded = canvas.toDataURL('image/jpeg', 0.85);
        if (!encoded.startsWith('data:image/jpeg;base64,') || encoded.length <= 23) throw failure('CAPTURE_FAILED', 'The camera image could not be captured. Start again.');
        frames.push(encoded.slice('data:image/jpeg;base64,'.length));
        if (index + 1 < frameCount) await delay(intervalMs);
      }
      if (!active) return;
      stopTracks(stream);
      stream = null;
      video.pause?.();
      video.srcObject = null;
      context.clearRect(0, 0, canvas.width, canvas.height);
      status.textContent = 'Sending capture securely to the face server…';
      body = JSON.stringify({frames});
      let response;
      try {
        response = await fetch(uploadUrl, {method: 'POST', headers: {'Authorization': `Bearer ${uploadToken}`, 'Content-Type': 'application/json'}, body, signal: controller.signal, mode: 'cors', credentials: 'omit', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer'});
      } finally {
        frames.fill('');
        frames.length = 0;
        body = null;
      }
      if (!active) return;
      let result;
      try { result = await response.json(); } catch { result = null; }
      if (!active) return;
      if (!response.ok || result?.accepted !== true) {
        const candidate = result?.code ?? result?.error?.code;
        const code = Object.hasOwn(UPLOAD_ERRORS, candidate) ? candidate : 'CAPTURE_REJECTED';
        end('error', failure(code, UPLOAD_ERRORS[code]));
        return;
      }
      await end('complete');
    } catch (error) {
      if (!active) return;
      if (Object.hasOwn(CAMERA_ERRORS, error?.name)) end('error', failure('CAMERA_ACCESS_ERROR', CAMERA_ERRORS[error.name], error.name));
      else if (['CAMERA_UNAVAILABLE', 'CAPTURE_FAILED'].includes(error?.code)) end('error', error);
      else end('error', failure('CAPTURE_NETWORK_ERROR', 'The camera capture could not be sent. Check your connection and start a fresh attendance check.'));
    }
  }
  start.addEventListener('click', startCapture);
  cancel.addEventListener('click', cancelCapture);
  deadlineTimer = setTimer(() => end('error', failure('SESSION_EXPIRED', UPLOAD_ERRORS.SESSION_EXPIRED)), Math.min(MAX_SESSION_MS, expiresAt - now()));
  return () => {
    if (active) { active = false; release(); }
    // A delayed cleanup must not remove a newer capture mounted in the same container.
    if (panel.parentNode === container) panel.remove();
  };
}
