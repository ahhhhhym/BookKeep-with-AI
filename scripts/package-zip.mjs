/** 打包 Windows x64 ZIP：构建 → electron-builder → ZIP 核验 → SHA256。 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildAll } from './build.mjs';
import { RELEASE, ROOT, electronSafeEnv, log, nodeExecutable, run } from './lib/paths.mjs';
import { findLatestZip, verifyZipFile } from './verify-zip.mjs';

const require = createRequire(import.meta.url);

function electronBuilderCli() {
  const manifest = require('electron-builder/package.json');
  const bin = typeof manifest.bin === 'string' ? manifest.bin : Object.values(manifest.bin ?? {})[0];
  if (!bin) throw new Error('electron-builder 缺少 CLI 入口');
  const cli = path.join(ROOT, 'node_modules', 'electron-builder', bin);
  if (!existsSync(cli)) throw new Error(`未找到 electron-builder CLI：${cli}`);
  return cli;
}

export async function packageZip() {
  await buildAll();

  if (existsSync(RELEASE)) rmSync(RELEASE, { recursive: true, force: true });
  mkdirSync(RELEASE, { recursive: true });

  const cli = electronBuilderCli();
  const status = run(
    nodeExecutable(),
    [cli, '--win', 'zip', '--x64', '--publish', 'never', '--config', path.join(ROOT, 'electron-builder.yml')],
    { env: electronSafeEnv() },
  );
  if (status !== 0) {
    throw new Error(`electron-builder 失败（exit ${status}）`);
  }

  const zipPath = findLatestZip();
  const verification = verifyZipFile(zipPath);
  log(`artifact: ${path.relative(ROOT, zipPath)}`);
  log(`bytes: ${statSync(zipPath).size}`);
  log(`sha256: ${verification.sha256}`);
  log(`entries: ${verification.entryCount}`);
  log(`asar top-level: ${(verification.asarTopLevel ?? []).join(', ')}`);
  log(`native entries: ${verification.nativeEntries.join(', ')}`);
  for (const finding of verification.findings) {
    log(`  ${finding.level.toUpperCase()} ${finding.id} ${finding.detail ?? ''}`);
  }
  if (!verification.ok) throw new Error('ZIP 核验失败');
  log('package:zip PASSED');
  return { zipPath, verification };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  await packageZip();
}

// 供其他脚本读取 ZIP 哈希。
export function sha256OfFile(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex').toUpperCase();
}

export function listReleaseArtifacts() {
  if (!existsSync(RELEASE)) return [];
  return readdirSync(RELEASE).map((name) => path.join(RELEASE, name));
}
