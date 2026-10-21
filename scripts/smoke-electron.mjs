/**
 * 启动真实 Electron 进程执行骨架/持久化自检，并读取结构化报告。
 *
 * S05 起连续启动两次：第二次启动必须复用同一默认账本与 dataEpoch、分类数不变，
 * 以真实进程重启验证“默认数据与迁移版本不会重复插入”。这只是自动化证据，
 * 不是人工桌面/业务验收，也不代表任何 G 门通过。
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { DIST, ROOT, electronExecutable, electronSafeEnv, log } from './lib/paths.mjs';

export function readSelfTestReport(reportPath) {
  if (!existsSync(reportPath)) throw new Error(`自检报告不存在：${reportPath}`);
  return JSON.parse(readFileSync(reportPath, 'utf8'));
}

export function printSelfTestReport(report, label) {
  const passed = report.checks.filter((check) => check.ok).length;
  log(`${label}: ${report.ok ? 'PASSED' : 'FAILED'} (${passed}/${report.checks.length} checks)`);
  for (const check of report.checks) {
    const mark = check.ok ? 'ok  ' : 'FAIL';
    log(`  ${mark} ${check.id}`);
    if (!check.ok) log(`       ${JSON.stringify(check.detail ?? {})}`);
  }
}

function runOnce(reportPath, localAppData) {
  const mainBundle = path.join(DIST, 'main', 'index.cjs');
  if (!existsSync(mainBundle)) {
    throw new Error('缺少 dist/main/index.cjs，请先运行 npm run build');
  }
  mkdirSync(path.dirname(reportPath), { recursive: true });
  const status = spawnSync(
    electronExecutable(),
    [ROOT, '--self-test', `--self-test-report=${reportPath}`],
    {
      cwd: ROOT,
      env: electronSafeEnv({ LOCALAPPDATA: localAppData }),
      stdio: 'inherit',
      timeout: 180_000,
    },
  );
  if (status.error) throw status.error;
  return { status, report: readSelfTestReport(reportPath), reportPath };
}

function checkById(report, id) {
  return report.checks.find((check) => check.id === id) ?? null;
}

/** 第二次启动必须与第一次一致：同一账本、同一 dataEpoch、34 分类、schema 不变。 */
function compareRestart(first, second) {
  const firstDetail = checkById(first, 'db.defaultLedgerSeed')?.detail ?? {};
  const secondDetail = checkById(second, 'db.defaultLedgerSeed')?.detail ?? {};
  const fields = ['ledgerId', 'dataEpoch', 'categoryCount', 'ledgerCount', 'generationId'];
  const differences = fields.filter((field) => firstDetail[field] !== secondDetail[field]);
  return {
    ok: differences.length === 0,
    fields,
    differences,
    first: firstDetail,
    second: secondDetail,
  };
}

export async function smokeElectron({ reportPath, restartReportPath, restart = true } = {}) {
  // Self-tests must never migrate or initialize the current user's application ledger.
  // Both child processes share only this isolated temporary data root.
  const localAppData = mkdtempSync(path.join(tmpdir(), 'BookKeepAI-smoke-'));
  const firstTarget = reportPath ?? path.join(ROOT, '.tmp', 'selftest-dev.json');
  const first = runOnce(firstTarget, localAppData);
  printSelfTestReport(first.report, 'electron self-test (first start)');

  if (!restart) {
    return {
      ok: first.report.ok && first.status.status === 0,
      exitCode: first.status.status,
      report: first.report,
      reportPath: firstTarget,
    };
  }

  const secondTarget = restartReportPath ?? path.join(ROOT, '.tmp', 'selftest-dev-restart.json');
  const second = runOnce(secondTarget, localAppData);
  printSelfTestReport(second.report, 'electron self-test (restart)');
  const restartCheck = compareRestart(first.report, second.report);
  log(
    `restart idempotency: ${restartCheck.ok ? 'PASSED' : 'FAILED'}` +
      (restartCheck.ok
        ? ` (ledger=${restartCheck.first.ledgerId}, epoch=${restartCheck.first.dataEpoch}, categories=${restartCheck.first.categoryCount})`
        : ` differences=${restartCheck.differences.join(',')}`),
  );
  return {
    ok: first.report.ok && second.report.ok && first.status.status === 0 && second.status.status === 0 && restartCheck.ok,
    exitCode: first.status.status === 0 && second.status.status === 0 ? 0 : 1,
    report: second.report,
    firstReport: first.report,
    reportPath: secondTarget,
    restart: restartCheck,
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const result = await smokeElectron();
  process.exit(result.ok ? 0 : 1);
}
