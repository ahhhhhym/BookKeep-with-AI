/** S07实现自测：隔离合成数据、真实Electron/preload/IPC/SQLite；不是S08验收。 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ROOT, electronExecutable, electronSafeEnv } from '../../scripts/lib/paths.mjs';
const require = createRequire(import.meta.url);
const modules = process.env.BOOKKEEP_QA_NODE_MODULES;
if (!modules) throw new Error('设置BOOKKEEP_QA_NODE_MODULES到已有playwright目录，仅开发QA需要。');
const { _electron } = createRequire(path.join(modules, '__qa__.cjs'))('playwright');
const Database = require('better-sqlite3');
const target = path.join(ROOT, 'evidence', 'RECEIPT-S07-R1', 's07-replay');
const screens = path.join(target, 'screens'); mkdirSync(screens, { recursive: true });
const localAppData = mkdtempSync(path.join(tmpdir(), 'BookKeepAI S07 中文 '));
const checks = []; const errors = []; const consoleWarnings = []; const inheritedPolicyNotices = [];
const report = { ok: false, kind: 'S07 R1 frozen-version acceptance replay; not S08 or G1', browser: 'Browser plugin not available; existing Playwright Electron exercises actual IPC and native SQLite', localAppData, checks, errors, consoleWarnings, inheritedPolicyNotices };
let app; let page;
const check = (id, detail = {}) => { checks.push({ id, ok: true, detail }); console.log(`PASS ${id}`); };
async function launch() {
  app = await _electron.launch({ executablePath: electronExecutable(), args: [ROOT], cwd: ROOT, env: electronSafeEnv({ LOCALAPPDATA: localAppData }), timeout: 30000 });
  page = await app.firstWindow(); page.setDefaultTimeout(12000);
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    const text = message.text();
    if (text === "The Content Security Policy directive 'frame-ancestors' is ignored when delivered via a <meta> element.") inheritedPolicyNotices.push(text);
    else if (message.type() === 'error') errors.push(text);
    else if (message.type() === 'warning') consoleWarnings.push(text);
  });
  await page.context().setOffline(true); await page.locator('[data-ledger-total]').waitFor();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1280, 900));
}
async function total(value) {
  await page.waitForFunction((fen) => document.querySelector('[data-statistics-total]')?.getAttribute('data-statistics-total') === fen, String(value));
  assert.ok((await page.locator('[data-statistics-total]').innerText()).includes(`¥${BigInt(value) / 100n}.${String(BigInt(value) % 100n).padStart(2, '0')}`));
}
async function period(label) { await page.getByRole('group', { name: '统计周期', exact: true }).getByRole('button', { name: label, exact: true }).click(); }
async function choose(date) { await page.getByLabel('选择周期日期', { exact: true }).fill(date); await page.getByRole('button', { name: '选择周期', exact: true }).click(); }
const detail = () => page.getByRole('region', { name: '统计点详情', exact: true });
async function detailItems(expected) {
  await page.waitForFunction((names) => JSON.stringify([...document.querySelectorAll('.point-detail .top-items li span')].map((node) => node.textContent)) === JSON.stringify(names), expected);
}
async function screenshot(name) {
  await page.evaluate(() => Promise.all(document.getAnimations().map((animation) => animation.finished.catch(() => {}))));
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const base64 = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64'));
  const filename = path.join(screens, name); writeFileSync(filename, Buffer.from(base64, 'base64'));
  // 另存工作区外便于在聊天展示；项目证据因用户明确要求而保留。
  const preview = path.join(localAppData, name); copyFileSync(filename, preview);
  return preview;
}
async function scrollDetail() {
  await detail().evaluate((node) => { node.scrollTop = 0; node.scrollIntoView({ block: 'start' }); });
}
async function bridge(operation, input) {
  return page.evaluate(async ({ operation, input }) => {
    const [group, method] = operation.split('.'); const reply = await window.bookkeep[group][method](input);
    if (!reply.ok) throw new Error(`${operation}:${reply.error.code}`); return reply.data;
  }, { operation, input });
}
async function add(amountFen, occurredDate, categoryId = 'cat_food', name = '合成测试') {
  return (await bridge('transaction.create', { amountFen, occurredDate, categoryId, name, occurredTime: null, timePrecision: 'date', merchant: null, note: null })).transaction;
}
async function reconcile(period, anchorDate, expected) {
  const result = await page.evaluate(async ({ period, anchorDate }) => {
    const api = window.bookkeep; const read = async (reply) => { const value = await reply; if (!value.ok) throw new Error(value.error.code); return value.data; };
    const series = await read(api.statistics.series({ period, anchorDate, categoryIds: [], snapshotRevision: null }));
    const input = { period, anchorDate, categoryIds: [], snapshotRevision: series.scope.revision };
    const summary = await read(api.statistics.summary(input)); const ranking = await read(api.statistics.topCategories({ ...input, pointMonth: null }));
    const list = await read(api.transaction.list({ filter: { dateStart: series.scope.start, dateEnd: series.scope.effectiveEnd, categoryIds: [], nameQuery: null, deleted: 'active' }, page: { limit: 1, cursor: null } }));
    const checks = [series.totalFen, summary.totalFen, ranking.totalFen, list.filteredTotalFen, series.points.reduce((sum, point) => sum + BigInt(point.amountFen), 0n).toString(), ranking.items.reduce((sum, item) => sum + BigInt(item.totalFen), 0n).toString()];
    return { checks, count: summary.count, points: series.points.length, scope: series.scope };
  }, { period, anchorDate });
  assert.deepEqual(result.checks, Array(6).fill(String(expected))); return result;
}
function database() {
  const base = path.join(localAppData, 'BookKeepAI'); const pointer = JSON.parse(readFileSync(path.join(base, 'data', 'active.json'), 'utf8'));
  const db = new Database(path.join(base, 'data', 'generations', pointer.generationId, 'ledger.db'), { readonly: true });
  try { return { active: db.prepare('SELECT COUNT(*) AS count, CAST(COALESCE(SUM(amount_fen),0) AS TEXT) AS totalFen FROM "transaction" WHERE deleted_at IS NULL').get(), quickCheck: db.pragma('quick_check'), foreignKeys: db.pragma('foreign_key_check') }; } finally { db.close(); }
}
try {
  await launch();
  assert.ok(page.url().startsWith('bookkeep://app/')); assert.match(await page.title(), /BookKeepAI/);
  assert.equal(await page.locator('vite-error-overlay').count(), 0); check('page-identity-not-blank-no-overlay', { url: page.url(), title: await page.title() });
  await page.getByRole('button', { name: '统计', exact: true }).click(); await total('0');
  assert.equal(await page.locator('.statistics-chart [data-point-key]').count(), 31); assert.equal(await page.getByRole('button', { name: '下一月', exact: true }).isDisabled(), true);
  check('empty-current-month-31-points-next-disabled-offline');
  await add(1800, '2026-09-08', 'cat_food', '午餐'); await add(1626, '2026-09-08', 'cat_fruit', '购买水果'); await add(1000, '2026-09-08', 'cat_food', '晚餐');
  const repair = await add(85000, '2026-09-09', 'cat_repair', 'iPad维修'); await add(5554, '2026-09-09', 'cat_digital', 'iPad保护膜'); await add(1550, '2026-09-09', 'cat_food', '午餐');
  await choose('2026-09-08'); await total('96530');
  assert.equal(await page.locator('.statistics-chart [data-point-key]').count(), 30); assert.equal(await page.locator('[data-daily-average]').innerText(), '¥32.18');
  assert.deepEqual(await page.locator('.category-ranking li').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-category-id'))), ['cat_repair', 'cat_digital', 'cat_food', 'cat_fruit']);
  report.monthReconciliation = await reconcile('month', '2026-09-08', '96530'); check('F02-month-summary-ranking-average-and-ledger-96530');
  await page.locator('[data-point-key="2026-09-08"] rect').hover(); await detailItems(['午餐', '购买水果', '晚餐']);
  assert.ok((await detail().innerText()).includes('当日总支出 ¥44.26')); assert.equal(await detail().getAttribute('data-pinned'), 'false');
  await detail().hover(); await detailItems(['午餐', '购买水果', '晚餐']);
  check('hover-day-top3-total-first-and-pointer-can-enter-detail');
  await page.locator('[data-point-key="2026-09-09"] rect').click(); await detailItems(['iPad维修', 'iPad保护膜', '午餐']);
  assert.equal(await detail().getAttribute('data-pinned'), 'true');
  await page.getByRole('heading', { name: '统计', exact: true }).hover(); await detailItems(['iPad维修', 'iPad保护膜', '午餐']);
  report.monthScreenshot = await screenshot('month-F02-day-top3.png');
  await scrollDetail(); report.dayDetailScreenshot = await screenshot('day-top3-detail.png'); check('click-pin-persists-outside-chart');
  await page.locator('[data-point-key="2026-09-09"] rect').click(); await detail().waitFor({ state: 'hidden' }); check('click-same-point-unpins');
  const chart = page.getByRole('group', { name: /^支出趋势/ }); await chart.focus(); await page.keyboard.press('Home');
  await detail().getByText('暂无支出', { exact: true }).waitFor();
  for (let i = 0; i < 7; i++) await page.keyboard.press('ArrowRight'); await detailItems(['午餐', '购买水果', '晚餐']);
  await page.keyboard.press('Enter'); assert.equal(await detail().getAttribute('data-pinned'), 'true');
  await page.keyboard.press('Tab'); assert.equal(await page.getByRole('button', { name: '关闭详情', exact: true }).evaluate((button) => button === document.activeElement), true);
  await page.keyboard.press('Escape'); await detail().waitFor({ state: 'hidden' }); assert.equal(await chart.evaluate((node) => node === document.activeElement), true);
  check('keyboard-single-tab-arrows-home-enter-tab-close-escape');
  await chart.focus(); await page.keyboard.press('End'); await detail().getByText('暂无支出', { exact: true }).waitFor(); await page.keyboard.press('Space');
  assert.equal(await detail().getAttribute('data-pinned'), 'true'); await page.keyboard.press('Space'); await detail().waitFor({ state: 'hidden' }); check('keyboard-end-space-toggle');
  await page.locator('[data-point-key="2026-09-08"] rect').click(); await detailItems(['午餐', '购买水果', '晚餐']);
  await page.getByRole('button', { name: '查看明细', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[data-ledger-total]')?.getAttribute('data-ledger-total') === '4426');
  assert.equal(await page.getByLabel('开始日期（含）', { exact: true }).inputValue(), '2026-09-08');
  assert.equal(await page.getByLabel('结束日期（含）', { exact: true }).inputValue(), '2026-09-08');
  await page.getByRole('button', { name: '统计', exact: true }).click(); await total('96530'); assert.equal(await page.getByLabel('选择周期日期').inputValue(), '2026-09-08');
  check('point-to-ledger-date-range-and-return-preserves-statistics');
  await period('周'); await total('96530'); assert.equal(await page.locator('.statistics-chart [data-point-key]').count(), 7);
  assert.equal(await page.locator('[data-daily-average]').innerText(), '¥137.90'); report.weekReconciliation = await reconcile('week', '2026-09-08', '96530'); check('monday-sunday-week-7-points-ledger-reconciliation');
  await period('年'); await total('96530'); assert.equal(await page.locator('.statistics-chart [data-point-key]').count(), 12);
  await page.locator('[data-point-key="2026-09"] rect').click(); await detailItems(['维修', '数码', '餐饮']); assert.ok((await detail().innerText()).includes('当月总支出 ¥965.30'));
  report.yearReconciliation = await reconcile('year', '2026-09-08', '96530'); report.yearScreenshot = await screenshot('year-September-category-top3.png');
  await scrollDetail(); report.monthDetailScreenshot = await screenshot('month-category-top3-detail.png'); check('year-12-points-month-top3-categories-not-transactions');
  await page.locator('[data-point-key="2026-11"] rect').click(); await detail().getByText('尚未到来', { exact: true }).waitFor(); assert.equal(await detail().locator('.top-items').count(), 0); check('future-month-no-transactions-or-category-detail');
  await period('月'); await total('96530'); await page.getByRole('button', { name: '上一月', exact: true }).click(); await total('0');
  assert.equal(await page.locator('.statistics-chart [data-point-key]').count(), 31); await page.getByRole('button', { name: '下一月', exact: true }).click(); await total('96530');
  await page.getByRole('button', { name: '回到当前', exact: true }).click(); await total('0'); assert.equal(await page.getByRole('button', { name: '下一月', exact: true }).isDisabled(), true); check('previous-next-current-period-real-controls');
  await choose('2024-02-29'); await total('0'); assert.equal(await page.locator('.statistics-chart [data-point-key]').count(), 29);
  await choose('2025-02-01'); await total('0'); assert.equal(await page.locator('.statistics-chart [data-point-key]').count(), 28);
  await period('周'); await choose('2025-01-01'); await total('0'); assert.equal(await page.locator('[data-point-key="2024-12-30"]').count(), 1); assert.equal(await page.locator('[data-point-key="2025-01-05"]').count(), 1); check('leap-february-normal-february-cross-year-week');
  await period('月'); await choose('2026-09-08'); await total('96530');
  await page.locator('.category-filter summary').click(); await page.getByLabel('餐饮', { exact: true }).check(); await total('4350');
  assert.equal(await page.locator('[data-daily-average]').innerText(), '¥1.45'); await page.getByRole('button', { name: '统计全部分类', exact: true }).click(); await total('96530'); check('statistics-category-filter-independent-and-clear');
  const edited = (await bridge('transaction.update', { id: repair.id, expectedVersion: repair.version, patch: { amountFen: 86000 } })).transaction;
  await page.getByRole('button', { name: '刷新统计', exact: true }).click(); await total('97530');
  const deleted = (await bridge('transaction.softDelete', { id: edited.id, expectedVersion: edited.version })).transaction;
  await page.getByRole('button', { name: '刷新统计', exact: true }).click(); await total('11530');
  await bridge('transaction.restore', { id: deleted.id, expectedVersion: deleted.version }); await page.getByRole('button', { name: '刷新统计', exact: true }).click(); await total('97530');
  for (const value of ['week', 'month', 'year']) await reconcile(value, '2026-09-08', '97530'); check('edit-delete-restore-refresh-all-view-ledger-integer-totals');
  const extra = await add(100, '2026-09-08', 'cat_food', '触发快照更新');
  await page.locator('[data-point-key="2026-09-10"] rect').click(); await total('97630');
  await bridge('transaction.softDelete', { id: extra.id, expectedVersion: extra.version }); await page.getByRole('button', { name: '刷新统计', exact: true }).click(); await total('97530');
  check('point-read-stale-revision-triggers-whole-bundle-refresh');
  await app.evaluate(({ ipcMain }) => {
    const original = ipcMain._invokeHandlers.get('statistics.series');
    const fault = { original, count: 0 }; fault.started = new Promise((resolve) => { fault.start = resolve; }); fault.gate = new Promise((resolve) => { fault.release = resolve; });
    globalThis.__s07Delay = fault; ipcMain.removeHandler('statistics.series');
    ipcMain.handle('statistics.series', async (event, request) => { const response = await original(event, request); if (fault.count++ === 0) { fault.start(); await fault.gate; } return response; });
  });
  await page.getByRole('button', { name: '刷新统计', exact: true }).click(); await app.evaluate(() => globalThis.__s07Delay.started);
  await page.getByText('正在计算本周期统计…', { exact: true }).waitFor(); assert.equal(await page.locator('[data-statistics-total]').count(), 0);
  await period('年'); await total('97530');
  await app.evaluate(({ ipcMain }) => { const fault = globalThis.__s07Delay; ipcMain.removeHandler('statistics.series'); ipcMain.handle('statistics.series', fault.original); fault.release(); });
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.equal(await page.locator('.statistics-chart [data-point-key]').count(), 12); await total('97530');
  check('real-query-pending-and-late-month-response-cannot-replace-new-year-view');
  await period('月'); await total('97530');
  await app.evaluate(({ ipcMain }) => {
    const original = ipcMain._invokeHandlers.get('statistics.summary'); globalThis.__s07ErrorOriginal = original;
    ipcMain.removeHandler('statistics.summary'); ipcMain.handle('statistics.summary', async (event, request) => {
      const response = await original(event, request);
      return { ...response, ok: false, data: undefined, error: { code: 'DB_BUSY', message: 'DB_BUSY', fieldErrors: [], details: {}, retryable: true, retryAfterMs: null } };
    });
  });
  await page.getByRole('button', { name: '刷新统计', exact: true }).click(); await page.getByRole('alert').filter({ hasText: '账本正忙' }).waitFor();
  assert.equal(await page.locator('[data-statistics-total]').count(), 0);
  await app.evaluate(({ ipcMain }) => { ipcMain.removeHandler('statistics.summary'); ipcMain.handle('statistics.summary', globalThis.__s07ErrorOriginal); });
  await page.getByRole('button', { name: '重试', exact: true }).click(); await total('97530'); check('failed-query-shows-error-without-false-zero-and-retry-recovers');
  await page.locator('[data-point-key="2026-09-09"] rect').click(); await detailItems(['iPad维修', 'iPad保护膜', '午餐']);
  const tableSummary = page.locator('.statistics-table summary'); await tableSummary.click(); assert.equal(await page.locator('.statistics-table tbody tr').count(), 30);
  assert.ok((await page.locator('.statistics-table tbody tr').nth(8).innerText()).includes('¥931.04')); check('expandable-table-same-point-values');
  await tableSummary.click();
  await page.getByRole('button', { name: '关闭详情', exact: true }).click();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(640, 480));
  await page.getByRole('button', { name: '刷新统计', exact: true }).scrollIntoViewIfNeeded();
  await screenshot('viewport-640x480.png');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(2));
  await page.locator('[data-point-key="2026-09-09"] rect').click(); await detailItems(['iPad维修', 'iPad保护膜', '午餐']);
  await scrollDetail(); report.zoomScreenshot = await screenshot('zoom-200-detail.png');
  const layout = await detail().evaluate((node) => ({ width: innerWidth, bodyWidth: document.documentElement.scrollWidth, detailWidth: node.getBoundingClientRect().width, position: getComputedStyle(node).position, scrollable: node.scrollHeight > node.clientHeight, labelSize: (() => { const label = document.querySelector('.chart-label'); return Number.parseFloat(getComputedStyle(label).fontSize) * label.getScreenCTM().a; })() }));
  assert.ok(layout.bodyWidth <= layout.width); assert.ok(layout.labelSize >= 12, JSON.stringify(layout)); assert.equal(layout.position, 'static'); check('640x480-and-200-percent-normal-flow-no-horizontal-overflow', layout);
  await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1); BrowserWindow.getAllWindows()[0].setContentSize(1280, 900); });
  await app.close(); app = null; await launch(); await page.getByRole('button', { name: '统计', exact: true }).click(); await choose('2026-09-08'); await total('97530');
  report.finalDatabase = database(); assert.equal(report.finalDatabase.active.totalFen, '97530'); assert.deepEqual(report.finalDatabase.quickCheck, [{ quick_check: 'ok' }]); assert.deepEqual(report.finalDatabase.foreignKeys, []);
  check('real-process-restart-same-native-database');
  assert.equal(errors.length, 0); report.ok = true; console.log(`S07 UI checks ${checks.length}/${checks.length}`);
} catch (error) { report.error = error.stack; console.error(error); process.exitCode = 1; if (page && !page.isClosed()) await screenshot('failure.png').catch(() => {}); }
finally {
  const previous = path.join(target, 'ui-workflow.json');
  if (existsSync(previous)) copyFileSync(previous, path.join(target, `ui-workflow-previous-${Date.now()}.json`));
  writeFileSync(previous, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  if (app) await app.close().catch(async () => { await app.evaluate(({ app }) => app.exit(1)).catch(() => {}); });
}

