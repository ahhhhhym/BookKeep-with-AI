/** Opens ONLY this app's local key UI; never reads/prints/transcribes the key. */
import { createRequire } from 'node:module';
import path from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { ROOT, electronExecutable, electronSafeEnv } from './lib/paths.mjs';
const modules = process.env.BOOKKEEP_QA_NODE_MODULES;
if (!modules) throw new Error('BOOKKEEP_QA_NODE_MODULES must point to existing Playwright (dev diagnostic only)');
const { _electron } = createRequire(path.join(modules, '__qa__.cjs'))('playwright');
const target = path.join(ROOT, 'evidence/S09'); mkdirSync(target, { recursive: true });
const state = (value) => writeFileSync(path.join(target, 'local-probe-state.json'), JSON.stringify({ at: new Date().toISOString(), ...value }, null, 2) + '\n', 'utf8');
const app = await _electron.launch({ executablePath: electronExecutable(), args: [ROOT], cwd: ROOT, env: electronSafeEnv(), timeout: 30000 });
let page;
try {
  page = await app.firstWindow(); page.setDefaultTimeout(30000);
  await page.locator('[data-ledger-total]').waitFor();
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.show(); w.focus(); });
  state({ status: 'waiting_for_local_key', requestCount: 0 });
  // No screenshots, traces, DOM dumps or input inspection while user enters key.
  let configured = false;
  const deadline = Date.now() + 30 * 60 * 1000;
  while (Date.now() < deadline && !page.isClosed()) {
    const status = await page.evaluate(async () => { const reply = await window.bookkeep.settings.readStatus(); return reply.ok ? { configured: reply.data.configured, mode: reply.data.mode, version: reply.data.version } : null; });
    if (status?.configured) { configured = true; break; }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  if (!configured) { state({ status: 'not_executed_missing_key', requestCount: 0, G2: 'not_passed' }); process.exitCode = 2; }
  else {
    state({ status: 'requesting_one_real_image' });
    // User's S09 instruction authorizes this one fixed synthetic image request.
    const reply = await page.evaluate(() => window.bookkeep.provider.probe({ fixtureId: 's09-receipt-v1', uploadConsent: true, possibleChargeAccepted: true }));
    if (!reply.ok) { state({ status: 'probe_error', errorCode: reply.error.code, G2: 'not_passed' }); process.exitCode = 1; }
    else {
      writeFileSync(path.join(target, `real-probe-${reply.data.id}.json`), JSON.stringify(reply.data, null, 2) + '\n', 'utf8');
      state({ status: reply.data.passed ? 'real_image_passed' : 'real_image_failed', reportId: reply.data.id, requestCount: reply.data.requestCount, errorCode: reply.data.errorCode, G2: reply.data.passed ? 'passed' : 'not_passed' });
      if (!reply.data.passed) process.exitCode = 1;
    }
  }
} catch { state({ status: 'ui_or_runtime_closed', G2: 'not_passed' }); process.exitCode = 1; }
finally { await app.close().catch(() => {}); }
