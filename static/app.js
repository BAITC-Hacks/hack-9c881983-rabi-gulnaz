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
  search: '<circle cx="10" cy="10" r="7"/><path d="m15 15 6 6"/>'
};
const icon = (name) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.sparkles}</svg>`;
document.querySelectorAll('[data-icon]').forEach(el => { el.innerHTML = icon(el.dataset.icon); });
const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money = value => new Intl.NumberFormat('ru-RU', {maximumFractionDigits: 0}).format(value);
const niceDate = value => new Date(`${value}T12:00:00`).toLocaleDateString('ru-RU', {day: 'numeric', month: 'long'});
const capitalize = value => value.charAt(0).toUpperCase() + value.slice(1);
const reasons = {busy: 'заняты на выбранную дату', budget: 'цена выше бюджета', format: 'не работают с этим форматом', language: 'нет нужного языка', hours: 'недостаточная длительность'};
let meta, currentResult, requestVersion = 0, compareVersion = 0, toastTimer;
let saved = [];
try { const stored = JSON.parse(localStorage.getItem('toyga-saved') || '[]'); saved = Array.isArray(stored) ? stored.filter(p => p && typeof p.id === 'string' && Array.isArray(p.categories) && Array.isArray(p.languages) && Array.isArray(p.event_formats) && Array.isArray(p.busy_dates) && Number.isFinite(p.price_from_kzt)) : []; } catch { /* Storage is optional. */ }

async function api(path, body) {
  const response = await fetch(path, body ? {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)} : {});
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Не удалось выполнить запрос');
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
async function loadMeta() {
  meta = await api('/api/meta');
  fillSelect('city', meta.cities, 'Алматы');
  fillSelect('category', meta.categories, 'Ведущий');
  fillSelect('event_format', meta.formats, 'свадьба');
  fillSelect('language', meta.languages, '', 'Любой язык');
  $('#data-label').textContent = `${meta.count} профилей · ${{original:'датасет хакатона',demo:'демоданные',imported:'ваш каталог'}[meta.source] || 'каталог'}`;
  try {
    if (localStorage.getItem('toyga-catalog') !== meta.catalog_id) {
      saved = []; localStorage.removeItem('toyga-saved');
      localStorage.setItem('toyga-catalog', meta.catalog_id); updateSaved();
    }
  } catch { /* Storage is optional. */ }
}
function formQuery() { return Object.fromEntries(new FormData($('#search-form'))); }
function cardHTML(p, index, isSavedView = false) {
  const isSaved = saved.some(s => s.id === p.id);
  const initials = p.anon_name.split(/[\s«]+/).filter(Boolean).slice(0, 2).map(s => s[0]).join('');
  return `<article class="contractor-card">
    <div class="card-visual theme-${index % 3 + 1}"><div class="visual-pattern"></div><span class="visual-word">тойға.</span><div class="profile-monogram">${escapeHTML(initials)}</div>
      <span class="rank-badge">${icon(isSavedView ? 'heart' : 'check')}${isSavedView ? 'В вашем списке' : `${index + 1} · Подходит по условиям`}</span>
      <button class="save-button ${isSaved ? 'is-saved' : ''}" data-save="${escapeHTML(p.id)}" aria-label="${isSaved ? 'Убрать из избранного' : 'В избранное'}: ${escapeHTML(p.anon_name)}" aria-pressed="${isSaved}">${icon('heart')}</button>
    </div>
    <div class="card-body"><div class="card-title-row"><h3>${escapeHTML(p.anon_name)}</h3><span class="synthetic-badge">${p.synthetic ? 'Синтетический' : 'Исходный профиль'}</span></div>
      <div class="category-city">${escapeHTML(p.categories.join(', '))}<span>·</span>${escapeHTML(p.city)}</div>
      <div class="price-row"><span class="from">от</span><strong>${money(p.price_from_kzt)} ₸</strong><span class="per-event">за событие</span></div>
      <div class="fact-tags"><span>${escapeHTML(p.languages.map(capitalize).join(' · '))}</span><span>${p.max_hours == null ? 'Без привязки к часам' : `До ${escapeHTML(p.max_hours)} часов`}</span></div>
      <p class="description">${escapeHTML(p.description)}</p>
      ${!isSavedView ? `<div class="explanation"><strong>${icon('sparkles')} Почему в вашей подборке</strong><p>${escapeHTML(p.explanation)}</p></div>` : ''}
      <button class="card-more" data-profile="${escapeHTML(p.id)}">Подробнее о подрядчике <span>↗</span></button>
    </div></article>`;
}
function reasonText(result) {
  return Object.entries(result.reason_counts).map(([key, count]) => `${count} — ${reasons[key]}`).join('; ');
}
function renderResult(result) {
  currentResult = result;
  $('#result-count').textContent = result.cards.length;
  let summary = `${niceDate(result.query.date)} · ${escapeHTML(result.query.city)} · ${escapeHTML(capitalize(result.query.event_format))}. `;
  if (result.status === 'matched') {
    summary += `Проверили ${result.pool_count} профилей. Подходят ${result.eligible_count}${result.eligible_count > 3 ? ', показываем первые 3' : ''}.`;
    if (result.excluded_count) summary += ` Исключены ${result.excluded_count}: ${reasonText(result)}.`;
    if (result.cards.length < 3 && !result.excluded_count) summary += ' В этой категории и городе в каталоге только столько профилей.';
  } else if (result.status === 'no_category') summary += 'В каталоге нет такой категории в выбранном городе.';
  else summary += `Проверили ${result.pool_count} профилей — ни один не проходит все условия.`;
  if (meta.source === 'demo') summary += ' <span class="muted">Демонстрация: все профили синтетические.</span>';
  else if (meta.source === 'original') summary += ` <span class="muted">Датасет хакатона: ${meta.count} профилей, ${meta.synthetic_count} помечены синтетическими.</span>`;
  $('#result-summary').innerHTML = summary;
  if (result.cards.length) $('#cards').innerHTML = result.cards.map((p, i) => cardHTML(p, i)).join('');
  else {
    const absent = result.status === 'no_category';
    $('#cards').innerHTML = `<div class="empty-state"><div class="empty-icon">${icon('search')}</div><h3>${absent ? 'Здесь пока нет таких подрядчиков' : 'На этих условиях совпадений нет'}</h3><p>${absent ? `В городе «${escapeHTML(result.query.city)}» нет категории «${escapeHTML(result.query.category)}». Выберите другой город или категорию.` : `${escapeHTML(reasonText(result))}. Один профиль может не пройти сразу несколько условий.`}</p>
      ${!absent && result.reason_counts.budget ? '<p>Попробуйте увеличить бюджет: исходная цена «от» превышает ваш лимит у части кандидатов.</p>' : ''}
      ${result.alternative_dates.length ? `<p>На ближайшие даты есть совпадения с теми же условиями:</p>${result.alternative_dates.map(d => `<button class="secondary-button" data-date="${d.date}">${niceDate(d.date)} · ${d.count} проф.</button>`).join('')}` : ''}
      <button class="secondary-button" data-edit>Изменить параметры ↑</button></div>`;
  }
  $('#result-details').innerHTML = `<details class="audit"><summary>Прозрачный подбор: ${result.pool_count} в категории → ${result.eligible_count} подходят → ${result.cards.length} в подборке</summary><div class="audit-content"><p>${escapeHTML(result.ranking)}</p><p>Цена «от» — нижняя граница, а свободная дата означает только отсутствие отметки о занятости в датасете. Это не подтверждение бронирования.</p>${result.excluded_count ? `<div class="audit-badges">${Object.entries(result.reason_counts).map(([k,v]) => `<span>${v} · ${reasons[k]}</span>`).join('')}</div><p>Причины могут пересекаться. Исключённые профили:</p><ul>${result.excluded.map(p => `<li>${escapeHTML(p.name)} (${escapeHTML(p.id)}) — ${p.reasons.map(r => reasons[r]).join(', ')}</li>`).join('')}</ul>` : '<p>Ни один профиль этой категории и города не исключён условиями заявки.</p>'}</div></details>`;
}
async function search(scroll = false) {
  if (!$('#search-form').reportValidity()) return;
  const version = ++requestVersion;
  ++compareVersion;
  $('#compare-result').innerHTML = '';
  $('#submit-button').disabled = true;
  $('.results-section').setAttribute('aria-busy', 'true');
  document.body.classList.add('loading');
  try {
    const result = await api('/api/recommend', formQuery());
    if (version !== requestVersion) return;
    renderResult(result);
    if (scroll) $('.results-section').scrollIntoView({behavior: 'smooth', block: 'start'});
  } catch (error) {
    if (version !== requestVersion) return;
    currentResult = null;
    $('#cards').innerHTML = ''; $('#result-details').innerHTML = ''; $('#result-count').textContent = '0';
    $('#result-summary').innerHTML = `<div class="error-notice">${escapeHTML(error.message)}. Проверьте параметры и повторите подбор.</div>`;
  } finally {
    if (version === requestVersion) { $('#submit-button').disabled = false; document.body.classList.remove('loading'); $('.results-section').setAttribute('aria-busy', 'false'); }
  }
}
$('#search-form').addEventListener('submit', event => { event.preventDefault(); search(); });
const scenarios = {
  hosts: {city:'Алматы', date:'2026-10-17', event_format:'свадьба', category:'Ведущий', budget:1000000, hours:'', language:''},
  florists: {city:'Алматы', date:'2026-10-17', event_format:'свадьба', category:'Флорист', budget:300000, hours:6, language:''},
  empty: {city:'Алматы', date:'2026-10-17', event_format:'свадьба', category:'Ведущий', budget:10000, hours:'', language:''},
  missing: {city:'Зарубежье', date:'2026-10-17', event_format:'свадьба', category:'Ведущий', budget:1000000, hours:'', language:''}
};
document.querySelectorAll('[data-scenario]').forEach(button => button.addEventListener('click', () => {
  for (const [field, value] of Object.entries(scenarios[button.dataset.scenario])) {
    const el = $(`#${field}`);
    if (el.tagName === 'SELECT' && !Array.from(el.options).some(o => o.value === value)) el.add(new Option(value, value));
    el.value = value;
  }
  search();
}));
function updateSaved() {
  $('#saved-count').textContent = saved.length;
  $('#saved-cards').innerHTML = saved.length ? saved.map((p, i) => cardHTML(p, i, true)).join('') : '<div class="empty-state"><div class="empty-icon">' + icon('heart') + '</div><h3>Ваш список начинается с симпатии</h3><p>Нажмите на сердечко в карточке подрядчика — профиль появится здесь.</p><button class="small-primary" data-back>Вернуться к подбору</button></div>';
}
function switchView(name) {
  $('#selection-view').hidden = name !== 'selection'; $('#saved-view').hidden = name !== 'saved';
  $('#page-label').textContent = name === 'saved' ? 'Избранное' : 'Подбор подрядчиков';
  document.querySelectorAll('[data-view]').forEach(el => el.classList.toggle('active', el.dataset.view === name));
  updateSaved();
}
document.querySelectorAll('[data-view]').forEach(el => el.addEventListener('click', () => switchView(el.dataset.view)));
document.addEventListener('click', event => {
  const save = event.target.closest('[data-save]');
  if (save) {
    const id = save.dataset.save; const index = saved.findIndex(p => p.id === id);
    if (index >= 0) { saved.splice(index, 1); notify('Профиль убран из избранного'); }
    else { const p = currentResult?.cards.find(p => p.id === id); if (p) { saved.push(p); notify('Профиль сохранён в избранное'); } }
    try { localStorage.setItem('toyga-saved', JSON.stringify(saved)); } catch { notify('Сохранено на время сеанса: браузер запретил постоянное хранение'); }
    updateSaved();
    if (currentResult) $('#cards').innerHTML = currentResult.cards.length ? currentResult.cards.map((p,i) => cardHTML(p,i)).join('') : $('#cards').innerHTML;
  }
  const profile = event.target.closest('[data-profile]');
  if (profile) { const p = currentResult?.cards.find(p => p.id === profile.dataset.profile) || saved.find(p => p.id === profile.dataset.profile); if (p) showProfile(p); }
  const day = event.target.closest('[data-date]');
  if (day) { $('#date').value = day.dataset.date; search(); }
  if (event.target.closest('[data-edit]')) { $('#search-form').scrollIntoView({behavior:'smooth', block:'center'}); $('#city').focus({preventScroll:true}); }
  if (event.target.closest('[data-back]')) switchView('selection');
});
function openDialog(html, kicker = 'О ПРОЕКТЕ') {
  $('#dialog-content').innerHTML = html; $('#dialog-kicker').textContent = kicker;
  if (!$('#info-dialog').open) $('#info-dialog').showModal();
}
$('#close-dialog').addEventListener('click', () => $('#info-dialog').close());
$('#info-dialog').addEventListener('click', event => { if (event.target === $('#info-dialog')) { const rect = event.target.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) event.target.close(); } });
function showHow() {
  openDialog(`<h2>Хороший выбор —<br>с понятной причиной.</h2><p>Тойға сокращает уже существующий каталог до трёх подходящих профилей. Все выводы опираются на данные каталога.</p><ol><li><strong>Сужаем каталог.</strong> Выбираем город и нужную категорию.</li><li><strong>Проверяем ограничения.</strong> Исключаем занятых на дату, слишком дорогих и не подходящих по формату, языку или часам. Для услуг без привязки к присутствию часы не ограничивают подбор.</li><li><strong>Стабильно ранжируем.</strong> Сначала меньшая цена «от», затем меньшее число форматов (условная специализация), затем ID. Это не рейтинг качества.</li><li><strong>Объясняем каждый результат.</strong> Показываем исходное описание, конкретную цену, запас бюджета и совпадения с заявкой. Для исключённых профилей доступны причины.</li></ol><div class="notice">Здесь нет скрытой LLM или случайных оценок. Алгоритм на правилах воспроизводим и работает локально, без API-ключей. Бронирование в проект не входит.</div>`, 'ПРОЗРАЧНЫЙ АЛГОРИТМ');
}
$('#how-button').addEventListener('click', showHow);
$('#ranking-button').addEventListener('click', showHow);
function showProfile(p) {
  const selectedDate = currentResult?.query.date || $('#date').value;
  const month = selectedDate.slice(0,7);
  const days = new Date(Number(month.slice(0,4)), Number(month.slice(5)), 0).getDate();
  const offset = (new Date(`${month}-01T12:00:00`).getDay() + 6) % 7;
  openDialog(`<h2>${escapeHTML(p.anon_name)}</h2><p>${escapeHTML(p.categories.join(', '))} · ${escapeHTML(p.city)} · ${p.synthetic ? 'Синтетический профиль' : 'Исходный профиль'}</p><p class="profile-description">${escapeHTML(p.description)}</p><div class="profile-facts"><div><small>ЦЕНА ОТ</small>${money(p.price_from_kzt)} ₸</div><div><small>ПРИСУТСТВИЕ</small>${p.max_hours == null ? 'Не привязано к часам' : `До ${escapeHTML(p.max_hours)} ч`}</div><div><small>ЯЗЫКИ</small>${escapeHTML(p.languages.join(', '))}</div><div><small>ФОРМАТЫ</small>${escapeHTML(p.event_formats.join(', '))}</div></div><p><strong>Календарь · ${new Date(`${month}-01T12:00:00`).toLocaleDateString('ru-RU', {month:'long',year:'numeric'})}</strong><br>Зачёркнуты занятые дни. Обводка — дата последней заявки.</p><div class="calendar-grid">${['Пн','Вт','Ср','Чт','Пт','Сб','Вс'].map(d=>`<b style="font-size:9px;text-align:center">${d}</b>`).join('')}${Array.from({length:offset},()=>'<i></i>').join('')}${Array.from({length:days}, (_,i)=>{const d=`${month}-${String(i+1).padStart(2,'0')}`; const unknown = d < '2026-09-23'; return `<span class="${p.busy_dates.includes(d) ? 'busy' : ''} ${d === selectedDate ? 'selected' : ''}" ${unknown ? 'style="background:#eee;color:#aaa"' : ''} title="${d}: ${unknown ? 'нет данных' : p.busy_dates.includes(d) ? 'занят' : 'нет отметки о занятости'}">${unknown ? '—' : i+1}</span>`;}).join('')}</div>${p.price_imputed || p.city_imputed ? `<div class="notice">${p.price_imputed ? 'Цена проставлена при подготовке датасета. ' : ''}${p.city_imputed ? 'Город проставлен при подготовке датасета.' : ''}</div>` : ''}<p>Цена «от» не является итоговой сметой. Календарь отражает только данные каталога. ID: ${escapeHTML(p.id)}.</p>`, 'ПРОФИЛЬ ПОДРЯДЧИКА');
}
$('#compare-button').addEventListener('click', () => { $('#compare-panel').hidden = !$('#compare-panel').hidden; });
$('#run-compare').addEventListener('click', async () => {
  if (!currentResult) { notify('Сначала выполните подбор'); return; }
  const day = $('#compare-date').value;
  if (!day || !$('#compare-date').reportValidity()) return;
  const original = currentResult; const version = ++compareVersion;
  $('#run-compare').disabled = true;
  try {
    const other = await api('/api/recommend', {...original.query, date:day});
    if (version !== compareVersion) return;
    const removed = original.cards.filter(p => !other.cards.some(o => o.id === p.id));
    const added = other.cards.filter(p => !original.cards.some(o => o.id === p.id));
    const columns = [original, other].map(r => `<div><strong>${niceDate(r.query.date)}</strong><br>${r.cards.length ? r.cards.map(p=>escapeHTML(p.anon_name)).join('<br>') : 'Нет совпадений'}<br><span class="muted">Заняты в категории: ${r.reason_counts.busy || 0}</span></div>`).join('');
    $('#compare-result').innerHTML = `<div class="compare-columns">${columns}</div><p>${removed.map(p => `${escapeHTML(p.anon_name)}: ${p.busy_dates.includes(day) ? 'занят(а) на новую дату' : 'вышел(ла) из первых трёх после изменения доступности других профилей'}.`).join(' ')} ${added.map(p => `${escapeHTML(p.anon_name)}: ${p.busy_dates.includes(original.query.date) ? 'на исходную дату занят(а), на новую нет отметки о занятости' : 'вошёл(ла) в первые три после изменения состава доступных профилей'}.`).join(' ')}${!removed.length && !added.length ? 'Первые три профиля совпадают. На этих датах календарь не изменил состав подборки.' : ''}</p><button class="secondary-button" data-date="${day}">Использовать ${niceDate(day)}</button>`;
  } catch (error) { if (version === compareVersion) $('#compare-result').textContent = error.message; }
  finally { $('#run-compare').disabled = false; }
});
function showData() {
  if (!meta) { notify('Каталог ещё не загружен'); return; }
  const sourceText = {original:'Используется исходный анонимизированный датасет хакатона. Имена вымышленные; синтетические записи отмечены согласно исходному файлу.', demo:'Используется отдельный демонстрационный набор: все профили синтетические.', imported:'Используется загруженный каталог. Флаги происхождения профилей, городов и цен сохранены из файла.'};
  openDialog(`<h2>Данные, которым<br>можно задать вопросы.</h2><div class="profile-facts"><div><small>ПРОФИЛЕЙ</small>${meta.count}</div><div><small>СИНТЕТИЧЕСКИХ</small>${meta.synthetic_count}</div><div><small>ГОРОД ДОПОЛНЕН В ДАТАСЕТЕ</small>${meta.city_imputed_count}</div><div><small>ЦЕНА ДОПОЛНЕНА В ДАТАСЕТЕ</small>${meta.price_imputed_count}</div></div><p>${sourceText[meta.source] || sourceText.imported}</p><p>Загрузите CSV или JSONL, до 5 000 профилей и до 6 МБ. В CSV списки разделяются символом «|». Весь файл проверяется перед заменой каталога. Загрузка заменяет активный каталог для всех вкладок этого локального сервера.</p><input type="file" id="dataset-file" accept=".csv,.jsonl,.json,.txt" aria-label="Загрузить CSV или JSONL"><div id="import-status" role="status" class="muted"></div><div class="dialog-actions"><button class="small-primary" id="restore-original">Датасет хакатона</button><button class="secondary-button" id="restore-demo">Демоданные</button></div><p>Избранное очищается при смене каталога. При следующем обычном запуске используется исходный датасет хакатона.</p>`, 'КАТАЛОГ ПРОЕКТА');
  $('#dataset-file').addEventListener('change', async event => {
    const file = event.target.files[0]; if (!file) return;
    if (file.size > 6 * 1024 * 1024) { $('#import-status').textContent = 'Файл больше 6 МБ'; return; }
    await changeDataset('/api/import', {text:await file.text(), format:file.name.toLowerCase().endsWith('.csv') ? 'csv' : 'jsonl'});
  });
  $('#restore-demo').addEventListener('click', () => changeDataset('/api/demo', {}));
  $('#restore-original').addEventListener('click', () => changeDataset('/api/original', {}));
}
async function changeDataset(path, body) {
  $('#import-status').textContent = 'Проверяем данные…';
  $('#restore-demo').disabled = true; $('#restore-original').disabled = true; $('#dataset-file').disabled = true;
  try {
    await api(path, body); saved = []; try { localStorage.removeItem('toyga-saved'); } catch { /* Storage optional. */ }
    updateSaved(); await loadMeta(); await search(); $('#info-dialog').close(); notify('Каталог обновлён, подборка пересчитана');
  } catch (error) { $('#import-status').textContent = error.message; }
  finally { $('#restore-demo').disabled = false; $('#restore-original').disabled = false; $('#dataset-file').disabled = false; }
}
$('#data-button').addEventListener('click', showData);
// On mobile the data control is available in the footer as well.
const dataFooter = document.createElement('button'); dataFooter.className = 'text-button'; dataFooter.textContent = 'Данные'; dataFooter.addEventListener('click', showData); $('.page-footer').append(dataFooter);
updateSaved();
(async () => {
  try { await loadMeta(); await search(); }
  catch (error) { $('#result-summary').innerHTML = `<div class="error-notice">Не удалось загрузить каталог: ${escapeHTML(error.message)}. Запустите python3 server.py и обновите страницу.</div>`; }
})();
