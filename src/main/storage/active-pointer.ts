/**
 * active.json：指向当前账本 generation（原子换名更新）。
 * 该文件缺失且没有历史 generation 时视为首次启动；文件损坏或指向不存在的数据库时报
 * RECOVERY_REQUIRED，绝不静默创建空库覆盖。
 */

import { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { isUuidV4 } from '../../shared/validation';
import { generationDatabasePath, type StoragePaths } from './layout';

export const ACTIVE_POINTER_VERSION = 'bk-active.v1';

export interface ActivePointer {
  readonly manifestVersion: typeof ACTIVE_POINTER_VERSION;
  readonly generationId: string;
  readonly dbSchemaVersion: number;
  readonly ledgerId: string | null;
  readonly dataEpoch: string | null;
  readonly activatedAt: string;
  readonly previousGenerationId: string | null;
  readonly restoreId: string | null;
}

export type ActivePointerRead =
  | { readonly ok: true; readonly pointer: ActivePointer }
  | { readonly ok: false; readonly reason: 'MISSING' | 'INVALID' };

function isStringOrNull(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

export function readActivePointer(paths: StoragePaths): ActivePointerRead {
  if (!existsSync(paths.activePointer)) return { ok: false, reason: 'MISSING' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(paths.activePointer, 'utf8'));
  } catch {
    return { ok: false, reason: 'INVALID' };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, reason: 'INVALID' };
  }
  const record = parsed as Record<string, unknown>;
  const valid =
    record.manifestVersion === ACTIVE_POINTER_VERSION &&
    isUuidV4(record.generationId) &&
    typeof record.dbSchemaVersion === 'number' &&
    Number.isSafeInteger(record.dbSchemaVersion) &&
    record.dbSchemaVersion >= 1 &&
    isStringOrNull(record.ledgerId) &&
    isStringOrNull(record.dataEpoch) &&
    typeof record.activatedAt === 'string' &&
    isStringOrNull(record.previousGenerationId) &&
    isStringOrNull(record.restoreId);
  if (!valid) return { ok: false, reason: 'INVALID' };
  if (!existsSync(generationDatabasePath(paths, record.generationId as string))) {
    return { ok: false, reason: 'INVALID' };
  }
  return {
    ok: true,
    pointer: {
      manifestVersion: ACTIVE_POINTER_VERSION,
      generationId: record.generationId as string,
      dbSchemaVersion: record.dbSchemaVersion as number,
      ledgerId: record.ledgerId as string | null,
      dataEpoch: record.dataEpoch as string | null,
      activatedAt: record.activatedAt as string,
      previousGenerationId: record.previousGenerationId as string | null,
      restoreId: record.restoreId as string | null,
    },
  };
}

export function writeActivePointer(paths: StoragePaths, pointer: ActivePointer): void {
  const temporary = path.join(path.dirname(paths.activePointer), `active.${process.pid}.${Date.now()}.tmp`);
  writeFileSync(temporary, `${JSON.stringify(pointer, null, 2)}\n`, 'utf8');
  try {
    renameSync(temporary, paths.activePointer);
  } catch (error) {
    try {
      unlinkSync(temporary);
    } catch {
      // 临时文件清理失败不改变主错误。
    }
    throw error;
  }
}
