# Goulburn Water Quality Explorer

A local thesis prototype built with vanilla Vite, D3.js, HTML, CSS, and JavaScript.

## Data flow

The original downloads in `../Data/goulburn 2024/` are read-only inputs. Run:

```powershell
python scripts/preprocess.py
```

This creates browser-sized files in `public/data/`. The browser never loads the 87 MB raw CSV.

## Local development

```powershell
pnpm install
pnpm run dev
```

The first milestone includes one basin, five parameters, the site map, the small-multiple matrix, and linked hover/selection. It intentionally does not implement animation, glyph maps, or a final ERS/WQI score.


## Temporal charts on the map

Use **Markers / Temporal charts** on the right of the toolbar. The chart mode
shows the selected parameter at each filtered site, using the current date range
and hourly/daily/monthly resolution. All map cards use a shared value scale across
all target sites; filtering sites does not change that scale. Sensor lines break
at missing intervals, and spot observations remain separate points. Empty data
is labelled explicitly.

Cards are displaced by up to 120 pixels to reduce overlap and linked to their
original coordinates. All sites remain charts; crowded cards can overlap. Hover
or keyboard focus raises a card and highlights its matrix row. Clicking opens
temporal detail and focuses the map on the site. Zoom or filter for closer inspection.

Run the data/placement checks with `node --test tests/temporal-map.test.js`.
Multi-parameter concern scores remain deferred; this mode displays original units.

## Three views, one application

Run `npm run dev` and use these paths on the printed local address:

- `/` — geographic map (markers or temporal charts).
- `/previews/spatial-grid-minimap-preview.html` — single-parameter temporal grid, with detail and mini-map at right; no lower matrix.
- `/previews/multiparameter-grid-matrix-preview.html` — multi-parameter grid, with the same sidebar and the lower Sites × Parameters matrix.

All three entry pages import `src/main.js`: time ranges, daily/monthly/hourly data,
site filters, parameter definitions, the detail plot, matrix and site comparison
are shared. The multi-parameter menu keeps at least one parameter selected.
`src/spatial-grid.js` and `src/grid-navigation.js` provide the shared grid layout,
mini-map, camera rectangle, pan/zoom and sidebar resizing. Edit these source files;
the HTML entry files are not independent snapshots. Vite reloads all open views.

The grid site positions retain the earlier hand-positioned schematic. Mini-map
dots always use actual longitude/latitude. Its rectangle is an affine overview of
the schematic camera, not an exact geographic selection polygon. Visible-site
highlighting is calculated from grid positions independently of that rectangle.

Multi-parameter bars now use the **latest observation in the selected period**
from the same measured dataset as the main view (monthly means when selected).
They compare with the site's own upper/lower/range objective. Bars are capped at
160% deviation; labels retain the full value. No data and no objective remain
separate. This point comparison is not the annual ERS percentile assessment.

`npm run build` builds all three pages and their shared assets. Historical copies
in the sibling `Revision` directory are archived; its active HTML files are local
launchers. Optional `python3 scripts/preview-links.py` forwards old port-5186 links
to the application on port 5173. The retired grid-without-matrix link is not served.

Checks: `node --test tests/*.test.js` and `npm run build`.
