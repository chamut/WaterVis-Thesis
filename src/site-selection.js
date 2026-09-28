export function watercourseName(siteName = '') {
  return siteName.split('@')[0].trim().replace(/\s+/g, ' ').toUpperCase();
}

function distanceSquared(a, b) {
  const latitudeScale = Math.cos((((a.latitude + b.latitude) / 2) * Math.PI) / 180);
  const dx = (a.longitude - b.longitude) * latitudeScale;
  const dy = a.latitude - b.latitude;
  return dx * dx + dy * dy;
}

export function relatedSites(sites, selectedId, limit = 5) {
  const selected = sites.find((site) => site.site_id === selectedId);
  if (!selected) return [];
  const watercourse = watercourseName(selected.name);
  const available = sites.filter((site) => site.hasData);
  const byDistance = (a, b) => distanceSquared(a, selected) - distanceSquared(b, selected) || a.site_id.localeCompare(b.site_id);
  const sameWatercourse = available
    .filter((site) => watercourseName(site.name) === watercourse)
    .sort(byDistance);
  const selectedIds = new Set(sameWatercourse.map((site) => site.site_id));
  const nearestFallback = available
    .filter((site) => !selectedIds.has(site.site_id))
    .sort(byDistance);
  return [...sameWatercourse, ...nearestFallback].slice(0, limit);
}
