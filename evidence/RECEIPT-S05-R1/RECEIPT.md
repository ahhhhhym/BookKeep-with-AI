# S05-R1 独立复验记录

日期：2026-10-20｜执行者：Codex｜输入提交7c17aa1b9cf3982282397a6b378df2ccca75e8ee｜修复代码a330096。

## 结论

**S05-R1返工，S06继续前置阻断。** 原两项修复的定向回归通过；新增BK-S05-003（P1，目录重建可能重设已知备份hash）开放。详情见本目录ISSUES.md及tasks/S05-REWORK-R2.md。S04原工程接收结论保持，G1～G6均未通过。

| 问题 | 本轮处理 | 证据 |
|---|---|---|
| BK-S05-001 P1 | 关闭（原修订号回退问题） | 3项真实SQLite定向回归：当前/历史revision分离、旧令牌失效且新增数据保留、连续/分类/重启回放不重复；IPC信封同一accessor代码复核 |
| BK-S05-002 P2 | 关闭（原备份入口丢失问题） | 5项真实SQLite定向回归：B1/B2/P可发现/再恢复、重启/坏hash拒绝、外部ledger只替换、文件缺失、目录丢失重建；维护合并不复制交易/旧审计 |
| BK-S05-003 P1 | 新增开放 | 静态路径：先扫描当前文件hash、后补DB已知hash且同id跳过；恢复旧快照后原hash约束可能丢失。组合故障序列未动态执行，需DSH补失败回归 |

## 实物、交接和版本

开始时工作区干净，未发现指向本项目的Electron/Node/BookKeepAI运行进程。已读AGENTS、看板、S05返工任务、原验收问题单、REWORK-R1、REVIEW-R1、ISSUES-RESPONSE及相关契约/架构；复核修复9文件差异和新增8项测试。DSH将上轮Codex文档原样提交为5924d24，再提交a330096及R1证据，本轮原样保留这些历史文件。

本次实际哈希：S05-R1 INPUTS **14/14**，OUTPUTS **27/27**匹配（hash-check.json）。DSH正文写输入13项，与实物清单14项有一项数量笔误，不影响全部匹配。上轮规范与看板本次修改前另存before/，原R1输入哈希仍可按该快照复核。

## 本次实际复跑

环境：Windows 10 x64 build19045、pwsh7.6.7 Core、Node24.19.0、npm11.17.0；源码及测试来自上述提交。所有新证据单独存本目录，不覆盖DSH自测日志。

| 命令 | 退出码 | 结果/证据 |
|---|---|---|
| pwsh版本门 | 0 | Major7/Core，environment.json |
| npm run typecheck | 0 | 三套配置通过，typecheck.log |
| npm test | 0 | 18文件143例通过，test.log |
| npx vitest run tests/unit/db/rework-regression.test.ts --reporter=verbose | 0 | 8/8，通过原两项实际序列，regression.log |
| npm run build | 0 | 三层产物、42图标/12许可，build.log |
| npm run smoke:electron | 0 | 首启28/28、重启28/28且账本/epoch/分类稳定，smoke-electron.log、selftest-dev*.json |
| node scripts/db-report.mjs --json=… | 0 | schema1、1账本、34类、0交易、quick_check=ok、外键违规0，db-report.json/log |

另核对DSH保存的修复前6/6失败日志，其中旧令牌用例未报TOKEN_EXPIRED、原目录用例缺B1/B2，与上轮推导一致；本次没有回退当前代码重新运行旧版本。失败日志是经hash核验的DSH历史证据，当前143/8项通过是Codex本次复跑结果。

## 范围与限制

本轮通过的原缺陷序列属于临时目录真实SQLite服务层测试；Electron自检仍以只读/幂等初始化为主。未独立动态执行完整IPC写入交错、真实桌面点击恢复/分类维护、IME/缩放/读屏、Win11/干净机/双系统、断电/杀进程。没有新增测试脚本、改实现或写真实账本；本机默认库保持0交易。

未重建或重验软件ZIP，release仍为原S04骨架包，不能称为S05-R1应用包。S15外部文件token、分页、恢复操作状态、维护锁/故障注入/限额/正式manifest仍是后续任务；这不豁免本轮已知hash冲突。无真实API/密钥/图片/训练或质量结论，AC整项/G门均不因本轮检查升级通过。

下一唯一负责人：DSH，按S05-R2任务修BK-S05-003并回Codex；不进入S06、不向其他聊天发消息、不发布。Codex只修改验收文档、状态和文字规格；本轮未提交的文档按OUTPUTS.sha256交出，DSH接收时保留。

## 交出核对

git diff --check通过；受跟踪源码、测试、脚本、依赖、资源及构建配置无本轮改动。项目进程过滤未发现运行中的Electron/Node/BookKeepAI项目进程。有限凭证/Bearer头/长图片base64模式扫描匹配文件0，见sensitive-pattern-check.json；不是全量安全/隐私审计，未读取真实secrets或DSH配置。

文档更改后未重复已通过测试，因为实现没有变化。新增问题序列须在DSH新增回归并修复后复验，不把当前通过结果扩张为该序列已通过。
