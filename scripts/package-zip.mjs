/** S18 双 ZIP 入口；保留旧包，详细流程见 release.mjs。 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { RELEASE } from './lib/paths.mjs';

export async function packageZip() {
  const { buildRelease } = await import('./release.mjs');
  return buildRelease();
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
