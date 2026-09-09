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
