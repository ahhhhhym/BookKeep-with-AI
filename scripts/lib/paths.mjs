/** 构建脚本共用路径与进程工具。 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const DIST = path.join(ROOT, 'dist');
export const DIST_MAIN = path.join(DIST, 'main');
export const DIST_PRELOAD = path.join(DIST, 'preload');
export const DIST_RENDERER = path.join(DIST, 'renderer');
export const RELEASE = path.join(ROOT, 'release');
export const RESOURCES_LICENSES = path.join(ROOT, 'resources', 'licenses');

/**
 * DSH 运行时会注入 ELECTRON_RUN_AS_NODE=1，使 electron.exe 按纯 Node 运行。
 * 启动真实桌面应用前必须移除，否则不会创建窗口。
 */
export function electronSafeEnv(extra = {}) {
  const env = { ...process.env, ...extra };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.NODE_OPTIONS;
  return env;
}

export function electronExecutable() {
  const fromPackage = require('electron');
  if (typeof fromPackage !== 'string' || !existsSync(fromPackage)) {
    throw new Error('未找到 Electron 可执行文件，请先运行 npm install（或 npm run prepare）。');
  }
  return fromPackage;
}

export function nodeExecutable() {
  const fromEnv = process.env.BOOKKEEP_NODE;
  if (fromEnv && existsSync(fromEnv)) return fromEnv;
  // 注意：在 DSH 运行 npm 脚本时 process.execPath 可能是 DSH Desktop.exe（Electron 以 Node 模式运行），
  // 直接 spawn 它会启动 GUI 应用而不是 Node。这里只接受 basename 为 node.exe 的路径。
  if (/^node\.exe$/i.test(path.basename(process.execPath))) return process.execPath;
  const candidates = [
    'C:\\Program Files\\nodejs\\node.exe',
    'C:\\Program Files (x86)\\nodejs\\node.exe',
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return 'node';
}

export function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    cwd: options.cwd ?? ROOT,
    env: options.env ?? process.env,
    shell: false,
  });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

export function runCommand(commandLine, options = {}) {
  // Windows 上的 .cmd 需要 shell 解析；命令与参数均由本仓库脚本固定，不接受外部输入。
  const result = spawnSync(commandLine, {
    stdio: 'inherit',
    cwd: options.cwd ?? ROOT,
    env: options.env ?? process.env,
    shell: true,
  });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

export function npmCommand() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

export function log(message) {
  console.log(`[bookkeep] ${message}`);
}

/**
 * 在 DSH 环境中，`npm run` 使用的 node 可能是 Electron（ELECTRON_RUN_AS_NODE=1）。
 * 此时 Node 的 fs 会被 Electron 的 ASAR 包装接管：任何包含 `.asar` 的路径都会被当成
 * 压缩包解析，导致解压/读取 `resources/app.asar` 失败。
 * 需要直接接触 .asar 的脚本必须先切回真实 Node 再执行。
 */
export function ensurePlainNode() {
  if (!process.versions.electron) return;
  if (process.env.BOOKKEEP_PLAIN_NODE === '1') return;
  const script = process.argv[1];
  if (!script) return;
  const env = { ...process.env, BOOKKEEP_PLAIN_NODE: '1' };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawnSync(nodeExecutable(), [script, ...process.argv.slice(2)], {
    stdio: 'inherit',
    cwd: process.cwd(),
    env,
  });
  process.exit(child.status ?? 1);
}
