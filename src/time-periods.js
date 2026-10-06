export const DATA_START = new Date(2015, 0, 1);
export const DATA_END = new Date(2024, 11, 31, 23, 59, 59, 999);

export function periodStart(date, resolution) {
  if (resolution === 'yearly') return new Date(date.getFullYear(), 0, 1);
  if (resolution === 'seasonal') {
    const month = date.getMonth();
    return new Date(month < 2 ? date.getFullYear() - 1 : date.getFullYear(),
      month < 2 ? 11 : month < 5 ? 2 : month < 8 ? 5 : month < 11 ? 8 : 11, 1);
  }
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function nextPeriod(start, resolution) {
  return new Date(start.getFullYear() + (resolution === 'yearly' ? 1 : 0),
    start.getMonth() + (resolution === 'yearly' ? 0 : resolution === 'seasonal' ? 3 : 1), 1);
}

export function periodLabel(start, resolution) {
  if (resolution === 'yearly') return String(start.getFullYear());
  if (resolution === 'monthly') return start.toLocaleString('en-AU', { month: 'short', year: 'numeric' });
  const season = { 11: 'Summer', 2: 'Autumn', 5: 'Winter', 8: 'Spring' }[start.getMonth()];
  return `${season} ${start.getFullYear() + (start.getMonth() === 11 ? 1 : 0)}`;
}

export function buildPeriods(resolution, rows = [], siteIds = null) {
  const periods = [];
  for (let start = periodStart(DATA_START, resolution); start <= DATA_END; start = nextPeriod(start, resolution)) {
    const next = nextPeriod(start, resolution);
    const clippedStart = new Date(Math.max(+start, +DATA_START));
    const clippedEnd = new Date(Math.min(+next - 1, +DATA_END));
    periods.push({ key: String(+start), start: clippedStart, end: clippedEnd,
      label: periodLabel(start, resolution), partial: +clippedStart !== +start || +clippedEnd !== +next - 1,
      sites: new Set() });
  }
  const byKey = new Map(periods.map((period) => [period.key, period]));
  for (const row of rows) {
    if (siteIds && !siteIds.has(row.site_id)) continue;
    if (!Number.isFinite(row.value) || !Number.isFinite(+row.datetimeValue)) continue;
    byKey.get(String(+periodStart(row.datetimeValue, resolution)))?.sites.add(row.site_id);
  }
  return periods.map(({ sites, ...period }) => ({ ...period, siteCount: sites.size }));
}

export function periodContaining(periods, date) {
  return periods.find((period) => period.start <= date && date <= period.end) ||
    (date < DATA_START ? periods[0] : periods.at(-1));
}
