import {isIsoDateString} from './date';
import {BILLING_DOCS_URL,DEEPSEEK_BILLING_RULES} from './deepseek-billing-rules';
export interface BillingTarget {provider:'deepseek'|'mock';endpoint:string|null;model:string|null}
export interface BillingDecision {state:'peak'|'off_peak'|'unknown'|'not_applicable';reason:string;verifiedOn:string|null;sourceUrl:string;nextCheckAt:number|null}
type Rules={schemaVersion:number;revision:string;verifiedOn:string;sourceUrl:string;timeZone:string;coverage:{from:string;through:string};expiresAt:string;weekdays:number[];windows:{startMinute:number;endMinute:number}[];officialTargets:{endpoint:string;models:string[]}[];calendar:{year:number;verifiedOn:string;statutorySourceUrl:string;annualSourceUrl:string;confirmedHolidayDates:string[];uncertainHolidayDates:string[];makeUpWorkDates:string[]}[]};
/** Invalid snapshots fail closed to unknown, including accidental calendar truncation. */
function valid(r:Rules):boolean{
 if(r.schemaVersion!==1||!r.revision||r.sourceUrl!==BILLING_DOCS_URL||r.timeZone!=='Asia/Shanghai'||!isIsoDateString(r.verifiedOn)||!isIsoDateString(r.coverage.from)||!isIsoDateString(r.coverage.through)||r.coverage.from>r.coverage.through)return false;
 if(JSON.stringify(r.weekdays)!=='[1,2,3,4,5]'||!Array.isArray(r.windows)||!r.windows.length)return false;
 if(JSON.stringify(r.windows)!==JSON.stringify(DEEPSEEK_BILLING_RULES.windows))return false;
 let last=-1;for(const w of r.windows){if(!Number.isInteger(w.startMinute)||!Number.isInteger(w.endMinute)||w.startMinute<0||w.startMinute<last||w.endMinute<=w.startMinute||w.endMinute>1440)return false;last=w.endMinute;}
 if(!Number.isFinite(Date.parse(r.expiresAt))||Date.parse(r.expiresAt)!==Date.parse(r.coverage.through+'T00:00:00+08:00')+86400000)return false;
 if(!Array.isArray(r.calendar)||!r.calendar.length||new Set(r.calendar.map(c=>c.year)).size!==r.calendar.length)return false;
 for(let year=Number(r.coverage.from.slice(0,4));year<=Number(r.coverage.through.slice(0,4));year++){
  const c=r.calendar.find(c=>c.year===year),expected=DEEPSEEK_BILLING_RULES.calendar.find(c=>Number(c.year)===year);
  if(!c||!expected||!isIsoDateString(c.verifiedOn))return false;
  // This app ships one reviewed calendar. Further years require a reviewed snapshot release.
  for(const key of ['confirmedHolidayDates','uncertainHolidayDates','makeUpWorkDates','statutorySourceUrl','annualSourceUrl'] as const)if(JSON.stringify(c[key])!==JSON.stringify(expected[key]))return false;
 }
 return Array.isArray(r.officialTargets)&&r.officialTargets.length>0&&r.officialTargets.every(t=>t.endpoint==='https://api.deepseek.com/chat/completions'&&t.models.length>0&&t.models.every(m=>m==='deepseek-flash'));
}
export function evaluateDeepSeekBilling(nowMs:number,target:BillingTarget,rules:unknown):BillingDecision{
 const result=(state:BillingDecision['state'],reason:string,verifiedOn:string|null=null,nextCheckAt:number|null=null):BillingDecision=>({state,reason,verifiedOn,sourceUrl:BILLING_DOCS_URL,nextCheckAt});
 if(target.provider==='mock')return result('not_applicable','mock');
 if(target.endpoint&&target.endpoint!=='https://api.deepseek.com/chat/completions')return result('not_applicable','non_official');
 if(!target.endpoint||!target.model)return result('unknown','target_missing');
 try{
  const r=rules as Rules;if(!valid(r)||!Number.isFinite(nowMs))return result('unknown','rules_invalid');
  if(!r.officialTargets.some(t=>t.endpoint===target.endpoint&&t.models.includes(target.model!)))return result('unknown','model_unverified',r.verifiedOn);
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(nowMs));
  const value=(k:string)=>parts.find(p=>p.type===k)!.value;
  const day=`${value('year')}-${value('month')}-${value('day')}`,minute=Number(value('hour'))*60+Number(value('minute'));
  if(day<r.verifiedOn||day<r.coverage.from||day>r.coverage.through||nowMs>=Date.parse(r.expiresAt))return result('unknown','outside_coverage',r.verifiedOn);
  const calendar=r.calendar.find(c=>c.year===Number(value('year')))!;
  if(calendar.verifiedOn>day)return result('unknown','calendar_unverified',r.verifiedOn);
  const midnight=Date.parse(day+'T00:00:00+08:00');
  const next=Math.min(midnight+86400000,Date.parse(r.expiresAt),...r.windows.flatMap(w=>[midnight+w.startMinute*60000,midnight+w.endMinute*60000]).filter(n=>n>nowMs));
  const weekday=new Date(day+'T00:00:00Z').getUTCDay();
  if(weekday===0||weekday===6||calendar.confirmedHolidayDates.includes(day))return result('off_peak','weekend_or_statutory',r.verifiedOn,next);
  if(calendar.uncertainHolidayDates.includes(day))return result('unknown','holiday_interpretation',r.verifiedOn,next);
  return result(r.windows.some(w=>minute>=w.startMinute&&minute<w.endMinute)?'peak':'off_peak','weekday_window',r.verifiedOn,next);
 }catch{return result('unknown','rules_invalid');}
}
