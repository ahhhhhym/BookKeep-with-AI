/**
 * 恢复切换日志（docs/CONTRACTS.md §6、ARCHITECTURE §7）。
 * 独立于账本数据库持久保存：restore mutationId、备份 hash、新旧 generation 与结果，
 * 不含密钥、图片或账本内容。用于响应丢失/崩溃后的核实，不替代 active 指针。
 */

import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { StoragePaths } from './layout';

export type RestoreStatus = 'switching' | 'committed' | 'failed';

export interface RestoreLogEntry {
  readonly at: string;
  readonly restoreId: string;
  readonly backupId: string;
  readonly backupHash: string;
  readonly fromGeneration: string;
  readonly toGeneration: string;
  readonly status: RestoreStatus;
  readonly errorCode?: string;
}

export function appendRestoreLog(paths: StoragePaths, entry: RestoreLogEntry): void {
  mkdirSync(path.dirname(paths.restoreLog), { recursive: true });
  appendFileSync(paths.restoreLog, `${JSON.stringify(entry)}\n`, 'utf8');
}

export function readRestoreLog(paths: StoragePaths): RestoreLogEntry[] {
  if (!existsSync(paths.restoreLog)) return [];
  const entries: RestoreLogEntry[] = [];
  for (const line of readFileSync(paths.restoreLog, 'utf8').split(/\r?\n/)) {
    if (line.trim().length === 0) continue;
    try {
      const parsed = JSON.parse(line) as RestoreLogEntry;
      if (
        typeof parsed.restoreId === 'string' &&
        typeof parsed.backupId === 'string' &&
        typeof parsed.backupHash === 'string' &&
        (parsed.status === 'switching' || parsed.status === 'committed' || parsed.status === 'failed')
      ) {
        entries.push(parsed);
      }
    } catch {
      // 损坏行忽略：日志只用于审计与核实，不参与启动判定。
    }
  }
  return entries;
}

export function findLastCommittedRestore(
  entries: readonly RestoreLogEntry[],
  backupHash: string,
): string | null {
  let found: string | null = null;
  for (const entry of entries) {
    if (entry.status === 'committed' && entry.backupHash === backupHash) found = entry.restoreId;
  }
  return found;
}
