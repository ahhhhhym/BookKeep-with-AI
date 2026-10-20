# S04/S05 独立接收记录

日期：2026-10-20｜接收者：Codex｜接收基线：main `e20badf4a698fb82fd145701dfbf908f5f249dd6`；业务代码 `075c475`，S04 代码 `7ffbed3`、历史交接 `7aa1066`。

## 1. 结论

| 步骤 | 结论 | 依据与范围 |
|---|---|---|
| S03 | 通过（文档接收复核） | DSH 的 S04 输入/接收记录存在；当前输入哈希复核匹配，不代表 UI 验收 |
| S04 | 通过（工程骨架接收） | 历史产物 130/130 匹配；原冒烟 ZIP 哈希一致、实际解压启动 22/22；当前工程构建与隔离边界复跑通过 |
| S05 | **返工** | 现有检查通过，但代码审查发现 BK-S05-001 P1、BK-S05-002 P2，详见 ISSUES.md |
| S06 | 未开始，前置阻断 | DSH 先修复 S05 并交 Codex 复验，不继续叠加业务 |

G1～G6 均未通过；本次不执行 S08 的完整基础业务验收。S04 通过不代表 S05 或正式应用发布通过。DSH 在独立接收前已经实现 S05，本次按用户要求补做两步接收，不将此过程倒写为已遵守逐步门禁。

## 2. 实物与版本

开始时工作区干净，未发现命令行指向本项目的 Electron/Node/BookKeepAI 后台进程；Codex 期间只写验收文档、看板、规格补充及证据，不修改源码/脚本/自动测试/依赖/打包配置，不发其他聊天消息。

- S04 INPUTS：20/20 当前字节匹配。
- S04 OUTPUTS：当前 109/130 匹配；21 个差异全部位于后续 S05 已提交的覆盖文件。用 `git archive 7aa1066` 在 `.tmp/S04-acceptance-baseline` 重建只读历史副本后 **130/130 匹配**，不存在据此认定的无来源改动。见 hash-check.json、s04-historical-hash-check.json、s04-to-s05-files.txt。
- S05 INPUTS：25/25；S05 OUTPUTS：74/74 当前字节匹配。
- 文档补充前保存 before/ 下的看板、DECISIONS、CONTRACTS、ARCHITECTURE、ICON-MAP，保持历史输入可复核；本次新输出单独计算 OUTPUTS.sha256，不改写 DSH 的历史证据。
- 未重新 package:zip；release 中仍是 S04 骨架包，不能称为 S05 应用包。未执行 npm ci，复跑使用已有锁定依赖；npm ls 显示直接依赖与 package.json 精确版本一致，未验证干净安装。

## 3. 本次实际命令

环境：Windows 10 Pro x64、build 19045；pwsh 7.6.7 Core；系统 Node v24.19.0、npm 11.17.0。具体自检版本见 selftest JSON。

| 命令/检查 | 退出码 | 本次结果 | 证据 |
|---|---|---|---|
| pwsh 版本门 | 0 | Major=7，PSEdition=Core | environment.json |
| 输入/产物 SHA256 | 0 | 如上；S04 历史副本全匹配 | hash-check.json、s04-historical-hash-check.json |
| npm run typecheck | 0 | 三套 TS 配置通过 | typecheck.log |
| npm test | 0 | 17 文件 / 135 例全部通过 | test.log |
| npm run build | 0 | 三进程产物、42/42 图标、12 份许可 | build.log |
| npm run smoke:electron | 0 | 首次 28/28、重启 28/28，账本/epoch/generation/34 分类保持 | smoke-electron.log、selftest-dev*.json |
| node scripts/db-report.mjs --json=… | 0 | schema 1、1 账本、34 类、0 交易，quick_check=ok、0 外键违规 | db-report.json、db-report.log |
| npm run verify:zip | 0 | 原 ZIP 134 条目、必需项齐、规则检查无禁止项 | verify-zip.log |
| npm run smoke:packaged | 0 | 从原 ZIP 实际解压 112 文件，EXE 自检 22/22 | smoke-packaged.log、selftest-s04-packaged.json |
| npm ls --depth=0 | 0 | 直接依赖树匹配，未报告缺失/冲突 | 本次工具输出；版本亦可由锁文件和自检复核 |

原 ZIP：`release/BookKeepAI-0.1.0-win-x64.zip`，154459657 字节；SHA256 **3B15315A7D0AFDDB530F5188E2A547262B4E1221685451B6FEFC8F6385A5B013**。这是 Windows 10 本机骨架冒烟；未重建、未证明 S05 已入包。

## 4. 审查覆盖及证据限制

已审阅默认账本/分类种子、金额日期校验、查询排序/筛选、小计、version/软删、审计与收据、启动/迁移、备份档案/恢复切换、IPC/preload/window 边界，并对照 PRD、ARCHITECTURE、CONTRACTS、UX、任务及交接。现有 SQLite 集成测试真实复跑；**两项新增问题为静态代码路径发现，缺陷交错序列未动态执行**，修复回归由 DSH 编写。本机默认库始终为空（0 交易），没有创建真实消费或执行覆盖恢复。

复核 DSH 已有 categories.png/data.png：可见 34 类及真实数据入口，仍含内部 ID/schema 等开发信息；这些只证明截图内容，不证明人工交互。本次原生桌面控制能力不可用，未执行分类新建/改名/停用、备份创建/恢复的实际点击，也未执行 IME、键盘、缩放/读屏、离线、中文解压路径、Win11、干净机器或崩溃/断电。上述留到 S08/S15/S17/S19 对应检查；不能在看板上转成“已通过”。

AC01/02/04/11/15/16/20/22 仅有相关子层证据，均不升级整项通过；其他 AC 不因本次测试自动完成。无真实 API/凭证/训练/数据集/统计质量结论。

## 5. 交接偏差处理

| 原条目 | 裁定 |
|---|---|
| S04 N01/N02 | mock 诊断保留至 S10 替换，显著本地模拟；S05 已持久化 epoch，重启稳定证据通过 |
| S04 N03/N04/N05/N06 | 补登记导航图标；安全错误键及 mock verified 语义、结构/领域错误分界写入 CONTRACTS §10 |
| S04 N07/N08/N09 | 保持现锁定 TS，不主动升级/安装系统 Git；便携 Git 可追溯即可；未签名/体积交 S18，S04 非发布包 |
| S05 N01 | 允许 S05 内部目录 backupId 作为阶段适配；S15 必须补外部文件 token、恢复状态核实与分页，不能宣称完整 AC16 |
| S05 N02/N03 | 无附件/候选时 DB-only 可作基础；S10/11 扩展附件和完整关联，S15 复核；不通过全功能备份/审核 |
| S05 N04 | 接受内部 revision_at_commit 列；**不接受写回当前水位**，BK-S05-001 |
| S05 N05 | 接受省略筛选/分页的明确默认；sortOrder 自动分配见 CONTRACTS §10，超域拒绝 |
| S05 N06/N07 | secret stub 保持至 S09；所有表单重试复用 mutationId，由 S06 处理，备份维护 UI 最迟 S15 补齐 |
| S05 N08/N09 | 文件/收据补偿及 staging 不双备份暂留 S15；旧 active/档案保留是底线，不能以此延后 BK-S05-001/002 |
| S05 N10（HANDOFF） | Win11、干净机、S05 ZIP 与真实桌面未执行，继续明确列限制 |

下一唯一负责人：DSH，执行 tasks/S05-REWORK.md；修复后 Codex 复验 S05。当前不授权/启动 S06，不运行 DSH、不向其他聊天发送内容、不决定最终发布。

## 6. 交出检查

本轮文档变更完成后 git diff --check 通过；受跟踪源码/脚本/测试/资源/配置无变更，修改仅5份原有Markdown与新增验收材料。项目进程过滤检查未发现运行中的 Electron/Node/BookKeepAI 项目进程。本轮文档尚未提交，交接时以 OUTPUTS.sha256 绑定文件版本，后续保留这些变更。

对 src/tests/scripts/resources/handoff/tasks/evidence/README/package.json 执行选定 key、Bearer 头、长图片base64模式扫描，匹配文件0（sensitive-pattern-check.json）。这只是有限模式检查，不是全量隐私或正式ZIP敏感审计；未读取本机secrets或DSH配置。

未重复运行已通过测试：后续修改全部是文字规格/状态与验收证据，没有实现变动。新增 committedRevision 及备份目录保留要求由 DSH 实现后再测，不将新规格视为当前测试覆盖。
