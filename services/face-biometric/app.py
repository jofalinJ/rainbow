"""Single-worker self-hosted biometric pilot. Run behind an HTTPS reverse proxy."""
import asyncio
import base64
from contextlib import asynccontextmanager
from dataclasses import dataclass
from datetime import datetime, timezone
import hashlib
import math
import os
from pathlib import Path
import re
import secrets
from threading import RLock, Lock
import time
import uuid
from typing import Literal
from urllib.parse import urlsplit

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field
from starlette.concurrency import run_in_threadpool

from storage import VectorStore

MAX_BODY = 8 * 1024 * 1024
SESSION_SECONDS = 180
COLLECTION_PATTERN = r'^[A-Za-z0-9:_-]{1,160}$'


@dataclass(frozen=True)
class Settings:
    api_key: str
    template_key: bytes
    origins: tuple[str, ...]
    data_dir: Path
    model_dir: Path
    pilot_approved: bool = False
    live_threshold: float = .95
    match_threshold: float = .5

    def __post_init__(self):
        if len(self.api_key) < 32 or len(self.template_key) != 32:
            raise ValueError('Set a >=32-character API key and a base64-encoded 32-byte template key')
        if not self.origins:
            raise ValueError('At least one exact browser origin is required')
        for origin in self.origins:
            parsed = urlsplit(origin)
            if parsed.username or parsed.password or parsed.path or parsed.query or parsed.fragment or not parsed.hostname or origin != f'{parsed.scheme}://{parsed.netloc}':
                raise ValueError('Use exact origins without paths or trailing slash')
            if parsed.scheme != 'https' and not (parsed.scheme == 'http' and parsed.hostname in ('localhost', '127.0.0.1', '[::1]', '::1')):
                raise ValueError('Browser origins must use HTTPS (except localhost)')
        if not math.isfinite(self.live_threshold) or not .95 <= self.live_threshold <= 1:
            raise ValueError('FACE_LIVE_THRESHOLD must be between 0.95 and 1')
        if not math.isfinite(self.match_threshold) or not .5 <= self.match_threshold <= 1:
            raise ValueError('FACE_MATCH_THRESHOLD must be between 0.5 and 1')

    @classmethod
    def from_env(cls):
        return cls(
            api_key=os.environ.get('FACE_SERVICE_API_KEY', ''),
            template_key=base64.b64decode(os.environ.get('FACE_TEMPLATE_KEY', ''), validate=True),
            origins=tuple(x.strip() for x in os.environ.get('FACE_ALLOWED_ORIGINS', '').split(',') if x.strip()),
            data_dir=Path(os.environ.get('FACE_DATA_DIR', './data')),
            model_dir=Path(os.environ.get('FACE_MODEL_DIR', './models')),
            pilot_approved=os.environ.get('FACE_PILOT_APPROVED') == 'true',
            live_threshold=float(os.environ.get('FACE_LIVE_THRESHOLD', '.95')),
            match_threshold=float(os.environ.get('FACE_MATCH_THRESHOLD', '.5')),
        )


class StrictBody(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)


class CollectionBody(StrictBody):
    collection_id: str = Field(pattern=COLLECTION_PATTERN)


class SessionBody(CollectionBody):
    mode: Literal['enrollment', 'check_in', 'check_out']


class SessionReference(StrictBody):
    session_id: str = Field(min_length=20, max_length=120, pattern=r'^[A-Za-z0-9_-]+$')


class BoundedBody:
    """Limits chunked and Content-Length requests before JSON parsing."""
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope['type'] != 'http':
            return await self.app(scope, receive, send)
        headers = dict(scope.get('headers', []))
        try:
            if int(headers.get(b'content-length', b'0')) > MAX_BODY:
                return await JSONResponse({'detail': 'Request too large'}, 413)(scope, receive, send)
        except ValueError:
            return await JSONResponse({'detail': 'Invalid content length'}, 400)(scope, receive, send)
        body = bytearray()
        while True:
            message = await receive()
            if message['type'] == 'http.disconnect':
                return
            body.extend(message.get('body', b''))
            if len(body) > MAX_BODY:
                return await JSONResponse({'detail': 'Request too large'}, 413)(scope, receive, send)
            if not message.get('more_body'):
                break
        sent = False

        async def bounded_receive():
            nonlocal sent
            if not sent:
                sent = True
                return {'type': 'http.request', 'body': bytes(body), 'more_body': False}
            return await receive()
        await self.app(scope, bounded_receive, send)


class State:
    def __init__(self, settings, engine, clock):
        self.settings, self.engine, self.clock = settings, engine, clock
        self.store = VectorStore(settings.data_dir, settings.template_key)
        self.lock = RLock()
        self.inference_lock = Lock()
        self.sessions = {}

    def cleanup(self):
        with self.lock:
            for session_id in list(self.sessions):
                if self.sessions[session_id]['expires'] <= self.clock():
                    del self.sessions[session_id]

    def get(self, session_id):
        self.cleanup()
        session = self.sessions.get(session_id)
        if not session:
            raise HTTPException(410, 'Capture session expired or unavailable')
        return session

    def vector(self, session_id, collection_id, enrollment):
        session = self.get(session_id)
        if session['collection_id'] != collection_id or (session['mode'] == 'enrollment') != enrollment:
            raise HTTPException(403, 'Capture is bound to another collection or purpose')
        if session['status'] != 'SUCCEEDED' or not session['template'] or session['used']:
            raise HTTPException(409, 'A fresh successful capture is required')
        # Consume before a decision; never reusable after success, failure, or mismatch.
        session['used'] = True
        encrypted = session.pop('template')
        session['template'] = None
        return self.store.unseal(encrypted, ('capture\0' + session_id + '\0' + collection_id).encode())


def create_app(settings=None, engine=None, clock=time.time):
    @asynccontextmanager
    async def lifespan(application):
        config = settings or Settings.from_env()
        loaded_engine = engine
        if loaded_engine is None:
            try:
                from inference import FaceEngine
                loaded_engine = FaceEngine(config.model_dir, config.live_threshold, config.match_threshold)
            except Exception:
                # Public health remains truthful; never substitutes a fake engine.
                loaded_engine = None
        application.state.worker = State(config, loaded_engine, clock)
        async def expire_sessions():
            while True:
                await asyncio.sleep(5)
                application.state.worker.cleanup()
        cleanup_task = asyncio.create_task(expire_sessions())
        try:
            yield
        finally:
            cleanup_task.cancel()
            try:
                await cleanup_task
            except asyncio.CancelledError:
                pass
            application.state.worker.sessions.clear()
            application.state.worker.store.close()

    application = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)
    # Origins are checked explicitly at capture and preflight, including when env is read at startup.
    application.add_middleware(BoundedBody)

    @application.exception_handler(RequestValidationError)
    async def validation_error(_request, _error):
        return JSONResponse({'detail': 'Invalid request fields'}, 422)

    @application.middleware('http')
    async def browser_headers(request, call_next):
        origin = request.headers.get('origin')
        worker = getattr(application.state, 'worker', None)
        allowed = worker is not None and origin in worker.settings.origins
        if request.method == 'OPTIONS':
            if not allowed:
                return JSONResponse({'detail': 'Origin is not allowed'}, 403)
            response = JSONResponse({}, 200)
            response.headers['Access-Control-Allow-Methods'] = 'POST, OPTIONS'
            response.headers['Access-Control-Allow-Headers'] = 'Authorization, Content-Type'
            response.headers['Access-Control-Max-Age'] = '600'
        else:
            response = await call_next(request)
        if allowed:
            response.headers['Access-Control-Allow-Origin'] = origin
            response.headers['Vary'] = 'Origin'
        response.headers['Cache-Control'] = 'no-store'
        response.headers['X-Content-Type-Options'] = 'nosniff'
        return response

    def state(request):
        return request.app.state.worker

    def server(request):
        worker = state(request)
        expected = 'Bearer ' + worker.settings.api_key
        if not secrets.compare_digest(request.headers.get('authorization', '').encode(), expected.encode()):
            raise HTTPException(401, 'Server authentication required')
        return worker

    def active(worker):
        if not worker.settings.pilot_approved or not worker.engine or not worker.engine.ready:
            raise HTTPException(503, 'Self-hosted biometric pilot is not ready')

    @application.get('/health')
    def health(request: Request):
        worker = state(request)
        ready = bool(worker.engine and worker.engine.ready)
        return {'provider': 'self_hosted', 'models_ready': ready, 'pilot_approved': worker.settings.pilot_approved, 'ready': ready and worker.settings.pilot_approved}

    @application.post('/v1/collections')
    def create_collection(body: CollectionBody, request: Request):
        worker = server(request)
        active(worker)
        with worker.lock:
            worker.store.create(body.collection_id)
        return {'collection_id': body.collection_id}

    @application.delete('/v1/collections/{collection_id}')
    def delete_collection(collection_id: str, request: Request):
        worker = server(request)
        if not re.fullmatch(COLLECTION_PATTERN, collection_id):
            raise HTTPException(422, 'Invalid collection')
        with worker.lock:
            worker.store.delete(collection_id)
            for session_id in list(worker.sessions):
                if worker.sessions[session_id]['collection_id'] == collection_id:
                    del worker.sessions[session_id]
        return {'deleted': True}

    @application.post('/v1/sessions')
    def create_session(body: SessionBody, request: Request):
        worker = server(request)
        active(worker)
        with worker.lock:
            worker.cleanup()
            if not worker.store.exists(body.collection_id):
                raise HTTPException(404, 'Collection not found')
            if len(worker.sessions) >= 512 or sum(x['collection_id'] == body.collection_id for x in worker.sessions.values()) >= 8:
                raise HTTPException(429, 'Too many active capture sessions')
            if body.mode != 'enrollment' and len(worker.store.vectors(body.collection_id)) != 3:
                raise HTTPException(409, 'Enrollment requires three samples')
            if body.mode == 'enrollment' and len(worker.store.vectors(body.collection_id)) >= 3:
                raise HTTPException(409, 'Enrollment is complete')
            session_id, token = str(uuid.uuid4()), secrets.token_urlsafe(32)
            expires = worker.clock() + SESSION_SECONDS
            worker.sessions[session_id] = {'collection_id': body.collection_id, 'mode': body.mode, 'token_hash': hashlib.sha256(token.encode()).digest(), 'expires': expires, 'claimed': False, 'status': 'PENDING', 'template': None, 'used': False, 'live_score': 0.}
        return {'session_id': session_id, 'upload_token': token, 'expires_at': datetime.fromtimestamp(expires, timezone.utc).isoformat().replace('+00:00', 'Z'), 'challenge': {'type': 'passive_multiframe', 'frame_count': 6, 'interval_ms': 600}}

    @application.post('/v1/sessions/{session_id}/capture')
    async def capture(session_id: str, request: Request):
        worker = state(request)
        active(worker)
        if request.headers.get('origin') not in worker.settings.origins:
            raise HTTPException(403, 'Origin is not allowed')
        auth = request.headers.get('authorization', '')
        if not auth.startswith('Bearer ') or len(auth) > 200:
            raise HTTPException(401, 'Capture authentication required')
        with worker.lock:
            session = worker.get(session_id)
            if not secrets.compare_digest(hashlib.sha256(auth[7:].encode()).digest(), session['token_hash']):
                raise HTTPException(401, 'Capture authentication required')
            if session['claimed']:
                raise HTTPException(409, 'Capture token was already used')
            session['claimed'] = True
        try:
            if request.headers.get('content-type', '').split(';')[0] != 'application/json':
                raise HTTPException(415, 'JSON camera frames required')
            body = await request.json()
            if not isinstance(body, dict) or set(body) != {'frames'} or not isinstance(body['frames'], list) or len(body['frames']) != 6 or any(not isinstance(frame, str) for frame in body['frames']):
                raise HTTPException(422, 'Exactly six camera JPEG frames are required')
            if not worker.inference_lock.acquire(blocking=False):
                raise HTTPException(429, 'Camera processing is busy; retry with a fresh session')
            try:
                vector, live = await run_in_threadpool(worker.engine.process, body['frames'])
            finally:
                worker.inference_lock.release()
            if not isinstance(vector, bytes) or len(vector) != 512 or not math.isfinite(live) or not worker.settings.live_threshold <= live <= 1:
                raise ValueError('Capture did not pass')
            with worker.lock:
                current = worker.get(session_id)
                current['template'] = worker.store.seal(vector, ('capture\0' + session_id + '\0' + current['collection_id']).encode())
                current['live_score'], current['status'] = live, 'SUCCEEDED'
        except HTTPException:
            with worker.lock:
                if session_id in worker.sessions:
                    worker.sessions[session_id]['status'] = 'FAILED'
            raise
        except Exception:
            # Rejections have the same public response; identity details stay server-side.
            with worker.lock:
                if session_id in worker.sessions:
                    worker.sessions[session_id]['status'] = 'FAILED'
        return {'accepted': True}

    @application.get('/v1/sessions/{session_id}/result')
    def result(session_id: str, request: Request):
        worker = server(request)
        with worker.lock:
            session = worker.get(session_id)
            if session['status'] != 'SUCCEEDED':
                return {'status': session['status'], 'provider': 'self_hosted', 'template_token': session_id}
            return {'status': 'SUCCEEDED', 'provider': 'self_hosted', 'confidence': session['live_score'] * 100, 'face_count': 1, 'quality_passed': True, 'live_score': session['live_score'], 'frames_verified': 6, 'template_token': session_id}

    @application.post('/v1/collections/{collection_id}/samples')
    def sample(collection_id: str, body: SessionReference, request: Request):
        worker = server(request)
        active(worker)
        with worker.lock:
            vector = worker.vector(body.session_id, collection_id, True)
            previous = worker.store.vectors(collection_id)
            if any(worker.engine.similarity(old, vector) < worker.settings.match_threshold for old in previous):
                raise HTTPException(422, 'Enrollment samples must show the same person')
            try:
                index = worker.store.add(collection_id, vector)
            except ValueError:
                raise HTTPException(409, 'Enrollment already has three samples')
        return {'indexed': True, 'sample_count': index}

    @application.post('/v1/collections/{collection_id}/verify')
    def verify(collection_id: str, body: SessionReference, request: Request):
        worker = server(request)
        active(worker)
        with worker.lock:
            vector = worker.vector(body.session_id, collection_id, False)
            enrolled = worker.store.vectors(collection_id)
            if len(enrolled) != 3:
                raise HTTPException(409, 'Enrollment requires three samples')
            similarity = min(worker.engine.similarity(old, vector) for old in enrolled)
        return {'matched': similarity >= worker.settings.match_threshold, 'similarity': similarity}

    return application


app = create_app()
