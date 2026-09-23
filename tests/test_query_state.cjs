const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const state = require('../static/query-state.js');

const meta = {
  min_date: '2026-09-23', max_date: '2026-12-31',
  formats: ['свадьба', 'корпоратив', 'той'],
  languages: ['русский', 'казахский', 'английский'],
  cities: ['Алматы'], categories: ['Ведущий'],
};
const query = {
  city: 'Алматы', date: '2026-10-17', event_format: 'свадьба', category: 'Ведущий',
  budget: '1000000', hours: '', language: '',
};
const catalog = 'cdb81236bc0125a9';
const base = 'http://127.0.0.1:8000/';

test('exports the same API to a browser without a module loader', () => {
  const context = {window: {}};
  vm.runInNewContext(fs.readFileSync(require.resolve('../static/query-state.js'), 'utf8'), context);
  assert.deepEqual(Object.keys(context.window.ToygaQueryState), Object.keys(state));
  assert.equal(typeof context.window.ToygaQueryState.normalize, 'function');
});

test('normalizes values, optional fields and field order while ignoring extra data', () => {
  const raw = {...query, city: '  Алматы  ', budget: '001000000.0', hours: 4.5, language: ' русский ', extra: 'ignored'};
  const normalized = state.normalize(raw, meta);
  assert.deepEqual(normalized, {...query, hours: '4.5', language: 'русский'});
  assert.deepEqual(Object.keys(normalized), state.fields);
  assert.equal(raw.city, '  Алматы  ');
  const {hours, language, ...required} = query;
  assert.deepEqual(state.normalize(required, meta), query);
  assert.deepEqual(state.normalize({...query, hours: null, language: null}, meta), query);
  assert.deepEqual(state.normalize({...query, hours: '  ', language: '  '}, meta), query);
  assert.equal(state.normalize({...query, budget: 1000000}, meta).budget, '1000000');
});

test('accepts unknown cities and categories for legitimate empty result queries', () => {
  const missing = {...query, city: 'Зарубежье', category: 'Редкая категория'};
  assert.deepEqual(state.normalize(missing, meta), missing);
});

test('validates required strings without coercing nonstrings', () => {
  for (const field of ['city', 'date', 'event_format', 'category']) {
    for (const value of ['', '  ', null, undefined, true, 123, [], {}, 'a'.repeat(121)]) {
      assert.equal(state.normalize({...query, [field]: value}, meta), null, `${field}: ${String(value)}`);
    }
  }
  assert.equal(state.normalize({...query, city: 'a'.repeat(120)}, meta).city.length, 120);
  for (const raw of [null, undefined, [], 'query', 123]) assert.equal(state.normalize(raw, meta), null);
});

test('validates actual calendar days, strict ISO spelling and inclusive catalog bounds', () => {
  for (const date of ['2026-09-22', '2027-01-01', '2026-09-31', '2026-11-31', '2026-00-17',
    '2026-10-00', '2026-13-01', '2026-10-32', '2026-9-30', '2026-10-17T00:00:00Z']) {
    assert.equal(state.normalize({...query, date}, meta), null, date);
  }
  for (const date of [meta.min_date, meta.max_date]) assert.equal(state.normalize({...query, date}, meta).date, date);
  const wideMeta = {...meta, min_date: '1900-01-01', max_date: '2100-12-31'};
  for (const date of ['1900-02-29', '2026-02-29', '2100-02-29']) {
    assert.equal(state.normalize({...query, date}, wideMeta), null, date);
  }
  for (const date of ['2000-02-29', '2028-02-29']) {
    assert.equal(state.normalize({...query, date}, wideMeta).date, date);
  }
  assert.equal(state.normalize(query, {...meta, min_date: 'bad'}), null);
});

test('rejects non-finite, fractional or out-of-range budgets and unsafe type coercions', () => {
  for (const budget of ['', ' ', null, undefined, NaN, Infinity, -Infinity, 'NaN', 'Infinity', '1e100',
    0, -1, 100.5, '100.5', 1000000001, true, false, [], [100], {}, '0xFF']) {
    assert.equal(state.normalize({...query, budget}, meta), null, String(budget));
  }
  for (const budget of [1, 1000000000, '1e6']) {
    assert.equal(state.normalize({...query, budget}, meta).budget, String(Number(budget)));
  }
});

test('hours remain optional and accept only half-hour steps from 0.5 through 24', () => {
  for (const hours of [0, -1, 0.25, 4.25, 24.5, Infinity, 'NaN', '1e100', true, false, [], {}, 'no']) {
    assert.equal(state.normalize({...query, hours}, meta), null, String(hours));
  }
  for (const hours of [0.5, 1, 4.5, 24, '04.50']) {
    assert.equal(state.normalize({...query, hours}, meta).hours, String(Number(hours)));
  }
});

test('checks format and language against catalog metadata', () => {
  assert.equal(state.normalize({...query, event_format: 'unknown'}, meta), null);
  for (const language of ['unknown', true, 1, [], {}, 'a'.repeat(121)]) {
    assert.equal(state.normalize({...query, language}, meta), null);
  }
  assert.equal(state.normalize({...query, language: 'казахский'}, meta).language, 'казахский');
});

test('Cyrillic queries round-trip through a share link without unrelated URL state', () => {
  const original = {...query, city: 'Өскемен', category: 'Фото / видео', hours: '6.5', language: 'казахский'};
  const link = state.shareURL(`${base}?secret=unrelated&city=old#saved`, original, catalog);
  const url = new URL(link);
  assert.equal(url.origin, new URL(base).origin);
  assert.equal(url.hash, '#results-title');
  assert.deepEqual([...url.searchParams.keys()], ['toyga', ...state.fields, 'catalog']);
  assert.equal(url.searchParams.has('secret'), false);
  assert.deepEqual(state.fromURL(link, meta), {query: original, provided: true, catalogId: catalog});
});

test('only the explicit toyga=1 marker makes a link a supplied query', () => {
  for (const href of [base, `${base}?city=Алматы`, `${base}?toyga=0`, `${base}?toyga=true`, 'invalid URL']) {
    assert.deepEqual(state.fromURL(href, meta), {query: null, provided: false, catalogId: null});
  }
  assert.deepEqual(state.fromURL(`${base}?toyga=1`, meta), {query: null, provided: true, catalogId: null});
});

test('missing mandatory values and invalid supplied values are rejected', () => {
  for (const field of ['city', 'date', 'event_format', 'category', 'budget']) {
    const url = new URL(state.shareURL(base, query, catalog));
    url.searchParams.delete(field);
    assert.deepEqual(state.fromURL(url.href, meta), {query: null, provided: true, catalogId: catalog});
  }
  const url = new URL(state.shareURL(base, query, catalog));
  url.searchParams.delete('hours');
  url.searchParams.delete('language');
  assert.deepEqual(state.fromURL(url.href, meta).query, query);
  url.searchParams.set('budget', 'Infinity');
  assert.equal(state.fromURL(url.href, meta).query, null);
});

test('duplicate recognized parameters invalidate links even when values agree', () => {
  for (const field of [...state.fields, 'toyga', 'catalog']) {
    const url = new URL(state.shareURL(base, query, catalog));
    url.searchParams.append(field, url.searchParams.get(field));
    const parsed = state.fromURL(url.href, meta);
    assert.equal(parsed.provided, true, field);
    assert.equal(parsed.query, null, field);
  }
  const url = new URL(state.shareURL(base, query, catalog));
  url.searchParams.append('toyga', '0');
  assert.equal(state.fromURL(url.href, meta).query, null);
});

test('query keys ignore insertion order and unrelated properties', () => {
  const reversed = Object.fromEntries(Object.entries(query).reverse());
  assert.equal(state.queryKey({...reversed, extra: 'ignored'}), state.queryKey(query));
  assert.deepEqual(Object.keys(JSON.parse(state.queryKey(query))), state.fields);
  assert.notEqual(state.queryKey({...query, date: '2026-10-18'}), state.queryKey(query));
});

test('history puts the new query first, deduplicates older copies and caps to five', () => {
  const queries = Array.from({length: 7}, (_, index) => ({...query, date: `2026-10-${17 + index}`}));
  const history = [queries[0], queries[1], queries[1], queries[2], queries[3], queries[4], queries[5]];
  const next = state.remember(history, queries[2]);
  assert.deepEqual(next, [queries[2], queries[0], queries[1], queries[3], queries[4]]);
  assert.equal(history.length, 7);
  assert.notEqual(next[0], queries[2]);
  assert.deepEqual(state.remember(history, queries[6], 2), [queries[6], queries[0]]);
  assert.deepEqual(state.remember(history, queries[6], 0), []);
  assert.deepEqual(state.remember(null, query), [query]);
  assert.deepEqual(state.remember([null, 'bad', [], query], query), [query]);
});
