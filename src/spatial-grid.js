import * as d3 from 'd3';
import { GRID_POSITIONS, WORLD, zoomAt, viewportWorld, fitCamera } from './grid-navigation.js';
import { sensorSegments, pixelSample, sharedDomain } from './temporal-map-model.js';
import './spatial-grid.css';

function seasonStart(date) {
 const month=date.getMonth(),startMonth=month<2?11:month<5?2:month<8?5:month<11?8:11,year=month<2?date.getFullYear()-1:date.getFullYear();
 return new Date(year,startMonth,1);
}
const seasonInterval={
 ceil(date){const floor=seasonStart(date);return +floor<+date?d3.timeMonth.offset(floor,3):floor},
 range(start,end){const values=[];for(let value=this.ceil(start);value<end;value=d3.timeMonth.offset(value,3))values.push(value);return values;},
};

export function createSpatialGrid({data,state,colours,multi,allTemporal,onHover,onSelect}) {
 const workspace=document.querySelector('.analysis-workspace');
 workspace.classList.add('grid-workspace');
 const stage=document.querySelector('.map-stage');
 stage.innerHTML='<div class="spatial-viewport" tabindex="0" aria-label="Spatial grid. Drag or use arrow keys to pan; pinch to zoom."><div class="spatial-cards"></div></div><div class="spatial-navigation" aria-label="Grid navigation"><button data-action="in" aria-label="Zoom in">+</button><output></output><button data-action="out" aria-label="Zoom out">−</button><button data-action="reset">Reset</button><button data-action="left" aria-label="Pan left">←</button><button data-action="up" aria-label="Pan up">↑</button><button data-action="down" aria-label="Pan down">↓</button><button data-action="right" aria-label="Pan right">→</button></div><div class="spatial-status" role="status"></div><div class="map-tooltip" role="status"></div>';
 document.querySelector('.map-panel h2').textContent='Approximate geographic positions · N ↑';
 const viewport=stage.querySelector('.spatial-viewport'),layer=stage.querySelector('.spatial-cards');
 const mini=document.createElement('section');mini.className='shared-minimap';
 mini.innerHTML='<header><strong>Geographic context</strong><span>N ↑</span></header><svg tabindex="0" role="group" aria-label="Linked mini-map. Drag viewport rectangle to pan. Click a site for details."></svg><div class="mini-controls"><button data-action="in" aria-label="Mini-map zoom in">+</button><button data-action="out" aria-label="Mini-map zoom out">−</button><button data-action="reset">Reset</button></div><p>Schematic viewport · dots show actual site locations. Highlighted dots are visible in the grid.</p>';
 workspace.append(mini);
 const svg=d3.select(mini.querySelector('svg'));
 const sites=data.sites.filter(s=>s.hasData),entries=new Map();
 for(const site of sites){
  const card=document.createElement('div');card.className='spatial-card';card.dataset.siteId=site.site_id;
  const heading=document.createElement('button');heading.className='spatial-card-heading';heading.type='button';heading.textContent=site.short_name+' · '+site.site_id;heading.onclick=e=>{if(!moved)onSelect(site.site_id,multi?null:state.selectedParameter,e)};
  const plot=document.createElement('div');plot.className='spatial-card-plot';card.append(heading,plot);layer.append(card);
  card.addEventListener('click',e=>{if(multi&&!moved&&!e.target.closest('button'))onSelect(site.site_id,null,e)});
  card.addEventListener('pointerenter',()=>{if(!dragging)onHover(site.site_id)});card.addEventListener('pointerleave',()=>{if(!dragging)onHover(null)});
  card.addEventListener('focusin',e=>{onHover(site.site_id);if(e.target.matches(':focus-visible')){const r=card.getBoundingClientRect(),v=viewport.getBoundingClientRect();if(r.left<v.left||r.right>v.right||r.top<v.top||r.bottom>v.bottom)focus(site.site_id)}});card.addEventListener('focusout',e=>{if(!card.contains(e.relatedTarget))onHover(null)});
  entries.set(site.site_id,{card,plot,site});
 }
 let camera=fitCamera(viewport.clientWidth,viewport.clientHeight),visible=new Set(),dragging=false,moved=false,lastKey='',projection,frame,worldX,worldY,dots,hoverRing;
 function focus(id){const point=GRID_POSITIONS.get(id);if(!point)return;camera.x=viewport.clientWidth/2-point[0]*camera.zoom;camera.y=viewport.clientHeight/2-point[1]*camera.zoom;layout()}
 function updateMini(){
  if(!projection)return;
  const bounds=viewportWorld(camera,viewport.clientWidth,viewport.clientHeight);
  // Do not shrink or clamp the rectangle: that would distort the camera mapping.
  frame.attr('x',worldX(bounds.x)).attr('y',worldY(bounds.y)).attr('width',worldX(bounds.x+bounds.width)-worldX(bounds.x)).attr('height',worldY(bounds.y+bounds.height)-worldY(bounds.y));
  dots.classed('hovered',s=>s.site_id===state.hoveredSite).attr('display',s=>state.selectedSites.has(s.site_id)?null:'none').attr('opacity',s=>s.site_id===state.hoveredSite||visible.has(s.site_id)?1:.25)
   .attr('r',s=>s.site_id===state.hoveredSite||s.site_id===state.selectedSite?5:3.3)
   .attr('fill',s=>state.compareMode&&state.comparedSites?.has(s.site_id)?['#d7191c','#e78b25','#8b7613','#258cc0','#2c3b91'][state.comparedSites.get(s.site_id)]:'#168aad')
   .attr('aria-pressed',s=>String(s.site_id===state.selectedSite||(state.compareMode&&state.comparedSites?.has(s.site_id))));
  const hovered=sites.find(s=>s.site_id===state.hoveredSite&&state.selectedSites.has(s.site_id));
  hoverRing.attr('display',hovered?null:'none').attr('data-site-id',hovered?.site_id||'');
  if(hovered){const [x,y]=projection([hovered.longitude,hovered.latitude]);hoverRing.attr('cx',x).attr('cy',y);}
 }
 function drawMini(){
  const el=svg.node(),w=el.clientWidth||320,h=el.clientHeight||250;svg.attr('viewBox',`0 0 ${w} ${h}`);svg.selectAll('*').remove();
  projection=d3.geoMercator().fitExtent([[16,14],[w-16,h-22]],data.boundary);
  const bounds=d3.geoPath(projection).bounds(data.boundary);
  worldX=d3.scaleLinear().domain([0,WORLD.width]).range([bounds[0][0],bounds[1][0]]);worldY=d3.scaleLinear().domain([0,WORLD.height]).range([bounds[0][1],bounds[1][1]]);
  svg.append('path').datum(data.boundary).attr('d',d3.geoPath(projection)).attr('class','mini-basin-fill').attr('fill','#fff');
  const nw=projection([144.6594971209363,-35.96275386870387]),se=projection([146.6590695918188,-37.67907102202982]);
  svg.append('image').attr('href',import.meta.env.BASE_URL+'data/goulburn_watercourses.png').attr('x',nw[0]).attr('y',nw[1]).attr('width',se[0]-nw[0]).attr('height',se[1]-nw[1]).attr('opacity',.7);
  // Draw the boundary above the river raster so it remains legible.
  svg.append('path').datum(data.boundary).attr('class','mini-basin-outline').attr('d',d3.geoPath(projection)).attr('fill','none').attr('stroke','#829e8b').attr('stroke-width',2).attr('stroke-linejoin','round').attr('pointer-events','none');
  frame=svg.append('rect').attr('class','mini-viewport-rectangle').attr('fill','#168aad').attr('fill-opacity',.07).attr('stroke','#168aad').attr('stroke-dasharray','4 3').attr('stroke-width',1.5);
  dots=svg.selectAll('.mini-site').data(sites).join('circle').attr('class',s=>'mini-site'+(s.insideBoundary?'':' outside-boundary')).attr('data-site-id',s=>s.site_id).attr('cx',s=>projection([s.longitude,s.latitude])[0]).attr('cy',s=>projection([s.longitude,s.latitude])[1]).attr('stroke',s=>s.insideBoundary?'white':'#6b4f18').attr('stroke-width',s=>s.insideBoundary?1:2).attr('stroke-dasharray',s=>s.insideBoundary?null:'2 1').attr('tabindex',0).attr('role','button').attr('aria-label',s=>s.short_name+(s.insideBoundary?'':'; outside displayed basin polygon')+'; open details').on('pointerenter focus',(e,s)=>onHover(s.site_id)).on('pointerleave blur',()=>onHover(null)).on('click',(e,s)=>{e.stopPropagation();onSelect(s.site_id,multi?null:state.selectedParameter,e);focus(s.site_id)}).on('keydown',(e,s)=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();onSelect(s.site_id,multi?null:state.selectedParameter,e);focus(s.site_id)}});
  hoverRing=svg.append('circle').attr('class','mini-hover-ring').attr('r',9).attr('pointer-events','none').attr('display','none');
  updateMini();
 }
 function layout(){
  const w=viewport.clientWidth,h=viewport.clientHeight;visible=new Set();
  for(const [id,{card}] of entries){const point=GRID_POSITIONS.get(id);card.hidden=!state.selectedSites.has(id)||!point;if(card.hidden)continue;
   const x=point[0]*camera.zoom+camera.x,y=point[1]*camera.zoom+camera.y;
   card.style.setProperty('--hover-pixel',`${1/camera.zoom}px`);
   card.style.transform=`translate(${x-120*camera.zoom}px,${y-80*camera.zoom}px) scale(${camera.zoom})`;
   if(x>=0&&x<=w&&y>=0&&y<=h)visible.add(id);
  }
  stage.querySelector('output').textContent=Math.round(camera.zoom*100)+'%';
  stage.querySelector('.spatial-status').textContent=state.selectedSites.size?`${visible.size} of ${state.selectedSites.size} sites in view · Drag to pan · Pinch to zoom`:'No sites selected. Choose sites in the toolbar.';
  updateMini();
 }
 function drawTemporal(plot,site,code,view,domain){
  const button=document.createElement('button');button.className='spatial-temporal';button.setAttribute('aria-label','Inspect '+code+' at '+site.short_name);button.onclick=e=>{if(!moved)onSelect(site.site_id,code,e)};plot.append(button);
  const continuous=view.continuous.filter(r=>r.site_id===site.site_id&&r.parameter_code===code),spot=view.spot.filter(r=>r.site_id===site.site_id&&r.parameter_code===code&&Number.isFinite(r.value));
  const s=d3.select(button).append('svg').attr('viewBox','0 0 220 116'),x=d3.scaleTime().domain([state.rangeStart,state.rangeEnd]).range([36,214]),y=d3.scaleLinear().domain(domain).range([90,10]);
  s.append('g').attr('transform','translate(36,0)').call(d3.axisLeft(y).ticks(2).tickFormat(d3.format('.3~g')).tickSize(0));
  s.append('g').attr('transform','translate(0,90)').call(d3.axisBottom(x).ticks(2).tickFormat(d3.timeFormat('%Y')).tickSize(0));
  const segments=sensorSegments(continuous,state.selectedResolution).map(a=>pixelSample(a,x));
  for(const a of segments){s.append('path').datum(a).attr('d',d3.line().x(r=>x(r.dateValue)).y(r=>y(r.value))).attr('fill','none').attr('stroke',colours[code]);if(a.length===1)s.append('circle').attr('cx',x(a[0].dateValue)).attr('cy',y(a[0].value)).attr('r',2).attr('fill',colours[code]);}
  s.selectAll('.spot').data(spot).join('circle').attr('class','spot').attr('cx',r=>x(r.datetimeValue)).attr('cy',r=>y(r.value)).attr('r',2).attr('fill',colours[code]);
  if(!segments.length&&!spot.length)s.append('text').attr('x',120).attr('y',54).attr('text-anchor','middle').text('No data in selected period');
 }
 function drawGlyph(plot,site,code,view,scope="card"){
  const objective=data.availability.ers.thresholds[site.ers_segment]?.[code],p=data.availability.parameters.find(p=>p.code===code);
  const button=document.createElement('button');button.className='spatial-glyph';button.setAttribute('aria-label',`${site.short_name}, ${p.label}, temporal threshold states; ${scope==='detail'?'open parameter detail':'open site overview'}`);button.onclick=e=>{if(!moved)onSelect(site.site_id,scope==='detail'?code:null,e)};plot.append(button);
  const s=d3.select(button).append('svg').attr('viewBox','0 0 42 112'),start=+state.rangeStart,end=+state.rangeEnd+1,interval=state.selectedResolution==='yearly'?d3.timeYear:state.selectedResolution==='seasonal'?seasonInterval:d3.timeMonth;
  const edges=[start,...interval.range(interval.ceil(new Date(start+1)),new Date(end)).map(Number),end],bins=edges.slice(0,-1).map((a,i)=>({a,b:edges[i+1],values:[],sensor:0,spot:0}));
  const add=(r,date,source)=>{const t=+date;if(t<start||t>=end||!Number.isFinite(r.value))return;const index=d3.bisectRight(edges,t)-1,bin=bins[index];if(!bin)return;bin.values.push(...[r.value,r.min,r.max].filter(Number.isFinite));bin[source]++};
  view.continuous.filter(r=>r.site_id===site.site_id&&r.parameter_code===code).forEach(r=>add(r,r.dateValue,'sensor'));
  view.spot.filter(r=>r.site_id===site.site_id&&r.parameter_code===code).forEach(r=>add(r,r.datetimeValue,'spot'));
  const y=d3.scaleTime().domain([new Date(start),new Date(end)]).range([98,25]),groups=[];
  for(const bin of bins){const status=!bin.values.length?'missing':!objective?'unknown':bin.values.some(v=>(Number.isFinite(objective.lower)&&v<objective.lower)||(Number.isFinite(objective.upper)&&v>objective.upper))?'outside':'within',pixel=Math.floor(y(bin.a)),last=groups.at(-1);if(last&&last.pixel===pixel){last.b=bin.b;last.values.push(...bin.values);last.sensor+=bin.sensor;last.spot+=bin.spot;last.count++;if(status==='outside'||last.status==='missing')last.status=status}else groups.push({...bin,status,pixel,count:1})}
  const patternId=`state-missing-${scope}-${site.site_id}-${code}`,pattern=s.append('defs').append('pattern').attr('id',patternId).attr('width',5).attr('height',5).attr('patternUnits','userSpaceOnUse');pattern.append('rect').attr('width',5).attr('height',5).attr('fill','#edf0ee');pattern.append('path').attr('d','M0,5L5,0').attr('stroke','#aab8b0').attr('stroke-width',1);
  s.append('rect').attr('x',5).attr('y',2).attr('width',32).attr('height',3).attr('fill',colours[code]);s.append('text').attr('x',21).attr('y',17).attr('text-anchor','middle').text(p.short_label);
  const fmt=d3.format('.4~g'),dateFmt=d3.timeFormat('%d %b %Y %H:%M'),bounds=objective?[Number.isFinite(objective.lower)?'≥ '+fmt(objective.lower):null,Number.isFinite(objective.upper)?'≤ '+fmt(objective.upper):null].filter(Boolean).join(' and '):'Unavailable';
  const description=d=>`${site.short_name} · ${p.short_label} · ${dateFmt(new Date(d.a))} — ${dateFmt(new Date(d.b-1))} · ${{outside:'Exceeds',within:'Does not exceed',missing:'No data',unknown:'No objective'}[d.status]} · ${d.values.length?'Range '+fmt(d3.min(d.values))+'–'+fmt(d3.max(d.values))+' '+p.unit:'No observations'} · ${d.spot} aggregated spot value${d.spot===1?'':'s'} · Bounds ${bounds}${d.count>1?' · '+d.count+' time intervals combined for display':''}`;
  s.selectAll('.time-state').data(groups).join('rect').attr('class','time-state').attr('x',5).attr('y',d=>y(d.b)).attr('width',32).attr('height',d=>Math.max(.5,y(d.a)-y(d.b)-(bins.length<=31?.4:0))).attr('fill',d=>d.status==='outside'?'#c95050':d.status==='within'?'#b8d9c4':`url(#${patternId})`).on('pointermove',(event,d)=>{button.title=description(d);stage.querySelector('.spatial-status').textContent=description(d)}).append('title').text(description);
  button.onfocus=()=>{stage.querySelector('.spatial-status').textContent=`${p.label} · ${state.selectedResolution} states · earliest at bottom, latest at top · click for temporal detail`};
  s.append('text').attr('x',21).attr('y',110).attr('text-anchor','middle').text('Time ↑');
 }
 function update(){
  const codes=multi?[...state.selectedParameters]:[state.selectedParameter];
  const key=[state.selectedResolution,+state.rangeStart,+state.rangeEnd,codes.join(',')].join('|');
  if(key!==lastKey){lastKey=key;const view=allTemporal();
   const domains=new Map(codes.map(code=>[code,sharedDomain(view.continuous.filter(r=>r.parameter_code===code),view.spot.filter(r=>r.parameter_code===code),[])]));
   for(const {plot,site} of entries.values()){plot.replaceChildren();if(multi){for(const code of codes)drawGlyph(plot,site,code,view)}else drawTemporal(plot,site,codes[0],view,domains.get(codes[0]));}
  }
  for(const [id,{card}] of entries){card.classList.toggle('hovered',state.hoveredSite===id);card.classList.toggle('selected',state.selectedSite===id||(state.compareMode&&state.comparedSites?.has(id)));}
  layout();
 }
 function action(name){if(name==='in'||name==='out')camera=zoomAt(camera,camera.zoom*(name==='in'?1.2:1/1.2),viewport.clientWidth/2,viewport.clientHeight/2);else if(name==='reset')camera=fitCamera(viewport.clientWidth,viewport.clientHeight);else{camera.x+=({left:160,right:-160}[name]||0);camera.y+=({up:130,down:-130}[name]||0)}layout()}
 for(const control of [stage.querySelector('.spatial-navigation'),mini.querySelector('.mini-controls')])control.addEventListener('click',e=>{if(e.target.dataset.action)action(e.target.dataset.action)});
 viewport.addEventListener('keydown',e=>{const name={ArrowLeft:'left',ArrowRight:'right',ArrowUp:'up',ArrowDown:'down','+':'in','-':'out'}[e.key];if(name&&e.target===viewport){e.preventDefault();action(name)}});
 let start;viewport.addEventListener('pointerdown',e=>{if(e.button!==0)return;dragging=true;moved=false;start={x:e.clientX,y:e.clientY,camera:{...camera}}});
 viewport.addEventListener('pointermove',e=>{if(!dragging)return;const dx=e.clientX-start.x,dy=e.clientY-start.y;if(Math.hypot(dx,dy)>5||moved){moved=true;viewport.setPointerCapture(e.pointerId);camera={...start.camera,x:start.camera.x+dx,y:start.camera.y+dy};layout()}});
 for(const event of ['pointerup','pointercancel'])viewport.addEventListener(event,()=>{dragging=false;setTimeout(()=>moved=false,0)});
 viewport.addEventListener('wheel',e=>{e.preventDefault();const r=viewport.getBoundingClientRect();if(e.ctrlKey)camera=zoomAt(camera,camera.zoom*Math.exp(-e.deltaY*.012),e.clientX-r.left,e.clientY-r.top);else{camera.x-=e.deltaX;camera.y-=e.deltaY}layout()},{passive:false});
 const miniEl=svg.node();let miniDrag;
 const point=e=>{const r=miniEl.getBoundingClientRect();return{x:e.clientX-r.left,y:e.clientY-r.top}};
 miniEl.addEventListener('pointerdown',e=>{if(e.button!==0||e.target.closest('.mini-site'))return;const p=point(e);if(!e.target.classList.contains('mini-viewport-rectangle')){camera.x=viewport.clientWidth/2-worldX.invert(p.x)*camera.zoom;camera.y=viewport.clientHeight/2-worldY.invert(p.y)*camera.zoom;layout()}miniDrag={p,camera:{...camera}};miniEl.setPointerCapture(e.pointerId)});
 miniEl.addEventListener('pointermove',e=>{if(!miniDrag||!miniEl.hasPointerCapture(e.pointerId))return;const p=point(e);camera={...miniDrag.camera,x:miniDrag.camera.x-(worldX.invert(p.x)-worldX.invert(miniDrag.p.x))*camera.zoom,y:miniDrag.camera.y-(worldY.invert(p.y)-worldY.invert(miniDrag.p.y))*camera.zoom};layout()});
 for(const type of ['pointerup','pointercancel'])miniEl.addEventListener(type,()=>{miniDrag=null});
 miniEl.addEventListener('wheel',e=>{e.preventDefault();const p=point(e),ax=worldX.invert(p.x)*camera.zoom+camera.x,ay=worldY.invert(p.y)*camera.zoom+camera.y;camera=zoomAt(camera,camera.zoom*Math.exp(-e.deltaY*.005),ax,ay);layout()},{passive:false});
 miniEl.addEventListener('keydown',e=>{if(e.target!==miniEl)return;const name={ArrowLeft:'left',ArrowRight:'right',ArrowUp:'up',ArrowDown:'down','+':'in','-':'out'}[e.key];if(name){e.preventDefault();action(name)}});
 const observer=new ResizeObserver(()=>{drawMini();layout()});observer.observe(viewport);observer.observe(miniEl);
 drawMini();update();return {update,focus,renderOverview:(host,site)=>{host.replaceChildren();const view=allTemporal();for(const code of state.selectedParameters)drawGlyph(host,site,code,view,"detail")},resize:()=>{drawMini();layout()},scheduleLayout:layout};
}
