/** 启动真实 Electron 进程执行骨架自检，并读取结构化报告。 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
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

export async function smokeElectron({ reportPath } = {}) {
  const mainBundle = path.join(DIST, 'main', 'index.cjs');
  if (!existsSync(mainBundle)) {
    throw new Error('缺少 dist/main/index.cjs，请先运行 npm run build');
  }
  const target = reportPath ?? path.join(ROOT, '.tmp', 'selftest-dev.json');
  mkdirSync(path.dirname(target), { recursive: true });

  const status = spawnSync(
    electronExecutable(),
    [ROOT, '--self-test', `--self-test-report=${target}`],
    {
      cwd: ROOT,
      env: electronSafeEnv(),
      stdio: 'inherit',
      timeout: 180_000,
    },
  );
  if (status.error) throw status.error;

  const report = readSelfTestReport(target);
  printSelfTestReport(report, 'electron self-test');
  return { ok: report.ok && status.status === 0, exitCode: status.status, report, reportPath: target };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const result = await smokeElectron();
  process.exit(result.ok ? 0 : 1);
}
