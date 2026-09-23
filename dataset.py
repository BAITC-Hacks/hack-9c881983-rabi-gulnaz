"""Read CSV or JSONL without changing the original records."""
import csv
import io
import json
from pathlib import Path

from matcher import load_profiles

ARRAY_FIELDS = ('categories', 'event_formats', 'languages', 'busy_dates')
FLAG_FIELDS = ('synthetic', 'city_imputed', 'price_imputed')
REQUIRED_FIELDS = {'id', 'anon_name', 'city', 'description', 'price_from_kzt', *ARRAY_FIELDS}


def serialize_profiles(profiles):
    return '\n'.join(json.dumps(p, ensure_ascii=False) for p in profiles) + '\n'


def load_dataset(text, format='jsonl'):
    text = text.lstrip('\ufeff')
    if format == 'jsonl':
        return load_profiles(text)
    if format != 'csv':
        raise ValueError('Поддерживаются CSV и JSONL')
    reader = csv.DictReader(io.StringIO(text, newline=''), strict=True)
    try:
        headers = reader.fieldnames or []
        if len(set(headers)) != len(headers):
            raise ValueError('В CSV повторяются названия столбцов')
        missing = REQUIRED_FIELDS - set(headers)
        if missing:
            raise ValueError('В CSV отсутствуют столбцы: ' + ', '.join(sorted(missing)))
        profiles = []
        for record_no, row in enumerate(reader, 2):
            try:
                if None in row or any(value is None for value in row.values()):
                    raise ValueError('число полей не совпадает с заголовком')
                profile = dict(row)
                for field in ARRAY_FIELDS:
                    profile[field] = [item.strip() for item in row[field].split('|')] if row[field].strip() else []
                for field in FLAG_FIELDS:
                    value = row.get(field, 'false').strip().lower()
                    if value not in ('true', 'false'):
                        raise ValueError(field + ' должен быть True или False')
                    profile[field] = value == 'true'
                for field in ('price_from_kzt', 'max_hours'):
                    value = row.get(field, '').strip()
                    if field == 'max_hours' and not value:
                        profile[field] = None
                    else:
                        try:
                            number = float(value)
                        except ValueError:
                            raise ValueError(field + ' должен быть числом')
                        profile[field] = int(number) if number.is_integer() else number
                profiles.append(profile)
                if len(profiles) > 5000:
                    raise ValueError('Максимум 5 000 профилей')
            except ValueError as exc:
                raise ValueError('Запись CSV {}: {}'.format(record_no, exc)) from exc
    except csv.Error as exc:
        raise ValueError('Некорректный CSV: ' + str(exc)) from exc
    # Share the exact same validation and normalization with JSONL imports.
    return load_profiles(serialize_profiles(profiles))


def read_dataset(path):
    path = Path(path)
    with path.open(encoding='utf-8-sig', newline='') as stream:
        return load_dataset(stream.read(), 'csv' if path.suffix.lower() == '.csv' else 'jsonl')
