/**
 * 打包后冒烟：把 ZIP 解压到临时目录并从解压结果启动 EXE 自检。
 * 验证 ZIP 可运行、原生 SQLite 随包加载、渲染边界生效。
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, electronSafeEnv, ensurePlainNode, log } from './lib/paths.mjs';
import { extractZip } from './lib/zip.mjs';
import { printSelfTestReport, readSelfTestReport } from './smoke-electron.mjs';
import { findLatestZip } from './verify-zip.mjs';

export function smokePackaged({ zipPath } = {}) {
  const target = zipPath ?? findLatestZip();
  const workDir = path.join(ROOT, '.tmp', 'unpacked-smoke');
  if (existsSync(workDir)) rmSync(workDir, { recursive: true, force: true });
  mkdirSync(workDir, { recursive: true });

  const written = extractZip(readFileSync(target), workDir);
  log(`extracted ${written.length} files -> ${path.relative(ROOT, workDir)}`);

  const executable = path.join(workDir, 'BookKeepAI.exe');
  if (!existsSync(executable)) throw new Error('解压结果缺少 BookKeepAI.exe');

  const reportPath = path.join(workDir, 'self-test-report.json');
  const status = spawnSync(
    executable,
    ['--self-test', `--self-test-report=${reportPath}`],
    {
      cwd: workDir,
      env: electronSafeEnv(),
      stdio: 'inherit',
      timeout: 180_000,
    },
  );
  if (status.error) throw status.error;

  const report = readSelfTestReport(reportPath);
  printSelfTestReport(report, 'packaged self-test');
  return { ok: report.ok && status.status === 0, exitCode: status.status, report, zipPath: target };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  // 解压产物含 resources/app.asar，必须在真实 Node 下执行（避免 Electron 的 asar fs 包装）。
  ensurePlainNode();
  const result = smokePackaged({ zipPath: process.argv[2] ? path.resolve(process.argv[2]) : undefined });
  process.exit(result.ok ? 0 : 1);
}
