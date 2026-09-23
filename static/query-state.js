/* Query persistence and links use the same seven fields as the existing form. */
(function () {
  'use strict';

  const fields = Object.freeze(['city', 'date', 'event_format', 'category', 'budget', 'hours', 'language']);
  const urlKeys = [...fields, 'toyga', 'catalog'];

  function shortString(value, optional = false) {
    if (optional && value == null) return '';
    if (typeof value !== 'string') return null;
    const text = value.trim();
    return text.length <= 120 && (optional || text.length > 0) ? text : null;
  }

  function validDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const [year, month, day] = value.split('-').map(Number);
    if (year < 1 || month < 1 || month > 12 || day < 1) return false;
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    return day <= days[month - 1];
  }

  function numeric(value) {
    if (typeof value === 'string') {
      value = value.trim();
      if (value.length > 120 || !/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(value)) return null;
    } else if (typeof value !== 'number') return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function normalize(raw, meta) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !meta) return null;
    const city = shortString(raw.city);
    const date = shortString(raw.date);
    const eventFormat = shortString(raw.event_format);
    const category = shortString(raw.category);
    const language = shortString(raw.language, true);
    if (city == null || category == null || eventFormat == null || language == null) return null;
    if (!validDate(date) || !validDate(meta.min_date) || !validDate(meta.max_date)
      || date < meta.min_date || date > meta.max_date) return null;
    if (!Array.isArray(meta.formats) || !meta.formats.includes(eventFormat)) return null;
    if (language && (!Array.isArray(meta.languages) || !meta.languages.includes(language))) return null;
    const budget = numeric(raw.budget);
    if (budget == null || !Number.isInteger(budget) || budget <= 0 || budget > 1e9) return null;
    let hours = '';
    if (raw.hours != null && !(typeof raw.hours === 'string' && raw.hours.trim() === '')) {
      hours = numeric(raw.hours);
      if (hours == null || hours < 0.5 || hours > 24 || !Number.isInteger(hours * 2)) return null;
      hours = String(hours);
    }
    return {city, date, event_format: eventFormat, category, budget: String(budget), hours, language};
  }

  function fromURL(href, meta) {
    let params;
    try { params = new URL(href).searchParams; }
    catch { return {query: null, provided: false, catalogId: null}; }
    const provided = params.getAll('toyga').includes('1');
    if (!provided) return {query: null, provided: false, catalogId: null};
    const catalogId = shortString(params.get('catalog'));
    if (urlKeys.some(key => params.getAll(key).length > 1)) return {query: null, provided, catalogId};
    const raw = Object.fromEntries(fields.map(field => [field, params.get(field)]));
    return {query: normalize(raw, meta), provided, catalogId};
  }

  function copyQuery(query) {
    return Object.fromEntries(fields.map(field => [field, String(query[field] ?? '')]));
  }

  // Callers validate against the current catalog with normalize before storing/sharing.
  function shareURL(baseHref, query, catalogId) {
    const url = new URL(baseHref);
    url.search = '';
    url.searchParams.set('toyga', '1');
    for (const [field, value] of Object.entries(copyQuery(query))) url.searchParams.set(field, value);
    url.searchParams.set('catalog', String(catalogId ?? ''));
    url.hash = 'results-title';
    return url.href;
  }

  function queryKey(query) {
    return JSON.stringify(copyQuery(query));
  }

  function remember(history, query, limit = 5) {
    const count = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 5;
    if (!count) return [];
    const entries = [query, ...(Array.isArray(history) ? history : [])];
    const seen = new Set();
    const result = [];
    for (const entry of entries) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
      const key = queryKey(entry);
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(copyQuery(entry));
      if (result.length === count) break;
    }
    return result;
  }

  const api = Object.freeze({fields, normalize, fromURL, shareURL, queryKey, remember});
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.ToygaQueryState = api;
})();
