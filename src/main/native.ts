/** better-sqlite3 的懒加载入口：原生模块加载失败不应阻止应用启动或自检报告生成。 */

import type Database from 'better-sqlite3';

export type BetterSqlite3Constructor = typeof Database;

export interface NativeLoadResult {
  readonly ok: boolean;
  readonly ctor: BetterSqlite3Constructor | null;
  readonly error: string | null;
}

export function loadBetterSqlite3(): NativeLoadResult {
  try {
    // 外部化依赖：esbuild 保留 require，由 Electron 解析 node_modules（打包后为 asar.unpacked）。
    const loaded = require('better-sqlite3') as BetterSqlite3Constructor;
    return { ok: true, ctor: loaded, error: null };
  } catch {
    return { ok: false, ctor: null, error: 'SQLITE_MODULE_UNAVAILABLE' };
  }
}
