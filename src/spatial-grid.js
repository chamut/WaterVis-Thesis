import * as d3 from 'd3';
import {DATA_COLOUR,EXCEEDS_COLOUR,UNAVAILABLE_COLOUR,comparisonColour,observationStatus,STATUS_COLOURS} from './visual-encodings.js';
import { GRID_POSITIONS, WORLD, zoomAt, viewportWorld, fitCamera } from './grid-navigation.js';
import { SITE_ORDER_OPTIONS, compareSitesByOrder } from './site-order.js';
import { sensorSegments, pixelSample, parameterAxisDomain, timeAxisFormat } from './temporal-map-model.js';
import './spatial-grid.css';

function seasonStart(date) {
 const month=date.getMonth(),startMonth=month<2?11:month<5?2:month<8?5:month<11?8:11,year=month<2?date.getFullYear()-1:date.getFullYear();
 return new Date(year,startMonth,1);
}
const seasonInterval={
 ceil(date){const floor=seasonStart(date);return +floor<+date?d3.timeMonth.offset(floor,3):floor},
 range(start,end){const values=[];for(let value=this.ceil(start);value<end;value=d3.timeMonth.offset(value,3))values.push(value);return values;},
};

export function createSpatialGrid({data,state,colours,multi,allTemporal,onHover,onSelect,onSortChange}) {
 const workspace=document.querySelector('.analysis-workspace');
 workspace.classList.add('grid-workspace');
 const stage=document.querySelector('.map-stage');
 stage.innerHTML='<div class="spatial-viewport" tabindex="0" aria-label="Spatial grid. Drag or use arrow keys to pan; pinch to zoom."><div class="spatial-cards"></div></div><div class="spatial-navigation" aria-label="Grid navigation"><button data-action="in" aria-label="Zoom in">+</button><output></output><button data-action="out" aria-label="Zoom out">−</button><button data-action="reset">Reset</button><button data-action="left" aria-label="Pan left">←</button><button data-action="up" aria-label="Pan up">↑</button><button data-action="down" aria-label="Pan down">↓</button><button data-action="right" aria-label="Pan right">→</button></div><div class="spatial-status" role="status"></div><div class="map-tooltip" role="status"></div>';
 stage.classList.toggle('multi-spatial',multi);
 document.querySelector('.map-panel h2').textContent='Approximate geographic positions · N ↑';
 const navigationHint=document.createElement('p');
 navigationHint.className='grid-navigation-hint';
 navigationHint.textContent='Drag to pan · Pinch or use + / − to zoom';
 document.querySelector('.map-panel > .panel-heading').append(navigationHint);
 const viewport=stage.querySelector('.spatial-viewport'),layer=stage.querySelector('.spatial-cards');
 const layoutControls=document.createElement('div');layoutControls.className='grid-layout-controls';
 layoutControls.innerHTML=`<button type="button" class="grid-layout-toggle" aria-pressed="false" title="Arrange cards densely; the mini-map keeps real site locations">Reduce empty space</button><label class="grid-dense-sort" hidden>Order sites <select class="grid-sort">${SITE_ORDER_OPTIONS.map(([value,label])=>`<option value="${value}">${label}</option>`).join('')}</select></label>`;
 document.querySelector('.map-panel > .panel-heading').append(layoutControls);
 const layoutToggle=layoutControls.querySelector('.grid-layout-toggle'),sortSelect=layoutControls.querySelector('.grid-sort');sortSelect.value=state.siteSort;
 layer.addEventListener('pointerdown',event=>{if(event.target.closest('.spatial-card'))event.stopPropagation()});
 document.querySelector('.lasagna-tooltip')?.remove();
 const lasagnaTooltip=document.createElement('div');
 lasagnaTooltip.className='lasagna-tooltip';
 lasagnaTooltip.setAttribute('role','tooltip');
 lasagnaTooltip.hidden=true;
 document.body.append(lasagnaTooltip);
 const hideLasagnaTooltip=()=>{lasagnaTooltip.hidden=true};
 const placeLasagnaTooltip=(anchor,surface)=>{
  const gap=8,rect=lasagnaTooltip.getBoundingClientRect(),area=surface.getBoundingClientRect();
  const leftEdge=Math.max(gap,area.left+gap),rightEdge=Math.min(window.innerWidth-gap,area.right-gap);
  const topEdge=Math.max(gap,area.top+gap),bottomEdge=Math.min(window.innerHeight-gap,area.bottom-gap);
  let left=anchor.right+gap;
  let top=anchor.top;
  if(left+rect.width>rightEdge){
   left=anchor.left-rect.width-gap;
   if(left<leftEdge){
    left=Math.max(leftEdge,Math.min(anchor.left,rightEdge-rect.width));
    top=anchor.bottom+gap;
    if(top+rect.height>bottomEdge)top=anchor.top-rect.height-gap;
   }
  }
  lasagnaTooltip.style.left=`${Math.max(leftEdge,Math.min(left,rightEdge-rect.width))}px`;
  lasagnaTooltip.style.top=`${Math.max(topEdge,Math.min(top,bottomEdge-rect.height))}px`;
 };
 const showLasagnaTooltip=(event,site,p,summary,scope)=>{
  lasagnaTooltip.replaceChildren();
  lasagnaTooltip.classList.remove('detailed');
  const heading=document.createElement('strong');heading.textContent=`${site.short_name} · ${p.short_label}`;
  const coverage=document.createElement('span');coverage.textContent=summary.coverage;
  const condition=document.createElement('span');condition.textContent=summary.condition;
  const instruction=document.createElement('em');instruction.textContent=scope==='detail'?'Click to inspect the detailed chart':'Click to open the site overview';
  lasagnaTooltip.append(heading,coverage,condition,instruction);
  lasagnaTooltip.hidden=false;
  const surface=scope==='detail'?document.querySelector('.detail-panel'):viewport;
  const anchor=scope==='detail'?event.currentTarget:event.currentTarget.closest('.spatial-card');
  placeLasagnaTooltip(anchor.getBoundingClientRect(),surface);
 };
 const showDetailedLasagnaTooltip=(event,d,site,p,description)=>{
  const status={outside:'Exceeds',within:'Does not exceed',missing:'No data',unknown:'No objective'}[d.status];
  lasagnaTooltip.replaceChildren();
  lasagnaTooltip.classList.add('detailed');
  const heading=document.createElement('strong');heading.textContent=`${site.short_name} · ${p.short_label}`;
  const period=document.createElement('span');period.textContent=description.period;
  const stateLine=document.createElement('b');stateLine.className=`state-${d.status}`;stateLine.textContent=status;
  const values=document.createElement('span');values.textContent=description.values;
  const observations=document.createElement('span');observations.textContent=description.observations;
  const objective=document.createElement('span');objective.textContent=`Objective: ${description.bounds}`;
  lasagnaTooltip.append(heading,period,stateLine,values,observations,objective);
  lasagnaTooltip.hidden=false;
  placeLasagnaTooltip(event.currentTarget.getBoundingClientRect(),document.querySelector('.detail-panel'));
 };
 const mini=document.createElement('section');mini.className='shared-minimap';
 mini.innerHTML='<header><strong>Geographic context</strong><span>N ↑</span></header><svg tabindex="0" role="group" aria-label="Linked mini-map. Pan or zoom the geography. Click a site to select it."></svg><div class="mini-controls"><button data-action="in" aria-label="Mini-map zoom in">+</button><button data-action="out" aria-label="Mini-map zoom out">−</button><button data-action="reset">Reset</button></div><p>Dots show actual site locations. Click a dot to select its site.</p>';
 workspace.append(mini);
 const svg=d3.select(mini.querySelector('svg'));
 const sites=data.sites.filter(s=>s.hasData),entries=new Map();
 for(const site of sites){
  const card=document.createElement('div');card.className='spatial-card';card.dataset.siteId=site.site_id;
  const heading=document.createElement('button');heading.className='spatial-card-heading';heading.type='button';heading.textContent=site.short_name+' · '+site.site_id;heading.onclick=e=>onSelect(site.site_id,multi?null:state.selectedParameter,e);
  const plot=document.createElement('div');plot.className='spatial-card-plot';card.append(heading,plot);layer.append(card);
  card.addEventListener('click',e=>{if(multi&&!moved&&!e.target.closest('button'))onSelect(site.site_id,null,e)});
  card.addEventListener('pointerenter',()=>{if(!dragging)onHover(site.site_id)});card.addEventListener('pointerleave',()=>{if(!dragging)onHover(null)});
  card.addEventListener('focusin',e=>{onHover(site.site_id);if(e.target.matches(':focus-visible')){const r=card.getBoundingClientRect(),v=viewport.getBoundingClientRect();if(r.left<v.left||r.right>v.right||r.top<v.top||r.bottom>v.bottom)focus(site.site_id)}});card.addEventListener('focusout',e=>{if(!card.contains(e.relatedTarget))onHover(null)});
  entries.set(site.site_id,{card,plot,site});
 }
 let layoutMode='geographic',denseSortChosen=false,densePositions=new Map(),denseWorld={width:WORLD.width,height:WORLD.height},miniScale=1,miniOffset={x:0,y:0};
 const defaultCamera=()=>layoutMode==='dense'?fitDenseCamera():fitCamera(viewport.clientWidth,viewport.clientHeight);
 let camera=defaultCamera(),cameraTouched=false,visible=new Set(),dragging=false,moved=false,lastKey='',projection,frame,worldX,worldY,dots,dotHits,hoverRing,selectionRing,comparisonRings,mapGroup,frameBox,miniTransform={sx:1,sy:1,tx:0,ty:0};
 const position=id=>layoutMode==='dense'?densePositions.get(id):GRID_POSITIONS.get(id);
 function setDensePositions(){
  const ordered=sites.filter(s=>state.selectedSites.has(s.site_id)).sort((a,b)=>compareSitesByOrder(a,b,state.siteSort));
  const cardWidth=entries.values().next().value?.card.offsetWidth||240,cardHeight=entries.values().next().value?.card.offsetHeight||160;
  const gap=18,pad=16,w=viewport.clientWidth||900;
  const columns=Math.max(1,Math.min(ordered.length||1,Math.floor((w-2*pad+gap)/(cardWidth+gap))));
  densePositions=new Map(ordered.map((site,index)=>[site.site_id,[pad+index%columns*(cardWidth+gap)+cardWidth/2,pad+Math.floor(index/columns)*(cardHeight+gap)+cardHeight/2]]));
  denseWorld={width:Math.max(1,columns*(cardWidth+gap)-gap+pad*2),height:Math.max(1,Math.ceil(ordered.length/columns)*(cardHeight+gap)-gap+pad*2)};
 }
 function fitDenseCamera(){setDensePositions();const w=viewport.clientWidth,z=Math.max(.08,Math.min(1,(w-20)/denseWorld.width));return {zoom:z,x:(w-denseWorld.width*z)/2,y:10}}
 function focus(id){const point=position(id);if(!point)return;cameraTouched=true;camera.x=viewport.clientWidth/2-point[0]*camera.zoom;camera.y=viewport.clientHeight/2-point[1]*camera.zoom;layout()}
 function updateMini(){
  if(!projection||!frameBox)return;
  // Keep the rectangle as a stable representation of the main grid viewport.
  // The geographic layer pans and zooms underneath it as the grid camera moves.
  if(layoutMode==='dense'){
   const center={x:svg.node().clientWidth/2,y:svg.node().clientHeight/2};
   miniTransform={sx:miniScale,sy:miniScale,tx:center.x*(1-miniScale)+miniOffset.x,ty:center.y*(1-miniScale)+miniOffset.y};
  }else{
   const currentViewport=viewportWorld(camera,viewport.clientWidth,viewport.clientHeight);
   const x1=worldX(currentViewport.x),x2=worldX(currentViewport.x+currentViewport.width),y1=worldY(currentViewport.y),y2=worldY(currentViewport.y+currentViewport.height);
   const source={x:Math.min(x1,x2),y:Math.min(y1,y2),width:Math.max(1,Math.abs(x2-x1)),height:Math.max(1,Math.abs(y2-y1))};
   miniTransform={sx:frameBox.width/source.width,sy:frameBox.height/source.height,tx:frameBox.x-source.x*(frameBox.width/source.width),ty:frameBox.y-source.y*(frameBox.height/source.height)};
  }
  mapGroup.attr('transform',`translate(${miniTransform.tx},${miniTransform.ty}) scale(${miniTransform.sx},${miniTransform.sy})`);
  frame.attr('display',layoutMode==='dense'?'none':null).attr('x',frameBox.x).attr('y',frameBox.y).attr('width',frameBox.width).attr('height',frameBox.height);
  const miniPoint=s=>{const [x,y]=projection([s.longitude,s.latitude]);return [x*miniTransform.sx+miniTransform.tx,y*miniTransform.sy+miniTransform.ty]};
  dots.classed('hovered',s=>s.site_id===state.hoveredSite).classed('selected',s=>!state.compareMode&&s.site_id===state.selectedSite).attr('display',s=>state.selectedSites.has(s.site_id)?null:'none').attr('opacity',s=>s.site_id===state.hoveredSite||comparisonColour(state,s.site_id)||visible.has(s.site_id)?1:.55)
   .attr('cx',s=>miniPoint(s)[0]).attr('cy',s=>miniPoint(s)[1]).attr('r',4.5)
   .attr('stroke',s=>s.insideBoundary?'white':'#6b4f18')
   .attr('stroke-dasharray',s=>s.insideBoundary?null:'2 1')
   .attr('stroke-width',1.2)
   .attr('fill','#168aad')
   .attr('aria-pressed',s=>String(state.compareMode?state.comparedSites?.has(s.site_id):s.site_id===state.selectedSite));
  dotHits.attr('display',s=>state.selectedSites.has(s.site_id)?null:'none').attr('cx',s=>miniPoint(s)[0]).attr('cy',s=>miniPoint(s)[1]).attr('r',11)
   .attr('aria-pressed',s=>String(state.compareMode?state.comparedSites?.has(s.site_id):s.site_id===state.selectedSite));
  comparisonRings.attr('display',s=>state.selectedSites.has(s.site_id)&&comparisonColour(state,s.site_id)?null:'none')
   .style('--comparison-colour',s=>comparisonColour(state,s.site_id)||'transparent')
   .attr('cx',s=>miniPoint(s)[0]).attr('cy',s=>miniPoint(s)[1]);
  const hovered=sites.find(s=>s.site_id===state.hoveredSite&&state.selectedSites.has(s.site_id));
  hoverRing.attr('display',hovered?null:'none').attr('data-site-id',hovered?.site_id||'');
  if(hovered){const [x,y]=miniPoint(hovered);hoverRing.attr('cx',x).attr('cy',y);}
  const selected=sites.find(s=>!state.compareMode&&s.site_id===state.selectedSite&&state.selectedSites.has(s.site_id));
  selectionRing.attr('display',selected?null:'none').attr('data-site-id',selected?.site_id||'');
  if(selected){const [x,y]=miniPoint(selected);selectionRing.attr('cx',x).attr('cy',y);}
 }
 function drawMini(){
  const el=svg.node(),w=el.clientWidth||320,h=el.clientHeight||250;svg.attr('viewBox',`0 0 ${w} ${h}`);svg.selectAll('*').remove();
  projection=d3.geoMercator().fitExtent([[16,14],[w-16,h-22]],data.boundary);
  const bounds=d3.geoPath(projection).bounds(data.boundary);
  // Calibrate the schematic camera against the occupied grid and the same
  // sites' geographic positions. Mapping the entire virtual WORLD to the
  // basin boundary makes the mini-map rectangle drift and use the wrong scale
  // because the cards intentionally occupy only part of that virtual canvas.
  const linked=sites.map(site=>({grid:GRID_POSITIONS.get(site.site_id),map:projection([site.longitude,site.latitude])})).filter(item=>item.grid&&item.map?.every(Number.isFinite));
  const gridX=d3.extent(linked,item=>item.grid[0]),gridY=d3.extent(linked,item=>item.grid[1]);
  const mapX=d3.extent(linked,item=>item.map[0]),mapY=d3.extent(linked,item=>item.map[1]);
  worldX=d3.scaleLinear().domain(gridX).range(mapX);worldY=d3.scaleLinear().domain(gridY).range(mapY);
  const ratio=Math.max(.5,viewport.clientWidth/Math.max(1,viewport.clientHeight)),maxFrameWidth=(w-24)*.86,maxFrameHeight=(h-28)*.86;
  const frameWidth=Math.min(maxFrameWidth,maxFrameHeight*ratio),frameHeight=frameWidth/ratio;
  frameBox={x:(w-frameWidth)/2,y:(h-frameHeight)/2,width:frameWidth,height:frameHeight};
  mapGroup=svg.append('g').attr('class','mini-geography');
  mapGroup.append('path').datum(data.boundary).attr('d',d3.geoPath(projection)).attr('class','mini-basin-fill').attr('fill','#fff').attr('vector-effect','non-scaling-stroke');
  mapGroup.append('path').datum(data.watercourses).attr('class','mini-watercourses').attr('d',d3.geoPath(projection)).attr('fill','none').attr('stroke','#94c4e0').attr('stroke-width',.75).attr('stroke-opacity',.82).attr('vector-effect','non-scaling-stroke').attr('pointer-events','none');
  // Draw the boundary above the watercourse network so it remains legible.
  mapGroup.append('path').datum(data.boundary).attr('class','mini-basin-outline').attr('d',d3.geoPath(projection)).attr('fill','none').attr('stroke','#829e8b').attr('stroke-width',2).attr('stroke-linejoin','round').attr('pointer-events','none').attr('vector-effect','non-scaling-stroke');
  frame=svg.append('rect').attr('class','mini-viewport-rectangle').attr('fill','#168aad').attr('fill-opacity',.07).attr('stroke','#168aad').attr('stroke-dasharray','4 3').attr('stroke-width',1.5).attr('pointer-events','none');
  const markerLayer=svg.append('g').attr('class','mini-marker-layer');
  dots=markerLayer.selectAll('.mini-site').data(sites).join('circle').attr('class',s=>'mini-site'+(s.insideBoundary?'':' outside-boundary')).attr('data-site-id',s=>s.site_id).attr('pointer-events','none');
  const selectMiniSite=(e,s)=>{e.preventDefault();e.stopPropagation();onSelect(s.site_id,multi?null:state.selectedParameter,e);focus(s.site_id)};
  const nearestMiniSite=e=>{
   const p=svg.node().getBoundingClientRect();let nearest=null,best=Infinity;
   for(const s of sites){if(!state.selectedSites.has(s.site_id))continue;const [x,y]=projection([s.longitude,s.latitude]);const dx=e.clientX-p.left-(x*miniTransform.sx+miniTransform.tx),dy=e.clientY-p.top-(y*miniTransform.sy+miniTransform.ty),distance=dx*dx+dy*dy;if(distance<best){best=distance;nearest=s}}
   return best<=14*14?nearest:null;
  };
  dotHits=markerLayer.selectAll('.mini-site-hit').data(sites).join('circle').attr('class','mini-site-hit').attr('data-site-id',s=>s.site_id).attr('fill','transparent').attr('tabindex',0).attr('role','button').attr('aria-label',s=>`Select ${s.short_name}${s.insideBoundary?'':'; outside displayed basin polygon'}`).on('pointerenter focus',(e,s)=>onHover(s.site_id)).on('pointerleave blur',()=>onHover(null)).on('pointerdown',(e,s)=>selectMiniSite(e,nearestMiniSite(e)||s)).on('click',(e,s)=>{if(e.detail===0)selectMiniSite(e,s)}).on('keydown',(e,s)=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();selectMiniSite(e,s)}});
  comparisonRings=markerLayer.selectAll('.mini-comparison-ring').data(sites).join('circle').attr('class','mini-comparison-ring').attr('data-site-id',s=>s.site_id).attr('r',8.5).attr('pointer-events','none').attr('display','none');
  selectionRing=markerLayer.append('circle').attr('class','mini-selection-ring').attr('r',8.5).attr('pointer-events','none').attr('display','none');
  hoverRing=markerLayer.append('circle').attr('class','mini-hover-ring').attr('r',9.5).attr('pointer-events','none').attr('display','none');
  updateMini();
 }
 function layout(){
  const w=viewport.clientWidth,h=viewport.clientHeight;visible=new Set();
  for(const [id,{card}] of entries){const point=position(id);card.hidden=!state.selectedSites.has(id)||!point;if(card.hidden)continue;
   const x=point[0]*camera.zoom+camera.x,y=point[1]*camera.zoom+camera.y;
   card.style.setProperty('--hover-pixel',`${1/camera.zoom}px`);
   const halfWidth=card.offsetWidth*camera.zoom/2,halfHeight=card.offsetHeight*camera.zoom/2;
   card.style.transform=`translate(${x-halfWidth}px,${y-halfHeight}px) scale(${camera.zoom})`;
   if(x+halfWidth>=0&&x-halfWidth<=w&&y+halfHeight>=0&&y-halfHeight<=h)visible.add(id);
  }
  stage.querySelector('output').textContent=Math.round(camera.zoom*100)+'%';
  if(!multi)stage.querySelector('.spatial-status').textContent=state.selectedSites.size?`${visible.size} of ${state.selectedSites.size} sites in view`:'No sites selected. Choose sites in the toolbar.';
  updateMini();
 }
 function drawTemporal(plot,site,code,view,domain){
  const button=document.createElement('button');button.className='spatial-temporal';button.setAttribute('aria-label','Inspect '+code+' at '+site.short_name);button.onclick=e=>onSelect(site.site_id,code,e);plot.append(button);
  const continuous=view.continuous.filter(r=>r.site_id===site.site_id&&r.parameter_code===code),spot=view.spot.filter(r=>r.site_id===site.site_id&&r.parameter_code===code&&Number.isFinite(r.value));
  const objective=data.availability.ers.thresholds[site.ers_segment]?.[code];
  const pointColour=value=>STATUS_COLOURS[observationStatus(value,objective)];
  const s=d3.select(button).append('svg').attr('viewBox','0 0 220 116'),x=d3.scaleTime().domain([state.rangeStart,state.rangeEnd]).range([36,214]),y=d3.scaleLinear().domain(domain).range([90,10]);
  s.append('g').attr('transform','translate(36,0)').call(d3.axisLeft(y).ticks(2).tickFormat(d3.format('.3~g')).tickSize(0));
  s.append('g').attr('transform','translate(0,90)').call(d3.axisBottom(x).tickValues([state.rangeStart, state.rangeEnd]).tickFormat(timeAxisFormat(state.rangeStart,state.rangeEnd)).tickSize(0));
  const segments=sensorSegments(continuous,state.selectedResolution).map(a=>pixelSample(a,x));
  for(const a of segments){s.append('path').datum(a).attr('d',d3.line().x(r=>x(r.dateValue)).y(r=>y(r.value))).attr('fill','none').attr('stroke',colours[code]);if(a.length===1)s.append('circle').attr('cx',x(a[0].dateValue)).attr('cy',y(a[0].value)).attr('r',2).attr('fill',pointColour(a[0].value));}
  s.selectAll('.spot').data(spot).join('circle').attr('class','spot').attr('cx',r=>x(r.datetimeValue)).attr('cy',r=>y(r.value)).attr('r',2).attr('fill',r=>pointColour(r.value));
  if(!segments.length&&!spot.length)s.append('text').attr('x',120).attr('y',54).attr('text-anchor','middle').text('No data in selected period');
 }
 function drawGlyph(plot,site,code,view,scope="card"){
  const objective=data.availability.ers.thresholds[site.ers_segment]?.[code],p=data.availability.parameters.find(p=>p.code===code);
  const button=document.createElement('button');button.className='spatial-glyph';button.setAttribute('aria-label',`${site.short_name}, ${p.label}, temporal threshold states; ${scope==='detail'?'open parameter detail':'open site overview'}`);button.onclick=e=>{hideLasagnaTooltip();onSelect(site.site_id,scope==='detail'?code:null,e)};plot.append(button);
  const s=d3.select(button).append('svg').attr('viewBox','0 0 42 112'),start=+state.rangeStart,end=+state.rangeEnd+1,interval=state.selectedResolution==='yearly'?d3.timeYear:state.selectedResolution==='seasonal'?seasonInterval:d3.timeMonth;
  const edges=[start,...interval.range(interval.ceil(new Date(start+1)),new Date(end)).map(Number),end],bins=edges.slice(0,-1).map((a,i)=>({a,b:edges[i+1],values:[],sensor:0,spot:0}));
  const add=(r,date,source)=>{const t=+date;if(t<start||t>=end||!Number.isFinite(r.value))return;const index=d3.bisectRight(edges,t)-1,bin=bins[index];if(!bin)return;bin.values.push(...[r.value,r.min,r.max].filter(Number.isFinite));bin[source]++};
  view.continuous.filter(r=>r.site_id===site.site_id&&r.parameter_code===code).forEach(r=>add(r,r.dateValue,'sensor'));
  view.spot.filter(r=>r.site_id===site.site_id&&r.parameter_code===code).forEach(r=>add(r,r.datetimeValue,'spot'));
  const hasObjective=objective&&(Number.isFinite(objective.lower)||Number.isFinite(objective.upper));
  const available=bins.filter(bin=>bin.values.length).length;
  const exceeds=hasObjective?bins.filter(bin=>bin.values.some(value=>(Number.isFinite(objective.lower)&&value<objective.lower)||(Number.isFinite(objective.upper)&&value>objective.upper))).length:0;
  const periodName={monthly:'months',seasonal:'seasons',yearly:'years'}[state.selectedResolution]||'periods';
  const years=state.rangeStart.getFullYear()===state.rangeEnd.getFullYear()?String(state.rangeStart.getFullYear()):`${state.rangeStart.getFullYear()}–${state.rangeEnd.getFullYear()}`;
  const summary={coverage:`${state.selectedResolution} · ${years} · ${available}/${bins.length} ${periodName} with data`,condition:hasObjective?`${exceeds} ${periodName} exceed the objective`:'Objective unavailable'};
  if(scope==='card'){
   button.addEventListener('pointerenter',event=>showLasagnaTooltip(event,site,p,summary,scope));
   button.addEventListener('pointerleave',hideLasagnaTooltip);
   button.addEventListener('focus',event=>showLasagnaTooltip(event,site,p,summary,scope));
   button.addEventListener('blur',hideLasagnaTooltip);
  }
  const y=d3.scaleTime().domain([new Date(start),new Date(end)]).range([106,25]),groups=[];
  for(const bin of bins){const status=!bin.values.length?'missing':!hasObjective?'unknown':bin.values.some(v=>(Number.isFinite(objective.lower)&&v<objective.lower)||(Number.isFinite(objective.upper)&&v>objective.upper))?'outside':'within',pixel=Math.floor(y(bin.a)),last=groups.at(-1);if(last&&last.pixel===pixel){last.b=bin.b;last.values.push(...bin.values);last.sensor+=bin.sensor;last.spot+=bin.spot;last.count++;if(status==='outside'||last.status==='missing')last.status=status}else groups.push({...bin,status,pixel,count:1})}
  s.append('rect').attr('x',5).attr('y',2).attr('width',32).attr('height',3).attr('fill',DATA_COLOUR);s.append('text').attr('x',21).attr('y',17).attr('text-anchor','middle').text(p.short_label);
  const fmt=d3.format('.4~g'),dateFmt=d3.timeFormat('%d %b %Y %H:%M'),bounds=objective?[Number.isFinite(objective.lower)?'≥ '+fmt(objective.lower):null,Number.isFinite(objective.upper)?'≤ '+fmt(objective.upper):null].filter(Boolean).join(' and '):'Unavailable';
  const description=d=>({
   period:`${dateFmt(new Date(d.a))} — ${dateFmt(new Date(d.b-1))}`,
   values:d.values.length?`Range: ${fmt(d3.min(d.values))}–${fmt(d3.max(d.values))} ${p.unit}`:'No observations',
   observations:`${d.spot} aggregated spot value${d.spot===1?'':'s'}${d.count>1?` · ${d.count} time intervals combined`:''}`,
   bounds,
  });
  const accessibleDescription=d=>{const info=description(d);return `${site.short_name} · ${p.short_label} · ${info.period} · ${{outside:'Exceeds',within:'Does not exceed',missing:'No data',unknown:'No objective'}[d.status]} · ${info.values} · ${info.observations} · Objective ${info.bounds}`};
  const strips=s.selectAll('.time-state').data(groups).join('rect').attr('class',d=>`time-state ${d.status}`).attr('role','img').attr('aria-label',accessibleDescription).attr('x',5).attr('y',d=>y(d.b)).attr('width',32).attr('height',d=>Math.max(.5,y(d.a)-y(d.b)-(bins.length<=31?.4:0))).attr('fill',d=>d.status==='outside'?EXCEEDS_COLOUR:d.status==='within'?DATA_COLOUR:UNAVAILABLE_COLOUR);
  if(scope==='detail')strips.attr('tabindex',0)
   .on('pointerenter pointermove',(event,d)=>showDetailedLasagnaTooltip(event,d,site,p,description(d)))
   .on('pointerleave',hideLasagnaTooltip)
   .on('focus',(event,d)=>showDetailedLasagnaTooltip(event,d,site,p,description(d)))
   .on('blur',hideLasagnaTooltip);
 }
 function appendSharedTimeAxis(plot){const axis=document.createElement('div');axis.className='shared-time-axis';axis.setAttribute('aria-label','Time runs from bottom to top');axis.innerHTML='<span aria-hidden="true">↑</span><b>TIME</b>';plot.append(axis)}
 function update(){
  const codes=multi?[...state.selectedParameters]:[state.selectedParameter];
  const key=[state.selectedResolution,+state.rangeStart,+state.rangeEnd,codes.join(',')].join('|');
  if(key!==lastKey){lastKey=key;const view=allTemporal();
   const domains=new Map(codes.map(code=>[code,parameterAxisDomain(data,view,code)]));
   for(const {plot,site} of entries.values()){plot.replaceChildren();if(multi){appendSharedTimeAxis(plot);for(const code of codes)drawGlyph(plot,site,code,view)}else drawTemporal(plot,site,codes[0],view,domains.get(codes[0]));}
  }
  for(const [id,{card}] of entries){const colour=comparisonColour(state,id);card.classList.toggle('hovered',state.hoveredSite===id);card.classList.toggle('selected',!state.compareMode&&state.selectedSite===id);card.classList.toggle('compared',Boolean(colour));card.style.setProperty('--comparison-colour',colour||'transparent');}
  if(layoutMode==='dense')setDensePositions();
  layout();
 }
 function setLayout(mode){
  layoutMode=mode;stage.classList.toggle('dense-layout',mode==='dense');layoutControls.querySelector('.grid-dense-sort').hidden=mode!=='dense';
  layoutToggle.setAttribute('aria-pressed',String(mode==='dense'));
  if(mode==='dense'&&!denseSortChosen){state.siteSort='north-south';sortSelect.value=state.siteSort;denseSortChosen=true;onSortChange()}
  document.querySelector('.map-panel h2').textContent=mode==='dense'?'Site cards · geographic locations in mini-map':'Approximate geographic positions · N ↑';
  mini.querySelector('p').textContent=mode==='dense'?'Dots show actual site locations. Highlighted dots have cards in view; click a dot to find its card.':'Dots show actual site locations. Click a dot to select its site.';
  cameraTouched=false;camera=defaultCamera();layout();
 }
 layoutToggle.addEventListener('click',()=>setLayout(layoutMode==='dense'?'geographic':'dense'));
 sortSelect.addEventListener('change',()=>{state.siteSort=sortSelect.value;if(layoutMode==='dense'){cameraTouched=false;camera=defaultCamera()}onSortChange();layout()});
 function action(name){if(name==='reset'){cameraTouched=false;camera=defaultCamera()}else{cameraTouched=true;if(name==='in'||name==='out')camera=zoomAt(camera,camera.zoom*(name==='in'?1.2:1/1.2),viewport.clientWidth/2,viewport.clientHeight/2);else{camera.x+=({left:160,right:-160}[name]||0);camera.y+=({up:130,down:-130}[name]||0)}}layout()}
 stage.querySelector('.spatial-navigation').addEventListener('click',e=>{if(e.target.dataset.action)action(e.target.dataset.action)});
 mini.querySelector('.mini-controls').addEventListener('click',e=>{const name=e.target.dataset.action;if(!name)return;if(layoutMode!=='dense'){action(name);return}if(name==='reset'){miniScale=1;miniOffset={x:0,y:0}}else miniScale=Math.max(.7,Math.min(5,miniScale*(name==='in'?1.2:1/1.2)));updateMini()});
 viewport.addEventListener('keydown',e=>{const name={ArrowLeft:'left',ArrowRight:'right',ArrowUp:'up',ArrowDown:'down','+':'in','-':'out'}[e.key];if(name&&e.target===viewport){e.preventDefault();action(name)}});
 let start;viewport.addEventListener('pointerdown',e=>{if(e.button!==0)return;dragging=true;moved=false;start={x:e.clientX,y:e.clientY,camera:{...camera}}});
 viewport.addEventListener('pointermove',e=>{if(!dragging)return;const dx=e.clientX-start.x,dy=e.clientY-start.y;if(Math.hypot(dx,dy)>5||moved){cameraTouched=true;moved=true;viewport.setPointerCapture(e.pointerId);camera={...start.camera,x:start.camera.x+dx,y:start.camera.y+dy};layout()}});
 for(const event of ['pointerup','pointercancel'])viewport.addEventListener(event,()=>{dragging=false;setTimeout(()=>moved=false,0)});
 viewport.addEventListener('wheel',e=>{e.preventDefault();cameraTouched=true;const r=viewport.getBoundingClientRect();if(e.ctrlKey)camera=zoomAt(camera,camera.zoom*Math.exp(-e.deltaY*.012),e.clientX-r.left,e.clientY-r.top);else{camera.x-=e.deltaX;camera.y-=e.deltaY}layout()},{passive:false});
 const miniEl=svg.node();let miniDrag;
 const point=e=>{const r=miniEl.getBoundingClientRect();return{x:e.clientX-r.left,y:e.clientY-r.top}};
 const gridPoint=p=>({x:worldX.invert((p.x-miniTransform.tx)/miniTransform.sx),y:worldY.invert((p.y-miniTransform.ty)/miniTransform.sy)});
 miniEl.addEventListener('pointerdown',e=>{if(e.button!==0)return;if(e.target.closest('.mini-site-hit'))return;if(layoutMode==='dense'){miniDrag={point:point(e),offset:{...miniOffset},dense:true};miniEl.setPointerCapture(e.pointerId);return}cameraTouched=true;const p=point(e),g=gridPoint(p);if(!e.target.classList.contains('mini-viewport-rectangle')){camera.x=viewport.clientWidth/2-g.x*camera.zoom;camera.y=viewport.clientHeight/2-g.y*camera.zoom;layout()}miniDrag={p:gridPoint(p),camera:{...camera}};miniEl.setPointerCapture(e.pointerId)});
 miniEl.addEventListener('pointermove',e=>{if(!miniDrag||!miniEl.hasPointerCapture(e.pointerId))return;if(miniDrag.dense){const p=point(e);miniOffset={x:miniDrag.offset.x+p.x-miniDrag.point.x,y:miniDrag.offset.y+p.y-miniDrag.point.y};updateMini();return}const p=gridPoint(point(e));camera={...miniDrag.camera,x:miniDrag.camera.x-(p.x-miniDrag.p.x)*camera.zoom,y:miniDrag.camera.y-(p.y-miniDrag.p.y)*camera.zoom};layout()});
 for(const type of ['pointerup','pointercancel'])miniEl.addEventListener(type,()=>{miniDrag=null});
 miniEl.addEventListener('wheel',e=>{e.preventDefault();if(layoutMode==='dense'){miniScale=Math.max(.7,Math.min(5,miniScale*Math.exp(-e.deltaY*.005)));updateMini();return}cameraTouched=true;const p=gridPoint(point(e)),ax=p.x*camera.zoom+camera.x,ay=p.y*camera.zoom+camera.y;camera=zoomAt(camera,camera.zoom*Math.exp(-e.deltaY*.005),ax,ay);layout()},{passive:false});
 miniEl.addEventListener('keydown',e=>{if(e.target!==miniEl)return;const name={ArrowLeft:'left',ArrowRight:'right',ArrowUp:'up',ArrowDown:'down','+':'in','-':'out'}[e.key];if(name){e.preventDefault();action(name)}});
 const observer=new ResizeObserver(()=>{if(!cameraTouched)camera=defaultCamera();drawMini();layout()});observer.observe(viewport);observer.observe(miniEl);
 drawMini();update();return {update,focus,syncSort:()=>{sortSelect.value=state.siteSort;if(layoutMode==='dense'){cameraTouched=false;camera=defaultCamera()}layout()},renderOverview:(host,site)=>{host.replaceChildren();appendSharedTimeAxis(host);const view=allTemporal();for(const code of state.selectedParameters)drawGlyph(host,site,code,view,"detail")},resize:()=>{drawMini();layout()},scheduleLayout:layout};
}
