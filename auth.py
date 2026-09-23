"""Local accounts, password hashing, sessions and saved contractor identifiers."""
from collections import OrderedDict, deque
from contextlib import contextmanager
import hashlib
import hmac
import math
from pathlib import Path
import re
import secrets
import sqlite3
import threading
import time
import unicodedata


PASSWORD_ITERATIONS = 600_000
SESSION_SECONDS = 7 * 24 * 60 * 60
COOKIE_NAME = 'toyga_session'


class AuthError(ValueError):
    def __init__(self, message, status=400, code='invalid_input', retry_after=None):
        super().__init__(message)
        self.status = status
        self.code = code
        self.retry_after = retry_after


def _email(value):
    if not isinstance(value, str):
        raise AuthError('Укажите корректный email')
    value = value.strip().casefold()
    if (len(value) > 254 or not re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+', value)
            or any(unicodedata.category(char).startswith('C') for char in value)):
        raise AuthError('Укажите корректный email')
    return value


def _password(value):
    if not isinstance(value, str) or not 8 <= len(value) <= 128:
        raise AuthError('Пароль должен содержать от 8 до 128 символов')
    return value


def _name(value):
    if not isinstance(value, str):
        raise AuthError('Имя должно содержать от 2 до 80 символов')
    value = value.strip()
    if not 2 <= len(value) <= 80 or any(unicodedata.category(char).startswith('C') for char in value):
        raise AuthError('Имя должно содержать от 2 до 80 символов без управляющих знаков')
    return value


def _public_user(row):
    return {field: row[field] for field in ('id', 'name', 'email')}


def _token_hash(token):
    if not isinstance(token, str) or not re.fullmatch(r'[A-Za-z0-9_-]{43}', token):
        return None
    return hashlib.sha256(token.encode('ascii')).hexdigest()


class AccountStore:
    """Each operation owns its SQLite connection; safe for ThreadingHTTPServer."""

    def __init__(self, path, clock=None):
        self.path = Path(path)
        self.clock = clock or time.time
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self._connection() as connection:
            connection.execute('PRAGMA journal_mode=WAL')
            connection.executescript('''
                CREATE TABLE IF NOT EXISTS users (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    email TEXT NOT NULL UNIQUE,
                    password_salt BLOB NOT NULL,
                    password_hash BLOB NOT NULL,
                    password_iterations INTEGER NOT NULL,
                    created_at REAL NOT NULL
                );
                CREATE TABLE IF NOT EXISTS sessions (
                    token_hash TEXT PRIMARY KEY,
                    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    expires_at REAL NOT NULL
                );
                CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
                CREATE TABLE IF NOT EXISTS favorites (
                    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    catalog_id TEXT NOT NULL,
                    profile_id TEXT NOT NULL,
                    position INTEGER NOT NULL,
                    PRIMARY KEY (user_id, catalog_id, profile_id)
                );
            ''')
        self.path.chmod(0o600)

    @contextmanager
    def _connection(self):
        connection = sqlite3.connect(str(self.path), timeout=10)
        connection.row_factory = sqlite3.Row
        connection.execute('PRAGMA foreign_keys=ON')
        try:
            with connection:
                yield connection
        finally:
            connection.close()

    def register(self, name, email, password):
        name, email, password = _name(name), _email(email), _password(password)
        salt = secrets.token_bytes(32)
        password_hash = hashlib.pbkdf2_hmac('sha256', password.encode('utf-8'), salt, PASSWORD_ITERATIONS)
        user = {'id': secrets.token_hex(16), 'name': name, 'email': email}
        try:
            with self._connection() as connection:
                connection.execute('''INSERT INTO users
                    (id, name, email, password_salt, password_hash, password_iterations, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?)''',
                    (user['id'], name, email, salt, password_hash, PASSWORD_ITERATIONS, self.clock()))
        except sqlite3.IntegrityError as exc:
            raise AuthError('Аккаунт с этим email уже существует', 409, 'email_exists') from exc
        return user

    def login(self, email, password):
        email, password = _email(email), _password(password)
        with self._connection() as connection:
            user = connection.execute('SELECT * FROM users WHERE email = ?', (email,)).fetchone()
        # Unknown emails still perform the same expensive password operation.
        salt = user['password_salt'] if user else b'\0' * 32
        iterations = user['password_iterations'] if user else PASSWORD_ITERATIONS
        candidate = hashlib.pbkdf2_hmac('sha256', password.encode('utf-8'), salt, iterations)
        expected = user['password_hash'] if user else b'\0' * 32
        if not hmac.compare_digest(candidate, expected) or not user:
            raise AuthError('Неверный email или пароль', 401, 'invalid_credentials')
        return _public_user(user)

    def issue_session(self, user_id):
        token = secrets.token_urlsafe(32)
        now = self.clock()
        with self._connection() as connection:
            connection.execute('DELETE FROM sessions WHERE expires_at <= ?', (now,))
            connection.execute('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)',
                               (_token_hash(token), user_id, now + SESSION_SECONDS))
        return token

    def session_user(self, token):
        token_hash = _token_hash(token)
        if token_hash is None:
            return None
        with self._connection() as connection:
            connection.execute('DELETE FROM sessions WHERE expires_at <= ?', (self.clock(),))
            row = connection.execute('''SELECT users.id, users.name, users.email FROM sessions
                JOIN users ON sessions.user_id = users.id WHERE sessions.token_hash = ?''',
                (token_hash,)).fetchone()
        return _public_user(row) if row else None

    def revoke_session(self, token):
        token_hash = _token_hash(token)
        if token_hash:
            with self._connection() as connection:
                connection.execute('DELETE FROM sessions WHERE token_hash = ?', (token_hash,))

    def get_favorites(self, user_id, catalog_id):
        with self._connection() as connection:
            rows = connection.execute('''SELECT profile_id FROM favorites
                WHERE user_id = ? AND catalog_id = ? ORDER BY position''', (user_id, catalog_id)).fetchall()
        return [row['profile_id'] for row in rows]

    def set_favorites(self, user_id, catalog_id, ids):
        with self._connection() as connection:
            connection.execute('DELETE FROM favorites WHERE user_id = ? AND catalog_id = ?', (user_id, catalog_id))
            connection.executemany('''INSERT INTO favorites (user_id, catalog_id, profile_id, position)
                VALUES (?, ?, ?, ?)''', [(user_id, catalog_id, profile_id, position) for position, profile_id in enumerate(ids)])


def validate_favorites(raw, profiles, catalog_id):
    """Validate against the active catalog before replacing a user's saved list."""
    requested_catalog = raw.get('catalog_id')
    if not isinstance(requested_catalog, str) or not requested_catalog or len(requested_catalog) > 80:
        raise AuthError('Передайте идентификатор каталога')
    if requested_catalog != catalog_id:
        raise AuthError('Каталог обновился. Перезагрузите страницу и повторите сохранение', 409, 'catalog_changed')
    ids = raw.get('ids')
    if not isinstance(ids, list) or len(ids) > 5000 or any(not isinstance(value, str) for value in ids):
        raise AuthError('Избранное должно содержать не более 5 000 идентификаторов')
    available = {profile['id'] for profile in profiles}
    if any(value not in available for value in ids):
        raise AuthError('В избранном есть подрядчики, которых нет в текущем каталоге')
    if len(set(ids)) != len(ids):
        raise AuthError('Идентификаторы в избранном не должны повторяться')
    return ids


class RateLimiter:
    """Bounded in-memory sliding windows for this single-process local server."""

    def __init__(self, clock=None):
        self.clock = clock or time.monotonic
        self.lock = threading.Lock()
        self.attempts = OrderedDict()

    def check(self, key, limit=10, window=15 * 60):
        now = self.clock()
        with self.lock:
            bucket = self.attempts.setdefault(key, deque())
            self.attempts.move_to_end(key)
            while bucket and bucket[0] <= now - window:
                bucket.popleft()
            if len(bucket) >= limit:
                retry_after = max(1, math.ceil(bucket[0] + window - now))
                raise AuthError('Слишком много попыток. Попробуйте позже', 429, 'rate_limited', retry_after)
            bucket.append(now)
            while len(self.attempts) > 4096:
                self.attempts.popitem(last=False)
