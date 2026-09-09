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
