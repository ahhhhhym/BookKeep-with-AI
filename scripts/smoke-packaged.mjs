/**
 * 打包后冒烟：把 ZIP 解压到临时目录并从解压结果启动 EXE 自检。
 * 验证 ZIP 可运行、原生 SQLite 随包加载、渲染边界生效。
 */

import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, electronSafeEnv, ensurePlainNode, log } from './lib/paths.mjs';
import { extractZip } from './lib/zip.mjs';
import { printSelfTestReport, readSelfTestReport } from './smoke-electron.mjs';
import { findLatestZip } from './verify-zip.mjs';

export function smokePackaged({ zipPath, workDir = path.join(ROOT, '.tmp', 'unpacked-smoke-' + Date.now()) } = {}) {
  const target = zipPath ?? findLatestZip();
  assert(!existsSync(workDir), '冒烟使用新目录，保留旧失败现场');
  mkdirSync(workDir, { recursive: true });

  const written = extractZip(readFileSync(target), workDir);
  log(`extracted ${written.length} files -> ${path.relative(ROOT, workDir)}`);

  const executable = path.join(workDir, 'BookKeepAI.exe');
  if (!existsSync(executable)) throw new Error('解压结果缺少 BookKeepAI.exe');

  const localAppData = path.join(workDir, '隔离 用户数据');
  // PATH 不含 Node/npm/Python/Codex/DSH，全部依赖从解压包加载。
  const env = electronSafeEnv({ LOCALAPPDATA: localAppData, PATH: [path.join(process.env.SystemRoot, 'System32'), process.env.SystemRoot].join(path.delimiter) });
  delete env.NODE_PATH;
  const nativeCode = `const assert=require('node:assert/strict'),path=require('node:path'),{createRequire}=require('node:module');
    const asar=path.join(path.dirname(process.execPath),'resources/app.asar'),req=createRequire(asar+'/package.json');
    const paths=Object.fromEntries(['better-sqlite3','sharp','detect-libc','semver','@img/colour'].map(n=>[n,req.resolve(n)]));
    for(const f of Object.values(paths))assert(f.startsWith(asar+path.sep),'dependency escaped package');
    const DB=req('better-sqlite3'),db=new DB(':memory:');assert.equal(db.prepare('SELECT 2999999998 AS n').get().n,2999999998);const sqlite=db.prepare('SELECT sqlite_version() AS v').get().v;db.close();
    const sharp=req('sharp');sharp({create:{width:17,height:13,channels:3,background:'#abcdef'}}).png().toBuffer().then(b=>sharp(b).metadata()).then(m=>{assert.equal(m.width,17);assert.equal(m.height,13);console.log(JSON.stringify({ok:true,versions:process.versions,paths,sqlite,sharp:sharp.versions}));}).catch(e=>{console.error(e);process.exitCode=1;});`;
  const native = spawnSync(executable, ['-e', nativeCode], { cwd: workDir, env: { ...env, ELECTRON_RUN_AS_NODE: '1' }, windowsHide: true, encoding: 'utf8', timeout: 180000 });
  writeFileSync(path.join(workDir, 'native.log'), (native.stdout ?? '') + (native.stderr ?? '') + (native.error?.message ?? ''), 'utf8');
  assert.equal(native.status, 0, '随包 SQLite/sharp 原生加载失败');
  const nativeReport = JSON.parse(native.stdout.trim()); assert(nativeReport.ok);
  const reports = [];
  for (const name of ['first', 'restart']) {
    const reportPath = path.join(workDir, name + '-self-test.json');
    const status = spawnSync(executable, ['--self-test', `--self-test-report=${reportPath}`], { cwd: workDir, env, windowsHide: true, encoding: 'utf8', timeout: 180000 });
    writeFileSync(path.join(workDir, name + '.log'), (status.stdout ?? '') + (status.stderr ?? '') + (status.error?.message ?? ''), 'utf8');
    assert.equal(status.status, 0, name + ' EXE 自检退出失败');
    const report = readSelfTestReport(reportPath); printSelfTestReport(report, name);
    assert(report.ok && report.checks.every(c => c.ok)); reports.push(report);
    const seed = report.checks.find(c => c.id === 'db.defaultLedgerSeed').detail;
    assert.equal(seed.transactionCount, 0); assert.equal(seed.categoryCount, 34); assert.equal(seed.ledgerCount, 1);
    assert.equal(report.checks.find(c => c.id === 'storage.localAppDataRoot').detail.rootSuffix, path.join(localAppData, 'BookKeepAI'));
  }
  assert.deepEqual(reports[0].checks.find(c => c.id === 'db.defaultLedgerSeed').detail, reports[1].checks.find(c => c.id === 'db.defaultLedgerSeed').detail);
  const result = { ok: true, zipPath: target, workDir, localAppData, native: nativeReport, counts: reports.map(r => r.checks.length), firstReport: reports[0], restartReport: reports[1], G6: 'not_executed' };
  writeFileSync(path.join(workDir, 'smoke-result.json'), JSON.stringify(result, null, 2), 'utf8');
  return result;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  // 解压产物含 resources/app.asar，必须在真实 Node 下执行（避免 Electron 的 asar fs 包装）。
  ensurePlainNode();
  const result = smokePackaged({ zipPath: process.argv[2] ? path.resolve(process.argv[2]) : undefined });
  process.exit(result.ok ? 0 : 1);
}
