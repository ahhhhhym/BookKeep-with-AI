/** 界面截图脚本：启动真实窗口，逐页截图后退出（用于开发自检证据）。 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { DIST, ROOT, electronExecutable, electronSafeEnv, log } from './lib/paths.mjs';

export function captureUi({ targetDir } = {}) {
  if (!existsSync(path.join(DIST, 'main', 'index.cjs'))) {
    throw new Error('缺少 dist/main/index.cjs，请先运行 npm run build');
  }
  const directory = targetDir ?? path.join(ROOT, 'evidence', 'S05', 'screens');
  mkdirSync(directory, { recursive: true });

  const status = spawnSync(
    electronExecutable(),
    [ROOT, `--capture-ui=${directory}`],
    {
      cwd: ROOT,
      env: electronSafeEnv(),
      stdio: 'inherit',
      timeout: 180_000,
    },
  );
  if (status.error) throw status.error;

  const files = existsSync(directory)
    ? readdirSync(directory).filter((name) => name.endsWith('.png'))
    : [];
  log(`captured ${files.length} screens -> ${path.relative(ROOT, directory)}`);
  return { ok: status.status === 0 && files.length === 8, exitCode: status.status, files, directory };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const result = captureUi({ targetDir: process.argv[2] ? path.resolve(process.argv[2]) : undefined });
  if (!result.ok) {
    log(`capture failed (exit ${result.exitCode}, ${result.files.length} files)`);
    process.exit(1);
  }
}
