# S05-R1 返工交接

版本：S05-R1｜日期：2026-10-20｜交出者：DSH｜接收者/唯一负责人：Codex（独立复验 S05-R1）
状态：**待复验（DSH 自测完成，非通过）**

本文件是返工交接，不替换 `handoff/S05/HANDOFF.md`、`handoff/S05/ACCEPTANCE.md`、
`tasks/S05.md` 或 `evidence/S05/*`；旧交接/旧哈希保持原样作为历史时点证据。

## 1. 目标与结论

按 `tasks/S05-REWORK.md` 修复两项独立审查问题：

- **BK-S05-001（P1）**：原提交 revision 与当前账本水位分离；回放旧收据不得回退当前 revision；
  恢复令牌 preview/commit 均依赖持久 `AppMeta.dataEpoch + Ledger.dataRevision`，旧预览在
  任何业务变更后（即使随后回放旧请求）返回 `TOKEN_EXPIRED/RESTORE_CONTEXT_STALE`。
- **BK-S05-002（P2）**：恢复旧快照后，已保留的备份档案（所选 B1、较新 B2、pre_restore）
  仍可发现/校验/再次恢复；重启、`catalog.json` 丢失、文件缺失、坏 hash 均有真实 SQLite
  证据；只重建备份维护元数据，绝不通过合并交易/审计来保留目录。

实际结论：两项问题已修复，定向回归 8/8、全量 **18 文件 / 143 例**通过，typecheck/build 通过，
Electron 首启/重启各 28/28 且重启幂等。**这是 DSH 自测，不是 Codex 复验通过，也不是任何
AC/G 门通过**；S06 未开始。

## 2. 基线与工作区

- 分支 `main`。
- 提交：
  1. `5924d24` docs(S04/S05)：Codex 独立验收、规格补充与返工任务书（DSH 原样入库，未改内容）
  2. `a330096` fix(S05-R1)：9 文件，+859/−35（修复、catalog、回归测试、README、错误白名单）
  3. 本交接与 `evidence/S05-R1/` 的文档提交（见
     `git log -1 --format=%H -- handoff/S05/REWORK-R1.md`）
- 返工输入基线：`5924d24`；旧实现 `075c475` / 旧交接 `e20badf`；未改写旧 HANDOFF/旧哈希。
- 交出时工作区应干净；无运行中的 Electron/Vite/electron-builder/后台任务。

## 3. 已读取输入

- `AGENTS.md`、`执行看板.md`、`tasks/S05-REWORK.md`、`tasks/S05.md`、`handoff/S05/HANDOFF.md`、
  `handoff/S05/ACCEPTANCE.md`。
- `evidence/RECEIPT-S04-S05/RECEIPT.md`、`ISSUES.md`（BK-S05-001/002 精确路径）。
- `docs/CONTRACTS.md` §10（S02-1.1）、`docs/ARCHITECTURE.md` §11、`docs/DECISIONS.md`
  D36～D40、`docs/ICON-MAP.md` §4、`docs/ACCEPTANCE.md`、`docs/UX.md` 相关页。
- 实际哈希见 `evidence/S05-R1/INPUTS.sha256`（13 项）。旧 S05 任务/交接/证据只读参考。

## 4. 实际产物

由 `a330096` 与本文档提交携带；完整清单/哈希见 `evidence/S05-R1/OUTPUTS.sha256`。

| 路径 | 变更 |
|---|---|
| `src/main/services/ledger-service.ts` | 回放返回 `committedRevision`；当前水位不再由收据写回；旧收据兼容 |
| `src/main/services/ledger-store.ts` | `currentRevision`/snapshot/trackMutation 读持久 revision；catalog 启动补偿、恢复重建、切换合并 |
| `src/main/services/backup-service.ts` | token 使用持久 facts；创建先登记 catalog；缺失档案 artifact=null |
| `src/main/storage/backup-catalog.ts` | 新增独立目录（读写/校验/补偿/合并；不复制交易/审计） |
| `src/shared/entities.ts` | Category/Transaction 变更结果增加 `committedRevision`（CONTRACTS §10.1） |
| `src/shared/errors.ts` | 安全 details 允许受限 `operation`/`counter`（§10.3） |
| `src/renderer/pages/DataPage.tsx` | 缺失档案显示“不可恢复”，禁用恢复按钮 |
| `tests/unit/db/rework-regression.test.ts` | 新增 8 例交错/恢复/重启/损坏/外部 ledger 回归 |
| `README.md` | 143 例、catalog 说明、S05-R1 状态 |
| `evidence/S05-R1/*`、本交接 | 修复前后日志、回归 JSON、selftest、schema、REVIEW-R1、问题单响应 |

## 5. 验证（环境、命令、退出码、证据）

环境：Windows 10 22H2 19045 x64；pwsh 7.6.7 Core / UTF-8；Node v24.19.0；npm 11.17.0；
Electron 44.9.1；better-sqlite3 13.0.3 / SQLite 3.53.4；应用 0.1.0。

| 验证 | 命令 | 退出码 | 结果 | 证据 |
|---|---|---|---|---|
| 修复前回归 | `npx vitest run tests/unit/db/rework-regression.test.ts` | 1（预期） | 旧实现 6/6 失败；旧令牌用例实际恢复成功 | `logs/regression-before-fix.log` |
| 类型检查 | `npm run typecheck` | 0 | 三套 tsconfig | `logs/typecheck.log` |
| 全量测试 | `npm test` | 0 | 18 文件 / 143 例 | `logs/test.log` |
| 定向回归 | `npx vitest run … --reporter=json` | 0 | 8/8 | `regression-after-fix.json`、`logs/regression-after-fix.log` |
| 构建 | `npm run build` | 0 | dist/{main,preload,renderer} | `logs/build.log` |
| 重启自检 | `npm run smoke:electron` | 0 | 两次 28/28，重启幂等 PASSED | `logs/smoke-electron.log`、`selftest-dev*.json` |
| DB 诊断 | `node scripts/db-report.mjs` | 0 | schema1/1账本/34类/0交易/quick_check ok/0 外键违规 | `db-report.json`、`schema-v1.sql` |

修复前失败摘要：6 个回归用例全部失败；“旧恢复令牌失效”用例在旧实现上未抛
`TOKEN_EXPIRED`（恢复成功），与 ISSUES 的静态推导一致。修复后 8/8 通过；新增的
“缺失文件/目录重建”两例在修复后加入。

## 6. 需求覆盖

| AC | 返工相关 | 状态 |
|---|---|---|
| AC04 修改删除恢复/搜索 | 回放不改当前水位；列表快照 revision 不倒退 | 部分证据；S06 页面/人工流程未执行 |
| AC11 幂等/并发 | 收据回放、版本/审计/金额不重复、唯一候选基础 | 部分；批准原子事务仍 S11 |
| AC16 CSV/备份恢复 | 恢复后目录保留、再次恢复、重启、损坏拒绝 | 部分；S06 CSV、S15 外部 token/分页/故障注入未完成 |
| AC15/20/22 等 | 未新增外发/文件权限；未打包 | 不因本步升级 |

未把 AC16 标为通过，也未宣称 G1～G6、S06 或正式包完成。

## 7. 设计说明与阶段边界

- **数据库版本仍为 1（dbSchemaVersion=1）**：本返工不新增迁移；`backups/catalog.json` 是
  generation 之外的维护目录，旧 S05 库直接兼容，启动时自动补登记，无需升级 schema。
- **独立目录**：`backups/catalog.json`（`bk-backup-catalog.v1`）存储 id/ledger/kind/schema/
  appVersion/hash/ref/时间；不含密钥、日志、图片或账本内容。档案路径始终由 UUID 推导为
  `backups/<uuid>.bkdb`，不接受任意路径。
- **创建顺序**：快照 → catalog 登记 → DB `backup_record` 登记；任一步失败回滚文件/目录，
  不伪造成功。
- **启动补偿**：扫描 `backups/*.bkdb`，用内嵌 manifest + 实算 hash 补登记无目录条目；
  把当前 DB 已有记录反向补登记，兼容旧 S05 数据。
- **恢复切换**：先读目录 → 打开新 generation → 仅合并 `backup_record` 维护元数据（当前
  ledgerId 满足外键）→ 写恢复审计/收据 → 切换内存状态。**不复制交易、候选或旧审计行**。
- **外部 ledgerId**：允许发现/预览/恢复另一账本的合法档案；恢复是整账本替换，测试断言原
  账本交易不在结果中，未合并。
- **缺失/损坏**：文件缺失 → 列表 artifact=null、UI“不可恢复”、预览 `BACKUP_INVALID`；
  文件存在但 hash 不符 → 预览 `HASH_MISMATCH`；均不改当前数据。
- **S15 仍负责**：外部文件选择/保存 token、`backup.list` 分页、恢复操作状态核实、维护锁、
  故障注入、附件/候选完整备份、正式逐文件 manifest、限额与孤儿清理。DB-only 档案和内部
  backupId 仍只是 S05 阶段适配，不冒充最终 AC16。

## 8. 已知问题 / 限制 / 未执行

- 未动态重放真实 Electron IPC 交错序列：会向真实用户账本写交易；当前由 store 的
  `currentRevision` accessor（registry 信封同一来源）与真实 SQLite 文件测试覆盖。Codex 如需
  端到端 IPC 证据，需明确允许使用隔离 `LOCALAPPDATA` 的桌面脚本。
- 未执行真实桌面点击恢复/分类维护、IME/缩放/读屏、Win11/干净机/双系统、断电/杀进程。
- 未重建 S05 ZIP；`release/` 仍为 S04 骨架历史包，S04 哈希不变。
- 旧 `evidence/S05/OUTPUTS.sha256` 仍绑定修复前代码，按任务保留、不重写；本轮输出单独见
  `evidence/S05-R1/OUTPUTS.sha256`。
- 本机真实账本仍为空默认账本（0 交易）；所有恢复/回绕在临时目录的真实 SQLite 文件执行。
- 备份列表在 S05 仍全量返回（阶段例外）；S15 分页前不得以此宣称完整目录性能/限额达标。
- UI 重试复用 mutationId 仍按 CONTRACTS §10.3 由 S06 记账表单落实；本步未改 S06。

## 9. 接收动作（Codex）

1. 先读 `tasks/S05-REWORK.md`、`evidence/RECEIPT-S04-S05/ISSUES.md`、本文件、
   `evidence/S05-R1/REVIEW-R1.md` 与 `ISSUES-RESPONSE.md`；核对 `git log` 含 `5924d24`、
   `a330096` 与本文档提交。
2. 按 `evidence/S05-R1/INPUTS.sha256`、`OUTPUTS.sha256` 复核实物；`git status` 应干净。
3. 复跑：`npm run typecheck` → `npm test`（143）→ `npx vitest run tests/unit/db/rework-regression.test.ts`
   （8）→ `npm run build` → `npm run smoke:electron` → `node scripts/db-report.mjs`；
   对照 `logs/regression-before-fix.log` 与 `regression-after-fix.json`。
4. 独立验证两项缺陷序列（建议隔离数据目录）：回放交错 + 过期恢复令牌；恢复 B1 后 B1/B2/P
   可发现、再次恢复、重启、损坏拒绝、外部 ledgerId 不混账。
5. 若通过：更新 `执行看板.md`（S05-R1 通过、S06 可开始），把任务交回 DSH 执行 S06。
   若不通过：按问题单格式（编号/严重度/复现/证据）交 DSH 修复后回本步复验。
6. 不把本步自测当 AC16/G 门通过；S15 阶段项保持明确。

## 10. 保密自查

- 未读取/复制 DSH 凭证或配置；未调用真实 API；未创建真实消费/图片/密钥数据。
- 新增代码/测试/日志/证据无 key、完整请求头、图片 base64、真实个人消费数据；catalog 仅含
  UUID/hash/版本/时间。
- 对 `src`、`tests`、`scripts`、`evidence/S05-R1`、`README.md`、`package.json` 扫描
  `sk-…`、`Bearer …`、私钥头、`AKIA…`、api_key 赋值形式：0 命中。
- 未向任何聊天或外部系统发送交接内容；由开发者手动转交。
