/**
 * 本地存储布局（docs/ARCHITECTURE.md §7）。
 * 根目录固定为 %LOCALAPPDATA%\BookKeepAI；无法解析时返回 STORAGE_UNAVAILABLE，
 * 绝不回退到程序目录（解压目录可能只读或随 ZIP 移动）。
 */

import path from 'node:path';

export const STORAGE_ROOT_NAME = 'BookKeepAI';

export interface StorageLayout {
  /** %LOCALAPPDATA%\BookKeepAI */
  readonly root: string;
  /** 业务数据与 generation（S05 起使用）。 */
  readonly data: string;
  /** 系统用户加密的密钥 blob 目录（S09 使用）。 */
  readonly secrets: string;
  /** 本地完整备份。 */
  readonly backups: string;
  /** 脱敏日志。 */
  readonly logs: string;
  /** 临时与 staging。 */
  readonly temp: string;
  /** Chromium/Electron 自身状态（userData），与业务数据分开。 */
  readonly shell: string;
}

export type StorageResolution =
  | { readonly ok: true; readonly layout: StorageLayout }
  | { readonly ok: false; readonly code: 'STORAGE_UNAVAILABLE'; readonly reason: string };

export function resolveStorageLayout(env: NodeJS.ProcessEnv = process.env): StorageResolution {
  const localAppData = env.LOCALAPPDATA?.trim();
  if (!localAppData) {
    return { ok: false, code: 'STORAGE_UNAVAILABLE', reason: 'LOCALAPPDATA_UNSET' };
  }
  if (!path.isAbsolute(localAppData)) {
    return { ok: false, code: 'STORAGE_UNAVAILABLE', reason: 'LOCALAPPDATA_NOT_ABSOLUTE' };
  }
  const root = path.join(localAppData, STORAGE_ROOT_NAME);
  if (!path.isAbsolute(root) || path.parse(root).root !== path.parse(localAppData).root) {
    return { ok: false, code: 'STORAGE_UNAVAILABLE', reason: 'ROOT_OUTSIDE_LOCALAPPDATA' };
  }
  return {
    ok: true,
    layout: {
      root,
      data: path.join(root, 'data'),
      secrets: path.join(root, 'secrets'),
      backups: path.join(root, 'backups'),
      logs: path.join(root, 'logs'),
      temp: path.join(root, 'temp'),
      shell: path.join(root, 'shell'),
    },
  };
}

/** 程序目录只放应用与许可；不得在此写入数据库、日志或备份。 */
export function isInsideDirectory(target: string, directory: string): boolean {
  const normalizedTarget = path.resolve(target);
  const normalizedDirectory = path.resolve(directory);
  if (normalizedTarget === normalizedDirectory) return true;
  return normalizedTarget.startsWith(normalizedDirectory + path.sep);
}
