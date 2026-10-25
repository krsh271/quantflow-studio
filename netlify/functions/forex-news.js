// Historical calendar fetcher for the Quantflow news tab.
// Source: Forex Factory public historical calendar pages (no third-party key).
// Site layout / anti-bot measures can change; failures must be explicit.
const cheerio = require('cheerio');
const months={jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12};
const iso=(d)=>d.getUTCFullYear()+'-'+String(d.getUTCMonth()+1).padStart(2,'0')+'-'+String(d.getUTCDate()).padStart(2,'0');
const monday=(d)=>new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate()-((d.getUTCDay()+6)%7)));
const fmtWeek=(d)=>d.toLocaleString('en-US',{month:'short',timeZone:'UTC'}).toLowerCase()+d.getUTCDate()+'.'+d.getUTCFullYear();
function clean(s){return String(s||'').replace(/\s+/g,' ').trim()}
function parseDay(label,contextYear,weekMonday){
  const x=clean(label).match(/(?:Sun|Mon|Tue|Wed|Thu|Fri|Sat)?\s*([A-Za-z]{3})\s+(\d{1,2})(?:\s*,?\s*(\d{4}))?/i);
  if(!x)return null;
  const mo=months[x[1].toLowerCase()];if(!mo)return null;
  let year=Number(x[3]||contextYear);const d=new Date(Date.UTC(year,mo-1,Number(x[2])));
  // week pages spanning a year end contain both December and January
  if(!x[3]&&Math.abs(d-weekMonday)>20*86400000){year+=(d<weekMonday?1:-1);}
  return iso(new Date(Date.UTC(year,mo-1,Number(x[2]))));
}
function impactRed($,el){const cell=$(el).find('td.calendar__impact');const label=[cell.attr('title'),cell.find('[title]').map((_,v)=>$(v).attr('title')).get().join(' '),cell.attr('data-impact'),cell.attr('class'),cell.html()?.match(/calendar__impact[^\"'<> ]*/g)?.join(' '),cell.text()].join(' ').toLowerCase();return /high\s*impact|impact\s*high|red\s*folder|\bhigh\b/.test(label)||cell.find('.high,.impact--high,[data-impact="high"],.calendar__impact--high').length>0;}
function parseCalendar(html,weekMonday){
 const $=cheerio.load(html);let currentDate=null,all=0,impactTagged=0,events=[];
 const rows=$('tr.calendar__row, tr[data-eventid], tr.calendar-row');
 rows.each((_,row)=>{
  const dateCell=$(row).find('td.calendar__date');const title=clean($(row).find('td.calendar__event').text());
  const ds=clean(dateCell.text())||clean($(row).attr('data-date'));if(ds){let next=parseDay(ds,weekMonday.getUTCFullYear(),weekMonday);if(next)currentDate=next;}
  const currency=clean($(row).find('td.calendar__currency').text()||$(row).find('[data-currency]').attr('data-currency')).toUpperCase();
  if(!currency||!title||!currentDate)return;
  all++;if(clean($(row).find('td.calendar__impact').attr('title'))||$(row).find('td.calendar__impact [title]').length||$(row).find('td.calendar__impact [class*=impact]').length)impactTagged++;
  if(currency==='USD'&&impactRed($,row))events.push({date:currentDate,title,currency:'USD',impact:'high'});
 });
 return {all,impactTagged,events};
}
exports.handler=async(event)=>{
 const headers={'Content-Type':'application/json; charset=utf-8','Cache-Control':'public,max-age=1800'};
 const respond=(code,obj)=>({statusCode:code,headers,body:JSON.stringify(obj)});
 const q=event.queryStringParameters||{};
 if(!/^\d{4}-\d{2}-\d{2}$/.test(q.from||'')||!/^\d{4}-\d{2}-\d{2}$/.test(q.to||''))return respond(400,{error:'Both dates must be YYYY-MM-DD.'});
 const from=new Date(q.from+'T00:00:00Z'),to=new Date(q.to+'T00:00:00Z');
 if(!Number.isFinite(from.getTime())||!Number.isFinite(to.getTime())||iso(from)!==q.from||iso(to)!==q.to||from>to)return respond(400,{error:'Invalid date range.'});
 if((to-from)/86400000>119)return respond(400,{error:'Scan up to 120 days at once. Divide longer tests into smaller periods.'});
 const weeks=[];for(let d=monday(from);d<=to;d=new Date(d.getTime()+7*86400000))weeks.push(new Date(d));
 let events=[],counts=[];
 try{
  for(const week of weeks){
   const url='https://www.forexfactory.com/calendar?week='+fmtWeek(week);
   const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),11000);
   let response;
   try{response=await fetch(url,{headers:{'User-Agent':'Mozilla/5.0 (compatible; QuantflowCalendarResearch/1.0)','Accept':'text/html,application/xhtml+xml'},signal:controller.signal});}finally{clearTimeout(timeout);}
   if(!response.ok)throw new Error('Forex Factory returned HTTP '+response.status+' for '+fmtWeek(week));
   const html=await response.text();const parsed=parseCalendar(html,week);if(parsed.all===0)throw new Error('Forex Factory did not return a readable event table for '+fmtWeek(week)+'. Its page may be blocking requests or using a newer layout.');if(parsed.impactTagged===0)throw new Error('Could not verify event impact labels for '+fmtWeek(week)+'; cannot safely classify red-folder dates.');
   counts.push({week:fmtWeek(week),rows:parsed.all});events.push(...parsed.events);
  }
 }catch(err){return respond(502,{error:'Historical scan could not be verified: '+err.message,complete:false});}
 const seen=new Set();events=events.filter(e=>e.date>=q.from&&e.date<=q.to).filter(e=>{let k=e.date+'|'+e.title;if(seen.has(k))return false;seen.add(k);return true;}).sort((a,b)=>a.date.localeCompare(b.date));
 return respond(200,{complete:true,from:q.from,to:q.to,timezone:'Forex Factory calendar page date',source:'Forex Factory',weeks:counts,events});
};
