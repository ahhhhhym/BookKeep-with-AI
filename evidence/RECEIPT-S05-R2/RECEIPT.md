# S05-R2 独立复验及 S05 接收

日期：2026-10-20｜执行者：Codex｜接收提交：9cfba93e361d302a19718860ef124e60c6b6f14d｜修复代码：29f0a51。

## 1. 结论

**S05-R2复验通过，S05数据与仓储阶段接收通过；S06前置阻断解除，仍未开始。** BK-S05-003 P1关闭；原BK-S05-001/002保持关闭。本轮未发现需要继续阻断本阶段接收的问题。

通过范围为S05的SQLite/默认账本/分类/交易仓储、迁移及阶段性备份恢复基础。不是S08完整基础业务验收，AC整项与G1～G6不据此升级通过，不能视为正式应用包验收或发布决定。

## 2. 版本与实物

已读AGENTS、看板、tasks/S05-REWORK-R2.md、REWORK-R2、ISSUES-RESPONSE、原BK-S05-003问题单及相关CONTRACTS§10.2、ARCHITECTURE§11。审阅4896172→29f0a51的7文件差异、新增5项真实SQLite组合回归，以及旧schema-too-new测试的调整。

开始时工作区干净，无命令行指向本项目的Electron/Node/BookKeepAI进程。INPUTS **13/13**、OUTPUTS **25/25**字节匹配，详见hash-check.json。DSH已将上轮Codex文档原样提交为4896172；历史交接/问题/哈希均保留，不回写为“当时已通过”。本轮修改前看板及3份规格/决策文档留在before/。

## 3. BK-S05-003 关闭依据

实现复核：启动先将DB已知创建记录导入目录，再扫描未知档案；恢复切换前读取当前DB的已知记录，切换时先导入这些记录和旧快照中的记录，再扫描。扫描仅补未知id；目录/DB已知hash冲突明确标错，列表不可恢复，preview/commit拒绝。目录维护只合并backup_record，不合并交易或旧审计。

本次真实执行DSH已有回归，覆盖：

- 修改B2金额但保持合法SQLite后，目录丢失重建仍保留原hash，预览拒绝。
- B1→B2→合法改B2金额→丢目录→重启→恢复B1→再预览B2：恢复前后均HASH_MISMATCH，当前账本仍为B1，未接受改动档案。
- 目录/DB已知hash冲突：artifact=null且BACKUP_INVALID，恢复B1后仍拒绝。
- 目录JSON损坏以及运行中删除目录：原hash不丢失，恢复后继续拒绝B2。

原R1的8项回归亦本次重跑通过：旧请求回放不回退revision、旧恢复令牌失效、连续/分类/重启回放不重复、正常B1/B2/P目录与再恢复、重启/坏档案拒绝、缺失文件/目录重建、外部ledger只替换不混账。

核对DSH已保存的修复前4/4失败日志，核心用例曾在恢复B1后错误放行B2；日志hash匹配。该失败结果是DSH历史证据，本次没有回退源码重跑旧版本。修复后5项及原8项通过是Codex本次独立复跑结果。

旧backup.test.ts的schema-too-new用例仅同步伪造目录hash，以使该用例越过新增一致性校验后抵达schema拒绝分支，仍断言SCHEMA_TOO_NEW和数据保持；没有删除坏hash断言或跳过测试。

## 4. 本次命令与结果

环境：Windows10 x64 build19045、pwsh7.6.7 Core、Node24.19.0、npm11.17.0。测试只使用临时目录的合成交易和真实SQLite文件；本机默认账本仍为0交易。

| 命令 | 退出码 | 本次结果/证据 |
|---|---|---|
| pwsh版本门 | 0 | Major7/Core，environment.json |
| npm run typecheck | 0 | 三套TS配置，typecheck.log |
| npm test | 0 | 19文件148例通过，test.log |
| npx vitest run tests/unit/db/rework-regression.test.ts tests/unit/db/rework2-regression.test.ts --reporter=verbose | 0 | 13/13（原8+新增5），regression.log |
| npm run build | 0 | 三层产物、42图标/12许可，build.log |
| npm run smoke:electron | 0 | 首启28/28、重启28/28且账本/epoch/分类稳定，smoke-electron.log、selftest-dev*.json |
| node scripts/db-report.mjs --json=… | 0 | schema1、1账本、34类、0交易、quick_check=ok、外键违规0，db-report.json/log |

## 5. 限制及后续责任

- 这是自动测试/仓储与代码复核接收。完整Electron IPC写入交错、真实桌面分类/恢复点击、键盘/IME/缩放/读屏、Win11/干净系统/双系统、断电/杀进程未在本轮执行；相应子项在S08/S15/S17/S19补验。
- S05内部backupId、DB-only档案和全量目录仍为已登记阶段适配。S15须补外部文件token、目录分页、恢复操作状态核实、维护锁/故障注入、限额/补偿与正式manifest；S10/11补附件/候选及关联，不能称AC16整项完成。
- 未重新打包或重验ZIP；release仍为S04骨架历史包，不是S05-R2应用包。未跑npm ci/干净依赖安装。
- S06使用现有真实仓储/IPC，实现手工记账、日期分组、筛选/编辑/软删恢复及既定CSV范围；表单失败重试复用mutationId，处理STALE_EPOCH/SNAPSHOT_STALE，不用前端/localStorage重造账本。S07统计、S08 G1、S09真实API尚未完成。
- 无真实API/密钥/图片/训练/质量结论；未读取DSH配置、写真实消费或向其他聊天发送内容。

下一唯一负责人DSH，由开发者提供S06任务并手动转交；本轮不启动S06或DSH，不决定发布。Codex未改实现/测试/脚本/依赖/构建配置，只写接收、状态和文档；本轮未提交材料以OUTPUTS.sha256绑定，后续保留。

## 6. 交出检查

文档完成后git diff --check通过，源码/测试/脚本/依赖/资源/构建配置无本轮修改，项目进程过滤未发现运行中的项目Electron/Node/BookKeepAI。有限凭证/Bearer头/长图片base64模式扫描匹配文件0，见sensitive-pattern-check.json；这不是完整安全/隐私审计。没有读取真实secrets/DSH配置。

后续更改均为文字接收状态和证据，未无因重复已通过测试。当前证据与未提交文件清单见final-check.json，输出版本见OUTPUTS.sha256。
