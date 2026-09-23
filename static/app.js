'use strict';
const $ = (selector) => document.querySelector(selector);
const paths = {
  sparkles: '<path d="m12 3 2.4 6.6L21 12l-6.6 2.4L12 21l-2.4-6.6L3 12l6.6-2.4L12 3Z"/><path d="m20 2 .5 1.5L22 4l-1.5.5L20 6l-.5-1.5L18 4l1.5-.5L20 2Z"/>',
  heart: '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z"/>',
  layers: '<path d="m12 3 10 5-10 5L2 8l10-5Zm-10 9 10 5 10-5M2 16l10 5 10-5"/>',
  database: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 4 16 4 16 0V5M4 12c0 4 16 4 16 0"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  pin: '<path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/>',
  confetti: '<path d="m3 21 5-14 9 9-14 5ZM8 7l9 9M14 3v3m5-1-2 3m5 2-4 2M8 2l1 2M21 17h1"/>',
  users: '<circle cx="9" cy="8" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3M16 5a3 3 0 0 1 0 6m2 4a5 5 0 0 1 3 6"/>',
  globe: '<circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4m10-4v4M3 11h18m-13 4h3m3 0h3"/>',
  shield: '<path d="m12 2 8 3v7c0 6-8 10-8 10S4 18 4 12V5l8-3Z"/><path d="m8 12 3 3 5-6"/>',
  search: '<circle cx="10" cy="10" r="7"/><path d="m15 15 6 6"/>',
  share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 10.5 6.8-4m-6.8 7 6.8 4"/>'
};
const icon = (name) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.sparkles}</svg>`;
document.querySelectorAll('[data-icon]').forEach(el => { el.innerHTML = icon(el.dataset.icon); });
const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money = value => new Intl.NumberFormat('ru-RU', {maximumFractionDigits: 0}).format(value);
const niceDate = value => new Date(`${value}T12:00:00`).toLocaleDateString('ru-RU', {day: 'numeric', month: 'long'});
const capitalize = value => value.charAt(0).toUpperCase() + value.slice(1);
const reasons = {busy: 'заняты на выбранную дату', budget: 'цена выше бюджета', format: 'не работают с этим форматом', language: 'нет нужного языка', hours: 'недостаточная длительность'};
let meta, currentResult, requestVersion = 0, compareVersion = 0, toastTimer, renderedQuery = '';
const queryState = window.ToygaQueryState;
let queryHistory = [], dateCompareBusy = false;
const scrollBehavior = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
const carousels = new Map();
let activeProfile = null, profileObserver = null, dialogReturnFocus = null, dialogReturnCard = null, previousBodyOverflow = '';
let saved = [], accountUser = null, favoritesReady = true, favoritesLoading = false, favoriteBusy = false, favoritesVersion = 0;
try { const stored = JSON.parse(localStorage.getItem('toyga-saved') || '[]'); saved = Array.isArray(stored) ? stored.filter(p => p && typeof p.id === 'string' && Array.isArray(p.categories) && Array.isArray(p.languages) && Array.isArray(p.event_formats) && Array.isArray(p.busy_dates) && Number.isFinite(p.price_from_kzt)) : []; } catch { /* Storage is optional. */ }

async function api(path, body) {
  const response = await fetch(path, body ? {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)} : {});
  const data = await response.json();
  if (!response.ok) { const error = new Error(data.error || 'Не удалось выполнить запрос'); error.status = response.status; throw error; }
  return data;
}
function notify(message) {
  clearTimeout(toastTimer); $('#toast').textContent = message; $('#toast').hidden = false;
  toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 3500);
}
function fillSelect(id, values, preferred, blank) {
  const el = $(`#${id}`); const current = el.value;
  el.innerHTML = (blank ? `<option value="">${blank}</option>` : '') + values.map(v => `<option value="${escapeHTML(v)}">${escapeHTML(capitalize(v))}</option>`).join('');
  el.value = values.includes(current) ? current : (values.includes(preferred) ? preferred : (blank ? '' : values[0]));
}
function setStatus(selector, text, state) {
  const el = $(selector);
  if (el) { el.textContent = text; el.dataset.state = state; }
}
function setSubmitLabel(text) {
  const el = $('#submit-label');
  if (el) el.textContent = text;
}
function updateSelectionState() {
  const ready = Boolean(currentResult) && !document.body.classList.contains('loading') && JSON.stringify(formQuery()) === renderedQuery;
  $('#share-result').disabled = !ready;
  $('#compare-profiles').disabled = !ready || currentResult.cards.length < 2;
  $('#run-compare').disabled = !ready || dateCompareBusy;
  if (!currentResult || document.body.classList.contains('loading')) return;
  if (JSON.stringify(formQuery()) !== renderedQuery) {
    setStatus('#selection-state', 'Параметры изменены · обновите подбор', 'changed');
    return;
  }
  const text = currentResult.status === 'matched' ? 'Подборка готова' : currentResult.status === 'no_category' ? 'Категория не найдена' : 'Нет совпадений';
  setStatus('#selection-state', text, currentResult.status === 'matched' ? 'success' : 'empty');
}
async function loadMeta() {
  setStatus('#connection-status', 'Подключаем каталог', 'loading');
  try { meta = await api('/api/meta'); }
  catch (error) { setStatus('#connection-status', 'Каталог недоступен', 'error'); throw error; }
  fillSelect('city', selectableCities(), 'Алматы');
  fillSelect('category', meta.categories, 'Ведущий');
  fillSelect('event_format', meta.formats, 'свадьба');
  fillSelect('language', meta.languages, '', 'Любой язык');
  setStatus('#connection-status', 'Готовы к вашему событию', 'success');
  try {
    if (!accountUser && localStorage.getItem('toyga-catalog') !== meta.catalog_id) {
      saved = []; localStorage.removeItem('toyga-saved');
      localStorage.setItem('toyga-catalog', meta.catalog_id); updateSaved();
    }
  } catch { /* Storage is optional. */ }
  loadQueryHistory();
  await loadFavorites();
}
function selectableCities() { return (meta?.cities || []).filter(city => city !== 'Зарубежье'); }
function formQuery() { return Object.fromEntries(new FormData($('#search-form'))); }

function applyQuery(query) {
  for (const key of queryState.fields) {
    const el = $(`#${key}`);
    const value = query[key] == null ? '' : String(query[key]);
    if (el.tagName === 'SELECT' && !Array.from(el.options).some(o => o.value === value)) el.add(new Option(value, value));
    el.value = value;
  }
}
function historyKey() { return accountUser ? `toyga-searches:user:${accountUser.id}:${meta.catalog_id}` : `toyga-searches:${meta.catalog_id}`; }
function renderQueryHistory() {
  $('#recent-searches').hidden = !queryHistory.length;
  $('#recent-list').innerHTML = queryHistory.map((q, index) => `<button type="button" class="recent-query" data-recent="${index}" title="${escapeHTML(`${capitalize(q.event_format)} · до ${money(q.budget)} ₸ · ${q.hours ? q.hours + ' ч' : 'любая длительность'} · ${q.language || 'любой язык'}`)}"><span>${escapeHTML(q.category)} · ${escapeHTML(q.city)}</span><small>${niceDate(q.date)} · до ${money(q.budget)} ₸</small><span aria-hidden="true">↗</span></button>`).join('');
}
function loadQueryHistory() {
  queryHistory = [];
  try {
    const stored = JSON.parse(localStorage.getItem(historyKey()) || '[]');
    if (Array.isArray(stored)) {
      const valid = stored.map(q => queryState.normalize(q, meta)).filter(q => q && selectableCities().includes(q.city)).slice(0, 5);
      queryHistory = valid.reduceRight((history, q) => queryState.remember(history, q), []);
    }
  } catch { /* The existing catalogue and search remain usable without storage. */ }
  renderQueryHistory();
}
function rememberQuery(query) {
  const normalized = queryState.normalize(query, meta);
  if (!normalized) return;
  queryHistory = queryState.remember(queryHistory, normalized);
  try {
    localStorage.setItem(historyKey(), JSON.stringify(queryHistory));
    $('#session-note').textContent = 'Параметры сохранены. Можно продолжить после перезагрузки.';
  } catch { $('#session-note').textContent = 'Браузер запретил сохранение. История доступна в этой вкладке.'; }
  renderQueryHistory();
}
function updateShareAddress(query) {
  if (new URL(window.location.href).searchParams.get('toyga') !== '1') return;
  const url = queryState.shareURL(window.location.href, query, meta.catalog_id);
  url && window.history.replaceState(null, '', url);
}
function carouselCards(track) { return Array.from(track.querySelectorAll('.contractor-card')); }
function carouselPosition(track, card) { return card.getBoundingClientRect().left - track.getBoundingClientRect().left + track.scrollLeft; }
function updateCarousel(track) {
  const controller = carousels.get(track.id);
  if (!controller) return;
  const cards = carouselCards(track);
  const maxScroll = Math.max(0, track.scrollWidth - track.clientWidth);
  const canScroll = cards.length > 1 && track.clientWidth > 0 && maxScroll > 4;
  controller.controls.hidden = !canScroll;
  if (!cards.length) return;
  let current = cards.reduce((best, card, index) => Math.abs(carouselPosition(track, card) - track.scrollLeft) < Math.abs(carouselPosition(track, cards[best]) - track.scrollLeft) ? index : best, 0);
  if (canScroll && track.scrollLeft >= maxScroll - 4) current = cards.length - 1;
  controller.index = current;
  controller.controls.querySelector('.carousel-counter').textContent = `${current + 1} / ${cards.length}`;
  controller.controls.querySelectorAll('.carousel-dot').forEach((dot, index) => {
    dot.classList.toggle('is-active', index === current);
    dot.setAttribute('aria-current', index === current ? 'true' : 'false');
  });
  controller.controls.querySelector('[data-carousel-step="-1"]').disabled = track.scrollLeft <= 4;
  controller.controls.querySelector('[data-carousel-step="1"]').disabled = track.scrollLeft >= maxScroll - 4;
}
function moveCarousel(track, index) {
  const cards = carouselCards(track);
  const card = cards[Math.max(0, Math.min(index, cards.length - 1))];
  if (card) track.scrollTo({left: carouselPosition(track, card), behavior: scrollBehavior()});
}
function moveCarouselRelative(track, direction) {
  const max = Math.max(0, track.scrollWidth - track.clientWidth);
  const positions = carouselCards(track).map(card => Math.max(0, Math.min(max, carouselPosition(track, card)))).sort((a, b) => a - b);
  const target = direction > 0 ? positions.find(position => position > track.scrollLeft + 4) ?? max : positions.reverse().find(position => position < track.scrollLeft - 4) ?? 0;
  track.scrollTo({left: target, behavior: scrollBehavior()});
}
function enableCarouselDrag(track) {
  let drag = null, suppressClickUntil = 0;
  track.addEventListener('pointerdown', event => {
    suppressClickUntil = 0;
    if (event.pointerType !== 'mouse' || event.button !== 0 || !event.target.closest('.contractor-card') || event.target.closest('[data-save], input, textarea, select, a, [contenteditable="true"]') || track.scrollWidth <= track.clientWidth + 4) return;
    drag = {id: event.pointerId, x: event.clientX, y: event.clientY, left: track.scrollLeft, active: false};
  });
  track.addEventListener('pointermove', event => {
    if (!drag || drag.id !== event.pointerId) return;
    const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
    if (!drag.active) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 8) return;
      if (Math.abs(dx) < Math.abs(dy) * 1.2) { drag = null; return; }
      drag.active = true;
      track.classList.add('is-dragging');
      track.setPointerCapture(event.pointerId);
      window.getSelection()?.removeAllRanges();
    }
    event.preventDefault();
    track.scrollLeft = drag.left - dx;
  });
  const finishDrag = () => {
    if (!drag) return;
    const finished = drag; drag = null;
    if (!finished.active) return;
    const position = track.scrollLeft, max = track.scrollWidth - track.clientWidth;
    const cards = carouselCards(track);
    const distance = card => Math.abs(Math.min(max, Math.max(0, carouselPosition(track, card))) - position);
    const nearest = cards.reduce((best, card, index) => distance(card) < distance(cards[best]) ? index : best, 0);
    suppressClickUntil = performance.now() + 500;
    track.classList.remove('is-dragging');
    if (track.hasPointerCapture(finished.id)) track.releasePointerCapture(finished.id);
    moveCarousel(track, nearest);
  };
  track.addEventListener('pointerup', finishDrag);
  track.addEventListener('pointercancel', finishDrag);
  track.addEventListener('lostpointercapture', finishDrag);
  track.addEventListener('dragstart', event => { if (drag) event.preventDefault(); });
  track.addEventListener('pointerleave', () => { if (drag && !drag.active) drag = null; });
  track.addEventListener('click', event => {
    if (event.detail && performance.now() < suppressClickUntil) { event.preventDefault(); event.stopImmediatePropagation(); suppressClickUntil = 0; }
  }, true);
}
function setupCarousel(id, preservePosition = false) {
  const track = document.getElementById(id);
  let controller = carousels.get(id);
  if (!controller) {
    const controls = document.createElement('div');
    controls.className = 'carousel-controls';
    controls.dataset.carouselFor = id;
    controls.hidden = true;
    track.before(controls);
    controller = {controls, index: 0};
    carousels.set(id, controller);
    enableCarouselDrag(track);
    track.addEventListener('scroll', () => updateCarousel(track), {passive: true});
    track.addEventListener('keydown', event => {
      if (event.target !== track || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const count = carouselCards(track).length;
      if (event.key === 'Home' || event.key === 'End') moveCarousel(track, event.key === 'Home' ? 0 : count - 1);
      else moveCarouselRelative(track, event.key === 'ArrowRight' ? 1 : -1);
    });
    if ('ResizeObserver' in window) new ResizeObserver(() => updateCarousel(track)).observe(track);
    else window.addEventListener('resize', () => updateCarousel(track));
  }
  const cards = carouselCards(track);
  track.classList.toggle('is-carousel', cards.length > 0);
  track.setAttribute('role', 'region');
  track.setAttribute('aria-label', id === 'cards' ? 'Подходящие подрядчики. Листайте или используйте стрелки.' : 'Избранные подрядчики. Листайте или используйте стрелки.');
  if (cards.length > 1) track.setAttribute('tabindex', '0');
  else track.removeAttribute('tabindex');
  controller.controls.innerHTML = `<span class="carousel-hint"><span aria-hidden="true">↔</span> Свайпайте карточки или тяните мышью</span><div class="carousel-pagination"><div class="carousel-dots">${cards.map((p, index) => `<button type="button" class="carousel-dot" data-carousel-index="${index}" data-carousel-track="${id}" aria-controls="${id}" aria-label="Перейти к подрядчику ${index + 1} из ${cards.length}"></button>`).join('')}</div><span class="carousel-counter" aria-hidden="true"></span><div class="carousel-arrows"><button type="button" class="carousel-arrow" data-carousel-step="-1" data-carousel-track="${id}" aria-controls="${id}" aria-label="Предыдущий подрядчик">←</button><button type="button" class="carousel-arrow" data-carousel-step="1" data-carousel-track="${id}" aria-controls="${id}" aria-label="Следующий подрядчик">→</button></div></div>`;
  if (!preservePosition) track.scrollLeft = 0;
  requestAnimationFrame(() => updateCarousel(track));
}
function cardHTML(p, index, isSavedView = false) {
  const isSaved = saved.some(s => s.id === p.id);
  const initials = p.anon_name.split(/[\s«]+/).filter(Boolean).slice(0, 2).map(s => s[0]).join('');
  const track = isSavedView ? 'saved-cards' : 'cards';
  return `<article class="contractor-card" data-profile-id="${escapeHTML(p.id)}" aria-label="${index + 1}. ${escapeHTML(p.anon_name)}">
    <div class="card-visual theme-${index % 3 + 1}"><div class="visual-pattern" aria-hidden="true"></div><span class="visual-word">${escapeHTML(p.categories[0] || 'Подрядчик')}</span><span class="card-index" aria-hidden="true">${String(index + 1).padStart(2, '0')}</span><div class="profile-monogram" aria-hidden="true">${escapeHTML(initials)}</div>
      <span class="rank-badge">${icon(isSavedView ? 'heart' : 'check')}${isSavedView ? 'В вашем списке' : `${index + 1} · Подходит по условиям`}</span>
      <button type="button" class="card-open card-visual-open" data-profile="${escapeHTML(p.id)}" data-profile-track="${track}" aria-label="Открыть профиль: ${escapeHTML(p.anon_name)}"></button>
      <button type="button" class="save-button ${isSaved ? 'is-saved' : ''}" data-save="${escapeHTML(p.id)}" aria-label="${isSaved ? 'Убрать из избранного' : 'В избранное'}: ${escapeHTML(p.anon_name)}" aria-pressed="${isSaved}">${icon('heart')}</button>
    </div>
    <div class="card-body" data-profile="${escapeHTML(p.id)}" data-profile-track="${track}"><div class="card-title-row"><h3><button type="button" class="card-open card-title-button" data-profile="${escapeHTML(p.id)}" data-profile-track="${track}">${escapeHTML(p.anon_name)}</button></h3><span class="synthetic-badge">${p.synthetic ? 'Демо-профиль' : 'В каталоге'}</span></div>
      <div class="category-city">${escapeHTML(p.categories.join(', '))}<span>·</span>${escapeHTML(p.city)}</div>
      <div class="price-row"><span class="from">от</span><strong>${money(p.price_from_kzt)} ₸</strong><span class="per-event">за событие</span></div>
      <div class="fact-tags"><span>${escapeHTML(p.languages.map(capitalize).join(' · '))}</span><span>${p.max_hours == null ? 'Без привязки к часам' : `До ${escapeHTML(p.max_hours)} часов`}</span></div>
      <p class="description">${escapeHTML(p.description)}</p>
      ${!isSavedView ? `<div class="explanation"><strong>${icon('sparkles')} Почему в вашей подборке</strong><p>${escapeHTML(p.explanation)}</p></div>` : ''}
      <button type="button" class="card-more" data-profile="${escapeHTML(p.id)}" data-profile-track="${track}">Открыть полный профиль <span aria-hidden="true">↗</span></button>
    </div></article>`;
}
function reasonText(result) {
  return Object.entries(result.reason_counts).map(([key, count]) => `${count} — ${reasons[key]}`).join('; ');
}
function renderResult(result) {
  currentResult = result;
  $('#result-count').textContent = result.cards.length;
  const q = result.query;
  const querySummary = [niceDate(q.date), q.city, q.category, capitalize(q.event_format), `Бюджет до ${money(q.budget)} ₸`, q.hours == null ? 'Любая длительность' : `${q.hours} ч`, q.language ? capitalize(q.language) : 'Любой язык'];
  let summary = '';
  if (result.status === 'matched') {
    summary += `Подходящих вариантов: ${result.eligible_count}${result.eligible_count > 3 ? ' — показываем первые три' : ''}. Откройте профиль, чтобы познакомиться ближе.`;
    if (result.cards.length < 3 && !result.excluded_count) summary += ' В этой категории и городе в каталоге только столько профилей.';
  } else if (result.status === 'no_category') summary += 'В каталоге нет такой категории в выбранном городе.';
  else summary += `Проверили ${result.pool_count} профилей — ни один не проходит все условия.`;
  $('#result-summary').innerHTML = `<p class="query-summary">${querySummary.map(escapeHTML).join(' <span aria-hidden="true">·</span> ')}</p><p class="result-context">${summary}</p>`;
  const pipeline = $('#pipeline-stats');
  if (pipeline) pipeline.innerHTML = [[result.pool_count, 'В вашем городе'], [result.excluded_count, 'Не прошли условия'], [result.eligible_count, 'Для вашего события']].map(([count, label]) => `<div class="pipeline-stat"><strong>${count}</strong><span>${label}</span></div>`).join('');
  if (result.cards.length) $('#cards').innerHTML = result.cards.map((p, i) => cardHTML(p, i)).join('');
  else {
    const absent = result.status === 'no_category';
    $('#cards').innerHTML = `<div class="empty-state"><div class="empty-icon">${icon('search')}</div><h3>${absent ? 'Здесь пока нет таких подрядчиков' : 'На этих условиях совпадений нет'}</h3><p>${absent ? `В городе «${escapeHTML(result.query.city)}» нет категории «${escapeHTML(result.query.category)}». Выберите другой город или категорию.` : `${escapeHTML(reasonText(result))}. Один профиль может не пройти сразу несколько условий.`}</p>
      ${!absent && result.reason_counts.budget ? '<p>Попробуйте увеличить бюджет: исходная цена «от» превышает ваш лимит у части кандидатов.</p>' : ''}
      ${result.alternative_dates.length ? `<p>На ближайшие даты есть совпадения с теми же условиями:</p>${result.alternative_dates.map(d => `<button class="secondary-button" data-date="${d.date}">${niceDate(d.date)} · ${d.count} проф.</button>`).join('')}` : ''}
      <button class="secondary-button" data-edit>Изменить параметры ↑</button></div>`;
  }
  setupCarousel('cards');
  refreshSaveButtons();
  $('#result-details').innerHTML = `<details class="audit"><summary>Почему показаны эти варианты?</summary><div class="audit-content"><p>Цена «от» — нижняя граница, а свободная дата означает только отсутствие отметки о занятости в датасете. Это не подтверждение бронирования.</p>${result.excluded_count ? `<div class="audit-badges">${Object.entries(result.reason_counts).map(([k,v]) => `<span>${v} · ${reasons[k]}</span>`).join('')}</div><p>Причины могут пересекаться. Исключённые профили:</p><ul>${result.excluded.map(p => `<li>${escapeHTML(p.name)} — ${p.reasons.map(r => reasons[r]).join(', ')}</li>`).join('')}</ul>` : '<p>Ни один профиль этой категории и города не исключён условиями заявки.</p>'}</div></details>`;
}
async function search(scroll = false) {
  if (!$('#search-form').reportValidity()) return;
  const version = ++requestVersion;
  const query = formQuery();
  ++compareVersion;
  dateCompareBusy = false;
  $('#compare-result').innerHTML = '';
  $('#submit-button').disabled = true;
  setSubmitLabel('Подбираем подрядчиков…');
  setStatus('#selection-state', 'Проверяем условия…', 'loading');
  $('.results-section').setAttribute('aria-busy', 'true');
  document.body.classList.add('loading');
  updateSelectionState();
  try {
    const result = await api('/api/recommend', query);
    if (version !== requestVersion) return;
    renderedQuery = JSON.stringify(query);
    renderResult(result);
    rememberQuery(query);
    updateShareAddress(query);
    setStatus('#connection-status', 'Готовы к вашему событию', 'success');
    if (scroll && JSON.stringify(formQuery()) === renderedQuery) $('.results-section').scrollIntoView({behavior: scrollBehavior(), block: 'start'});
  } catch (error) {
    if (version !== requestVersion) return;
    currentResult = null;
    setStatus('#selection-state', 'Не удалось выполнить подбор', 'error');
    setStatus('#connection-status', 'Запрос не выполнен', 'error');
    const pipeline = $('#pipeline-stats'); if (pipeline) pipeline.innerHTML = '';
    $('#cards').innerHTML = ''; setupCarousel('cards'); $('#result-details').innerHTML = ''; $('#result-count').textContent = '0';
    $('#result-summary').innerHTML = `<div class="error-notice">${escapeHTML(error.message)}. Проверьте параметры и повторите подбор.</div>`;
  } finally {
    if (version === requestVersion) {
      $('#submit-button').disabled = false;
      setSubmitLabel('Подобрать подрядчиков');
      document.body.classList.remove('loading');
      $('.results-section').setAttribute('aria-busy', 'false');
      updateSelectionState();
    }
  }
}
$('#search-form').addEventListener('submit', event => { event.preventDefault(); search(true); });
$('#search-form').addEventListener('input', updateSelectionState);
$('#search-form').addEventListener('change', updateSelectionState);
const scenarios = {
  hosts: {city:'Алматы', date:'2026-10-17', event_format:'свадьба', category:'Ведущий', budget:1000000, hours:'', language:''},
  florists: {city:'Алматы', date:'2026-10-17', event_format:'свадьба', category:'Флорист', budget:300000, hours:6, language:''}
};
document.querySelectorAll('[data-scenario]').forEach(button => button.addEventListener('click', () => {
  for (const [field, value] of Object.entries(scenarios[button.dataset.scenario])) {
    const el = $(`#${field}`);
    if (el.tagName === 'SELECT' && !Array.from(el.options).some(o => o.value === value)) el.add(new Option(value, value));
    el.value = value;
  }
  search(true);
}));
$('#reset-query').addEventListener('click', () => {
  if (!meta) return;
  const initial = {...scenarios.hosts};
  if (!selectableCities().includes(initial.city)) initial.city = selectableCities()[0];
  if (!meta.categories.includes(initial.category)) initial.category = meta.categories[0];
  applyQuery(initial);
  search(true);
});
$('#clear-history').addEventListener('click', () => {
  queryHistory = []; renderQueryHistory();
  try {
    localStorage.removeItem(historyKey());
    $('#session-note').textContent = 'История очищена. Следующий выполненный подбор сохранится автоматически.';
  } catch {
    $('#session-note').textContent = 'История очищена в этой вкладке. Браузер не разрешил удалить сохранённую копию.';
  }
});
async function loadFavorites() {
  const version = ++favoritesVersion;
  const userId = accountUser?.id;
  saved = [];
  favoritesReady = !userId;
  favoritesLoading = Boolean(userId);
  updateSaved(); refreshSaveButtons();
  if (!userId) {
    try {
      const stored = JSON.parse(localStorage.getItem('toyga-saved') || '[]');
      saved = Array.isArray(stored) ? stored.filter(p => p && typeof p.id === 'string' && Array.isArray(p.categories) && Array.isArray(p.languages) && Array.isArray(p.event_formats) && Array.isArray(p.busy_dates) && Number.isFinite(p.price_from_kzt)) : [];
    } catch { saved = []; }
  } else {
    try {
      const response = await window.ToygaAccount.request('/api/account/favorites');
      if (version !== favoritesVersion || userId !== accountUser?.id) return;
      if (response.user_id !== userId) {
        const error = new Error('В другой вкладке изменился аккаунт. Обновляем ваш список.');
        error.code = 'account_changed';
        throw error;
      }
      if (response.catalog_id !== meta.catalog_id) throw new Error('Каталог обновился. Обновите страницу.');
      saved = response.profiles;
      favoritesReady = true;
    } catch (error) {
      if (version !== favoritesVersion) return;
      if (error.status === 401 || error.code === 'account_changed') await window.ToygaAccount.refreshSession();
      else notify('Не удалось загрузить избранное. Можно повторить в разделе «Избранное».');
    }
  }
  if (version === favoritesVersion) { favoritesLoading = false; updateSaved(); refreshSaveButtons(); }
}
async function toggleSaved(button) {
  if (favoriteBusy || (accountUser && !favoritesReady)) return;
  const id = button.dataset.save;
  const profile = currentResult?.cards.find(p => p.id === id) || saved.find(p => p.id === id) || activeProfile?.profiles.find(p => p.id === id);
  if (!profile) return;
  const removing = saved.some(p => p.id === id);
  const next = removing ? saved.filter(p => p.id !== id) : [...saved, profile];
  const userId = accountUser?.id;
  const restoreFocus = button.closest('#saved-cards') && document.activeElement === button;
  favoriteBusy = true; refreshSaveButtons();
  try {
    if (userId) {
      const response = await window.ToygaAccount.request('/api/account/favorites', {action:removing ? 'remove' : 'add', profile_id:id, catalog_id:meta.catalog_id, expected_user_id:userId});
      if (userId !== accountUser?.id) return;
      if (response.user_id !== userId) throw new Error('Аккаунт изменился. Обновите страницу.');
      saved = response.profiles;
    } else {
      saved = next;
      try { localStorage.setItem('toyga-saved', JSON.stringify(saved)); }
      catch { notify('Избранное сохранится только до закрытия страницы.'); }
    }
    updateSaved();
    notify(removing ? 'Профиль убран из избранного' : userId ? 'Профиль сохранён в вашем аккаунте' : 'Профиль сохранён в этом браузере');
    if (restoreFocus) ($('#saved-cards').querySelector('button') || $('[data-view="saved"]')).focus({preventScroll:true});
  } catch (error) {
    if (error.code === 'account_changed') {
      const previousUserId = accountUser?.id;
      await window.ToygaAccount.refreshSession();
      if (previousUserId === accountUser?.id) await loadFavorites();
      notify('В другой вкладке изменился аккаунт. Список обновлён — повторите действие.');
    }
    else if (error.status === 401) { await window.ToygaAccount.refreshSession(); notify('Сессия завершилась. Войдите ещё раз.'); }
    else notify(error.message);
  } finally { favoriteBusy = false; refreshSaveButtons(); }
}
function updateSaved() {
  $('#saved-notice').innerHTML = favoritesLoading ? 'Загружаем ваше избранное…' : accountUser ? (favoritesReady ? 'Избранное сохраняется в вашем аккаунте. Доступность проверяйте подбором на нужную дату.' : 'Не удалось загрузить избранное. <button class="text-button" data-refresh-saved>Попробовать снова</button>') : 'Избранное хранится в этом браузере. <button class="text-button" data-account-open>Войти и сохранять в аккаунте</button>';
  const position = $('#saved-cards').scrollLeft;
  $('#saved-count').textContent = favoritesLoading ? '…' : saved.length;
  $('#saved-cards').setAttribute('aria-busy', String(favoritesLoading));
  $('#saved-cards').innerHTML = accountUser && !favoritesReady ? '' : saved.length ? saved.map((p, i) => cardHTML(p, i, true)).join('') : '<div class="empty-state"><div class="empty-icon">' + icon('heart') + '</div><h3>Ваш список начинается с симпатии</h3><p>Нажмите на сердечко в карточке подрядчика — профиль появится здесь.</p><button class="small-primary" data-back>Вернуться к подбору</button></div>';
  setupCarousel('saved-cards', true);
  $('#saved-cards').scrollLeft = position;
}
function switchView(name) {
  $('#selection-view').hidden = name !== 'selection'; $('#saved-view').hidden = name !== 'saved';
  $('#page-label').textContent = name === 'saved' ? 'Избранное' : 'Подбор подрядчиков';
  document.querySelectorAll('[data-view]').forEach(el => el.classList.toggle('active', el.dataset.view === name));
  updateSaved();
  window.ToygaMotion?.refresh();
  if (name === 'saved') $('#saved-view').scrollIntoView({behavior: scrollBehavior(), block:'start'});
  requestAnimationFrame(() => updateCarousel(name === 'saved' ? $('#saved-cards') : $('#cards')));
}
document.querySelectorAll('[data-view]').forEach(el => el.addEventListener('click', () => switchView(el.dataset.view)));
function refreshSaveButtons() {
  document.querySelectorAll('[data-save]').forEach(button => {
    const p = currentResult?.cards.find(p => p.id === button.dataset.save) || saved.find(p => p.id === button.dataset.save) || activeProfile?.profiles.find(p => p.id === button.dataset.save);
    if (!p) return;
    const isSaved = saved.some(item => item.id === p.id);
    button.disabled = favoriteBusy || (Boolean(accountUser) && !favoritesReady);
    button.classList.toggle('is-saved', isSaved);
    button.setAttribute('aria-pressed', String(isSaved));
    button.setAttribute('aria-label', `${isSaved ? 'Убрать из избранного' : 'В избранное'}: ${p.anon_name}`);
    if (button.classList.contains('profile-save')) button.innerHTML = `${icon('heart')}<span>${isSaved ? 'В избранном' : 'Сохранить в избранное'}</span>`;
  });
}
document.addEventListener('click', event => {
  const carouselControl = event.target.closest('[data-carousel-track]');
  if (carouselControl) {
    const track = document.getElementById(carouselControl.dataset.carouselTrack);
    if (carouselControl.hasAttribute('data-carousel-index')) moveCarousel(track, Number(carouselControl.dataset.carouselIndex));
    else moveCarouselRelative(track, Number(carouselControl.dataset.carouselStep));
    return;
  }
  const profileNavigation = event.target.closest('[data-profile-nav]');
  if (profileNavigation && activeProfile) {
    const next = activeProfile.index + Number(profileNavigation.dataset.profileNav);
    if (next >= 0 && next < activeProfile.profiles.length) showProfile(activeProfile.profiles[next], {...activeProfile, index: next, focusSelector: `[data-profile-nav="${profileNavigation.dataset.profileNav}"]`});
    return;
  }
  const save = event.target.closest('[data-save]');
  if (save) {
    toggleSaved(save);
    return;
  }
  if (event.target.closest('[data-account-open]')) { window.ToygaAccount.open(); return; }
  if (event.target.closest('[data-refresh-saved]')) { loadFavorites(); return; }
  const profile = event.target.closest('[data-profile]');
  if (profile && !window.getSelection()?.toString()) {
    const trackId = profile.dataset.profileTrack;
    const profiles = (trackId === 'saved-cards' ? saved : currentResult?.cards || []).slice();
    const index = profiles.findIndex(p => p.id === profile.dataset.profile);
    if (index >= 0) showProfile(profiles[index], {profiles, index, trackId, trigger: profile.closest('button') || profile.querySelector('[data-profile]')});
  }
  const day = event.target.closest('[data-date]');
  if (day) { $('#date').value = day.dataset.date; search(true); }
  const recent = event.target.closest('[data-recent]');
  if (recent && queryHistory[Number(recent.dataset.recent)]) { applyQuery(queryHistory[Number(recent.dataset.recent)]); search(true); }
  if (event.target.closest('[data-edit]')) { $('#search-form').scrollIntoView({behavior:scrollBehavior(), block:'center'}); $('#city').focus({preventScroll:true}); }
  if (event.target.closest('[data-back]')) switchView('selection');
});
function openDialog(html, kicker = 'ВАШЕ СОБЫТИЕ', options = {}) {
  const dialog = $('#info-dialog');
  profileObserver?.disconnect(); profileObserver = null;
  activeProfile = null;
  dialog.classList.remove('dialog-wide', 'profile-dialog', 'motion-ready');
  if (options.profile) dialog.classList.add('profile-dialog');
  if (!dialog.open) {
    dialogReturnFocus = options.trigger || document.activeElement;
    dialogReturnCard = options.profile ? {id: options.id, trackId: options.trackId} : null;
    previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.body.classList.add('dialog-open');
  }
  $('#dialog-content').innerHTML = html; $('#dialog-kicker').textContent = kicker;
  const title = $('#dialog-content').querySelector('h2');
  if (title) { if (!title.id) title.id = 'dialog-title'; dialog.setAttribute('aria-labelledby', title.id); }
  else dialog.setAttribute('aria-labelledby', 'dialog-kicker');
  if (!dialog.open) dialog.showModal();
  dialog.scrollTop = 0;
}
$('#close-dialog').addEventListener('click', () => $('#info-dialog').close());
$('#info-dialog').addEventListener('click', event => { if (event.target === $('#info-dialog')) { const rect = event.target.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) event.target.close(); } });
$('#info-dialog').addEventListener('close', () => {
  profileObserver?.disconnect(); profileObserver = null; activeProfile = null;
  document.body.style.overflow = previousBodyOverflow;
  document.body.classList.remove('dialog-open');
  let target = dialogReturnFocus?.isConnected ? dialogReturnFocus : null;
  if (!target && dialogReturnCard) target = Array.from(document.getElementById(dialogReturnCard.trackId)?.querySelectorAll('button[data-profile]') || []).find(button => button.dataset.profile === dialogReturnCard.id);
  if (!target && dialogReturnCard) target = document.getElementById(dialogReturnCard.trackId)?.querySelector('button');
  (target || $('#submit-button')).focus({preventScroll: true});
  dialogReturnFocus = null; dialogReturnCard = null;
});
$('#compare-profiles').addEventListener('click', () => {
  if ($('#compare-profiles').disabled || !currentResult) return;
  const cards = currentResult.cards;
  const rows = [
    ['Цена от', p => `${money(p.price_from_kzt)} ₸`],
    ['Остаток бюджета от цены «от»', p => `${money(p.budget_remaining)} ₸`],
    ['Город', p => p.city],
    ['Языки', p => p.languages.map(capitalize).join(', ')],
    ['Длительность', p => p.max_hours == null ? 'Без привязки к часам' : `До ${p.max_hours} ч`],
    ['Форматы', p => p.event_formats.map(capitalize).join(', ')],
    [`Дата · ${niceDate(currentResult.query.date)}`, () => 'Не отмечена занятой'],
    ['Происхождение', p => p.synthetic ? 'Демо-профиль' : 'Профиль из каталога'],
    ['Дополненные данные', p => [p.price_imputed && 'Цена', p.city_imputed && 'Город'].filter(Boolean).join(', ') || 'Нет отметок о дополнении'],
    ['Из описания', p => p.description_excerpt || p.description]
  ];
  openDialog(`<h2>Сравните детали.<br>Выберите своих.</h2><p>${escapeHTML(currentResult.query.category)} · ${escapeHTML(currentResult.query.city)} · ${niceDate(currentResult.query.date)} · бюджет до ${money(currentResult.query.budget)} ₸</p><div class="table-scroll" tabindex="0" role="region" aria-label="Сравнение подрядчиков, таблицу можно прокрутить по горизонтали"><table class="profile-comparison"><caption class="sr-only">Сравнение ${cards.length} подрядчиков из текущей подборки</caption><thead><tr><th scope="col">Параметр</th>${cards.map(p => `<th scope="col">${escapeHTML(p.anon_name)}</th>`).join('')}</tr></thead><tbody>${rows.map(([name, value]) => `<tr><th scope="row">${escapeHTML(name)}</th>${cards.map(p => `<td>${escapeHTML(value(p))}</td>`).join('')}</tr>`).join('')}</tbody></table></div><p>Все варианты прошли условия заявки. Цена «от» не является итоговой сметой; доступность отражает только календарь каталога.</p>`, 'СРАВНЕНИЕ ПОДРЯДЧИКОВ');
  $('#info-dialog').classList.add('dialog-wide');
});
function selectionText(result) {
  const q = result.query;
  const lines = ['Тойға — подборка подрядчиков', `${q.city} · ${niceDate(q.date)} 2026 · ${capitalize(q.event_format)} · ${q.category}`, `Бюджет до ${money(q.budget)} ₸ · ${q.hours == null ? 'любая длительность' : q.hours + ' ч'} · ${q.language || 'любой язык'}`, ''];
  if (!result.cards.length) lines.push(result.status === 'no_category' ? 'В этом городе такой категории нет.' : 'Никто не проходит условия: ' + reasonText(result) + '.');
  result.cards.forEach((p, index) => lines.push(`${index + 1}. ${p.anon_name} — от ${money(p.price_from_kzt)} ₸`, `${p.categories.join(', ')} · ${p.city} · ${p.synthetic ? 'синтетический' : 'исходный'} профиль`, p.explanation, ''));
  lines.push('Цена «от» — нижняя граница, не итоговая смета. Отсутствие отметки о занятости не подтверждает бронирование.');
  return lines.join('\n');
}
async function copyField(selector, successText) {
  const field = $(selector);
  try {
    if (!navigator.clipboard) throw new Error('Clipboard unavailable');
    await navigator.clipboard.writeText(field.value); notify(successText);
  } catch {
    field.focus(); field.select();
    notify('Текст выделен. Нажмите Ctrl+C или ⌘C, чтобы скопировать.');
  }
}
$('#share-result').addEventListener('click', () => {
  if ($('#share-result').disabled || !currentResult) return;
  const url = queryState.shareURL(window.location.href, currentResult.query, meta.catalog_id);
  const localOnly = ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname);
  openDialog(`<h2>Выбирать вместе проще.</h2><p>Скопируйте подборку для обсуждения или сохраните ссылку с её параметрами.</p><label class="share-label" for="share-text">Текст подборки</label><textarea id="share-text" readonly rows="8"></textarea><div class="dialog-actions"><button id="copy-selection" class="small-primary">Скопировать текст</button><button id="download-selection" class="secondary-button">Скачать .txt</button></div><label class="share-label" for="share-link">Ссылка на параметры</label><input id="share-link" type="text" readonly><div class="dialog-actions"><button id="copy-link" class="secondary-button">Скопировать ссылку</button></div><p>${localOnly ? 'Сайт запущен локально: ссылка работает только на этом компьютере при работающем сервере. Другим людям отправьте текст или файл подборки.' : 'Ссылка откроет ту же заявку на этом сайте. При изменении каталога результаты могут отличаться.'} Ссылка содержит параметры, а не зафиксированный список подрядчиков.</p>`, 'ВАША ПОДБОРКА');
  $('#share-text').value = selectionText(currentResult);
  $('#share-link').value = url;
  $('#copy-selection').addEventListener('click', () => copyField('#share-text', 'Текст подборки скопирован'));
  $('#copy-link').addEventListener('click', () => copyField('#share-link', 'Ссылка на параметры скопирована'));
  $('#download-selection').addEventListener('click', () => {
    const blobURL = URL.createObjectURL(new Blob(['\ufeff', $('#share-text').value], {type:'text/plain;charset=utf-8'}));
    const anchor = document.createElement('a'); anchor.href = blobURL; anchor.download = `toyga-${currentResult.query.date}.txt`;
    document.body.append(anchor); anchor.click(); anchor.remove();
    setTimeout(() => URL.revokeObjectURL(blobURL), 10000);
  });
});
function revealProfileSections() {
  const dialog = $('#info-dialog');
  const sections = dialog.querySelectorAll('.profile-reveal');
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || !('IntersectionObserver' in window)) {
    sections.forEach(section => section.classList.add('is-visible'));
    return;
  }
  profileObserver = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (entry.isIntersecting) { entry.target.classList.add('is-visible'); profileObserver?.unobserve(entry.target); }
    });
  }, {root: dialog, threshold: 0.08});
  dialog.classList.add('motion-ready');
  sections.forEach(section => profileObserver.observe(section));
}
function showProfile(p, context = {}) {
  if (!meta) { notify('Каталог ещё загружается. Профиль скоро будет доступен.'); return; }
  const profiles = context.profiles || [p];
  const index = context.index ?? profiles.findIndex(profile => profile.id === p.id);
  const currentMatch = currentResult && !document.body.classList.contains('loading') && JSON.stringify(formQuery()) === renderedQuery ? currentResult.cards.find(profile => profile.id === p.id) : null;
  const requestedDate = currentResult?.query.date || $('#date').value;
  const selectedDate = /^\d{4}-\d{2}-\d{2}$/.test(requestedDate) ? requestedDate : meta.min_date;
  const month = selectedDate.slice(0, 7);
  const days = new Date(Number(month.slice(0, 4)), Number(month.slice(5)), 0).getDate();
  const offset = (new Date(`${month}-01T12:00:00`).getDay() + 6) % 7;
  const monthTitle = new Date(`${month}-01T12:00:00`).toLocaleDateString('ru-RU', {month: 'long', year: 'numeric'});
  const isSaved = saved.some(profile => profile.id === p.id);
  const initials = p.anon_name.split(/[\s«]+/).filter(Boolean).slice(0, 2).map(part => part[0]).join('');
  const dateBusy = p.busy_dates.includes(selectedDate);
  const facts = [
    ['Город', p.city],
    ['Категории', p.categories.join(', ')],
    ['Языки', p.languages.map(capitalize).join(' · ')],
    ['Длительность', p.max_hours == null ? 'Без привязки к часам' : `До ${p.max_hours} часов`],
    ['Форматы событий', p.event_formats.map(capitalize).join(' · ')]
  ];
  openDialog(`<div class="profile-hero theme-${index % 3 + 1}"><div class="profile-hero-copy"><span class="profile-kicker">${escapeHTML(p.categories[0] || 'Подрядчик')} · ${escapeHTML(p.city)}</span><h2 id="profile-dialog-title">${escapeHTML(p.anon_name)}</h2><p class="profile-lead">${escapeHTML(p.categories.join(' · '))}<br>${escapeHTML(p.event_formats.map(capitalize).join(' · '))}</p><div class="profile-price"><small>Стоимость из каталога</small><strong>от ${money(p.price_from_kzt)} ₸</strong><span>За событие · итоговую смету нужно уточнить</span></div>${profiles.length > 1 ? '<p class="profile-swipe-hint"><span aria-hidden="true">↔</span> Листайте стрелками или свайпом по обложке</p>' : ''}</div><div class="profile-hero-art" aria-hidden="true"><span>${escapeHTML(initials)}</span><i></i><b>ТОЙҒА</b></div></div>
    <div class="profile-toolbar"><div class="profile-navigation">${profiles.length > 1 ? `<button type="button" class="carousel-arrow" data-profile-nav="-1" aria-label="Предыдущий профиль" ${index === 0 ? 'disabled' : ''}>←</button><span class="profile-position" aria-live="polite">Профиль ${index + 1} из ${profiles.length}</span><button type="button" class="carousel-arrow" data-profile-nav="1" aria-label="Следующий профиль" ${index === profiles.length - 1 ? 'disabled' : ''}>→</button>` : '<span class="profile-position">Полный профиль подрядчика</span>'}</div><button type="button" class="small-primary profile-save ${isSaved ? 'is-saved' : ''}" data-save="${escapeHTML(p.id)}" aria-pressed="${isSaved}" aria-label="${isSaved ? 'Убрать из избранного' : 'В избранное'}: ${escapeHTML(p.anon_name)}">${icon('heart')}<span>${isSaved ? 'В избранном' : 'Сохранить в избранное'}</span></button></div>
    <div class="profile-layout"><section class="profile-section profile-reveal profile-about" style="--reveal-order:0"><span class="profile-kicker">01 / ЗНАКОМСТВО</span><h3>О подрядчике</h3><p class="profile-description">${escapeHTML(p.description)}</p><p class="profile-data-note">Описание из каталога.${meta.source === 'original' ? ' Для защиты приватности имена заменены.' : ''}</p></section>
    <section class="profile-section profile-reveal" style="--reveal-order:1"><span class="profile-kicker">02 / ДЕТАЛИ</span><h3>Для вашего события</h3><div class="profile-facts">${facts.map(([label, value]) => `<div><small>${escapeHTML(label)}</small><strong>${escapeHTML(value)}</strong></div>`).join('')}</div></section>
    <section class="profile-section profile-reveal profile-calendar" style="--reveal-order:2"><span class="profile-kicker">03 / КАЛЕНДАРЬ</span><h3>${capitalize(monthTitle)}</h3><p class="profile-calendar-status ${dateBusy ? 'is-busy' : ''}"><span>${niceDate(selectedDate)} — ${dateBusy ? 'есть отметка о занятости' : 'нет отметки о занятости'}</span></p><div class="calendar-grid" role="group" aria-label="Занятость за ${escapeHTML(monthTitle)}">${['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map(day => `<b>${day}</b>`).join('')}${Array.from({length: offset}, () => '<i aria-hidden="true"></i>').join('')}${Array.from({length: days}, (_, dayIndex) => {
      const date = `${month}-${String(dayIndex + 1).padStart(2, '0')}`;
      const unknown = date < meta.min_date || date > meta.max_date;
      const busy = p.busy_dates.includes(date);
      const label = `${date}: ${unknown ? 'нет данных' : busy ? 'занят' : 'нет отметки о занятости'}${date === selectedDate ? ', дата заявки' : ''}`;
      return `<span class="${busy ? 'busy' : ''} ${date === selectedDate ? 'selected' : ''} ${unknown ? 'unknown' : ''}" aria-label="${escapeHTML(label)}" title="${escapeHTML(label)}">${unknown ? '—' : dayIndex + 1}</span>`;
    }).join('')}</div><p class="profile-data-note">Зачёркнуты занятые дни. Обводка — дата последней заявки. Доступность нужно подтвердить у подрядчика перед бронированием.</p></section>
    ${currentMatch ? `<section class="profile-section profile-reveal profile-match" style="--reveal-order:0"><span class="profile-kicker">04 / ВАША ЗАЯВКА</span><h3>Почему в подборке</h3><p>${escapeHTML(currentMatch.explanation)}</p><div class="profile-budget"><small>Запас до бюджета по цене «от»</small><strong>${money(currentMatch.budget_remaining)} ₸</strong></div><p class="profile-data-note">Условия проверены для заявки: ${niceDate(currentResult.query.date)} · ${escapeHTML(currentResult.query.city)} · ${escapeHTML(capitalize(currentResult.query.event_format))}.</p></section>` : `<section class="profile-section profile-reveal profile-match" style="--reveal-order:0"><span class="profile-kicker">04 / УСЛОВИЯ ПОДБОРА</span><h3>Проверьте по вашей заявке</h3><p>Открытый профиль сейчас не подтверждён актуальной подборкой. Задайте дату, бюджет и остальные условия, затем выполните подбор.</p><p class="profile-data-note">Сохранение в избранное не означает соответствие новой заявке.</p></section>`}
    <section class="profile-section profile-reveal profile-provenance" style="--reveal-order:1"><span class="profile-kicker">05 / ПЕРЕД ВЫБОРОМ</span><h3>Полезно знать</h3><div class="fact-tags"><span>${p.synthetic ? 'Демо-профиль' : 'Профиль из каталога'}</span>${p.price_imputed ? '<span>Ориентировочная цена</span>' : ''}${p.city_imputed ? '<span>Город нужно уточнить</span>' : ''}</div><p>${p.synthetic ? 'Этот профиль используется для демонстрации подбора.' : ''} ${p.price_imputed ? 'Стоимость ориентировочная: она добавлена при подготовке каталога. ' : ''}${p.city_imputed ? 'В исходной анкете город не был указан — его нужно уточнить. ' : ''}Цена «от» — нижняя граница, а не итоговая смета.</p><p class="profile-data-note">Связь с подрядчиком и бронирование в этой версии не предусмотрены.</p></section></div>`, 'ПОЛНЫЙ ПРОФИЛЬ', {profile: true, trigger: context.trigger, trackId: context.trackId, id: p.id});
  activeProfile = {profiles, index, trackId: context.trackId};
  refreshSaveButtons();
  revealProfileSections();
  const hero = $('.profile-hero');
  let swipeStart = null;
  hero.addEventListener('pointerdown', event => {
    if (profiles.length < 2 || !event.isPrimary || !['touch', 'pen'].includes(event.pointerType)) return;
    swipeStart = {x: event.clientX, y: event.clientY, time: performance.now(), id: event.pointerId};
    hero.setPointerCapture(event.pointerId);
  });
  hero.addEventListener('pointercancel', () => { swipeStart = null; });
  hero.addEventListener('pointerup', event => {
    if (!swipeStart || event.pointerId !== swipeStart.id) return;
    const dx = event.clientX - swipeStart.x, dy = event.clientY - swipeStart.y;
    const elapsed = performance.now() - swipeStart.time;
    swipeStart = null;
    if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.4 || elapsed > 1000) return;
    const next = index + (dx < 0 ? 1 : -1);
    if (next >= 0 && next < profiles.length) showProfile(profiles[next], {...activeProfile, index: next});
  });
  if (context.focusSelector) requestAnimationFrame(() => {
    const requested = $(context.focusSelector);
    const fallback = $('#info-dialog').querySelector('[data-profile-nav]:not(:disabled)');
    (requested && !requested.disabled ? requested : fallback || $('#close-dialog')).focus({preventScroll: true});
  });
}
$('#compare-button').addEventListener('click', () => { $('#compare-panel').hidden = !$('#compare-panel').hidden; });
$('#run-compare').addEventListener('click', async () => {
  if ($('#run-compare').disabled) return;
  if (!currentResult) { notify('Сначала выполните подбор'); return; }
  const day = $('#compare-date').value;
  if (!day || !$('#compare-date').reportValidity()) return;
  const original = currentResult; const version = ++compareVersion;
  dateCompareBusy = true;
  updateSelectionState();
  try {
    const other = await api('/api/recommend', {...original.query, date:day});
    if (version !== compareVersion || currentResult !== original || JSON.stringify(formQuery()) !== renderedQuery) return;
    const removed = original.cards.filter(p => !other.cards.some(o => o.id === p.id));
    const added = other.cards.filter(p => !original.cards.some(o => o.id === p.id));
    const columns = [original, other].map(r => `<div><strong>${niceDate(r.query.date)}</strong><br>${r.cards.length ? r.cards.map(p=>escapeHTML(p.anon_name)).join('<br>') : 'Нет совпадений'}<br><span class="muted">Заняты в категории: ${r.reason_counts.busy || 0}</span></div>`).join('');
    $('#compare-result').innerHTML = `<div class="compare-columns">${columns}</div><p>${removed.map(p => `${escapeHTML(p.anon_name)}: ${p.busy_dates.includes(day) ? 'занят(а) на новую дату' : 'вышел(ла) из первых трёх после изменения доступности других профилей'}.`).join(' ')} ${added.map(p => `${escapeHTML(p.anon_name)}: ${p.busy_dates.includes(original.query.date) ? 'на исходную дату занят(а), на новую нет отметки о занятости' : 'вошёл(ла) в первые три после изменения состава доступных профилей'}.`).join(' ')}${!removed.length && !added.length ? 'Первые три профиля совпадают. На этих датах календарь не изменил состав подборки.' : ''}</p><button class="secondary-button" data-date="${day}">Использовать ${niceDate(day)}</button>`;
  } catch (error) { if (version === compareVersion) $('#compare-result').textContent = error.message; }
  finally { if (version === compareVersion) { dateCompareBusy = false; updateSelectionState(); } }
});
window.addEventListener('toyga:account-change', async event => {
  accountUser = event.detail.user;
  if (!meta) return;
  loadQueryHistory();
  $('#session-note').textContent = accountUser ? 'История подборок этого аккаунта сохраняется в этом браузере.' : 'Последний выполненный подбор сохранится в этом браузере.';
  await loadFavorites();
});
updateSaved();
(async () => {
  try {
    await window.ToygaAccount.ready;
    accountUser = window.ToygaAccount.user;
    await loadMeta();
    const shared = queryState.fromURL(window.location.href, meta);
    let note = '';
    if (shared.provided) {
      if (shared.query && selectableCities().includes(shared.query.city)) {
        applyQuery(shared.query);
        note = shared.catalogId && shared.catalogId !== meta.catalog_id ? 'Каталог изменился. Параметры из ссылки проверены по текущим данным.' : 'Параметры загружены из ссылки. Доступность проверена заново.';
      } else note = 'Параметры ссылки сейчас недоступны. Уточните город и условия события.';
    } else if (queryHistory.length) {
      applyQuery(queryHistory[0]); note = 'Последний подбор восстановлен. Доступность проверена заново.';
    }
    await search(Boolean(shared.query));
    if (note && currentResult) $('#session-note').textContent = note;
  }
  catch (error) {
    setStatus('#selection-state', 'Каталог недоступен', 'error');
    $('#result-summary').innerHTML = `<div class="error-notice">Не удалось загрузить каталог: ${escapeHTML(error.message)}. Попробуйте обновить страницу немного позже.</div>`;
  }
})();
