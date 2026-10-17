"""Encrypted biometric vectors only; never stores photographs or names."""
import os
import secrets
import sqlite3
from pathlib import Path
from threading import RLock

from cryptography.hazmat.primitives.ciphers.aead import AESGCM


class VectorStore:
    def __init__(self, directory: Path, key: bytes):
        directory.mkdir(parents=True, exist_ok=True, mode=0o700)
        os.chmod(directory, 0o700)
        self.aes = AESGCM(key)
        self.lock = RLock()
        self.db = sqlite3.connect(directory / 'vectors.sqlite3', check_same_thread=False)
        os.chmod(directory / 'vectors.sqlite3', 0o600)
        self.db.execute('PRAGMA foreign_keys=ON')
        self.db.execute('PRAGMA secure_delete=ON')
        self.db.execute('CREATE TABLE IF NOT EXISTS collections (id TEXT PRIMARY KEY)')
        self.db.execute('CREATE TABLE IF NOT EXISTS samples (id TEXT PRIMARY KEY, collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE, ciphertext BLOB NOT NULL)')
        self.db.execute('CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value BLOB NOT NULL)')
        marker = self.db.execute("SELECT value FROM metadata WHERE key='encryption-check'").fetchone()
        if marker:
            if self.unseal(marker[0], b'key-check') != b'face-vectors-v1':
                raise ValueError('Invalid template encryption key')
        else:
            self.db.execute("INSERT INTO metadata VALUES ('encryption-check', ?)", (self.seal(b'face-vectors-v1', b'key-check'),))
        self.db.commit()

    def seal(self, raw: bytes, aad: bytes) -> bytes:
        nonce = secrets.token_bytes(12)
        return nonce + self.aes.encrypt(nonce, raw, aad)

    def unseal(self, encrypted: bytes, aad: bytes) -> bytes:
        return self.aes.decrypt(encrypted[:12], encrypted[12:], aad)

    def create(self, collection_id: str):
        with self.lock, self.db:
            self.db.execute('INSERT OR IGNORE INTO collections VALUES (?)', (collection_id,))

    def exists(self, collection_id: str) -> bool:
        with self.lock:
            return self.db.execute('SELECT 1 FROM collections WHERE id=?', (collection_id,)).fetchone() is not None

    def delete(self, collection_id: str):
        with self.lock, self.db:
            self.db.execute('DELETE FROM collections WHERE id=?', (collection_id,))

    @staticmethod
    def aad(collection_id, sample_id):
        return ('face-vector-v1\0' + collection_id + '\0' + sample_id).encode()

    def vectors(self, collection_id: str) -> list[bytes]:
        with self.lock:
            rows = self.db.execute('SELECT id, ciphertext FROM samples WHERE collection_id=? ORDER BY rowid', (collection_id,)).fetchall()
            return [self.unseal(ciphertext, self.aad(collection_id, sample_id)) for sample_id, ciphertext in rows]

    def add(self, collection_id: str, raw: bytes) -> int:
        with self.lock, self.db:
            count = self.db.execute('SELECT count(*) FROM samples WHERE collection_id=?', (collection_id,)).fetchone()[0]
            if count >= 3:
                raise ValueError('Collection already has three samples')
            sample_id = secrets.token_urlsafe(24)
            self.db.execute('INSERT INTO samples VALUES (?, ?, ?)', (sample_id, collection_id, self.seal(raw, self.aad(collection_id, sample_id))))
            return count + 1

    def close(self):
        self.db.close()
