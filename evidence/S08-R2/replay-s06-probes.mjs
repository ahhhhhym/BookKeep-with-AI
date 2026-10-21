// 本轮新增验收探针；只写隔离合成账本，不修改产品及原测试。
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ROOT, electronExecutable, electronSafeEnv } from '../../scripts/lib/paths.mjs';
const { _electron } = createRequire(path.join(process.env.BOOKKEEP_QA_NODE_MODULES, '__qa__.cjs'))('playwright');
const Database = createRequire(import.meta.url)('better-sqlite3');
const target = path.join(ROOT, 'evidence/S08-R2/manual-probes');
const localAppData = mkdtempSync(path.join(tmpdir(), 'BookKeepAI S06 receipt 中文 '));
const checks = [], errors = [];
let app, page;
const report = { ok: false, localAppData, checks, errors, kind: 'additional S06 receipt probes; not G1' };
function check(id, detail = {}) { checks.push({ id, ok: true, detail }); console.log(`PASS ${id}`); }
async function launch() {
  app = await _electron.launch({ executablePath: electronExecutable(), args: [ROOT], cwd: ROOT, env: electronSafeEnv({ LOCALAPPDATA: localAppData }) });
  page = await app.firstWindow(); page.setDefaultTimeout(10000);
  await page.context().setOffline(true); page.on('pageerror', error => errors.push(error.message));
  await page.locator('[data-ledger-total]').waitFor();
}
async function total(fen) {
  await page.waitForFunction(value => document.querySelector('[data-ledger-total]')?.getAttribute('data-ledger-total') === value, String(fen));
  return page.locator('[data-ledger-total]').innerText();
}
async function api(group, operation, input) {
  const response = await page.evaluate(async ({ group, operation, input }) => window.bookkeep[group][operation](input), { group, operation, input });
  assert.equal(response.ok, true, JSON.stringify(response)); return response.data;
}
async function newForm(name = '边界合成', amount = '1', date = '2026-09-27') {
  await page.getByRole('button', { name: '记一笔', exact: true }).first().click();
  await page.locator('#expense-amount').fill(amount); await page.locator('#expense-date').fill(date);
  await page.locator('#expense-name').fill(name); await page.locator('#expense-categoryId').selectOption('cat_food');
}
async function save() { await page.getByRole('button', { name: '保存支出', exact: true }).click(); }
async function closeDirty() { await page.keyboard.press('Escape'); await page.getByRole('button', { name: '放弃修改', exact: true }).click(); }
async function clearFilter() { await page.getByRole('button', { name: '清空筛选', exact: true }).first().click(); }
async function reload() { await page.reload(); await page.locator('[data-ledger-total]').waitFor(); }
function sql() {
  const base = path.join(localAppData, 'BookKeepAI');
  const active = JSON.parse(readFileSync(path.join(base, 'data/active.json'), 'utf8'));
  const db = new Database(path.join(base, 'data/generations', active.generationId, 'ledger.db'), { readonly: true });
  try { return { active: db.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(amount_fen),0) AS fen FROM "transaction" WHERE deleted_at IS NULL').get(), all: db.prepare('SELECT name,amount_fen,occurred_date,occurred_time,time_precision,deleted_at FROM "transaction" ORDER BY name').all(), integrity: db.pragma('quick_check'), foreignKeys: db.pragma('foreign_key_check') }; }
  finally { db.close(); }
}
const filter = { dateStart: null, dateEnd: null, categoryIds: [], nameQuery: null, deleted: 'active' };
try {
  mkdirSync(path.join(target, 'screens-additional'), { recursive: true }); await launch(); await total(0);
  const emptyBackup = (await api('backup', 'create', { kind: 'manual', containsPrivateDataAcknowledged: true })).record.id;
  await newForm();
  for (const amount of ['', '0', '-1', '1.001', 'abc', '1e2', '10,000.00', '10000000.00']) {
    await page.locator('#expense-amount').fill(amount); await save();
    await page.locator('#expense-amount-error').waitFor();
    assert.equal(await page.locator('#expense-amount').inputValue(), amount);
    assert.equal(sql().active.n, 0);
  }
  check('UI-invalid-amounts-no-SQL-write', { cases: 8 });
  await page.locator('#expense-amount').fill('1'); await page.locator('#expense-name').fill(''); await save();
  await page.locator('#expense-name-error').waitFor();
  await page.locator('#expense-name').fill('分类必填'); await page.locator('#expense-categoryId').selectOption(''); await save();
  await page.locator('#expense-categoryId-error').waitFor(); assert.equal(sql().active.n, 0);
  await closeDirty(); check('UI-missing-name-category-no-SQL-write');
  for (const [amount, fen] of [['0.01', 1], ['9999999.99', 1000000000]]) {
    await newForm(`边界${amount}`, amount); await save(); await page.getByRole('dialog').waitFor({ state: 'hidden' }); await total(fen);
  }
  assert.deepEqual(sql().active, { n: 2, fen: 1000000000 }); check('UI-min-max-integer-fen', sql().active);
  await newForm('未来合成记录', '2', '2099-01-01'); await save();
  await page.getByText('所选日期在未来，当前周期统计尚不计入。请勾选核实日期后保存。', { exact: true }).waitFor();
  assert.equal(sql().active.n, 2);
  await page.getByRole('checkbox', { name: '所选日期在未来，当前周期统计尚不计入。我已核实日期。', exact: true }).check();
  await save(); await page.getByRole('dialog').waitFor({ state: 'hidden' }); await total(1000000200);
  const future = sql().all.find(row => row.name === '未来合成记录'); assert.equal(future.occurred_time, null); assert.equal(future.time_precision, 'date');
  check('UI-future-explicit-confirm-and-unknown-time', future);
  const preview = await api('backup', 'restore', { mode: 'preview', backupId: emptyBackup });
  await api('backup', 'restore', { mode: 'commit', restoreToken: preview.restoreToken, currentDataWillBeReplaced: true });
  await reload(); await total(0); check('isolated-empty-snapshot-restored-before-F02');
  const seed = [
    ['2026-09-08','午餐','cat_food',1800], ['2026-09-08','购买水果','cat_fruit',1626], ['2026-09-08','晚餐','cat_food',1000],
    ['2026-09-09','iPad维修','cat_repair',85000], ['2026-09-09','iPad保护膜','cat_digital',5554], ['2026-09-09','午餐','cat_food',1550]
  ];
  for (const [occurredDate,name,categoryId,amountFen] of seed) await api('transaction','create',{ occurredDate,name,categoryId,amountFen,occurredTime:null,timePrecision:'date',merchant:null,note:null });
  await reload(); await total(96530); assert.deepEqual(sql().active, { n:6,fen:96530 });
  assert.ok((await page.locator('[data-date-group="2026-09-08"] h2').innerText()).includes('44.26'));
  assert.ok((await page.locator('[data-date-group="2026-09-09"] h2').innerText()).includes('921.04'));
  await page.screenshot({ path:path.join(target,'screens-additional/F02-96530.png') }); check('F02-six-records-UI-SQL-group-totals');
  await page.getByRole('searchbox').fill('午餐'); await page.getByRole('button',{name:'应用筛选',exact:true}).click(); await total(3350);
  assert.equal(await page.locator('.expense-name').count(),2);
  await page.getByLabel('开始日期（含）',{exact:true}).fill('2026-09-09'); await page.getByLabel('结束日期（含）',{exact:true}).fill('2026-09-09');
  await page.locator('.category-filter summary').click(); await page.locator('.filter-categories').getByText('餐饮',{exact:true}).check();
  await page.getByRole('button',{name:'应用筛选',exact:true}).click(); await total(1550); assert.equal(await page.locator('.expense-name').count(),1);
  await clearFilter(); await total(96530); check('UI-name-date-category-AND-inclusive-and-clear');
  await page.locator('.category-filter summary').click();
  // details 元素可能仍打开；不依赖原先的展开状态。
  if (!(await page.locator('.filter-categories').isVisible())) await page.locator('.category-filter summary').click();
  await page.locator('.filter-categories').getByText('维修',{exact:true}).check(); await page.locator('.filter-categories').getByText('数码',{exact:true}).check();
  await page.getByRole('button',{name:'应用筛选',exact:true}).click(); await total(90554); assert.equal(await page.locator('.expense-name').count(),2);
  await clearFilter(); await total(96530); check('UI-multiple-category-union');
  await page.getByRole('searchbox').fill('IPAD'); await page.getByRole('button',{name:'应用筛选',exact:true}).click(); await total(90554);
  await page.getByRole('searchbox').fill('%'); await page.getByRole('button',{name:'应用筛选',exact:true}).click(); await total(0);
  await clearFilter(); await total(96530); check('UI-ASCII-case-search-and-literal-percent');
  for(let i=0;i<60;i++) await api('transaction','create',{occurredDate:'2026-09-09',name:`分页合成${i}`,categoryId:'cat_food',amountFen:100,occurredTime:null,timePrecision:'date',merchant:null,note:null});
  await reload(); await total(102530); assert.equal(await page.locator('.expense-name').count(),50);
  assert.ok((await page.locator('[data-date-group="2026-09-09"] h2').innerText()).includes('981.04'));
  await page.getByRole('button',{name:'加载更多',exact:true}).click(); await page.waitForFunction(()=>document.querySelectorAll('.expense-name').length===66);
  assert.equal(await page.locator('[data-date-group="2026-09-09"]').count(),1);
  assert.equal(new Set(await page.locator('[data-transaction-id]').evaluateAll(rows=>rows.map(row=>row.getAttribute('data-transaction-id')))).size,66);
  check('real-UI-pagination-66-unique-full-group-subtotal');
  await reload(); await total(102530);
  await api('transaction','create',{occurredDate:'2026-09-09',name:'分页过程中新增',categoryId:'cat_food',amountFen:7,occurredTime:null,timePrecision:'date',merchant:null,note:null});
  await page.getByRole('button',{name:'加载更多',exact:true}).click(); await total(102537);
  assert.equal(await page.locator('.expense-name').count(),50);
  await page.getByRole('button',{name:'加载更多',exact:true}).click(); await page.waitForFunction(()=>document.querySelectorAll('.expense-name').length===67);
  check('real-UI-stale-cursor-resets-first-page-and-reloads');
  // 同版本并发提交：成功一次，冲突一次，原键回放一次；正式数目不增加。
  const row=(await api('transaction','list',{filter,page:{limit:100,cursor:null}})).items.find(row=>row.name==='分页过程中新增');
  const concurrency=await page.evaluate(async row=>{
    const id=crypto.randomUUID(); const payload={id:row.id,expectedVersion:row.version,patch:{amountFen:8}};
    const [first,second]=await Promise.all([window.bookkeep.transaction.update(payload,{mutationId:id}),window.bookkeep.transaction.update(payload)]);
    const replay=await window.bookkeep.transaction.update(payload,{mutationId:id}); return {first,second,replay};
  },row);
  assert.equal(concurrency.first.ok,true); assert.equal(concurrency.second.ok,false); assert.equal(concurrency.second.error.code,'VERSION_CONFLICT');
  assert.equal(concurrency.replay.ok,true); assert.equal(concurrency.replay.data.replayed,true); assert.deepEqual(sql().active,{n:67,fen:102538});
  check('real-IPC-concurrent-update-CAS-and-same-key-replay',{error:concurrency.second.error.code,replayed:concurrency.replay.data.replayed});
  await reload(); await total(102538); await app.close(); app=null; await launch(); await total(102538);
  await page.getByRole('searchbox').fill('分页过程中新增'); await page.getByRole('button',{name:'应用筛选',exact:true}).click(); await total(8);
  await page.getByRole('button',{name:'编辑 分页过程中新增',exact:true}).click();
  await page.locator('#expense-date').fill(''); await save(); await page.locator('#expense-date-error').waitFor();
  assert.deepEqual(sql().active,{n:67,fen:102538});
  await page.locator('#expense-date').fill('2025-12-31'); await page.locator('#expense-name').fill('编辑字段验收');
  await page.locator('#expense-categoryId').selectOption('cat_fruit'); await page.getByRole('checkbox',{name:'记录精确时间',exact:false}).check();
  await page.locator('#expense-time').fill('23:59'); await page.locator('#expense-merchant').fill('合成商户'); await page.locator('#expense-note').fill('第一行\n第二行');
  await page.locator('#expense-name').dispatchEvent('keydown',{key:'Enter',code:'Enter',ctrlKey:true,isComposing:true,bubbles:true});
  assert.equal(sql().all.some(row=>row.name==='编辑字段验收'),false);
  await save(); await page.getByRole('dialog').waitFor({state:'hidden'}); await total(0); await clearFilter(); await total(102538);
  const edited=(await api('transaction','list',{filter:{...filter,nameQuery:'编辑字段验收'},page:{limit:100,cursor:null}})).items[0];
  assert.equal(edited.categoryId,'cat_fruit'); assert.equal(edited.occurredDate,'2025-12-31'); assert.equal(edited.occurredTime,'23:59');
  assert.equal(edited.timePrecision,'minute'); assert.equal(edited.merchant,'合成商户'); assert.equal(edited.note,'第一行\n第二行');
  check('UI-required-date-edit-all-fields-and-synthetic-IME-guard',{id:edited.id,categoryId:edited.categoryId,occurredDate:edited.occurredDate,occurredTime:edited.occurredTime});
  const fruit=(await api('category','list',{includeDisabled:true})).categories.find(cat=>cat.id==='cat_fruit');
  await api('category','update',{id:fruit.id,expectedVersion:fruit.version,patch:{name:'水果改名验收'}});
  await reload(); await total(102538);
  await page.getByRole('searchbox').fill('编辑字段验收'); await page.getByRole('button',{name:'应用筛选',exact:true}).click(); await total(8);
  assert.ok((await page.locator('.expense-meta').innerText()).includes('水果改名验收'));
  assert.ok((await page.locator('[data-date-group="2025-12-31"] h2').innerText()).includes('2025年12月31日 星期三'));
  await clearFilter(); await total(102538); check('category-renaming-keeps-history-ID-and-total');
  report.finalDatabase=sql(); assert.equal(report.finalDatabase.integrity[0].quick_check,'ok'); assert.equal(report.finalDatabase.foreignKeys.length,0);
  check('additional-process-restart-and-SQL-integrity',report.finalDatabase.active);
  assert.deepEqual(errors,[]); report.ok=true;
} catch(error) {
  report.error=error.stack; console.error(error); process.exitCode=1;
  if(page&&!page.isClosed()) await page.screenshot({path:path.join(target,'screens-additional/failure.png')}).catch(()=>{});
} finally {
  if(app) await app.evaluate(({app})=>app.exit(0)).catch(()=>{});
  writeFileSync(path.join(target,'additional-probes.json'),JSON.stringify(report,null,2)+'\n','utf8');
}
