import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPeriods, periodContaining } from '../src/time-periods.js';

test('period selectors span the full extract and retain empty intervals', () => {
  const rows = [{ site_id: 'one', value: 12, datetimeValue: new Date(2020, 0, 15) }];
  const monthly = buildPeriods('monthly', rows, new Set(['one']));
  assert.equal(monthly.length, 120);
  assert.equal(monthly[0].label, 'Jan 2015');
  assert.equal(monthly.at(-1).label, 'Dec 2024');
  assert.equal(monthly.find((period) => period.label === 'Jan 2020').siteCount, 1);
  assert.equal(monthly.find((period) => period.label === 'Feb 2020').siteCount, 0);
  assert.equal(monthly.at(-1).end.getDate(), 31);
});

test('seasonal choices include partial summers at dataset boundaries', () => {
  const seasonal = buildPeriods('seasonal');
  assert.equal(seasonal.length, 41);
  assert.equal(seasonal[0].label, 'Summer 2015');
  assert.equal(seasonal.at(-1).label, 'Summer 2025');
  assert.equal(periodContaining(seasonal, new Date(2024, 0, 1)).label, 'Summer 2024');
  assert.equal(buildPeriods('yearly').length, 10);
});
