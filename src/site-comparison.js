import * as d3 from 'd3';
import {sensorSegments,pixelSample} from './temporal-map-model.js';
import {COMPARISON_COLOURS as COLORS} from './visual-encodings.js';
const SHAPES=[d3.symbolCircle,d3.symbolSquare,d3.symbolTriangle,d3.symbolDiamond,d3.symbolCross];
export function drawComparison({data,state,colours,onRemove}) {
 const host=document.querySelector('#site-detail');host.innerHTML='<h3>Compare sites</h3><div class="comparison-legend"></div><div class="comparison-chart"></div><div class="comparison-tip" role="status" hidden></div><p class="comparison-hint">Hover to inspect · Click the plot to pin a date · Select up to five sites</p>';
 const p=data.availability.parameters.find(p=>p.code===state.selectedParameter),series=[...state.comparedSites].map(([id,slot])=>({site:data.sites.find(s=>s.site_id===id),slot,sensor:data.temporalView.continuous.filter(r=>r.site_id===id&&r.parameter_code===p.code),spot:data.temporalView.spot.filter(r=>r.site_id===id&&r.parameter_code===p.code&&Number.isFinite(r.value))}));
 const all=series.flatMap(s=>[...s.sensor,...s.spot]).filter(r=>Number.isFinite(r.value));
 const parameter=document.createElement('div');parameter.className='comparison-parameter';parameter.style.setProperty('--comparison-parameter-colour',colours[p.code]);
 const parameterName=document.createElement('strong');parameterName.textContent=p.label;
 const parameterUnit=document.createElement('span');parameterUnit.textContent=p.unit;
 parameter.append(parameterName,parameterUnit);host.querySelector('h3').after(parameter);
 const title=document.createElement('p');title.className='comparison-subtitle';title.textContent=state.selectedResolution+' · '+d3.timeFormat('%d %b %Y')(state.rangeStart)+' — '+d3.timeFormat('%d %b %Y')(state.rangeEnd);parameter.after(title);
 const w=Math.max(248,host.clientWidth),h=180,x=d3.scaleTime().domain([state.rangeStart,state.rangeEnd]).range([48,w-12]);let [lo,hi]=d3.extent(all,r=>r.value);lo=Number.isFinite(lo)?Math.min(0,lo):0;hi=Number.isFinite(hi)?hi:1;const y=d3.scaleLinear().domain([lo,hi+(hi-lo||1)*.08]).nice().range([h-35,22]);
 const svg=d3.select(host.querySelector('.comparison-chart')).append('svg').attr('viewBox',`0 0 ${w} ${h}`).attr('width',w).attr('height',h).attr('role','img').attr('aria-label','Comparison of '+p.label+' at selected sites');
 svg.append('g').attr('transform','translate(48,0)').call(d3.axisLeft(y).ticks(4).tickFormat(d3.format('.3~g')));svg.append('g').attr('transform',`translate(0,${h-35})`).call(d3.axisBottom(x).ticks(3).tickFormat(d3.timeFormat('%d %b')));
 for(const s of series){
  const button=document.createElement('button');button.type='button';button.textContent=['●','■','▲','◆','✚'][s.slot]+' '+s.site.short_name+' ×';button.style.color=COLORS[s.slot];button.setAttribute('aria-label','Remove '+s.site.short_name+' from comparison');button.onclick=()=>onRemove(s.site.site_id);host.querySelector('.comparison-legend').append(button);
  const segments=sensorSegments(s.sensor,state.selectedResolution).map(a=>pixelSample(a,x));
  for(const a of segments)svg.append('path').datum(a).attr('d',d3.line().x(r=>x(r.dateValue)).y(r=>y(r.value))).attr('fill','none').attr('stroke',COLORS[s.slot]).attr('stroke-width',1.7).attr('stroke-dasharray',s.slot?`${2+s.slot*2} 2`:null);
  const points=[...s.spot,...segments.flatMap(a=>a.length===1?a:[])];svg.append('g').selectAll('path').data(points).join('path').attr('d',d3.symbol().type(SHAPES[s.slot]).size(28)).attr('transform',r=>`translate(${x(r.dateValue||r.datetimeValue)},${y(r.value)})`).attr('fill',COLORS[s.slot]);
 }
 if(!all.length)svg.append('text').attr('x',w/2).attr('y',h/2).attr('text-anchor','middle').text(series.length?'No data in selected period':'Select sites to compare');
 const guide=svg.append('line').attr('y1',22).attr('y2',h-35).attr('stroke','#7e9687').attr('visibility','hidden');
 const tip=host.querySelector('.comparison-tip');
 const hint=host.querySelector('.comparison-hint');
 const prepared=series.map(s=>({...s,rows:[...s.sensor,...s.spot].filter(r=>Number.isFinite(r.value)).sort((a,b)=>(a.dateValue||a.datetimeValue)-(b.dateValue||b.datetimeValue))}));
 function inspect(px) {
  px=Math.max(48,Math.min(w-12,px));
  const date=x.invert(px);
  guide.attr('x1',px).attr('x2',px).attr('visibility','visible');
  tip.replaceChildren();
  for(const s of prepared){
   const line=document.createElement('div');
   const name=document.createElement('strong');name.style.color=COLORS[s.slot];name.textContent=['●','■','▲','◆','✚'][s.slot]+' '+s.site.short_name;
   const reading=document.createElement('span');
   if(!s.rows.length) reading.textContent='No data in selected period';
   else {
    const r=s.rows[d3.bisector(r=>r.dateValue||r.datetimeValue).center(s.rows,date)];
    reading.textContent=d3.format('.4~g')(r.value)+' '+p.unit+' · '+d3.timeFormat('%b %Y')(r.dateValue||r.datetimeValue)+' · aggregated spot observations';
   }
   line.append(name,reading);tip.append(line);
  }
  if(!prepared.length)tip.textContent='Select sites to compare';
  tip.hidden=false;
 }
 let pinnedX=null;
 const hide=()=>{if(pinnedX!==null)return;tip.hidden=true;guide.attr('visibility','hidden')};
 const togglePin=px=>{if(pinnedX!==null){pinnedX=null;tip.classList.remove('pinned');hint.textContent='Hover to inspect · Click the plot to pin a date · Select up to five sites';svg.select('.comparison-hit').attr('aria-pressed','false');hide()}else{pinnedX=Math.max(48,Math.min(w-12,px));keyboardX=pinnedX;inspect(pinnedX);tip.classList.add('pinned');hint.textContent='Date pinned · Click the plot again or press Escape to release';svg.select('.comparison-hit').attr('aria-pressed','true');}};
 let keyboardX=(w+36)/2;
 svg.append('rect').attr('class','comparison-hit').attr('x',48).attr('y',22).attr('width',w-60).attr('height',h-57).attr('fill','transparent')
  .attr('tabindex',0).attr('role','button').attr('aria-pressed','false').attr('aria-label','Inspect comparison observations. Click or press Enter to pin a date; click again or press Escape to release. Use left and right arrows to inspect.')
  .on('pointermove',function(e){if(pinnedX===null)inspect(d3.pointer(e,this)[0])})
  .on('click',function(e){togglePin(d3.pointer(e,this)[0])})
  .on('pointerleave',hide).on('focus',()=>{if(pinnedX===null)inspect(keyboardX)}).on('blur',hide)
  .on('keydown',e=>{if(e.key==='Escape'){if(pinnedX!==null)togglePin(pinnedX);else hide()}else if(e.key==='Enter'||e.key===' '){e.preventDefault();togglePin(keyboardX)}else if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();keyboardX=Math.max(48,Math.min(w-12,keyboardX+(e.key==='ArrowRight'?8:-8)));if(pinnedX!==null)pinnedX=keyboardX;inspect(keyboardX)}});
}
