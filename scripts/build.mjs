/** 构建：主进程/preload 用 esbuild 打包，渲染层用 Vite 构建，并刷新许可与图标清单。 */

import { build as esbuild } from 'esbuild';
import { copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build as viteBuild } from 'vite';
import { DIST, ROOT, log } from './lib/paths.mjs';
import { cleanLicenses, collectLicenses } from './collect-licenses.mjs';
import { verifyIcons } from './verify-icons.mjs';
import { datasetBuildIdentity } from './lib/dataset-build.mjs';

const EXTERNAL_NODE = ['electron', 'better-sqlite3', 'sharp'];

export function mainBuildOptions() {
  return {
    entryPoints: [path.join(ROOT, 'src/main/index.ts')],
    outfile: path.join(DIST, 'main', 'index.cjs'),
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node24',
    external: EXTERNAL_NODE,
    sourcemap: false,
    logLevel: 'warning',
    legalComments: 'none',
    define: { __BOOKKEEP_DATASET_BUILD__: JSON.stringify(datasetBuildIdentity()) },
  };
}

export function preloadBuildOptions() {
  return {
    entryPoints: [path.join(ROOT, 'src/preload/index.ts')],
    outfile: path.join(DIST, 'preload', 'index.cjs'),
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node24',
    external: ['electron'],
    sourcemap: false,
    logLevel: 'warning',
    legalComments: 'none',
  };
}

export async function buildMainProcesses() {
  mkdirSync(path.join(DIST, 'main'), { recursive: true });
  mkdirSync(path.join(DIST, 'preload'), { recursive: true });
  await esbuild(mainBuildOptions());
  await esbuild(preloadBuildOptions());
  mkdirSync(path.join(DIST, 'main', 'probe'), { recursive: true });
  copyFileSync(path.join(ROOT, 'assets/probe/s09-receipt-v1.png'), path.join(DIST, 'main/probe/s09-receipt-v1.png'));
}

export async function buildRenderer() {
  await viteBuild({
    configFile: path.join(ROOT, 'vite.config.ts'),
    mode: 'production',
    logLevel: 'warn',
  });
}

export async function buildAll({ clean = true } = {}) {
  if (clean && existsSync(DIST)) rmSync(DIST, { recursive: true, force: true });

  const icons = await verifyIcons();
  if (!icons.ok) throw new Error('图标核验失败');
  cleanLicenses();
  collectLicenses();

  await buildMainProcesses();
  await buildRenderer();

  for (const relative of ['main/index.cjs', 'preload/index.cjs', 'renderer/index.html']) {
    if (!existsSync(path.join(DIST, relative))) {
      throw new Error(`构建缺少产物：dist/${relative}`);
    }
  }
  log('build complete: dist/{main,preload,renderer}');
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  await buildAll();
}
