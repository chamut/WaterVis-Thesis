// Shared camera geometry for both schematic grids. Map dots stay geographic.
export const SKETCH_SITES = [
 // Preserve the approved positions for the 20 sites shared with the earlier
 // dataset. Only the four new sites use provisional empty slots.
 ['405297',295,327],['405232',463,401],['405720',575,403],
 ['405779',791,327],['405758',903,327],['405276',722,454],
 ['405204',908,575],['405270',798,630],['405730',781,710],
 ['405200',681,803],['405234',1154,980],['405240',550,1190],
 ['405212',550,1270],['405201',720,1220],['405214',1220,1260],
 ['405203',1050,1370],['405219',1340,1480],['405209',870,1450],
 ['405205',730,1550],['405264',1220,1590],
 // New in the 24-site, 2015–2024 extract; revisit these four placements.
 ['405246',900,810],['405237',1050,840],['405251',1320,1080],['405231',650,1410],
];
export const GRID_POSITIONS = new Map(SKETCH_SITES.map(([id,x,y]) => [id, [(x-8)*2.4,(y-187)*2.4]]));
export const WORLD = { width:3264, height:3800 };
export function zoomAt(camera, next, x, y) {
 const zoom=Math.max(.08,Math.min(3,next));
 return {zoom,x:x-(x-camera.x)/camera.zoom*zoom,y:y-(y-camera.y)/camera.zoom*zoom};
}
export function viewportWorld(camera,width,height) {
 return {x:-camera.x/camera.zoom,y:-camera.y/camera.zoom,width:width/camera.zoom,height:height/camera.zoom};
}
export function fitCamera(width,height) {
 const zoom=Math.max(.08,Math.min(1,(width-30)/WORLD.width,(height-30)/WORLD.height));
 return {zoom,x:(width-WORLD.width*zoom)/2,y:(height-WORLD.height*zoom)/2};
}
export function referenceDeviation(value,objective) {
 if(!Number.isFinite(value)||!objective)return null;
 if(Number.isFinite(objective.lower)&&value<objective.lower)return (objective.lower-value)/Math.max(Math.abs(objective.lower),1e-12)*100;
 if(Number.isFinite(objective.upper)&&value>objective.upper)return (value-objective.upper)/Math.max(Math.abs(objective.upper),1e-12)*100;
 return Number.isFinite(objective.lower)||Number.isFinite(objective.upper)?0:null;
}
