"""Local HTTP API and static app, Python 3.9+, standard library only."""
import argparse
import hashlib
import json
import mimetypes
from http.cookies import CookieError, SimpleCookie
import sqlite3
import ssl
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

from matcher import FORMATS, LANGUAGES, recommend
from dataset import load_dataset, read_dataset, serialize_profiles
from auth import AccountStore, AuthError, COOKIE_NAME, RateLimiter, SESSION_SECONDS, validate_favorites

ROOT = Path(__file__).resolve().parent
LOCK = threading.Lock()
STATE = {'profiles': [], 'source': 'original', 'catalog_id': ''}
MAX_BODY = 8 * 1024 * 1024
DEFAULT_DATA = ROOT / 'data' / 'hackathon.csv'


def set_catalog(profiles, source):
    """Caller holds LOCK when serving requests."""
    catalog_id = hashlib.sha256(serialize_profiles(profiles).encode('utf-8')).hexdigest()[:16]
    STATE.update(profiles=profiles, source=source, catalog_id=catalog_id)


class Handler(BaseHTTPRequestHandler):
    def json_response(self, value, status=200, headers=None):
        data = json.dumps(value, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        for name, header_value in (headers or {}).items():
            self.send_header(name, header_value)
        self.end_headers()
        self.wfile.write(data)

    def session_token(self):
        cookie = SimpleCookie()
        try:
            cookie.load(self.headers.get('Cookie', ''))
        except CookieError:
            return None
        item = cookie.get(COOKIE_NAME)
        return item.value if item else None

    def session_cookie(self, token=None):
        cookie = SimpleCookie()
        cookie[COOKIE_NAME] = token or ''
        item = cookie[COOKIE_NAME]
        item['path'] = '/'
        item['httponly'] = True
        item['samesite'] = 'Lax'
        item['max-age'] = SESSION_SECONDS if token else 0
        if not token:
            item['expires'] = 'Thu, 01 Jan 1970 00:00:00 GMT'
        # Do not trust arbitrary forwarding headers on the local HTTP server.
        if isinstance(self.connection, ssl.SSLSocket):
            item['secure'] = True
        return cookie.output(header='').strip()

    def account_user(self, required=False):
        user = self.server.account_store.session_user(self.session_token())
        if required and user is None:
            raise AuthError('Войдите в аккаунт, чтобы сохранить избранное', 401, 'auth_required')
        return user

    def auth_error(self, error):
        headers = {'Retry-After': str(error.retry_after)} if error.retry_after else None
        return self.json_response({'error': str(error), 'code': error.code}, error.status, headers)

    def account_favorites(self, user, raw=None):
        if raw is not None and raw.get('expected_user_id') != user['id']:
            raise AuthError('Аккаунт изменился. Обновите избранное и повторите действие', 409, 'account_changed')
        with LOCK:
            profiles, catalog_id = STATE['profiles'], STATE['catalog_id']
            if raw is not None:
                if 'action' in raw:
                    action = raw.get('action')
                    if action not in ('add', 'remove'):
                        raise AuthError('Действие с избранным должно быть add или remove')
                    profile_id = raw.get('profile_id')
                    validate_favorites({'ids': [profile_id], 'catalog_id': raw.get('catalog_id')}, profiles, catalog_id)
                    # Read and modify the latest list under the same server lock.
                    # Separate tabs never replace each other's saved identifiers.
                    ids = self.server.account_store.get_favorites(user['id'], catalog_id)
                    if action == 'add' and profile_id not in ids:
                        ids.append(profile_id)
                    elif action == 'remove':
                        ids = [value for value in ids if value != profile_id]
                else:
                    ids = validate_favorites(raw, profiles, catalog_id)
                self.server.account_store.set_favorites(user['id'], catalog_id, ids)
            else:
                ids = self.server.account_store.get_favorites(user['id'], catalog_id)
            by_id = {profile['id']: profile for profile in profiles}
            return {'profiles': [by_id[profile_id] for profile_id in ids if profile_id in by_id], 'catalog_id': catalog_id, 'user_id': user['id']}

    def do_GET(self):
        path = urlparse(self.path).path
        if path in ('/api/auth/session', '/api/account/favorites'):
            try:
                if path == '/api/auth/session':
                    return self.json_response({'user': self.account_user()})
                return self.json_response(self.account_favorites(self.account_user(required=True)))
            except AuthError as error:
                return self.auth_error(error)
            except (OSError, sqlite3.Error):
                return self.json_response({'error': 'Не удалось прочитать данные аккаунта', 'code': 'storage_error'}, 500)
        if path == '/api/meta':
            with LOCK:
                profiles, source, catalog_id = STATE['profiles'], STATE['source'], STATE['catalog_id']
            return self.json_response({'count': len(profiles), 'synthetic_count': sum(p['synthetic'] for p in profiles),
                                       'source': source, 'catalog_id': catalog_id,
                                       'city_imputed_count': sum(p['city_imputed'] for p in profiles),
                                       'price_imputed_count': sum(p['price_imputed'] for p in profiles),
                                       'cities': sorted(set(p['city'] for p in profiles)),
                                       'categories': sorted(set(c for p in profiles for c in p['categories'])),
                                       'formats': FORMATS, 'languages': LANGUAGES,
                                       'min_date': '2026-09-23', 'max_date': '2026-12-31'})
        files = {'/': 'index.html', '/app.js': 'app.js', '/styles.css': 'styles.css', '/favicon.svg': 'favicon.svg',
                 '/images/event-table.jpg': 'images/event-table.jpg', '/query-state.js': 'query-state.js',
                 '/motion.js': 'motion.js', '/account.js': 'account.js'}
        if path not in files:
            return self.json_response({'error': 'Страница не найдена'}, 404)
        file = ROOT / 'static' / files[path]
        data = file.read_bytes()
        self.send_response(200)
        content_type = mimetypes.guess_type(file.name)[0] or 'application/octet-stream'
        self.send_header('Content-Type', content_type + ('; charset=utf-8' if content_type.startswith('text/') or content_type == 'application/javascript' else ''))
        self.send_header('Content-Length', str(len(data)))
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.end_headers()
        self.wfile.write(data)

    def do_POST(self):
        try:
            path = urlparse(self.path).path
            # Same-origin writes, including cookie-authenticated account operations.
            origin = self.headers.get('Origin')
            if ((origin and urlparse(origin).netloc != self.headers.get('Host'))
                    or self.headers.get('Sec-Fetch-Site') == 'cross-site'):
                return self.json_response({'error': 'Запрос с другого сайта запрещён'}, 403)
            if path.startswith('/api/auth/') or path == '/api/account/favorites':
                if self.headers.get_content_type() != 'application/json':
                    raise AuthError('Ожидается запрос application/json')
            length = int(self.headers.get('Content-Length', 0))
            body_limit = 16 * 1024 if path.startswith('/api/auth/') else MAX_BODY
            if not 0 < length <= body_limit:
                limit_label = '16 КБ' if body_limit < MAX_BODY else '8 МБ'
                return self.json_response({'error': 'Размер запроса должен быть от 1 байта до ' + limit_label}, 413)
            raw = json.loads(self.rfile.read(length))
            if not isinstance(raw, dict):
                raise ValueError('Ожидается JSON-объект')
            if path in ('/api/auth/register', '/api/auth/login'):
                address = self.client_address[0]
                self.server.auth_limiter.check(('address', address), limit=40)
                email = raw.get('email', '')
                email_key = email.strip().casefold() if isinstance(email, str) else ''
                email_key = hashlib.sha256(email_key.encode('utf-8')).hexdigest()
                self.server.auth_limiter.check(('email', address, email_key))
                if path == '/api/auth/register':
                    user = self.server.account_store.register(raw.get('name'), raw.get('email'), raw.get('password'))
                else:
                    user = self.server.account_store.login(raw.get('email'), raw.get('password'))
                token = self.server.account_store.issue_session(user['id'])
                # Logging in again on the same browser replaces its previous session.
                self.server.account_store.revoke_session(self.session_token())
                return self.json_response({'user': user}, headers={'Set-Cookie': self.session_cookie(token)})
            if path == '/api/auth/logout':
                self.server.account_store.revoke_session(self.session_token())
                return self.json_response({'user': None}, headers={'Set-Cookie': self.session_cookie()})
            if path == '/api/account/favorites':
                return self.json_response(self.account_favorites(self.account_user(required=True), raw))
            if path == '/api/recommend':
                with LOCK:
                    profiles = STATE['profiles']
                return self.json_response(recommend(profiles, raw))
            if path in ('/api/import', '/api/demo', '/api/original') and not self.server.enable_data_tools:
                return self.json_response({'error': 'Управление каталогом отключено в пользовательском приложении', 'code': 'data_tools_disabled'}, 403)
            if path == '/api/import':
                if not isinstance(raw.get('text'), str):
                    raise ValueError('Передайте текст CSV или JSONL')
                profiles = load_dataset(raw['text'], raw.get('format', 'jsonl'))
                with LOCK:
                    target = ROOT / 'data' / 'imported.jsonl'
                    temporary = target.with_suffix('.tmp')
                    temporary.write_text(serialize_profiles(profiles), encoding='utf-8')
                    temporary.replace(target)
                    set_catalog(profiles, 'imported')
                return self.json_response({'count': len(profiles)})
            if path in ('/api/demo', '/api/original'):
                original = path == '/api/original'
                profiles = read_dataset(DEFAULT_DATA if original else ROOT / 'data' / 'demo.jsonl')
                with LOCK:
                    set_catalog(profiles, 'original' if original else 'demo')
                return self.json_response({'count': len(profiles)})
            return self.json_response({'error': 'Маршрут не найден'}, 404)
        except AuthError as error:
            self.auth_error(error)
        except (ValueError, TypeError, UnicodeDecodeError) as exc:
            self.json_response({'error': str(exc)}, 400)
        except (OSError, sqlite3.Error):
            self.json_response({'error': 'Не удалось прочитать или сохранить данные'}, 500)


def main():
    parser = argparse.ArgumentParser(description='Тойға — подбор event-подрядчиков')
    parser.add_argument('--port', type=int, default=8000)
    parser.add_argument('--host', default='127.0.0.1')
    parser.add_argument('--data', type=Path, help='Путь к CSV или JSONL (по умолчанию data/hackathon.csv)')
    parser.add_argument('--enable-data-tools', action='store_true', help='Включить служебные API импорта и переключения каталога (для локальной разработки)')
    args = parser.parse_args()
    source = args.data or DEFAULT_DATA
    source_kind = 'original' if source.resolve() == DEFAULT_DATA.resolve() else ('demo' if source.resolve() == (ROOT / 'data' / 'demo.jsonl').resolve() else 'imported')
    set_catalog(read_dataset(source), source_kind)
    server = ThreadingHTTPServer((args.host, args.port), Handler)
    server.account_store = AccountStore(ROOT / 'data' / 'accounts.sqlite3')
    server.auth_limiter = RateLimiter()
    server.enable_data_tools = args.enable_data_tools
    print('Тойға → http://{}:{} · {} профилей · Ctrl+C для остановки'.format(args.host, args.port, len(STATE['profiles'])), flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\nСервер остановлен')
    finally:
        server.server_close()


if __name__ == '__main__':
    main()
