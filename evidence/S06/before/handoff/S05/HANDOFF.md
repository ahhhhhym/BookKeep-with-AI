# S05 数据与账本交接

版本：S05-1.0｜日期：2026-10-20｜交出者：DSH｜接收者/下一唯一负责人：Codex（独立验收 S05，
通过后转 S06 由 DSH 实现）｜状态：**待验收（DSH 自测完成，非通过）**

## 1. 目标与结论

按用户任务完成 S05：SQLite schema v1 与单调迁移、受限主进程仓储、类型化 IPC；默认账本幂等
初始化；33 参考分类 + “其他”共 34 类；自定义分类、改名/换图标/排序/停用与引用安全；正式交易
整数分、日期精度、来源、唯一候选关联、version、软删除与追加型审计；数据位于
`%LOCALAPPDATA%\BookKeepAI` 且不写程序目录；重启不重复默认数据/迁移记录；查询/修改事务边界与
一致快照备份/恢复基础（迁移前备份、损坏/不兼容档案拒绝、失败不覆盖）。

实际结论：数据库与仓储功能可用，真实 SQLite 文件集成测试 47 例、全量 135 例通过；真实 Electron
连续启动两次均为 28/28 且默认账本/dataEpoch 稳定。**这是 DSH 自测，不是业务验收**：G1～G6
全部未执行，AC01～AC22 软件用例仍未执行，分类页/数据管理页的鼠标键盘人工流程未执行。

## 2. 基线与工作区

- 仓库：`D:\BookKeep with AI`，分支 `main`。
- 提交（按时间顺序）：
  1. `2440947` docs: 基线文档入库（S01～S03 原样保留）
  2. `7ffbed3` feat(S04): 工程骨架
  3. `7aa1066` docs(S04): S04 任务书/交接/证据（本步开始基线）
  4. `075c475` feat(S05): SQLite 账本、分类、交易仓储与迁移/备份基础（52 文件，+9138/−187）
  5. 本步文档/证据提交：`tasks/S05.md`、`handoff/S05/HANDOFF.md`、`evidence/S05/`（见
     `git log -1 --format=%H -- handoff/S05/HANDOFF.md`）
- 代码基线 commit：`075c475`。本步**未重新打包 ZIP**（S18 负责），`release/` 中仍是 S04 冒烟包。
- 交出时工作区应为干净；无运行中的 Electron/Vite/electron-builder 进程；无后台任务。
- 未改写 `docs/`、`执行看板.md`、S01～S04 `tasks/handoff/evidence` 任何文件（§3 哈希核对）。

## 3. 已读取输入（实际哈希见 evidence/S05/INPUTS.sha256）

- 根规范：`AGENTS.md`、`执行看板.md`、`开发方案.md`、`交接与验收.md`。
- 交接：`handoff/S04/HANDOFF.md`、`tasks/S04.md`、`evidence/S04/REVIEW.md`。
- 规格：`docs/PRD.md`、`docs/ARCHITECTURE.md`、`docs/CONTRACTS.md`、`docs/UX.md`、
  `docs/ICON-MAP.md`、`docs/FIXTURES.md`、`docs/DECISIONS.md`、`docs/ACCEPTANCE.md`。
- 基线：`package-lock.json`、`tsconfig.*.json`、`vitest.config.ts`、S04 自检 JSON/ZIP 哈希。
- 交叉核对：与 S04 OUTPUTS 重叠 12/12 一致，与 S04 INPUTS 重叠 11/11 一致。
- 未查看五张参考图（S03 已固化语义）；未读取 DSH 凭证/配置。

## 4. 实际产物

除特别说明外均位于 `075c475`；文档与证据在本步文档提交。

| 路径 | 用途 |
|---|---|
| `src/main/db/migrations.ts` | schema v1 DDL、checksum、迁移运行器、migration_state 恢复 |
| `src/main/db/sqlite.ts` | 连接/WAL/外键/忙等待、事务、完整性检查、SQLite 错误翻译 |
| `src/main/db/{ledger,category,transaction,audit,receipt}-repo.ts` | 版本条件写入、软删、审计、幂等收据 |
| `src/main/db/transaction-query.ts` | 列表全序、筛选、分页、跨页日期组、汇总字符串 |
| `src/main/db/integrity.ts` | 单账本/34 系统分类/其他启用/金额/日期/来源/候选唯一/外键检查 |
| `src/main/services/ledger-service.ts` | 默认账本+34 类事务、分类/交易业务边界、幂等、审计、revision |
| `src/main/services/backup-service.ts` | 备份创建/列表/预览/commit、pre_restore、staging 切换回调 |
| `src/main/services/ledger-store.ts` | 启动/迁移/恢复生命周期、active generation、动态 epoch/revision |
| `src/main/storage/*` | 布局、active 指针、一致快照档案、恢复日志 |
| `src/main/services/{canonical,signed-token}.ts` | 规范化 hash、短期 HMAC 游标/恢复 token |
| `src/shared/{amount,date,text,entities}.ts` | 金额/日期/文本域、DTO 与输入类型 |
| `src/shared/ipc.ts`、`src/shared/api.ts`、`src/preload/index.ts` | 17 业务 + 1 诊断通道、桥接白名单 |
| `src/main/ipc/*`、`src/main/index.ts`、`src/main/selftest.ts` | 处理器、动态信封、启动失败/恢复模式、28 项自检 |
| `src/renderer/pages/{CategoriesPage,DataPage}.tsx`、`styles.css`、`messages.ts` | 分类维护与备份/恢复基础 UI、错误文案 |
| `tests/unit/db/*`、`tests/unit/ipc-spec.test.ts` | 真实文件集成测试 47 例 + IPC 规格 26 例 |
| `scripts/smoke-electron.mjs`、`scripts/db-report.mjs` | 两次启动比较；只读 DB 诊断 |
| `README.md`、`tasks/S05.md`、本 HANDOFF、`evidence/S05/*` | 说明、任务书、交接、证据 |

## 5. 数据库版本与数据约束

- **dbSchemaVersion = 1**；`AppMeta` 与 `PRAGMA user_version` 同写。当前迁移清单仅 v1
  （`initial-ledger-schema`），后续版本必须逐级追加，禁止静默降级。
- 表：`app_meta`、`ledger`、`category`、`"transaction"`、`audit_event`、`mutation_receipt`、
  `backup_record`、`migration_record`；全部 STRICT + CHECK；外键 RESTRICT；审计/收据/迁移
  记录由触发器禁 UPDATE/DELETE。
- 金额：整数分 1～999999999；日期 1900-01-01～9998-12-31（筛选 end 允许 9999-01-01）；
  `date` 无时刻 / `minute` 必须合法 HH:mm；文本 NFC+trim、码点长度、控制字符规则；
  分类名同账本规范化唯一（含停用）、`system_key` 唯一、500 上限、“其他”不可停用；
  交易 `source=manual|ai` 与 `sourceCandidateId` 互约束、候选关联唯一（含软删）、
  version 条件写入、软删/恢复、dataRevision 每事务一次。
- 幂等：`(ledgerId,operation,mutationId)` 唯一收据，同键同载荷回放原结果/原 revision，
  不同载荷 `IDEMPOTENCY_CONFLICT`；`sourceCandidateId` 唯一是批准路径第二道兜底（S11 使用）。
- 目录：`data/active.json`、`data/generations/<uuid>/ledger.db`、`data/restore-log.jsonl`、
  `backups/<backupId>.bkdb`；程序目录不写真实数据（自检断言）。

## 6. 验证（环境、命令、退出码、证据）

环境：Windows 10 22H2 19045 x64；pwsh 7.6.7 Core / UTF-8；Node v24.19.0；npm 11.17.0；
Electron 44.9.1；better-sqlite3 13.0.3 / SQLite 3.53.4；应用 0.1.0。完整记录见
`evidence/S05/REVIEW.md`。

| 验证 | 命令 | 退出码 | 结果 | 证据 |
|---|---|---|---|---|
| 前置基线 | `npm run typecheck` / `npm test`（开始前） | 0/0 | 77 例通过 | REVIEW §2 |
| 类型检查 | `npm run typecheck` | 0 | 三套 tsconfig | logs/typecheck.log |
| 单元+集成 | `npm test` | 0 | 17 文件 / 135 例 | logs/test.log |
| 构建 | `npm run build` | 0 | dist/{main,preload,renderer} | logs/build.log |
| 重启自检 | `npm run smoke:electron` | 0 | 首次 28/28、重启 28/28、幂等 PASSED | logs/smoke-electron.log、selftest-dev*.json |
| 页面截图 | `--capture-ui=evidence\S05\screens` | 0 | 8 张 | screens/*.png |
| DB 只读诊断 | `node scripts/db-report.mjs` | 0 | schema1/1账本/34类/0交易/quick_check ok/0外键违规 | db-report.json、schema-v1.sql |

## 7. 需求覆盖（AC 逐项；不代替 Codex 验收）

| AC | S05 相关落点 | 状态 |
|---|---|---|
| AC01 默认账本/分类/重启 | 默认账本+34 类幂等；真实两次启动比较；程序目录隔离自检 | **部分证据**；人工首启/重启桌面流程未执行（S08） |
| AC02 手工金额 | 金额域与服务/IPC 约束、0.01/上限/非法值自动化；无记账表单 | 部分（S06 表单、S08） |
| AC03 日期 | 日期/精度域与校验、上海相对日工具；列表非 S05 页面 | 部分（S06/S07） |
| AC04 修改删除恢复/搜索 | 交易 update/softDelete/restore、筛选/搜索/分页仓储与测试；列表页未实现 | 部分（S06/S08） |
| AC05～AC07 统计 | 未实现 | 未执行（S07） |
| AC08 真实图片 API | 未实现（provider stub） | 未执行（S09） |
| AC09 缺字段/多笔/合计 | 未实现 | 未执行（S10/S11） |
| AC10 审核隔离 | 无候选表/审核入口；交易表不存候选 | 未执行（S11） |
| AC11 幂等/并发 | 幂等收据、version CAS、唯一候选关联基础与测试；批准路径未实现 | 部分（S11/S16） |
| AC12 重复截图 | 未实现 | 未执行（S10/S11） |
| AC13 API 异常 | 未实现 | 未执行（S09/S15） |
| AC14 无效/危险图片 | 未实现 | 未执行（S10/S15） |
| AC15 密钥与 IPC | **部分证据**：新增业务通道的发送方/信封/载荷/epoch 校验，renderer 无 Node/ipcRenderer；密钥仍 NOT_IMPLEMENTED | 未执行（S09/S15/S19） |
| AC16 CSV/备份恢复 | 备份创建/列表/预览/恢复基础、损坏/不兼容拒绝、迁移前备份；CSV 未实现 | 部分（S06/S15） |
| AC17 数据集闭环 | 未实现 | 未执行（S12～S14） |
| AC18 框架真实性 | 未实现 | 未执行（S13） |
| AC19 错误训练声明 | 本步无训练/质量声明；UI/README 明确未训练/未验收 | 未执行（S14/S20） |
| AC20 软件 ZIP | 未重新打包；仅 dev 构建/自检 | 未执行（S18/S19） |
| AC21 UI 交互 | 分类页/数据页真实读取与基础操作；人工鼠标键盘/缩放/IME 未验 | 未执行（S17/S19） |
| AC22 发布可追踪 | commit/锁文件/证据可追溯；非正式包 | 未执行（S18/S19/S20） |

## 8. 迁移、回滚与恢复办法

- **迁移前**：升级已有库前自动创建 `kind='pre_migration'` 一致快照并登记 `backup_record`
  （含 hash/清单/schema）。备份失败时**不执行**迁移，标记 `recovery_required` 并拒绝业务写入。
- **迁移失败**：事务回滚，旧 schema/数据完整；写 `migration_record(status=failed, error_code)`
  并将 `app_meta.migration_state='recovery_required'`；应用仍可打开查看/备份/恢复，写操作返回
  `RECOVERY_REQUIRED`。迁移中崩溃（`migrating`）下次启动复位为 clean 后重试。
- **恢复迁移前备份**：`backup.list` 找到 `pre_migration` 记录 → `backup.restore(preview)`
  （校验 hash/清单/schema/完整性）→ commit（先自动 `pre_restore` 备份当前数据 → staging 迁移/
  校验 → 原子切换 active → 新 dataEpoch）。该路径已在集成测试真实执行。
- **恢复失败/中断**：任何切换前失败都保留旧 active 与旧库；切换后失败会尝试回写旧 active 并
  重开旧库，失败则标 `recovery_required`。旧 generation 与 `pre_restore` 档案默认保留；
  `data/restore-log.jsonl` 持久记录 switching/committed/failed 与 backup hash。
- **手工兜底**：不删除 `%LOCALAPPDATA%\BookKeepAI\data` 与 `backups`；不要用裸拷贝替换正在使用的
  DB。SQLite 档案在应用内走恢复；人工把旧 generation 设为 active 需先停应用并核对完整性。

## 9. 已知问题、契约缺口与需 Codex 处理项

自测未发现 P0/P1；下列为实现补充/缺口，严重度由 Codex 复核确认：

| 编号 | 严重度 | 内容 | 建议处理 |
|---|---|---|---|
| N01 | P2（契约） | 新增只读 `backup.list`；`backup.restore` 用 known `backupId` + 5 分钟签名 token，而非文件对话框 `selectionToken`；`backup.create` 写应用内 `backups/`（权限 W，无对话框） | S15 前由 Codex 决定是否正式补契约/改为文件 token；当前已标为“基础”，不宣称最终形态 |
| N02 | P2（范围） | S05 备份档案仅含数据库（审计已在内）；附件/候选/图片表在 S10/S11 出现，manifest `files` 仅 `ledger.db` | S10/S11 扩展 archive 与清单，S15 完善上限/故障注入/孤儿清理 |
| N03 | P2（schema） | `transaction.sourceCandidateId` 有 CHECK + 条件唯一索引，但 candidate 表在 S11 才建立，暂无 FK | S11 用迁移加 candidate 表并做关联完整性校验（SQLite 加 FK 需重建表） |
| N04 | P3（内部） | `mutation_receipt.revision_at_commit` 为契约外内部列，用于回放原 revision | Codex 决定保留或 S11 调整；不跨 IPC |
| N05 | P3（口径） | `transaction.list` 允许省略 filter/page 用契约默认值；`category.create.sortOrder` 可省略（350 起 +10） | 请确认可写为正式口径 |
| N06 | P3（阶段） | `settings.ai` readiness 仍 `stub`、secretMode `absent`；ledgerId 已真实返回 | S09 实现密钥后维持同一接口 |
| N07 | P2（S06 输入） | 服务/收据支持同 mutationId 回放，但 preload/UI 重试会生成新键；目前仅靠按钮 pending 防双击 | S06 表单必须持有并在失败重试时复用 mutationId |
| N08 | P3（可靠性） | 备份“档案已写、收据写失败”可能留下无收据档案；staging 失败可能保留目录 | S15 启动孤儿清理与补偿 |
| N09 | P3（恢复） | 恢复 staging 迁移不另做 pre_migration 备份（恢复档案本身可回退） | S15 评估是否双备份 |
| N10 | P2（环境） | 仅 Windows 10 本机；Win11/干净机/双系统/人工桌面流程未执行；ZIP 未重建 | S17/S18/S19 执行，不得由本步推断通过 |

环境事实（非缺陷）：本机 npm 脚本运行在 DSH 的 Electron-as-Node shim；手工启动 Electron 需移除
`ELECTRON_RUN_AS_NODE`；`scripts/lib/paths.mjs` 已处理。

## 10. 未执行 / 限制

- Windows 11、干净机器、双系统、解压后 S05 构建运行：**未执行**（本步未打包）。
- 分类新建/改名/停用、备份创建、恢复预览/确认的人工鼠标键盘流程：**未执行**；截图仅为渲染证据。
- 真实用户交易与真实图片/密钥/候选/审核/统计/CSV：未实现或未执行（S06～S15）。
- 备份恢复的断电/杀进程/空间不足故障注入、10GiB/10 万文件上限、旧 generation 清理：未执行（S15）。
- 大数据量（10 万交易）分页/完整性检查性能：未测。
- 五张参考图未重新查看；未据此修改任何视觉语义。

## 11. 接收动作（Codex）

1. 先读 `AGENTS.md`、`执行看板.md`、`tasks/S05.md`、本 HANDOFF，再按
   `evidence/S05/INPUTS.sha256` 与 `OUTPUTS.sha256` 复核实物哈希；`git status` 应干净，
   `git log` 应含 `075c475` 与文档提交。
2. 复跑：`npm run typecheck` → `npm test`（135）→ `npm run build` → `npm run smoke:electron`
   （两次 28/28 + 重启幂等）→ `node scripts/db-report.mjs`；核对 `evidence/S05/logs/*`。
3. 对照 `docs/ARCHITECTURE.md` §2/§3/§7、`docs/CONTRACTS.md` §1/§2/§3/§6 审核数据约束、错误码、
   幂等/版本/软删、备份恢复与 S05 的契约缺口 N01～N09；需要补契约时先更新规格/决策，再让 DSH
   返工，不由 Codex 代写实现。
4. 若通过：更新 `执行看板.md`（S05 通过），把唯一写权限与任务交回 DSH 执行 S06（手工记账、
   日期分组、筛选、恢复）。若不通过：写问题单（编号/严重度/复现/证据），DSH 修复后回本步复验。
5. 保留证据分层：S05 是自动化/仓储自测，不是 AC 软件验收，也不是 G 门。

## 12. S06 输入

- 可用仓储/IPC：`transaction.create/update/softDelete/restore/list`、`category.list/update/disable`、
  `ledger.ensureDefault`、`backup.create/list/restore`；`TransactionFilter` 的 dateStart 含、
  dateEnd 不含（9999-01-01 哨兵）、categoryIds、nameQuery（字面子串/ASCII 不敏感）、deleted；
  分页 limit 1～100、cursor 5 分钟且绑定 epoch/revision/scope。
- 返回已含 `filteredTotalFen`、`dateGroups`（整组筛选小计，非本页）、`snapshotRevision`；
  S06 列表页只需按 UX 渲染，不要在前端重算金额/排序。
- 分类停用语义已实现：历史交易保留，新增/改选拒绝；S06 编辑表单需在 categoryId 未改时允许保存。
- 金额文本输入用 `parseAmountYuanToFen`（最多两位小数、0.01～9,999,999.99），展示用
  `formatFenToYuan`/渲染层 `formatAmountFen`；不要用浮点。
- 日期/时区工具 `src/shared/date.ts`（上海今日、范围/精度校验）；相对日/星期展示由 S06 完成。
- 测试基线：`tests/unit/db/helpers.ts` 提供临时数据目录/固定时钟/只读连接；S06 应新增列表页
  与筛选的集成测试，保持真实 SQLite 文件。
- 已知必须处理：N07（重试复用 mutationId）、STALE_EPOCH/SNAPSHOT_STALE 的 UI 重读、
  列表日期组跨页合并（契约要求 UI 合并同日，不能把 page 小计当组总额）。
- 不要以 localStorage 替代账本；不要在前端拼 SQL/路径；不要复用 S05 的“基础备份”措辞宣称
  恢复加固/CSV 已完成。

## 13. 保密自查

- 未读取/复制 DSH 凭证/配置；未调用真实 API；未创建真实交易或图片数据。
- 代码、测试、日志、截图、README、tasks/handoff、evidence 无密钥、完整请求头、图片 base64、
  真实个人消费数据；本机账本为首次初始化空默认账本（0 交易）。
- 敏感模式扫描 0 凭证命中；唯一字面匹配是 S04 HANDOFF 对扫描模式本身的描述。
- 未向任何聊天或外部系统发送交接内容；由开发者手动转交。
