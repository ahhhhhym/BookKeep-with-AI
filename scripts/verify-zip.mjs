/**
 * 核验软件 ZIP：必需产物齐全、无开发依赖/源码/凭证，并解析 app.asar 顶层清单。
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { RELEASE, log } from './lib/paths.mjs';
import { readZip, zipEntryData } from './lib/zip.mjs';

const REQUIRED = [
  { id: 'exe', pattern: /^BookKeepAI\.exe$/ },
  { id: 'asar', pattern: /^resources\/app\.asar$/ },
  { id: 'notices', pattern: /^resources\/licenses\/THIRD-PARTY-NOTICES\.md$/ },
  { id: 'lucide-license', pattern: /^resources\/licenses\/lucide-react\/LICENSE$/ },
  { id: 'native-sqlite', pattern: /resources\/app\.asar\.unpacked\/node_modules\/better-sqlite3\/prebuilds\/win32-x64\.node$/ },
];

const FORBIDDEN = [
  { id: 'top-level-node-modules', pattern: /^node_modules\// },
  { id: 'source', pattern: /^(src|tests|scripts|docs|handoff|evidence|tasks|references)\// },
  { id: 'source-maps', pattern: /\.map$/ },
  { id: 'typescript-sources', pattern: /^dist\/.*\.ts$/ },
  { id: 'env-files', pattern: /(^|\/)\.env(\.|$)/ },
  { id: 'private-keys', pattern: /\.(pem|key|pfx)$/ },
  { id: 'database', pattern: /\.(db|sqlite|sqlite3)(-wal|-shm)?$/ },
  { id: 'lockfile-in-package', pattern: /^package-lock\.json$/ },
  { id: 'build-config', pattern: /^(electron-builder\.yml|tsconfig.*\.json|vite\.config\.ts|vitest\.config\.ts)$/ },
  { id: 'dev-tooling', pattern: /app\.asar\.unpacked\/node_modules\/(typescript|vite|vitest|esbuild|@vitejs|electron-builder|electron-winstaller)\// },
];

/** asar 头：4 字节固定 4 + 4 字节头长度 + JSON（pickle 结构）。 */
export function readAsarHeader(asarBuffer) {
  if (asarBuffer.length < 16) throw new Error('app.asar 过小');
  const headerSize = asarBuffer.readUInt32LE(12);
  if (headerSize <= 0 || headerSize + 16 > asarBuffer.length) throw new Error('app.asar 头长度异常');
  const json = asarBuffer.subarray(16, 16 + headerSize).toString('utf8');
  const parsed = JSON.parse(json);
  return parsed.files ?? {};
}

export function findLatestZip() {
  if (!existsSync(RELEASE)) throw new Error('release 目录不存在，请先 npm run package:zip');
  const candidates = readdirSync(RELEASE, { recursive: true })
    .filter(name => /BookKeepAI-\d+\.\d+\.\d+-win-x64\.zip$/.test(name))
    .map(name => path.join(RELEASE, name));
  if (candidates.length === 0) throw new Error('release 目录中没有 ZIP');
  candidates.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  return candidates[candidates.length - 1];
}

export function verifyZipFile(zipPath) {
  const buffer = readFileSync(zipPath);
  const sha256 = createHash('sha256').update(buffer).digest('hex').toUpperCase();
  const entries = readZip(buffer);
  const names = entries.map((entry) => entry.name.replaceAll('\\', '/'));
  const findings = [];

  for (const requirement of REQUIRED) {
    if (!names.some((name) => requirement.pattern.test(name))) {
      findings.push({ level: 'error', id: `missing:${requirement.id}` });
    }
  }
  for (const rule of FORBIDDEN) {
    const hit = names.find((name) => rule.pattern.test(name));
    if (hit) findings.push({ level: 'error', id: `forbidden:${rule.id}`, detail: hit });
  }

  let asarTopLevel = null;
  const asarEntry = entries.find((entry) => entry.name === 'resources/app.asar');
  if (asarEntry) {
    try {
      const header = readAsarHeader(zipEntryData(buffer, asarEntry));
      asarTopLevel = Object.keys(header).sort();
      const allowedTop = new Set(['dist', 'node_modules', 'package.json']);
      for (const name of asarTopLevel) if (!allowedTop.has(name)) findings.push({ level: 'error', id: 'asar-unexpected-root', detail: name });
      const modules = Object.keys(header.node_modules?.files ?? {});
      const allowedModules = new Set(['better-sqlite3', 'sharp', '@img', '@emnapi', 'detect-libc', 'semver', 'node-addon-api', 'tslib']);
      for (const name of modules) if (!allowedModules.has(name)) findings.push({ level: 'error', id: 'asar-unexpected-dependency', detail: name });
    } catch (error) {
      findings.push({ level: 'error', id: 'asar-unreadable', detail: String(error) });
    }
  }

  const nativeEntries = names.filter((name) => name.includes('better-sqlite3'));
  return {
    ok: findings.length === 0,
    zipPath,
    sha256,
    byteSize: buffer.length,
    entryCount: entries.length,
    names,
    findings,
    asarTopLevel,
    nativeEntries,
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const target = process.argv[2] ? path.resolve(process.argv[2]) : findLatestZip();
  const result = verifyZipFile(target);
  log(`zip: ${path.basename(result.zipPath)}`);
  log(`size: ${(result.byteSize / 1024 / 1024).toFixed(2)} MiB, entries: ${result.entryCount}`);
  log(`sha256: ${result.sha256}`);
  log(`asar top-level: ${(result.asarTopLevel ?? []).join(', ')}`);
  log(`native entries: ${result.nativeEntries.join(', ')}`);
  for (const finding of result.findings) {
    log(`  ${finding.level.toUpperCase()} ${finding.id} ${finding.detail ?? ''}`);
  }
  const listingPath = process.argv[3] ? path.resolve(process.argv[3]) : null;
  if (listingPath) {
    const lines = [
      `# ${path.basename(result.zipPath)}`,
      `# sha256=${result.sha256}`,
      `# bytes=${result.byteSize} entries=${result.entryCount}`,
      `# asar top-level=${(result.asarTopLevel ?? []).join(',')}`,
      '#',
      ...result.names.map((name) => name),
    ].join('\n');
    writeFileSync(listingPath, `${lines}\n`, 'utf8');
    log(`listing written: ${listingPath}`);
  }
  if (!result.ok) {
    log('zip verification FAILED');
    process.exit(1);
  }
  log('zip verification PASSED');
}
