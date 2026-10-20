# S05-R2 自测与证据（DSH）

版本：S05-R2｜日期：2026-10-20｜执行者：DSH｜独立复验：Codex
状态：自测完成，待 Codex 复验。**不是 AC/G 门通过**；S06 仍未开始。

## 1. 环境与基线

| 项 | 值 |
|---|---|
| OS | Windows 10 22H2 19045 x64 |
| Shell | PowerShell 7.6.7 Core，UTF-8 |
| Node / npm | v24.19.0 / 11.17.0 |
| Electron | 44.9.1（Chromium 152 / Node 24.22 / ABI 149） |
| SQLite | 3.53.4（better-sqlite3 13.0.3） |
| 应用版本 | 0.1.0 |
| 输入基线 | `4896172`（Codex R1 复验/R2 任务书原样入库） |
| 修复提交 | `29f0a51` fix(S05-R2)（7 文件，+570/−61） |
| 旧实现 | `a330096`（R1 修复）、`7c17aa1`（R1 交接）；未改写其历史证据 |

开始工作区干净；Codex 的 R1 复验文档、CONTRACTS/ARCH/DECISIONS/看板与 R2 任务书先原样提交为
`4896172`，未改内容。`backups/catalog.json` 为维护文件，本步**不新增数据库迁移**；
dbSchemaVersion 仍为 1。

## 2. 输入核验

`INPUTS.sha256` 记录 13 项输入实际 SHA256。重点遵循：

- `tasks/S05-REWORK-R2.md`、`evidence/RECEIPT-S05-R1/ISSUES.md`（BK-S05-003）、
  `RECEIPT.md`、`handoff/S05/ACCEPTANCE-R1.md`；
- `docs/CONTRACTS.md` §10.2（S02-1.2 hash 基准保留规则）、`docs/ARCHITECTURE.md` §11、
  `docs/DECISIONS.md` D41；
- `handoff/S05/REWORK-R1.md`、旧 `tasks/S05.md` / `handoff/S05/HANDOFF.md`（只读）。

## 3. BK-S05-003 根因与修复

### 根因（与 ISSUES 静态路径一致）

R1 的 `reconcileBackupCatalog` 在启动时**先扫描**档案、把当前文件 hash 作为 `archiveHash`
写入目录；随后 SQLite 已有 `backup_record` 补登记时遇到同 id 直接跳过。于是：

- 目录丢失后重启，扫描会把被改动档案的当前 hash H2 先登记；
- DB 原 hash H 无法进入目录；
- 恢复 B1（快照早于 B2）后，新 generation 没有 B2 行，目录的 H2 被合并为 B2 记录；
- 预览只比较“档案当前 hash 与当前 DB 记录”，H2=H2 即放行——原始基准丢失。

修复前 DSH 已按组合序列写出 4 个真实 SQLite 回归并全部失败；核心失败为“恢复 B1 后预览 B2
本应拒绝，但实际恢复成功”。

### 修复

1. **先导入、后扫描**：`LedgerStore.open` 与恢复切换都先把当前/切换前 DB 的
   `backup_record`（可信创建记录）导入目录，再扫描未知档案。顺序颠倒即使只有毫秒也会被
   利用，代码和注释明确固定。
2. **来源与完整状态**：目录条目增加 `origin=created|discovered`、
   `integrity=ok|conflict`、`conflictCode`、`conflictingHash`。
   - 创建/DB 导入为 `created`；扫描未知档案为 `discovered`；
   - `discovered` 条目的 hash 只是该独立档案的发现基准，遇到 DB 创建记录必须让位；
   - 目录/DB 都是 `created` 且 hash 不一致时标记 `conflict`，保留两侧 hash，不静默选择。
3. **扫描不改写已知条目**：`reconcileBackupCatalog` 只补目录中不存在的 id；坏档案/已知 hash
   冲突由预览阶段比较和处理，不以扫描结果覆盖。
4. **冲突显式化**：`backup.list` 对 conflict 条目返回 `artifact=null`（UI“校验失败/不可恢复”），
   `preview` 与 `commit` 均返回 `BACKUP_INVALID`（`CATALOG_DB_HASH_MISMATCH` 或目录冲突码），
   不生成恢复令牌；合并到新 generation 时以 `failed + error_code` 登记维护元数据。
5. **运行中删除目录也不丢基准**：恢复切换前先读取当前账本 `backup_record`，切换后再导入，
   因此不需要重启即可防止扫描抢占。
6. **failed/conflict 行不降级**：`catalogEntryFromRow` 对非 completed 但有 hash 的行标记
   conflict；目录丢失时从 DB 反向导入仍保留冲突，不把曾拒绝的档案变成可信。
7. 仍不复制交易/旧审计，不合并多账本；catalog 只含 id/ledger/kind/schema/appVersion/
   hash/ref/时间，不含密钥或账本内容。

## 4. 回归与真实 SQLite 证据

`tests/unit/db/rework2-regression.test.ts`（5 例）：

| 用例 | 覆盖 |
|---|---|
| 目录丢失后重建保留 DB 原 hash | 改 B2 金额 → 删 catalog → 重启：目录 B2 hash 仍为 H，预览 HASH_MISMATCH，当前 2 笔不变 |
| B1→B2→合法改 B2→目录丢失→重启→恢复 B1→再预览 B2 | 恢复前拒绝；恢复 B1 后仍拒绝，当前账本仍为 B1 的 1 笔；B1 与 pre_restore 正常预览 |
| 目录/DB hash 冲突 | 伪造目录 hash：列表 artifact=null、预览 BACKUP_INVALID；恢复 B1 后仍拒绝，当前 1 笔 |
| 目录 JSON 损坏 + 档案改动 | 重启重建仍取 DB 原 H；恢复 B1 后仍拒绝 B2 |
| 运行中删除目录再恢复 B1 | 切换前 DB 记录保留 B2 H；恢复后目录仍 H，预览拒绝 |

修复前日志：`logs/regression-before-fix.log`（4/4 失败，含核心序列在恢复后错误放行）。
`22:22` 的修复前运行尚未包含第 5 例（运行中删除目录，修复后补充）；第 1～4 例为任务书
指定组合序列及有效/丢失/损坏目录覆盖。修复后 `regression-after-fix.json` 5/5 通过。

## 5. 命令与结果（实际执行）

| 命令 | 退出码 | 结果 | 证据 |
|---|---|---|---|
| 修复前定向回归 | 1（预期） | 4/4 失败 | `logs/regression-before-fix.log` |
| `npm run typecheck` | 0 | 三套 tsconfig | `logs/typecheck.log` |
| `npm test` | 0 | 19 文件 / **148 例** | `logs/test.log` |
| 定向回归（JSON） | 0 | **5/5** | `regression-after-fix.json`、`logs/regression-after-fix.log` |
| `npm run build` | 0 | dist main/preload/renderer；42 图标、12 许可 | `logs/build.log` |
| `npm run smoke:electron` | 0 | 首次 28/28、重启 28/28，重启幂等 PASSED | `logs/smoke-electron.log`、`selftest-dev*.json` |
| `node scripts/db-report.mjs` | 0 | schema1、1 账本、34 分类、0 交易、quick_check ok、0 外键违规 | `db-report.json`、`schema-v1.sql` |

## 6. 契约与规格对照

| 规格（CONTRACTS §10.2 / D41） | 实现 |
|---|---|
| 已有创建记录中的 hash 是校验基准 | `created` 条目/DB 行先导入；扫描不得覆盖 |
| 文件当前实算 hash 只作比较 | 扫描仅补未知 id；已知 id 一律跳过 |
| 目录缺失/扫描先行/恢复旧快照不得重设基准 | 先导入后扫描；切换前读取当前 DB；新 generation 合并原 H |
| 同 id 记录冲突保留原基准并明确标错/拒绝 | `conflict` 标记；列表不可用；preview/commit BACKUP_INVALID |
| 不能由读取顺序静默选择 | 导入顺序固定，冲突不选边、不写回；两侧 hash 保留 |
| 仅无已知基准的独立档案按发现规则 | `origin=discovered`，仅目录/DB 都无记录时采用 |
| 不削弱坏 hash 拒绝 | 改档案/坏 hash 均 HASH_MISMATCH；恢复前后一致 |
| 不合并交易/旧审计/多账本 | 只合并 backup_record 维护行；外部 ledger 测试保留 R1 结论 |
| 不新增 S06/S15 功能 | 无新 IPC/schema 迁移；S15 外部 token/分页/状态核实仍未做 |

## 7. 未执行 / 限制

- 未动态重放真实 Electron IPC 交错序列（会向真实账本写交易）；仍由 store 服务层真实 SQLite
  文件测试 + 同一 accessor 覆盖。
- 未执行人工桌面恢复/分类/备份点击、IME/缩放/读屏、Win11/干净机/双系统、断电/杀进程。
- 未重建 S05 软件 ZIP；`release/` 仍为 S04 骨架历史包。
- S15 外部选择 token、分页、恢复操作状态核实、维护锁/故障注入、限额、正式逐文件 manifest
  与孤儿清理仍未完成；catalog 全量列表仍是 S05 阶段适配。
- 本机真实账本仍为空默认账本（0 交易）；所有故障组合只在临时目录的真实 SQLite 文件执行。
- 旧 `evidence/S05/OUTPUTS.sha256`、`evidence/S05-R1/OUTPUTS.sha256` 绑定各自修复前代码，
  按任务要求不改写；本轮输出单独见 `OUTPUTS.sha256`。

## 8. 保密自查

- 未读取/复制 DSH 凭证或配置；未调用真实 API；未创建真实消费/图片数据。
- 新增代码/测试/日志/证据无密钥、完整请求头、图片 base64、真实个人数据；catalog 仅含
  UUID/hash/版本/时间。
- 对 `src`、`tests`、`scripts`、`evidence/S05-R2`、`handoff/S05/REWORK-R2.md`、`README.md`、
  `package.json` 扫描 `sk-…`、`Bearer …`、私钥头、`AKIA…`、api_key 赋值形式：0 命中。
- 未向任何聊天或外部系统发送交接内容。
