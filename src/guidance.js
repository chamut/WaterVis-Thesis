const WELCOME_KEY = 'watervis-welcome-v1';

const VIEWS = {
  main: {
    name: 'Geographic map',
    summary: 'Find sites and inspect their observations.',
    guidance: [
      'Marker colour shows the latest complete selected year’s provisional ERS condition for the chosen parameter. Hover for a value; click a site for detail.',
      'Switch between Markers and Temporal charts. Compare sites selects up to five; Related sites keeps sites on the same named watercourse first, then nearby sites.',
      'The Sites × water-quality parameters panel compares sites and parameters. Click a plot to open detailed temporal axes, then hover the detail chart to inspect observations. Select Show panel if it is minimized.',
    ],
    steps: [
      ['.view-links a[aria-current="page"]', 'Choose a view', 'The three tabs offer a geographic map, a temporal grid, and a five-parameter threshold grid. Hover over a tab for a short description.'],
      ['.time-menu > summary', 'Choose a time period', 'Select months, seasons, or years. Periods without observations remain visible.'],
      ['.site-filter-trigger', 'Choose visible sites', 'Use Sites to choose which monitoring sites appear in this view. Select sites in the list, then choose Done.'],
      ['.parameter-menu > summary', 'Choose a parameter', 'Select the water-quality parameter used to colour site markers and draw temporal charts.'],
      ['.map-display-toggle', 'Change the map display', 'Show sites as condition markers or place small temporal charts at their locations.'],
      ['.site-marker', 'Select a site', 'Click the highlighted map marker to open Detailed inspection, or choose Next to continue.', true],
      ['.compare-sites', 'Compare sites', 'Turn this on, then select up to five sites to see them together in one chart.'],
      ['.watercourse-select', 'Find related sites', 'Turn this on and click a site. Sites on the same named watercourse are chosen first, followed by nearby sites. Flow connectivity is not verified.'],
      ['.matrix-title-row', 'Compare parameters below', 'The lower panel puts sites in rows and water-quality parameters in columns. Use Minimize or Show panel to make room as needed.'],
      ['.chart-cell', 'Open temporal detail', 'Click the highlighted matrix plot to open that site and parameter in Detailed inspection, or choose Finish.', true],
    ],
  },
  grid: {
    name: 'Temporal grid',
    summary: 'Compare one parameter over time across sites.',
    guidance: [
      'Each card shows one site’s observations for the selected parameter on a shared time and value scale. Click a card to open Detailed inspection, then hover its chart for individual observations.',
      'The mini-map keeps real geographic positions. Click a dot to select the same site; pan or zoom the grid to explore the cards.',
      'Compare sites selects up to five sites in one chart.',
    ],
    steps: [
      ['.view-links a[aria-current="page"]', 'Choose a view', 'Switch between the geographic map and two spatial grids. Hover over a tab for its purpose.'],
      ['.time-menu > summary', 'Choose a time period', 'Select months, seasons, or years for all charts; periods without observations remain visible.'],
      ['.site-filter-trigger', 'Choose visible sites', 'Use Sites to choose which monitoring sites appear in the grid and mini-map. Select sites in the list, then choose Done.'],
      ['.parameter-menu > summary', 'Choose a parameter', 'Select the water-quality parameter drawn in every site card.'],
      ['.spatial-navigation', 'Explore the site cards', 'Pan or zoom the grid to explore the site cards.'],
      ['.spatial-card-heading', 'Select a site', 'Click the highlighted site card to open Detailed inspection, or choose Next to continue.', true],
      ['.compare-sites', 'Compare sites', 'Turn this on, then select up to five sites to see them in one chart.'],
      ['.shared-minimap > header', 'Locate a site', 'The mini-map shows real site locations. Click a dot to select its card and open the detail panel.'],
    ],
  },
  multi: {
    name: 'Multi-parameter grid',
    summary: 'Scan threshold patterns for five parameters at each site.',
    guidance: [
      'Each site card shows five threshold-state strips over time. The legend below the controls explains the three states.',
      'Click a site to open all five parameters in Detailed inspection. Choose a parameter there to inspect its temporal chart and individual periods.',
      'Click a mini-map dot to select a site. Click a matrix plot below to open a detailed temporal chart; select Show panel if the matrix is minimized.',
    ],
    steps: [
      ['.view-links a[aria-current="page"]', 'Choose a view', 'Switch between the geographic map and two spatial grids. Hover over a tab for its purpose.'],
      ['.time-menu > summary', 'Choose a time period', 'Select months, seasons, or years for all five parameter strips; periods without observations remain visible.'],
      ['.site-filter-trigger', 'Choose visible sites', 'Use Sites to choose which monitoring sites appear in the grid and mini-map. Select sites in the list, then choose Done.'],
      ['.threshold-legend-bar', 'Read the threshold states', 'Orange means does not exceed, purple means exceeds, and grey means no data or no objective.'],
      ['.spatial-navigation', 'Explore the site cards', 'Pan or zoom the grid to explore five-parameter site cards.'],
      ['.spatial-card-heading', 'Select a site', 'Click the highlighted site card to open its five parameters in Detailed inspection, or choose Next to continue.', true],
      ['.compare-sites', 'Compare sites', 'Turn this on, then select up to five sites to see them in one chart.'],
      ['.shared-minimap > header', 'Locate a site', 'Click a mini-map dot to select the matching site card and open its detail.'],
      ['.matrix-title-row', 'Compare parameters below', 'The lower panel puts sites in rows and water-quality parameters in columns. Use Minimize or Show panel to make room as needed.'],
      ['.chart-cell', 'Open temporal detail', 'Click the highlighted matrix plot to open that site and parameter’s temporal chart in Detailed inspection, or choose Finish.', true],
    ],
  },
};

function hasSeenWelcome() {
  try { return localStorage.getItem(WELCOME_KEY) === 'seen'; }
  catch { return false; }
}

function rememberWelcome() {
  try { localStorage.setItem(WELCOME_KEY, 'seen'); }
  catch { /* Guidance still works if storage is unavailable. */ }
}

export function setupGuidance(viewMode) {
  const view = VIEWS[viewMode] || VIEWS.main;
  const nav = document.querySelector('.view-links');

  const help = document.createElement('div');
  help.className = 'view-help';
  help.innerHTML = `
    <button type="button" class="view-help-trigger" aria-expanded="false" aria-controls="view-help-popover">How to read this view <span class="view-help-icon" aria-hidden="true">i</span></button>
    <section class="view-help-popover" id="view-help-popover" aria-label="How to read ${view.name}" hidden>
      <strong>${view.name}</strong>
      <ul>${view.guidance.map((item) => `<li>${item}</li>`).join('')}</ul>
      <p>Monthly, seasonal, and yearly intervals use means of available spot observations; empty intervals remain missing. ERS screening is provisional. DO saturation is estimated from paired temperature and site elevation.</p>
      <div class="view-help-actions"><button type="button" class="view-help-intro">Show welcome</button><button type="button" class="view-help-tour">Restart quick tour</button></div>
    </section>`;
  nav.append(help);
  const helpTrigger = help.querySelector('.view-help-trigger');
  const helpPopover = help.querySelector('.view-help-popover');
  const closeHelp = () => {
    helpPopover.hidden = true;
    helpTrigger.setAttribute('aria-expanded', 'false');
  };
  helpTrigger.addEventListener('click', () => {
    helpPopover.hidden = !helpPopover.hidden;
    helpTrigger.setAttribute('aria-expanded', String(!helpPopover.hidden));
  });
  document.addEventListener('pointerdown', (event) => {
    if (!help.contains(event.target)) closeHelp();
  });

  let tourIndex = -1;
  let tour = null;
  let tourOrigin = helpTrigger;
  const tourTarget = () => {
    const selector = view.steps[tourIndex]?.[0];
    if (!selector) return null;
    const candidates = [...document.querySelectorAll(selector)];
    const visible = candidates.filter((item) => {
      const rect = item.getBoundingClientRect();
      const clip = item.closest('.matrix-scroll')?.getBoundingClientRect();
      return (!clip || (rect.right > clip.left && rect.left < clip.right && rect.bottom > clip.top && rect.top < clip.bottom))
        && rect.width > 0 && rect.height > 0 && rect.right > 0 && rect.bottom > 0
        && rect.left < window.innerWidth && rect.top < window.innerHeight;
    });
    visible.sort((a, b) => {
      const distance = (item) => {
        const rect = item.getBoundingClientRect();
        return Math.hypot(rect.left + rect.width / 2 - window.innerWidth / 2,
          rect.top + rect.height / 2 - window.innerHeight / 2);
      };
      return distance(a) - distance(b);
    });
    return visible[0] || candidates[0] || null;
  };
  const positionTour = () => {
    if (!tour || tourIndex < 0) return;
    const target = tourTarget();
    if (!target) return;
    const rect = target.getBoundingClientRect();
    const inset = 5;
    const interactive = view.steps[tourIndex][3] === true;
    const width = interactive ? Math.max(32, rect.width + inset * 2) : rect.width + inset * 2;
    const height = interactive ? Math.max(32, rect.height + inset * 2) : rect.height + inset * 2;
    const leftEdge = rect.left + rect.width / 2 - width / 2;
    const topEdge = rect.top + rect.height / 2 - height / 2;
    const highlight = tour.querySelector('.tour-highlight');
    highlight.style.left = `${Math.max(3, leftEdge)}px`;
    highlight.style.top = `${Math.max(3, topEdge)}px`;
    highlight.style.width = `${Math.min(window.innerWidth - 6, width)}px`;
    highlight.style.height = `${Math.min(window.innerHeight - 6, height)}px`;
    highlight.classList.toggle('interactive', interactive);
    highlight.tabIndex = interactive ? 0 : -1;
    highlight.setAttribute('aria-hidden', String(!interactive));
    highlight.setAttribute('aria-label', interactive
      ? (view.steps[tourIndex][1] === 'Open temporal detail' ? 'Open highlighted temporal plot' : 'Select highlighted site')
      : '');
    const card = tour.querySelector('.tour-card');
    const cardRect = card.getBoundingClientRect();
    const left = Math.max(12, Math.min(window.innerWidth - cardRect.width - 12, rect.left));
    const below = rect.bottom + 16;
    const top = below + cardRect.height < window.innerHeight - 12
      ? below
      : Math.max(12, rect.top - cardRect.height - 16);
    card.style.left = `${left}px`;
    card.style.top = `${top}px`;
  };
  const stopTour = () => {
    if (!tour) return;
    tour.remove();
    tour = null;
    tourIndex = -1;
    window.removeEventListener('resize', positionTour);
    window.removeEventListener('scroll', positionTour, true);
    tourOrigin?.focus();
  };
  const showStep = (index) => {
    tourIndex = index;
    const [, title, body] = view.steps[index];
    if (title === 'Open temporal detail' && document.querySelector('.matrix-scroll')?.hidden) {
      document.querySelector('.matrix-toggle')?.click();
    }
    tour.querySelector('.tour-count').textContent = `${index + 1} of ${view.steps.length}`;
    tour.querySelector('.tour-title').textContent = title;
    tour.querySelector('.tour-description').textContent = body;
    tour.querySelector('.tour-back').disabled = index === 0;
    tour.querySelector('.tour-next').textContent = index === view.steps.length - 1 ? 'Finish' : 'Next';
    const target = tourTarget();
    if (target) {
      const rect = target.getBoundingClientRect();
      if (title === 'Open temporal detail' || rect.top < 0 || rect.bottom > window.innerHeight) {
        target.scrollIntoView({ block: title === 'Open temporal detail' ? 'nearest' : 'center', inline: 'nearest' });
      }
    }
    requestAnimationFrame(positionTour);
    tour.querySelector('.tour-next').focus();
  };
  const startTour = (origin = helpTrigger) => {
    closeHelp();
    tourOrigin = origin;
    if (tour) stopTour();
    tour = document.createElement('div');
    tour.className = 'quick-tour';
    tour.innerHTML = `
      <div class="tour-shield" aria-hidden="true"></div>
      <button type="button" class="tour-highlight" aria-hidden="true" tabindex="-1"></button>
      <section class="tour-card" role="dialog" aria-modal="true" aria-labelledby="tour-title" aria-describedby="tour-description">
        <span class="tour-count"></span>
        <h2 class="tour-title" id="tour-title"></h2>
        <p class="tour-description" id="tour-description"></p>
        <div class="tour-actions"><button type="button" class="tour-skip">Skip tour</button><button type="button" class="tour-back">Back</button><button type="button" class="tour-next">Next</button></div>
      </section>`;
    document.body.append(tour);
    tour.querySelector('.tour-highlight').addEventListener('click', () => {
      if (view.steps[tourIndex][3] !== true) return;
      tourTarget()?.click();
      tour.querySelector('.tour-description').textContent = view.steps[tourIndex][1] === 'Open temporal detail'
        ? 'The temporal chart is open in Detailed inspection. Choose Finish to explore it.'
        : 'Site selected. Its observations are open in Detailed inspection. Choose Next to continue.';
    });
    tour.querySelector('.tour-skip').addEventListener('click', stopTour);
    tour.querySelector('.tour-back').addEventListener('click', () => showStep(tourIndex - 1));
    tour.querySelector('.tour-next').addEventListener('click', () => {
      if (tourIndex === view.steps.length - 1) stopTour();
      else showStep(tourIndex + 1);
    });
    window.addEventListener('resize', positionTour);
    window.addEventListener('scroll', positionTour, true);
    showStep(0);
  };
  help.querySelector('.view-help-tour').addEventListener('click', () => startTour(helpTrigger));

  const welcome = document.createElement('dialog');
  welcome.className = 'welcome-dialog';
  welcome.setAttribute('aria-labelledby', 'welcome-title');
  welcome.innerHTML = `
    <p class="welcome-kicker">WaterVis · Prototype</p>
    <h2 id="welcome-title">Welcome to WaterVis</h2>
    <p>WaterVis is a prototype visualisation tool for exploring water-quality data. It uses observations from the Goulburn Basin, 2015–2024, and currently focuses on this one basin.</p>
    <div class="welcome-views" aria-label="Three views">
      ${Object.values(VIEWS).map((item) => `<div><strong>${item.name}</strong><span>${item.summary}</span></div>`).join('')}
    </div>
    <div class="welcome-actions"><button type="button" class="welcome-explore">Explore on my own</button><button type="button" class="welcome-tour">Take a quick tour</button></div>
    <p class="welcome-footnote">You can reopen the tour from “How to read this view”.</p>`;
  document.body.append(welcome);
  help.querySelector('.view-help-intro').addEventListener('click', () => {
    closeHelp();
    welcome.showModal();
  });
  welcome.addEventListener('close', rememberWelcome);
  welcome.querySelector('.welcome-explore').addEventListener('click', () => welcome.close());
  welcome.querySelector('.welcome-tour').addEventListener('click', () => {
    welcome.close();
    startTour(helpTrigger);
  });
  if (!hasSeenWelcome()) welcome.showModal();

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      if (tour) { event.preventDefault(); stopTour(); }
      else if (!helpPopover.hidden) { closeHelp(); helpTrigger.focus(); }
    }
    if (tour && event.key === 'Tab') {
      const buttons = [...tour.querySelectorAll('.tour-highlight.interactive, .tour-card button:not(:disabled)')];
      const next = event.shiftKey ? buttons.at(-1) : buttons[0];
      if (event.shiftKey && document.activeElement === buttons[0]) { event.preventDefault(); next.focus(); }
      if (!event.shiftKey && document.activeElement === buttons.at(-1)) { event.preventDefault(); next.focus(); }
    }
  });
}
