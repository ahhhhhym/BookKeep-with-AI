# S05-R2 问题单响应（DSH）

日期：2026-10-20｜对应 `evidence/RECEIPT-S05-R1/ISSUES.md` 的 BK-S05-003｜修复提交 `29f0a51`
状态：DSH 自测通过，待 Codex 复验；不将自测当关闭结论。

## BK-S05-003（P1）目录重建先采纳档案当前 hash，可能丢弃已知原始 hash

| 项 | 内容 |
|---|---|
| 状态 | 已修复，待复验 |
| 根因 | 启动时 `reconcileBackupCatalog` 先扫描并把当前文件 hash 登记为 `archiveHash`；随后 DB 补登记同 id 跳过。目录丢失后，恢复旧快照的新 generation 使用扫描 hash，原始 DB hash 失去约束 |
| 代码证据对应 | `ledger-store` 启动顺序、`backup-catalog` 的发现/补登记、恢复切换合并、`backup-service` 预览比较 |
| 修复 | ①先导入 DB/目录可信创建记录，再扫描未知档案；②条目增加 `origin`/`integrity`/冲突码；③扫描只补未知 id，不覆盖已知基准；④DB 与目录同为 created 且 hash 不一致 → conflict，列表 artifact=null、preview/commit `BACKUP_INVALID`；⑤恢复切换前读取当前 DB 记录，运行中删目录也不丢基准；⑥failed/conflict 行不会在目录丢失时降级为可信 |
| 回归 | `tests/unit/db/rework2-regression.test.ts` 5 例：目录丢失重建保留原 H；B1→B2→合法改 B2→目录丢失→重启→恢复 B1→再预览 B2 仍拒绝；目录/DB hash 冲突标错；目录 JSON 损坏 + 改动档案；运行中删目录再恢复 |
| 证据 | `logs/regression-before-fix.log`（4/4 失败，核心序列恢复后错误放行）、`regression-after-fix.json`/`logs/regression-after-fix.log`（5/5 通过）、`logs/test.log`（148 例全量） |
| 未覆盖 | 真实 Electron IPC 写入交错、人工桌面、断电/杀进程、S15 外部 token/分页/恢复状态/限额/孤儿清理；未宣称 AC16 或 G 门通过 |

## 边界遵守

- 未把恢复后的交易与旧库交易合并；catalog/DB 只合并 backup_record 维护元数据。
- 未复制旧审计；恢复审计仍只写本次恢复事件。
- 未新增多账本；外部 ledgerId 档案仍是整账本替换（R1 回归保持）。
- 未新增 S06/S15 功能，未新增数据库迁移（dbSchemaVersion=1）。
- 旧交接/证据/哈希未改写；本轮新增 `handoff/S05/REWORK-R2.md` 与 `evidence/S05-R2/`。
