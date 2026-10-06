import * as d3 from 'd3';
import * as maplibregl from 'maplibre-gl';
import mapWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import 'maplibre-gl/dist/maplibre-gl.css';
import './styles.css';
import './compact.css';
import { createSidebarResize } from './sidebar-resize.js';
import { createSpatialGrid } from './spatial-grid.js';
import { SITE_ORDER_OPTIONS, compareSitesByOrder } from './site-order.js';
import { drawComparison } from './site-comparison.js';
import { createTemporalMap } from './temporal-map.js';
import { parameterAxisDomain, parseMeasurement, timeAxisFormat, timeAxisInterval } from './temporal-map-model.js';
import { relatedSites } from './site-selection.js';
import { setupGuidance } from './guidance.js';
import { DATA_END, buildPeriods, periodContaining, periodLabel, periodStart } from './time-periods.js';
import {
  DATA_COLOUR,
  EXCEEDS_COLOUR,
  PARAMETER_COLOURS,
  STATUS_COLOURS,
  comparisonColour,
} from './visual-encodings.js';
import './viewport-fit.css';
import './guidance.css';

// Emit the GeoJSON/vector worker as a production asset with the deployment base.
maplibregl.setWorkerUrl(mapWorkerUrl);

// Retain these records in the downloaded source files, but exclude them from
// the natural-watercourse prototype: their official site names identify them
// as artificial drainage sites. Two also fall outside the displayed polygon.
const EXCLUDED_DISPLAY_SITE_IDS = new Set(['405720', '405730', '405758', '405779']);

const viewMode = location.pathname.includes('multiparameter-grid-matrix') ? 'multi' : location.pathname.includes('spatial-grid-minimap') ? 'grid' : 'main';
const isGrid = viewMode !== 'main';
const state = {
  selectedParameters: new Set(['DO','TN','TP','TURB','PH']),
  comparedSites: new Map(),
  compareMode: false,
  relatedSelectionMode: false,
  hoveredSite: null,
  selectedSite: null,
  selectedParameter: 'DO',
  mapDisplayMode: 'markers',
  detailMode: 'site',
  selectedResolution: 'monthly',
  siteSort: 'south-north',
  matrixCollapsed: false,
  rangeStart: new Date('2015-01-01T00:00:00'),
  rangeEnd: new Date('2024-12-31T23:59:59'),
  selectedSites: new Set(),
  mapTimeMode: 'annual',
  mapFrameKey: null,
};

const app = document.querySelector('#app');
const number = parseMeasurement;
const boolean = (value) => value === true || value === 'true';
const cellKey = (siteId, parameterCode) => `${siteId}|${parameterCode}`;
const dateInputFormat = d3.timeFormat('%Y-%m-%d');
const displayDateFormat = d3.timeFormat('%d %b %Y');
const resolutionLabel = (value) => ({ monthly: 'Monthly', seasonal: 'Seasonal', yearly: 'Yearly' }[value] || value);

function periodDateLabel(date, resolution = state.selectedResolution) {
  if (resolution === 'yearly') return d3.timeFormat('%Y')(date);
  if (resolution === 'seasonal') {
    const season = ({ 11: 'Summer', 2: 'Autumn', 5: 'Winter', 8: 'Spring' })[date.getMonth()] || 'Summer';
    const year = date.getMonth() === 11 ? date.getFullYear() + 1 : date.getFullYear();
    return `${season} ${year}`;
  }
  return d3.timeFormat('%b %Y')(date);
}

function formatValue(value) {
  if (!Number.isFinite(value)) return 'No data';
  if (Math.abs(value) < 0.1) return d3.format('.3f')(value);
  if (Math.abs(value) < 10) return d3.format('.2f')(value);
  return d3.format(',.1f')(value);
}

function formatObservationTime(observation) {
  if (!observation?.date || Number.isNaN(observation.date.getTime())) return 'Timestamp unavailable';
  const formatted = ['monthly', 'seasonal', 'yearly'].includes(observation.precision)
    ? periodDateLabel(observation.date, observation.precision)
    : d3.timeFormat('%d %b %Y · %H:%M')(observation.date);
  return `${observation.source} · ${formatted}`;
}

function formatStatus(status) {
  if (status === 'within') return 'Does not exceed reference';
  if (status === 'outside') return 'Exceeds reference';
  return 'Reference unavailable';
}

function formatAnnualStatus(status) {
  if (status === 'within') return 'Within annual ERS objective';
  if (status === 'outside') return 'Outside annual ERS objective';
  return 'Annual ERS unavailable';
}

function formatObjective(parameter, objective) {
  if (!objective) return 'Objective unavailable';
  const unit = parameter.unit;
  if (Number.isFinite(objective.lower) && Number.isFinite(objective.upper)) {
    return `${formatValue(objective.lower)}–${formatValue(objective.upper)} ${unit}`;
  }
  if (Number.isFinite(objective.upper)) return `≤ ${formatValue(objective.upper)} ${unit}`;
  if (Number.isFinite(objective.lower)) return `≥ ${formatValue(objective.lower)} ${unit}`;
  return 'Objective unavailable';
}

async function loadData() {
  const [sitesRaw, spotRaw, availability, boundary, watercourses, validation] = await Promise.all([
    d3.csv(import.meta.env.BASE_URL + 'data/sites.csv'),
    d3.csv(import.meta.env.BASE_URL + 'data/spot_observations.csv'),
    d3.json(import.meta.env.BASE_URL + 'data/availability.json'),
    d3.json(import.meta.env.BASE_URL + 'data/goulburn_boundary.geojson'),
    d3.json(import.meta.env.BASE_URL + 'data/goulburn_watercourses.geojson'),
    d3.json(import.meta.env.BASE_URL + 'data/validation.json'),
  ]);
  if (!sitesRaw.length || !availability?.parameters?.length) {
    throw new Error('The generated site or availability data is empty.');
  }
  const sites = sitesRaw.filter((row) => !EXCLUDED_DISPLAY_SITE_IDS.has(row.site_id)).map((row) => ({
    ...row,
    latitude: number(row.latitude),
    longitude: number(row.longitude),
    active: boolean(row.active),
    hasData: boolean(row.has_target_data),
    elevation: number(row.elevation_m),
    insideBoundary: d3.geoContains(boundary, [number(row.longitude), number(row.latitude)]),
  }));
  const displayedSiteIds = new Set(sites.map((site) => site.site_id));
  const spot = spotRaw.filter((row) => displayedSiteIds.has(row.site_id)).map((row) => ({
    ...row,
    value: number(row.value),
    rawValue: number(row.raw_value),
    temperature: number(row.temperature_c),
    datetimeValue: new Date(row.datetime),
  }));
  const latestByCell = new Map();
  spot.forEach((row) => {
    if (!Number.isFinite(row.value)) return;
    const key = cellKey(row.site_id, row.parameter_code);
    const observation = {
      value: row.value,
      unit: row.unit,
      date: row.datetimeValue,
      source: 'Spot observation',
      precision: 'time',
      status: row.ers_point_status,
    };
    if (!latestByCell.has(key) || observation.date > latestByCell.get(key).date) latestByCell.set(key, observation);
  });
  return { sites, spot, daily: [], hourly: [], latestByCell, availability, boundary, watercourses, validation };
}

function dateInSelectedRange(date) {
  return date >= state.rangeStart && date <= state.rangeEnd;
}

function latestAnnualAssessment(data, siteId, parameterCode) {
  const annual = data.availability.sites[siteId]?.parameters?.[parameterCode]?.annual_ers_assessments || {};
  const years = Object.keys(annual).map(Number).filter(Number.isFinite).sort(d3.descending);
  const eligible = years.find((year) => {
    const yearStart = new Date(year, 0, 1, 0, 0, 0, 0);
    const yearEnd = new Date(year, 11, 31, 23, 59, 59, 0);
    return state.rangeStart <= yearStart && state.rangeEnd >= yearEnd;
  });
  return eligible == null ? { year: null, status: 'unavailable', objective: data.availability.ers.thresholds[data.sites.find((site) => site.site_id === siteId)?.ers_segment]?.[parameterCode] }
    : { year: eligible, ...annual[String(eligible)] };
}

function meanFinite(rows, accessor) {
  const values = rows.map(accessor).filter(Number.isFinite);
  return values.length ? d3.mean(values) : null;
}

function classifyTemporalValue(data, siteId, parameterCode, value) {
  if (!Number.isFinite(value)) return 'unavailable';
  const site = data.sites.find((item) => item.site_id === siteId);
  const objective = data.availability.ers.thresholds[site?.ers_segment]?.[parameterCode];
  if (!objective) return 'unavailable';
  if (Number.isFinite(objective.lower) && value < objective.lower) return 'outside';
  if (Number.isFinite(objective.upper) && value > objective.upper) return 'outside';
  return 'within';
}

function temporalBucket(date, resolution) {
  return periodStart(date, resolution);
}

function aggregateSpot(data, rows, resolution) {
  return d3.rollups(
    rows,
    (values) => {
      const sample = values[0];
      const value = meanFinite(values, (row) => row.value);
      return {
        ...sample,
        datetimeValue: new Date(Math.max(+state.rangeStart, +temporalBucket(sample.datetimeValue, resolution))),
        value,
        min: d3.min(values, (row) => row.value),
        max: d3.max(values, (row) => row.value),
        rawValue: meanFinite(values, (row) => row.rawValue),
        temperature: meanFinite(values, (row) => row.temperature),
        observationCount: values.length,
        quality_code: 'multiple',
        quality_text: `${values.length} spot observations aggregated`,
        temporalResolution: `${resolution}-spot`,
        ers_point_status: classifyTemporalValue(data, sample.site_id, sample.parameter_code, value),
      };
    },
    (row) => row.site_id,
    (row) => row.parameter_code,
    (row) => temporalBucket(row.datetimeValue, resolution),
  ).flatMap(([, parameters]) => parameters.flatMap(([, periods]) => periods.map(([, row]) => row)));
}

function buildTemporalView(data, allSites = false) {
  let spot = data.spot.filter((row) => (allSites || state.selectedSites.has(row.site_id)) && dateInSelectedRange(row.datetimeValue));
  spot = aggregateSpot(data, spot, state.selectedResolution);
  const continuous = [];
  const latestByCell = new Map();
  spot.map((row) => ({ ...row, date: row.datetimeValue, source: `${state.selectedResolution} spot mean`, precision: state.selectedResolution }))
    .forEach((row) => {
      if (!Number.isFinite(row.value)) return;
      const key = cellKey(row.site_id, row.parameter_code);
      if (!latestByCell.has(key) || row.date > latestByCell.get(key).date) latestByCell.set(key, row);
    });
  return { continuous, spot, latestByCell };
}

function renderShell(data) {
  const targetSites = data.sites.filter((site) => site.hasData);
  const activeCount = targetSites.filter((site) => site.active).length;
  const parameters = data.availability.parameters;
  const segmentOrder = [
    'Highlands',
    'Uplands A',
    'Uplands B',
    'Central Foothills and Coastal Plains',
    'Urban',
    'Murray and Western Plains',
  ];
  const segmentCounts = d3.rollup(targetSites, (sites) => sites.length, (site) => site.ers_segment);
  const displayedSegmentSummary = segmentOrder
    .filter((segment) => segmentCounts.has(segment))
    .map((segment) => `${segment} (${segmentCounts.get(segment)})`)
    .join(' · ');
  const basinGroups = d3.groups(targetSites, (site) => site.basin || 'Unassigned')
    .sort(([a], [b]) => d3.ascending(a, b));
  const basinFilterMarkup = basinGroups.map(([basin, sites]) => {
    const sortedSites = sites.sort((a, b) => d3.ascending(a.short_name, b.short_name));
    return `<fieldset class="site-filter-group" data-basin="${basin}">
      <legend>
        <label><input type="checkbox" class="basin-checkbox" data-basin="${basin}" checked> <strong>${basin}</strong> <span>${sites.length} sites</span></label>
      </legend>
      <div class="site-checkbox-list">
        ${sortedSites.map((site) => `<label><input type="checkbox" class="site-checkbox" value="${site.site_id}" data-basin="${basin}" checked><span><b>${site.short_name}</b><small>${site.site_id} · ${site.ers_segment}</small></span></label>`).join('')}
      </div>
    </fieldset>`;
  }).join('');

  app.innerHTML = `
    <header class="masthead">
      <div>
        <p class="eyebrow">Prototype · Goulburn Basin · 2015–2024</p>
        <h1>WaterVis</h1>
        <p class="subtitle">Linked spatial overview and site-by-parameter time series</p>
      </div>
      <div class="summary-chips" aria-label="Dataset summary">
        <div class="site-filter-control" data-open="false">
          <button type="button" class="summary-chip-button site-filter-trigger" aria-expanded="false" aria-controls="site-filter-popover"><strong>${targetSites.length}</strong> sites</button>
          <section class="site-filter-popover" id="site-filter-popover" aria-label="Filter monitoring sites">
            <div class="site-filter-heading"><div><strong>Monitoring sites</strong><span>Grouped by basin</span></div><button type="button" class="site-filter-done">Done</button></div>
            ${basinFilterMarkup}
            <p class="site-filter-summary" aria-live="polite">Showing all ${targetSites.length} sites</p>
          </section>
        </div>
        <span><strong>${parameters.length}</strong> parameters</span>
        <span><strong>${data.spot.length.toLocaleString()}</strong> spot samples</span>
        <span><strong>10</strong> years</span>
      </div>
    </header>

    <section class="temporal-controls" aria-labelledby="temporal-heading">
      <div class="temporal-title">
        <p class="section-kicker">Time period</p>
        <h2 id="temporal-heading">Temporal view</h2>
      </div>
      <div class="resolution-buttons" role="group" aria-label="Temporal resolution">
        <button type="button" data-resolution="monthly" aria-label="Monthly aggregation" aria-pressed="true">Monthly</button>
        <button type="button" data-resolution="seasonal" aria-label="Seasonal aggregation" aria-pressed="false">Seasonal</button>
        <button type="button" data-resolution="yearly" aria-label="Yearly aggregation" aria-pressed="false">Yearly</button>
      </div>
      <div class="date-range-controls">
        <label>From<select id="range-start" aria-label="First ${state.selectedResolution} period"></select></label>
        <span aria-hidden="true">→</span>
        <label>To<select id="range-end" aria-label="Last ${state.selectedResolution} period"></select></label>
        <button type="button" class="range-latest" data-range-preset="latest-year" aria-label="Show latest year">Latest year</button>
        <button type="button" class="range-reset" aria-label="Show full period">Full period</button>
      </div>
      <p class="period-availability-note">Site counts cover the selected sites and all parameters. No-data periods remain selectable; original timestamps are in detailed inspection.</p>
      <p class="temporal-summary" aria-live="polite">Monthly · 2015–2024</p>
    </section>

    <section class="parameter-bar" aria-labelledby="parameter-heading">
      <div>
        <p class="section-kicker">Map colour</p>
        <h2 id="parameter-heading">Select a parameter</h2>
      </div>
      <div class="parameter-buttons" role="group" aria-label="Water-quality parameter"></div>
      <div class="ers-legend-group">
        <div class="ers-legend" aria-label="Provisional ERS condition legend">
          <span><i class="within"></i>Within</span>
          <span><i class="outside"></i>Outside</span>
          <span><i class="unavailable"></i>Unavailable</span>
        </div>
        <div class="ers-info" data-open="false" data-pinned="false">
          <button class="ers-info-button" type="button" aria-expanded="false" aria-controls="ers-info-popover" aria-label="About ERS condition and river segments">i</button>
          <section class="ers-info-popover" id="ers-info-popover" aria-label="ERS legend explanation">
            <div class="ers-info-section">
              <strong>Condition shown on the map</strong>
              <dl class="ers-info-definitions">
                <div><dt><i class="within"></i>Within</dt><dd>The latest complete calendar year's required ERS statistic meets the objective for that site's segment.</dd></div>
                <div><dt><i class="outside"></i>Outside</dt><dd>The latest complete calendar year's required statistic falls beyond the segment objective. This is provisional, not an official assessment.</dd></div>
                <div><dt><i class="unavailable"></i>Unavailable</dt><dd>No complete selected year, no applicable objective, or fewer than 11 valid observations in that year.</dd></div>
              </dl>
            </div>
            <div class="ers-info-section">
              <strong>ERS river and stream segments</strong>
              <ul class="ers-segment-list">
                <li><b>Highlands</b><span>Alpine and sub-alpine reaches, generally above 1,000 m.</span></li>
                <li><b>Uplands A</b><span>Generally above 400 m; includes part of the Upper Goulburn and Broken basins.</span></li>
                <li><b>Uplands B</b><span>Also generally above 400 m, but covers a different set of regions, including northern-draining Goulburn uplands.</span></li>
                <li><b>Central Foothills &amp; Coastal Plains</b><span>Goulburn foothills; central foothills are generally above 200 m.</span></li>
                <li><b>Urban</b><span>Defined metropolitan urban waterways; not a general label for every modified river.</span></li>
                <li><b>Murray &amp; Western Plains</b><span>Lowland reaches, generally below 200 m, including the Goulburn lowlands.</span></li>
              </ul>
              <p class="ers-segment-note"><b>A and B are geographic groups, not better/worse grades.</b> Each segment has its own parameter objectives.</p>
              <p class="ers-current-segments"><b>Sites in this view:</b> ${displayedSegmentSummary}.</p>
              <a href="${data.availability.ers.source_url}" target="_blank" rel="noreferrer">EPA ERS clauses 17 and Table 5.8 ↗</a>
            </div>
            <div class="ers-info-section">
              <strong>Time, aggregation, and ERS</strong>
              <p class="ers-segment-note"><b>The ERS objective does not change each month or year.</b> It is fixed for the site's river segment and parameter in this prototype. What changes is the observed data used for comparison.</p>
              <p class="ers-segment-note">Monthly, seasonal, and yearly charts show the mean of available spot observations in each interval. In Annual ERS mode, marker colour uses the required statistic from the latest complete calendar year inside the selected range; a partial-year range therefore has no annual marker assessment. In Selected period mode, marker colour compares that period’s mean with the fixed segment objective. This comparison is exploratory, not an annual ERS assessment.</p>
            </div>
          </section>
        </div>
      </div>
    </section>

    <section class="analysis-workspace" aria-label="Linked spatial and temporal workspace">
      <article class="panel map-panel">
        <div class="panel-heading">
          <div>
            <p class="section-kicker">Spatial overview</p>
            <h2>Goulburn River basin</h2>
          </div>
          <p class="map-note">Colour shows the latest complete selected year's provisional ERS assessment; hover also shows the latest aggregated value.</p>
        </div>
        <div class="map-stage">
          <div id="map" role="application" aria-label="Interactive map of monitoring sites in the Goulburn River basin"></div>
          <div class="map-controls" aria-label="Map zoom controls">
            <button type="button" data-map-zoom="in" aria-label="Zoom in">+</button>
            <button type="button" data-map-zoom="out" aria-label="Zoom out">−</button>
            <button type="button" data-map-zoom="reset" aria-label="Reset map view">Reset</button>
          </div>
          <div class="map-tooltip" role="status"></div>
          <div class="map-key">Marker outline: <span class="active-dot"></span>Active <span class="inactive-dot"></span>Inactive</div>
        </div>
      </article>

      <section class="panel matrix-panel" aria-labelledby="matrix-title">
        <div class="panel-heading matrix-title-row">
          <div>
            <p class="section-kicker">Temporal comparison</p>
            <h2 id="matrix-title">Sites × water-quality parameters</h2>
          </div>
        </div>
        <div class="matrix-scroll" id="matrix-content" tabindex="0" aria-label="Scrollable small-multiple matrix">
          <div id="matrix"></div>
        </div>
      </section>

      <aside class="panel detail-panel" aria-live="polite">
        <p class="section-kicker">Detailed inspection</p>
        <div id="site-detail"></div>
      </aside>
    </section>

    <footer>
      <span>Source: Goulburn 2015–2024 downloaded spot observations</span>
      <span>${activeCount} active · ${targetSites.length - activeCount} inactive site in this extract</span>
    </footer>

    <section class="dataset-ribbon" aria-label="Dataset information">
      <div class="ribbon-title">
        <p class="section-kicker">Dataset snapshot</p>
        <strong>Goulburn · 2015–2024</strong>
      </div>
      <dl class="ribbon-facts">
        <div><dt>Coverage</dt><dd>1 Jan 2015–31 Dec 2024</dd></div>
        <div><dt>Monitoring sites</dt><dd>${targetSites.length} (${activeCount} active)</dd></div>
        <div><dt>Source measurements</dt><dd>${data.validation.source_measurement_rows.toLocaleString()} rows</dd></div>
        <div><dt>Usable prototype observations</dt><dd>${data.spot.length.toLocaleString()} spot records</dd></div>
      </dl>
      <p class="ribbon-note">Provisional screening with <a href="${data.availability.ers.source_url}" target="_blank" rel="noreferrer">ERS Table 5.8</a> · all ${targetSites.length} displayed natural watercourse sites spatially assigned · <a href="https://discover.data.vic.gov.au/dataset/vicmap-hydro-watercourse-line" target="_blank" rel="noreferrer">Vicmap Hydro watercourses</a> · four drainage sites excluded · DO saturation estimated where temperature is paired · TN uses direct total nitrogen or paired TKN + NOx · Not an official ERS assessment or final WQI</p>
    </section>
  `;

  const buttons = d3.select('.parameter-buttons')
    .selectAll('button')
    .data(parameters)
    .join('button')
    .attr('type', 'button')
    .attr('class', (parameter) => `parameter-button param-${parameter.code.toLowerCase()}`)
    .attr('aria-pressed', (parameter) => parameter.code === state.selectedParameter)
    .style('--parameter-colour', (parameter) => PARAMETER_COLOURS[parameter.code])
    .html((parameter) => `<span>${parameter.short_label}</span><small>${parameter.unit}</small>`)
    .on('click', (_, parameter) => {
      if (viewMode === 'multi') {
        if (state.selectedParameters.has(parameter.code)) { if (state.selectedParameters.size === 1) return; state.selectedParameters.delete(parameter.code); }
        else state.selectedParameters.add(parameter.code);
        if (!state.selectedParameters.has(state.selectedParameter)) state.selectedParameter = [...state.selectedParameters][0];
      } else state.selectedParameter = parameter.code;
      buttons.attr('aria-pressed', (item) => item.code === state.selectedParameter);
      updateLinkedViews(data);
    });

  const ersInfo = document.querySelector('.ers-info');
  const ersInfoButton = document.querySelector('.ers-info-button');
  const setErsInfoOpen = (open) => {
    ersInfo.dataset.open = String(open);
    ersInfoButton.setAttribute('aria-expanded', String(open));
  };
  ersInfo.addEventListener('pointerenter', () => setErsInfoOpen(true));
  ersInfo.addEventListener('pointerleave', () => {
    if (ersInfo.dataset.pinned !== 'true') setErsInfoOpen(false);
  });
  ersInfoButton.addEventListener('click', (event) => {
    event.stopPropagation();
    const pinned = ersInfo.dataset.pinned !== 'true';
    ersInfo.dataset.pinned = String(pinned);
    setErsInfoOpen(pinned);
  });
  document.addEventListener('click', (event) => {
    if (!ersInfo.contains(event.target)) {
      ersInfo.dataset.pinned = 'false';
      setErsInfoOpen(false);
    }
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      ersInfo.dataset.pinned = 'false';
      setErsInfoOpen(false);
      ersInfoButton.focus();
    }
  });
  setupCompactWorkspace(data);
  setupTemporalControls(data);
  setupSiteFilter(data);
  if (!isGrid) setupMapTimeline(data);
}

function setupCompactWorkspace(data) {
  const toolbar = document.createElement('nav');
  toolbar.className = 'compact-toolbar';
  toolbar.setAttribute('aria-label', 'Exploration controls');
  document.querySelector('.masthead').after(toolbar);
  function menu(label, contents, className) {
    const wrapper = document.createElement('details');
    wrapper.className = `compact-menu ${className}`;
    const trigger = document.createElement('summary');
    trigger.innerHTML = label;
    const popover = document.createElement('div');
    popover.className = 'compact-popover';
    popover.append(contents);
    wrapper.append(trigger, popover);
    toolbar.append(wrapper);
    return wrapper;
  }
  const timeMenu = menu('<span id="compact-period">Monthly · 2015–2024</span> ▾', document.querySelector('.temporal-controls'), 'time-menu');
  timeMenu.querySelector('summary').dataset.toolbarHelp = 'Choose months, seasons, or years; periods without data are marked.';
  const siteFilterControl = document.querySelector('.site-filter-control');
  siteFilterControl.querySelector('.site-filter-trigger').dataset.toolbarHelp = 'Choose which monitoring sites appear in the views.';
  toolbar.append(siteFilterControl);
  const parameterMenu = menu('<span id="compact-parameter">DO · Map</span> ▾', document.querySelector('.parameter-buttons'), 'parameter-menu');
  parameterMenu.querySelector('summary').dataset.toolbarHelp = isGrid
    ? 'View the water-quality parameters represented in this grid.'
    : 'Choose the water-quality parameter shown on the map.';
  parameterMenu.addEventListener('click', (event) => {
    if (viewMode !== 'multi' && event.target.closest('.parameter-button')) parameterMenu.open = false;
  });
  const mapDisplay = document.createElement('div');
  mapDisplay.className = 'map-display-toggle';
  mapDisplay.setAttribute('role', 'group');
  mapDisplay.setAttribute('aria-label', 'Map display');
  mapDisplay.innerHTML = '<button type="button" data-map-display="markers" aria-pressed="true">Markers</button><button type="button" data-map-display="temporal" aria-pressed="false">Temporal charts</button>';
  mapDisplay.querySelector('[data-map-display="markers"]').dataset.toolbarHelp = 'Show markers coloured by the selected map time mode.';
  mapDisplay.querySelector('[data-map-display="temporal"]').dataset.toolbarHelp = 'Show a small temporal chart at each site.';
  mapDisplay.addEventListener('click', (event) => {
    const mode = event.target.dataset.mapDisplay;
    if (!mode || mode === state.mapDisplayMode) return;
    state.mapDisplayMode = mode;
    state.hoveredSite = null;
    document.querySelector('.map-tooltip').classList.remove('visible');
    updateLinkedViews(data, { detail: false });
    data.temporalMap?.scheduleLayout();
  });
  const ersLegendGroup = document.querySelector('.ers-legend-group');
  const ersInfoButton = ersLegendGroup.querySelector('.ers-info-button');
  if (ersInfoButton) ersInfoButton.dataset.toolbarHelp = 'Explain how observations are compared with ERS objectives.';
  toolbar.append(ersLegendGroup);
  mapDisplay.hidden = isGrid;
  const compare = document.createElement('button');
  compare.className = 'compare-sites'; compare.type = 'button'; compare.textContent = 'Compare sites · 0/5'; compare.setAttribute('aria-pressed', 'false');
  compare.dataset.toolbarHelp = 'Select up to five sites to compare in one temporal chart.';
  compare.onclick = () => {
    state.compareMode = !state.compareMode;
    if (state.compareMode) state.relatedSelectionMode = false;
    updateLinkedViews(data);
  };
  toolbar.append(compare);
  const watercourseSelect = document.createElement('button');
  watercourseSelect.className = 'watercourse-select';
  watercourseSelect.type = 'button';
  watercourseSelect.textContent = 'Related sites · Off';
  watercourseSelect.setAttribute('aria-pressed', 'false');
  watercourseSelect.dataset.toolbarHelp = 'Select a site to keep up to five related sites: the same named watercourse first, then nearest neighbours. Exploratory only; flow connectivity is not verified.';
  watercourseSelect.dataset.tooltipLong = 'true';
  watercourseSelect.onclick = () => {
    state.relatedSelectionMode = !state.relatedSelectionMode;
    if (state.relatedSelectionMode) {
      state.compareMode = false;
    } else {
      state.selectedSites = new Set(data.sites.filter((site) => site.hasData).map((site) => site.site_id));
      state.comparedSites.clear();
      state.compareMode = false;
      state.selectedSite = null;
      data.syncSiteFilter?.();
      return;
    }
    updateLinkedViews(data);
  };
  const relatedControl = document.createElement('div');
  relatedControl.className = 'related-sites-control';
  relatedControl.append(watercourseSelect);
  toolbar.append(relatedControl);
  relatedControl.hidden = isGrid;
  toolbar.append(mapDisplay);
  const links = document.createElement('nav'); links.className = 'view-links'; links.setAttribute('aria-label', 'Views and help');
  for (const [mode, path, label, help] of [
    ['main','','Geographic map','Find sites on the map and inspect their observations.'],
    ['grid','previews/spatial-grid-minimap-preview.html','Temporal grid','Compare one parameter over time across sites.'],
    ['multi','previews/multiparameter-grid-matrix-preview.html','Multi-parameter grid','Scan threshold patterns for five parameters at each site.'],
  ]) {
    const link = document.createElement('a'); link.href = import.meta.env.BASE_URL + path; link.textContent = label; link.dataset.toolbarHelp = help; if (mode === viewMode) link.setAttribute('aria-current','page'); links.append(link);
  }
  toolbar.before(links);
  if (viewMode === 'multi') {
    const thresholdLegend = document.createElement('aside');
    thresholdLegend.className = 'threshold-legend-bar';
    thresholdLegend.setAttribute('aria-label', 'Temporal threshold-state legend');
    thresholdLegend.innerHTML = `
      <span class="threshold-legend-heading"><strong>Threshold state over time</strong><small>Provisional screening · aggregated spot observations</small></span>
      <span class="threshold-legend-item"><i class="threshold-swatch exceeds" aria-hidden="true"></i>Exceeds</span>
      <span class="threshold-legend-item"><i class="threshold-swatch data-colour" aria-hidden="true"></i>Does not exceed</span>
      <span class="threshold-legend-item"><i class="threshold-swatch no-data" aria-hidden="true"></i>No data / no objective</span>`;
    const ersInfo = document.querySelector('.ers-info');
    if (ersInfo) {
      ersInfo.classList.add('threshold-legend-info');
      thresholdLegend.append(ersInfo);
    }
    toolbar.after(thresholdLegend);
    app.classList.add('has-threshold-legend');
  }
  if (viewMode === 'grid') { document.querySelector('.analysis-workspace').classList.add('single-grid'); document.querySelector('.matrix-panel').hidden = true; }
  const temporalLegend = document.createElement('p');
  temporalLegend.className = 'temporal-map-legend';
  temporalLegend.hidden = true;
  toolbar.append(temporalLegend);
  setupToolbarHelp([toolbar, links]);
  document.querySelector('.parameter-bar').remove();
  document.querySelector('.masthead .eyebrow').remove();
  document.querySelector('.subtitle').textContent = 'Prototype · Goulburn Basin · 2015–2024';
  const snapshot = document.createElement('details');
  snapshot.className = 'compact-dataset';
  snapshot.innerHTML = '<summary>Dataset and methodology</summary>';
  snapshot.append(document.querySelector('.summary-chips'), document.querySelector('.dataset-ribbon'));
  app.append(snapshot);
  const sortControl = document.createElement('label');
  sortControl.className = 'site-sort-control';
  sortControl.innerHTML = `Order sites <select id="site-sort">${SITE_ORDER_OPTIONS.map(([value,label])=>`<option value="${value}">${label}</option>`).join('')}</select>`;
  const matrixPanel = document.querySelector('.matrix-panel');
  matrixPanel.querySelector('.matrix-title-row').append(sortControl);
  const sortNote = document.createElement('p');
  sortNote.className = 'site-sort-note';
  sortNote.id = 'site-sort-note';
  sortNote.textContent = 'Position and elevation orders do not establish upstream–downstream connections.';
  matrixPanel.querySelector('.matrix-title-row').after(sortNote);
  const matrixToggle = document.createElement('button');
  matrixToggle.type = 'button';
  matrixToggle.className = 'matrix-toggle';
  matrixToggle.textContent = 'Minimize';
  matrixToggle.setAttribute('aria-expanded', 'true');
  matrixToggle.setAttribute('aria-controls', 'matrix-content');
  matrixPanel.querySelector('.matrix-title-row').append(matrixToggle);
  matrixToggle.addEventListener('click', () => {
    state.matrixCollapsed = !state.matrixCollapsed;
    document.querySelector('.analysis-workspace').classList.toggle('matrix-collapsed', state.matrixCollapsed);
    matrixPanel.querySelector('.matrix-scroll').hidden = state.matrixCollapsed;
    sortNote.hidden = state.matrixCollapsed;
    matrixToggle.textContent = state.matrixCollapsed ? 'Show panel' : 'Minimize';
    matrixToggle.setAttribute('aria-expanded', String(!state.matrixCollapsed));
    if (!state.matrixCollapsed && state.selectedSite) scrollMatrixToSite(state.selectedSite);
    data.temporalMap?.scheduleLayout();
  });
  const select = sortControl.querySelector('select');
  select.value = state.siteSort;
  select.setAttribute('aria-describedby', 'site-sort-note');
  select.addEventListener('change', () => {
    state.siteSort = select.value;
    createMatrix(data);
    updateLinkedViews(data, { detail: false });
    data.grid?.syncSort();
    document.querySelector('.matrix-scroll').scrollTop = 0;
  });
  const detail = document.querySelector('.detail-panel');
  const heading = document.createElement('div');
  heading.className = 'compact-detail-heading';
  heading.innerHTML = '<strong>Detailed inspection</strong><div><button type="button" data-detail="dock" aria-label="Move detail above map">↥</button><button type="button" data-detail="expand" aria-label="Expand detail panel">↔</button><button type="button" data-detail="close" aria-label="Close detail panel">×</button></div>';
  detail.querySelector('.section-kicker').replaceWith(heading);
  heading.addEventListener('click', (event) => {
    const action = event.target.dataset.detail;
    const workspace = document.querySelector('.analysis-workspace');
    if (action === 'close') { state.selectedSite = null; state.compareMode = false; updateLinkedViews(data); }
    if (action === 'expand') {
      const expanded = workspace.classList.toggle('detail-expanded');
      if (expanded) data.sidebar.expand(); else data.sidebar.setWidth(340);
      event.target.setAttribute('aria-label', expanded ? 'Reduce detail panel' : 'Expand detail panel');
    }
    if (action === 'dock') {
      const above = workspace.classList.toggle('detail-above');
      event.target.setAttribute('aria-label', above ? 'Dock detail to the right' : 'Move detail above map');
    }
    if (action) requestAnimationFrame(() => { data.map?.map.resize(); data.grid?.resize(); updateDetail(data); });
  });
  data.sidebar = createSidebarResize(document.querySelector('.analysis-workspace'), () => {
    data.map?.map.resize();
    data.grid?.resize();
    if (data.matrix) updateDetail(data);
  });
  const closeMenus = (event) => {
    document.querySelectorAll('.compact-menu[open]').forEach((item) => {
      if (event.type === 'keydown' || !item.contains(event.target)) {
        item.open = false;
        if (event.type === 'keydown') item.querySelector('summary').focus();
      }
    });
  };
  document.addEventListener('click', closeMenus);
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeMenus(event); });
}

function setupToolbarHelp(containers) {
  const tooltip = document.createElement('div');
  tooltip.className = 'toolbar-help-tooltip';
  tooltip.id = 'toolbar-help-tooltip';
  tooltip.setAttribute('role', 'tooltip');
  tooltip.hidden = true;
  document.body.append(tooltip);
  let activeTarget = null;

  const show = (target) => {
    if (!target?.dataset.toolbarHelp || target.disabled) return;
    activeTarget = target;
    tooltip.textContent = target.dataset.toolbarHelp;
    tooltip.classList.toggle('long', target.dataset.tooltipLong === 'true');
    tooltip.hidden = false;
    target.setAttribute('aria-describedby', tooltip.id);
    const rect = target.getBoundingClientRect();
    const tooltipRect = tooltip.getBoundingClientRect();
    const left = Math.min(
      window.innerWidth - tooltipRect.width - 10,
      Math.max(10, rect.left + (rect.width - tooltipRect.width) / 2),
    );
    const below = rect.bottom + 8;
    const top = below + tooltipRect.height <= window.innerHeight - 10
      ? below
      : Math.max(10, rect.top - tooltipRect.height - 8);
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
  };
  const hide = (target) => {
    if (target && target !== activeTarget) return;
    activeTarget?.removeAttribute('aria-describedby');
    activeTarget = null;
    tooltip.hidden = true;
  };
  for (const container of containers) {
    container.addEventListener('pointerover', (event) => show(event.target.closest('[data-toolbar-help]')));
    container.addEventListener('pointerout', (event) => {
      const target = event.target.closest('[data-toolbar-help]');
      if (target && !target.contains(event.relatedTarget)) hide(target);
    });
    container.addEventListener('focusin', (event) => show(event.target.closest('[data-toolbar-help]')));
    container.addEventListener('focusout', (event) => hide(event.target.closest('[data-toolbar-help]')));
  }
  window.addEventListener('scroll', () => hide(), { passive: true });
  window.addEventListener('resize', () => hide(), { passive: true });
}

function updateTemporalSummary(data, message = null) {
  const summary = document.querySelector('.temporal-summary');
  if (!summary) return;
  if (message) {
    summary.textContent = message;
    return;
  }
  const resolution = resolutionLabel(state.selectedResolution);
  const fullPeriod = dateInputFormat(state.rangeStart) === '2015-01-01' && dateInputFormat(state.rangeEnd) === '2024-12-31';
  const startLabel = periodLabel(periodStart(state.rangeStart, state.selectedResolution), state.selectedResolution);
  const endLabel = periodLabel(periodStart(state.rangeEnd, state.selectedResolution), state.selectedResolution);
  const range = fullPeriod ? '2015–2024' : startLabel === endLabel ? startLabel : `${startLabel}–${endLabel}`;
  const period = document.querySelector('#compact-period');
  if (period) period.textContent = `${resolution} · ${range}`;
  const selectedCount = state.selectedSites.size;
  const hasObservations = data.spot.some((row) => state.selectedSites.has(row.site_id) && Number.isFinite(row.value) && dateInSelectedRange(row.datetimeValue));
  summary.textContent = `${resolution} · ${range} · ${selectedCount} site${selectedCount === 1 ? '' : 's'}${hasObservations ? '' : ' · No observations in this period'}`;
  document.querySelectorAll('[data-resolution]').forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.resolution === state.selectedResolution));
  });
}

function refreshTemporalViews(data) {
  for (const id of state.comparedSites.keys()) if (!state.selectedSites.has(id)) state.comparedSites.delete(id);
  if (!state.selectedSites.has(state.hoveredSite)) state.hoveredSite = null;
  data.temporalView = buildTemporalView(data);
  data.updatePeriodOptions?.();
  data.mapTimeline?.update();
  createMatrix(data);
  updateTemporalSummary(data);
  updateLinkedViews(data);
}

function setupTemporalControls(data) {
  const startInput = document.querySelector('#range-start');
  const endInput = document.querySelector('#range-end');
  let periods = [];
  const renderPeriodOptions = () => {
    periods = buildPeriods(state.selectedResolution, data.spot, state.selectedSites);
    const startPeriod = periodContaining(periods, state.rangeStart);
    const endPeriod = periodContaining(periods, state.rangeEnd);
    for (const [input, selected] of [[startInput, startPeriod], [endInput, endPeriod]]) {
      input.setAttribute('aria-label', `${input === startInput ? 'First' : 'Last'} ${state.selectedResolution} period`);
      input.replaceChildren(...periods.map((period) => {
        const option = document.createElement('option');
        option.value = period.key;
        option.textContent = `${period.label}${period.partial ? ' (partial)' : ''} · ${period.siteCount ? `${period.siteCount} site${period.siteCount === 1 ? '' : 's'}` : 'No data'}`;
        return option;
      }));
      input.value = selected.key;
    }
  };
  data.updatePeriodOptions = renderPeriodOptions;
  renderPeriodOptions();
  const resolutionButtons = document.querySelectorAll('[data-resolution]');
  resolutionButtons.forEach((button) => button.addEventListener('click', () => {
    const nextResolution = button.dataset.resolution;
    if (nextResolution === state.selectedResolution) return;
    state.selectedResolution = nextResolution;
    const nextPeriods = buildPeriods(nextResolution, data.spot, state.selectedSites);
    state.rangeStart = periodContaining(nextPeriods, state.rangeStart).start;
    state.rangeEnd = periodContaining(nextPeriods, state.rangeEnd).end;
    refreshTemporalViews(data);
  }));

  const applyRange = (changed) => {
    let startIndex = periods.findIndex((period) => period.key === startInput.value);
    let endIndex = periods.findIndex((period) => period.key === endInput.value);
    if (startIndex < 0 || endIndex < 0) return;
    if (startIndex > endIndex) {
      if (changed === 'start') endIndex = startIndex;
      else startIndex = endIndex;
    }
    state.rangeStart = periods[startIndex].start;
    state.rangeEnd = periods[endIndex].end;
    refreshTemporalViews(data);
  };
  startInput.addEventListener('change', () => applyRange('start'));
  endInput.addEventListener('change', () => applyRange('end'));
  document.querySelector('.range-reset').addEventListener('click', () => {
    startInput.value = periods[0].key;
    endInput.value = periods.at(-1).key;
    applyRange('reset');
  });
  document.querySelector('[data-range-preset="latest-year"]').addEventListener('click', () => {
    startInput.value = periodContaining(periods, new Date(2024, 0, 1)).key;
    endInput.value = periodContaining(periods, DATA_END).key;
    applyRange('preset');
  });
}

function setupMapTimeline(data) {
  const menu = document.createElement('details');
  menu.className = 'compact-menu map-time-menu';
  const summary = document.createElement('summary');
  summary.textContent = 'Map time · Annual ERS ▾';
  summary.dataset.toolbarHelp = 'Choose annual ERS or animate selected periods on the map.';
  const popover = document.createElement('div');
  popover.className = 'compact-popover map-time-popover';
  const bar = document.createElement('section');
  bar.className = 'timeline-preview-bar';
  bar.setAttribute('aria-label', 'Map time controls');
  bar.innerHTML = `
    <strong>Map time</strong>
    <div class="timeline-preview-modes" role="group" aria-label="Map colour mode">
      <button type="button" data-preview-mode="annual" aria-pressed="true">Annual ERS</button>
      <button type="button" data-preview-mode="period" aria-pressed="false">Selected period</button>
    </div>
    <button type="button" class="timeline-preview-play" aria-label="Play timeline">▶ Play</button>
    <input class="timeline-preview-slider" type="range" min="0" max="0" value="0" aria-label="Timeline frame">
    <select class="timeline-preview-select" aria-label="Selected map period"></select>
    <span class="timeline-preview-caption" aria-live="polite"></span>`;
  const dockHint = document.createElement('p');
  dockHint.className = 'timeline-dock-hint';
  dockHint.textContent = 'The timeline is pinned below the map. Use Annual ERS there to close it.';
  dockHint.hidden = true;
  popover.append(bar, dockHint);
  menu.append(summary, popover);
  const toolbar = document.querySelector('.compact-toolbar');
  toolbar.insertBefore(menu, toolbar.querySelector('.map-display-toggle'));
  const select = bar.querySelector('select');
  const slider = bar.querySelector('input');
  const play = bar.querySelector('.timeline-preview-play');
  let periods = [];
  let timer = null;
  let statuses = new Map();
  let restoreMatrixAfterPlayback = false;
  function pause() {
    if (timer !== null) clearInterval(timer);
    timer = null;
    play.textContent = '▶ Play';
    play.setAttribute('aria-label', 'Play timeline');
    if (restoreMatrixAfterPlayback && state.matrixCollapsed) document.querySelector('.matrix-toggle').click();
    restoreMatrixAfterPlayback = false;
  }
  function selectFrame(index) {
    const frame = periods[Math.max(0, Math.min(periods.length - 1, index))];
    if (!frame) return;
    state.mapFrameKey = frame.key;
    select.value = frame.key;
    slider.value = String(periods.indexOf(frame));
    const grouped = d3.group(data.spot.filter((row) => row.datetimeValue >= frame.start && row.datetimeValue <= frame.end && Number.isFinite(row.value) && row.parameter_code === state.selectedParameter), (row) => row.site_id);
    statuses = new Map([...grouped].map(([siteId, rows]) => [siteId, classifyTemporalValue(data, siteId, state.selectedParameter, d3.mean(rows, (row) => row.value))]));
    const count = [...grouped.keys()].filter((siteId) => state.selectedSites.has(siteId)).length;
    const showingPeriod = state.mapTimeMode === 'period';
    bar.querySelector('.timeline-preview-caption').textContent = state.mapTimeMode === 'annual'
      ? 'Marker colour: latest complete selected year’s annual ERS statistic. Full temporal charts remain below.'
      : `${frame.label}${frame.partial ? ' (partial)' : ''} · ${count ? `${count} sites with observations` : 'No observations in selected sites'} · Period mean vs segment objective (exploratory).`;
    summary.textContent = `Map time · ${state.mapTimeMode === 'annual' ? 'Annual ERS' : frame.label} ▾`;
    bar.querySelectorAll('[data-preview-mode]').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.previewMode === state.mapTimeMode)));
    bar.classList.toggle('period-mode', showingPeriod);
    dockHint.hidden = !showingPeriod;
    if (showingPeriod && !bar.classList.contains('timeline-docked')) {
      bar.classList.add('timeline-docked');
      document.querySelector('.map-panel').append(bar);
      menu.open = false;
    } else if (!showingPeriod && bar.classList.contains('timeline-docked')) {
      bar.classList.remove('timeline-docked');
      popover.append(bar);
    }
    bar.querySelector('.timeline-preview-play').disabled = state.mapTimeMode !== 'period';
    bar.querySelector('.timeline-preview-slider').disabled = state.mapTimeMode !== 'period';
    select.disabled = state.mapTimeMode !== 'period';
    document.querySelector('.map-tooltip')?.classList.remove('visible');
    updateLinkedViews(data, { detail: false });
  }
  function update() {
    pause();
    const available = buildPeriods(state.selectedResolution, data.spot, state.selectedSites);
    periods = available.filter((period) => period.end >= state.rangeStart && period.start <= state.rangeEnd);
    if (!periods.length) return;
    const current = periods.find((period) => period.key === state.mapFrameKey) || periods.at(-1);
    select.replaceChildren(...periods.map((period) => {
      const option = document.createElement('option');
      option.value = period.key;
      option.textContent = `${period.label}${period.partial ? ' (partial)' : ''} · ${period.siteCount ? `${period.siteCount} sites` : 'No data'}`;
      return option;
    }));
    slider.max = String(periods.length - 1);
    selectFrame(periods.indexOf(current));
  }
  bar.querySelectorAll('[data-preview-mode]').forEach((button) => button.addEventListener('click', () => {
    state.mapTimeMode = button.dataset.previewMode;
    if (state.mapTimeMode === 'annual') pause();
    selectFrame(Number(slider.value));
  }));
  select.addEventListener('change', () => { pause(); selectFrame(periods.findIndex((period) => period.key === select.value)); });
  slider.addEventListener('input', () => { pause(); selectFrame(Number(slider.value)); });
  play.addEventListener('click', () => {
    if (timer !== null) { pause(); return; }
    if (!state.matrixCollapsed) {
      document.querySelector('.matrix-toggle').click();
      restoreMatrixAfterPlayback = true;
    }
    if (Number(slider.value) >= periods.length - 1) selectFrame(0);
    play.textContent = 'Ⅱ Pause';
    play.setAttribute('aria-label', 'Pause timeline');
    timer = setInterval(() => {
      const next = Number(slider.value) + 1;
      if (next >= periods.length) { pause(); return; }
      selectFrame(next);
    }, 850);
  });
  data.mapTimeline = { update, status: (siteId) => statuses.get(siteId) || 'unavailable', frame: () => periods.find((period) => period.key === state.mapFrameKey) };
  update();
}

function setupSiteFilter(data) {
  const control = document.querySelector('.site-filter-control');
  const trigger = document.querySelector('.site-filter-trigger');
  const checkboxes = [...document.querySelectorAll('.site-checkbox')];
  const basinCheckboxes = [...document.querySelectorAll('.basin-checkbox')];
  const totalSites = checkboxes.length;
  const setOpen = (open) => {
    control.dataset.open = String(open);
    trigger.setAttribute('aria-expanded', String(open));
  };
  const renderSelection = () => {
    basinCheckboxes.forEach((basinCheckbox) => {
      const basinSites = checkboxes.filter((checkbox) => checkbox.dataset.basin === basinCheckbox.dataset.basin);
      const checked = basinSites.filter((checkbox) => checkbox.checked).length;
      basinCheckbox.checked = checked === basinSites.length;
      basinCheckbox.indeterminate = checked > 0 && checked < basinSites.length;
    });
    const selectedCount = state.selectedSites.size;
    trigger.innerHTML = `<strong>${selectedCount}</strong> / ${totalSites} sites`;
    document.querySelector('.site-filter-summary').textContent = selectedCount === totalSites
      ? `Showing all ${totalSites} sites`
      : `Showing ${selectedCount} of ${totalSites} sites`;
    if (state.selectedSite && !state.selectedSites.has(state.selectedSite)) state.selectedSite = null;
    refreshTemporalViews(data);
  };
  const updateFilter = () => {
    state.selectedSites = new Set(checkboxes.filter((checkbox) => checkbox.checked).map((checkbox) => checkbox.value));
    renderSelection();
  };
  data.syncSiteFilter = () => {
    checkboxes.forEach((checkbox) => { checkbox.checked = state.selectedSites.has(checkbox.value); });
    renderSelection();
  };
  trigger.addEventListener('click', (event) => {
    event.stopPropagation();
    setOpen(control.dataset.open !== 'true');
  });
  document.querySelector('.site-filter-done').addEventListener('click', () => {
    setOpen(false);
    trigger.focus();
  });
  checkboxes.forEach((checkbox) => checkbox.addEventListener('change', updateFilter));
  basinCheckboxes.forEach((basinCheckbox) => basinCheckbox.addEventListener('change', () => {
    checkboxes
      .filter((checkbox) => checkbox.dataset.basin === basinCheckbox.dataset.basin)
      .forEach((checkbox) => { checkbox.checked = basinCheckbox.checked; });
    updateFilter();
  }));
  document.addEventListener('click', (event) => {
    if (!control.contains(event.target)) setOpen(false);
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && control.dataset.open === 'true') {
      setOpen(false);
      trigger.focus();
    }
  });
}

function createMap(data) {
  const [[west, south], [east, north]] = d3.geoBounds(data.boundary);
  const bounds = [
    [west, south],
    [east, north],
  ];
  const map = new maplibregl.Map({
    container: 'map',
    // Keep the basemap definition self-contained so Safari and GitHub Pages do
    // not depend on CARTO's external vector-style resources.
    style: {
      version: 8,
      sources: {
        'esri-light-gray': {
          type: 'raster',
          tiles: [
            'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}',
          ],
          tileSize: 256,
          attribution: 'Tiles &copy; Esri',
        },
        'esri-light-gray-reference': {
          type: 'raster',
          tiles: [
            'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}',
          ],
          tileSize: 256,
        },
      },
      layers: [
        { id: 'esri-light-gray', type: 'raster', source: 'esri-light-gray' },
        {
          id: 'esri-light-gray-reference',
          type: 'raster',
          source: 'esri-light-gray-reference',
        },
      ],
    },
    center: [145.66, -36.82],
    zoom: 6.4,
    minZoom: 5,
    maxZoom: 14,
    maxPitch: 0,
    dragRotate: false,
    pitchWithRotate: false,
    touchPitch: false,
  });

  const resetView = (duration = 0) => map.fitBounds(bounds, { padding: 38, duration });
  const addGeographicContext = () => {
    if (map.getSource('goulburn-basin')) return;
    map.addSource('goulburn-basin', { type: 'geojson', data: data.boundary });
    map.addLayer({
      id: 'goulburn-basin-fill',
      type: 'fill',
      source: 'goulburn-basin',
      paint: { 'fill-color': '#b8dbc7', 'fill-opacity': 0.16 },
    });
    map.addSource('goulburn-watercourses', { type: 'geojson', data: data.watercourses });
    map.addLayer({
      id: 'goulburn-watercourses',
      type: 'line',
      source: 'goulburn-watercourses',
      paint: {
        'line-color': [
          'match', ['get', 'hierarchy'],
          'H', '#73a9d2',
          'M', '#8fc0df',
          '#b5d7e9',
        ],
        'line-width': [
          'interpolate', ['linear'], ['zoom'],
          6, ['match', ['get', 'hierarchy'], 'H', 1.25, 'M', 0.9, 0.55],
          12, ['match', ['get', 'hierarchy'], 'H', 3, 'M', 2, 1.2],
        ],
        'line-opacity': 0.82,
      },
    });
    map.addLayer({
      id: 'goulburn-basin-outline',
      type: 'line',
      source: 'goulburn-basin',
      paint: { 'line-color': '#3e704f', 'line-width': 1.6, 'line-opacity': 0.82 },
    });
    resetView();
  };

  // An inline raster style can finish loading before a production bundle has
  // attached its `load` listener. Install the local context immediately when
  // the style is ready so GitHub Pages and the development server behave alike.
  if (map.isStyleLoaded()) addGeographicContext();
  else map.once('load', addGeographicContext);

  const targetSites = data.sites.filter((site) => site.hasData);
  const markerEntries = targetSites.map((site) => {
    const element = document.createElement('button');
    element.type = 'button';
    element.className = 'site-marker';
    element.dataset.siteId = site.site_id;
    element.setAttribute('aria-label', `${site.short_name}, site ${site.site_id}`);
    element.innerHTML = `<svg viewBox="0 0 30 30" aria-hidden="true"><circle class="site-halo" cx="15" cy="15" r="12"></circle><circle class="comparison-ring" cx="15" cy="15" r="9"></circle><circle class="status-ring" cx="15" cy="15" r="7"></circle><circle class="site-dot${site.active ? '' : ' inactive'}" cx="15" cy="15" r="5.5"></circle></svg>`;
    new maplibregl.Marker({ element, anchor: 'center' })
      .setLngLat([site.longitude, site.latitude])
      .addTo(map);
    d3.select(element)
      .on('pointerenter focus', (event) => setHoveredSite(data, site.site_id, event))
      .on('pointermove', (event) => positionTooltip(data, site, event))
      .on('pointerleave blur', () => setHoveredSite(data, null))
      .on('click', (event) => selectLinkedTarget(data, { siteId: site.site_id, event, allowRelated: true }));
    return { element, site };
  });

  d3.selectAll('[data-map-zoom]').on('click', function changeMapZoom() {
    const action = this.dataset.mapZoom;
    if (action === 'reset') {
      resetView(260);
    } else {
      map[action === 'in' ? 'zoomIn' : 'zoomOut']({ duration: 220 });
    }
  });

  data.map = { map, markerEntries, resetView };
}

function compareSites(a, b) {
  return compareSitesByOrder(a,b,state.siteSort);
}

function createMatrix(data) {
  const temporalView = data.temporalView || buildTemporalView(data);
  const sites = data.sites
    .filter((site) => site.hasData && state.selectedSites.has(site.site_id))
    .sort(compareSites);
  const parameters = data.availability.parameters;
  const dailyByCell = d3.group(temporalView.continuous, (row) => cellKey(row.site_id, row.parameter_code));
  const spotByCell = d3.group(temporalView.spot, (row) => cellKey(row.site_id, row.parameter_code));
  const yearDomain = [state.rangeStart, state.rangeEnd];

  const yDomains = new Map(parameters.map((parameter) => [
    parameter.code, parameterAxisDomain(data, data.allTemporal(), parameter.code),
  ]));

  const matrix = d3.select('#matrix');
  matrix.selectAll('*').remove();
  matrix.style('--parameter-count', parameters.length);
  const header = matrix.append('div').attr('class', 'matrix-header matrix-grid');
  header.append('div').attr('class', 'corner-label').text('Monitoring site');
  header.selectAll('.column-heading')
    .data(parameters)
    .join('button')
    .attr('type', 'button')
    .attr('class', 'column-heading')
    .attr('data-parameter', (parameter) => parameter.code)
    .style('--parameter-colour', (parameter) => PARAMETER_COLOURS[parameter.code])
    .html((parameter) => `<strong>${parameter.short_label}</strong><span>${parameter.unit}</span>`)
    .on('click', (_, parameter) => {
      state.selectedParameter = parameter.code;
      d3.selectAll('.parameter-button').attr('aria-pressed', (item) => item.code === state.selectedParameter);
      updateLinkedViews(data);
    });

  const rows = matrix.selectAll('.matrix-row')
    .data(sites, (site) => site.site_id)
    .join('div')
    .attr('class', 'matrix-row matrix-grid')
    .attr('id', (site) => `matrix-row-${site.site_id}`)
    .attr('data-site-id', (site) => site.site_id)
    .on('pointerenter focusin', (event, site) => setHoveredSite(data, site.site_id, event))
    .on('pointerleave', () => setHoveredSite(data, null))
    .on('focusout', function(event) { if (!this.contains(event.relatedTarget)) setHoveredSite(data, null); });
  rows.append('button')
    .attr('type', 'button')
    .attr('class', 'row-label')
    .on('click', (event, site) => selectLinkedTarget(data, { siteId: site.site_id, event }))
    .html((site) => `<strong>${site.short_name}</strong><span>${site.site_id}${site.active ? '' : ' · inactive'}</span>`);

  if (!sites.length) {
    matrix.append('div').attr('class', 'matrix-empty').text('Select at least one monitoring site to show temporal plots.');
  }

  matrix.append('div')
    .attr('class', 'comparison-matrix-empty')
    .attr('hidden', true)
    .text('Select sites from the map, grid, or mini-map to compare them here.');

  rows.each(function drawRow(site) {
    const row = d3.select(this);
    const cells = row.selectAll('.chart-cell')
      .data(parameters.map((parameter) => ({ site, parameter })))
      .join('button')
      .attr('type', 'button')
      .attr('class', 'chart-cell')
      .attr('data-parameter', ({ parameter }) => parameter.code)
      .style('--parameter-colour', ({ parameter }) => PARAMETER_COLOURS[parameter.code])
      .attr('aria-label', ({ site: itemSite, parameter }) => `Inspect ${parameter.label} at ${itemSite.short_name}`)
      .on('click', (event, item) => selectLinkedTarget(data, {
        siteId: item.site.site_id,
        parameterCode: item.parameter.code,
        event,
      }));

    cells.each(function drawCell({ site: currentSite, parameter }) {
      const key = cellKey(currentSite.site_id, parameter.code);
      const daily = (dailyByCell.get(key) || []).filter((item) => Number.isFinite(item.value));
      const spot = (spotByCell.get(key) || []).filter((item) => Number.isFinite(item.value));
      const cell = d3.select(this);
      if (!daily.length && !spot.length) {
        cell.classed('no-data', true).append('span').text('No data');
        return;
      }

      const width = 184;
      const height = 72;
      const margin = { top: 8, right: 8, bottom: 14, left: 8 };
      const x = d3.scaleTime().domain(yearDomain).range([margin.left, width - margin.right]);
      const y = d3.scaleLinear().domain(yDomains.get(parameter.code)).range([height - margin.bottom, margin.top]);
      const svg = cell.append('svg').attr('viewBox', `0 0 ${width} ${height}`).attr('aria-hidden', 'true');

      const objective = data.availability.sites[currentSite.site_id]?.parameters?.[parameter.code]?.ers_assessment?.objective;
      if (objective) {
        if (Number.isFinite(objective.lower) && Number.isFinite(objective.upper)) {
          const top = y(objective.upper);
          const bottom = y(objective.lower);
          svg.append('rect')
            .attr('class', 'ers-objective-band')
            .attr('x', margin.left)
            .attr('width', width - margin.left - margin.right)
            .attr('y', Math.min(top, bottom))
            .attr('height', Math.abs(bottom - top));
        } else if (Number.isFinite(objective.upper)) {
          svg.append('line')
            .attr('class', 'ers-objective-line')
            .attr('x1', margin.left).attr('x2', width - margin.right)
            .attr('y1', y(objective.upper)).attr('y2', y(objective.upper));
        }
      }
      svg.append('line')
        .attr('class', 'cell-baseline')
        .attr('x1', margin.left).attr('x2', width - margin.right)
        .attr('y1', height - margin.bottom).attr('y2', height - margin.bottom);
      const midpoint = new Date((state.rangeStart.getTime() + state.rangeEnd.getTime()) / 2);
      svg.append('line')
        .attr('class', 'midyear-tick')
        .attr('x1', x(midpoint)).attr('x2', x(midpoint))
        .attr('y1', height - margin.bottom).attr('y2', height - margin.bottom + 3);

      if (daily.length) {
        const area = d3.area()
          .defined((item) => Number.isFinite(item.min) && Number.isFinite(item.max))
          .x((item) => x(item.dateValue))
          .y0((item) => y(item.min))
          .y1((item) => y(item.max));
        const line = d3.line()
          .x((item) => x(item.dateValue))
          .y((item) => y(item.value));
        svg.append('path').datum(daily).attr('class', 'daily-range').attr('d', area);
        svg.append('path').datum(daily).attr('class', 'daily-line').attr('d', line);
      }
      if (spot.length) {
        svg.append('g').selectAll('circle')
          .data(spot)
          .join('circle')
          .attr('class', (item) => `spot-point ${item.ers_point_status || ''}`)
          .attr('cx', (item) => x(item.datetimeValue))
          .attr('cy', (item) => y(item.value))
          .attr('r', 2.2);
      }
    });
  });
  data.matrix = { rows, parameters };
}

function getParameter(data, code) {
  return data.availability.parameters.find((parameter) => parameter.code === code);
}

function getFocusSite(data) {
  const id = state.selectedSite;
  return data.sites.find((site) => site.site_id === id) || null;
}

function getCellSeries(data, siteId, parameterCode) {
  const temporalView = data.temporalView || buildTemporalView(data);
  const daily = temporalView.continuous
    .filter((row) => row.site_id === siteId && row.parameter_code === parameterCode && Number.isFinite(row.value))
    .sort((a, b) => d3.ascending(a.dateValue, b.dateValue));
  const spot = temporalView.spot
    .filter((row) => row.site_id === siteId && row.parameter_code === parameterCode && Number.isFinite(row.value))
    .sort((a, b) => d3.ascending(a.datetimeValue, b.datetimeValue));
  return { daily, spot };
}

function assessmentText(parameter, assessment) {
  if (!assessment?.statistics) return 'No usable observations';
  if (assessment.status === 'unavailable' && assessment.sample_count < (assessment.minimum_count || 11)) {
    return `${assessment.sample_count || 0} observations · at least ${assessment.minimum_count || 11} required`;
  }
  const stats = assessment.statistics;
  if (parameter.code === 'DO') return `P25 ${formatValue(stats.p25)} · max ${formatValue(stats.max)}`;
  if (parameter.code === 'PH') return `P25 ${formatValue(stats.p25)} · P75 ${formatValue(stats.p75)}`;
  return `P75 ${formatValue(stats.p75)}`;
}

function detailPointHtml(observation, parameter) {
  const date = observation.dateValue || observation.datetimeValue;
  const resolution = observation.temporalResolution;
  const aggregation = resolution?.replace('-spot', '') || state.selectedResolution;
  const source = `${resolutionLabel(aggregation)} mean of available spot observations`;
  const dateText = periodDateLabel(date, aggregation);
  const raw = parameter.code === 'DO' && Number.isFinite(observation.rawValue)
    ? `<span>Measured ${formatValue(observation.rawValue)} ${observation.raw_unit}${Number.isFinite(observation.temperature) ? ` · ${formatValue(observation.temperature)} °C` : ''}</span>`
    : '';
  const sample = `<span>${observation.observationCount || 1} spot observation${observation.observationCount === 1 ? '' : 's'} aggregated</span>`;
  const observationDates = observation.originalDates || [];
  const displayedDates = observationDates.slice(0, 3).map((sampleDate) => d3.timeFormat('%d %b %Y · %H:%M')(sampleDate));
  const dates = observationDates.length
    ? `<span>Observed: ${displayedDates.join('; ')}${observationDates.length > displayedDates.length ? `; +${observationDates.length - displayedDates.length} more below` : ''}</span>`
    : '';
  return `<strong>${formatValue(observation.value)} ${parameter.unit}</strong><time>${dateText}</time><span>${source}</span>${dates}${raw}${sample}<em class="${observation.ers_point_status}">${formatStatus(observation.ers_point_status)}</em>`;
}

function drawDetailChart(data, site, parameter, record) {
  const container = document.querySelector('#detail-chart');
  if (!container) return;
  const { daily, spot } = getCellSeries(data, site.site_id, parameter.code);
  const originalDatesByPeriod = d3.group(
    data.spot.filter((row) => row.site_id === site.site_id && row.parameter_code === parameter.code && Number.isFinite(row.value) && dateInSelectedRange(row.datetimeValue)),
    (row) => +temporalBucket(row.datetimeValue, state.selectedResolution),
  );
  const observations = [
    ...daily.map((row) => ({ ...row, date: row.dateValue })),
    ...spot.map((row) => ({ ...row, date: row.datetimeValue,
      originalDates: (originalDatesByPeriod.get(+temporalBucket(row.datetimeValue, state.selectedResolution)) || [])
        .map((sourceRow) => sourceRow.datetimeValue).sort((a, b) => a - b) })),
  ].sort((a, b) => d3.ascending(a.date, b.date));
  if (!observations.length) {
    container.innerHTML = '<p class="detail-no-data">No usable observations are available for this plot.</p>';
    return;
  }

  const width = Math.max(248, Math.round(container.getBoundingClientRect().width || 280));
  const height = 250;
  const margin = { top: 15, right: 14, bottom: 48, left: 58 };
  const x = d3.scaleTime()
    .domain([state.rangeStart, state.rangeEnd])
    .range([margin.left, width - margin.right]);
  const objective = record?.ers_assessment?.objective;
  const y = d3.scaleLinear().domain(parameterAxisDomain(data, data.allTemporal(), parameter.code))
    .range([height - margin.bottom, margin.top]);

  const svg = d3.select(container).append('svg')
    .attr('class', 'detail-chart-svg')
    .attr('viewBox', `0 0 ${width} ${height}`)
    .attr('role', 'img')
    .attr('aria-label', `${parameter.label} observations at ${site.short_name} from ${displayDateFormat(state.rangeStart)} to ${displayDateFormat(state.rangeEnd)}`);
  svg.append('title').text(`${parameter.label} at ${site.short_name}`);
  svg.append('desc').text(Number.isFinite(objective?.lower) && Number.isFinite(objective?.upper)
    ? 'The pale green horizontal band shows the lower-to-upper ERS objective range. Orange marks show aggregated spot observations.'
    : 'Aggregated spot observations compared with the applicable ERS upper objective.');

  if (Number.isFinite(objective?.lower) && Number.isFinite(objective?.upper)) {
    svg.append('rect')
      .attr('class', 'detail-objective-band')
      .attr('x', margin.left)
      .attr('width', width - margin.left - margin.right)
      .attr('y', y(objective.upper))
      .attr('height', Math.max(0, y(objective.lower) - y(objective.upper)));
  } else if (Number.isFinite(objective?.upper)) {
    svg.append('line')
      .attr('class', 'detail-objective-line')
      .attr('x1', margin.left).attr('x2', width - margin.right)
      .attr('y1', y(objective.upper)).attr('y2', y(objective.upper));
  }

  svg.append('g')
    .attr('class', 'detail-grid')
    .attr('transform', `translate(${margin.left},0)`)
    .call(d3.axisLeft(y).ticks(4).tickSize(-(width - margin.left - margin.right)).tickFormat(''));
  svg.append('g')
    .attr('class', 'detail-axis')
    .attr('transform', `translate(0,${height - margin.bottom})`)
    .call(d3.axisBottom(x).ticks(timeAxisInterval(state.rangeStart, state.rangeEnd, width < 310 ? 3 : 5)).tickFormat(timeAxisFormat(state.rangeStart, state.rangeEnd)));
  svg.append('g')
    .attr('class', 'detail-axis')
    .attr('transform', `translate(${margin.left},0)`)
    .call(d3.axisLeft(y).ticks(4));
  svg.append('text')
    .attr('class', 'axis-title')
    .attr('data-axis', 'x')
    .attr('x', (margin.left + width - margin.right) / 2)
    .attr('y', height - 8)
    .attr('text-anchor', 'middle')
    .text(`Date · ${state.selectedResolution}`);
  svg.append('text')
    .attr('class', 'axis-title')
    .attr('data-axis', 'y')
    .attr('transform', 'rotate(-90)')
    .attr('x', -(margin.top + height - margin.bottom) / 2)
    .attr('y', 13)
    .attr('text-anchor', 'middle')
    .text(`${parameter.short_label} (${parameter.unit})`);

  if (daily.length) {
    svg.append('path').datum(daily).attr('class', 'detail-daily-range').attr('d', d3.area()
      .defined((row) => Number.isFinite(row.min) && Number.isFinite(row.max))
      .x((row) => x(row.dateValue)).y0((row) => y(row.min)).y1((row) => y(row.max)));
    svg.append('path').datum(daily).attr('class', 'detail-daily-line').attr('d', d3.line()
      .x((row) => x(row.dateValue)).y((row) => y(row.value)));
    svg.append('g').selectAll('circle')
      .data(daily).join('circle')
      .attr('class', (row) => `detail-point daily ${row.ers_point_status}`)
      .attr('cx', (row) => x(row.dateValue)).attr('cy', (row) => y(row.value)).attr('r', 2.2);
  }
  svg.append('g').selectAll('circle')
    .data(spot).join('circle')
    .attr('class', (row) => `detail-point spot ${row.ers_point_status}`)
    .attr('cx', (row) => x(row.datetimeValue)).attr('cy', (row) => y(row.value)).attr('r', 3.4);

  const guide = svg.append('line').attr('class', 'detail-hover-guide').attr('y1', margin.top).attr('y2', height - margin.bottom).style('display', 'none');
  const marker = svg.append('circle').attr('class', 'detail-hover-marker').attr('r', 4.5).style('display', 'none');
  const tooltip = d3.select(container).append('div').attr('class', 'detail-chart-tooltip').attr('role', 'tooltip');
  const bisector = d3.bisector((row) => row.date).center;
  svg.append('rect')
    .attr('class', 'detail-hit-area')
    .attr('x', margin.left).attr('y', margin.top)
    .attr('width', width - margin.left - margin.right)
    .attr('height', height - margin.top - margin.bottom)
    .on('pointermove', (event) => {
      const [pointerX] = d3.pointer(event);
      const index = bisector(observations, x.invert(pointerX));
      const observation = observations[Math.max(0, Math.min(observations.length - 1, index))];
      const cx = x(observation.date);
      const cy = y(observation.value);
      guide.attr('x1', cx).attr('x2', cx).style('display', null);
      marker.attr('cx', cx).attr('cy', cy).attr('class', `detail-hover-marker ${observation.ers_point_status}`).style('display', null);
      tooltip.html(detailPointHtml(observation, parameter))
        .style('left', `${Math.min(Math.max(cx + 8, 8), width - 190)}px`)
        .style('top', `${Math.max(8, cy - 88)}px`)
        .classed('visible', true);
    })
    .on('pointerleave', () => {
      guide.style('display', 'none');
      marker.style('display', 'none');
      tooltip.classed('visible', false);
    });
}

function updateDetail(data) {
  if (state.compareMode) {
    document.querySelector('.detail-panel').hidden = false;
    document.querySelector('.analysis-workspace').classList.remove('no-detail');
    drawComparison({data,state,colours:PARAMETER_COLOURS,
      axisDomain:parameterAxisDomain(data, data.allTemporal(), state.selectedParameter),
      onRemove:id=>{state.comparedSites.delete(id);updateLinkedViews(data);}});
    return;
  }
  const site = getFocusSite(data);
  const parameter = getParameter(data, state.selectedParameter);
  const detail = document.querySelector('#site-detail');
  const workspace = document.querySelector('.analysis-workspace');
  const closed = !site;
  if (workspace.classList.contains('no-detail') !== closed) {
    workspace.classList.toggle('no-detail', closed);
    requestAnimationFrame(() => { data.map?.map.resize(); data.grid?.resize(); });
  }
  document.querySelector('.detail-panel').hidden = closed;
  if (!site) {
    detail.innerHTML = `
      <div class="empty-detail">
        <span class="detail-marker"></span>
        <h3>No site selected</h3>
        <p>Click a site to inspect its ${parameter.label.toLowerCase()} observations.</p>
      </div>`;
    return;
  }
  if (viewMode === 'multi' && state.detailMode !== 'plot') {
    const boundaryNote = site.insideBoundary ? '' : ' · Outside displayed basin polygon';
    detail.innerHTML = `
      <h3>${site.short_name}</h3>
      <p class="detail-coordinate">Site ${site.site_id} · ${site.ers_segment}${boundaryNote}</p>
      <div class="detail-plot-heading"><strong>Temporal threshold states</strong><span>${displayDateFormat(state.rangeStart)}–${displayDateFormat(state.rangeEnd)} · ${state.selectedResolution}</span></div>
      <div class="multi-detail-overview"></div>
      <p class="multi-state-legend"><span><i class="exceeds"></i>Exceeds</span><span><i class="data-colour"></i>Does not exceed</span><span><i class="missing"></i>No data / no objective</span></p>
      <p class="detail-action-hint">Time runs from bottom to top. Click a parameter to inspect its values. These states screen the selected-resolution data, not annual ERS status.</p>`;
    data.grid?.renderOverview(detail.querySelector('.multi-detail-overview'), site);
    return;
  }
  const siteRecord = data.availability.sites[site.site_id];
  const record = siteRecord?.parameters?.[state.selectedParameter];
  const assessment = latestAnnualAssessment(data, site.site_id, state.selectedParameter);
  const hasObjectiveRange = Number.isFinite(assessment?.objective?.lower) && Number.isFinite(assessment?.objective?.upper);
  const status = assessment?.status || 'unavailable';
  const showPlot = state.detailMode === 'plot';
  const rawObservations = showPlot ? data.spot.filter((row) => row.site_id === site.site_id && row.parameter_code === parameter.code && Number.isFinite(row.value) && dateInSelectedRange(row.datetimeValue)) : [];
  const boundaryNote = site.insideBoundary ? '' : ' · Outside displayed basin polygon';
  detail.innerHTML = `
    <div class="detail-status"><span class="condition-pill ${status}">${formatAnnualStatus(status)}</span><span>Site ${site.site_id}</span></div>
    <h3>${site.short_name}</h3>
    <p class="detail-coordinate">${site.ers_segment} · ${site.latitude.toFixed(4)}°, ${site.longitude.toFixed(4)}°${boundaryNote}</p>
    <div class="detail-reading">
      <span>${parameter.label}</span>
      <strong>${record ? formatValue(record.summary_value) : 'No data'} <small>${record?.unit || parameter.unit}</small></strong>
      <em>${record ? `Median of ${record.summary_source}` : 'Not measured in this extract'}</em>
    </div>
    ${record ? `<dl class="availability-list">
      <div><dt>ERS objective</dt><dd>${formatObjective(parameter, assessment.objective)}</dd></div>
      <div><dt>${assessment.year ? `${assessment.year} annual ERS statistic` : 'Annual ERS statistic'}</dt><dd>${assessmentText(parameter, assessment)}</dd></div>
      <div><dt>Spot samples</dt><dd>${record.spot_count.toLocaleString()}</dd></div>
    </dl>` : ''}
    ${showPlot ? `<section class="detail-plot-section">
      <div class="detail-plot-heading"><strong>Temporal detail</strong><span>${displayDateFormat(state.rangeStart)}–${displayDateFormat(state.rangeEnd)} · hover to inspect</span></div>
      <div id="detail-chart"></div>
      <div class="detail-chart-key"><span><i class="spot"></i>${resolutionLabel(state.selectedResolution)} spot mean</span><span><i class="objective${hasObjectiveRange ? ' range' : ''}"></i>ERS ${hasObjectiveRange ? 'objective range' : 'upper objective'}</span></div>
      <details class="raw-observation-dates"><summary>Original observation dates (${rawObservations.length})</summary><ol>${rawObservations.sort((a, b) => a.datetimeValue - b.datetimeValue).map((row) => `<li>${d3.timeFormat('%d %b %Y · %H:%M')(row.datetimeValue)} · ${formatValue(row.value)} ${parameter.unit}</li>`).join('')}</ol></details>
    </section>` : '<p class="detail-action-hint">Click a matrix plot to open its detailed temporal inspection here.</p>'}
  `;
  if (viewMode === 'multi' && showPlot) {
    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'multi-overview-back';
    back.textContent = '← Back to all parameters';
    back.setAttribute('aria-label', 'Back to all parameter threshold states');
    back.onclick = () => { state.detailMode = 'site'; updateLinkedViews(data); };
    detail.prepend(back);
  }
  if (isGrid && showPlot) detail.querySelector('.detail-coordinate').after(detail.querySelector('.detail-plot-section'));
  if (showPlot) requestAnimationFrame(() => drawDetailChart(data, site, parameter, record ? { ...record, ers_assessment: assessment } : record));
}

function updateLinkedViews(data, { detail = true } = {}) {
  const parameter = state.selectedParameter;
  const currentParameter = getParameter(data, parameter);
  document.querySelector('#compact-parameter').textContent = viewMode === 'multi' ? `${state.selectedParameters.size} parameters · Grid` : `${currentParameter.short_label} · ${currentParameter.unit}`;
  const compare = document.querySelector('.compare-sites'); compare.textContent = `Compare sites · ${state.comparedSites.size}/5`; compare.setAttribute('aria-pressed', String(state.compareMode));
  const watercourseSelect = document.querySelector('.watercourse-select');
  if (watercourseSelect) {
    watercourseSelect.textContent = state.relatedSelectionMode ? 'Related sites · Click a site' : 'Related sites · Off';
    watercourseSelect.setAttribute('aria-pressed', String(state.relatedSelectionMode));
  }
  document.querySelectorAll('[data-map-display]').forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.mapDisplay === state.mapDisplayMode));
  });
  app.style.setProperty('--current-parameter', PARAMETER_COLOURS[parameter]);
  d3.selectAll('.parameter-button').attr('aria-pressed', (item) => viewMode === 'multi' ? state.selectedParameters.has(item.code) : item.code === parameter);
  d3.selectAll('.column-heading').classed('selected-parameter', (item) => item.code === parameter);
  d3.selectAll('.chart-cell').classed('selected-parameter', function selectedColumn() {
    return this.dataset.parameter === parameter;
  }).classed('selected-cell', function selectedCell(item) {
    return !state.compareMode && state.detailMode === 'plot'
      && item?.site?.site_id === state.selectedSite
      && item?.parameter?.code === parameter;
  });
  data.map?.markerEntries.forEach(({ element, site }) => {
    element.hidden = state.mapDisplayMode === 'temporal' || !state.selectedSites.has(site.site_id);
    const group = d3.select(element);
    const assessment = latestAnnualAssessment(data, site.site_id, parameter);
    const status = !isGrid && state.mapTimeMode === 'period'
      ? data.mapTimeline?.status(site.site_id) || 'unavailable' : assessment.status;
    const compareColour = comparisonColour(state, site.site_id);
    element.style.setProperty('--comparison-colour', compareColour || 'transparent');
    group
      .classed('hovered', site.site_id === state.hoveredSite)
      .classed('selected', !state.compareMode && site.site_id === state.selectedSite)
      .classed('compared', Boolean(compareColour))
      .classed('unavailable', status === 'unavailable')
      .classed('outside', status === 'outside')
      .classed('within', status === 'within');
    group.select('.site-dot')
      .attr('fill', compareColour || STATUS_COLOURS[status]);
  });
  data.matrix?.rows
    .classed('hovered', (site) => site.site_id === state.hoveredSite)
    .classed('selected', (site) => !state.compareMode && site.site_id === state.selectedSite)
    .classed('compared', (site) => state.compareMode && state.comparedSites.has(site.site_id))
    .style('--comparison-colour', (site) => comparisonColour(state, site.site_id) || 'transparent')
    .style('display', (site) => state.compareMode && !state.comparedSites.has(site.site_id) ? 'none' : null);
  const comparisonEmpty = document.querySelector('.comparison-matrix-empty');
  if (comparisonEmpty) comparisonEmpty.hidden = !(state.compareMode && state.comparedSites.size === 0);
  data.temporalMap?.update();
  data.grid?.update();
  if (!isGrid) {
    const info = document.querySelector('.ers-legend-group .ers-info');
    if (info) info.hidden = state.mapTimeMode === 'period';
  }
  if (isGrid) {
    document.querySelector('.ers-legend-group').hidden = true;
    const legend = document.querySelector('.temporal-map-legend');
    legend.hidden = viewMode === 'multi';
    if (viewMode === 'grid') legend.innerHTML = 'Shared value and time scales · aggregated spot observations <span class="temporal-point-key"><i class="within"></i>Does not exceed</span><span class="temporal-point-key"><i class="outside"></i>Exceeds</span><span class="temporal-point-key"><i class="unavailable"></i>No objective</span>';
  }
  if (detail) updateDetail(data);
}

function setHoveredSite(data, siteId, event = null) {
  state.hoveredSite = siteId;
  updateLinkedViews(data, { detail: false });
  const tooltip = document.querySelector('.map-tooltip');
  if (!siteId) tooltip.classList.remove('visible');
  if (siteId && event?.currentTarget?.classList?.contains('site-marker')) {
    const site = data.sites.find((item) => item.site_id === siteId);
    positionTooltip(data, site, event);
  }
}

function focusMapOnSite(data, siteId) {
  if (data.grid) { requestAnimationFrame(() => data.grid.focus(siteId)); return; }
  const site = data.sites.find((item) => item.site_id === siteId);
  if (!site || !Number.isFinite(site.longitude) || !Number.isFinite(site.latitude)) return;
  // Wait for the detail panel to resize the map before centring the selection.
  requestAnimationFrame(() => {
    if (state.selectedSite !== siteId) return;
    const map = data.map.map;
    map.resize();
    map.easeTo({
      center: [site.longitude, site.latitude],
      zoom: Math.max(map.getZoom(), 10),
      duration: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 650,
    });
  });
}

function scrollMatrixToSite(siteId) {
  if (!siteId || state.matrixCollapsed) return;
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const scroller = document.querySelector('.matrix-scroll');
    const row = document.querySelector(`.matrix-row[data-site-id="${siteId}"]`);
    if (!scroller || !row || scroller.hidden) return;
    const scrollerRect = scroller.getBoundingClientRect();
    const rowRect = row.getBoundingClientRect();
    const top = Math.max(0, scroller.scrollTop
      + rowRect.top - scrollerRect.top
      - (scroller.clientHeight - rowRect.height) / 2);
    scroller.setAttribute('aria-activedescendant', row.id);
    // Keep navigation local to the lower panel. Native smooth scrolling can
    // promote an ancestor page scroll in Safari when the selected row is far
    // away, so update this dedicated scroller directly.
    scroller.scrollTop = top;
  }));
}

function toggleComparedSite(data, id) {
  if (state.comparedSites.has(id)) {
    state.comparedSites.delete(id);
    if (state.selectedSite === id) state.selectedSite = null;
  }
  else if (state.comparedSites.size < 5) {
    let slot=0;
    while ([...state.comparedSites.values()].includes(slot)) slot++;
    state.comparedSites.set(id,slot);
    state.selectedSite = id;
  }
  else { document.querySelector('.compare-sites').textContent = 'Maximum 5 sites — remove one first'; return; }
  updateLinkedViews(data);
  scrollMatrixToSite(id);
}

function selectRelatedSites(data, siteId) {
  const matches = relatedSites(data.sites, siteId, 5);
  if (!matches.length) return;
  state.selectedSites = new Set(matches.map((site) => site.site_id));
  state.comparedSites = new Map(matches.map((site, index) => [site.site_id, index]));
  state.selectedSite = siteId;
  state.detailMode = 'site';
  state.compareMode = true;
  data.syncSiteFilter?.();
  focusMapOnSite(data, siteId);
  scrollMatrixToSite(siteId);
}

function selectLinkedTarget(data, {
  siteId,
  parameterCode = null,
  event = null,
  allowRelated = false,
}) {
  event?.preventDefault();
  if (allowRelated && state.relatedSelectionMode) {
    selectRelatedSites(data, siteId);
    return;
  }
  if (state.compareMode) { toggleComparedSite(data, siteId); return; }
  const detailMode = parameterCode ? 'plot' : 'site';
  const togglingOff = viewMode !== 'multi'
    && state.selectedSite === siteId
    && state.detailMode === detailMode
    && (!parameterCode || state.selectedParameter === parameterCode);
  state.selectedSite = togglingOff ? null : siteId;
  if (parameterCode) {
    state.selectedParameter = parameterCode;
    if (viewMode === 'multi') state.selectedParameters.add(parameterCode);
  }
  state.detailMode = detailMode;
  updateLinkedViews(data);
  document.querySelector('.detail-panel').scrollTop = 0;
  if (state.selectedSite) {
    focusMapOnSite(data, state.selectedSite);
    scrollMatrixToSite(siteId);
  }
}

function positionTooltip(data, site, event) {
  if (!site || !event) return;
  const tooltip = document.querySelector('.map-tooltip');
  const mapStage = document.querySelector('.map-stage');
  const bounds = mapStage.getBoundingClientRect();
  const latest = (data.temporalView?.latestByCell || data.latestByCell).get(cellKey(site.site_id, state.selectedParameter));
  const parameter = getParameter(data, state.selectedParameter);
  const assessment = latestAnnualAssessment(data, site.site_id, state.selectedParameter);
  const previewFrame = !isGrid && state.mapTimeMode === 'period' ? data.mapTimeline?.frame() : null;
  const previewRows = previewFrame ? data.spot.filter((row) => row.site_id === site.site_id && row.parameter_code === state.selectedParameter && row.datetimeValue >= previewFrame.start && row.datetimeValue <= previewFrame.end && Number.isFinite(row.value)) : [];
  const status = previewFrame ? data.mapTimeline.status(site.site_id) : assessment.status;
  const displayedValue = previewFrame ? d3.mean(previewRows, (row) => row.value) : latest?.value;
  tooltip.innerHTML = `
    <strong>${site.short_name}</strong>
    <span>${parameter.short_label}: ${Number.isFinite(displayedValue) ? `${formatValue(displayedValue)} ${parameter.unit}` : 'No data'}</span>
    <time>${previewFrame ? `${previewFrame.label} mean · ${previewRows.length} observation${previewRows.length === 1 ? '' : 's'}` : latest ? formatObservationTime(latest) : 'No observation timestamp'}</time>
    <span>${site.ers_segment}${site.insideBoundary ? '' : ' · Outside displayed basin polygon'}</span>
    <em class="${status}">${previewFrame ? status === 'unavailable' ? 'No data / objective' : status === 'outside' ? 'Period mean exceeds objective' : 'Period mean does not exceed' : assessment.year ? `${assessment.year} · ${formatAnnualStatus(status)}` : formatAnnualStatus(status)}</em>`;
  const x = Math.min(event.clientX - bounds.left + 14, bounds.width - 210);
  const y = Math.max(event.clientY - bounds.top - 16, 16);
  tooltip.style.transform = `translate(${x}px, ${y}px)`;
  tooltip.classList.add('visible');
}

async function init() {
  try {
    const data = await loadData();
    state.selectedSites = new Set(data.sites.filter((site) => site.hasData).map((site) => site.site_id));
    data.temporalView = buildTemporalView(data);
    renderShell(data);
    const workspace = document.querySelector('.analysis-workspace');
    const fitWorkspace = () => {
      const top = workspace.getBoundingClientRect().top + window.scrollY;
      const footer = document.querySelector('footer');
      const available = window.innerHeight - top - (footer?.offsetHeight || 0);
      app.style.setProperty('--workspace-fit-height', `${Math.max(200, available)}px`);
    };
    const chromeObserver = new ResizeObserver(fitWorkspace);
    for (const element of app.children) {
      if (element !== workspace) chromeObserver.observe(element);
    }
    window.addEventListener('resize', fitWorkspace);
    fitWorkspace();
    if (!isGrid) createMap(data);
    let allSitesViewKey = null;
    let allSitesView = null;
    const allTemporal = () => {
      const key = `${state.selectedResolution}|${+state.rangeStart}|${+state.rangeEnd}`;
      if (key !== allSitesViewKey) { allSitesView = buildTemporalView(data, true); allSitesViewKey = key; }
      return allSitesView;
    };
    data.allTemporal = allTemporal;
    if (isGrid) data.grid = createSpatialGrid({
      data,
      state,
      colours: PARAMETER_COLOURS,
      multi: viewMode === 'multi',
      allTemporal,
      onHover: (id) => setHoveredSite(data, id),
      onSelect: (siteId, parameterCode, event) => selectLinkedTarget(data, { siteId, parameterCode, event }),
      onSortChange: () => { document.querySelector('#site-sort').value=state.siteSort; createMatrix(data); updateLinkedViews(data,{detail:false}); },
    });
    else data.temporalMap = createTemporalMap({
      data, state, colours: PARAMETER_COLOURS,
      temporalView: () => {
        const key = `${state.selectedResolution}|${+state.rangeStart}|${+state.rangeEnd}`;
        if (key !== allSitesViewKey) { allSitesView = buildTemporalView(data, true); allSitesViewKey = key; }
        return allSitesView;
      },
      onHover: (siteId) => setHoveredSite(data, siteId),
      onSelect: (siteId, event) => selectLinkedTarget(data, {
        siteId,
        parameterCode: state.selectedParameter,
        event,
        allowRelated: true,
      }),
    });
    createMatrix(data);
    updateTemporalSummary(data);
    updateLinkedViews(data);
    setupGuidance(viewMode);
  } catch (error) {
    console.error(error);
    app.innerHTML = `
      <section class="error-state">
        <p class="eyebrow">Data loading problem</p>
        <h1>The prototype could not start.</h1>
        <p>${error.message}</p>
        <p>Run the preprocessing script, then reload this page.</p>
      </section>`;
  }
}

init();
