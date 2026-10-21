import {createRequire} from 'node:module';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import path from 'node:path';
import {ROOT,electronExecutable,electronSafeEnv} from '../../scripts/lib/paths.mjs';
const {_electron}=createRequire(path.join(process.env.BOOKKEEP_QA_NODE_MODULES,'__qa__.cjs'))('playwright');
const source=JSON.parse(readFileSync('evidence/S08-R2/supplemental/results.json','utf8'));
const target='evidence/S08-R2/visual';mkdirSync(target,{recursive:true});const records=[];
for(const [name,period,point]of [['F03-S','月','2026-09-11'],['F03-C','年','2026-09']]){
 const branch=source.branches.find(b=>b.name===name);let app;
 try{
  app=await _electron.launch({executablePath:electronExecutable(),args:[ROOT],cwd:ROOT,env:electronSafeEnv({LOCALAPPDATA:branch.localAppData})});
  const page=await app.firstWindow();page.setDefaultTimeout(15000);await page.locator('[data-ledger-total]').waitFor();await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1280,900));
  await page.getByRole('button',{name:'统计',exact:true}).click();await page.getByRole('group',{name:'统计周期',exact:true}).getByRole('button',{name:period,exact:true}).click();await page.getByLabel('选择周期日期',{exact:true}).fill('2026-09-11');await page.getByRole('button',{name:'选择周期',exact:true}).click();
  await page.locator(`[data-point-key="${point}"] rect`).click();const detail=page.getByRole('region',{name:'统计点详情',exact:true});await detail.locator('.top-items li').first().waitFor();await detail.evaluate(n=>{n.scrollTop=0;n.scrollIntoView({block:'start'});});
  const file=path.join(target,name+'-detail-visible.png');const b=await app.evaluate(async ({BrowserWindow})=>(await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64'));writeFileSync(file,Buffer.from(b,'base64'));
  records.push({name,localAppData:branch.localAppData,point,period,screenshot:file,text:await detail.innerText(),kind:'read-only UI observation; no business writes'});
 }finally{if(app)await app.close();}
}
writeFileSync(path.join(target,'review.json'),JSON.stringify(records,null,2)+'\n');
