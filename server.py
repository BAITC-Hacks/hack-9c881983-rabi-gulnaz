"""Local HTTP API and static app, Python 3.9+, standard library only."""
import argparse
import hashlib
import json
import mimetypes
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

from matcher import FORMATS, LANGUAGES, recommend
from dataset import load_dataset, read_dataset, serialize_profiles

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
    def json_response(self, value, status=200):
        data = json.dumps(value, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        path = urlparse(self.path).path
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
        files = {'/': 'index.html', '/app.js': 'app.js', '/styles.css': 'styles.css', '/favicon.svg': 'favicon.svg'}
        if path not in files:
            return self.json_response({'error': 'Страница не найдена'}, 404)
        file = ROOT / 'static' / files[path]
        data = file.read_bytes()
        self.send_response(200)
        self.send_header('Content-Type', (mimetypes.guess_type(file.name)[0] or 'text/plain') + '; charset=utf-8')
        self.send_header('Content-Length', str(len(data)))
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.end_headers()
        self.wfile.write(data)

    def do_POST(self):
        try:
            # No cross-origin writes to the local dataset.
            origin = self.headers.get('Origin')
            if origin and urlparse(origin).netloc != self.headers.get('Host'):
                return self.json_response({'error': 'Запрос с другого сайта запрещён'}, 403)
            length = int(self.headers.get('Content-Length', 0))
            if not 0 < length <= MAX_BODY:
                return self.json_response({'error': 'Размер запроса должен быть от 1 байта до 8 МБ'}, 413)
            raw = json.loads(self.rfile.read(length))
            if not isinstance(raw, dict):
                raise ValueError('Ожидается JSON-объект')
            path = urlparse(self.path).path
            if path == '/api/recommend':
                with LOCK:
                    profiles = STATE['profiles']
                return self.json_response(recommend(profiles, raw))
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
        except (ValueError, TypeError, UnicodeDecodeError) as exc:
            self.json_response({'error': str(exc)}, 400)
        except OSError:
            self.json_response({'error': 'Не удалось прочитать или сохранить данные'}, 500)


def main():
    parser = argparse.ArgumentParser(description='Тойға — подбор event-подрядчиков')
    parser.add_argument('--port', type=int, default=8000)
    parser.add_argument('--host', default='127.0.0.1')
    parser.add_argument('--data', type=Path, help='Путь к CSV или JSONL (по умолчанию data/hackathon.csv)')
    args = parser.parse_args()
    source = args.data or DEFAULT_DATA
    source_kind = 'original' if source.resolve() == DEFAULT_DATA.resolve() else ('demo' if source.resolve() == (ROOT / 'data' / 'demo.jsonl').resolve() else 'imported')
    set_catalog(read_dataset(source), source_kind)
    server = ThreadingHTTPServer((args.host, args.port), Handler)
    print('Тойға → http://{}:{} · {} профилей · Ctrl+C для остановки'.format(args.host, args.port, len(STATE['profiles'])), flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\nСервер остановлен')
    finally:
        server.server_close()


if __name__ == '__main__':
    main()
