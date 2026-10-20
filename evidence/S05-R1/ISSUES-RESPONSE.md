# S05-R1 问题单响应（DSH）

日期：2026-10-20｜对应 `evidence/RECEIPT-S04-S05/ISSUES.md`｜修复提交 `a330096`
状态：DSH 自测通过，待 Codex 复验；未将自测当作关闭结论。

## BK-S05-001（P1）回放旧收据使当前 revision 回退，过期恢复预览重新有效

| 项 | 内容 |
|---|---|
| 状态 | 已修复，待复验 |
| 根因 | `runMutation` 回放返回收据 `revision_at_commit`；`trackMutation` 写回 `this.revision`；恢复 token 与 IPC 信封使用该缓存 |
| 修复 | 回放只返回 `committedRevision`；store 的 `currentRevision`/snapshot 每次读取持久 `Ledger.dataRevision`；分类/交易输出增加 `committedRevision`；preview/commit token 用 `AppMeta.dataEpoch + Ledger.dataRevision` 持久事实源；旧收据缺字段回退 `revision_at_commit` |
| 回归 | `tests/unit/db/rework-regression.test.ts` 前 3 例：当前水位不回退、旧令牌 `RESTORE_CONTEXT_STALE` 且 C 保留、连续/分类/重启回放不重复写入 |
| 证据 | `logs/regression-before-fix.log`（修复前 6/6 失败，含旧令牌实际恢复成功）、`logs/regression-after-fix.log`（8/8 通过）、`regression-after-fix.json` |
| 未覆盖 | 真实 Electron IPC 交错序列未动态执行（会写真实账本）；信封使用同一 `currentRevision` accessor，由 store 单测覆盖 |

## BK-S05-002（P2）恢复旧快照后已保留备份档案失去目录入口

| 项 | 内容 |
|---|---|
| 状态 | 已修复，待复验 |
| 根因 | 档案快照早于自身 `backup_record`；恢复后新库只补 pre_restore，`list/preview` 仅看当前 DB 记录 |
| 修复 | 新增 `backups/catalog.json` 独立目录；创建时先登记；启动扫描补登记；恢复切换时把目录合并进新 generation（只写 backup_record 维护元数据，不复制交易/审计）；`catalog.json` 丢失可由档案重建；文件缺失 artifact=null、坏 hash 预览拒绝；UI 标记不可恢复 |
| 回归 | `tests/unit/db/rework-regression.test.ts` 后 5 例：恢复后 B1/B2/P 可见且 B2 可再次恢复；重启保持；损坏拒绝不覆盖；外部 ledgerId 只替换不混账；缺失文件/目录重建 |
| 证据 | 同上；`logs/test.log`（143 例全量） |
| 未覆盖 | 断电/杀进程故障注入、S15 外部 token/分页/恢复状态核实/限额/孤儿清理；未宣称 AC16 整项完成 |

## 对“未列为缺陷的边界”的遵守

- 未允许旧 `restoreToken` 跨新 epoch 重放；恢复后旧 epoch 仍由 registry 返回 `STALE_EPOCH`。
- 未把恢复操作状态核实入口塞进 S05；仍归 S15。
- 未扩展 S06/统计/真实 API；`backup.list`/内部 backupId/DB-only 档案仍按 §10.2 阶段适配。
