import fs from 'node:fs';
import * as d3 from 'd3';

// Reproduces the point-set assignment used for the approved 20-slot sketch.
// The sketch supplies the target tile set. This script does not implement the
// shape-decomposition or mosaic-cartogram stages of Meulemans et al. (2021).
const slots = [
  [1,150,180], [2,345,200], [3,510,215], [4,660,280], [5,600,365],
  [6,600,470], [7,470,470], [8,735,535], [9,830,615], [10,263,650],
  [11,263,720], [12,425,715], [13,940,680], [14,1165,720], [15,570,815],
  [16,727,890], [17,885,825], [18,1030,785], [19,1175,850], [20,1170,945],
];
const sites = d3.csvParse(fs.readFileSync(new URL('../public/data/sites.csv', import.meta.url), 'utf8'))
  .filter((site) => !/\bDRAIN\b/.test(site.name) && /\b(?:RIVER|CREEKS?)\b/.test(site.name));
const extent = (values) => [Math.min(...values), Math.max(...values)];
const [lon0, lon1] = extent(sites.map((site) => +site.longitude));
const [lat0, lat1] = extent(sites.map((site) => +site.latitude));
const [x0, x1] = extent(slots.map(([,x]) => x));
const [y0, y1] = extent(slots.map(([, ,y]) => y));
for (const site of sites) {
  site.targetX = x0 + ((+site.longitude-lon0)/(lon1-lon0))*(x1-x0);
  site.targetY = y0 + ((lat1-(+site.latitude))/(lat1-lat0))*(y1-y0);
}

// Hungarian algorithm for a square minimum-cost assignment matrix.
function assign(cost) {
  const n=cost.length,u=Array(n+1).fill(0),v=Array(n+1).fill(0),p=Array(n+1).fill(0),way=Array(n+1).fill(0);
  for(let i=1;i<=n;i++){
    p[0]=i;let j0=0;const minv=Array(n+1).fill(Infinity),used=Array(n+1).fill(false);
    do{
      used[j0]=true;const i0=p[j0];let delta=Infinity,j1=0;
      for(let j=1;j<=n;j++)if(!used[j]){const current=cost[i0-1][j-1]-u[i0]-v[j];if(current<minv[j]){minv[j]=current;way[j]=j0}if(minv[j]<delta){delta=minv[j];j1=j}}
      for(let j=0;j<=n;j++)if(used[j]){u[p[j]]+=delta;v[j]-=delta}else minv[j]-=delta;
      j0=j1;
    }while(p[j0]!==0);
    do{const j1=way[j0];p[j0]=p[j1];j0=j1}while(j0!==0);
  }
  const result=Array(n);
  for(let j=1;j<=n;j++)result[p[j]-1]=j-1;
  return result;
}

const assignment = assign(sites.map((site) => slots.map(([,x,y]) =>
  (site.targetX-x)**2+(site.targetY-y)**2,
)));
const result = sites.map((site,index) => ({site,slot:slots[assignment[index]]}))
  .sort((a,b) => a.slot[0]-b.slot[0]);
for (const {site,slot:[number,x,y]} of result) {
  console.log(`[${number}, '${site.site_id}', ${x}, ${y}], // ${site.short_name}`);
}
