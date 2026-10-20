# S05 自测与证据复核（DSH）

版本：S05-1.0｜日期：2026-10-20｜执行者：DSH｜状态：自测完成，待 Codex 独立验收
本记录只证明“执行了什么、得到什么”，不构成 G1～G6 或 AC 的通过结论。

## 1. 环境

| 项 | 实测值 |
|---|---|
| OS | Windows 10 22H2 19045 x64（`10.0.19045`） |
| Shell | PowerShell 7.6.7 Core，UTF-8 |
| Node / npm | v24.19.0（`C:\Program Files\nodejs\node.exe`）/ 11.17.0 |
| Electron | 44.9.1（Chromium 152 / Node 24.22 / ABI 149） |
| SQLite | 3.53.4（better-sqlite3 13.0.3，N-API） |
| 应用版本 | 0.1.0（`app.getVersion()`） |
| 仓库 | `main`；开始 `7aa1066`（工作区干净）；实现提交 `075c475` |

## 2. 输入核验

`evidence/S05/INPUTS.sha256` 记录 25 项读取输入的实际 SHA256（UTF-8、无 BOM、`HASH  path`）。
逐项 `Test-Path` 无缺失。与 S04 证据交叉核对：

| 来源 | 重叠 | 一致 | 结论 |
|---|---|---|---|
| `evidence/S04/OUTPUTS.sha256` | 12 | 12 | S04 交接/任务/证据/锁文件/tsconfig 未被本步改写 |
| `evidence/S04/INPUTS.sha256` | 11 | 11 | 根规范与 docs 规范未被本步改写 |

`docs/FIXTURES.md`、`evidence/S04/zip-sha256.txt` 等未出现在 S04 哈希清单的输入按实际文件记录；
未发现 S04 实物与声明不一致。S04 的 28 项自检/ZIP 冒烟是骨架证据，不当作 S05 业务验收。

## 3. 命令与结果

| 命令 | 退出码 | 结果 | 证据 |
|---|---|---|---|
| `npm run typecheck` | 0 | 三套 tsconfig 通过 | `logs/typecheck.log` |
| `npm test` | 0 | 17 文件 / **135 例**通过 | `logs/test.log` |
| `npm run build` | 0 | dist main/preload/renderer | `logs/build.log` |
| `npm run smoke:electron` | 0 | 首次 28/28；重启 28/28；重启幂等 PASSED | `logs/smoke-electron.log`、`selftest-dev.json`、`selftest-dev-restart.json` |
| `--capture-ui` | 0 | 8 张 PNG | `screens/`、`logs/capture-ui.log` |
| `node scripts/db-report.mjs` | 0 | 只读诊断 JSON + schema DDL | `db-report.json`、`schema-v1.sql`、`logs/db-report.log` |

smoke 的两次启动是不同 Electron 进程，比较 `db.defaultLedgerSeed` 的 ledgerId、dataEpoch、
categoryCount、ledgerCount、generationId，全部一致；同时验证：
`storage.localAppDataRoot` 不在程序目录（`db.schemaAndLocation` 的 `outsideProgramDirectory=true`）、
数据库路径为 `data/generations/<uuid>/ledger.db`、34 个系统分类、18 个 IPC 通道、
`ledger.ensureDefault`/`category.list`/`transaction.list`/`backup.list` 真实返回。

## 4. 运行期数据实证（本机首次初始化空账本）

来自 `db-report.json` 与 selftest JSON（不含密钥/个人交易）：

| 项 | 值 |
|---|---|
| dbSchemaVersion / contractVersion | 1 / `bookkeep.v1` |
| migrationState | `clean` |
| 账本数 / 分类数 / 交易数 | 1 / 34 / 0 |
| ledgerId | `9e54da9c-1ad0-4f29-ba42-43f95b017db3` |
| dataEpoch（两次重启不变） | `f7ad5202-8c05-4cf8-bb1b-4fe5bdd3d29e` |
| generationId | `de2075da-6338-47c6-a3a3-f685ff1cea53` |
| quick_check / 外键违规 | `ok` / 0 |
| 迁移记录 | 1 条 completed（0→1） |
| 备份记录 | 0（未在真实目录创建用户备份） |

数据库表由 `schema-v1.sql` 记录；18 个通道与 bridge 命名空间由 selftest 断言。

## 5. 数据约束与文档一致性核对

| 文档口径 | 实现核对 | 证据 |
|---|---|---|
| 默认一账本、33+其他、重启不重复 | 单一 `default_key`；首次同事务建 34 类；重启不写 | `ledger-init` 5 例；smoke 重启 |
| 金额 0.01～9,999,999.99、整数分、拒绝非法 | `amount.ts` + schema CHECK + 服务 | `amount-date`、`transaction` |
| 日期 1900-01-01～9998-12-31、end 哨兵 | 日期解析 + schema GLOB/CHECK + 范围校验 | `amount-date`；列表端到端 |
| 精度 date/minute 互约束 | schema CHECK + 服务 | `transaction` 日期用例 |
| 分类稳定 ID/systemKey/图标/排序/500/重名/其他保护 | 种子表、唯一索引、服务校验 | `category` 6 例、`categories.test` |
| 停用不改历史金额/关联；恢复软删可保留停用类 | FK RESTRICT；update 未改类不检查 enabled | `category`/`transaction` 停用用例 |
| source manual/ai、候选唯一（含软删） | schema CHECK + 条件唯一索引 + 内部 AI 入口 | `transaction` 幂等/候选用例 |
| version CAS、软删/恢复、审计 | schema version + 服务 + 触发器 | `transaction` 冲突/审计/重启 |
| 查询排序/筛选/分页/日期组/汇总字符串 | §6 全序 SQL + 签名游标 | `transaction` 列表 5 例 |
| 数据在 LOCALAPPDATA、程序目录不写 | generation/active 布局；自检断言 | `db.schemaAndLocation` |
| 迁移前备份、失败不覆盖、损坏/不兼容拒绝 | 备份/迁移编排与测试 | `migration` 6 例、`backup` 8 例 |
| 恢复新 dataEpoch、旧 generation 保留 | 切换/日志 | `backup` 恢复用例 |

未执行/仅结构核对：年度/周期统计计算（S07）、CSV（S06/S15）、附件/候选（S10/S11）。

## 6. 迁移与备份故障矩阵（实测）

| 场景 | 实际结果 |
|---|---|
| 全新库初始化 | schema 1、34 类、clean；失败会清理仅本次创建的 generation |
| 重复启动/重复 ensureDefault | 不重复账本/分类/迁移记录；用户改名停用保留 |
| 升级前 | 自动 `pre_migration` 备份（记录+档案）后才执行迁移 |
| 迁移 SQL 失败 | 事务回滚；旧 schema/数据可读；写 failed 记录；`recovery_required`；写操作 `RECOVERY_REQUIRED` |
| 迁移中崩溃（state=migrating） | 下次启动复位 clean 并继续迁移，数据保留 |
| 迁移前备份失败 | 不执行迁移；旧库不变；标 `recovery_required`/`BACKUP_FAILED` |
| checksum 被篡改 | 启动 `INTEGRITY_ERROR`，不静默继续 |
| DB schema 比应用新 | `SCHEMA_TOO_NEW`，不覆盖 |
| active 指针损坏/缺失 | `RECOVERY_REQUIRED`，不创建新空库 |
| 备份档案被篡改/截断 | 预览 `HASH_MISMATCH`；当前数据不变 |
| 记录 hash 与损坏档案一致（非 SQLite） | `BACKUP_INVALID`；当前数据不变 |
| 归档 schema 过新 | `SCHEMA_TOO_NEW`；当前数据不变 |
| 预览后数据变化再 commit | `TOKEN_EXPIRED`（上下文过期）；当前数据不变 |
| 恢复成功 | 回滚到备份数据、新 dataEpoch、pre_restore 备份、旧 generation 保留、重启后状态保持 |
| 迁移失败后恢复 pre_migration 备份 | staging 迁移到 v2、切换成功、恢复 clean（集成测试） |

## 7. 契约缺口与实现决策

见 `tasks/S05.md` §9（N01～N09）。摘要：新增只读 `backup.list`；restore 以 known `backupId`
+ 签名 token 代替文件对话框 selectionToken；备份档案 S05 仅含 DB；candidate 表 S11 建立；
幂等收据存内部 revision 列；transaction.list 允许契约默认值；UI 重试尚未复用 mutationId；
恢复故障注入/孤儿清理/上限留 S15。**未修改 docs 契约，也未静默改变语义**；请 Codex 逐条决定
是否补契约/登记决策，或要求 DSH 按新口径返工。

## 8. 保密自查

- 未读取/复制 DSH 凭证或配置；未调用真实 API；无 `.env`、证书、私钥、密钥文件。
- 代码/测试/日志/截图/本文与 `evidence/S05/*` 无真实 key、完整请求头、图片 base64、真实个人
  消费数据；本机账本为首次初始化的空默认账本（0 交易）。
- 对 `src`、`tests`、`scripts`、`evidence/S05`、`tasks`、`handoff`、`README.md`、`package.json`
  扫描 `sk-…`、`Bearer …`、私钥头、`AKIA…`、`api_key=`：0 命中。唯一字面匹配是
  `handoff/S04/HANDOFF.md` 中对扫描模式自身的描述（非凭证）。
- 未向任何聊天或外部系统发送交接内容；由开发者手动转交。

## 9. 复现步骤

```powershell
cd "D:\BookKeep with AI"
npm run typecheck
npm test
npm run build
npm run smoke:electron
node scripts/db-report.mjs --json=evidence\S05\db-report.json --schema=evidence\S05\schema-v1.sql
```

截图：先 `npm run build`，再以 Electron 启动 `--capture-ui=evidence\S05\screens`（见
`logs/capture-ui.log`）。以上命令会在真实 `%LOCALAPPDATA%\BookKeepAI` 初始化/读取默认账本；
测试使用系统临时目录，不污染真实账本。
