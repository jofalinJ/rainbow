import base64
import hashlib
from pathlib import Path
import tempfile
import unittest
from dataclasses import replace

from fastapi.testclient import TestClient
from cryptography.exceptions import InvalidTag

from app import create_app, Settings
from storage import VectorStore


class Engine:
    ready = True
    score = .99
    vector = b'\x01\x00\x00\x00' * 128
    reject = False
    def process(self, _frames):
        if self.reject:
            raise ValueError('not live')
        return self.vector, self.score
    def similarity(self, left, right):
        return .9 if left == right else .1


class HttpTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.engine = Engine()
        self.now = 1000000000.
        self.settings = Settings('server-' + 's'*40, b'k'*32, ('https://shop.example',), Path(self.temp.name), Path(self.temp.name), True)
        self.app = create_app(self.settings, self.engine, clock=lambda: self.now)
        self.client = TestClient(self.app)
        self.client.__enter__()
        self.server = {'Authorization': 'Bearer ' + self.settings.api_key}
        self.client.post('/v1/collections', json={'collection_id':'RGC-one'}, headers=self.server).raise_for_status()

    def tearDown(self):
        self.client.__exit__(None, None, None)
        self.temp.cleanup()

    def issue(self, collection='RGC-one', mode='enrollment'):
        response = self.client.post('/v1/sessions', json={'collection_id':collection, 'mode':mode}, headers=self.server)
        response.raise_for_status()
        return response.json()

    def capture(self, session, **extra):
        headers = {'Authorization':'Bearer ' + session['upload_token'], 'Origin':'https://shop.example'}
        headers.update(extra)
        return self.client.post('/v1/sessions/' + session['session_id'] + '/capture', json={'frames':['frame']*6}, headers=headers)

    def add(self, session, collection='RGC-one'):
        return self.client.post('/v1/collections/' + collection + '/samples', json={'session_id':session['session_id']}, headers=self.server)

    def enrolled(self):
        for _ in range(3):
            session = self.issue()
            self.assertEqual(self.capture(session).json(), {'accepted':True})
            self.assertTrue(self.add(session).json()['indexed'])

    def test_server_authentication_and_browser_cannot_read_result(self):
        session = self.issue()
        self.assertEqual(self.client.post('/v1/collections', json={'collection_id':'stolen'}).status_code,401)
        self.assertEqual(self.client.get('/v1/sessions/' + session['session_id'] + '/result', headers={'Authorization':'Bearer '+session['upload_token']}).status_code,401)
        self.assertEqual(self.client.get('/health').json()['models_ready'],True)

    def test_capture_origin_token_and_single_use(self):
        session = self.issue()
        self.assertEqual(self.capture(session,Origin='https://evil.example').status_code,403)
        self.assertEqual(self.capture(session,Authorization='Bearer incorrect').status_code,401)
        self.assertEqual(self.capture(session,Authorization=self.server['Authorization']).status_code,401)
        self.assertEqual(self.capture(session).status_code,200)
        self.assertEqual(self.capture(session).status_code,409)
        result = self.client.get('/v1/sessions/'+session['session_id']+'/result',headers=self.server).json()
        self.assertEqual(result['frames_verified'],6)
        self.assertEqual(result['template_token'],session['session_id'])
        self.assertNotIn('vector',result)
        self.assertNotIn('image',result)

    def test_failed_passive_liveness_cannot_index(self):
        session = self.issue()
        self.engine.reject = True
        self.assertEqual(self.capture(session).json(), {'accepted':True})
        result = self.client.get('/v1/sessions/'+session['session_id']+'/result',headers=self.server).json()
        self.assertEqual(result['status'],'FAILED')
        self.assertEqual(self.add(session).status_code,409)

    def test_cannot_override_live_threshold_or_bad_engine_score(self):
        session = self.issue()
        self.engine.score = .94
        self.capture(session)
        self.assertEqual(self.add(session).status_code,409)
        with self.assertRaises(ValueError):
            replace(self.settings, live_threshold=.5)
        with self.assertRaises(ValueError):
            replace(self.settings, match_threshold=.3)

    def test_session_expiry_and_vector_cleanup(self):
        session = self.issue()
        self.capture(session)
        self.now += 181
        self.assertEqual(self.add(session).status_code,410)
        self.assertEqual(self.capture(session).status_code,410)
        self.assertNotIn(session['session_id'],self.app.state.worker.sessions)

    def test_collection_binding_and_sample_once(self):
        self.client.post('/v1/collections', json={'collection_id':'RGC-other'}, headers=self.server)
        session = self.issue()
        self.capture(session)
        self.assertEqual(self.add(session,'RGC-other').status_code,403)
        self.assertEqual(self.add(session).json(),{'indexed':True,'sample_count':1})
        self.assertEqual(self.add(session).status_code,409)

    def test_same_person_enrollment_and_three_sample_limit(self):
        session = self.issue(); self.capture(session); self.add(session).raise_for_status()
        second = self.issue(); self.engine.vector = b'\x02\x00\x00\x00'*128; self.capture(second)
        self.assertEqual(self.add(second).status_code,422)
        self.assertEqual(self.add(second).status_code,409)
        self.engine.vector = Engine.vector
        for _ in range(2):
            sample = self.issue(); self.capture(sample); self.add(sample).raise_for_status()
        self.assertEqual(self.client.post('/v1/sessions',json={'collection_id':'RGC-one','mode':'enrollment'},headers=self.server).status_code,409)

    def test_verify_purpose_and_single_use_and_mismatch(self):
        incomplete = self.client.post('/v1/sessions',json={'collection_id':'RGC-one','mode':'check_in'},headers=self.server)
        self.assertEqual(incomplete.status_code,409)
        self.enrolled()
        session = self.issue(mode='check_in'); self.capture(session)
        self.assertEqual(self.add(session).status_code,403)
        url = '/v1/collections/RGC-one/verify'
        body = {'session_id':session['session_id']}
        self.assertEqual(self.client.post(url,json=body,headers=self.server).json(),{'matched':True,'similarity':.9})
        self.assertEqual(self.client.post(url,json=body,headers=self.server).status_code,409)
        another = self.issue(mode='check_out');self.engine.vector=b'\x03\x00\x00\x00'*128;self.capture(another)
        self.assertEqual(self.client.post(url,json={'session_id':another['session_id']},headers=self.server).json(),{'matched':False,'similarity':.1})

    def test_deletion_removes_samples_and_pending_sessions_idempotently(self):
        self.enrolled()
        session = self.issue(mode='check_in'); self.capture(session)
        self.assertEqual(self.client.delete('/v1/collections/RGC-one',headers=self.server).json(),{'deleted':True})
        self.assertEqual(self.client.delete('/v1/collections/RGC-one',headers=self.server).status_code,200)
        self.assertEqual(self.app.state.worker.store.vectors('RGC-one'),[])
        self.assertEqual(self.client.get('/v1/sessions/'+session['session_id']+'/result',headers=self.server).status_code,410)

    def test_request_size_and_payload_controls(self):
        session = self.issue()
        url='/v1/sessions/'+session['session_id']+'/capture'
        headers={'Authorization':'Bearer '+session['upload_token'],'Origin':'https://shop.example'}
        self.assertEqual(self.client.post(url,content='x'* (8*1024*1024+1),headers=headers).status_code,413)
        self.assertEqual(self.client.post(url,json={'frames':['frame']*5},headers=headers).status_code,422)
        self.assertEqual(self.capture(session).status_code,409)

    def test_disabled_pilot_serves_truthful_health_and_rejects_creation(self):
        config=replace(self.settings,pilot_approved=False,data_dir=Path(self.temp.name)/'disabled')
        with TestClient(create_app(config,self.engine)) as client:
            self.assertFalse(client.get('/health').json()['ready'])
            self.assertEqual(client.post('/v1/sessions',headers=self.server,json={'collection_id':'RGC-one','mode':'enrollment'}).status_code,503)

    def test_exact_cors_preflight(self):
        good=self.client.options('/v1/sessions/example/capture',headers={'Origin':'https://shop.example'})
        self.assertEqual(good.headers['access-control-allow-origin'],'https://shop.example')
        self.assertEqual(self.client.options('/v1/sessions/example/capture',headers={'Origin':'https://shop.example.evil'}).status_code,403)


class StorageTests(unittest.TestCase):
    def test_encryption_survives_restart_and_binds_collection_and_sample(self):
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory);store=VectorStore(path,b'x'*32);store.create('one');store.create('two')
            vector=b'private-face-vector-'*27
            store.add('one',vector)
            raw=(path/'vectors.sqlite3').read_bytes()
            self.assertNotIn(vector,raw)
            self.assertEqual(store.vectors('one'),[vector]);store.close()
            restored=VectorStore(path,b'x'*32);self.assertEqual(restored.vectors('one'),[vector])
            restored.db.execute("UPDATE samples SET collection_id='two'");restored.db.commit()
            with self.assertRaises(InvalidTag):restored.vectors('two')
            restored.close()
            with self.assertRaises(InvalidTag):VectorStore(path,b'z'*32)

    def test_random_nonce_and_no_plaintext_pending_vector(self):
        with tempfile.TemporaryDirectory() as directory:
            store=VectorStore(Path(directory),b'x'*32)
            self.assertNotEqual(store.seal(b'vector',b'a'),store.seal(b'vector',b'a'))
            with self.assertRaises(InvalidTag):store.unseal(store.seal(b'vector',b'a'),b'b')
            store.close()


if __name__=='__main__':unittest.main()
