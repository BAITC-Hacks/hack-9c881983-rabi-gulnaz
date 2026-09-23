from concurrent.futures import ThreadPoolExecutor
from email.message import Message
from email.parser import BytesParser
from io import BytesIO
import json
from pathlib import Path
import sqlite3
import tempfile
from types import SimpleNamespace
import unittest

from auth import AccountStore, AuthError, COOKIE_NAME, PASSWORD_ITERATIONS, RateLimiter, SESSION_SECONDS, validate_favorites
import server


class AccountStoreTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.now = [1000.0]
        self.path = Path(self.directory.name) / 'accounts.sqlite3'
        self.store = AccountStore(self.path, clock=lambda: self.now[0])

    def create_user(self, email='test@example.com', name='Гость'):
        return self.store.register(name, email, 'example-password')

    def test_registration_normalizes_email_and_returns_no_password(self):
        user = self.create_user('  Test@Example.com  ', '  Гульназ  ')
        self.assertEqual(user['name'], 'Гульназ')
        self.assertEqual(user['email'], 'test@example.com')
        self.assertEqual(set(user), {'id', 'name', 'email'})
        self.assertEqual(user, self.store.login('TEST@example.com', 'example-password'))

    def test_passwords_are_salted_and_hashed_with_required_work_factor(self):
        self.create_user()
        self.create_user('second@example.com')
        with sqlite3.connect(str(self.path)) as connection:
            rows = connection.execute('SELECT password_salt, password_hash, password_iterations FROM users').fetchall()
        self.assertNotEqual(rows[0][0], rows[1][0])
        self.assertNotEqual(rows[0][1], rows[1][1])
        for salt, password_hash, iterations in rows:
            self.assertEqual(len(salt), 32)
            self.assertEqual(len(password_hash), 32)
            self.assertGreaterEqual(iterations, 600_000)
            self.assertEqual(iterations, PASSWORD_ITERATIONS)
        self.assertNotIn(b'example-password', self.path.read_bytes())

    def test_unknown_account_and_wrong_password_have_identical_errors(self):
        self.create_user()
        errors = []
        for email in ('test@example.com', 'missing@example.com'):
            with self.assertRaises(AuthError) as caught:
                self.store.login(email, 'wrong-password')
            errors.append((str(caught.exception), caught.exception.status, caught.exception.code))
        self.assertEqual(errors[0], errors[1])
        self.assertEqual(errors[0][1:], (401, 'invalid_credentials'))

    def test_duplicate_email_is_case_insensitive(self):
        self.create_user()
        with self.assertRaises(AuthError) as caught:
            self.create_user('TEST@example.com')
        self.assertEqual(caught.exception.status, 409)

    def test_registration_validates_name_email_and_password_bounds(self):
        invalid = [
            ('А', 'test@example.com', '12345678'),
            ('А' * 81, 'test@example.com', '12345678'),
            ('Имя\nДругое', 'test@example.com', '12345678'),
            ('Имя', 'test', '12345678'),
            ('Имя', 'x@exa\nmple.com', '12345678'),
            ('Имя', 'test@example.com', '1234567'),
            ('Имя', 'test@example.com', '1' * 129),
            ('Имя', 'test@example.com', None),
        ]
        for index, values in enumerate(invalid):
            with self.subTest(index=index), self.assertRaises(AuthError) as caught:
                self.store.register(*values)
            self.assertEqual(caught.exception.status, 400)

    def test_session_is_hashed_and_expires_after_seven_days(self):
        user = self.create_user()
        token = self.store.issue_session(user['id'])
        with sqlite3.connect(str(self.path)) as connection:
            row = connection.execute('SELECT token_hash, expires_at FROM sessions').fetchone()
        self.assertNotEqual(row[0], token)
        self.assertEqual(row[1], self.now[0] + SESSION_SECONDS)
        self.assertEqual(self.store.session_user(token), user)
        self.assertNotIn(token.encode(), self.path.read_bytes())
        self.now[0] += SESSION_SECONDS
        self.assertIsNone(self.store.session_user(token))
        self.assertIsNone(self.store.session_user('invalid-token'))

    def test_logout_revokes_only_the_current_session(self):
        user = self.create_user()
        token = self.store.issue_session(user['id'])
        other = self.store.issue_session(user['id'])
        self.store.revoke_session(token)
        self.assertIsNone(self.store.session_user(token))
        self.assertEqual(self.store.session_user(other), user)
        self.store.revoke_session(None)

    def test_favorites_are_persistent_and_isolated_by_user_and_catalog(self):
        first = self.create_user()
        second = self.create_user('second@example.com')
        self.store.set_favorites(first['id'], 'catalog-a', ['two', 'one'])
        self.store.set_favorites(second['id'], 'catalog-a', ['three'])
        self.store.set_favorites(first['id'], 'catalog-b', ['four'])
        reopened = AccountStore(self.path)
        self.assertEqual(reopened.get_favorites(first['id'], 'catalog-a'), ['two', 'one'])
        self.assertEqual(reopened.get_favorites(second['id'], 'catalog-a'), ['three'])
        self.assertEqual(reopened.get_favorites(first['id'], 'catalog-b'), ['four'])
        reopened.set_favorites(first['id'], 'catalog-a', [])
        self.assertEqual(reopened.get_favorites(first['id'], 'catalog-a'), [])
        self.assertEqual(reopened.get_favorites(second['id'], 'catalog-a'), ['three'])

    def test_concurrent_operations_use_independent_connections(self):
        user = self.create_user()
        def request(_):
            token = self.store.issue_session(user['id'])
            return self.store.session_user(token)
        with ThreadPoolExecutor(max_workers=4) as pool:
            result = list(pool.map(request, range(12)))
        self.assertEqual(result, [user] * 12)


class AuthValidationTests(unittest.TestCase):
    def test_favorites_reject_stale_catalog_unknown_duplicate_and_invalid_ids(self):
        profiles = [{'id': 'one'}, {'id': 'two'}]
        self.assertEqual(validate_favorites({'ids': ['two', 'one'], 'catalog_id': 'new'}, profiles, 'new'), ['two', 'one'])
        for data, status in [
            ({'ids': ['one'], 'catalog_id': 'old'}, 409),
            ({'ids': ['missing'], 'catalog_id': 'new'}, 400),
            ({'ids': ['one', 'one'], 'catalog_id': 'new'}, 400),
            ({'ids': [None], 'catalog_id': 'new'}, 400),
            ({'ids': 'one', 'catalog_id': 'new'}, 400),
            ({'ids': ['one'] * 5001, 'catalog_id': 'new'}, 400),
        ]:
            with self.assertRaises(AuthError) as caught:
                validate_favorites(data, profiles, 'new')
            self.assertEqual(caught.exception.status, status)

    def test_rate_limit_returns_retry_delay_and_allows_after_window(self):
        now = [100.0]
        limiter = RateLimiter(clock=lambda: now[0])
        limiter.check('address', limit=2, window=10)
        limiter.check('address', limit=2, window=10)
        with self.assertRaises(AuthError) as caught:
            limiter.check('address', limit=2, window=10)
        self.assertEqual(caught.exception.status, 429)
        self.assertEqual(caught.exception.retry_after, 10)
        limiter.check('another-address', limit=2, window=10)
        now[0] += 10
        limiter.check('address', limit=2, window=10)


class QuietHandler(server.Handler):
    def log_message(self, *args):
        pass


class AccountHTTPTests(unittest.TestCase):
    """Exercise handlers and real SQLite without sockets or the user's account DB."""

    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.http_server = SimpleNamespace(
            account_store=AccountStore(Path(directory.name) / 'accounts.sqlite3'),
            auth_limiter=RateLimiter(), enable_data_tools=False,
        )
        previous = dict(server.STATE)
        self.addCleanup(lambda: server.STATE.update(previous))
        server.STATE.update(profiles=[{'id': 'one', 'anon_name': 'Первый'}, {'id': 'two', 'anon_name': 'Второй'}], catalog_id='current', source='test')

    def request(self, path, data=None, cookie=None, extra_headers=None):
        handler = QuietHandler.__new__(QuietHandler)
        handler.path = path
        handler.command = 'GET' if data is None else 'POST'
        handler.request_version = 'HTTP/1.1'
        handler.requestline = '{} {} HTTP/1.1'.format(handler.command, path)
        handler.client_address = ('127.0.0.1', 10000)
        handler.connection = object()
        handler.server = self.http_server
        handler.headers = Message()
        headers = {'Host': '127.0.0.1:8000', 'Content-Type': 'application/json'}
        if cookie:
            headers['Cookie'] = cookie
        headers.update(extra_headers or {})
        for key, value in headers.items():
            handler.headers[key] = value
        body = json.dumps(data).encode() if data is not None else b''
        handler.headers['Content-Length'] = str(len(body))
        handler.rfile = BytesIO(body)
        handler.wfile = BytesIO()
        handler.do_GET() if data is None else handler.do_POST()
        raw_headers, raw_body = handler.wfile.getvalue().split(b'\r\n\r\n', 1)
        status_line, header_lines = raw_headers.split(b'\r\n', 1)
        return int(status_line.split()[1]), BytesParser().parsebytes(header_lines), json.loads(raw_body)

    def registered(self):
        status, headers, body = self.request('/api/auth/register', {'name': 'Гость', 'email': 'guest@example.com', 'password': 'example-password'})
        self.assertEqual(status, 200)
        return headers['Set-Cookie'].split(';', 1)[0], body['user']

    def test_register_session_login_logout_and_cookie_security(self):
        self.assertEqual(self.request('/api/auth/session')[2], {'user': None})
        status, headers, body = self.request('/api/auth/register', {'name': 'Гость', 'email': 'guest@example.com', 'password': 'example-password'})
        self.assertEqual(status, 200)
        cookie_header = headers['Set-Cookie']
        self.assertIn('HttpOnly', cookie_header)
        self.assertIn('SameSite=Lax', cookie_header)
        self.assertIn('Max-Age=604800', cookie_header)
        self.assertNotIn('Secure', cookie_header)  # This request uses local plain HTTP.
        self.assertEqual(headers['Cache-Control'], 'no-store')
        cookie = cookie_header.split(';', 1)[0]
        self.assertEqual(self.request('/api/auth/session', cookie=cookie)[2], body)
        status, logout_headers, logged_out = self.request('/api/auth/logout', {}, cookie)
        self.assertEqual((status, logged_out), (200, {'user': None}))
        self.assertIn('Max-Age=0', logout_headers['Set-Cookie'])
        self.assertEqual(self.request('/api/auth/session', cookie=cookie)[2], {'user': None})
        status, headers, login = self.request('/api/auth/login', {'email': 'guest@example.com', 'password': 'example-password'})
        self.assertEqual((status, login), (200, body))
        self.assertIn(COOKIE_NAME, headers['Set-Cookie'])

    def test_favorites_require_authentication_and_reject_stale_writes(self):
        self.assertEqual(self.request('/api/account/favorites')[0], 401)
        self.assertEqual(self.request('/api/account/favorites', {'ids': [], 'catalog_id': 'current'})[0], 401)
        cookie, user = self.registered()
        status, _, favorites = self.request('/api/account/favorites', {'ids': ['two'], 'catalog_id': 'current', 'expected_user_id': user['id']}, cookie)
        self.assertEqual(status, 200)
        self.assertEqual(favorites, {'profiles': [{'id': 'two', 'anon_name': 'Второй'}], 'catalog_id': 'current', 'user_id': user['id']})
        self.assertEqual(self.request('/api/account/favorites', {'ids': [], 'catalog_id': 'stale', 'expected_user_id': user['id']}, cookie)[0], 409)
        self.assertEqual(self.request('/api/account/favorites', cookie=cookie)[2], favorites)

    def test_stale_tab_cannot_replace_another_accounts_favorites(self):
        cookie_a, user_a = self.registered()
        status, headers, registration = self.request('/api/auth/register', {'name': 'Другой', 'email': 'other@example.com', 'password': 'example-password'})
        self.assertEqual(status, 200)
        cookie_b = headers['Set-Cookie'].split(';', 1)[0]
        user_b = registration['user']
        self.request('/api/account/favorites', {'ids': ['one'], 'catalog_id': 'current', 'expected_user_id': user_a['id']}, cookie_a)
        self.request('/api/account/favorites', {'ids': ['two'], 'catalog_id': 'current', 'expected_user_id': user_b['id']}, cookie_b)
        # A tab still displays A's list, but the shared browser cookie now belongs to B.
        status, _, error = self.request('/api/account/favorites', {'ids': ['one'], 'catalog_id': 'current', 'expected_user_id': user_a['id']}, cookie_b)
        self.assertEqual((status, error['code']), (409, 'account_changed'))
        # Omitting the identity check must also fail before replacing the list.
        status, _, error = self.request('/api/account/favorites', {'ids': [], 'catalog_id': 'current'}, cookie_b)
        self.assertEqual((status, error['code']), (409, 'account_changed'))
        favorites_a = self.request('/api/account/favorites', cookie=cookie_a)[2]
        favorites_b = self.request('/api/account/favorites', cookie=cookie_b)[2]
        self.assertEqual(favorites_a['user_id'], user_a['id'])
        self.assertEqual(favorites_b['user_id'], user_b['id'])
        self.assertEqual([profile['id'] for profile in favorites_a['profiles']], ['one'])
        self.assertEqual([profile['id'] for profile in favorites_b['profiles']], ['two'])

    def test_individual_actions_preserve_saves_from_another_tab(self):
        cookie, user = self.registered()
        identity = {'catalog_id': 'current', 'expected_user_id': user['id']}
        # Both tabs can start with an empty list and submit independent actions.
        first = self.request('/api/account/favorites', {**identity, 'action': 'add', 'profile_id': 'one'}, cookie)
        second = self.request('/api/account/favorites', {**identity, 'action': 'add', 'profile_id': 'two'}, cookie)
        self.assertEqual(first[0], 200)
        self.assertEqual(second[0], 200)
        self.assertEqual([profile['id'] for profile in second[2]['profiles']], ['one', 'two'])
        duplicate = self.request('/api/account/favorites', {**identity, 'action': 'add', 'profile_id': 'one'}, cookie)
        self.assertEqual([profile['id'] for profile in duplicate[2]['profiles']], ['one', 'two'])
        for invalid_action in [
            {'action': 'add', 'profile_id': 'missing'},
            {'action': 'replace', 'profile_id': 'one'},
            {'action': 'remove', 'profile_id': None},
        ]:
            self.assertEqual(self.request('/api/account/favorites', {**identity, **invalid_action}, cookie)[0], 400)
        removed = self.request('/api/account/favorites', {**identity, 'action': 'remove', 'profile_id': 'one'}, cookie)
        self.assertEqual([profile['id'] for profile in removed[2]['profiles']], ['two'])
        # Removing an already removed item is harmless.
        self.assertEqual(self.request('/api/account/favorites', {**identity, 'action': 'remove', 'profile_id': 'one'}, cookie)[2], removed[2])

    def test_cross_origin_and_non_json_account_writes_are_rejected(self):
        self.assertEqual(self.request('/api/auth/logout', {}, extra_headers={'Origin': 'https://other.example'})[0], 403)
        self.assertEqual(self.request('/api/auth/logout', {}, extra_headers={'Sec-Fetch-Site': 'cross-site'})[0], 403)
        self.assertEqual(self.request('/api/auth/logout', {}, extra_headers={'Content-Type': 'text/plain'})[0], 400)

    def test_data_management_stays_disabled_for_registered_users(self):
        cookie, _ = self.registered()
        for path in ('/api/import', '/api/demo', '/api/original'):
            status, _, body = self.request(path, {}, cookie)
            self.assertEqual(status, 403)
            self.assertEqual(body['code'], 'data_tools_disabled')

    def test_rate_limited_response_has_retry_after(self):
        email = 'guest@example.com'
        email_hash = server.hashlib.sha256(email.encode()).hexdigest()
        for _ in range(10):
            self.http_server.auth_limiter.check(('email', '127.0.0.1', email_hash))
        status, headers, body = self.request('/api/auth/login', {'email': email, 'password': 'example-password'})
        self.assertEqual(status, 429)
        self.assertGreater(int(headers['Retry-After']), 0)
        self.assertEqual(body['code'], 'rate_limited')


if __name__ == '__main__':
    unittest.main()
