# S05-R1 复验新增问题

日期：2026-10-20｜审查者：Codex｜修复代码a330096｜接收提交7c17aa1b9cf3982282397a6b378df2ccca75e8ee。

## BK-S05-003｜P1｜目录重建先采纳档案当前 hash，可能丢弃已知原始 hash 并放行内容已变的备份

状态：开放，阻断S05-R1及S06。关联REQ-024/030、AC16，属于本轮备份目录修复引入的完整性问题；不是要求提前完成S15全部加固。

**证据级别：静态代码路径审查。下述组合故障序列本次未动态执行；现有143例和8例定向回归均通过，但没有组合覆盖此路径。由DSH编写真实SQLite失败回归再修复，Codex不代写程序。**

代码证据（本次版本行号）：

- `src/main/services/ledger-store.ts:368-373`：启动先reconcileBackupCatalog扫描档案，后用当前数据库backup_record补登记。
- `src/main/storage/backup-catalog.ts:193-224`：discoverEntry读取manifest，直接计算档案当前hash并作为archiveHash写入目录，status=completed。
- `backup-catalog.ts:143-154`：upsertBackupCatalogEntries遇到已知id直接跳过，不比对数据库中保留的原hash，也不报告冲突。因此扫描得到的新hash先占位，原DB hash不能进入目录。
- `ledger-store.ts:681-689`：恢复时把该目录合并到旧快照的新generation；`backup-catalog.ts:287`使用INSERT OR IGNORE。若该快照早于B2创建，则B2行采用目录中的新hash。
- `src/main/services/backup-service.ts:307-312`：预览只将档案当前hash与当前DB记录比较。上述切换后两者均为新hash，原始hash约束丢失。

DSH最小复现输入（隔离临时目录，不动真实账本）：

1. 依次创建交易A、备份B1、交易C、备份B2。记录当前DB中的B2原hash H；B1快照中没有B2的backup_record。
2. 关闭store，用合法SQLite写操作将B2中某笔金额从有效整数分改为另一个有效值，保留合法schema/引用/manifest，使quick_check仍为ok但文件hash成为H2≠H；模拟目录丢失，移除catalog.json。
3. 重启。扫描先将H2写入catalog；DB补登记跳过同id，当前DB仍保留H。此刻预览B2应报HASH_MISMATCH，但目录已存了H2。
4. 正常预览并恢复未损坏的B1。新库没有B2记录，从catalog补入的B2行采用H2。
5. 再预览B2。静态推导：hash比较变成H2=H2，结构和业务检查也可通过，内容已变的档案可能被恢复为有效账本。

期望：已有可信创建记录中的hash是校验基准。目录丢失、重启或恢复不得用文件当前实算hash悄悄替换它；DB/catalog/档案发现结果冲突时保留原基准并标错/拒绝，不能由读取顺序决定信任。目录保留不能削弱已有坏hash拒绝。仅修复此已知hash冲突；本条不要求在所有历史基准均丢失时凭空证明原文件真实性。

DSH回归与交付：新增上述组合序列，验证恢复B1前后B2均拒绝且当前账本/金额不变；覆盖目录有效、丢失、损坏、重启、恢复后再次预览，并保持正常B1/B2/P可发现/再次恢复与外部账本只替换不混账。保存修复前失败和修复后结果，提交新commit及handoff/S05/REWORK-R2.md、evidence/S05-R2/，回Codex复验。

原BK-S05-001已按定向回归及代码复核关闭；BK-S05-002原“恢复后入口丢失”序列已修复并通过回归，旧项关闭，其目录重建引入的完整性缺口单独按本项阻断。上述关闭不代表S05整步通过。
