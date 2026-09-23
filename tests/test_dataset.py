import csv
import io
import json
from pathlib import Path
import tempfile
import unittest

from dataset import load_dataset, read_dataset
from matcher import recommend


DATASET_PATH = Path(__file__).resolve().parents[1] / 'data' / 'hackathon.csv'
FIELDS = [
    'id', 'anon_name', 'categories', 'city', 'city_imputed', 'synthetic',
    'price_from_kzt', 'price_imputed', 'event_formats', 'languages',
    'max_hours', 'busy_dates', 'description',
]


def csv_text(rows, fields=FIELDS):
    output = io.StringIO(newline='')
    writer = csv.DictWriter(output, fieldnames=fields)
    writer.writeheader()
    writer.writerows(rows)
    return output.getvalue()


class DatasetTests(unittest.TestCase):
    def setUp(self):
        self.row = {
            'id': 'CSV-1',
            'anon_name': 'Тестовый профиль',
            'categories': 'Ведущий|Музыкант',
            'city': 'Алматы',
            'city_imputed': 'False',
            'synthetic': 'True',
            'price_from_kzt': '125000.5',
            'price_imputed': 'False',
            'event_formats': 'свадьба|корпоратив',
            'languages': 'русский|казахский',
            'max_hours': '4.5',
            'busy_dates': '2026-10-17|2026-10-18',
            'description': 'Ведущий для семейных и деловых мероприятий.',
        }

    def test_provided_dataset_has_66_profiles_with_original_flags(self):
        profiles = read_dataset(DATASET_PATH)
        self.assertEqual(len(profiles), 66)
        self.assertEqual(len({p['id'] for p in profiles}), 66)
        self.assertEqual(sum(p['synthetic'] for p in profiles), 13)
        self.assertEqual(sum(p['city_imputed'] for p in profiles), 8)
        self.assertEqual(sum(p['price_imputed'] for p in profiles), 18)

    def test_hackathon_scenarios_and_distinct_grounded_explanations(self):
        profiles = read_dataset(DATASET_PATH)
        q = dict(city='Алматы', date='2026-10-17', event_format='свадьба', category='Ведущий', budget=1000000)
        first = recommend(profiles, q)
        self.assertEqual([p['id'] for p in first['cards']], ['HK-42352', 'HK-35215', 'HK-77838'])
        self.assertEqual(len(set(p['explanation'] for p in first['cards'])), 3)
        self.assertEqual(first, recommend(list(reversed(profiles)), q))
        for p in first['cards']:
            self.assertIn(p['description_excerpt'].rstrip('…'), p['description'])
            self.assertNotIn(q['date'], p['busy_dates'])
        second = recommend(profiles, {**q, 'date':'2026-10-18'})
        self.assertEqual([p['id'] for p in second['cards']], ['HK-44923', 'HK-35215', 'HK-27222'])
        self.assertEqual(second['eligible_count'], 4)
        florist = recommend(profiles, {**q, 'category':'Флорист', 'budget':300000, 'hours':6})
        self.assertEqual([p['id'] for p in florist['cards']], ['HK-90001'])
        self.assertEqual(florist['reason_counts'], {'busy':1})
        self.assertEqual(recommend(profiles, {**q, 'budget':10000})['status'], 'no_matches')
        self.assertEqual(recommend(profiles, {**q, 'city':'Зарубежье'})['status'], 'no_category')

    def test_every_provided_field_matches_independently_parsed_csv(self):
        with DATASET_PATH.open(encoding='utf-8-sig', newline='') as source:
            original_rows = list(csv.DictReader(source))
        profiles = read_dataset(DATASET_PATH)
        self.assertEqual(len(profiles), len(original_rows))
        for original, profile in zip(original_rows, profiles):
            with self.subTest(profile_id=original['id']):
                for field in ('id', 'anon_name', 'city', 'description'):
                    self.assertEqual(profile[field], original[field])
                for field in ('categories', 'event_formats', 'languages', 'busy_dates'):
                    self.assertEqual(profile[field], original[field].split('|') if original[field] else [])
                for field in ('synthetic', 'city_imputed', 'price_imputed'):
                    self.assertIs(profile[field], original[field] == 'True')
                self.assertEqual(profile['price_from_kzt'], float(original['price_from_kzt']))
                expected_hours = float(original['max_hours']) if original['max_hours'] else None
                self.assertEqual(profile['max_hours'], expected_hours)

    def test_jsonl_roundtrip_preserves_entire_dataset(self):
        profiles = read_dataset(DATASET_PATH)
        serialized = '\n'.join(json.dumps(p, ensure_ascii=False) for p in profiles)
        self.assertEqual(load_dataset(serialized), profiles)
        self.assertEqual(load_dataset(serialized, format='jsonl'), profiles)
        with tempfile.TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / 'profiles.jsonl'
            path.write_text(serialized, encoding='utf-8')
            self.assertEqual(read_dataset(path), profiles)

    def test_csv_bom_and_multiline_quoted_description_are_preserved(self):
        description = '  Первое предложение, "с кавычками".\r\nВторая строка\nТретья строка.  '
        text = '\ufeff' + csv_text([{**self.row, 'description': description}])
        profile = load_dataset(text, format='csv')[0]
        self.assertEqual(profile['description'], description)
        self.assertEqual(profile['categories'], ['Ведущий', 'Музыкант'])
        self.assertEqual(profile['languages'], ['русский', 'казахский'])
        self.assertEqual(profile['busy_dates'], ['2026-10-17', '2026-10-18'])
        self.assertEqual(profile['price_from_kzt'], 125000.5)
        self.assertEqual(profile['max_hours'], 4.5)
        with tempfile.TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / 'profiles.csv'
            with path.open('w', encoding='utf-8', newline='') as output:
                output.write(text)
            self.assertEqual(read_dataset(path), [profile])

    def test_case_insensitive_booleans_and_blank_optional_values(self):
        row = {
            **self.row,
            'synthetic': 'tRuE',
            'city_imputed': 'FALSE',
            'price_imputed': 'true',
            'max_hours': '',
            'languages': '',
            'busy_dates': '',
        }
        profile = load_dataset(csv_text([row]), format='csv')[0]
        self.assertIs(profile['synthetic'], True)
        self.assertIs(profile['city_imputed'], False)
        self.assertIs(profile['price_imputed'], True)
        self.assertIsNone(profile['max_hours'])
        self.assertEqual(profile['languages'], [])
        self.assertEqual(profile['busy_dates'], [])

    def test_csv_missing_required_header_is_rejected(self):
        fields = [field for field in FIELDS if field != 'id']
        row = {field: self.row[field] for field in fields}
        with self.assertRaises(ValueError):
            load_dataset(csv_text([row], fields), format='csv')

    def test_invalid_csv_boolean_values_are_rejected(self):
        for field in ('synthetic', 'city_imputed', 'price_imputed'):
            for invalid in ('yes', '1', '0', 'unknown'):
                with self.subTest(field=field, value=invalid), self.assertRaises(ValueError):
                    load_dataset(csv_text([{**self.row, field: invalid}]), format='csv')

    def test_invalid_csv_numbers_are_rejected(self):
        for field, values in (
            ('price_from_kzt', ('', 'not a number', '-1', 'NaN', 'Infinity')),
            ('max_hours', ('not a number', '-1', '0', 'NaN', 'Infinity')),
        ):
            for invalid in values:
                with self.subTest(field=field, value=invalid), self.assertRaises(ValueError):
                    load_dataset(csv_text([{**self.row, field: invalid}]), format='csv')

    def test_csv_reuses_profile_validation(self):
        for patch in (
            {'id': ''}, {'anon_name': ''}, {'city': ''}, {'description': ''},
            {'categories': ''}, {'event_formats': ''}, {'busy_dates': '2026-02-30'},
        ):
            with self.subTest(patch=patch), self.assertRaises(ValueError):
                load_dataset(csv_text([{**self.row, **patch}]), format='csv')

    def test_ragged_csv_rows_are_rejected(self):
        for values in (
            [self.row[field] for field in FIELDS] + ['unexpected value'],
            [self.row[field] for field in FIELDS[:-1]],
        ):
            output = io.StringIO(newline='')
            writer = csv.writer(output)
            writer.writerow(FIELDS)
            writer.writerow(values)
            with self.subTest(column_count=len(values)), self.assertRaises(ValueError):
                load_dataset(output.getvalue(), format='csv')

    def test_duplicate_csv_profile_ids_are_rejected(self):
        with self.assertRaisesRegex(ValueError, 'повторяющийся'):
            load_dataset(csv_text([self.row, self.row]), format='csv')

    def test_empty_csv_datasets_are_rejected(self):
        for text in ('', '\ufeff', csv_text([])):
            with self.subTest(text=text), self.assertRaises(ValueError):
                load_dataset(text, format='csv')


if __name__ == '__main__':
    unittest.main()
