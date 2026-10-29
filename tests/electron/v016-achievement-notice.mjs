/** Task C: isolated real Electron; renderer frames are machine evidence, not human smoothness. */
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdirSync,mkdtempSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {ROOT,electronExecutable,electronSafeEnv} from '../../scripts/lib/paths.mjs';
const {_electron}=createRequire(path.join(process.env.BOOKKEEP_QA_NODE_MODULES,'qa.cjs'))('playwright');
const out=process.env.BOOKKEEP_QA_OUTPUT;mkdirSync(out,{recursive:true});
const report={ok:false,checks:[],geometry:[],frames:[],errors:[],trace:[],windows:[],screens:[]};let app,page;
const save=()=>writeFileSync(path.join(out,'result.json'),JSON.stringify(report,null,2)+'\n');
const check=(id,data={})=>{report.checks.push({id,data});console.log('PASS '+id);save();};
const sleep=ms=>page.waitForTimeout(ms);
const invoke=async(method,input)=>{const r=await page.evaluate(({method,input})=>{const[g,m]=method.split('.');return window.bookkeep[g][m](input);},{method,input});assert.equal(r.ok,true,JSON.stringify(r));return r.data;};
const notice=()=>page.locator('.achievement-notice');
async function screen(name){const capture=await app.evaluate(async({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0],im=await w.webContents.capturePage();return {png:im.toPNG().toString('base64'),pixels:im.getSize(),content:w.getContentSize(),zoom:w.webContents.getZoomFactor()};});writeFileSync(path.join(out,name),Buffer.from(capture.png,'base64'));delete capture.png;report.screens.push({name,...capture,logical:await page.evaluate(()=>[innerWidth,innerHeight])});}
async function viewport(width,height,zoom=1){await app.evaluate(({BrowserWindow},{width,height,zoom})=>{const w=BrowserWindow.getAllWindows()[0];w.unmaximize();w.webContents.setZoomFactor(zoom);w.setContentSize(width,height);},{width,height,zoom});await sleep(350);report.windows.push(await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0];return {bounds:w.getBounds(),content:w.getContentBounds(),zoom:w.webContents.getZoomFactor(),minimum:w.getMinimumSize()};}));}
async function geometry(label,center=true){
 const g=await notice().evaluate(e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e),link=e.querySelector('.achievement-notice-link'),close=e.querySelector('.achievement-notice-close');return {rect:r.toJSON(),viewport:[innerWidth,innerHeight],dx:(r.left+r.right-innerWidth)/2,dy:(r.top+r.bottom-innerHeight)/2,padding:s.padding,width:r.width,scrollHeight:e.scrollHeight,clientHeight:e.clientHeight,overflow:s.overflow,font:[getComputedStyle(link.querySelector('strong')).fontSize,getComputedStyle(link.querySelector('span')).fontSize],close:close.getBoundingClientRect().toJSON(),visibility:s.visibility};});
 report.geometry.push({label,...g});save();assert(g.rect.left>=11&&g.rect.right<=g.viewport[0]-11&&g.rect.top>=55&&g.rect.bottom<=g.viewport[1]-11,JSON.stringify(g));
 if(center&&g.rect.height<=g.viewport[1]-112)assert(Math.abs(g.dx)<=1&&Math.abs(g.dy)<=1,JSON.stringify(g));
 assert.deepEqual(g.font,['16px','13px']);check('geometry-'+label,g);return g;
}
async function traceFrames(){await page.evaluate(()=>{
 window.cFrames=[];const until=performance.now()+900;
 const frame=()=>{const e=document.querySelector('.achievement-notice'),s=e&&getComputedStyle(e);window.cFrames.push({at:performance.now(),key:e?.dataset.noticeKey,phase:e?.dataset.phase,remaining:Number(e?.dataset.remaining),opacity:s?Number(s.opacity):null,transform:s?.transform,visibility:s?.visibility,rect:e?.getBoundingClientRect().toJSON(),main:document.querySelector('.main')?.getBoundingClientRect().toJSON()});if(performance.now()<until)requestAnimationFrame(frame);};requestAnimationFrame(frame);
 });}
async function collectFrames(label){const frames=await page.evaluate(()=>window.cFrames);report.frames.push({label,frames});save();return frames;}
async function preview(){await page.getByRole('button',{name:'预览效果',exact:true}).click();await notice().waitFor();}
async function ready(){await page.locator('.achievement-notice[data-phase="visible"] button.achievement-notice-close:enabled').waitFor();}
async function close(){await ready();await page.getByRole('button',{name:'关闭成就提示'}).click();await notice().waitFor({state:'detached'});}
async function focus(){await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0];w.show();w.restore();w.focus();});await page.bringToFront();}
async function create(n){await page.evaluate(async n=>{for(let i=0;i<n;i++){const r=await window.bookkeep.transaction.create({amountFen:123,occurredDate:'2020-01-01',occurredTime:null,timePrecision:'date',name:'C合成生命周期',categoryId:'cat_food',merchant:null,note:null},{mutationId:crypto.randomUUID()});if(!r.ok)throw Error(JSON.stringify(r));}},n);}
try{
 app=await _electron.launch({executablePath:electronExecutable(),args:[ROOT,'--force-device-scale-factor=1'],cwd:ROOT,env:electronSafeEnv({LOCALAPPDATA:mkdtempSync(path.join(tmpdir(),'BookKeep C synthetic ')),BOOKKEEP_QA_FOREGROUND:'1'})});
 page=await app.firstWindow();page.on('pageerror',e=>report.errors.push(e.message));await page.emulateMedia({colorScheme:null});await page.locator('[data-ledger-total]').waitFor();
 await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0];w.setContentSize(1400,850);w.focus();});
 await page.locator('[data-nav-item="settings"]').click();await page.getByRole('button',{name:'预览效果',exact:true}).click();await page.locator('.achievement-notice').waitFor();await page.waitForTimeout(600);
 const g=await geometry('ordinary-detailed');await screen('window-center.png');assert.equal(g.width,460);assert.equal(g.padding,'20px');
 await page.locator('.nav-mode-toggle').click();await sleep(350);await geometry('compact');await page.locator('.nav-mode-toggle').click();await sleep(350);await geometry('detailed-again');await close();
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].maximize());await sleep(350);await preview();await ready();await geometry('maximized');assert(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isMaximized()));await close();
 await viewport(680,650);await preview();await ready();await geometry('narrow-drawer-closed');
 await page.getByRole('button',{name:'菜单',exact:true}).click();await sleep(650);assert.equal(await notice().isVisible(),false);await page.keyboard.press('Escape');await ready();await geometry('drawer-resumed');await close();check('drawer-occlusion-pauses-and-resumes-same-card');
 await viewport(640,480,2);await preview();await ready();
 await notice().evaluate(e=>{e.querySelector('strong').textContent='长标题'.repeat(20);e.querySelector('.achievement-notice-link span').textContent='合成长文本、自动换行与内部滚动。'.repeat(90);});await sleep(50);
 const small=await geometry('small-low-height-long-text');assert(small.width<=296);assert(small.scrollHeight>small.clientHeight);assert.equal(small.overflow,'auto');
 await notice().evaluate(e=>e.scrollTop=e.scrollHeight);assert(await notice().evaluate(e=>e.scrollTop>0));await notice().evaluate(e=>e.scrollTop=0);await screen('small-long-scroll.png');await close();
 await viewport(1400,850);await page.getByLabel('提示位置',{exact:true}).selectOption('bottom-right');await traceFrames();await preview();await ready();const bottom=await geometry('bottom-right',false);assert.equal(bottom.width,420);assert.equal(bottom.padding,'18px');assert(Math.abs(bottom.rect.right-1388)<=1&&Math.abs(bottom.rect.bottom-838)<=1);const bottomFrames=await collectFrames('bottom-entry');assert(bottomFrames.some(f=>f.phase==='entering'&&f.opacity>0&&f.opacity<.99));await close();await page.getByLabel('提示位置',{exact:true}).selectOption('center');
 for(const theme of ['light','dark','system']){
  await page.getByLabel('界面主题',{exact:true}).selectOption(theme);await sleep(150);await preview();await ready();await geometry('theme-'+theme);
  const colors=await notice().evaluate(e=>({surface:getComputedStyle(e).backgroundColor,text:getComputedStyle(e).color,dark:matchMedia('(prefers-color-scheme: dark)').matches}));assert.notEqual(colors.surface,colors.text);if(theme==='dark'){const channels=colors.surface.match(/\d+/g).map(Number);assert.equal(channels[0],channels[1]);assert.equal(channels[1],channels[2]);assert(channels[0]<50);}if(theme==='system')assert.equal(colors.dark,await app.evaluate(({nativeTheme})=>nativeTheme.shouldUseDarkColors));await screen('theme-'+theme+'.png');check('theme-'+theme,colors);await close();
 }
 // Frame capture around actual insert and close, without requiring animationend delivery.
 await traceFrames();await preview();await sleep(80);await screen('entry-middle.png');await ready();await sleep(100);const entry=await collectFrames('entry');
 const middle=entry.filter(f=>f.phase==='entering'&&f.opacity>0&&f.opacity<.99);assert(middle.length>=2,JSON.stringify(entry));assert(middle.every(f=>f.remaining===5000));assert(middle.some(f=>f.transform!=='none'&&Number(f.transform.split('(')[1]?.split(',')[0])<1));assert(middle.every((f,i)=>i===0||f.opacity>=middle[i-1].opacity),'entry opacity is monotonic across sampled frames');
 const mains=entry.filter(f=>f.main).map(f=>JSON.stringify(f.main));assert.equal(new Set(mains).size,1,'notice must not reflow main');check('entry-intermediate-opacity-scale-and-unspent-budget',{samples:middle.length});
 await notice().hover();const paused=Number(await notice().getAttribute('data-remaining'));await sleep(650);assert.equal(Number(await notice().getAttribute('data-remaining')),paused);await page.mouse.move(2,45);await page.locator('.achievement-notice-link').focus();const focused=Number(await notice().getAttribute('data-remaining'));await sleep(650);assert.equal(Number(await notice().getAttribute('data-remaining')),focused);await page.locator('.achievement-notice-link').evaluate(e=>e.blur());check('hover-and-keyboard-focus-pause');
 const key=await notice().getAttribute('data-notice-key');await app.evaluate(async({BrowserWindow})=>{globalThis.cOther=new BrowserWindow({width:260,height:160,show:true});await globalThis.cOther.loadURL('about:blank');globalThis.cOther.focus();});await sleep(600);assert.equal(await notice().isVisible(),false);const hidden=Number(await notice().getAttribute('data-remaining'));await sleep(700);assert.equal(Number(await notice().getAttribute('data-remaining')),hidden);await app.evaluate(()=>globalThis.cOther.destroy());await focus();await ready();assert.equal(await notice().getAttribute('data-notice-key'),key);assert.equal(await notice().getAttribute('data-phase'),'visible');assert(Number(await notice().getAttribute('data-remaining'))<=focused);check('native-blur-resume-budget-without-reentry',{hidden});
 await traceFrames();await page.getByRole('button',{name:'关闭成就提示'}).click();await sleep(65);await screen('exit-middle.png');await notice().waitFor({state:'detached'});const exit=await collectFrames('exit'),exitFrames=exit.filter(f=>f.phase==='exiting');assert(exitFrames.some(f=>f.opacity>0&&f.opacity<.99));assert(exitFrames.every((f,i)=>i===0||f.opacity<=exitFrames[i-1].opacity),'exit opacity is monotonic across sampled frames');check('exit-intermediate-opacity-and-retained-render');
 await page.emulateMedia({colorScheme:null,reducedMotion:'reduce'});await page.evaluate(()=>window.addEventListener('animationend',e=>e.stopImmediatePropagation(),true));await traceFrames();await preview();await ready();const reduced=await collectFrames('reduced-entry');assert(reduced.filter(f=>f.key).every(f=>f.transform==='none'));await close();check('reduced-motion-no-scale-no-animationend-dependency');await page.emulateMedia({colorScheme:null,reducedMotion:'no-preference'});
 // Observe real IPC plus durable status and actual DOM at the shown boundary.
 await app.evaluate(({ipcMain})=>{globalThis.cTrace=[];for(const name of ['achievement.present','achievement.consume']){const original=ipcMain._invokeHandlers.get(name);ipcMain.removeHandler(name);ipcMain.handle(name,async(e,r)=>{const dom=await e.sender.executeJavaScript(`(()=>{const e=document.querySelector('.achievement-notice');return {phase:e?.dataset.phase,remaining:e?.dataset.remaining,opacity:e?getComputedStyle(e).opacity:null,focus:document.hasFocus(),visibility:document.visibilityState};})()`);const result=await original(e,r);globalThis.cTrace.push({name,payload:r.payload,at:Date.now(),dom,result});return result;});}});
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].minimize());await sleep(600);await create(100);await focus();await ready();
 const keys=[];for(let i=0;i<3;i++){
  await ready();const k=await notice().getAttribute('data-notice-key');assert(!keys.includes(k));keys.push(k);
  if(i===0){await traceFrames();await page.evaluate(()=>{const b=document.querySelector('.achievement-notice-close');b.click();b.click();document.querySelector('.achievement-notice-link').click();});await sleep(40);assert.equal(await notice().getAttribute('data-phase'),'exiting');assert.equal(await notice().getAttribute('data-notice-key'),k);
   await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].minimize());await sleep(350);await focus();
  }else if(i===1){await page.mouse.move(2,45);await page.locator('.achievement-notice-link').evaluate(e=>e.blur());await page.waitForFunction(k=>document.querySelector('.achievement-notice')?.dataset.noticeKey!==k,k,{timeout:8000});}
  else{await page.evaluate(()=>{const link=document.querySelector('.achievement-notice-link');link.click();link.click();});}
  await page.waitForFunction(k=>document.querySelector('.achievement-notice')?.dataset.noticeKey!==k,k,{timeout:8000});
 }
 await notice().waitFor({state:'detached'});assert.equal(await page.locator('.app').getAttribute('data-nav'),'achievements');const durable=await invoke('achievement.list');assert.equal(durable.notices.length,3);assert(durable.notices.every(n=>n.status==='closed'));report.trace=await app.evaluate(()=>globalThis.cTrace);save();
 for(const n of durable.notices){assert.equal(report.trace.filter(t=>t.name==='achievement.present'&&t.payload.noticeIds.includes(n.id)).length,1);assert.equal(report.trace.filter(t=>t.name==='achievement.consume'&&t.payload.noticeId===n.id).length,1);}
 assert(report.trace.filter(t=>t.name==='achievement.present').every(t=>Number(t.dom.opacity)>=.999&&t.dom.focus&&t.dom.visibility==='visible'&&Number(t.dom.remaining)===5000));check('three-real-notices-close-timeout-jump-once-exit-blur-no-replay',{keys,trace:report.trace});
 await sleep(650);assert.equal(await notice().count(),0);assert.deepEqual(report.errors,[]);report.ok=true;
}catch(e){report.failure=e.stack;console.error(e);}finally{if(app)await app.close();save();}if(!report.ok)process.exitCode=1;
