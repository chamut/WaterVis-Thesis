import fs from 'node:fs';
import path from 'node:path';
import * as d3 from 'd3';

const repo = path.resolve(import.meta.dirname, '..');
const defaultBase = path.resolve(repo,
  '../Data/catchment/goulburn catchments/ll_gda2020/esrishape/customised_delivery/GOULBURN-BROKEN_WATERWAY-0/VMHYDRO/HY_WATERCOURSE');
const sourceBase = path.resolve(process.argv[2] || defaultBase);
const output = path.resolve(process.argv[3] || path.join(repo, 'public/data/goulburn_watercourses.geojson'));
const boundary = JSON.parse(fs.readFileSync(path.join(repo, 'public/data/goulburn_boundary.geojson'), 'utf8'));
const basin = boundary.features[0];

function dbfRows(file) {
  const data = fs.readFileSync(file);
  const count = data.readUInt32LE(4);
  const headerLength = data.readUInt16LE(8);
  const recordLength = data.readUInt16LE(10);
  const fields = [];
  let cursor = 32;
  let offset = 1;
  while (data[cursor] !== 0x0d) {
    const name = data.subarray(cursor, cursor + 11).toString('ascii').replace(/\0.*$/, '');
    const length = data[cursor + 16];
    fields.push({ name, offset, length });
    offset += length;
    cursor += 32;
  }
  const wanted = new Set(['FTYPE_CODE', 'NAME', 'HIERARCHY']);
  return Array.from({ length: count }, (_, index) => {
    const start = headerLength + index * recordLength;
    if (data[start] === 0x2a) return null;
    return Object.fromEntries(fields.filter((field) => wanted.has(field.name)).map((field) => [
      field.name,
      data.subarray(start + field.offset, start + field.offset + field.length).toString('utf8').trim(),
    ]));
  });
}

function boundaryPoint(a, b, aInside) {
  let low = 0;
  let high = 1;
  for (let index = 0; index < 24; index += 1) {
    const middle = (low + high) / 2;
    const point = [a[0] + (b[0] - a[0]) * middle, a[1] + (b[1] - a[1]) * middle];
    if (d3.geoContains(basin, point) === aInside) low = middle;
    else high = middle;
  }
  const t = (low + high) / 2;
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

function clipLine(points) {
  const runs = [];
  let run = [];
  for (let index = 1; index < points.length; index += 1) {
    const a = points[index - 1];
    const b = points[index];
    const aInside = d3.geoContains(basin, a);
    const bInside = d3.geoContains(basin, b);
    if (aInside && !run.length) run.push(a);
    if (aInside && bInside) run.push(b);
    else if (aInside !== bInside) {
      const edge = boundaryPoint(a, b, aInside);
      if (aInside) {
        run.push(edge);
        if (run.length > 1) runs.push(run);
        run = [];
      } else {
        run = [edge, b];
      }
    } else if (run.length > 1) {
      runs.push(run);
      run = [];
    }
  }
  if (run.length > 1) runs.push(run);
  return runs;
}

function distanceToSegmentSquared(point, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  if (!dx && !dy) return (point[0] - a[0]) ** 2 + (point[1] - a[1]) ** 2;
  const t = Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / (dx * dx + dy * dy)));
  return (point[0] - a[0] - t * dx) ** 2 + (point[1] - a[1] - t * dy) ** 2;
}

function simplify(points, tolerance = 0.00004) {
  if (points.length <= 2) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  const threshold = tolerance * tolerance;
  while (stack.length) {
    const [start, end] = stack.pop();
    let furthest = -1;
    let maxDistance = threshold;
    for (let index = start + 1; index < end; index += 1) {
      const distance = distanceToSegmentSquared(points[index], points[start], points[end]);
      if (distance > maxDistance) {
        maxDistance = distance;
        furthest = index;
      }
    }
    if (furthest >= 0) {
      keep[furthest] = 1;
      stack.push([start, furthest], [furthest, end]);
    }
  }
  return points.filter((_, index) => keep[index]);
}

const rows = dbfRows(`${sourceBase}.dbf`);
const shp = fs.readFileSync(`${sourceBase}.shp`);
const features = [];
let cursor = 100;
let recordIndex = 0;
while (cursor + 8 <= shp.length) {
  const contentBytes = shp.readUInt32BE(cursor + 4) * 2;
  const start = cursor + 8;
  const end = start + contentBytes;
  const attributes = rows[recordIndex];
  const shapeType = shp.readUInt32LE(start);
  const natural = attributes && /(?:stream|river)$/.test(attributes.FTYPE_CODE);
  const useful = natural && (attributes.NAME || ['H', 'M'].includes(attributes.HIERARCHY));
  if (useful && [3, 13, 23].includes(shapeType)) {
    const partCount = shp.readUInt32LE(start + 36);
    const pointCount = shp.readUInt32LE(start + 40);
    const partsStart = start + 44;
    const pointsStart = partsStart + partCount * 4;
    const parts = Array.from({ length: partCount }, (_, index) => shp.readUInt32LE(partsStart + index * 4));
    const points = Array.from({ length: pointCount }, (_, index) => [
      shp.readDoubleLE(pointsStart + index * 16),
      shp.readDoubleLE(pointsStart + index * 16 + 8),
    ]);
    const lines = parts.flatMap((partStart, index) => {
      const partEnd = parts[index + 1] ?? points.length;
      return clipLine(points.slice(partStart, partEnd)).map((line) => simplify(line));
    }).filter((line) => line.length > 1);
    if (lines.length) features.push({
      type: 'Feature',
      properties: {
        name: attributes.NAME || null,
        type: attributes.FTYPE_CODE,
        hierarchy: attributes.HIERARCHY || null,
      },
      geometry: lines.length === 1
        ? { type: 'LineString', coordinates: lines[0] }
        : { type: 'MultiLineString', coordinates: lines },
    });
  }
  cursor = end;
  recordIndex += 1;
}

fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, JSON.stringify({ type: 'FeatureCollection', features }));
const named = features.filter((feature) => feature.properties.name).length;
console.log(`Wrote ${features.length.toLocaleString()} natural watercourse features (${named.toLocaleString()} named) to ${output}`);
