/** Real renderer form, preload, IPC and SQLite. Synthetic transport; never real provider HTTP. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { ROOT, electronExecutable, electronSafeEnv } from '../../scripts/lib/paths.mjs';
const { _electron } = createRequire(path.join(process.env.BOOKKEEP_QA_NODE_MODULES ?? path.join(ROOT, 'node_modules'), '__qa__.cjs'))('playwright');
const output = path.resolve(process.env.BOOKKEEP_QA_OUTPUT ?? path.join(ROOT, '.tmp/financial-regression'));
mkdirSync(output, { recursive: true });
const localAppData = mkdtempSync(path.join(tmpdir(), 'BookKeep S16 中文 空格 '));
const report = { ok: false, synthetic: true, externalHttp: 0, checks: [], errors: [], localAppData };
let app, page;
const check = (id, actual) => { report.checks.push({ id, ok: true, actual }); console.log('PASS ' + id); };
const raw = (method, input) => page.evaluate(({ method, input }) => { const [g, m] = method.split('.'); return window.bookkeep[g][m](input); }, { method, input });
const invoke = async (...args) => { const r = await raw(...args); assert.equal(r.ok, true, JSON.stringify(r.error)); return r.data; };
const until = async fn => { const end = Date.now() + 15000; while (!await fn()) { if (Date.now() > end) throw Error('condition timeout'); await new Promise(r => setTimeout(r, 30)); } };
const nav = async id => { await page.locator(`[data-nav-item="${id}"]`).click(); await page.locator(`[data-nav="${id}"]`).waitFor(); };
async function launch() {
  app = await _electron.launch({ executablePath: electronExecutable(), args: [ROOT], cwd: ROOT, env: electronSafeEnv({ LOCALAPPDATA: localAppData }), timeout: 30000 });
  page = await app.firstWindow(); page.setDefaultTimeout(15000); page.on('pageerror', e => report.errors.push(e.message));
  await page.locator('[data-ledger-total]').waitFor();
  await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].setContentSize(1400, 1000); globalThis.fetch = async () => { throw Error('external HTTP prohibited'); }; });
}
const scope = period => ({ period, anchorDate: '2026-09-09', categoryIds: [], snapshotRevision: null });
const snapshot = () => app.evaluate(({ app }) => {
  const require = process.getBuiltinModule('node:module').createRequire(app.getAppPath() + '/package.json');
  const fs = require('node:fs'), path = require('node:path'), DB = require('better-sqlite3');
  const root = path.join(process.env.LOCALAPPDATA, 'BookKeepAI'), p = JSON.parse(fs.readFileSync(path.join(root, 'data/active.json'), 'utf8'));
  const db = new DB(path.join(root, 'data/generations', p.generationId, 'ledger.db'), { readonly: true });
  try { return { formal: db.prepare('SELECT count(*) count,sum(amount_fen) total FROM "transaction" WHERE deleted_at IS NULL').get(), postings: db.prepare('SELECT count(*) n FROM review_posting').get().n, approvals: db.prepare("SELECT count(*) n FROM review_event WHERE action='approve'").get().n, quick: db.pragma('quick_check', { simple: true }), fk: db.pragma('foreign_key_check') }; } finally { db.close(); }
});
try {
  await launch();
  for (const [amount, name] of [['4.80', 'S16早餐'], ['15.00', 'S16午餐'], ['13.50', 'S16晚餐']]) {
    await page.getByRole('button', { name: '记一笔', exact: true }).and(page.locator('.button-primary')).click();
    await page.getByLabel('金额（元，必填）', { exact: true }).fill(amount);
    await page.getByLabel('日期（必填）', { exact: true }).fill('2026-09-08');
    await page.getByLabel('购买物或服务名称（必填）', { exact: true }).fill(name);
    await page.getByLabel('消费分类（必填）', { exact: true }).selectOption('cat_food');
    await page.getByRole('button', { name: '保存支出', exact: true }).click();
    await until(async () => await page.getByRole('button', { name: '保存支出', exact: true }).count() === 0);
  }
  assert.deepEqual((await snapshot()).formal, { count: 3, total: 3330 }); check('real-form-F01-integer-fen-3330');
  await nav('statistics');
  await page.getByLabel('选择周期日期').fill('2026-09-09'); await page.getByRole('button', { name: '选择周期', exact: true }).click();
  await page.locator('[data-statistics-total="3330"]').waitFor();
  await page.getByRole('button', { name: '月', exact: true }).click(); await page.locator('[data-statistics-total="3330"]').waitFor();
  const days = await invoke('statistics.series', scope('month')); assert.equal(days.points.length, 30);
  assert.deepEqual(days.points.map(p => p.amountFen), [...Array(7).fill('0'), '3330', ...Array(22).fill('0')]);
  const top = await invoke('statistics.topTransactions', { ...scope('month'), pointDate: '2026-09-08' });
  assert.deepEqual(top.items.map(t => [t.name, t.amountFen]), [['S16午餐', '1500'], ['S16晚餐', '1350'], ['S16早餐', '480']]);
  assert.equal((await invoke('statistics.summary', scope('month'))).dailyAverage.displayYuan, '1.11');
  await page.screenshot({ path: path.join(output, 'form-and-statistics.png'), fullPage: true }); check('real-statistics-page-30-points-Top3-and-1.11-average');
  await invoke('settings.saveSecret', { expectedVersion: (await invoke('settings.readStatus')).version, action: 'save', secret: 's16-synthetic-no-real-key', persistence: 'session' });
  await app.evaluate(() => {
    const p = { amountFen: 1234, occurredDate: '2026-09-09', occurredTime: null, timePrecision: 'date', name: 'S16已核对消费', merchant: null, categoryId: 'cat_food', transactionKind: 'expense', amountBasis: 'line_payment', groupKey: 's16', lineItems: [], evidence: [], missingFields: [], warnings: [], confidence: 1 };
    p.evidence = ['amountFen', 'occurredDate', 'name', 'categoryId'].map(field => ({ field, text: String(p[field]), source: 'image', region: null }));
    globalThis.s16Requests = 0;
    globalThis.fetch = async () => { globalThis.s16Requests++; return new Response(JSON.stringify({ model: 'synthetic-s16', choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ schemaVersion: 'bk-candidate.v1', candidates: [p], warnings: [] }) } }] })); };
  });
  const file = path.join(localAppData, 'synthetic-s16.png'); writeFileSync(file, await sharp({ create: { width: 120, height: 80, channels: 3, background: '#ccddff' } }).png().toBuffer());
  await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, file);
  const selected = await invoke('image.select'), imported = await invoke('image.import', { selectionTokens: selected.tokens, retention: 'keep_original' }), a = imported.results[0].asset;
  const image = await invoke('image.prepare', { imageAssetId: a.id, expectedVersion: a.version, crop: null, masks: [], retainOriginal: true });
  const job = (await invoke('recognition.start', { images: [{ imageAssetId: image.id, preparedHash: image.preparedHash }], provider: 'deepseek', promptVersion: 'bk-receipt.s10.v1', uploadConsent: [{ preparedHash: image.preparedHash, confirmed: true, noticeVersion: 'recognition.v1' }], forceNew: false, reason: null })).jobs[0];
  await until(async () => (await invoke('recognition.status', { jobId: job.id, statusFilter: [], page: { limit: 100, cursor: null } })).status === 'completed');
  assert.deepEqual((await snapshot()).formal, { count: 3, total: 3330 }); check('persisted-candidate-statistics-isolation');
  const c = (await invoke('candidate.list', { jobId: job.id, page: { limit: 100, cursor: null } })).items[0];
  const input = { mode: 'single', id: c.id, expectedVersion: c.version, confirmation: { amount: true, date: true, name: true, category: true, confirmedVersion: c.version, reviewDigest: c.reviewDigest } };
  const replies = await page.evaluate(input => Promise.all(Array.from({ length: 8 }, () => window.bookkeep.candidate.approve(input))), input);
  assert(replies.every(r => r.ok), JSON.stringify(replies));
  const sql = await snapshot(); assert.deepEqual(sql.formal, { count: 4, total: 4564 }); assert.equal(sql.postings, 1); assert.equal(sql.approvals, 1); check('eight-concurrent-real-IPC-approvals-one-posting-one-audit-4564', sql);
  await app.close(); app = null; await launch();
  assert.equal((await invoke('settings.readStatus')).configured, false);
  for (const period of ['week', 'month', 'year']) assert.equal((await invoke('statistics.summary', scope(period))).totalFen, '4564');
  const retry = await invoke('candidate.approve', input); assert.equal(retry.alreadyApproved, true);
  const after = await snapshot(); assert.deepEqual(after.formal, { count: 4, total: 4564 }); assert.equal(after.postings, 1); assert.equal(after.quick, 'ok'); assert.deepEqual(after.fk, []);
  check('restart-offline-without-key-keeps-4564-and-idempotent-approval', after);
  assert.deepEqual(report.errors, []); report.ok = true;
} catch (e) { report.failure = String(e.stack ?? e); process.exitCode = 1; if (page && !page.isClosed()) await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {}); }
finally { if (app) await app.close().catch(() => {}); writeFileSync(path.join(output, 'result.json'), JSON.stringify(report, null, 2)); }
