/** Isolated rendered checks for titlebar, navigation and appearance preferences. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ROOT, electronExecutable, electronSafeEnv } from '../../scripts/lib/paths.mjs';
const { _electron } = createRequire(path.join(process.env.BOOKKEEP_QA_NODE_MODULES, '__qa__.cjs'))('playwright');
const output = process.env.BOOKKEEP_QA_OUTPUT;
const appRoot = path.resolve(process.env.BOOKKEEP_QA_APP_ROOT ?? ROOT);
mkdirSync(output,{recursive:true});
const localAppData = mkdtempSync(path.join(tmpdir(),'BookKeep appearance '));
const report = {ok:false,localAppData,checks:[],errors:[],console:[],browser:'Browser plugin not available; existing Playwright Electron workflow'};
let app,page;
const check = id => { report.checks.push(id); console.log('PASS '+id); };
const settle = () => page.waitForTimeout(320);
const launch = async () => {
  app=await _electron.launch({executablePath:electronExecutable(),args:[appRoot],cwd:appRoot,env:electronSafeEnv({LOCALAPPDATA:localAppData})});
  page=await app.firstWindow(); page.setDefaultTimeout(7000);
  // Playwright defaults to emulated light; remove it to observe Electron's real theme.
  await page.emulateMedia({colorScheme:null});
  page.on('pageerror',e=>report.errors.push(e.message));
  page.on('console',m=>{if(['warning','error'].includes(m.type()))report.console.push(m.text());});
  await page.locator('[data-ledger-total]').waitFor();
  await app.evaluate(({BrowserWindow})=>{
    const win=BrowserWindow.getAllWindows()[0],original=win.setTitleBarOverlay.bind(win);
    win.setTitleBarOverlay=options=>{globalThis.__qaOverlay=options;return original(options);};
  });
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1450,900));
};
const nav = async id => {await page.locator(`[data-nav-item="${id}"]`).click();await page.locator('[data-main-transition][data-phase="stable"]').waitFor();};
const theme = () => page.getByLabel('界面主题',{exact:true});
const dark = () => page.evaluate(()=>matchMedia('(prefers-color-scheme: dark)').matches);
const anchoredMenu = async label => {
  const geometry=await page.locator('#main-nav').evaluate(nav=>{
    const group=nav.querySelector('.nav-items'),n=nav.getBoundingClientRect(),g=group.getBoundingClientRect();
    const buttons=[...group.querySelectorAll('.nav-item')],rects=buttons.map(el=>el.getBoundingClientRect()),style=getComputedStyle(nav);
    return {top:rects[0].top-nav.querySelector('.nav-mode-toggle').getBoundingClientRect().bottom-10,bottom:n.bottom-rects.at(-1).bottom-paddingValue(style.paddingBottom),gaps:rects.slice(1,4).map((r,i)=>r.top-rects[i].bottom),horizontal:Math.abs((g.left+g.right-n.left-n.right)/2),items:buttons.map(item=>{
      const r=item.getBoundingClientRect(),parts=[...item.children].filter(el=>getComputedStyle(el).display!=='none').map(el=>el.getBoundingClientRect());
      return Math.abs((Math.min(...parts.map(r=>r.left))+Math.max(...parts.map(r=>r.right))-r.left-r.right)/2);
    })};
    function paddingValue(value){return parseFloat(value)||0;}
  });
  assert(Math.abs(geometry.top)<=1,`${label}: first menu at original top ${JSON.stringify(geometry)}`);
  assert(Math.abs(geometry.bottom)<=1,`${label}: settings at bottom ${JSON.stringify(geometry)}`);
  assert(geometry.gaps.every(gap=>Math.abs(gap-10)<=1),`${label}: main menu gaps ${JSON.stringify(geometry)}`);
  assert(geometry.horizontal<=1,`${label}: horizontal center ${JSON.stringify(geometry)}`);
  assert(geometry.items.every(delta=>delta<=1),`${label}: icon and label center ${JSON.stringify(geometry)}`);
};
try {
  await launch();
  await anchoredMenu('default sidebar');check('menu-top-and-settings-bottom-default-width');
  assert.equal(await page.locator('.nav-items').evaluate(el=>getComputedStyle(el).rowGap),'10px');check('menu-spacing-ten-pixels');
  assert.equal(await page.title(),'BookKeepAI');assert((await page.url()).startsWith('bookkeep://app/'));
  await nav('settings');assert.equal(await theme().inputValue(),'system');check('default-follows-system');
  for (const mode of ['dark','light','system']) {
    await theme().selectOption(mode);await settle();
    assert.equal(await app.evaluate(({nativeTheme})=>nativeTheme.themeSource),mode);
    if(mode!=='system')assert.equal(await dark(),mode==='dark');
    const colors=await page.locator('.topbar').evaluate(el=>({bg:getComputedStyle(el).backgroundColor,text:getComputedStyle(el).color}));
    assert.equal(colors.bg,await dark()?'rgb(24, 24, 24)':'rgb(255, 255, 255)');
    if(mode!=='system')assert.equal(await app.evaluate(()=>globalThis.__qaOverlay?.color),mode==='dark'?'#181818':'#ffffff');
    assert.equal((await page.locator('.topbar').boundingBox()).y,0);
    check('theme-'+mode+'-native-and-renderer');
  }
  await theme().selectOption('dark');await settle();
  await page.screenshot({path:path.join(output,'settings-dark.png')});
  await nav('ledger');await page.getByRole('button',{name:'记一笔',exact:true}).click();
  const modal=page.getByRole('dialog');await modal.waitFor();
  const backdrop=await modal.evaluate(el=>({top:getComputedStyle(el,'::backdrop').top,bottom:getComputedStyle(el,'::backdrop').bottom,bg:getComputedStyle(el).backgroundColor,rect:el.getBoundingClientRect().toJSON()}));
  assert.equal(backdrop.top,'44px');assert.equal(backdrop.bottom,'0px');assert.equal(backdrop.bg,'rgb(24, 24, 24)');assert(backdrop.rect.y>=44);check('modal-backdrop-excludes-titlebar');
  for(const field of await modal.locator('input:not([type="checkbox"]),select,textarea').all()) {
    const colors=await field.evaluate(el=>({bg:getComputedStyle(el).backgroundColor,text:getComputedStyle(el).color}));
    assert.equal(colors.bg,'rgb(24, 24, 24)');assert.equal(colors.text,'rgb(237, 237, 237)');
  }
  check('dark-form-fields-neutral-background-readable-text');
  await page.screenshot({path:path.join(output,'ledger-dialog-dark.png')});
  await page.keyboard.press('Escape');await modal.waitFor({state:'detached'});
  const handle=page.getByRole('separator',{name:'调整侧栏宽度'});
  await handle.focus();await page.keyboard.press('End');await settle();assert.equal(await handle.getAttribute('aria-valuenow'),'280');
  await anchoredMenu('maximum sidebar');
  await page.keyboard.press('ArrowLeft');await settle();assert.equal(await handle.getAttribute('aria-valuenow'),'272');
  await page.keyboard.press('Home');await settle();assert.equal(await handle.getAttribute('aria-valuenow'),'160');
  await anchoredMenu('minimum sidebar');
  let box=await handle.boundingBox();report.dragBefore={box,nav:await page.locator('#main-nav').boundingBox()};await page.mouse.move(box.x+box.width/2,box.y+60);await page.mouse.down();await page.mouse.move(240,box.y+60,{steps:12});await page.mouse.up();await settle();report.dragAfter={width:await handle.getAttribute('aria-valuenow'),nav:await page.locator('#main-nav').boundingBox()};
  assert.equal(await handle.getAttribute('aria-valuenow'),'240');check('sidebar-keyboard-and-pointer-resize-clamped');
  await anchoredMenu('dragged sidebar');check('menu-anchors-and-horizontal-center-after-resize');
  const indicator=page.locator('.nav-indicator');
  const before=await indicator.boundingBox();await nav('settings');await settle();const after=await indicator.boundingBox();assert(after.y>before.y);
  assert((await indicator.evaluate(el=>getComputedStyle(el).transitionDuration)).includes('0.24s'));check('selection-slides-between-menu-items');
  await page.evaluate(()=>{for(const id of ['ledger','statistics','data','settings','ledger'])document.querySelector(`[data-nav-item="${id}"]`).click();});await settle();
  assert.equal(await page.locator('.app').getAttribute('data-nav'),'ledger');check('rapid-navigation-finishes-on-last-choice');
  await page.emulateMedia({reducedMotion:'reduce',colorScheme:null});assert.equal(await indicator.evaluate(el=>getComputedStyle(el).transitionDuration),'0s');check('reduced-motion');
  await app.close();app=null;await launch();
  assert.equal(await dark(),true);await nav('settings');assert.equal(await theme().inputValue(),'dark');
  assert.equal(await page.getByRole('separator',{name:'调整侧栏宽度'}).getAttribute('aria-valuenow'),'240');check('theme-and-width-persist-after-restart');
  for(const id of ['ledger','statistics','ai','data','achievements','settings']){await nav(id);await settle();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.screenshot({path:path.join(output,id+'-dark.png')});}
  check('six-pages-dark-without-horizontal-overflow');
  await theme().selectOption('light');await nav('ledger');await page.getByRole('button',{name:'记一笔',exact:true}).click();await page.screenshot({path:path.join(output,'ledger-dialog-light.png')});await page.keyboard.press('Escape');check('light-dialog');
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1000,700));await settle();assert.equal(await page.getByRole('separator',{name:'调整侧栏宽度'}).isVisible(),true);check('medium-window-detailed-resizable');await page.locator('.nav-mode-toggle').click();await settle();
  await anchoredMenu('icon rail');check('menu-anchors-icon-rail');
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(680,650));await settle();await page.getByRole('button',{name:'菜单',exact:true}).click();await settle();assert.equal(await page.locator('#main-nav').getAttribute('data-open'),'true');await anchoredMenu('narrow drawer');await page.screenshot({path:path.join(output,'menu-narrow-anchored.png')});check('menu-anchors-narrow-drawer');await nav('settings');await settle();assert.equal(await page.locator('#main-nav').getAttribute('data-open'),'false');assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.screenshot({path:path.join(output,'settings-narrow.png')});check('narrow-drawer-and-layout');
  assert.equal(await page.locator('vite-error-overlay').count(),0);assert.deepEqual(report.errors,[]);assert.deepEqual(report.console,[]);check('console-and-page-health');report.ok=true;
}catch(e){report.failure=e.stack;console.error(e);}finally{if(app)await app.close();writeFileSync(path.join(output,'result.json'),JSON.stringify(report,null,2));}
if(!report.ok)process.exitCode=1;
