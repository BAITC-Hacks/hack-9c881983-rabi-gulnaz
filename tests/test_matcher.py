import json
import unittest

from generate_demo import generate
from matcher import load_profiles, recommend


class MatcherTests(unittest.TestCase):
    def setUp(self):
        self.profiles = generate()
        self.q = {'city': 'Алматы', 'date': '2026-10-17', 'event_format': 'свадьба', 'category': 'Ведущий', 'budget': 500000}

    def test_top_three_stable_and_explained(self):
        result = recommend(self.profiles, self.q)
        self.assertEqual(result['status'], 'matched')
        self.assertEqual(len(result['cards']), 3)
        self.assertEqual(result, recommend(list(reversed(self.profiles)), self.q))
        self.assertEqual(len(set(p['explanation'] for p in result['cards'])), 3)
        for p in result['cards']:
            self.assertNotIn(self.q['date'], p['busy_dates'])
            self.assertLessEqual(p['price_from_kzt'], self.q['budget'])

    def test_date_changes_selection(self):
        a = recommend(self.profiles, self.q)
        b = recommend(self.profiles, {**self.q, 'date': '2026-10-18'})
        self.assertNotEqual([p['id'] for p in a['cards']], [p['id'] for p in b['cards']])
        self.assertGreater(a['reason_counts']['busy'], 0)
        for p in a['cards']:
            self.assertIn('2026-10-18', p['busy_dates'])

    def test_rare_category_and_null_hours(self):
        r = recommend(self.profiles, {**self.q, 'category':'Флорист', 'hours':24})
        self.assertEqual(r['status'], 'matched')
        self.assertEqual(len(r['cards']), 2)
        self.assertEqual(r['pool_count'], 2)

    def test_three_distinct_outcomes(self):
        self.assertEqual(recommend(self.profiles, self.q)['status'], 'matched')
        self.assertEqual(recommend(self.profiles, {**self.q, 'city':'Зарубежье'})['status'], 'no_category')
        r = recommend(self.profiles, {**self.q, 'budget':1})
        self.assertEqual(r['status'], 'no_matches')
        self.assertEqual(r['reason_counts']['budget'], r['pool_count'])

    def test_all_constraints_are_hard(self):
        p = self.profiles[0]
        p.update(busy_dates=[], languages=['русский'], max_hours=5, event_formats=['свадьба'])
        for update, reason in [({'budget':100}, 'budget'), ({'language':'английский'}, 'language'), ({'hours':6}, 'hours'), ({'event_format':'той'}, 'format')]:
            r = recommend([p], {**self.q, **update})
            self.assertEqual(r['reason_counts'][reason], 1)
            self.assertFalse(r['cards'])

    def test_venues_use_calendar(self):
        p = next(p for p in self.profiles if 'Банкетный зал' in p['categories'])
        p['busy_dates'] = [self.q['date']]
        r = recommend([p], {**self.q, 'category':'Банкетный зал', 'budget':9000000})
        self.assertEqual(r['status'], 'no_matches')
        self.assertEqual(r['reason_counts'], {'busy':1})
        self.assertTrue(r['alternative_dates'])

    def test_budget_boundary(self):
        p = self.profiles[0]; p['busy_dates'] = []
        r = recommend([p], {**self.q, 'budget':p['price_from_kzt']})
        self.assertEqual(r['cards'][0]['budget_remaining'], 0)

    def test_validation(self):
        for patch in [{'date':'2027-01-01'}, {'date':'wrong'}, {'budget':-1}, {'budget':'NaN'}, {'budget':True}, {'hours':25}, {'hours':True}, {'language':'unknown'}, {'event_format':'unknown'}]:
            with self.subTest(patch=patch), self.assertRaises(ValueError):
                recommend(self.profiles, {**self.q, **patch})

    def test_import_validation(self):
        serialized = '\n'.join(json.dumps(p) for p in self.profiles)
        self.assertEqual(len(load_profiles(serialized)), 66)
        missing_hours = {k: v for k, v in self.profiles[0].items() if k != 'max_hours'}
        self.assertIsNone(load_profiles(json.dumps(missing_hours))[0]['max_hours'])
        with self.assertRaisesRegex(ValueError, 'повторяющийся'):
            load_profiles(serialized + '\n' + json.dumps(self.profiles[0]))
        for raw in ['', '{}', 'not JSON', json.dumps({**self.profiles[0], 'synthetic':'false'}), json.dumps({**self.profiles[0], 'busy_dates':['invalid']})]:
            with self.subTest(raw=raw[:30]), self.assertRaises(ValueError):
                load_profiles(raw)

    def test_ties_use_id(self):
        a, b = self.profiles[:2]
        for p in [a,b]:
            p.update(price_from_kzt=100, event_formats=['свадьба'], busy_dates=[])
        r = recommend([b,a], self.q)
        self.assertEqual([p['id'] for p in r['cards']], [a['id'], b['id']])

    def test_alternative_dates_preserve_constraints(self):
        p = self.profiles[0]; p['busy_dates'] = [self.q['date']]
        r = recommend([p], self.q)
        for d in r['alternative_dates']:
            self.assertTrue(recommend([p], {**self.q, 'date':d['date']})['cards'])
        self.assertEqual(recommend([p], {**self.q,'budget':1})['alternative_dates'], [])


if __name__ == '__main__':
    unittest.main()
