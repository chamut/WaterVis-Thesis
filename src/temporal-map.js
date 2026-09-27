import * as d3 from 'd3';
import { sharedDomain, sensorSegments, pixelSample, placeCards } from './temporal-map-model.js';
import './temporal-map.css';

const WIDTH = 150;
const HEIGHT = 96;
const PLOT_HEIGHT = 72;
const margin = { left: 36, right: 7, top: 5, bottom: 16 };
const dateLabel = d3.timeFormat('%b %Y');
const numberLabel = d3.format('.3~g');

export function createTemporalMap({ data, state, colours, temporalView, onHover, onSelect }) {
  const map = data.map.map;
  const container = map.getContainer();
  const layer = document.createElement('div');
  layer.className = 'temporal-map-layer';
  layer.hidden = true;
  const leaders = d3.select(layer).append('svg').attr('class', 'temporal-map-leaders').attr('aria-hidden', 'true');
  const cards = document.createElement('div');
  cards.className = 'temporal-map-cards';
  layer.append(cards);
  container.append(layer);
  const entries = new Map();
  for (const site of data.sites.filter((item) => item.hasData)) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'temporal-map-card';
    button.dataset.siteId = site.site_id;
    button.hidden = true;
    button.addEventListener('pointerenter', () => onHover(site.site_id));
    button.addEventListener('pointerleave', () => onHover(null));
    button.addEventListener('focus', () => onHover(site.site_id));
    button.addEventListener('blur', () => onHover(null));
    button.addEventListener('click', (event) => { event.stopPropagation(); onSelect(site.site_id, event); });
    // Cards are native buttons; Enter/Space produce one click. Background remains draggable.
    for (const name of ['pointerdown', 'mousedown', 'touchstart', 'dblclick']) button.addEventListener(name, (event) => event.stopPropagation());
    cards.append(button);
    entries.set(site.site_id, { site, button });
  }

  let chartKey = null;
  let placementKey = null;
  let frame = null;
  function scheduleLayout() {
    if (frame !== null || state.mapDisplayMode !== 'temporal') return;
    frame = requestAnimationFrame(() => { frame = null; layout(); });
  }
  function layout() {
    if (state.mapDisplayMode !== 'temporal') return;
    const width = container.clientWidth;
    const height = container.clientHeight;
    leaders.attr('viewBox', `0 0 ${width} ${height}`).attr('width', width).attr('height', height);
    const points = [...entries.values()].filter(({ site }) => state.selectedSites.has(site.site_id))
      .map(({ site }) => { const point = map.project([site.longitude, site.latitude]); return { id: site.site_id, x: point.x, y: point.y }; });
    const positions = placeCards(points, width, height, state.selectedSite, WIDTH, HEIGHT);
    const visible = new Set(positions.map((item) => item.id));
    for (const [id, { button }] of entries) button.hidden = !visible.has(id);
    for (const position of positions) {
      const button = entries.get(position.id).button;
      button.style.left = `${position.x}px`;
      button.style.top = `${position.y}px`;
    }
    const groups = leaders.selectAll('g').data(positions, (item) => item.id).join('g').attr('data-site-id', (item) => item.id);
    groups.selectAll('line').data((item) => [item]).join('line')
      .attr('x1', (item) => item.anchorX).attr('y1', (item) => item.anchorY)
      .attr('x2', (item) => Math.max(item.x, Math.min(item.anchorX, item.x + item.width)))
      .attr('y2', (item) => Math.max(item.y, Math.min(item.anchorY, item.y + item.height)));
    groups.selectAll('circle').data((item) => [item]).join('circle').attr('cx', (item) => item.anchorX).attr('cy', (item) => item.anchorY).attr('r', 3);
    highlight();
  }
  function highlight() {
    for (const [id, { button }] of entries) {
      const selected = id === state.selectedSite;
      const hovered = id === state.hoveredSite;
      button.classList.toggle('selected', selected);
      button.classList.toggle('hovered', hovered);
      button.setAttribute('aria-pressed', String(selected));
      button.style.zIndex = hovered ? '4' : selected ? '3' : '1';
    }
    leaders.selectAll('g').classed('highlighted', (item) => item.id === state.hoveredSite || item.id === state.selectedSite);
  }

  function drawCharts() {
    const view = temporalView(); // All target sites: domain never depends on the site filter.
    const code = state.selectedParameter;
    const parameter = data.availability.parameters.find((item) => item.code === code);
    const continuous = view.continuous.filter((row) => row.parameter_code === code);
    const spot = view.spot.filter((row) => row.parameter_code === code);
    const objectives = data.sites.filter((site) => site.hasData).map((site) => data.availability.ers.thresholds[site.ers_segment]?.[code]);
    const domain = sharedDomain(continuous, spot, objectives);
    const x = d3.scaleTime().domain([state.rangeStart, state.rangeEnd]).range([margin.left + 3, WIDTH - margin.right - 3]);
    const y = d3.scaleLinear().domain(domain).range([PLOT_HEIGHT - margin.bottom - 3, margin.top + 3]);
    const sensorBySite = d3.group(continuous, (row) => row.site_id);
    const spotBySite = d3.group(spot, (row) => row.site_id);
    for (const { site, button } of entries.values()) {
      button.replaceChildren();
      button.style.setProperty('--map-chart-colour', colours[code]);
      button.dataset.yDomain = domain.join(',');
      button.dataset.parameter = code;
      const heading = document.createElement('span');
      heading.className = 'temporal-map-card-title';
      heading.textContent = site.short_name;
      button.append(heading);
      const rows = sensorBySite.get(site.site_id) || [];
      const observations = (spotBySite.get(site.site_id) || []).filter((row) => Number.isFinite(row.value));
      const segments = sensorSegments(rows, state.selectedResolution).map((segment) => pixelSample(segment, x));
      const samples = segments.flat();
      button.setAttribute('aria-label', `${site.short_name} · ${parameter.label} (${parameter.unit}) · ${dateLabel(state.rangeStart)}–${dateLabel(state.rangeEnd)} · ${state.selectedResolution} · ${samples.length || observations.length ? 'Open temporal detail' : 'No data in selected period'}`);
      if (!samples.length && !observations.length) {
        const empty = document.createElement('span');
        empty.className = 'temporal-map-empty';
        empty.textContent = 'No data in selected period';
        button.append(empty);
        continue;
      }
      const svg = d3.select(button).append('svg').attr('viewBox', `0 0 ${WIDTH} ${PLOT_HEIGHT}`).attr('width', WIDTH).attr('height', PLOT_HEIGHT).attr('aria-hidden', 'true');
      const clipId = `map-chart-clip-${site.site_id}`;
      svg.append('defs').append('clipPath').attr('id', clipId).append('rect').attr('x', margin.left).attr('y', margin.top).attr('width', WIDTH - margin.left - margin.right).attr('height', PLOT_HEIGHT - margin.top - margin.bottom);
      svg.append('g').attr('class', 'map-chart-y').attr('transform', `translate(${margin.left},0)`).call(d3.axisLeft(y).tickValues(domain).tickFormat(numberLabel).tickSize(0).tickPadding(3));
      svg.select('.map-chart-y .domain').remove();
      svg.append('line').attr('class', 'map-chart-baseline').attr('x1', margin.left).attr('x2', WIDTH - margin.right).attr('y1', y(domain[0])).attr('y2', y(domain[0]));
      [state.rangeStart, state.rangeEnd].forEach((date, index) => svg.append('text').attr('class', 'map-chart-date').attr('x', x(date)).attr('y', PLOT_HEIGHT - 3).attr('text-anchor', index ? 'end' : 'start').text(dateLabel(date)));
      const plot = svg.append('g').attr('clip-path', `url(#${clipId})`);
      const objective = data.availability.ers.thresholds[site.ers_segment]?.[code];
      [objective?.lower, objective?.upper].filter(Number.isFinite).forEach((value) => plot.append('line').attr('class', 'map-chart-objective').attr('x1', margin.left).attr('x2', WIDTH - margin.right).attr('y1', y(value)).attr('y2', y(value)));
      for (const segment of segments) {
        plot.append('path').datum(segment).attr('class', 'map-chart-range').attr('d', d3.area().defined((row) => Number.isFinite(row.min) && Number.isFinite(row.max)).x((row) => x(row.dateValue)).y0((row) => y(row.min)).y1((row) => y(row.max)));
        plot.append('path').datum(segment).attr('class', 'map-chart-sensor').attr('d', d3.line().x((row) => x(row.dateValue)).y((row) => y(row.value)));
        if (segment.length === 1) plot.append('circle').attr('class', 'map-chart-sample').attr('cx', x(segment[0].dateValue)).attr('cy', y(segment[0].value)).attr('r', 2);
      }
      plot.selectAll('.map-chart-spot').data(observations).join('circle').attr('class', 'map-chart-spot').attr('cx', (row) => x(row.datetimeValue)).attr('cy', (row) => y(row.value)).attr('r', 2);
    }
    document.querySelector('.temporal-map-legend').textContent = `${parameter.short_label} · ${parameter.unit} · shared scale · points: aggregated spot observations · dashed: ERS reference`;
  }

  function update() {
    const active = state.mapDisplayMode === 'temporal';
    layer.hidden = !active;
    document.querySelector('.temporal-map-legend').hidden = !active;
    document.querySelector('.ers-legend-group').hidden = active;
    document.querySelector('.map-key').hidden = active;
    for (const button of document.querySelectorAll('[data-map-display]')) button.setAttribute('aria-pressed', String(button.dataset.mapDisplay === state.mapDisplayMode));
    if (!active) return;
    const key = `${state.selectedParameter}|${state.selectedResolution}|${+state.rangeStart}|${+state.rangeEnd}`;
    if (chartKey !== key) { drawCharts(); chartKey = key; }
    const nextPlacement = `${[...state.selectedSites].sort().join(',')}|${state.selectedSite}`;
    if (placementKey !== nextPlacement || !placementKey) { placementKey = nextPlacement; scheduleLayout(); }
    highlight();
  }
  for (const event of ['move', 'resize']) map.on(event, scheduleLayout);
  const observer = new ResizeObserver(scheduleLayout);
  observer.observe(container);
  return { update, scheduleLayout };
}
