// S07单列接收新增探针；不修改产品/原测试，只写隔离的合成账本。
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ROOT, electronExecutable, electronSafeEnv } from '../../scripts/lib/paths.mjs';
const { _electron } = createRequire(path.join(process.env.BOOKKEEP_QA_NODE_MODULES, '__qa__.cjs'))('playwright');
const Database = createRequire(import.meta.url)('better-sqlite3');
const target = path.join(ROOT, 'evidence/S08-R2/statistics-probes');
const localAppData = mkdtempSync(path.join(tmpdir(), 'BookKeepAI S07 receipt 中文 '));
const checks = [], errors = [], warnings = [], notices = [], rows = [];
const report = { ok: false, kind: 'S07 R1 additional acceptance probes; not S08/G1', localAppData, checks, errors, warnings, notices, oracleScopes: [] };
let app, page;
function check(id, detail = {}) { checks.push({ id, ok: true, detail }); console.log(`PASS ${id}`); }
async function api(group, operation, input) {
  const response = await page.evaluate(async ({ group, operation, input }) => window.bookkeep[group][operation](input), { group, operation, input });
  assert.equal(response.ok, true, JSON.stringify(response)); return response.data;
}
async function add(amountFen, occurredDate, categoryId, name, occurredTime = null) {
  const transaction = (await api('transaction', 'create', { amountFen, occurredDate, categoryId, name, occurredTime, timePrecision: occurredTime ? 'minute' : 'date', merchant: null, note: null })).transaction;
  rows.push(transaction); return transaction;
}
async function expectCode(operation, input, code) {
  const result = await page.evaluate(async ({ operation, input }) => window.bookkeep.statistics[operation](input), { operation, input });
  assert.equal(result.ok, false); assert.equal(result.error.code, code);
}
async function total(value) { await page.waitForFunction(fen => document.querySelector('[data-statistics-total]')?.getAttribute('data-statistics-total') === fen, String(value)); }
async function choose(date) { await page.getByLabel('选择周期日期', { exact: true }).fill(date); await page.getByRole('button', { name: '选择周期', exact: true }).click(); }
async function period(name) { await page.getByRole('group', { name: '统计周期', exact: true }).getByRole('button', { name, exact: true }).click(); }
async function capture(name) {
  const buffer = Buffer.from(await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64')), 'base64');
  const destination = path.join(target, 'screens-additional', name); writeFileSync(destination, buffer);
  const preview = path.join(localAppData, name); copyFileSync(destination, preview); return preview;
}
const shift = (value, n) => new Date(Date.parse(`${value}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
function range(period, anchor) {
  if (period === 'week') { const day = new Date(`${anchor}T00:00:00Z`).getUTCDay(); const start = shift(anchor, -(day || 7) + 1); return [start, shift(start, 7)]; }
  if (period === 'year') return [`${anchor.slice(0, 4)}-01-01`, `${Number(anchor.slice(0, 4)) + 1}-01-01`];
  const year = Number(anchor.slice(0, 4)), month = Number(anchor.slice(5, 7));
  return [`${anchor.slice(0, 7)}-01`, `${month === 12 ? year + 1 : year}-${String(month === 12 ? 1 : month + 1).padStart(2, '0')}-01`];
}
function decimalRatio(n, d) { const rounded = (n * 2n + d) / (2n * d); return `${rounded / 100n}.${String(rounded % 100n).padStart(2, '0')}`; }
function ranked(records) {
  const amounts = new Map(); for (const row of records) amounts.set(row.categoryId, (amounts.get(row.categoryId) ?? 0n) + BigInt(row.amountFen));
  return [...amounts].sort((a, b) => a[1] === b[1] ? (a[0] < b[0] ? -1 : 1) : a[1] > b[1] ? -1 : 1);
}
const sum = records => records.reduce((value, row) => value + BigInt(row.amountFen), 0n);
function topTransactions(records) {
  return [...records].sort((a, b) => b.amountFen - a.amountFen || (a.occurredTime === null) - (b.occurredTime === null) || (a.occurredTime === b.occurredTime ? 0 : a.occurredTime > b.occurredTime ? -1 : 1) || (a.id < b.id ? -1 : 1)).slice(0, 3);
}
async function oracle(input, today, inspectPoints = false) {
  const [start, end] = range(input.period, input.anchorDate); const tomorrow = shift(today, 1), effectiveEnd = end < tomorrow ? end : tomorrow;
  const records = rows.filter(row => !row.deletedAt && row.occurredDate >= start && row.occurredDate < effectiveEnd && (!input.categoryIds.length || input.categoryIds.includes(row.categoryId)));
  const expected = sum(records).toString(); const denomin = (Date.parse(effectiveEnd) - Date.parse(start)) / 86400000;
  const actual = await page.evaluate(async input => {
    const read = async promise => { const result = await promise; if (!result.ok) throw new Error(result.error.code); return result.data; };
    const series = await read(window.bookkeep.statistics.series(input)); const bound = { ...input, snapshotRevision: series.scope.revision };
    const summary = await read(window.bookkeep.statistics.summary(bound)); const ranking = await read(window.bookkeep.statistics.topCategories({ ...bound, pointMonth: null }));
    const list = await read(window.bookkeep.transaction.list({ filter: { dateStart: series.scope.start, dateEnd: series.scope.effectiveEnd, categoryIds: input.categoryIds, nameQuery: null, deleted: 'active' }, page: { limit: 1, cursor: null } }));
    return { series, summary, ranking, list: { filteredTotalFen: list.filteredTotalFen, totalCount: list.totalCount } };
  }, input);
  assert.deepEqual([actual.series.totalFen, actual.summary.totalFen, actual.ranking.totalFen, actual.list.filteredTotalFen], Array(4).fill(expected));
  assert.deepEqual([actual.summary.count, actual.list.totalCount], [records.length, records.length]);
  assert.deepEqual(actual.summary.dailyAverage, { numeratorFen: expected, denominatorDays: denomin, displayYuan: decimalRatio(BigInt(expected), BigInt(denomin)) });
  assert.deepEqual([actual.series.scope.start, actual.series.scope.end, actual.series.scope.effectiveEnd], [start, end, effectiveEnd]);
  assert.equal(actual.series.scope.scopeId, actual.summary.scope.scopeId); assert.equal(actual.series.scope.scopeId, actual.ranking.scope.scopeId);
  const expectedPoints = [];
  for (let date = start; date < end; date = input.period === 'year' ? range('month', date)[1] : shift(date, 1)) {
    const key = input.period === 'year' ? date.slice(0, 7) : date;
    expectedPoints.push([key, sum(records.filter(row => row.occurredDate.startsWith(key))).toString(), date > today]);
  }
  assert.deepEqual(actual.series.points.map(p => [p.pointKey, p.amountFen, p.isFuture]), expectedPoints);
  const categoryRank = ranked(records);
  assert.deepEqual(actual.ranking.items.map(item => [item.categoryId, item.totalFen, item.ratioPercent]), categoryRank.map(([id, amount]) => [id, String(amount), decimalRatio(amount * 10000n, BigInt(expected))]));
  if (inspectPoints) for (const point of actual.series.points.filter(p => !p.isFuture)) {
    const pointRecords = records.filter(row => row.occurredDate.startsWith(point.pointKey));
    const bound = { ...input, snapshotRevision: actual.series.scope.revision };
    if (input.period === 'year') {
      const top = await api('statistics', 'topCategories', { ...bound, pointMonth: point.pointKey });
      assert.equal(top.totalFen, sum(pointRecords).toString());
      assert.deepEqual(top.items.map(item => [item.categoryId, item.totalFen]), ranked(pointRecords).slice(0, 3).map(([id, amount]) => [id, String(amount)]));
    } else {
      const top = await api('statistics', 'topTransactions', { ...bound, pointDate: point.pointKey });
      assert.equal(top.pointTotalFen, sum(pointRecords).toString());
      assert.deepEqual(top.items.map(item => item.transactionId), topTransactions(pointRecords).map(row => row.id));
    }
  }
  report.oracleScopes.push({ input, expected, count: records.length, denominatorDays: denomin, points: expectedPoints.length, inspectedAllValidPointTop3: inspectPoints });
  return actual;
}
try {
  mkdirSync(path.join(target, 'screens-additional'), { recursive: true });
  app = await _electron.launch({ executablePath: electronExecutable(), args: [ROOT], cwd: ROOT, env: electronSafeEnv({ LOCALAPPDATA: localAppData }) });
  page = await app.firstWindow(); page.setDefaultTimeout(12000);
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.text().includes("'frame-ancestors' is ignored")) notices.push(message.text()); else if (message.type() === 'error') errors.push(message.text()); else if (message.type() === 'warning') warnings.push(message.text()); });
  await page.context().setOffline(true); await page.locator('[data-ledger-total]').waitFor();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1280, 900));
  assert.equal(await page.title(), 'BookKeepAI'); assert.equal(page.url(), 'bookkeep://app/index.html');
  for (const [amount, date, category, name] of [[1800,'2026-09-08','cat_food','午餐'],[1626,'2026-09-08','cat_fruit','购买水果'],[1000,'2026-09-08','cat_food','晚餐'],[85000,'2026-09-09','cat_repair','iPad维修'],[5554,'2026-09-09','cat_digital','iPad保护膜'],[1550,'2026-09-09','cat_food','午餐'],[800,'2026-09-08','cat_food','早餐'],[2000,'2026-09-10','cat_food','晚餐']]) await add(amount,date,category,name);
  const baseline = await api('statistics', 'series', { period:'month', anchorDate:'2026-09-08', categoryIds:[], snapshotRevision:null });
  const today = baseline.scope.today; report.today = today;
  const saved = await api('backup', 'create', { kind:'manual', containsPrivateDataAcknowledged:true });
  const f03Rows = structuredClone(rows);
  await page.getByRole('button', { name:'统计', exact:true }).click(); await page.locator('[data-statistics-total]').waitFor(); await period('月'); await choose('2026-09-08'); await total(99330);
  const point = page.locator('[data-point-key="2026-09-08"] rect'); await point.click();
  await page.waitForFunction(() => document.querySelectorAll('.point-detail .top-items li').length === 3);
  const text = await page.getByRole('region', {name:'统计点详情',exact:true}).innerText();
  assert.ok(text.includes('¥52.26')); assert.ok(!text.includes('早餐'));
  check('UI-fourth-transaction-in-total-but-top3-truncated', { totalFen:'5226', top3:['午餐','购买水果','晚餐'] });
  await page.locator('.category-filter summary').click();
  await page.getByLabel('餐饮', {exact:true}).check(); await total(7150);
  await page.getByLabel('水果', {exact:true}).check(); await total(8776);
  assert.equal(await page.locator('[data-daily-average]').innerText(), '¥2.93');
  await period('年'); await total(8776); await page.locator('[data-point-key="2026-09"] rect').click();
  await page.waitForFunction(() => document.querySelectorAll('.point-detail .top-items li').length === 2);
  assert.deepEqual(await page.locator('.point-detail .top-items li span').allTextContents(), ['餐饮','水果']);
  await page.getByRole('button',{name:'查看明细',exact:true}).click();
  await page.waitForFunction(() => document.querySelector('[data-ledger-total]')?.getAttribute('data-ledger-total') === '8776');
  assert.equal(await page.getByLabel('开始日期（含）',{exact:true}).inputValue(),'2026-09-01');
  assert.equal(await page.getByLabel('结束日期（含）',{exact:true}).inputValue(),'2026-09-30');
  await page.getByRole('button',{name:'统计',exact:true}).click(); await total(8776);
  check('UI-multiple-category-filter-year-point-ledger-and-return', { selected:['cat_food','cat_fruit'], totalFen:'8776' });
  let category = (await api('category','list',{includeDisabled:true})).categories.find(c=>c.id==='cat_food');
  category = (await api('category','update',{id:category.id,expectedVersion:category.version,patch:{name:'用餐验收',sortOrder:9999}})).category;
  await api('category','disable',{id:category.id,expectedVersion:category.version});
  await page.getByRole('button',{name:'刷新统计',exact:true}).click(); await total(8776);
  if (await page.locator('.category-filter').getAttribute('open') === null) await page.locator('.category-filter summary').click();
  await page.getByText('用餐验收（已停用）',{exact:true}).waitFor();
  assert.ok((await page.locator('.category-ranking').innerText()).includes('用餐验收'));
  report.filterScreenshot = await capture('filtered-disabled-category.png');
  check('UI-renamed-disabled-category-retains-history-and-selected-filter');
  const categories = ['cat_fruit','cat_books','cat_digital','cat_repair'];
  let random = 20261021; const next = () => { random = (Math.imul(random,1664525)+1013904223) >>> 0; return random; };
  for (let i=0;i<112;i++) {
    const date = shift('2024-01-01',next()%1024); const amount = i%23===0 ? 999999999 : 1+next()%99999;
    const row = await add(amount,date,categories[next()%4],`合成独立对照${i}`,i%3===0?'18:30':null);
    if (i%13===0) { const changed=(await api('transaction','softDelete',{id:row.id,expectedVersion:row.version})).transaction; Object.assign(row,changed); }
  }
  for (const [date, amount] of [['1900-01-01',1],['2024-02-29',999],['2024-12-31',1200],['2025-01-01',1300],[today,5],[shift(today,1),7],['9998-12-31',9]]) await add(amount,date,'cat_books',`边界${date}`);
  for (const time of [null,'18:00','18:00','12:00',null]) await add(1234,'2025-03-08','cat_books',`同额${time??'未知'}`,time);
  const anchors = ['1900-01-01','2024-02-29','2024-03-01','2024-12-31','2025-01-01','2025-03-08','2025-09-30','2026-08-31','2026-09-08',today];
  for (const period of ['week','month','year']) for (const anchorDate of anchors) for (const categoryIds of [[],['cat_books'],['cat_fruit','cat_digital'],['cat_books','cat_books','cat_repair']]) {
    await oracle({period,anchorDate,categoryIds,snapshotRevision:null},today,categoryIds.length===0 && ['2024-02-29','2025-03-08','2026-09-08',today].includes(anchorDate));
  }
  check('independent-integer-oracle-120-scopes-through-real-preload', {scopes:report.oracleScopes.length, records:rows.length, includes:'calendar, zero and future, current denominator, category duplicates, one-row pagination, full-point values, ranking, all valid point Top3 in 12 scopes'});
  const current = {period:'month',anchorDate:today,categoryIds:[],snapshotRevision:null};
  const before = await api('statistics','series',current);
  const edit = rows.find(row=>!row.deletedAt && row.occurredDate==='2026-09-08');
  const oldMonth = await api('statistics','series',{...current,anchorDate:'2026-09-08'});
  Object.assign(edit,(await api('transaction','update',{id:edit.id,expectedVersion:edit.version,patch:{amountFen:edit.amountFen+1}})).transaction);
  await expectCode('summary',{...current,anchorDate:'2026-09-08',snapshotRevision:oldMonth.scope.revision},'SNAPSHOT_STALE');
  for (const invalid of [{...current,extra:'forbidden'},{...current,categoryIds:'cat_food'},{...current,anchorDate:'2025-02-29'}]) {
    const result=await page.evaluate(async input=>window.bookkeep.statistics.series(input),invalid); assert.equal(result.ok,false);
  }
  await expectCode('series',{...current,anchorDate:shift(today,1)},'FUTURE_PERIOD');
  await expectCode('topTransactions',{...current,pointDate:shift(today,1)},'FUTURE_POINT');
  await expectCode('topTransactions',{...current,pointDate:'2020-01-01'},'POINT_OUTSIDE_SCOPE');
  check('real-IPC-rejects-invalid-fields-dates-future-point-and-stale-revision');
  const restore = await api('backup','restore',{mode:'preview',backupId:saved.record.id});
  await api('backup','restore',{mode:'commit',restoreToken:restore.restoreToken,currentDataWillBeReplaced:true});
  const restored = await api('statistics','series',{period:'month',anchorDate:'2026-09-08',categoryIds:[],snapshotRevision:null});
  assert.notEqual(restored.scope.dataEpoch,before.scope.dataEpoch); assert.equal(restored.totalFen,'99330');
  rows.splice(0,rows.length,...f03Rows);
  for(const period of ['week','month','year']) await oracle({period,anchorDate:'2026-09-08',categoryIds:[],snapshotRevision:null},today,true);
  await page.getByRole('button',{name:'刷新统计',exact:true}).click(); await total(8776);
  check('real-backup-restore-changes-epoch-and-refreshes-filtered-UI');
  await page.getByRole('button',{name:'统计全部分类',exact:true}).click(); await total(99330); await period('月'); await total(99330);
  await page.getByRole('group',{name:/^支出趋势/}).focus(); await page.keyboard.press('Home');
  for(let i=0;i<7;i++) await page.keyboard.press('ArrowRight'); await page.keyboard.press('Enter');
  await page.waitForFunction(()=>document.querySelectorAll('.point-detail .top-items li').length===3);
  await page.getByRole('region',{name:'统计点详情',exact:true}).evaluate(n=>n.scrollIntoView({block:'start'}));
  report.finalScreenshot=await capture('restored-F03-day-top3.png');
  const base=path.join(localAppData,'BookKeepAI');const pointer=JSON.parse(readFileSync(path.join(base,'data/active.json'),'utf8'));
  const db = new Database(path.join(base,'data/generations',pointer.generationId,'ledger.db'),{readonly:true});
  try { report.sql={active:db.prepare('SELECT COUNT(*) AS count, CAST(SUM(amount_fen) AS TEXT) AS totalFen FROM "transaction" WHERE deleted_at IS NULL').get(),quickCheck:db.pragma('quick_check'),foreignKeys:db.pragma('foreign_key_check')}; }
  finally {db.close();}
  assert.deepEqual(report.sql.active,{count:8,totalFen:'99330'});assert.deepEqual(report.sql.quickCheck,[{quick_check:'ok'}]);assert.deepEqual(report.sql.foreignKeys,[]);
  assert.deepEqual(errors,[]);assert.deepEqual(warnings,[]);assert.equal(await page.locator('vite-error-overlay').count(),0);
  check('SQL-native-integrity-offline-no-overlay-or-runtime-errors',report.sql);
  report.ok=true;
} catch(error) {report.error=error.stack;console.error(error);if(page)try{report.failureScreenshot=await capture('probe-failure.png');}catch{}}
finally {if(app)await app.close();writeFileSync(path.join(target,'additional-probes.json'),JSON.stringify(report,null,2)+'\n','utf8');}
console.log(`S07 additional checks ${checks.length}; ok=${report.ok}`);process.exitCode=report.ok?0:1;
