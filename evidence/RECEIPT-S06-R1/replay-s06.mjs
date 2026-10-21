/** S06开发自测：真实Electron/受限preload/IPC/SQLite；合成数据隔离，非S08验收。 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ROOT, electronExecutable, electronSafeEnv } from '../../scripts/lib/paths.mjs';

const require = createRequire(import.meta.url);
const runtimePackages = process.env.BOOKKEEP_QA_NODE_MODULES;
if (!runtimePackages) throw new Error('请设置BOOKKEEP_QA_NODE_MODULES指向可用的playwright包目录；不作为应用运行依赖。');
const { _electron } = createRequire(path.join(runtimePackages, '__qa__.cjs'))('playwright');
const Database = require('better-sqlite3');
const target = path.join(ROOT, 'evidence', 'RECEIPT-S06-R1');
const screens = path.join(target, 'screens'); mkdirSync(screens, { recursive: true });
const localAppData = mkdtempSync(path.join(tmpdir(), 'BookKeepAI S06 中文 '));
const checks = []; const consoleErrors = []; let app; let page;
const report = { ok: false, kind: 'S06 stage receipt rerun; not S08 or G1', localAppData, checks, consoleErrors };
const check = (id, detail = {}) => { checks.push({ id, ok: true, detail }); console.log(`PASS ${id}`); };
async function launch() {
  app = await _electron.launch({ executablePath: electronExecutable(), args: [ROOT], cwd: ROOT,
    env: electronSafeEnv({ LOCALAPPDATA: localAppData }), timeout: 30_000 });
  page = await app.firstWindow(); page.setDefaultTimeout(12_000);
  await page.context().setOffline(true);
  page.on('pageerror', (error) => consoleErrors.push(error.message));
  await page.locator('[data-ledger-total]').waitFor();
}
async function capture(name) {
  // 等待真实CSS过渡完成，用Electron原生捕获，避免CDP在应用缩放下裁错尺寸。
  await page.evaluate(() => Promise.all(document.getAnimations().map((animation) => animation.finished.catch(() => {}))));
  const base64 = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64'));
  writeFileSync(path.join(screens, name), Buffer.from(base64, 'base64'));
}
async function total(fen) {
  await page.waitForFunction((value) => document.querySelector('[data-ledger-total]')?.getAttribute('data-ledger-total') === value, String(fen));
  const text = await page.locator('[data-ledger-total]').innerText();
  const integer = BigInt(fen); assert.ok(text.includes(`¥${integer / 100n}.${String(integer % 100n).padStart(2, '0')}`));
  return text;
}
async function fillNew(name, amount, time = null, date = '2026-09-27') {
  await page.getByRole('button', { name: '记一笔', exact: true }).first().click();
  await page.getByLabel('金额（元，必填）', { exact: true }).fill(amount);
  await page.getByLabel('日期（必填）', { exact: true }).fill(date);
  await page.getByLabel('购买物或服务名称（必填）', { exact: true }).fill(name);
  await page.getByLabel('消费分类（必填）', { exact: true }).selectOption('cat_food');
  if (time) { await page.getByLabel('记录精确时间', { exact: false }).check(); await page.getByLabel('时刻', { exact: true }).fill(time); }
}
async function create(name, amount, time = null, date = '2026-09-27') {
  await fillNew(name, amount, time, date);
  await page.getByRole('button', { name: '保存支出', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
}
async function sqlReport() {
  const base = path.join(localAppData, 'BookKeepAI');
  const active = JSON.parse(readFileSync(path.join(base, 'data', 'active.json'), 'utf8'));
  const db = new Database(path.join(base, 'data', 'generations', active.generationId, 'ledger.db'), { readonly: true });
  try { return {
    active: db.prepare('SELECT COUNT(*) AS count, SUM(amount_fen) AS totalFen FROM "transaction" WHERE deleted_at IS NULL').get(),
    rows: db.prepare('SELECT name, amount_fen, occurred_date, occurred_time, time_precision, deleted_at, version FROM "transaction" ORDER BY name').all(),
    ledgerCount: db.prepare('SELECT COUNT(*) AS n FROM ledger').get().n,
    categories: db.prepare('SELECT COUNT(*) AS n FROM category').get().n,
    quickCheck: db.pragma('quick_check'), foreignKeys: db.pragma('foreign_key_check'),
  }; } finally { db.close(); }
}

try {
  await launch(); await total('0');
  assert.equal(await page.evaluate(() => navigator.onLine), false);
  await page.getByText('还没有支出，记下第一笔吧。', { exact: true }).waitFor();
  check('empty-ledger-real-db'); await page.screenshot({ path: path.join(screens, 'empty.png') });
  await page.keyboard.press('Control+n'); await page.getByRole('dialog').waitFor();
  await page.getByRole('button', { name: '保存支出', exact: true }).click();
  assert.equal(await page.locator('#expense-amount').evaluate((node) => node === document.activeElement), true);
  await page.locator('#expense-amount').fill('1.001');
  await page.locator('#expense-name').fill('保留输入');
  await page.getByRole('button', { name: '保存支出', exact: true }).click();
  assert.equal(await page.locator('#expense-amount').inputValue(), '1.001'); assert.equal(await page.locator('#expense-name').inputValue(), '保留输入');
  await page.screenshot({ path: path.join(screens, 'validation.png') });
  await page.keyboard.press('Escape'); await page.getByRole('dialog', { name: '有未保存的修改', exact: true }).waitFor();
  await page.getByRole('button', { name: '继续编辑', exact: true }).click();
  await page.locator('#expense-amount').focus(); await page.keyboard.press('Shift+Tab');
  assert.equal(await page.getByRole('dialog', { name: '记一笔', exact: true }).evaluate((dialog) => dialog.contains(document.activeElement)), true);
  await page.keyboard.press('Escape'); await page.getByRole('button', { name: '放弃修改', exact: true }).click();
  await total('0'); check('keyboard-ctrl-n-focus-trap-esc-unsaved-and-preserved-invalid-input');

  await create('双荟', '4.80', '18:00'); await total('480');
  await create('晚餐', '15', '19:00'); await total('1980');
  await create('午餐', '13.50', '12:00'); const displayed = await total('3330');
  assert.deepEqual(await page.locator('.expense-name').allTextContents(), ['晚餐', '双荟', '午餐']);
  const group = page.locator('[data-date-group="2026-09-27"]');
  assert.ok((await group.locator('h2').innerText()).includes('支出 ¥33.30'));
  await group.locator('h2 button').click(); assert.equal(await group.locator('ul').isVisible(), false);
  await total('3330'); await group.locator('h2 button').click();
  await page.screenshot({ path: path.join(screens, 'f01-3330.png') }); check('F01-create-stable-order-collapse', { displayed });

  await page.getByRole('button', { name: '编辑 双荟', exact: true }).click();
  await page.locator('#expense-amount').fill('5.00'); await page.keyboard.press('Control+Enter');
  await page.getByRole('dialog').waitFor({ state: 'hidden' }); await total('3350');
  await page.getByRole('button', { name: '删除 晚餐', exact: true }).click();
  await page.getByRole('button', { name: '保留', exact: true }).click(); await total('3350');
  await page.getByRole('button', { name: '删除 晚餐', exact: true }).click();
  await page.getByRole('button', { name: '删除', exact: true }).click(); await total('1850');
  await page.getByRole('button', { name: '已删除记录', exact: true }).click(); await total('1500');
  await page.getByText('已删除记录：此处金额不计入正式统计。', { exact: true }).waitFor();
  await page.getByRole('button', { name: '恢复 晚餐', exact: true }).click();
  await page.getByRole('button', { name: '恢复', exact: true }).click(); await total('0');
  await page.getByRole('button', { name: '返回正式支出', exact: true }).click(); await total('3350');
  await page.getByRole('button', { name: '编辑 双荟', exact: true }).click(); await page.locator('#expense-amount').fill('4.80');
  await page.getByRole('button', { name: '保存支出', exact: true }).click(); await page.getByRole('dialog').waitFor({ state: 'hidden' }); await total('3330');
  check('edit-delete-confirm-restore-immediate-totals', { editedFen: 3350, afterDeleteFen: 1850, restoredFen: 3350, finalFen: 3330 });

  await page.keyboard.press('Control+f'); assert.equal(await page.getByRole('searchbox').evaluate((node) => node === document.activeElement), true);
  await page.getByRole('searchbox').fill('午餐'); await page.getByRole('button', { name: '应用筛选', exact: true }).click(); await total('1350');
  assert.ok((await group.locator('h2').innerText()).includes('筛选小计 ¥13.50'));
  await page.getByRole('searchbox').fill('不存在'); await page.getByRole('button', { name: '应用筛选', exact: true }).click(); await total('0');
  await page.getByText('没有符合条件的记录。', { exact: true }).waitFor();
  await page.getByRole('button', { name: '清空筛选', exact: true }).first().click(); await total('3330');
  await page.getByLabel('开始日期（含）', { exact: true }).fill('2026-09-27'); await page.getByLabel('结束日期（含）', { exact: true }).fill('2026-09-27');
  await page.getByRole('button', { name: '应用筛选', exact: true }).click(); await total('3330');
  await page.getByRole('button', { name: '清空筛选', exact: true }).first().click(); check('name-search-empty-result-date-inclusive');

  await page.getByRole('button', { name: '管理分类', exact: true }).click();
  await page.getByRole('heading', { name: '分类', exact: true }).waitFor();
  await page.locator('[data-nav-item="ledger"]').click(); await total('3330'); check('category-management-entry-and-persistent-return');
  await app.close(); app = null; await launch(); await total('3330');
  const db = await sqlReport(); assert.deepEqual(db.active, { count: 3, totalFen: 3330 }); assert.equal(db.ledgerCount, 1); assert.equal(db.categories, 34);
  assert.equal(db.foreignKeys.length, 0); assert.equal(db.quickCheck[0].quick_check, 'ok');
  check('actual-process-restart-and-sql-display-reconciliation', db);
  await page.screenshot({ path: path.join(screens, 'restart-3330.png') });

  // 只在测试进程内包装已注册处理器，不添加产品测试后门；真实提交后阻塞/丢失一次响应。
  await app.evaluate(({ ipcMain }) => {
    const original = ipcMain._invokeHandlers.get('transaction.create');
    if (!original) throw new Error('测试包装不支持当前Electron');
    const fault = { original, requests: [], count: 0 };
    fault.started = new Promise((resolve) => { fault.markStarted = resolve; });
    fault.gate = new Promise((resolve) => { fault.release = resolve; });
    globalThis.__s06Fault = fault;
    ipcMain.removeHandler('transaction.create');
    ipcMain.handle('transaction.create', async (event, request) => {
      const response = await original(event, request);
      fault.requests.push({ mutationId: request.mutationId, dataEpoch: request.dataEpoch, replayed: response.data?.replayed });
      if (fault.count++ === 0 && response.ok) {
        fault.markStarted(); await fault.gate;
        return { ...response, ok: false, data: undefined, error: { code: 'INTERNAL_ERROR', message: 'INTERNAL_ERROR', fieldErrors: [], details: {}, retryable: false, retryAfterMs: null } };
      }
      return response;
    });
  });
  await fillNew('响应丢失测试', '1'); await page.getByRole('button', { name: '保存支出', exact: true }).click();
  await app.evaluate(() => globalThis.__s06Fault.started);
  assert.equal(await page.getByRole('button', { name: '正在保存…', exact: true }).isDisabled(), true);
  assert.equal(await page.locator('#expense-amount').isDisabled(), true);
  await page.screenshot({ path: path.join(screens, 'real-pending-save.png') });
  await app.evaluate(() => globalThis.__s06Fault.release());
  await page.getByRole('button', { name: '重试保存', exact: true }).waitFor();
  assert.equal(await page.locator('#expense-amount').inputValue(), '1');
  await page.getByRole('button', { name: '重试保存', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' }); await total('3430');
  const retries = await app.evaluate(({ ipcMain }) => {
    const fault = globalThis.__s06Fault;
    ipcMain.removeHandler('transaction.create'); ipcMain.handle('transaction.create', fault.original);
    return fault.requests;
  });
  assert.equal(retries.length, 2); assert.equal(retries[0].mutationId, retries[1].mutationId); assert.equal(retries[1].replayed, true);
  check('real-save-pending-response-loss-same-mutation-id-replay', { retries });
  await page.getByRole('button', { name: '删除 响应丢失测试', exact: true }).click(); await page.getByRole('button', { name: '删除', exact: true }).click(); await total('3330');

  await page.getByRole('button', { name: '编辑 双荟', exact: true }).click(); await page.locator('#expense-amount').fill('5.00');
  await page.evaluate(async () => {
    const rows = await window.bookkeep.transaction.list({ filter: { dateStart: null, dateEnd: null, categoryIds: [], nameQuery: '双荟', deleted: 'active' }, page: { limit: 50, cursor: null } });
    if (!rows.ok) throw new Error(rows.error.code);
    const row = rows.data.items[0];
    const updated = await window.bookkeep.transaction.update({ id: row.id, expectedVersion: row.version, patch: { name: '并发修改的名称' } });
    if (!updated.ok) throw new Error(updated.error.code);
  });
  await page.getByRole('button', { name: '保存支出', exact: true }).click();
  await page.getByRole('button', { name: '已核对最新记录，保留我的输入继续编辑', exact: true }).waitFor();
  assert.equal(await page.locator('#expense-amount').inputValue(), '5.00');
  await page.screenshot({ path: path.join(screens, 'version-conflict.png') });
  await page.getByRole('button', { name: '已核对最新记录，保留我的输入继续编辑', exact: true }).click();
  await page.locator('#expense-amount').fill('4.80'); await page.getByRole('button', { name: '保存支出', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' }); await total('3330'); check('real-version-conflict-preserved-input-explicit-rebase');

  const backupId = await page.evaluate(async () => {
    const result = await window.bookkeep.backup.create({ kind: 'manual', containsPrivateDataAcknowledged: true });
    if (!result.ok) throw new Error(result.error.code); return result.data.record.id;
  });
  await fillNew('旧世代表单不得写入', '2');
  const restoreResult = await page.evaluate(async (id) => {
    const preview = await window.bookkeep.backup.restore({ mode: 'preview', backupId: id });
    if (!preview.ok) throw new Error(preview.error.code);
    const restored = await window.bookkeep.backup.restore({ mode: 'commit', restoreToken: preview.data.restoreToken, currentDataWillBeReplaced: true });
    if (!restored.ok) throw new Error(restored.error.code); return restored.data;
  }, backupId);
  await page.getByRole('button', { name: '保存支出', exact: true }).click();
  await page.getByText('账本已恢复或切换，请关闭此表单，核对新账本后重新编辑；原输入保留供对照。', { exact: true }).waitFor();
  assert.equal(await page.locator('#expense-name').inputValue(), '旧世代表单不得写入');
  assert.equal(await page.getByRole('button', { name: '保存支出', exact: true }).isDisabled(), true);
  await page.screenshot({ path: path.join(screens, 'stale-epoch.png') });
  await page.keyboard.press('Escape'); await page.getByRole('button', { name: '放弃修改', exact: true }).click();
  await total('3330'); const epochDb = await sqlReport(); assert.equal(epochDb.rows.some((row) => row.name === '旧世代表单不得写入'), false);
  check('real-restore-old-form-bound-epoch-rejected-after-preload-updated', { newDataEpoch: restoreResult.newDataEpoch, active: epochDb.active });

  await page.evaluate(async () => {
    const cats = await window.bookkeep.category.list({ includeDisabled: true }); if (!cats.ok) throw new Error(cats.error.code);
    const food = cats.data.categories.find((item) => item.id === 'cat_food');
    const result = await window.bookkeep.category.disable({ id: food.id, expectedVersion: food.version }); if (!result.ok) throw new Error(result.error.code);
    window.dispatchEvent(new Event('focus'));
  });
  await total('3330'); await page.getByRole('button', { name: '编辑 双荟', exact: true }).click();
  await page.getByRole('option', { name: '餐饮（已停用，可原样保留）', exact: true }).waitFor({ state: 'attached' });
  await page.getByRole('button', { name: '保存支出', exact: true }).click(); await page.getByRole('dialog').waitFor({ state: 'hidden' }); await total('3330');
  await page.evaluate(async () => {
    const cats = await window.bookkeep.category.list({ includeDisabled: true }); if (!cats.ok) throw new Error(cats.error.code);
    const food = cats.data.categories.find((item) => item.id === 'cat_food');
    const result = await window.bookkeep.category.update({ id: food.id, expectedVersion: food.version, patch: { enabled: true } }); if (!result.ok) throw new Error(result.error.code);
    window.dispatchEvent(new Event('focus'));
  }); await total('3330'); check('disabled-original-category-kept-on-real-edit');

  const longName = '跨年长名称验证'.repeat(12);
  await create(longName, '1', null, '2024-12-31'); await total('3430');
  assert.ok((await page.locator('[data-date-group="2024-12-31"] h2').innerText()).includes('2024年12月31日 星期二'));
  assert.ok((await page.locator('[data-date-group="2024-12-31"]').innerText()).includes('时间未记录'));
  await page.screenshot({ path: path.join(screens, 'cross-year-long-name.png') });
  await page.clock.install({ time: new Date('2026-12-31T15:59:59Z') });
  await page.evaluate(() => window.dispatchEvent(new Event('focus'))); await total('3430');
  await create('上海午夜刷新', '1', null, '2026-12-31'); await total('3530');
  assert.ok((await page.locator('[data-date-group="2026-12-31"] h2').innerText()).includes('今天'));
  await page.clock.runFor(1200);
  await page.waitForFunction(() => document.querySelector('[data-date-group="2026-12-31"] h2')?.textContent.includes('昨天 · 2026年12月31日 星期四'));
  check('controlled-renderer-clock-shanghai-midnight-cross-year-refresh');
  for (const [width, height] of [[1280, 720], [640, 480]]) {
    await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setContentSize(...size), [width, height]);
    await page.waitForFunction((size) => innerWidth === size[0] && innerHeight === size[1], [width, height]);
    const measures = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, horizontalOverflow: document.documentElement.scrollWidth > innerWidth }));
    await page.evaluate(() => { document.querySelector('.main').scrollTop = 0; });
    if (width === 640) {
      await page.getByRole('button', { name: '菜单', exact: true }).focus(); await page.keyboard.press('Tab');
      assert.equal(await page.evaluate(() => !!document.activeElement.closest('#main-nav')), false);
    }
    assert.equal(measures.horizontalOverflow, false); await capture(`viewport-${width}x${height}.png`);
    check(`viewport-${width}x${height}`, measures);
  }
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(2));
  await page.getByRole('button', { name: '记一笔', exact: true }).first().click();
  await page.getByRole('button', { name: '保存支出', exact: true }).scrollIntoViewIfNeeded();
  assert.equal(await page.getByRole('button', { name: '保存支出', exact: true }).isVisible(), true);
  const saveBounds = await page.getByRole('button', { name: '保存支出', exact: true }).evaluate((button) => {
    const box = button.getBoundingClientRect(); return { x: box.x, y: box.y, right: box.right, bottom: box.bottom, width: innerWidth, height: innerHeight, dialogWidth: document.querySelector('dialog[open]').getBoundingClientRect().width };
  });
  assert.ok(saveBounds.x >= 0 && saveBounds.y >= 0 && saveBounds.right <= saveBounds.width && saveBounds.bottom <= saveBounds.height, JSON.stringify(saveBounds));
  await capture('zoom-200-form.png');
  await page.keyboard.press('Escape'); await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1));
  check('long-name-cross-year-unknown-time-and-200-percent-form-scroll', saveBounds);
  report.finalDisplayed = await total('3530');
  await app.close(); app = null;
  report.finalDatabase = await sqlReport(); assert.equal(report.finalDatabase.active.totalFen, 3530);
  report.ok = consoleErrors.length === 0;
  assert.equal(report.ok, true); console.log(`S06 UI checks ${checks.length}/${checks.length}`);
} catch (error) {
  report.error = error.stack; console.error(error);
  if (page && !page.isClosed()) await page.screenshot({ path: path.join(screens, 'failure.png') }).catch(() => {});
  process.exitCode = 1;
} finally {
  writeFileSync(path.join(target, 'ui-workflow.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  if (app) await app.evaluate(({ app }) => app.exit(1)).catch(() => {});
}

