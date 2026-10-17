import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {mountSelfHostedCapture} from '../../src/biometrics/self-hosted-capture.mjs';

class Element extends EventTarget {
  constructor(tagName) {
    super();
    this.tagName = tagName;
    this.style = {};
    this.children = [];
    this.parentNode = null;
    this.attributes = new Map();
    this.listeners = new Map();
    this.textContent = '';
    this.disabled = false;
  }
  setAttribute(key, value) { this.attributes.set(key, value); }
  append(...nodes) { for (const node of nodes) { node.parentNode = this; this.children.push(node); } }
  replaceChildren(...nodes) {
    for (const child of this.children) child.parentNode = null;
    this.children = [];
    this.append(...nodes);
  }
  remove() {
    if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(child => child !== this);
    this.parentNode = null;
  }
  addEventListener(type, listener, options) {
    super.addEventListener(type, listener, options);
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(listener);
  }
  removeEventListener(type, listener, options) {
    super.removeEventListener(type, listener, options);
    this.listeners.get(type)?.delete(listener);
  }
}

function deferred() {
  let resolve, reject;
  const promise = new Promise((success, failure) => { resolve = success; reject = failure; });
  return {promise, resolve, reject};
}

function harness({getUserMedia, response, fetch, readyState = 2, credentials, capture, hostname = 'shop.example'} = {}) {
  const created = [];
  const drawing = {drawImage: vi.fn(), clearRect: vi.fn()};
  const document = {
    createElement(tag) {
      const element = new Element(tag);
      if (tag === 'video') Object.assign(element, {
        readyState, videoWidth: 1280, videoHeight: 960,
        play: vi.fn().mockResolvedValue(), pause: vi.fn(), srcObject: null,
      });
      if (tag === 'canvas') Object.assign(element, {
        width: 0, height: 0, getContext: vi.fn().mockReturnValue(drawing),
        toDataURL: vi.fn().mockImplementation(() => 'data:image/jpeg;base64,c2FtcGxl'),
      });
      created.push(element);
      return element;
    },
  };
  const container = new Element('div');
  const track = {stop: vi.fn()};
  const stream = {getTracks: () => [track]};
  const camera = getUserMedia ?? vi.fn().mockResolvedValue(stream);
  const upload = fetch ?? vi.fn().mockResolvedValue(response ?? {ok: true, json: async () => ({accepted: true})});
  const callbacks = {onComplete: vi.fn(), onError: vi.fn(), onCancel: vi.fn()};
  const cleanup = mountSelfHostedCapture(container, {
    sessionId: 'capture-session-id',
    credentials: credentials ?? {
      uploadUrl: 'https://face.example/v1/captures/signed-session',
      uploadToken: 'short-lived-upload-token',
      expiration: new Date(Date.now() + 60_000).toISOString(),
    },
    capture, ...callbacks,
  }, {document, navigator: {mediaDevices: {getUserMedia: camera}}, fetch: upload, hostname});
  const find = tag => created.find(element => element.tagName === tag);
  const buttons = created.filter(element => element.tagName === 'button');
  const click = button => button?.dispatchEvent(new Event('click'));
  return {
    container, track, stream, camera, upload, callbacks, cleanup, drawing,
    video: find('video'), canvas: find('canvas'), panel: find('section'),
    start: () => click(buttons[0]), cancel: () => click(buttons[1]),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-17T04:00:00Z'));
});
afterEach(() => { vi.useRealTimers(); });

describe('self-hosted camera capture', () => {
  it('shows the front camera and sends exactly six JPEG frames over three seconds, then signals server completion', async () => {
    const ui = harness();
    expect(ui.container.children).toEqual([ui.panel]);
    expect(ui.video.playsInline).toBe(true);
    expect(ui.video.muted).toBe(true);
    expect(ui.video.style.transform).toBe('scaleX(-1)');
    expect(ui.camera).not.toHaveBeenCalled();
    ui.start();
    ui.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(ui.camera).toHaveBeenCalledExactlyOnceWith({video: {facingMode: 'user', width: {ideal: 640}, height: {ideal: 480}}, audio: false});
    expect(ui.video.srcObject).toBe(ui.stream);
    expect(ui.drawing.drawImage).toHaveBeenCalledWith(ui.video, 0, 0, 640, 480);
    await vi.advanceTimersByTimeAsync(2999);
    expect(ui.upload).not.toHaveBeenCalled();
    expect(ui.canvas.toDataURL).toHaveBeenCalledTimes(5);
    await vi.advanceTimersByTimeAsync(1);
    expect(ui.canvas.toDataURL).toHaveBeenCalledTimes(6);
    expect(ui.canvas.toDataURL).toHaveBeenLastCalledWith('image/jpeg', 0.85);
    expect(ui.upload).toHaveBeenCalledOnce();
    const [url, request] = ui.upload.mock.calls[0];
    expect(url).toBe('https://face.example/v1/captures/signed-session');
    expect(request).toMatchObject({
      method: 'POST',
      headers: {'Authorization': 'Bearer short-lived-upload-token', 'Content-Type': 'application/json'},
      mode: 'cors', credentials: 'omit', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer',
    });
    expect(JSON.parse(request.body)).toEqual({frames: Array(6).fill('c2FtcGxl')});
    expect(ui.callbacks.onComplete).toHaveBeenCalledExactlyOnceWith();
    expect(ui.callbacks.onError).not.toHaveBeenCalled();
    expect(ui.track.stop).toHaveBeenCalledOnce();
    expect(ui.video.srcObject).toBeNull();
    expect(ui.canvas.width).toBe(0);
    expect(ui.canvas.height).toBe(0);
    ui.start();
    ui.cancel();
    await vi.advanceTimersByTimeAsync(180_000);
    expect(ui.upload).toHaveBeenCalledOnce();
    expect(ui.callbacks.onCancel).not.toHaveBeenCalled();
    expect(ui.callbacks.onError).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    ui.cleanup();
    expect(ui.container.children).toEqual([]);
  });

  it.each([
    [{ok: true, json: async () => ({accepted: false})}, 'CAPTURE_REJECTED'],
    [{ok: true, json: async () => ({accepted: 'true'})}, 'CAPTURE_REJECTED'],
    [{ok: false, json: async () => ({accepted: true})}, 'CAPTURE_REJECTED'],
    [{ok: true, json: async () => { throw new SyntaxError('bad response'); }}, 'CAPTURE_REJECTED'],
    [{ok: false, json: async () => ({code: 'SPOOF_DETECTED'})}, 'SPOOF_DETECTED'],
    [{ok: false, json: async () => ({error: {code: 'MULTIPLE_FACES'}})}, 'MULTIPLE_FACES'],
  ])('requires a successful accepted response before completion (%s)', async (response, code) => {
    const ui = harness({response});
    ui.start();
    await vi.advanceTimersByTimeAsync(3000);
    expect(ui.callbacks.onComplete).not.toHaveBeenCalled();
    expect(ui.callbacks.onError).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({code}));
    expect(ui.track.stop).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    ui.cleanup();
  });

  it.each([
    ['NotAllowedError', 'permission was denied'],
    ['NotFoundError', 'No camera is available'],
    ['NotReadableError', 'camera is in use'],
  ])('explains %s and does not upload', async (name, message) => {
    const ui = harness({getUserMedia: vi.fn().mockRejectedValue(Object.assign(new Error(), {name}))});
    ui.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(ui.upload).not.toHaveBeenCalled();
    expect(ui.callbacks.onError).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({code: 'CAMERA_ACCESS_ERROR', name, message: expect.stringContaining(message)}));
    expect(vi.getTimerCount()).toBe(0);
    ui.cleanup();
  });

  it('stops a camera granted after cancellation without capturing or reporting completion', async () => {
    const pending = deferred();
    const ui = harness({getUserMedia: vi.fn().mockReturnValue(pending.promise)});
    ui.start();
    ui.cancel();
    ui.cancel();
    expect(ui.callbacks.onCancel).toHaveBeenCalledOnce();
    pending.resolve(ui.stream);
    await vi.advanceTimersByTimeAsync(0);
    expect(ui.track.stop).toHaveBeenCalledOnce();
    expect(ui.video.play).not.toHaveBeenCalled();
    expect(ui.upload).not.toHaveBeenCalled();
    expect(ui.callbacks.onComplete).not.toHaveBeenCalled();
    expect(ui.callbacks.onError).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    ui.cleanup();
  });

  it('cleans up an unmounted capture while camera permission is still pending', async () => {
    const pending = deferred();
    const ui = harness({getUserMedia: vi.fn().mockReturnValue(pending.promise)});
    ui.start();
    ui.cleanup();
    ui.cleanup();
    pending.resolve(ui.stream);
    await vi.advanceTimersByTimeAsync(0);
    expect(ui.container.children).toEqual([]);
    expect(ui.track.stop).toHaveBeenCalledOnce();
    expect(ui.upload).not.toHaveBeenCalled();
    for (const callback of Object.values(ui.callbacks)) expect(callback).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cancels between frames and never submits the partial capture', async () => {
    const ui = harness();
    ui.start();
    await vi.advanceTimersByTimeAsync(1200);
    expect(ui.canvas.toDataURL).toHaveBeenCalledTimes(3);
    ui.cancel();
    await vi.advanceTimersByTimeAsync(180_000);
    expect(ui.track.stop).toHaveBeenCalledOnce();
    expect(ui.upload).not.toHaveBeenCalled();
    expect(ui.callbacks.onCancel).toHaveBeenCalledOnce();
    expect(ui.callbacks.onComplete).not.toHaveBeenCalled();
    expect(ui.callbacks.onError).not.toHaveBeenCalled();
    expect(ui.canvas.width).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    ui.cleanup();
  });

  it('aborts an in-flight upload and ignores its late response after cancellation', async () => {
    const pending = deferred();
    const ui = harness({fetch: vi.fn().mockReturnValue(pending.promise)});
    ui.start();
    await vi.advanceTimersByTimeAsync(3000);
    const signal = ui.upload.mock.calls[0][1].signal;
    expect(signal.aborted).toBe(false);
    ui.cancel();
    expect(signal.aborted).toBe(true);
    pending.resolve({ok: true, json: async () => ({accepted: true})});
    await vi.advanceTimersByTimeAsync(0);
    expect(ui.callbacks.onCancel).toHaveBeenCalledOnce();
    expect(ui.callbacks.onComplete).not.toHaveBeenCalled();
    expect(ui.callbacks.onError).not.toHaveBeenCalled();
    expect(ui.track.stop).toHaveBeenCalledOnce();
    ui.cleanup();
  });

  it('waits for real video data and removes the readiness listener when cancelled', async () => {
    const ui = harness({readyState: 0});
    ui.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(ui.video.listeners.get('loadeddata').size).toBe(1);
    expect(ui.canvas.toDataURL).not.toHaveBeenCalled();
    ui.cancel();
    ui.video.dispatchEvent(new Event('loadeddata'));
    await vi.advanceTimersByTimeAsync(3000);
    expect(ui.video.listeners.get('loadeddata').size).toBe(0);
    expect(ui.track.stop).toHaveBeenCalledOnce();
    expect(ui.upload).not.toHaveBeenCalled();
    expect(ui.callbacks.onCancel).toHaveBeenCalledOnce();
    ui.cleanup();
  });

  it('reports a failed upload once without exposing server or credential details', async () => {
    const ui = harness({fetch: vi.fn().mockRejectedValue(new Error('private server details'))});
    ui.start();
    await vi.advanceTimersByTimeAsync(3000);
    expect(ui.callbacks.onError).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({code: 'CAPTURE_NETWORK_ERROR'}));
    expect(ui.callbacks.onError.mock.calls[0][0].message).not.toContain('private server details');
    expect(ui.callbacks.onComplete).not.toHaveBeenCalled();
    expect(ui.track.stop).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    ui.cleanup();
  });

  it('rejects an empty video stream without producing an upload', async () => {
    const ui = harness();
    ui.video.videoWidth = 0;
    ui.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(ui.callbacks.onError).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({code: 'CAMERA_UNAVAILABLE'}));
    expect(ui.track.stop).toHaveBeenCalledOnce();
    expect(ui.upload).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    ui.cleanup();
  });

  it('continues releasing other camera tracks when one track reports an error on stop', async () => {
    const ui = harness();
    const failedTrack = {stop: vi.fn(() => { throw new Error('track already stopped'); })};
    ui.stream.getTracks = () => [failedTrack, ui.track];
    ui.start();
    await vi.advanceTimersByTimeAsync(0);
    ui.cancel();
    expect(failedTrack.stop).toHaveBeenCalledOnce();
    expect(ui.track.stop).toHaveBeenCalledOnce();
    expect(ui.callbacks.onCancel).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(3000);
    expect(ui.upload).not.toHaveBeenCalled();
    ui.cleanup();
  });

  it('caps a stalled permission request at three minutes and releases a later camera', async () => {
    const pending = deferred();
    const ui = harness({getUserMedia: vi.fn().mockReturnValue(pending.promise), credentials: {
      uploadUrl: 'https://face.example/v1/captures/signed-session', uploadToken: 'token',
      expiration: new Date(Date.now() + 3_600_000).toISOString(),
    }});
    ui.start();
    await vi.advanceTimersByTimeAsync(179_999);
    expect(ui.callbacks.onError).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(ui.callbacks.onError).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({code: 'SESSION_EXPIRED'}));
    pending.resolve(ui.stream);
    await vi.advanceTimersByTimeAsync(0);
    expect(ui.track.stop).toHaveBeenCalledOnce();
    expect(ui.upload).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    ui.cleanup();
  });

  it('aborts a stalled upload when the upload credentials expire', async () => {
    const pending = deferred();
    const ui = harness({fetch: vi.fn().mockReturnValue(pending.promise)});
    ui.start();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(ui.upload).toHaveBeenCalledOnce();
    expect(ui.upload.mock.calls[0][1].signal.aborted).toBe(true);
    expect(ui.callbacks.onError).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({code: 'SESSION_EXPIRED'}));
    pending.reject(new Error('aborted'));
    await vi.advanceTimersByTimeAsync(0);
    expect(ui.callbacks.onError).toHaveBeenCalledOnce();
    expect(ui.callbacks.onComplete).not.toHaveBeenCalled();
    ui.cleanup();
  });

  it('keeps a newer widget intact if an older cleanup runs again', () => {
    const ui = harness();
    ui.cleanup();
    const replacement = new Element('section');
    ui.container.replaceChildren(replacement);
    ui.cleanup();
    expect(ui.container.children).toEqual([replacement]);
  });
});

describe('self-hosted capture configuration', () => {
  it.each([
    'http://face.example/v1/captures/session',
    'http://localhost:8000/v1/captures/session',
    'javascript:alert(1)',
    'https://user:password@face.example/v1/captures/session',
    'https://face.example/v1/captures/session#fragment',
  ])('rejects unsafe upload URL %s before requesting camera access', uploadUrl => {
    const ui = harness({credentials: {uploadUrl, uploadToken: 'token', expiration: new Date(Date.now() + 60_000).toISOString()}});
    ui.start();
    expect(ui.camera).not.toHaveBeenCalled();
    expect(ui.upload).not.toHaveBeenCalled();
    expect(ui.callbacks.onError).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({code: 'CAPTURE_CONFIG_INVALID'}));
    expect(ui.container.children).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
    ui.cleanup();
  });

  it('allows plain HTTP only for a local development page and local worker', async () => {
    const ui = harness({hostname: 'localhost', credentials: {
      uploadUrl: 'http://127.0.0.1:8000/v1/captures/session', uploadToken: 'token',
      expiration: new Date(Date.now() + 60_000).toISOString(),
    }});
    ui.start();
    await vi.advanceTimersByTimeAsync(3000);
    expect(ui.upload).toHaveBeenCalledOnce();
    expect(ui.callbacks.onComplete).toHaveBeenCalledOnce();
    ui.cleanup();
  });

  it.each([
    {uploadToken: ''},
    {uploadToken: 'token\r\nInjected: header'},
    {expiration: 'not-a-date'},
    {expiration: '2026-10-17T04:00:03Z'},
  ])('rejects invalid or too-short-lived upload credentials', overrides => {
    const ui = harness({credentials: {
      uploadUrl: 'https://face.example/v1/captures/session', uploadToken: 'token',
      expiration: new Date(Date.now() + 60_000).toISOString(), ...overrides,
    }});
    expect(ui.callbacks.onError).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({code: 'CAPTURE_CONFIG_INVALID'}));
    expect(ui.camera).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
