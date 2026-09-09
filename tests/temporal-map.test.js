import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMeasurement, sharedDomain, sensorSegments, pixelSample, placeCards } from '../src/temporal-map-model.js';
const row = (date, value, min = value, max = value) => ({ dateValue: new Date(date), value, min, max });

test('missing data is distinct from a valid zero', () => {
  for (const value of ['', '  ', null, undefined, 'NaN', Infinity]) assert.equal(parseMeasurement(value), null);
  assert.equal(parseMeasurement('0'), 0);
});
test('shared scale retains observations, envelope extremes, and objectives', () => {
  const domain = sharedDomain([row('2024-01-01', 10, -500, 9000)], [{ value: 12000 }], [{ lower: -1000, upper: 80 }]);
  assert(domain[0] < -1000 && domain[1] > 12000);
  assert.deepEqual(sharedDomain([], [], []), [0, 1]);
  assert(sharedDomain([row('2024-01-01', 0)], [], [])[0] < 0);
});
test('sensor lines break across missing and invalid hourly/daily/monthly intervals', () => {
  assert.deepEqual(sensorSegments([row('2024-01-01T00:00:00', 1), row('2024-01-01T01:00:00', 2), row('2024-01-01T03:00:00', 3)], 'hourly').map(x => x.length), [2, 1]);
  assert.deepEqual(sensorSegments([row('2024-01-01', 1), row('2024-01-02', null), row('2024-01-03', 3)], 'daily').map(x => x.length), [1, 1]);
  assert.deepEqual(sensorSegments([row('2024-01-15', 1), row('2024-02-01', 2), row('2024-04-01', 3)], 'monthly').map(x => x.length), [2, 1]);
  assert.equal(sensorSegments([], 'daily').length, 0);
});
test('pixel sampling keeps endpoints and mean/range extrema', () => {
  const rows = Array.from({ length: 100 }, (_, i) => row(1704067200000 + i * 3600000, i % 9));
  rows[33].value = 900; rows[55].min = -500; rows[72].max = 1500;
  const result = pixelSample(rows, () => 10);
  for (const expected of [rows[0], rows[99], rows[33], rows[55], rows[72]]) assert(result.includes(expected));
  assert(result.length <= 8);
  assert(result.every((r, i) => i === 0 || r.dateValue >= result[i - 1].dateValue));
});
test('placement is stable, prioritises selection, keeps all crowded sites and caps displacement', () => {
  const points = Array.from({ length: 33 }, (_, i) => ({ id: String(i).padStart(2, '0'), x: 250, y: 150 }));
  const placed = placeCards(points, 500, 300, '20');
  assert.equal(placed.length, 33); assert.equal(placed[0].id, '20');
  assert.deepEqual(placed, placeCards(points.slice().reverse(), 500, 300, '20'));
  for (const p of placed) assert(Math.hypot(p.x + p.width / 2 - p.anchorX, p.y + p.height / 2 - p.anchorY) <= 120.00001);
  assert.equal(placeCards([{ id:'off', x:-1, y:100 }], 500, 300, null).length, 0);
});
