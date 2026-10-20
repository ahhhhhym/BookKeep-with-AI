/**
 * 只读诊断：输出本机账本的 schema 版本、默认账本、分类、迁移/备份记录与完整性结果。
 * 不写数据库、不读取密钥；用于开发自检与交接证据（不含路径以外的敏感内容）。
 *
 * 用法：node scripts/db-report.mjs [--json=路径] [--schema=路径]
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);

export function readDbReport({ root } = {}) {
  const base = root ?? path.join(process.env.LOCALAPPDATA ?? '', 'BookKeepAI');
  const activePath = path.join(base, 'data', 'active.json');
  if (!existsSync(activePath)) throw new Error(`未找到 active.json：${activePath}`);
  const active = JSON.parse(readFileSync(activePath, 'utf8'));
  const dbPath = path.join(base, 'data', 'generations', active.generationId, 'ledger.db');
  if (!existsSync(dbPath)) throw new Error(`未找到账本数据库：${dbPath}`);

  const Database = require('better-sqlite3');
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    const meta = db
      .prepare(
        `SELECT db_schema_version, contract_version, data_epoch, active_generation, migration_state
           FROM app_meta WHERE id = 'app'`,
      )
      .get();
    const ledger = db.prepare('SELECT * FROM ledger').all();
    const categories = db
      .prepare(
        `SELECT id, name, icon_key, sort_order, enabled, system_key, version
           FROM category ORDER BY sort_order, id`,
      )
      .all();
    const counts = {
      ledger: db.prepare('SELECT COUNT(*) AS n FROM ledger').get().n,
      category: db.prepare('SELECT COUNT(*) AS n FROM category').get().n,
      transaction: db.prepare('SELECT COUNT(*) AS n FROM "transaction"').get().n,
      audit: db.prepare('SELECT COUNT(*) AS n FROM audit_event').get().n,
      receipt: db.prepare('SELECT COUNT(*) AS n FROM mutation_receipt').get().n,
      backup: db.prepare('SELECT COUNT(*) AS n FROM backup_record').get().n,
    };
    const migrations = db
      .prepare('SELECT from_version, to_version, status, checksum, backup_id, error_code FROM migration_record ORDER BY to_version')
      .all();
    const backups = db
      .prepare('SELECT id, kind, status, db_schema_version, archive_hash, created_at FROM backup_record ORDER BY created_at')
      .all();
    const quickCheck = db.prepare('PRAGMA quick_check').all();
    const foreignKeyViolations = db.prepare('PRAGMA foreign_key_check').all();

    const report = {
      generatedAt: new Date().toISOString(),
      dataRootSuffix: path.join('BookKeepAI', 'data', 'generations'),
      generationId: active.generationId,
      databaseRelativePath: path.relative(base, dbPath).split(path.sep).join('/'),
      appMeta: meta,
      ledger,
      counts,
      categories,
      migrations,
      backups,
      integrity: {
        quickCheck: quickCheck.map((row) => row.quick_check),
        foreignKeyViolations: foreignKeyViolations.length,
      },
    };
    return { report, db, dbPath, active };
  } finally {
    // 调用方仍需 schema 时在外部单独读取；此处不关闭，由调用方负责。
  }
}

function schemaSql(db) {
  const objects = db
    .prepare(
      `SELECT type, name, sql FROM sqlite_master
        WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'
        ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 WHEN 'trigger' THEN 2 ELSE 3 END, name`,
    )
    .all();
  return objects.map((row) => `-- ${row.type}: ${row.name}\n${row.sql};`).join('\n\n') + '\n';
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const args = process.argv.slice(2);
  const jsonPath = args.find((argument) => argument.startsWith('--json='))?.slice('--json='.length);
  const schemaPath = args.find((argument) => argument.startsWith('--schema='))?.slice('--schema='.length);
  const wrapper = readDbReport({});
  try {
    const output = wrapper.report;
    if (jsonPath) writeFileSync(jsonPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
    if (schemaPath) writeFileSync(schemaPath, schemaSql(wrapper.db), 'utf8');
    console.log(JSON.stringify({ ...output, categories: output.categories.length }, null, 2));
  } finally {
    wrapper.db.close();
  }
}
