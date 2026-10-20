# S05-R1 返工自测与证据（DSH）

版本：S05-R1｜日期：2026-10-20｜执行者：DSH｜独立复验：Codex
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
| 返工输入基线 | `5924d24`（Codex 验收/规格/任务书原样入库） |
| 修复提交 | `a330096` fix(S05-R1) |
| 旧实现 | `075c475` 业务代码、`e20badf` 旧交接；未改写其历史证据 |

开始工作区干净；Codex 的验收文档（`handoff/S05/ACCEPTANCE.md`、
`evidence/RECEIPT-S04-S05/*`、`tasks/S05-REWORK.md`、5 份规格补充）先由 DSH 原样提交为
`5924d24`，未改内容，然后开始返工。

## 2. 输入核验

逐文件 SHA256 见 `INPUTS.sha256`（13 项）。重点阅读并遵循：

- `tasks/S05-REWORK.md`、`evidence/RECEIPT-S04-S05/ISSUES.md`、`RECEIPT.md`、
  `handoff/S05/ACCEPTANCE.md`；
- `docs/CONTRACTS.md` §10（S02-1.1）、`docs/ARCHITECTURE.md` §11、`docs/DECISIONS.md`
  D36～D40、`docs/ICON-MAP.md` §4、`执行看板.md`；
- 旧 `tasks/S05.md`、`handoff/S05/HANDOFF.md`（只读，不改写）。

## 3. 缺陷与修复

### BK-S05-001（P1）回放旧收据使当前 revision 回退，过期恢复令牌可重新生效

根因（与 ISSUES 指向一致）：

1. `runMutation` 回放返回 `revision_at_commit`，`LedgerStore.trackMutation` 把它直接赋给
   当前缓存 `this.revision`；
2. `BackupService.preview/commit` 使用该缓存值签发/校验恢复令牌；
3. IPC 信封也读取该缓存。

修复：

- `runMutation` 回放返回 `committedRevision`（收据内原提交值）与持久业务对象；当前水位不再
  由收据写回。旧收据缺少该字段时回退 `revision_at_commit`，兼容已有数据库。
- 分类/交易变更输出按 CONTRACTS §10.1 增加 `committedRevision`（首次提交与回放均为原提交值；
  无实际变化的成功操作取当前持久 revision）。
- `LedgerStore.currentRevision` / `snapshot().dataRevision` / `trackMutation` 均重新读取
  `Ledger.dataRevision`；缓存只在 DB 关闭/异常时兜底。IPC 信封使用同一 accessor。
- `BackupService` 的 preview 签发 token 与 commit 校验 token 均读取持久事实源
  `AppMeta.dataEpoch + Ledger.dataRevision`（`currentBackupFacts`），不再使用 store 缓存。
- commit 顺序：验签 → 持久 epoch/revision 比对（不一致返回
  `TOKEN_EXPIRED / RESTORE_CONTEXT_STALE`）→ 记录/哈希/清单/完整性 → pre_restore → staging。

回归（`tests/unit/db/rework-regression.test.ts`）：

| 用例 | 断言 |
|---|---|
| 回放后当前水位 | A(rev1) → 备份 → 预览 → C(rev2) → 回放 A：`committedRevision=1`、`snapshot().dataRevision=2`、`currentRevision=2`、list `snapshotRevision=2`；收据 2、transaction.create 审计 2 |
| 旧令牌失效 | 回放 A 后提交预览令牌 → `TOKEN_EXPIRED/RESTORE_CONTEXT_STALE`，C 仍在，交易数 2、revision 2 |
| 连续/分类/重启回放 | 回放 3 次、分类改名回放、重启后回放：committedRevision 分别 1/2，当前水位 3 不变，交易 2、收据 3、审计 4（含 ledger.initialize），无重复写入 |

### BK-S05-002（P2）恢复旧快照后已保留备份档案失去目录入口

根因：档案快照先于自身 `backup_record` 生成；恢复后新库不包含所选档案和较新档案的记录，
代码只补 pre_restore，`list/preview` 依赖当前 DB 记录，故 B1/B2 不可见。

修复（CONTRACTS §10.2 允许的“受限重建目录”）：

- 新增 `src/main/storage/backup-catalog.ts` 与 `backups/catalog.json`：
  - 创建档案时先把受限元数据写入独立目录（id/ledger/kind/schema/hash/ref/时间；不含路径外
    内容、密钥）；
  - 启动时扫描 `backups/*.bkdb`，对无目录条目且 manifest 可读的档案补登记（hash 复算）；
  - 把目录条目合并进当前 generation 的 `backup_record`（`INSERT OR IGNORE`，ledger_id 取当前
    账本以满足外键）；**只写维护元数据，不复制交易/审计**；
  - 恢复切换时先重建目录再合并进新 generation，因此恢复后 B1/B2/pre_restore 仍在列表；
  - `catalog.json` 丢失时可由档案清单重建；文件缺失保留条目但 artifact=null（UI“不可恢复”），
    预览返回 BACKUP_INVALID；坏 hash 预览返回 HASH_MISMATCH；
  - 档案路径由 backupId 推导并校验 `backups/<uuid>.bkdb`，不接受任意路径。
- 启动时把当前 DB 已有 `backup_record` 反向补登记到目录，兼容 S05 旧数据。
- 渲染层数据管理页：文件缺失显示“文件缺失/不可恢复”，禁用恢复按钮。

回归：

| 用例 | 断言 |
|---|---|
| 恢复后目录 | B1/B2 创建 → 恢复 B1 → 列表含 B1、B2、pre_restore；再次预览/恢复 B2 成功，数据为 B2 快照 |
| 重启与损坏 | 重启后三者仍可见；手动翻转 B2 字节 → 预览 `HASH_MISMATCH`，当前交易数不变；B1/pre_restore 仍可预览 |
| 外部 ledgerId | 从另一账本复制档案到 backups → 重启可发现 → 恢复后 ledgerId 替换为该账本，交易只有其 1 笔，原账本交易不在结果中（只替换不合并） |
| 缺失文件 | 删除档案后重启：条目仍在、artifact=null、预览 `BACKUP_INVALID`，当前数据不变 |
| 目录重建 | 删除 `catalog.json` 后重启：从档案清单重建目录，B1/B2 可发现 |

## 4. 命令与结果（实际执行）

| 命令 | 退出码 | 结果 | 证据 |
|---|---|---|---|
| 修复前回归 | 1（预期） | `rework-regression` 6/6 失败（旧实现） | `logs/regression-before-fix.log` |
| `npm run typecheck` | 0 | 三套 tsconfig | `logs/typecheck.log` |
| `npm test` | 0 | 18 文件 / **143 例** | `logs/test.log` |
| `npm run build` | 0 | dist main/preload/renderer；42/42 图标、12 许可 | `logs/build.log` |
| `npm run smoke:electron` | 0 | 首次 28/28、重启 28/28，重启幂等 PASSED | `logs/smoke-electron.log`、`selftest-dev*.json` |
| 定向回归（JSON） | 0 | 8/8 通过 | `regression-after-fix.json`、`logs/regression-after-fix.log` |
| `node scripts/db-report.mjs` | 0 | schema 1、1 账本、34 分类、0 交易、quick_check ok、0 外键违规 | `db-report.json`、`schema-v1.sql`、`logs/db-report.log` |

修复前失败摘要：`rework-regression` 6 个用例全部失败；其中“旧恢复令牌失效”用例实际执行到
恢复成功（未抛出 `TOKEN_EXPIRED`），印证 ISSUES 的 P1 推导路径。
修复后同一序列全部通过；新增的缺失文件/目录重建两例在修复后加入并通过。

## 5. 契约与规格对照

| 规格 | 实现 |
|---|---|
| CONTRACTS §10.1 当前水位/历史提交分离 | `committedRevision` + store 持久读取；回放不写缓存 |
| §10.1 恢复令牌依当前持久事实源 | `currentBackupFacts` 在 preview/commit 读 AppMeta+Ledger |
| §10.1 旧 epoch 请求 STALE_EPOCH | 既有 registry 逻辑未放宽；恢复后新 epoch 写入 store |
| §10.2 backup.list 正式登记 | 保留只读通道，DB 目录 + 独立 catalog 重建 |
| §10.2 恢复后档案可发现/校验/选择 | B1/B2/pre_restore 列表、预览、再次恢复、重启、损坏拒绝测试 |
| §10.2 不得合并交易保目录 | 只 INSERT backup_record 维护元数据；外部 ledger 测试断言只替换 |
| §10.2 坏档案不伪造成功 | artifact=null / preview HASH_MISMATCH / BACKUP_INVALID；无假 completed |
| §10.3 默认筛选/分页、sortOrder | 沿用已实现默认值；sortOrder 规则未变（350 起 +10，超限 FIELD_INVALID） |
| §10.3 operation/counter 安全 details | 加入白名单；仍只允许字符串/数字/布尔/字符串数组 |
| §10.3 单账本/候选/密钥/S15 边界 | 未扩大接口；S09/S11/S15 事项保持明确 |

## 6. 未执行 / 限制

- 未动态重放真实 IPC 序列：会向真实用户账本写入交易；当前用 store 同一 `currentRevision`
  accessor 与真实 SQLite 文件测试覆盖，Electron 自检仍只做只读/幂等初始化检查。
- 未执行真实桌面鼠标键盘恢复流程、IME/缩放/读屏、Win11/干净机/双系统。
- 未重建 S05 软件 ZIP；`release/` 仍是 S04 骨架历史包。
- 恢复故障注入（断电/杀进程/空间不足）、S15 外部选择 token/分页/恢复状态核实、档案限额/
  孤儿清理、正式逐文件 manifest：仍归 S15，本步不宣称 AC16 完成。
- 旧 `evidence/S05/OUTPUTS.sha256` 绑定修复前代码，现不再匹配当前源码；按任务要求保留为
  历史证据，未改写；本轮输出见 `OUTPUTS.sha256`。
- 真实本机账本仍为 0 交易空默认账本；所有恢复/回绕测试在临时目录的真实 SQLite 文件执行。

## 7. 保密自查

- 未读取/复制 DSH 凭证或配置；未调用真实 API；未创建真实消费/图片数据。
- 新增代码/测试/日志/证据无密钥、完整请求头、图片 base64、真实个人数据；catalog 仅含
  UUID/hash/版本/时间。
- 对 `src/tests/scripts/evidence/S05-R1/README/package.json` 扫描 `sk-…`、`Bearer …`、
  私钥头、`AKIA…`、api_key 赋值形式：0 命中（详见 REWORK-R1 交接）。
- 未向任何聊天或外部系统发送交接内容。
