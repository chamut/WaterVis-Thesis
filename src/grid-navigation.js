// Shared camera geometry for both schematic grids. Map dots stay geographic.
//
// Method: the numbered positions are measured from the approved 20-slot sketch.
// Site coordinates were independently affine-normalised to the sketch extent,
// then assigned one-to-one to the slots by minimum-cost point-set matching.
// This adapts the assignment principle from Meulemans et al. (2021); it is not
// their full shape-decomposition and mosaic-cartogram pipeline.
export const SKETCH_SITES = [
 // slot, site id, measured x, measured y (card top-left in the sketch)
 [1,'405297',150,180], [2,'405232',345,200], [3,'405276',510,215],
 [4,'405204',660,280], [5,'405270',600,365], [6,'405246',600,470],
 [7,'405200',470,470], [8,'405237',735,535], [9,'405234',830,615],
 [10,'405240',263,650], [11,'405212',263,720], [12,'405201',425,715],
 [13,'405251',940,680], [14,'405214',1165,720], [15,'405231',570,815],
 [16,'405205',727,890], [17,'405209',885,825], [18,'405203',1030,785],
 [19,'405219',1175,850], [20,'405264',1170,945],
];
const GRID_SCALE = 2.4;
const GRID_PADDING = 30;
const CARD_WIDTH = 240;
const CARD_HEIGHT = 160;
const minSketchX = Math.min(...SKETCH_SITES.map(([, , x]) => x));
const minSketchY = Math.min(...SKETCH_SITES.map(([, , , y]) => y));
export const GRID_POSITIONS = new Map(SKETCH_SITES.map(([,id,x,y]) => [id, [
 GRID_PADDING+(x-minSketchX)*GRID_SCALE,
 GRID_PADDING+(y-minSketchY)*GRID_SCALE,
]]));
export const WORLD = {
 width:Math.ceil(Math.max(...GRID_POSITIONS.values().map(([x])=>x))+CARD_WIDTH+GRID_PADDING),
 height:Math.ceil(Math.max(...GRID_POSITIONS.values().map(([,y])=>y))+CARD_HEIGHT+GRID_PADDING),
};
export function zoomAt(camera, next, x, y) {
 const zoom=Math.max(.08,Math.min(3,next));
 return {zoom,x:x-(x-camera.x)/camera.zoom*zoom,y:y-(y-camera.y)/camera.zoom*zoom};
}
export function viewportWorld(camera,width,height) {
 return {x:-camera.x/camera.zoom,y:-camera.y/camera.zoom,width:width/camera.zoom,height:height/camera.zoom};
}
export function enclosingAspectBounds(points,aspect,padding=7,minWidth=48) {
 if(!points.length)return null;
 const ratio=Number.isFinite(aspect)&&aspect>0?aspect:1;
 const xs=points.map(point=>point[0]),ys=points.map(point=>point[1]);
 const cx=(Math.min(...xs)+Math.max(...xs))/2,cy=(Math.min(...ys)+Math.max(...ys))/2;
 let width=Math.max(Math.max(...xs)-Math.min(...xs)+padding*2,minWidth);
 let height=Math.max(Math.max(...ys)-Math.min(...ys)+padding*2,minWidth/ratio);
 if(width/height<ratio)width=height*ratio;else height=width/ratio;
 return {x:cx-width/2,y:cy-height/2,width,height};
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
