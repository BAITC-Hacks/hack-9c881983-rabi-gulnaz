"""Pure, deterministic recommendation pipeline. No network calls or paid APIs."""
import json
import math
import re
from collections import Counter
from datetime import date

START_DATE = date(2026, 9, 23)
END_DATE = date(2026, 12, 31)
FORMATS = ['свадьба', 'той', 'корпоратив', 'конференция', 'юбилей', 'день рождения']
LANGUAGES = ['русский', 'казахский', 'английский']


def load_profiles(text):
    profiles = []
    seen = set()
    for line_no, line in enumerate(text.splitlines(), 1):
        if not line.strip():
            continue
        try:
            p = json.loads(line)
            if not isinstance(p, dict):
                raise ValueError('ожидается JSON-объект')
            for field in ['id', 'anon_name', 'city', 'description']:
                allowed = (str, int) if field == 'id' else (str,)
                if not isinstance(p.get(field), allowed) or isinstance(p.get(field), bool) or not str(p[field]).strip():
                    raise ValueError('не заполнено поле ' + field)
            p['id'] = str(p['id'])
            if p['id'] in seen:
                raise ValueError('повторяющийся id: ' + p['id'])
            for field in ['categories', 'event_formats', 'languages', 'busy_dates']:
                if not isinstance(p.get(field), list) or any(not isinstance(v, str) or not v.strip() for v in p[field]):
                    raise ValueError(field + ' должен быть массивом строк')
            if not p['categories'] or not p['event_formats']:
                raise ValueError('категории и форматы не могут быть пустыми')
            price = p.get('price_from_kzt')
            if isinstance(price, bool) or not isinstance(price, (float, int)) or not math.isfinite(price) or price < 0:
                raise ValueError('price_from_kzt должен быть неотрицательным числом')
            hours = p.get('max_hours')
            if hours is not None and (isinstance(hours, bool) or not isinstance(hours, (int, float)) or not math.isfinite(hours) or hours <= 0):
                raise ValueError('max_hours должен быть положительным числом или null')
            p.setdefault('max_hours', None)
            for day in p['busy_dates']:
                date.fromisoformat(day)
            for flag in ['synthetic', 'city_imputed', 'price_imputed']:
                if flag in p and not isinstance(p[flag], bool):
                    raise ValueError(flag + ' должен быть true или false')
                p.setdefault(flag, False)
            p['event_formats'] = [v.lower() for v in p['event_formats']]
            p['languages'] = [v.lower() for v in p['languages']]
            seen.add(p['id'])
            profiles.append(p)
        except (ValueError, TypeError) as exc:
            raise ValueError('Строка {}: {}'.format(line_no, exc)) from exc
    if not profiles:
        raise ValueError('Файл не содержит профилей')
    if len(profiles) > 5000:
        raise ValueError('Максимум 5 000 профилей')
    return profiles


def validate_query(raw):
    q = {}
    for field in ['city', 'date', 'event_format', 'category']:
        if not isinstance(raw.get(field), str) or not raw[field].strip():
            raise ValueError('Заполните поле ' + field)
        q[field] = raw[field].strip()
    try:
        day = date.fromisoformat(q['date'])
    except ValueError:
        raise ValueError('Укажите корректную дату')
    if not START_DATE <= day <= END_DATE:
        raise ValueError('Календари доступны с 23 сентября по 31 декабря 2026 года')
    q['event_format'] = q['event_format'].lower()
    if q['event_format'] not in FORMATS:
        raise ValueError('Неизвестный формат мероприятия')
    try:
        if isinstance(raw.get('budget'), bool):
            raise ValueError()
        q['budget'] = float(raw.get('budget', 0))
        if not math.isfinite(q['budget']) or q['budget'] <= 0 or q['budget'] > 1_000_000_000:
            raise ValueError()
    except (ValueError, TypeError):
        raise ValueError('Бюджет должен быть больше 0 и не больше 1 млрд ₸')
    hours = raw.get('hours')
    q['hours'] = None
    if hours not in (None, ''):
        try:
            q['hours'] = float(hours)
            if isinstance(hours, bool) or not math.isfinite(q['hours']) or not 0 < q['hours'] <= 24:
                raise ValueError()
        except (ValueError, TypeError):
            raise ValueError('Длительность должна быть от 0 до 24 часов, не включая 0')
    q['language'] = raw.get('language', '') or ''
    if q['language'] and q['language'] not in LANGUAGES:
        raise ValueError('Неизвестный язык')
    return q


def money(value):
    return '{:,.0f}'.format(value).replace(',', ' ')


def failures(p, q, ignore_date=False):
    reasons = []
    if not ignore_date and q['date'] in p['busy_dates']:
        reasons.append('busy')
    if p['price_from_kzt'] > q['budget']:
        reasons.append('budget')
    if q['event_format'] not in p['event_formats']:
        reasons.append('format')
    if q['language'] and q['language'] not in p['languages']:
        reasons.append('language')
    if q['hours'] and p['max_hours'] is not None and p['max_hours'] < q['hours']:
        reasons.append('hours')
    return reasons


def rank_key(p):
    # Lower advertised starting price, then narrower format specialization,
    # then stable identifier. No randomization or opaque "AI percentages".
    return (p['price_from_kzt'], len(p['event_formats']), p['id'])


def description_excerpt(p, q):
    """A literal source fragment, never an inferred claim about quality."""
    sentences = re.split(r'(?<=[.!?])\s+|[\r\n]+', p['description'])
    useful = [s.strip() for s in sentences if len(s.strip()) >= 35] or [p['description'].strip()]
    stem = {'свадьба':'свад', 'той':'той', 'корпоратив':'корпоратив',
            'конференция':'конференц', 'юбилей':'юбиле', 'день рождения':'рожд'}[q['event_format']]
    chosen = next((s for s in useful if stem in s.lower()), useful[0])
    if len(chosen) > 180:
        return chosen[:180].rsplit(' ', 1)[0].rstrip('.,;:!?') + '…'
    return chosen.rstrip('.!?')


def recommend(profiles, raw):
    q = validate_query(raw)
    pool = [p for p in profiles if p['city'] == q['city'] and q['category'] in p['categories']]
    counts = Counter()
    eligible = []
    excluded = []
    for p in pool:
        reasons = failures(p, q)
        if reasons:
            counts.update(reasons)
            excluded.append({'id': p['id'], 'name': p['anon_name'], 'reasons': reasons})
        else:
            eligible.append(p)
    eligible.sort(key=rank_key)
    excluded.sort(key=lambda p: p['id'])
    cards = []
    for p in eligible[:3]:
        spare = q['budget'] - p['price_from_kzt']
        facts = ['формат «{}»'.format(q['event_format'])]
        if q['language']:
            facts.append('язык — ' + q['language'])
        if q['hours'] and p['max_hours'] is not None:
            facts.append('до {:g} ч при запросе {:g} ч'.format(p['max_hours'], q['hours']))
        elif q['hours']:
            facts.append('присутствие по часам не требуется')
        budget_fact = 'ровно в пределах бюджета' if spare == 0 else 'на {} ₸ ниже лимита'.format(money(spare))
        excerpt = description_excerpt(p, q)
        explanation = 'От {} ₸ — {}; {}; на {} дата не отмечена занятой в каталоге. Из описания: «{}».'.format(money(p['price_from_kzt']), budget_fact, ', '.join(facts), date.fromisoformat(q['date']).strftime('%d.%m.%Y'), excerpt)
        cards.append({**p, 'explanation': explanation, 'description_excerpt': excerpt, 'budget_remaining': spare})
    alternatives = []
    if pool and not cards:
        for offset in range(1, 15):
            from datetime import timedelta
            day = date.fromisoformat(q['date']) + timedelta(days=offset)
            if day > END_DATE:
                break
            alternate_q = {**q, 'date': day.isoformat()}
            n = sum(not failures(p, alternate_q) for p in pool)
            if n:
                alternatives.append({'date': day.isoformat(), 'count': n})
            if len(alternatives) == 3:
                break
    status = 'matched' if cards else ('no_category' if not pool else 'no_matches')
    return {'status': status, 'query': q, 'cards': cards, 'pool_count': len(pool),
            'eligible_count': len(eligible), 'excluded_count': len(excluded),
            'reason_counts': dict(counts), 'excluded': excluded, 'alternative_dates': alternatives,
            'ranking': 'Сначала меньшая цена «от», затем более узкая специализация по форматам, затем ID.'}
