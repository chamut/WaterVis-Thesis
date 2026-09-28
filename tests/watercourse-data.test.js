import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const watercourses = JSON.parse(fs.readFileSync(new URL('../public/data/goulburn_watercourses.geojson', import.meta.url)));

test('browser watercourse layer contains only natural streams and rivers', () => {
  assert.ok(watercourses.features.length > 10_000);
  assert.ok(watercourses.features.every((feature) => /(?:stream|river)$/.test(feature.properties.type)));
});

test('watercourse layer includes the named lines for the two questioned sites', () => {
  const names = new Set(watercourses.features.map((feature) => feature.properties.name));
  assert.ok(names.has('SUNDAY CREEK'));
  assert.ok(names.has('KING PARROT CREEK'));
});
