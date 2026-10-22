/**
 * 本地存储布局细化（docs/ARCHITECTURE.md §7）。
 *
 * %LOCALAPPDATA%\BookKeepAI\
 *   data\active.json                 当前 generation 指针
 *   data\generations\<uuid>\ledger.db 当前账本数据库
 *   data\restore-log.jsonl           恢复切换日志（持久、不含密钥）
 *   backups\<backupId>.bkdb          一致快照备份档案
 *   logs\ temp\ secrets\ shell\
 *
 * 程序目录只放应用与许可；真实账本、备份、日志都不写入程序目录。
 */

import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { regularPath } from './safe-file';
import type { StorageLayout } from '../paths';

export interface StoragePaths {
  readonly root: string;
  readonly data: string;
  readonly generations: string;
  readonly backups: string;
  readonly logs: string;
  readonly temp: string;
  readonly activePointer: string;
  readonly restoreLog: string;
}

export function storagePaths(layout: StorageLayout): StoragePaths {
  return {
    root: layout.root,
    data: layout.data,
    generations: path.join(layout.data, 'generations'),
    backups: layout.backups,
    logs: layout.logs,
    temp: layout.temp,
    activePointer: path.join(layout.data, 'active.json'),
    restoreLog: path.join(layout.data, 'restore-log.jsonl'),
  };
}

export function ensureStorageDirectories(paths: StoragePaths): void {
  for (const directory of [
    paths.root,
    paths.data,
    paths.generations,
    paths.backups,
    paths.logs,
    paths.temp,
  ]) {
    regularPath(directory,paths.root,false);
    mkdirSync(directory, { recursive: true });
  }
}

export function generationDirectory(paths: StoragePaths, generationId: string): string {
  return path.join(paths.generations, generationId);
}

export function generationDatabasePath(paths: StoragePaths, generationId: string): string {
  return path.join(generationDirectory(paths, generationId), 'ledger.db');
}

export function backupArchivePath(paths: StoragePaths, backupId: string): string {
  return path.join(paths.backups, `${backupId}.bkdb`);
}

/** 只返回相对根目录的受限引用（写入 DB 备份记录用，不暴露绝对路径给 UI）。 */
export function backupArchiveRef(backupId: string): string {
  return `backups/${backupId}.bkdb`;
}
