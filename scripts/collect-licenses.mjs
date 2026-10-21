/**
 * 收集第三方许可原文并生成 notices（由 npm run build / licenses 调用）。
 * 输出目录：resources/licenses/（随 ZIP 以 licenses/ 分发，不含 node_modules）。
 */

import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { RESOURCES_LICENSES, ROOT, log } from './lib/paths.mjs';

const PACKAGES = [
  { name: 'sharp', license:'LICENSE',scope:'runtime',purpose:'本地图片内容校验与裁剪遮盖' },
  { name: '@img/sharp-win32-x64', license:'LICENSE',scope:'runtime',purpose:'Sharp Windows x64 原生解码及 libvips' },
  { name: 'electron', license: 'LICENSE', scope: 'runtime', purpose: '桌面运行时' },
  { name: 'react', license: 'LICENSE', scope: 'runtime', purpose: '界面库（打包进渲染资源）' },
  { name: 'react-dom', license: 'LICENSE', scope: 'runtime', purpose: '界面渲染（打包进渲染资源）' },
  { name: 'lucide-react', license: 'LICENSE', scope: 'runtime', purpose: '本地 SVG 图标组件（ISC + Feather 衍生 MIT）' },
  { name: 'lucide-static', license: 'LICENSE', scope: 'build', purpose: '图标 slug 核验与许可原文来源' },
  { name: 'better-sqlite3', license: 'LICENSE', scope: 'runtime', purpose: '本地 SQLite 原生模块（N-API）' },
  { name: 'vite', license: 'LICENSE.md', scope: 'build', purpose: '渲染层构建' },
  { name: 'esbuild', license: 'LICENSE.md', scope: 'build', purpose: '主进程/preload 打包' },
  { name: 'typescript', license: 'LICENSE.txt', scope: 'build', purpose: '类型检查' },
  { name: 'electron-builder', license: 'LICENSE', scope: 'build', purpose: 'Windows ZIP 打包' },
  { name: 'vitest', license: 'LICENSE.md', scope: 'build', purpose: '单元测试' },
  { name: '@vitejs/plugin-react', license: 'LICENSE', scope: 'build', purpose: 'React 构建插件' },
];

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex').toUpperCase();
}

function packageDirectory(name) {
  return path.join(ROOT, 'node_modules', ...name.split('/'));
}

export function collectLicenses() {
  const entries = [];
  for (const item of PACKAGES) {
    const directory = packageDirectory(item.name);
    const manifestPath = path.join(directory, 'package.json');
    if (!existsSync(manifestPath)) {
      throw new Error(`缺少依赖 ${item.name}，请先运行 npm install`);
    }
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    const licensePath = path.join(directory, item.license);
    if (!existsSync(licensePath)) {
      throw new Error(`依赖 ${item.name} 缺少许可文件 ${item.license}`);
    }
    const content = readFileSync(licensePath);
    const targetDir = path.join(RESOURCES_LICENSES, ...item.name.split('/'));
    mkdirSync(targetDir, { recursive: true });
    const targetFile = path.join(targetDir, item.license);
    copyFileSync(licensePath, targetFile);
    entries.push({
      name: item.name,
      version: manifest.version,
      license: manifest.license ?? 'see LICENSE',
      fileName: path.relative(RESOURCES_LICENSES, targetFile).replaceAll('\\', '/'),
      sha256: sha256(content),
      scope: item.scope,
      purpose: item.purpose,
    });
  }

  mkdirSync(RESOURCES_LICENSES, { recursive: true });
  const summary = {
    generatedBy: 'scripts/collect-licenses.mjs',
    packages: entries,
  };
  writeFileSync(
    path.join(RESOURCES_LICENSES, 'summary.json'),
    `${JSON.stringify(summary, null, 2)}\n`,
    'utf8',
  );

  const runtime = entries.filter((entry) => entry.scope === 'runtime');
  const build = entries.filter((entry) => entry.scope === 'build');
  const table = (rows) =>
    [
      '| 组件 | 版本 | 许可 | 许可文件 | SHA-256 |',
      '|---|---|---|---|---|',
      ...rows.map(
        (entry) => `| ${entry.name} | ${entry.version} | ${entry.license} | ${entry.fileName} | ${entry.sha256} |`,
      ),
    ].join('\n');

  const notices = `# BookKeepAI 第三方许可清单

本清单由 \`npm run licenses\`（scripts/collect-licenses.mjs）根据当前 package-lock 锁定版本生成，
随软件 ZIP 的 \`licenses/\` 目录分发；许可原文逐项保存在同目录下。

## 随应用分发的运行组件

${table(runtime)}

## 仅开发/构建使用（不进入软件 ZIP）

${table(build)}

## 说明

- Lucide 图标主体为 ISC 许可，包含 Feather 衍生图标的 MIT 条款；完整原文见
  \`lucide-react/LICENSE\`，图标 slug 与逐文件哈希见 \`lucide/ICON-SLUGS.sha256\`。
- 本清单不含任何密钥、用户数据或开发环境配置。
`;
  writeFileSync(path.join(RESOURCES_LICENSES, 'THIRD-PARTY-NOTICES.md'), notices, 'utf8');
  log(`licenses collected: ${entries.length} packages -> ${path.relative(ROOT, RESOURCES_LICENSES)}`);
  return entries;
}

export function cleanLicenses() {
  if (existsSync(RESOURCES_LICENSES)) rmSync(RESOURCES_LICENSES, { recursive: true, force: true });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  cleanLicenses();
  collectLicenses();
}
