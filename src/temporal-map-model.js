import * as d3 from 'd3';

export function parseMeasurement(value) {
  if (value == null || String(value).trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function sharedDomain(continuous, spot, objectives) {
  let low = Infinity;
  let high = -Infinity;
  function add(value) {
    if (!Number.isFinite(value)) return;
    low = Math.min(low, value);
    high = Math.max(high, value);
  }
  for (const row of continuous) {
    if (!Number.isFinite(row.value)) continue;
    add(row.value); add(row.min); add(row.max);
  }
  for (const row of spot) add(row.value);
  for (const objective of objectives) { add(objective?.lower); add(objective?.upper); }
  if (!Number.isFinite(low)) return [0, 1];
  const padding = (high - low || Math.max(Math.abs(low) * .1, 1)) * .08;
  return [0, Math.max(high + padding, 1e-6)];
}

// One value scale per parameter and selected time range, shared by every site and view.
export function parameterAxisDomain(data, view, code) {
  const continuous = view.continuous.filter((row) => row.parameter_code === code);
  const spot = view.spot.filter((row) => row.parameter_code === code);
  const objectives = data.sites.filter((site) => site.hasData)
    .map((site) => data.availability.ers.thresholds[site.ers_segment]?.[code]);
  return d3.scaleLinear().domain(sharedDomain(continuous, spot, objectives)).nice(4).domain();
}

export function timeAxisFormat(start, end) {
  return d3.timeFormat(start.getFullYear() === end.getFullYear() ? '%b' : '%Y');
}

export function timeAxisInterval(start, end, tickCount) {
  if (start.getFullYear() === end.getFullYear()) {
    const months = end.getMonth() - start.getMonth() + 1;
    return d3.timeMonth.every(Math.max(1, Math.ceil(months / tickCount)));
  }
  const years = end.getFullYear() - start.getFullYear() + 1;
  return d3.timeYear.every(Math.max(1, Math.ceil(years / tickCount)));
}

function sameOrNextInterval(previous, next, resolution) {
  const interval = resolution === 'monthly' ? d3.timeMonth : resolution === 'hourly' ? d3.timeHour : d3.timeDay;
  return +interval.floor(next) <= +interval.offset(interval.floor(previous), 1);
}

// Invalid readings and missing calendar intervals break the sensor line.
export function sensorSegments(rows, resolution) {
  const sorted = rows.filter((row) => Number.isFinite(+row.dateValue)).slice().sort((a, b) => a.dateValue - b.dateValue);
  const segments = [];
  let segment = [];
  const finish = () => { if (segment.length) segments.push(segment); segment = []; };
  for (const row of sorted) {
    if (!Number.isFinite(row.value)) { finish(); continue; }
    if (segment.length && !sameOrNextInterval(segment.at(-1).dateValue, row.dateValue, resolution)) finish();
    segment.push(row);
  }
  finish();
  return segments;
}

// Downsample each uninterrupted segment independently, retaining envelope extrema.
export function pixelSample(segment, x) {
  const bins = new Map();
  for (const row of segment) {
    const bin = Math.floor(x(row.dateValue));
    if (!bins.has(bin)) bins.set(bin, []);
    bins.get(bin).push(row);
  }
  const kept = new Set();
  for (const rows of bins.values()) {
    kept.add(rows[0]); kept.add(rows.at(-1));
    for (const field of ['value', 'min', 'max']) {
      let minimum; let maximum;
      for (const row of rows) {
        if (!Number.isFinite(row[field])) continue;
        if (!minimum || row[field] < minimum[field]) minimum = row;
        if (!maximum || row[field] > maximum[field]) maximum = row;
      }
      if (minimum) kept.add(minimum);
      if (maximum) kept.add(maximum);
    }
  }
  return [...kept].sort((a, b) => a.dateValue - b.dateValue);
}

function overlap(a, b) {
  return Math.max(0, Math.min(a.x + a.width + 4, b.x + b.width + 4) - Math.max(a.x, b.x))
    * Math.max(0, Math.min(a.y + a.height + 4, b.y + b.height + 4) - Math.max(a.y, b.y));
}

export function placeCards(points, width, height, selectedId, cardWidth = 150, cardHeight = 96) {
  const placed = [];
  const ordered = points.filter((point) => point.x >= 0 && point.y >= 0 && point.x <= width && point.y <= height)
    .slice().sort((a, b) => (b.id === selectedId) - (a.id === selectedId) || a.id.localeCompare(b.id));
  for (const point of ordered) {
    let best;
    for (const radius of [0, 40, 80, 120]) {
      for (let angle = 0; angle < (radius ? 16 : 1); angle++) {
        const theta = angle * Math.PI / 8 - Math.PI / 2;
        const x = point.x - cardWidth / 2 + Math.cos(theta) * radius;
        const y = point.y - cardHeight / 2 + Math.sin(theta) * radius;
        const rect = { id: point.id, x, y, width: cardWidth, height: cardHeight, anchorX: point.x, anchorY: point.y };
        const overflow = Math.max(0, -x) + Math.max(0, -y) + Math.max(0, x + cardWidth - width) + Math.max(0, y + cardHeight - height);
        const score = overflow * cardWidth * 100 + placed.reduce((sum, other) => sum + overlap(rect, other), 0) + radius * .1;
        if (!best || score < best.score) best = { ...rect, score };
      }
    }
    placed.push(best);
  }
  return placed;
}
