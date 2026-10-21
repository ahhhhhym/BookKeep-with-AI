// S08 runtime observation only. Original src/, tests/ and scripts/ are frozen.
// This collector records raw UI/IPC/SQLite observations; it does not change the application.
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ROOT, electronExecutable, electronSafeEnv } from '../../scripts/lib/paths.mjs';
const { _electron } = createRequire(path.join(process.env.BOOKKEEP_QA_NODE_MODULES, '__qa__.cjs'))('playwright');
const Database = createRequire(import.meta.url)('better-sqlite3');
const target = path.join(ROOT, 'evidence/S08/observation');
mkdirSync(target, { recursive: true });
const localAppData = mkdtempSync(path.join(tmpdir(), 'BookKeepAI S08 observation 中文 '));
const report = { complete: false, localAppData, observations: {}, console: [], pageErrors: [] };
let app, page;
async function launch() {
  app = await _electron.launch({ executablePath: electronExecutable(), args: [ROOT], cwd: ROOT, env: electronSafeEnv({ LOCALAPPDATA: localAppData }) });
  page = await app.firstWindow(); page.setDefaultTimeout(15000);
  page.on('console', m => { if (['warning', 'error'].includes(m.type())) report.console.push({ level: m.type(), text: m.text() }); });
  page.on('pageerror', e => report.pageErrors.push(e.message));
  await page.context().setOffline(true);
  await page.locator('[data-ledger-total]').waitFor();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1280, 900));
}
async function api(group, method, input) {
  const result = await page.evaluate(async ({ group, method, input }) => window.bookkeep[group][method](input), { group, method, input });
  if (!result.ok) throw new Error(`${group}.${method}: ${result.error.code}`);
  return result.data;
}
async function snap(name) {
  const png = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64'));
  writeFileSync(path.join(target, name), Buffer.from(png, 'base64'));
}
function sql() {
  const base = path.join(localAppData, 'BookKeepAI');
  const pointer = JSON.parse(readFileSync(path.join(base, 'data/active.json'), 'utf8'));
  const db = new Database(path.join(base, 'data/generations', pointer.generationId, 'ledger.db'), { readonly: true });
  const queries = {
    tables: "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
    ledgers: 'SELECT id,name,currency,timezone FROM ledger',
    categories: 'SELECT id,name,enabled,sort_order FROM category ORDER BY sort_order,id',
    rows: 'SELECT id,name,amount_fen,typeof(amount_fen) AS storage_type,occurred_date,occurred_time,time_precision,category_id,deleted_at FROM "transaction" ORDER BY occurred_date,id',
    total: 'SELECT COUNT(*) AS count,CAST(COALESCE(SUM(amount_fen),0) AS TEXT) AS totalFen FROM "transaction" WHERE deleted_at IS NULL',
    byDate: 'SELECT occurred_date,CAST(SUM(amount_fen) AS TEXT) AS totalFen FROM "transaction" WHERE deleted_at IS NULL GROUP BY occurred_date ORDER BY occurred_date',
    byCategory: 'SELECT category_id,CAST(SUM(amount_fen) AS TEXT) AS totalFen FROM "transaction" WHERE deleted_at IS NULL GROUP BY category_id ORDER BY SUM(amount_fen) DESC,category_id',
  };
  try {
    const result = { queries };
    for (const [name, query] of Object.entries(queries)) result[name] = db.prepare(query).all();
    result.quickCheck = db.pragma('quick_check'); result.foreignKeys = db.pragma('foreign_key_check');
    return result;
  } finally { db.close(); }
}
async function add(date, name, categoryId, amountFen) {
  return api('transaction', 'create', { occurredDate: date, name, categoryId, amountFen, occurredTime: null, timePrecision: 'date', merchant: null, note: null });
}
async function bundle(period, anchorDate) {
  const input = { period, anchorDate, categoryIds: [], snapshotRevision: null };
  const series = await api('statistics', 'series', input);
  const bound = { ...input, snapshotRevision: series.scope.revision };
  return { series, summary: await api('statistics', 'summary', bound), ranking: await api('statistics', 'topCategories', { ...bound, pointMonth: null }) };
}
async function waitTotal(selector, value) {
  await page.waitForFunction(({ selector, value }) => document.querySelector(selector)?.getAttribute(selector.slice(1,-1)) === value, { selector, value: String(value) });
}
const shift = (date, n) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86400000).toISOString().slice(0,10);
try {
  await launch();
  report.identity = { url: page.url(), title: await page.title(), offline: await page.evaluate(() => !navigator.onLine) };
  report.observations.empty = sql();
  report.observations.ensureRepeated = [await api('ledger','ensureDefault'), await api('ledger','ensureDefault')];
  await page.getByRole('button', { name: '分类', exact: true }).click();
  await page.getByText('共 34 个分类', { exact: false }).waitFor();
  report.observations.categoryPage = await page.locator('main').innerText();
  await snap('default-categories.png');
  const emptyBackup = (await api('backup','create',{kind:'manual',containsPrivateDataAcknowledged:true})).record.id;
  for (const row of [['2026-09-08','午餐','cat_food',1800],['2026-09-08','购买水果','cat_fruit',1626],['2026-09-08','晚餐','cat_food',1000],['2026-09-09','iPad维修','cat_repair',85000],['2026-09-09','iPad保护膜','cat_digital',5554],['2026-09-09','午餐','cat_food',1550]]) await add(...row);
  await page.getByRole('button',{name:'记账',exact:true}).click(); await waitTotal('[data-ledger-total]',96530);
  report.observations.f02 = { sql: sql(), ledgerText: await page.locator('main').innerText(), month: await bundle('month','2026-09-08'), week: await bundle('week','2026-09-08'), year: await bundle('year','2026-09-08') };
  await snap('F02-list-96530.png');
  const mock = await api('skeleton','mockRecognition',{scenario:'two-expenses'});
  report.observations.mock = { candidateCount: mock.candidates.length, sqlAfter: sql(), limitation: 'Only transient mock output; no persisted pending/rejected/failed business entities exist. This is not full AC07 isolation acceptance.' };
  await page.getByRole('button',{name:'候选审核',exact:true}).click();
  report.observations.reviewPage = await page.locator('main').innerText();
  await snap('review-not-implemented.png');
  await app.close(); app=null; await launch(); await waitTotal('[data-ledger-total]',96530);
  report.observations.f02Restart = { sql: sql(), month: await bundle('month','2026-09-08'), displayed: await page.locator('[data-ledger-total]').innerText() };
  const preview = await api('backup','restore',{mode:'preview',backupId:emptyBackup});
  await api('backup','restore',{mode:'commit',restoreToken:preview.restoreToken,currentDataWillBeReplaced:true});
  await page.reload(); await waitTotal('[data-ledger-total]',0);
  const today = (await bundle('week',new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()))).series.scope.today;
  const tomorrow = shift(today,1);
  for (const row of [[shift(today,-1),'昨天合成支出','cat_food',1000],[today,'今天合成支出','cat_food',2000],[tomorrow,'明天合成支出','cat_food',3000],['2026-11-01','下月合成支出','cat_food',4000]]) await add(...row);
  await page.reload(); await waitTotal('[data-ledger-total]',10000);
  report.observations.current = { today, tomorrow, sql: sql(), ledgerText: await page.locator('main').innerText(), week: await bundle('week',today), month: await bundle('month',today), year: await bundle('year',today) };
  await snap('today-yesterday-unknown-time.png');
  await page.getByRole('button',{name:'统计',exact:true}).click(); await waitTotal('[data-statistics-total]',3000);
  await page.getByRole('group',{name:'统计周期',exact:true}).getByRole('button',{name:'周',exact:true}).click();
  await page.locator(`[data-point-key="${tomorrow}"] rect`).click();
  await page.getByRole('region',{name:'统计点详情',exact:true}).getByText('尚未到来',{exact:true}).waitFor();
  await page.getByRole('region',{name:'统计点详情',exact:true}).evaluate(n=>n.scrollIntoView({block:'center'}));
  report.observations.current.weekUI = await page.locator('main').innerText();
  report.observations.current.viewport = await page.evaluate(()=>({width:innerWidth,height:innerHeight,devicePixelRatio,screen:{width:screen.width,height:screen.height}}));
  await snap('current-week-future-point.png');
  report.complete=true;
} catch (error) {
  report.error=error.stack; process.exitCode=1;
  if(page&&!page.isClosed()) await snap('observation-failure.png').catch(()=>{});
} finally {
  if(app) await app.close().catch(()=>{});
  writeFileSync(path.join(target,'observations.json'),JSON.stringify(report,null,2)+'\n','utf8');
  console.log(JSON.stringify({complete:report.complete,localAppData,error:report.error??null}));
}
