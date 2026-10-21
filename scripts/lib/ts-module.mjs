/** 用 esbuild 把仓库内 TypeScript 模块转成可导入的 ESM，供构建脚本复用规格常量。 */

import { build } from 'esbuild';
import path from 'node:path';
import { ROOT } from './paths.mjs';

export async function loadSharedModule(relativePath) {
  const result = await build({
    entryPoints: [path.join(ROOT, relativePath)],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
    target: 'node22',
    logLevel: 'silent',
  });
  const output = result.outputFiles?.[0]?.text;
  if (!output) throw new Error(`无法编译 ${relativePath}`);
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(output, 'utf8').toString('base64')}`;
  return import(moduleUrl);
}
