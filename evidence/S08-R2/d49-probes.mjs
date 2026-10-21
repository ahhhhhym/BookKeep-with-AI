// S08-R2 acceptance collector only. No product/test modifications; synthetic isolated data.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {ROOT,electronExecutable,electronSafeEnv} from '../../scripts/lib/paths.mjs';
const {_electron}=createRequire(path.join(process.env.BOOKKEEP_QA_NODE_MODULES,'__qa__.cjs'))('playwright');
const Database=createRequire(import.meta.url)('better-sqlite3');
const target=path.join(ROOT,'evidence/S08-R2/d49/run2');mkdirSync(target,{recursive:true});
const report={ok:false,startedAt:new Date().toISOString(),branches:[],checks:[],pageErrors:[],warnings:[],ac07C:'未执行，待S11/G3验证、S17复验'};
let app,page,branch;
const filter={dateStart:null,dateEnd:null,categoryIds:[],nameQuery:null,deleted:'active'};
const shift=(s,n)=>new Date(Date.parse(s+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
function check(id,detail={}){report.checks.push({id,ok:true,detail});console.log('PASS '+id);}
let sequence=0;
function flush(){writeFileSync(path.join(target,`checkpoint-${String(++sequence).padStart(3,'0')}.json`),JSON.stringify(report,null,2)+'\n',{flag:'wx'});}
async function raw(group,method,input){
 const response=await page.evaluate(async ({group,method,input})=>window.bookkeep[group][method](input),{group,method,input});
 branch.ipc.push({at:new Date().toISOString(),group,method,input,response});return response;
}
async function api(group,method,input){const r=await raw(group,method,input);assert.equal(r.ok,true,JSON.stringify(r));return r.data;}
async function launch(){
 app=await _electron.launch({executablePath:electronExecutable(),args:[ROOT],cwd:ROOT,env:electronSafeEnv({LOCALAPPDATA:branch.localAppData})});
 page=await app.firstWindow();page.setDefaultTimeout(15000);await page.context().setOffline(true);
 page.on('pageerror',e=>report.pageErrors.push({branch:branch.name,error:e.message}));
 page.on('console',m=>{if(['warning','error'].includes(m.type()))report.warnings.push({branch:branch.name,type:m.type(),message:m.text()});});
 await page.locator('[data-ledger-total]').waitFor();
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1280,900));
 branch.launches.push({at:new Date().toISOString(),pid:app.process().pid,url:page.url(),title:await page.title(),offlineSimulation:await page.evaluate(()=>!navigator.onLine)});
}
async function close(){if(app){await app.close();app=null;}}
async function begin(name){await close();branch={name,localAppData:mkdtempSync(path.join(tmpdir(),'BookKeepAI S08-R2 '+name+' 中文 ')),ipc:[],snapshots:[],launches:[],aliases:{}};report.branches.push(branch);await launch();}
async function restart(){await close();await launch();}
async function waitTotal(selector,value){await page.waitForFunction(({selector,value})=>document.querySelector(selector)?.getAttribute(selector.slice(1,-1))===value,{selector,value:String(value)});}
async function snap(label){
 const file=branch.name+'-'+label+'.png';
 const b=await app.evaluate(async ({BrowserWindow})=>(await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64'));
 writeFileSync(path.join(target,file),Buffer.from(b,'base64'));return file;
}
function sql(){
 const base=path.join(branch.localAppData,'BookKeepAI'),active=JSON.parse(readFileSync(path.join(base,'data/active.json'),'utf8'));
 const databasePath=path.join(base,'data/generations',active.generationId,'ledger.db');
 const db=new Database(databasePath,{readonly:true});
 const queries={ledgers:'SELECT id,name,currency,timezone FROM ledger',categories:'SELECT id,name,enabled,version FROM category ORDER BY id',rows:'SELECT id,name,amount_fen,typeof(amount_fen) AS storage_type,occurred_date,occurred_time,time_precision,category_id,deleted_at,version FROM "transaction" ORDER BY id',active:'SELECT COUNT(*) AS count,CAST(COALESCE(SUM(amount_fen),0) AS TEXT) AS totalFen FROM "transaction" WHERE deleted_at IS NULL',deleted:'SELECT COUNT(*) AS count,CAST(COALESCE(SUM(amount_fen),0) AS TEXT) AS totalFen FROM "transaction" WHERE deleted_at IS NOT NULL',byDate:'SELECT occurred_date,CAST(SUM(amount_fen) AS TEXT) AS totalFen FROM "transaction" WHERE deleted_at IS NULL GROUP BY occurred_date ORDER BY occurred_date',byCategory:'SELECT category_id,CAST(SUM(amount_fen) AS TEXT) AS totalFen FROM "transaction" WHERE deleted_at IS NULL GROUP BY category_id ORDER BY SUM(amount_fen) DESC,category_id',types:'SELECT typeof(amount_fen) AS type,COUNT(*) AS count FROM "transaction" GROUP BY typeof(amount_fen)'};
 try{const r={databasePath,readOnly:true,queries};for(const [k,q]of Object.entries(queries))r[k]=db.prepare(q).all();r.integrity=db.pragma('integrity_check');r.quick=db.pragma('quick_check');r.foreignKeys=db.pragma('foreign_key_check');
  assert.equal(r.ledgers.length,1);assert.equal(r.ledgers[0].currency,'CNY');assert.equal(r.ledgers[0].timezone,'Asia/Shanghai');assert.equal(r.categories.length,34);assert.ok(!r.categories.some(c=>c.name==='设置'));assert.deepEqual(r.quick,[{quick_check:'ok'}]);assert.deepEqual(r.integrity,[{integrity_check:'ok'}]);assert.deepEqual(r.foreignKeys,[]);assert.ok(r.rows.every(t=>t.storage_type==='integer'));return r;
 }finally{db.close();}
}
async function add(alias,date,name,categoryId,amountFen,time=null){const t=(await api('transaction','create',{occurredDate:date,name,categoryId,amountFen,occurredTime:time,timePrecision:time?'minute':'date',merchant:null,note:null})).transaction;branch.aliases[alias]=t.id;return t;}
async function seed(){for(const r of [['T001','2026-09-08','午餐','cat_food',1800],['T002','2026-09-08','购买水果','cat_fruit',1626],['T003','2026-09-08','晚餐','cat_food',1000],['T004','2026-09-09','iPad维修','cat_repair',85000],['T005','2026-09-09','iPad保护膜','cat_digital',5554],['T006','2026-09-09','午餐','cat_food',1550]])await add(...r);}
async function transaction(alias,deleted='active'){return (await api('transaction','list',{filter:{...filter,deleted},page:{limit:100,cursor:null}})).items.find(t=>t.id===branch.aliases[alias]);}
function range(period,anchor){if(period==='year')return [anchor.slice(0,4)+'-01-01',(Number(anchor.slice(0,4))+1)+'-01-01'];if(period==='month'){const y=Number(anchor.slice(0,4)),m=Number(anchor.slice(5,7));return [anchor.slice(0,7)+'-01',`${m===12?y+1:y}-${String(m===12?1:m+1).padStart(2,'0')}-01`];}const d=new Date(anchor+'T00:00:00Z').getUTCDay();const s=shift(anchor,-((d||7)-1));return [s,shift(s,7)];}
const sum=rows=>rows.reduce((n,r)=>n+BigInt(r.amount_fen),0n);
function rank(rows){const m=new Map();for(const r of rows)m.set(r.category_id,(m.get(r.category_id)||0n)+BigInt(r.amount_fen));return [...m].sort((a,b)=>a[1]===b[1]?(a[0]<b[0]?-1:1):a[1]>b[1]?-1:1).map(([id,fen])=>[id,String(fen)]);}
function avg(fen,days){const v=(BigInt(fen)*2n+BigInt(days))/(2n*BigInt(days));return `${v/100n}.${String(v%100n).padStart(2,'0')}`;}
async function reconcile(period,anchor,db){
 const request={period,anchorDate:anchor,categoryIds:[],snapshotRevision:null};
 const series=await api('statistics','series',request),bound={...request,snapshotRevision:series.scope.revision};
 const summary=await api('statistics','summary',bound),ranking=await api('statistics','topCategories',{...bound,pointMonth:null});
 const [start,end]=range(period,anchor),today=series.scope.today,effectiveEnd=end<shift(today,1)?end:shift(today,1);
 const rows=db.rows.filter(r=>!r.deleted_at&&r.occurred_date>=start&&r.occurred_date<effectiveEnd),total=String(sum(rows)),days=(Date.parse(effectiveEnd)-Date.parse(start))/86400000;
 const list=await api('transaction','list',{filter:{...filter,dateStart:start,dateEnd:effectiveEnd},page:{limit:2,cursor:null}});
 assert.deepEqual([series.totalFen,summary.totalFen,ranking.totalFen,list.filteredTotalFen],Array(4).fill(total));
 assert.deepEqual(summary.dailyAverage,{numeratorFen:total,denominatorDays:days,displayYuan:avg(total,days)});
 assert.deepEqual(ranking.items.map(r=>[r.categoryId,r.totalFen]),rank(rows));
 const points=[];for(let d=start;d<end;d=period==='year'?range('month',d)[1]:shift(d,1)){const key=period==='year'?d.slice(0,7):d;points.push([key,String(sum(rows.filter(r=>r.occurred_date.startsWith(key)))),d>today]);}
 assert.deepEqual(series.points.map(p=>[p.pointKey,p.amountFen,p.isFuture]),points);
 const details=[];
 for(const point of period==='year'?['2026-09']:['2026-09-08','2026-09-09','2026-09-10','2026-09-27']){
  if(!series.points.some(p=>p.pointKey===point&&!p.isFuture))continue;
  const matched=rows.filter(r=>r.occurred_date.startsWith(point));
  if(period==='year'){
   const actual=await api('statistics','topCategories',{...bound,pointMonth:point});assert.equal(actual.totalFen,String(sum(matched)));assert.deepEqual(actual.items.map(r=>[r.categoryId,r.totalFen]),rank(matched).slice(0,3));details.push(actual);
  }else{
   const actual=await api('statistics','topTransactions',{...bound,pointDate:point});
   const expected=[...matched].sort((a,b)=>b.amount_fen-a.amount_fen||(a.occurred_time===null)-(b.occurred_time===null)||(a.occurred_time===b.occurred_time?0:a.occurred_time>b.occurred_time?-1:1)||(a.id<b.id?-1:1)).slice(0,3);
   assert.equal(actual.pointTotalFen,String(sum(matched)));assert.deepEqual(actual.items.map(r=>r.transactionId),expected.map(r=>r.id));details.push(actual);
  }
 }
 return {request,series,summary,ranking,list,details,independent:{start,end,effectiveEnd,today,totalFen:total,denominatorDays:days,dailyAverage:avg(total,days),ranking:rank(rows),points}};
}
async function snapshot(label,expected,anchor='2026-09-08'){
 const db=sql();assert.equal(db.active[0].totalFen,String(expected));
 await page.reload();await waitTotal('[data-ledger-total]',expected);
 const record={label,at:new Date().toISOString(),sql:db,ui:{ledgerText:await page.locator('main').innerText(),ledgerScreenshot:await snap(label+'-list')},periods:[]};
 branch.snapshots.push(record);flush();
 await page.getByRole('button',{name:'统计',exact:true}).click();await page.locator('[data-statistics-total]').waitFor();
 for(const [period,name]of [['week','周'],['month','月'],['year','年']]){
  const r=await reconcile(period,anchor,db);record.periods.push(r);
  await page.getByRole('group',{name:'统计周期',exact:true}).getByRole('button',{name,exact:true}).click();
  await page.getByLabel('选择周期日期',{exact:true}).fill(anchor);await page.getByRole('button',{name:'选择周期',exact:true}).click();
  await waitTotal('[data-statistics-total]',r.independent.totalFen);
  await page.waitForFunction(value=>document.querySelector('[data-daily-average]')?.textContent===value,'¥'+r.independent.dailyAverage);
  assert.equal(await page.locator('[data-daily-average]').innerText(),'¥'+r.independent.dailyAverage);
  r.uiText=await page.locator('main').innerText();r.screenshot=await snap(label+'-'+period);
 }
 check(branch.name+'/'+label,{expectedFen:String(expected),scopes:record.periods.length});flush();return record;
}
try{
 await begin('AC01');const empty=sql();assert.equal(empty.active[0].count,0);
 const a=await api('ledger','ensureDefault'),b=await api('ledger','ensureDefault');
 await page.getByRole('button',{name:'分类',exact:true}).click();await page.getByText('共 34 个分类',{exact:false}).waitFor();
 branch.categoryText=await page.locator('main').innerText();branch.categoryScreenshot=await snap('34-categories');branch.empty=empty;branch.repeated=[a,b];
 await restart();assert.deepEqual(sql().ledgers,empty.ledgers);assert.deepEqual(sql().categories,empty.categories);check('AC01/default-repeat-and-restart');
 await begin('F01');await add('T101','2026-09-27','双荟','cat_food',480,'18:00');await add('T102','2026-09-27','晚餐','cat_food',1500,'19:00');await add('T103','2026-09-27','午餐','cat_food',1350,'12:00');
 await snapshot('baseline',3330,'2026-09-27');
 let t=await transaction('T101');await api('transaction','update',{id:t.id,expectedVersion:t.version,patch:{amountFen:500}});await snapshot('edit',3350,'2026-09-27');
 t=await transaction('T102');await api('transaction','softDelete',{id:t.id,expectedVersion:t.version});await snapshot('delete',1850,'2026-09-27');
 t=await transaction('T102','deleted');await api('transaction','restore',{id:t.id,expectedVersion:t.version});await snapshot('restore',3350,'2026-09-27');
 t=await transaction('T101');await api('transaction','update',{id:t.id,expectedVersion:t.version,patch:{amountFen:480}});await restart();await snapshot('reverted-restart',3330,'2026-09-27');
 await begin('F02');await seed();const base=await snapshot('baseline',96530);assert.deepEqual(base.sql.byDate.map(r=>r.totalFen),['4426','92104']);assert.deepEqual(base.sql.byCategory.map(r=>r.totalFen),['85000','5554','4350','1626']);
 await restart();await snapshot('restart',96530);
 await begin('F03-I-B-T241');await seed();await snapshot('before',96530);
 t=await add('T241','2026-09-09','软删隔离测试','cat_food',10000);await api('transaction','softDelete',{id:t.id,expectedVersion:t.version});
 const s241=await snapshot('softdeleted',96530);assert.deepEqual(s241.sql.deleted,[{count:1,totalFen:'10000'}]);
 branch.deletedList=await api('transaction','list',{filter:{...filter,deleted:'deleted'},page:{limit:100,cursor:null}});assert.equal(branch.deletedList.filteredTotalFen,'10000');assert.equal(branch.deletedList.totalCount,1);
 await restart();await snapshot('restart',96530);
 await begin('F03-I-B-delete-restore');await seed();await snapshot('before',96530);
 t=await transaction('T004');await api('transaction','softDelete',{id:t.id,expectedVersion:t.version});await snapshot('deleted',11530);
 t=await transaction('T004','deleted');await api('transaction','restore',{id:t.id,expectedVersion:t.version});await snapshot('restored',96530);
 t=await transaction('T004');await api('transaction','restore',{id:t.id,expectedVersion:t.version});await snapshot('duplicate-restore',96530);
 await restart();await snapshot('restart',96530);
 await begin('F03-I-B-edit');await seed();await snapshot('before',96530);
 t=await transaction('T006');const old={...t};await api('transaction','update',{id:t.id,expectedVersion:t.version,patch:{amountFen:2000}});
 const edited=await snapshot('edited',96980);assert.equal(edited.sql.byDate.find(r=>r.occurred_date==='2026-09-09').totalFen,'92554');assert.equal(edited.sql.byCategory.find(r=>r.category_id==='cat_food').totalFen,'4800');
 const conflict=await raw('transaction','update',{id:old.id,expectedVersion:old.version,patch:{amountFen:1550}});assert.equal(conflict.ok,false);assert.equal(conflict.error.code,'VERSION_CONFLICT');await snapshot('old-version-rejected',96980);await restart();await snapshot('restart',96980);
 await begin('F03-I-B-category');await seed();await snapshot('before',96530);
 t=(await api('category','list',{includeDisabled:true})).categories.find(c=>c.id==='cat_food');t=(await api('category','update',{id:t.id,expectedVersion:t.version,patch:{name:'用餐'}})).category;
 await api('category','disable',{id:t.id,expectedVersion:t.version});await snapshot('renamed-disabled',96530);
 await page.getByRole('button',{name:'记账',exact:true}).click();await page.getByRole('button',{name:'记一笔',exact:true}).first().click();assert.equal(await page.locator('#expense-categoryId option[value="cat_food"]').count(),0);await page.keyboard.press('Escape');
 await page.getByRole('button',{name:'编辑 午餐',exact:true}).first().click();assert.equal(await page.locator('#expense-categoryId').inputValue(),'cat_food');await page.getByRole('button',{name:'保存支出',exact:true}).click();await page.getByRole('dialog').waitFor({state:'hidden'});
 t=await transaction('T001');await api('transaction','softDelete',{id:t.id,expectedVersion:t.version});t=await transaction('T001','deleted');await api('transaction','restore',{id:t.id,expectedVersion:t.version});
 const other=(await api('category','list',{includeDisabled:true})).categories.find(c=>c.id==='cat_other');const protectedOther=await raw('category','disable',{id:other.id,expectedVersion:other.version});assert.equal(protectedOther.ok,false);
 await restart();await snapshot('restart',96530);check('category/disabled-not-new-keep-edit-restore-other-protected');
 await begin('F03-I-B-pagination');await seed();await snapshot('before',96530);
 let cursor=null;const pages=[],ids=[];do{const r=await api('transaction','list',{filter,page:{limit:2,cursor}});pages.push(r);ids.push(...r.items.map(t=>t.id));cursor=r.nextCursor;}while(cursor);
 assert.equal(ids.length,6);assert.equal(new Set(ids).size,6);branch.pagination=pages;
 const and=await api('transaction','list',{filter:{...filter,dateStart:'2026-09-08',dateEnd:'2026-09-10',nameQuery:'午餐',categoryIds:['cat_food']},page:{limit:2,cursor:null}});assert.equal(and.filteredTotalFen,'3350');assert.equal(and.totalCount,2);
 for(const nameQuery of ['%','_']){const r=await api('transaction','list',{filter:{...filter,nameQuery},page:{limit:2,cursor:null}});assert.equal(r.totalCount,0);}
 await restart();await snapshot('restart',96530);check('F03-I-B/pagination-AND-literal-search');
 await begin('actual-current');const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());branch.actualShanghaiDate=today;
 await add('Y',shift(today,-1),'昨天合成支出','cat_food',1000);await add('T',today,'今天合成支出','cat_food',2000);await add('F',shift(today,1),'明天合成支出','cat_food',3000);await add('N','2026-11-01','下月合成支出','cat_food',4000);
 const current=await snapshot('current',10000,today);assert.ok(current.ui.ledgerText.includes('今天'));assert.ok(current.ui.ledgerText.includes('昨天'));assert.ok(current.ui.ledgerText.includes('时间未记录'));
 await page.getByRole('group',{name:'统计周期',exact:true}).getByRole('button',{name:'周',exact:true}).click();await page.getByLabel('选择周期日期',{exact:true}).fill(today);await page.getByRole('button',{name:'选择周期',exact:true}).click();await waitTotal('[data-statistics-total]',3000);
 await page.locator(`[data-point-key="${shift(today,1)}"] rect`).click();await page.getByRole('region',{name:'统计点详情',exact:true}).getByText('尚未到来',{exact:true}).waitFor();branch.futureScreenshot=await snap('future-detail');branch.futureText=await page.locator('main').innerText();check('actual-current/Shanghai-date-denominators-future-no-detail');
 assert.deepEqual(report.pageErrors,[]);report.ok=true;
}catch(e){report.error=e.stack;process.exitCode=1;console.error(e);if(page&&!page.isClosed())report.failureScreenshot=await snap('failure').catch(()=>null);}
finally{await close().catch(()=>{});report.finishedAt=new Date().toISOString();flush();writeFileSync(path.join(target,'results.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({ok:report.ok,checks:report.checks.length,branches:report.branches.length,error:report.error||null}));}
