/** 清理构建与打包产物（只删除本仓库已知目录，不触碰源码、文档与 git 历史）。 */

import { existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { DIST, RELEASE, ROOT, log } from './lib/paths.mjs';

const TARGETS = [DIST, RELEASE, path.join(ROOT, '.tmp'), path.join(ROOT, 'coverage')];

export function clean() {
  for (const target of TARGETS) {
    const resolved = path.resolve(target);
    if (!resolved.startsWith(path.resolve(ROOT) + path.sep)) {
      throw new Error(`拒绝删除仓库外路径：${resolved}`);
    }
    if (existsSync(resolved)) {
      rmSync(resolved, { recursive: true, force: true });
      log(`removed ${path.relative(ROOT, resolved)}`);
    }
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  clean();
}
