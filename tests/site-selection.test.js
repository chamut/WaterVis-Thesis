import test from 'node:test';
import assert from 'node:assert/strict';
import { relatedSites, watercourseName } from '../src/site-selection.js';

test('extracts the watercourse name before the location separator', () => {
  assert.equal(watercourseName('Goulburn River @ Murchison'), 'GOULBURN RIVER');
});

test('prioritises the same watercourse and fills remaining slots with nearest sites', () => {
  const sites = Array.from({ length: 7 }, (_, index) => ({
    site_id: String(index),
    name: `Goulburn River @ Site ${index}`,
    latitude: -37 + index * 0.01,
    longitude: 145,
    hasData: true,
  }));
  sites.push({ site_id: 'other', name: 'Seven Creeks @ Euroa', latitude: -37, longitude: 145, hasData: true });
  const selected = relatedSites(sites, '3', 5);
  assert.equal(selected.length, 5);
  assert.equal(selected[0].site_id, '3');
  assert(selected.every((site) => watercourseName(site.name) === 'GOULBURN RIVER'));
});

test('always returns up to five sites when the selected watercourse has fewer sites', () => {
  const sites = [
    { site_id: 'selected', name: 'Acheron River @ Taggerty', latitude: -37.3, longitude: 145.7, hasData: true },
    { site_id: 'same', name: 'Acheron River @ Other', latitude: -37.2, longitude: 145.7, hasData: true },
    { site_id: 'near-1', name: 'Tributary A @ One', latitude: -37.31, longitude: 145.71, hasData: true },
    { site_id: 'near-2', name: 'Tributary B @ Two', latitude: -37.4, longitude: 145.8, hasData: true },
    { site_id: 'near-3', name: 'Tributary C @ Three', latitude: -37.5, longitude: 145.9, hasData: true },
    { site_id: 'inactive', name: 'Tributary D @ Four', latitude: -37.3, longitude: 145.7, hasData: false },
  ];
  const selected = relatedSites(sites, 'selected', 5);
  assert.deepEqual(selected.map((site) => site.site_id), ['selected', 'same', 'near-1', 'near-2', 'near-3']);
});
