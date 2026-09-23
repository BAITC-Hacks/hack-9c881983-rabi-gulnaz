"""Read-only integration checks against a running local server."""
import json
import sys
import time
from urllib.error import HTTPError
from urllib.request import Request, urlopen

BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:8000'


def request(path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = Request(BASE + path, data=data, headers={'Content-Type':'application/json'})
    with urlopen(req, timeout=10) as response:
        return json.load(response)


meta = request('/api/meta')
assert meta['count'] > 0
for asset in ['/', '/app.js', '/styles.css', '/favicon.svg']:
    with urlopen(BASE + asset, timeout=10) as response:
        assert response.status == 200 and len(response.read()) > 0
q = {'city':'Алматы', 'date':'2026-10-17', 'event_format':'свадьба', 'category':'Ведущий', 'budget':500000 if meta['source'] == 'demo' else 1000000}
start = time.perf_counter()
r = request('/api/recommend', q)
elapsed = time.perf_counter() - start
assert r == request('/api/recommend', q)
assert len(r['cards']) <= 3
assert request('/api/recommend', {**q, 'city':'Несуществующий город'})['status'] == 'no_category'
try:
    request('/api/recommend', {**q, 'date':'2027-01-01'})
    raise AssertionError('Expected HTTP 400')
except HTTPError as error:
    assert error.code == 400
    assert 'error' in json.load(error)
if meta['source'] == 'demo':
    assert r['status'] == 'matched' and len(r['cards']) == 3
    assert request('/api/recommend', {**q, 'budget':1})['status'] == 'no_matches'
    assert len(request('/api/recommend', {**q, 'category':'Флорист'})['cards']) == 2
    changed = request('/api/recommend', {**q, 'date':'2026-10-18'})
    assert [p['id'] for p in r['cards']] != [p['id'] for p in changed['cards']]
if meta['source'] == 'original':
    assert meta['count'] == 66 and meta['synthetic_count'] == 13
    assert meta['city_imputed_count'] == 8 and meta['price_imputed_count'] == 18
    assert [p['id'] for p in r['cards']] == ['HK-42352', 'HK-35215', 'HK-77838']
    assert len(set(p['explanation'] for p in r['cards'])) == 3
    assert request('/api/recommend', {**q, 'budget':10000})['status'] == 'no_matches'
    assert len(request('/api/recommend', {**q, 'category':'Флорист', 'budget':300000})['cards']) == 1
    changed = request('/api/recommend', {**q, 'date':'2026-10-18'})
    assert [p['id'] for p in changed['cards']] == ['HK-44923', 'HK-35215', 'HK-27222']
print('HTTP checks passed. {} profiles. Recommendation: {:.1f} ms.'.format(meta['count'], elapsed * 1000))
