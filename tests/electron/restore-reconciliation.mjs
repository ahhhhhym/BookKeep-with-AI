/** S15 regression: actual DataPage/preload/IPC/SQLite/files; synthetic fault injection only. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { ROOT, electronExecutable, electronSafeEnv } from '../../scripts/lib/paths.mjs';

const { _electron } = createRequire(path.join(process.env.BOOKKEEP_QA_NODE_MODULES, '__qa__.cjs'))('playwright');
const output = path.resolve(process.env.BOOKKEEP_QA_OUTPUT ?? path.join(ROOT, '.tmp/restore-reconciliation'));
mkdirSync(output, { recursive: true });
const report = { ok: false, kind: 'S15 implementation selftest; not acceptance', externalHttp: 0, synthetic: true, cases: [] };
const input = { amountFen: 1800, occurredDate: '2026-09-08', occurredTime: null, timePrecision: 'date', name: '恢复核实合成交易', categoryId: 'cat_food', merchant: null, note: null };
const success = '已核实恢复提交成功；核实时本次恢复为当前数据世代。';
let app, page, localAppData;
const until = async fn => { const end = Date.now() + 18000; while (!await fn()) { if (Date.now() > end) throw Error('condition timeout'); await new Promise(r => setTimeout(r, 30)); } };
const raw = (method, value, options) => page.evaluate(({ method, value, options }) => { const [group, name] = method.split('.'); return window.bookkeep[group][name](value, options); }, { method, value, options });
const invoke = async (...args) => { const r = await raw(...args); assert.equal(r.ok, true, JSON.stringify(r.error)); return r.data; };
const nav = async id => { await page.locator(`[data-nav-item="${id}"]`).click(); await page.locator(`[data-nav="${id}"]`).waitFor(); };
const snapshot = () => app.evaluate(({ app }) => {
  const require = process.getBuiltinModule('node:module').createRequire(app.getAppPath() + '/package.json');
  const fs = require('node:fs'), path = require('node:path'), DB = require('better-sqlite3');
  const root = path.join(process.env.LOCALAPPDATA, 'BookKeepAI'), pointer = JSON.parse(fs.readFileSync(path.join(root, 'data/active.json'), 'utf8'));
  const directory = path.join(root, 'data/generations', pointer.generationId), db = new DB(path.join(directory, 'ledger.db'), { readonly: true });
  try { return { pointer, transactions: db.prepare('SELECT id,name,amount_fen FROM "transaction" WHERE deleted_at IS NULL ORDER BY id').all(), receipts: db.prepare("SELECT mutation_id,result_snapshot_json FROM mutation_receipt WHERE operation='backup.restore'").all(), integrity: db.pragma('quick_check', { simple: true }), fk: db.pragma('foreign_key_check'), attachments: db.prepare('SELECT prepared_ref,prepared_hash FROM image_asset WHERE prepared_ref IS NOT NULL').all().map(a => ({ ...a, actualHash: require('node:crypto').createHash('sha256').update(fs.readFileSync(path.join(directory, 'attachments', a.prepared_ref))).digest('hex') })), restoreLog: fs.existsSync(path.join(root, 'data/restore-log.jsonl')) ? fs.readFileSync(path.join(root, 'data/restore-log.jsonl'), 'utf8') : '' }; }
  finally { db.close(); }
});
async function launch() {
  app = await _electron.launch({ executablePath: electronExecutable(), args: [ROOT], cwd: ROOT, env: electronSafeEnv({ LOCALAPPDATA: localAppData }), timeout: 30000 });
  page = await app.firstWindow(); page.setDefaultTimeout(15000);
  await page.locator('[data-ledger-total]').waitFor(); page.on('dialog', d => d.accept());
  await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].setContentSize(1400, 1050); globalThis.fetch = async () => { throw Error('external HTTP prohibited'); }; });
}
async function installFaults(mode, secondBackupId) {
  await app.evaluate(({ ipcMain, app }, { mode, secondBackupId }) => {
    const restore = ipcMain._invokeHandlers.get('backup.restore'), status = ipcMain._invokeHandlers.get('backup.restoreStatus'), list = ipcMain._invokeHandlers.get('backup.list');
    globalThis.qa = { calls: [], mode, secondBackupId, statusCount: 0, commits: 0, original: restore };
    const trace = (channel, req, r) => globalThis.qa.calls.push({ channel, restoreId: req.mutationId ?? req.payload.restoreId, requestEpoch: req.dataEpoch, responseEpoch: r?.dataEpoch, ok: r?.ok, code: r?.error?.code, status: r?.data?.status, mode: req.payload.mode });
    ipcMain.removeHandler('backup.restore');
    ipcMain.handle('backup.restore', async (event, req) => {
      if (req.payload.mode !== 'commit') return restore(event, req);
      globalThis.qa.commits++; globalThis.qa.restoreId = req.mutationId;
      if (mode === 'unknown' || mode === 'interrupted') {
        if (mode === 'interrupted') {
          const require = process.getBuiltinModule('node:module').createRequire(app.getAppPath() + '/package.json'), fs = require('node:fs'), path = require('node:path');
          fs.appendFileSync(path.join(process.env.LOCALAPPDATA, 'BookKeepAI/data/restore-log.jsonl'), JSON.stringify({ at: new Date().toISOString(), restoreId: req.mutationId, backupId: crypto.randomUUID(), backupHash: 'synthetic-interrupted-record', status: 'switching', fromGeneration: '', toGeneration: '' }) + '\n');
        }
        trace('backup.restore', req); throw Error('synthetic lost request before handler');
      }
      const r = await restore(event, req); trace('backup.restore', req, r);
      if (r.ok) throw Error('synthetic lost SUCCESS after real SQLite/file commit');
      return r;
    });
    ipcMain.removeHandler('backup.restoreStatus');
    ipcMain.handle('backup.restoreStatus', async (event, req) => {
      globalThis.qa.statusCount++;
      if (globalThis.qa.mode === 'query-failure') { trace('backup.restoreStatus', req); throw Error('synthetic query transport failure'); }
      const second = async epoch => {
        const preview = await restore(event, { ...req, mutationId: crypto.randomUUID(), dataEpoch: epoch, payload: { mode: 'preview', backupId: secondBackupId } });
        if (!preview.ok) throw Error(JSON.stringify(preview.error));
        const secondId = crypto.randomUUID(); globalThis.qa.secondId = secondId;
        const r = await restore(event, { ...req, mutationId: secondId, dataEpoch: epoch, payload: { mode: 'commit', restoreToken: preview.data.restoreToken, currentDataWillBeReplaced: true } });
        if (!r.ok) throw Error(JSON.stringify(r.error));
        globalThis.qa.secondResult = r; return r;
      };
      if (mode === 'history' && globalThis.qa.statusCount === 1) {
        const refreshed = await status(event, req); await second(refreshed.dataEpoch);
      }
      const r = await status(event, req); trace('backup.restoreStatus', req, r);
      if (mode === 'query-timeout' && r.ok && globalThis.qa.mode === 'query-timeout') {
        await new Promise(resolve => { globalThis.qa.release = resolve; });
      }
      if (mode === 'interleaved-late' && r.ok && globalThis.qa.statusCount === 2) {
        await second(r.dataEpoch);
        await new Promise(resolve => { globalThis.qa.release = resolve; });
      }
      return r;
    });
    ipcMain.removeHandler('backup.list');
    ipcMain.handle('backup.list', async (...args) => { const r = await list(...args); globalThis.qa.calls.push({ channel: 'backup.list', requestEpoch: args[1].dataEpoch, responseEpoch: r.dataEpoch, ok: r.ok }); return r; });
  }, { mode, secondBackupId });
}

try {
  for (const mode of ['lost-success', 'query-failure', 'query-timeout', 'unknown', 'precommit-failed', 'interrupted', 'history', 'interleaved-late']) {
    localAppData = mkdtempSync(path.join(tmpdir(), 'BookKeep S15 返工 '));
    const result = { mode, localAppData, ok: false, expected: mode === 'lost-success' ? 'automatic read-only confirmation; 1 commit + 2 status reads' : 'bounded truthful status; never implicit repeat commit' };
    report.cases.push(result); await launch();
    await invoke('transaction.create', input);
    let resource;
    if (mode === 'lost-success') {
      const file = path.join(localAppData, 'synthetic.png'); writeFileSync(file, await sharp({ create: { width: 120, height: 80, channels: 3, background: '#aaccee' } }).png().toBuffer());
      await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, file);
      const selected = await invoke('image.select'); const imported = await invoke('image.import', { selectionTokens: selected.tokens, retention: 'keep_original' });
      const a = imported.results[0].asset; const prepared = await invoke('image.prepare', { imageAssetId: a.id, expectedVersion: a.version, crop: null, masks: [], retainOriginal: true });
      resource = await invoke('image.resource', { imageAssetId: prepared.id, variant: 'prepared' });
    }
    if (mode === 'precommit-failed') await app.evaluate(({ app }) => {
      const require = process.getBuiltinModule('node:module').createRequire(app.getAppPath() + '/package.json'), fs = require('node:fs'), path = require('node:path'), DB = require('better-sqlite3');
      const root = path.join(process.env.LOCALAPPDATA, 'BookKeepAI'), p = JSON.parse(fs.readFileSync(path.join(root, 'data/active.json'), 'utf8')), db = new DB(path.join(root, 'data/generations', p.generationId, 'ledger.db'));
      try { db.exec("CREATE TRIGGER qa_restore_receipt BEFORE INSERT ON mutation_receipt WHEN NEW.operation='backup.restore' BEGIN SELECT RAISE(ABORT,'synthetic receipt storage failure'); END;"); } finally { db.close(); }
    });
    const backup = await invoke('backup.create', { kind: 'manual', containsPrivateDataAcknowledged: true });
    await invoke('transaction.create', { ...input, name: '恢复前新增', amountFen: 9900 });
    const secondBackup = ['history', 'interleaved-late'].includes(mode) ? await invoke('backup.create', { kind: 'manual', containsPrivateDataAcknowledged: true }) : null;
    result.before = await snapshot();
    await nav('data');
    const row = page.locator('tr').filter({ has: page.locator(`td[title="${backup.record.archiveHash}"]`) });
    await row.getByRole('button', { name: '校验并恢复', exact: true }).click();
    await page.getByRole('button', { name: '确认覆盖当前数据并恢复', exact: true }).waitFor();
    await installFaults(mode, secondBackup?.record.id);
    await page.getByRole('button', { name: '确认覆盖当前数据并恢复', exact: true }).click();
    if (mode === 'interleaved-late') {
      await until(() => app.evaluate(() => Boolean(globalThis.qa.release)));
      // A separate current read synchronizes B while A's successful status envelope is held in transport.
      await raw('settings.readAi'); await raw('settings.readAi');
      await app.evaluate(() => globalThis.qa.release());
    }
    await page.getByRole('button', { name: '创建备份', exact: true }).waitFor({ state: 'visible' });
    await until(() => page.getByRole('button', { name: '创建备份', exact: true }).isEnabled());
    result.restoreId = await app.evaluate(() => globalThis.qa.restoreId);
    result.calls = await app.evaluate(() => globalThis.qa.calls);
    result.statusCalls = result.calls.filter(c => c.channel === 'backup.restoreStatus');
    result.ui = { text: await page.locator('#main-content').innerText(), alerts: await page.getByRole('alert').allTextContents(), success: await page.getByText(success, { exact: true }).count() === 1 };
    result.after = await snapshot();
    assert.equal(await app.evaluate(() => globalThis.qa.commits), 1);
    assert(result.statusCalls.length >= 1 && result.statusCalls.length <= 2);
    assert(result.statusCalls.every(c => c.restoreId === result.restoreId));
    assert.equal(await page.getByRole('status').filter({ hasText: '正在只读核实' }).count(), 0);
    assert(!result.ui.text.includes('正在读取备份'), 'finished reconciliation must not leave a perpetual backup loading state');
    if (mode === 'query-failure') assert(result.ui.text.includes('恢复结果尚未核实'));
    assert.equal(result.after.integrity, 'ok'); assert.deepEqual(result.after.fk, []);
    if (mode === 'lost-success') {
      assert.equal(result.ui.success, true); assert.deepEqual(result.ui.alerts, []);
      assert.deepEqual(result.statusCalls.map(c => c.code ?? c.status), ['STALE_EPOCH', 'committed']);
      assert.equal(result.statusCalls[1].requestEpoch, result.after.pointer.dataEpoch);
      assert.equal(result.after.pointer.restoreId, result.restoreId);
      assert.equal(result.after.transactions.length, 1);
      assert(result.after.receipts.some(r => r.mutation_id === result.restoreId && JSON.parse(r.result_snapshot_json).newDataEpoch === result.after.pointer.dataEpoch));
      assert(result.after.attachments.every(a => a.actualHash === a.prepared_hash));
      assert(result.calls.some(c => c.channel === 'backup.list' && c.requestEpoch === result.after.pointer.dataEpoch && c.ok));
      await page.screenshot({ path: path.join(output, 'lost-success-confirmed.png'), fullPage: true });
      result.oldResourceStatus = await app.evaluate(async ({ net }, url) => (await net.fetch(url)).status, resource.url); assert.equal(result.oldResourceStatus, 404);
      result.staleWrite = await raw('transaction.create', input, { mutationId: crypto.randomUUID(), dataEpoch: result.before.pointer.dataEpoch });
      assert.equal(result.staleWrite.error.code, 'STALE_EPOCH');
      // This is a separate explicit replay probe, AFTER checking the UI made exactly one commit.
      await app.evaluate(({ ipcMain }) => { ipcMain.removeHandler('backup.restore'); ipcMain.handle('backup.restore', globalThis.qa.original); });
      await invoke('transaction.create', { ...input, name: '提交后有效新交易', amountFen: 500 });
      const preview = await invoke('backup.restore', { mode: 'preview', backupId: backup.record.id });
      result.explicitReplay = await invoke('backup.restore', { mode: 'commit', restoreToken: preview.restoreToken, currentDataWillBeReplaced: true }, { mutationId: result.restoreId });
      assert.equal(result.explicitReplay.replayed, true);
      const kept = await snapshot(); assert.equal(kept.transactions.length, 2); assert.equal(kept.pointer.dataEpoch, result.after.pointer.dataEpoch);
      await nav('ledger'); await until(async () => await page.locator('[data-ledger-total]').getAttribute('data-ledger-total') === '2300');
    } else if (mode === 'history') {
      assert.equal(result.ui.success, false); assert(result.ui.text.includes('本次恢复曾提交，但当前已切换到另一恢复世代'));
      assert.equal(result.statusCalls.at(-1).status, 'previously_committed'); assert.equal(result.after.transactions.length, 2);
      assert.notEqual(result.after.pointer.restoreId, result.restoreId);
    } else {
      assert.equal(result.ui.success, false); assert(result.ui.alerts.length > 0);
      if (mode === 'unknown') assert(result.ui.text.includes('未查到本次恢复的确定记录'));
      if (mode === 'interrupted') assert(result.ui.text.includes('本次恢复记录中断'));
      if (mode === 'precommit-failed') {
        assert.equal(result.statusCalls.at(-1).status, 'failed'); assert(result.ui.text.includes('本次恢复在提交前失败'));
        assert.deepEqual(result.after.pointer, result.before.pointer); assert.deepEqual(result.after.transactions, result.before.transactions);
      }
      if (mode === 'query-timeout') {
        await app.evaluate(() => { globalThis.qa.mode = 'normal'; globalThis.qa.release(); });
        await page.waitForTimeout(100);
        assert.equal(await page.getByText(success, { exact: true }).count(), 0);
      }
      if (mode === 'query-failure') await app.evaluate(() => { globalThis.qa.mode = 'normal'; });
      if (['query-failure', 'query-timeout', 'interleaved-late'].includes(mode)) {
        await page.getByRole('button', { name: '重新核实本次恢复状态', exact: true }).click();
        await until(() => page.getByRole('button', { name: '创建备份', exact: true }).isEnabled());
        result.explicitRecheckText = await page.locator('#main-content').innerText();
        assert(result.explicitRecheckText.includes(mode === 'interleaved-late' ? '本次恢复曾提交' : '已核实恢复提交成功'));
        assert.equal(await app.evaluate(() => globalThis.qa.commits), 1);
        result.allCalls = await app.evaluate(() => globalThis.qa.calls);
      }
    }
    await page.screenshot({ path: path.join(output, mode + '.png'), fullPage: true });
    const beforeRestart = await snapshot(); await app.close(); app = null; await launch(); result.restart = await snapshot();
    assert.deepEqual(result.restart.pointer, beforeRestart.pointer); assert.deepEqual(result.restart.receipts, beforeRestart.receipts);
    assert.deepEqual(result.restart.transactions, beforeRestart.transactions); assert.deepEqual(result.restart.attachments, beforeRestart.attachments);
    result.restartStatus = await invoke('maintenance.restoreStatus', { restoreId: result.restoreId });
    await nav('ledger'); const total = result.restart.transactions.reduce((n, t) => n + t.amount_fen, 0);
    await until(async () => await page.locator('[data-ledger-total]').getAttribute('data-ledger-total') === String(total));
    result.restartUiTotal = total; result.ok = true;
    await page.screenshot({ path: path.join(output, mode + '-restart.png'), fullPage: true });
    await app.close(); app = null; console.log('PASS ' + mode);
    writeFileSync(path.join(output, 'result.json'), JSON.stringify(report, null, 2));
  }
  report.ok = true;
} catch (error) {
  report.failure = String(error.stack ?? error); process.exitCode = 1;
  if (page && !page.isClosed()) await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true }).catch(() => {});
} finally {
  if (app) await app.close().catch(() => {});
  writeFileSync(path.join(output, 'result.json'), JSON.stringify(report, null, 2));
}
console.log(JSON.stringify({ ok: report.ok, cases: report.cases.length, failure: report.failure, output }));
