/** S09 implementation self-test. Only synthetic keys; never a real network call. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ROOT, electronExecutable, electronSafeEnv } from './lib/paths.mjs';
const modules = process.env.BOOKKEEP_QA_NODE_MODULES;
if (!modules) throw new Error('BOOKKEEP_QA_NODE_MODULES required, existing Playwright only');
const { _electron } = createRequire(path.join(modules, '__qa__.cjs'))('playwright');
const localAppData = mkdtempSync(path.join(tmpdir(), 'BookKeep S09 中文 '));
const target = path.join(ROOT, 'evidence/S09'); mkdirSync(target, { recursive: true });
const checks = []; const errors = []; const notices = [];
const report = { ok: false, kind: 'S09 implementation self-test; NOT real API, S08/S17/S19 acceptance', browser: 'Browser plugin not available; existing Playwright Electron', localAppData, checks, errors, notices };
let app, page;
const check = (id, detail = {}) => { checks.push({ id, ok: true, detail }); console.log(`PASS ${id}`); };
async function launch() {
  app = await _electron.launch({ executablePath: electronExecutable(), args: [ROOT], cwd: ROOT, env: electronSafeEnv({ LOCALAPPDATA: localAppData }), timeout: 30000 });
  page = await app.firstWindow(); page.setDefaultTimeout(15000);
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { const text = m.text(); if (text === "The Content Security Policy directive 'frame-ancestors' is ignored when delivered via a <meta> element.") notices.push(text); else if (m.type() === 'error') errors.push(text); else if (m.type() === 'warning') notices.push(text); });
  await page.locator('[data-ledger-total]').waitFor();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1280, 1000));
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByText('尚未配置密钥，手工记账可用。', { exact: true }).waitFor().catch(() => {});
}
async function status() { return page.evaluate(async () => (await window.bookkeep.settings.readStatus()).data); }
async function screen(name) {
  await page.locator('#secret-input').fill('');
  await page.evaluate(() => document.activeElement?.blur());
  await page.evaluate(() => Promise.all(document.getAnimations().map((animation) => animation.finished.catch(() => {}))));
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const bytes = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64'));
  const file = path.join(localAppData, name); writeFileSync(file, Buffer.from(bytes, 'base64')); return file;
}
try {
  await launch(); assert.ok(page.url().startsWith('bookkeep://app/')); assert.match(await page.title(), /BookKeepAI/);
  assert.equal(await page.locator('vite-error-overlay').count(), 0); assert.equal(await page.getByRole('heading', { name: '识图密钥', exact: true }).count(), 1);
  check('identity-not-blank-no-overlay', { url: page.url(), title: await page.title() });
  assert.equal((await status()).configured, false);
  assert.equal(await page.getByRole('button', { name: '运行一次真实图片探针', exact: true }).isDisabled(), true);
  const noKey = await page.evaluate(() => window.bookkeep.provider.probe({ fixtureId: 's09-receipt-v1', uploadConsent: true, possibleChargeAccepted: true }));
  assert.equal(noKey.data.errorCode, 'SECRET_REQUIRED'); assert.equal(noKey.data.requestCount, 0); report.missingSecretReport = noKey.data;
  check('no-key-no-request-not-verified');
  const synthetic = 's09-synthetic-key-never-send-to-api';
  // Hold the real IPC response after main has stored it, to inspect immediate clearing.
  await app.evaluate(({ ipcMain }) => {
    const original = ipcMain._invokeHandlers.get('settings.saveSecret');
    globalThis.__s09 = { original };
    globalThis.__s09.started = new Promise((resolve) => { globalThis.__s09.start = resolve; });
    globalThis.__s09.gate = new Promise((resolve) => { globalThis.__s09.release = resolve; });
    ipcMain.removeHandler('settings.saveSecret'); ipcMain.handle('settings.saveSecret', async (event, request) => { const reply = await original(event, request); globalThis.__s09.start(); await globalThis.__s09.gate; return reply; });
  });
  await page.locator('#secret-input').fill(synthetic); await page.getByRole('button', { name: '保存到本机加密存储', exact: true }).click();
  await app.evaluate(() => globalThis.__s09.started);
  assert.equal(await page.locator('#secret-input').inputValue(), ''); assert.equal(await page.locator('#secret-input').isDisabled(), true);
  await app.evaluate(({ ipcMain }) => { ipcMain.removeHandler('settings.saveSecret'); ipcMain.handle('settings.saveSecret', globalThis.__s09.original); globalThis.__s09.release(); });
  await page.getByText('已为当前 Windows 用户加密保存。', { exact: true }).first().waitFor();
  const saved = await status(); assert.equal(saved.mode, 'encrypted'); assert.equal(saved.encryptionAvailable, true);
  await page.locator('.statusbar').getByText(/密钥.*已加密/).waitFor();
  const file = path.join(localAppData, 'BookKeepAI/secrets/deepseek.secret.json'); assert.ok(existsSync(file));
  assert.ok(!readFileSync(file, 'utf8').includes(synthetic)); assert.ok(!JSON.stringify(saved).includes(synthetic));
  check('real-Windows-DPAPI-save-immediate-clear-before-response-and-no-key-in-status', saved);
  report.encryptedScreenshot = await screen('s09-encrypted.png');
  await app.close(); app = null; await launch(); assert.equal((await status()).mode, 'encrypted');
  const disk = readFileSync(file, 'utf8'); const decrypts = await app.evaluate(({ safeStorage }, { disk, synthetic }) => safeStorage.decryptString(Buffer.from(JSON.parse(disk).blob, 'base64')) === synthetic, { disk, synthetic });
  assert.equal(decrypts, true); check('real-process-restart-decrypts-synthetic-with-same-Windows-user');
  const stale = await page.evaluate(() => window.bookkeep.settings.saveSecret({ expectedVersion: 0, action: 'remove' }));
  assert.equal(stale.error.code, 'VERSION_CONFLICT'); check('IPC-CAS-stale-rejected');
  await page.getByRole('button', { name: '移除密钥', exact: true }).click(); await page.getByText('已移除密钥。', { exact: true }).waitFor();
  assert.equal((await status()).configured, false); assert.equal(JSON.parse(readFileSync(file, 'utf8')).blob, null); check('remove-clears-disk-and-status');
  await page.locator('#secret-input').fill(synthetic); await page.getByRole('button', { name: '仅本次会话', exact: true }).click();
  await page.getByText('密钥仅在本次会话保留；退出后需重新输入。', { exact: true }).waitFor(); assert.equal((await status()).mode, 'session');
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).blob, null); check('session-mode-does-not-write-plaintext-or-encrypted-key');
  // Exercise the probe UI with an explicitly mocked main-process HTTP response.
  // This cannot count as real G2 evidence; real-probe-*.json is separate.
  await app.evaluate(() => {
    globalThis.__s09fetch = { original: globalThis.fetch };
    globalThis.__s09fetch.started = new Promise((resolve) => { globalThis.__s09fetch.start = resolve; });
    globalThis.__s09fetch.gate = new Promise((resolve) => { globalThis.__s09fetch.release = resolve; });
    globalThis.fetch = async () => { globalThis.__s09fetch.start(); await globalThis.__s09fetch.gate; return new Response('mock-auth-error', { status: 401 }); };
  });
  await page.getByRole('checkbox', { name: '我同意上传合成测试图并接受本次 API 费用', exact: true }).check();
  await page.getByRole('button', { name: '运行一次真实图片探针', exact: true }).click();
  await app.evaluate(() => globalThis.__s09fetch.started);
  assert.equal(await page.getByRole('button', { name: '运行一次真实图片探针', exact: true }).isDisabled(), true);
  await page.getByRole('status').getByText('正在处理实际操作，请稍候…', { exact: true }).waitFor();
  await app.evaluate(() => globalThis.__s09fetch.release());
  await page.locator('[data-probe-result]').filter({ hasText: 'PROVIDER_AUTH' }).waitFor();
  assert.equal(await page.getByRole('button', { name: '运行一次真实图片探针', exact: true }).isEnabled(), true);
  await app.evaluate(() => { globalThis.fetch = globalThis.__s09fetch.original; });
  check('MOCK-HTTP-401-only-probe-button-real-pending-and-safe-error-result-NOT-G2');
  await app.close(); app = null; await launch(); assert.equal((await status()).configured, false); check('session-key-gone-after-process-restart');
  report.finalScreenshot = await screen('s09-ready-for-user-key.png');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(640, 600));
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true); report.smallScreenshot = await screen('s09-small.png'); check('small-viewport-no-horizontal-overflow');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1280, 1000));
  await page.getByRole('button', { name: '记账', exact: true }).click(); await page.locator('[data-ledger-total]').waitFor();
  assert.equal(await page.locator('[data-ledger-total]').getAttribute('data-ledger-total'), '0'); check('manual-ledger-still-available-without-key');
  assert.equal(errors.length, 0); report.ok = true;
} catch (e) { report.error = e.stack; console.error(e); process.exitCode = 1; }
finally { writeFileSync(path.join(target, `ui-selftest-${Date.now()}.json`), JSON.stringify(report, null, 2) + '\n', 'utf8'); if (app) await Promise.race([app.close(), new Promise((resolve) => setTimeout(resolve, 10000))]).catch(() => {}); }
