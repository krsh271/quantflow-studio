// Quantflow historical Forex Factory USD high-impact calendar.
// Only returns complete=true when event dates and impact classes were verified for EVERY week.
const cheerio = require('cheerio');
const MONTH = {jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11};
const iso = d=>d.toISOString().slice(0,10);
const monday = d=>new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate()-((d.getUTCDay()+6)%7)));
const weekString = d=>d.toLocaleString('en-US',{month:'short',timeZone:'UTC'}).toLowerCase()+d.getUTCDate()+'.'+d.getUTCFullYear();
const text = s=>String(s||'').replace(/\s+/g,' ').trim();
function dateFromLabel(label,week){
 const m=text(label).match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\s+(\d{1,2})(?:\s*,?\s*(\d{4}))?/i);
 if(!m)return null;
 let y=Number(m[3]||week.getUTCFullYear()),mo=MONTH[m[1].toLowerCase()],day=Number(m[2]);
 let d=new Date(Date.UTC(y,mo,day));
 if(!m[3]&&Math.abs(d-week)>20*86400000)d=new Date(Date.UTC(y+(d<week?1:-1),mo,day));
 return iso(d);
}
function classifyImpact($,row){
 const c=$(row).find('td.calendar__impact, td[class*="impact"], [data-impact]').first();
 if(!c.length)return 'unknown';
 const parts=[c.attr('class'),c.attr('title'),c.attr('data-impact'),c.attr('aria-label'),c.find('[class]').map((_,e)=>$(e).attr('class')).get().join(' '),c.find('[title]').map((_,e)=>$(e).attr('title')).get().join(' '),c.find('[aria-label]').map((_,e)=>$(e).attr('aria-label')).get().join(' '),c.html(),c.text()].filter(Boolean).join(' ').toLowerCase();
 // Forex Factory uses colored CSS impact icons; inspecting only the td title misses them.
 if(/(?:ff-impact|impact|folder)[-_\s]*(?:red|high)|(?:red|high)[-_\s]*(?:impact|folder)|high impact expected|data-impact\s*=\s*["']?high/.test(parts))return 'high';
 if(/(?:ff-impact|impact|folder)[-_\s]*(?:ora(?:nge)?|med(?:ium)?)|(?:orange|medium|med)[-_\s]*(?:impact|folder)|med impact expected/.test(parts))return 'medium';
 if(/(?:ff-impact|impact|folder)[-_\s]*(?:yellow|low)|(?:yellow|low)[-_\s]*(?:impact|folder)|low impact expected/.test(parts))return 'low';
 if(/(?:ff-impact|impact|folder)[-_\s]*(?:gray|grey|holiday|none|non[-_\s]?economic)|non[-_\s]?economic/.test(parts))return 'non-economic';
 return 'unknown';
}
function parseCalendar(html,week){
 const $=cheerio.load(html),rows=$('tr.calendar__row, tr.calendar-row, tr[data-eventid], tr[data-event-id]');
 let date='',all=0,usd=0,classified=0,unknown=0,events=[];
 rows.each((_,row)=>{
  const dateLabel=text($(row).find('td.calendar__date').text()||$(row).attr('data-date'));
  if(dateLabel){const parsed=dateFromLabel(dateLabel,week);if(parsed)date=parsed;}
  const title=text($(row).find('td.calendar__event').text());
  const currency=text($(row).find('td.calendar__currency').text()||$(row).attr('data-currency')).toUpperCase();
  if(!date||!title||!currency)return;
  all++;
  const impact=classifyImpact($,row);
  if(currency==='USD'){
   usd++;
   if(impact==='unknown')unknown++;else classified++;
   if(impact==='high')events.push({date,title,currency:'USD',impact:'high'});
  }
 });
 return {all,usd,classified,unknown,events};
}
exports.handler=async function(event){
 const headers={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'};
 const send=(statusCode,data)=>({statusCode,headers,body:JSON.stringify(data)});
 const q=event.queryStringParameters||{};
 if(!/^\d{4}-\d{2}-\d{2}$/.test(q.from||'')||!/^\d{4}-\d{2}-\d{2}$/.test(q.to||''))return send(400,{complete:false,error:'Dates must be YYYY-MM-DD.'});
 const from=new Date(q.from+'T00:00:00Z'),to=new Date(q.to+'T00:00:00Z');
 if(!Number.isFinite(+from)||!Number.isFinite(+to)||iso(from)!==q.from||iso(to)!==q.to||from>to)return send(400,{complete:false,error:'Invalid date range.'});
 if((to-from)/86400000>119)return send(400,{complete:false,error:'Maximum 120 days per scan.'});
 const weeks=[];for(let d=monday(from);d<=to;d=new Date(+d+7*86400000))weeks.push(new Date(d));
 let events=[],audit=[];
 try{
  for(const week of weeks){
   const label=weekString(week),url='https://www.forexfactory.com/calendar?week='+encodeURIComponent(label);
   const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12000);
   let response;try{response=await fetch(url,{headers:{'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36','Accept':'text/html'},signal:controller.signal});}finally{clearTimeout(timer);}
   if(!response.ok)throw new Error(label+' HTTP '+response.status);
   const html=await response.text(),p=parseCalendar(html,week);
   if(!p.all)throw new Error(label+': calendar rows missing (blocked or layout changed)');
   if(!p.usd)throw new Error(label+': no USD events parsed; cannot verify red-folder status');
   if(p.unknown)throw new Error(label+': '+p.unknown+' of '+p.usd+' USD impact icons unrecognised; refusing incomplete news exclusions');
   audit.push({week:label,calendarRows:p.all,usdRows:p.usd,classifiedUsd:p.classified,redUsd:p.events.length});
   events.push(...p.events);
  }
 }catch(err){return send(502,{complete:false,error:'Forex Factory scan unverified: '+err.message});}
 const seen=new Set();events=events.filter(e=>e.date>=q.from&&e.date<=q.to).filter(e=>{const k=e.date+'|'+e.title;if(seen.has(k))return false;seen.add(k);return true;}).sort((a,b)=>a.date.localeCompare(b.date));
 return send(200,{complete:true,source:'Forex Factory',from:q.from,to:q.to,weeks:audit,events});
};
