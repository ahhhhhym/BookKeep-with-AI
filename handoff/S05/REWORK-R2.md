# S05-R2 返工交接

版本：S05-R2｜日期：2026-10-20｜交出者：DSH｜接收者/唯一负责人：Codex（独立复验 S05-R2）
状态：**待复验（DSH 自测完成，非通过）**

本文件是 R2 返工交接，不替换 `handoff/S05/HANDOFF.md`、`REWORK-R1.md`、`ACCEPTANCE*.md`、
`tasks/S05*.md` 或既有 `evidence/S05*`；旧文件/旧哈希保持原样。

## 1. 目标与结论

按 `tasks/S05-REWORK-R2.md` 只修 **BK-S05-003（P1）**：目录重建必须保留已登记档案的原 hash，
不能把档案当前内容 hash 重新登记为已知原始基准；DB、目录、扫描结果冲突时明确拒绝/标错，
不由读取顺序静默选择。

实际结论：已修复。修复前组合序列 4/4 失败（核心序列在恢复 B1 后错误接受被改 B2），修复后
5/5 定向回归通过；全量 **19 文件 / 148 例**通过，typecheck/build 通过，Electron 首启/重启
各 28/28 且重启幂等。原 BK-S05-001/002 回归保持通过。**这是 DSH 自测，不是 Codex 复验，
也不是 AC/G 门通过**；S06 未开始。

## 2. 基线与工作区

- 分支 `main`。
- 提交：
  1. `4896172` docs(S05-R1)：Codex R1 复验/BK-S05-003 问题单/R2 任务书及规格补充
     （DSH 原样入库，未改内容）
  2. `29f0a51` fix(S05-R2)：7 文件，+570/−61（catalog 基准/冲突、切换顺序、回归测试、UI、README）
  3. 本交接与 `evidence/S05-R2/` 文档提交（见
     `git log -1 --format=%H -- handoff/S05/REWORK-R2.md`）
- 输入基线 `4896172`；修复代码基线 `a330096`（R1）；R1 交接 `7c17aa1`。
- 未改写原 S05/R1 HANDOFF、`tasks/S05*.md`、`evidence/S05/`、`evidence/S05-R1/` 与其哈希。
- 交出时工作区应干净；无运行中的项目 Electron/Node/Vite/后台任务。

## 3. 已读取输入

- `AGENTS.md`、`执行看板.md`、`tasks/S05-REWORK-R2.md`、`handoff/S05/REWORK-R1.md`、
  `handoff/S05/ACCEPTANCE-R1.md`。
- `evidence/RECEIPT-S05-R1/RECEIPT.md`、`ISSUES.md`（BK-S05-003 精确路径）。
- `docs/CONTRACTS.md` §10.2（S02-1.2 hash 保留补充）、`docs/ARCHITECTURE.md` §11、
  `docs/DECISIONS.md` D41。
- 实际哈希见 `evidence/S05-R2/INPUTS.sha256`（13 项）。旧 S05/R1 交接只读参考。

## 4. 实际产物

完整清单/哈希见 `evidence/S05-R2/OUTPUTS.sha256`。

| 路径 | 变更 |
|---|---|
| `src/main/storage/backup-catalog.ts` | 条目增加 `origin`/`integrity`/`conflictCode`/`conflictingHash`；DB 创建记录先导入、扫描只补未知；冲突标错；failed 行不降级 |
| `src/main/services/ledger-store.ts` | 启动与恢复切换固定“先导入 DB 记录、后扫描”；切换前保留当前账本记录，运行中删目录也不丢原 hash |
| `src/main/services/backup-service.ts` | 创建登记新字段；列表对 conflict 置 artifact=null；preview/commit 遇到目录冲突或目录/DB hash 不一致返回 BACKUP_INVALID |
| `src/renderer/pages/DataPage.tsx` | 明确显示“校验失败/不可恢复/校验冲突”，禁用恢复 |
| `tests/unit/db/rework2-regression.test.ts` | 新增 5 例真实 SQLite 组合回归 |
| `tests/unit/db/backup.test.ts` | schema-too-new 用例同步伪造目录，使一致性成立后测到 schema 分支 |
| `README.md` | 148 例、hash 基准说明、R2 交接入口 |
| `evidence/S05-R2/*`、本交接 | 修复前失败、修复后 5/5、全量日志、selftest、schema、REVIEW/问题响应 |

## 5. 修复要点

1. **固定顺序**：`open` 与 `switchToStagedGeneration` 均先 `upsertBackupCatalogEntries(DB 记录)`
   再 `reconcileBackupCatalog(未知档案)`，最后合并进 DB。扫描永远不能抢在可信创建记录之前。
2. **来源区分**：`origin=created`（创建/DB 导入）与 `origin=discovered`（无创建记录档案的
   当前 hash）。只有 discovered 且双方 hash 不同时，DB 创建记录可替换；双方均 created 且
   hash 不同时标 `conflict`，保留双方 hash（`conflictingHash` 记录 DB 侧），不自动选边。
3. **扫描不改写**：已知 id 一律跳过；坏 hash 在预览阶段与 DB/目录基准比较并拒绝。
4. **冲突可见**：catalog conflict → `backup.list` artifact=null；`preview` 先于行状态检查返回
   `BACKUP_INVALID`（`CATALOG_DB_HASH_MISMATCH` 或目录冲突码）；`commit` 同样拒绝；新
   generation 合并为 `failed + error_code` 维护行。
5. **切换前记录**：恢复开始前读取当前账本 `backup_record`；即使运行中删除 `catalog.json`，
   B2 原 H 也会进入重建目录，扫描不会写入改动后的 H2。
6. **不降级**：`catalogEntryFromRow` 对 failed/conflict 行保留冲突语义，目录丢失后不会把
   曾被拒绝的档案重新变成可信基准。
7. **范围**：不复制交易/旧审计/多账本；不新增 IPC；dbSchemaVersion 仍为 1，无迁移。

## 6. 验证（环境、命令、退出码、证据）

环境：Windows 10 22H2 19045 x64；pwsh 7.6.7 Core / UTF-8；Node v24.19.0；npm 11.17.0；
Electron 44.9.1；better-sqlite3 13.0.3 / SQLite 3.53.4；应用 0.1.0。

| 验证 | 命令 | 退出码 | 结果 | 证据 |
|---|---|---|---|---|
| 修复前回归 | `npx vitest run tests/unit/db/rework2-regression.test.ts` | 1（预期） | 4/4 失败；核心序列恢复 B1 后错误接受 B2 | `logs/regression-before-fix.log` |
| 类型检查 | `npm run typecheck` | 0 | 三套 tsconfig | `logs/typecheck.log` |
| 全量测试 | `npm test` | 0 | 19 文件 / 148 例 | `logs/test.log` |
| 定向回归 | `npx vitest run … --reporter=json` | 0 | 5/5 | `regression-after-fix.json`、`logs/regression-after-fix.log` |
| 构建 | `npm run build` | 0 | dist/{main,preload,renderer} | `logs/build.log` |
| 重启自检 | `npm run smoke:electron` | 0 | 两次 28/28，重启幂等 PASSED | `logs/smoke-electron.log`、`selftest-dev*.json` |
| DB 诊断 | `node scripts/db-report.mjs` | 0 | schema1/1 账本/34 类/0 交易/quick_check ok/0 外键违规 | `db-report.json`、`schema-v1.sql` |

修复前日志显示：目录丢失重建后 B2 目录 hash 为改动后的 H2；恢复 B1 后预览 B2 未抛
`HASH_MISMATCH`。与 ISSUES 静态推导一致。修复后同一组合序列与新增边界均拒绝。

## 7. 需求覆盖

| AC | 相关 | 状态 |
|---|---|---|
| AC16 CSV/备份恢复 | 恢复前后坏 hash 拒绝、目录保留、再次恢复、外部 ledger | **部分证据**；CSV/S15 外部 token/分页/状态核实/故障注入未完成 |
| AC04/11 | 保持原 R1 回归（revision/幂等/恢复） | 部分，未升级整项 |
| 其他 AC/G 门 | 未涉及 | 未执行/未通过 |

未把 BK-S05-003 修复写成 AC16 或 S05 整步通过。

## 8. 已知问题 / 限制 / 未执行

- 未动态执行完整 Electron IPC 写入交错（会写真实账本）；服务层真实 SQLite 文件 + 同一
  `currentRevision` accessor 覆盖；Codex 如要求端到端，需隔离数据目录的桌面脚本授权。
- 未执行人工桌面恢复/分类点击、IME/缩放/读屏、Win11/干净机/双系统、断电/杀进程。
- 未重建 S05 ZIP；`release/` 仍为 S04 骨架历史包。
- S15 外部选择/保存 token、`backup.list` 分页、恢复操作状态核实、维护锁、故障注入、限额、
  正式逐文件 manifest、孤儿清理仍未完成；catalog 全量列表仍是阶段适配。
- 本机真实账本保持 0 交易；故障序列只在临时目录真实 SQLite 文件执行。
- 旧 `evidence/S05/OUTPUTS.sha256` 与 `evidence/S05-R1/OUTPUTS.sha256` 绑定各自历史代码，
  不匹配当前源码是预期；按任务未改写，历史时点以各自证据为准。
- 修复前日志为 4 例（第 5 例“运行中删目录”在修复后补充）；第 1～4 例已覆盖任务书指定
  组合序列与有效/丢失/损坏目录。

## 9. 接收动作（Codex）

1. 先读 `tasks/S05-REWORK-R2.md`、`evidence/RECEIPT-S05-R1/ISSUES.md`、本文件、
   `evidence/S05-R2/REVIEW-R2.md` 与 `ISSUES-RESPONSE.md`；核对 `git log` 含 `4896172`、
   `29f0a51` 与本文档提交。
2. 按 `INPUTS.sha256`/`OUTPUTS.sha256` 复核实物；`git status` 应干净。
3. 复跑：typecheck → `npm test`（148）→ `npx vitest run tests/unit/db/rework2-regression.test.ts`
   （5）→ build → smoke → db-report；对照 before/after 日志。
4. 独立执行建议的隔离序列：B1→B2→合法 SQLite 改 B2 金额→删 catalog→重启→恢复 B1→
   再预览 B2；并检查目录 hash 仍为原 H、恢复前后均拒绝、当前数据未被覆盖；另测目录/DB
   hash 冲突、目录 JSON 损坏、运行中删目录、正常 B1/B2/P 再次恢复。
5. 若通过：更新 `执行看板.md`（S05-R2 通过、S06 可开始），交回 DSH 执行 S06。若不通过：
   按问题单格式交 DSH 修复后回本步复验。
6. 不把本步自测当 G 门/AC16 通过；S15 项目保持明确。

## 10. 保密自查

- 未读取/复制 DSH 凭证或配置；未调用真实 API；未创建真实消费/图片/密钥数据。
- 新增代码/测试/日志/证据无 key、完整请求头、图片 base64、真实个人消费数据；catalog 仅含
  UUID/hash/版本/时间。
- 对 `src`、`tests`、`scripts`、`evidence/S05-R2`、`README.md`、`package.json` 扫描
  `sk-…`、`Bearer …`、私钥头、`AKIA…`、api_key 赋值形式：0 命中。
- 未向任何聊天或外部系统发送交接内容；由开发者手动转交。
