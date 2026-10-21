# S07 同源统计、周期与Top3交接

日期：2026-10-21｜交出者：Codex｜下一唯一负责人：Codex（S08，由用户另步启动）。

**状态：实现及自测完成，待S08单列验收。S08未执行，G1～G6均未通过。** 本会话承担S07实现、修复及自测，没有执行S08/S17/S19，不声称不同作者独立审查；没有创建或发送其他聊天。本步没有正式打包、上传或发布。

## 1. 输入、版本与工作区

- 初始main HEAD：`9ca06035a1343a9efa89b6474c337dfae2dab364`，工作区干净、无本项目后台进程。S06实现`fa034a3`，S06-R1接收基线`c431de8`，接收交接文件实际存在。
- 修改前核对S06 SOURCE144项、最新接收OUTPUTS49项，**193/193匹配**；实际逐项结果见`evidence/S07/input-verification.json`。原S01～S06交接、接收和证据不改写。
- 已读AGENTS、看板、S06 HANDOFF/ACCEPTANCE-R1、开发方案/交接规范、PRD S01-1.0、CONTRACTS/ARCHITECTURE S02-1.2、UX/FIXTURES S03-1.0、D43～D46。S07任务书起初不存在，本步建立。
- **实现提交：`ecc97950b62cf6eb71dddc69c15039e2374f6ed0`，分支`codex/s07-statistics`。** 后续交接/证据提交不改实现；最终交接提交用`git log -1 --format=%H -- handoff/S07/HANDOFF.md`查询，避免自引用。
- `bookkeep.v1`、数据库schema1、appVersion0.1.0、package-lock及依赖不变，无数据库迁移。D47为既定四接口的运行时映射/快照细化，D48采用本地SVG替代未锁定的ECharts建议；先登记决策和影响再实施。
- 源码/测试/脚本/配置/资源150项见`SOURCE.sha256`，五项构建产物见`BUILD.sha256`；交接和本轮证据见`OUTPUTS.sha256`，修改前输入/副本见`INPUTS.sha256`与`before/`，变更清单见`changed-files.txt`。这些是交出版本记录，不是S08验收冻结/结论。

## 2. 交付与业务口径

| 文件/区域 | 实际内容 |
|---|---|
| src/shared/statistics.ts | 四接口DTO、规范范围、日历运算；周一始7日、自然月28～31日、年12月 |
| src/main/services/statistics-service.ts | 同LedgerStore/SQLite正式transaction事实源、DEFERRED只读快照、日聚合/全分类排行、Top3、日均及百分比；64位精确累计与超限拒绝 |
| src/shared/ipc.ts、api.ts、preload、main handlers/store | 四个statistics只读白名单通道；严格载荷与当前epoch校验，无渲染DB/SQL/文件权限 |
| renderer/lib/statistics.ts | series首读、绑定revision读summary/排行/分类字典；scopeId/today/epoch冲突整组重读、最多3次；金额一致性检查 |
| StatisticsPage、StatisticsChart、styles | 周/月/年、日期选择、前后/回当前、独立分类筛选、总额/日均/排行榜、完整折线、未来点、悬停/键盘/固定正常流详情、同值表、查看明细 |
| App、LedgerPage | 统计→点日期/月份及分类明细；不带名称搜索，返回保留统计周期/分类并重读；S06其余流程保留 |
| tests/unit/db/s07-statistics.test.ts | 新增25项真实SQLite/业务/读取器/运行时schema测试；原通道数断言同步22个（21业务+1既有骨架） |
| scripts/smoke-s07.mjs、main/selftest | 22项真实Electron交互/故障门控；启动自检精确允许新增statistics及四方法，仍保留Node隔离等检查 |
| tasks/S07、docs、AGENTS/README/开始阅读/看板、issues | 任务/决策/契约细化、当前入口/状态及缺陷记录；无AC整项或门禁升级 |

统计只读本账本正式未删除交易，时间为`[start,effectiveEnd)`，effectiveEnd=min(完整周期end,上海今天+1日)，不从已加载分页行估算。不读取候选/识别状态。未来正式交易仍在明细中，但不进入当前统计，未来点0/尚未到来且服务拒绝详情。

日Top3：金额降序→已知时间优先→时刻降序→ID ASCII升序，未知同额直接ID；不使用createdAt。月Top3/排行：先全月/全周期按分类聚合→金额降序→分类ID ASCII升序，停用/改名保留历史。少于3项显示实际项数，0项暂无支出；上方总额含所有支出，前三不替代总额。

历史日均分母为完整周期自然日；当前为周期开始至今天含今日，含无消费日，年也按日。分/比例采用整数比值半入四舍五入；只有图像坐标与比例条宽度近似转换。scopeId绑定规范周期、分类、账本、epoch、revision和today；午夜/恢复/更改不能混拼旧卡片或点详情，迟到请求不能覆盖新视图。

## 3. 环境、精确命令与结果

PowerShell全部显式使用`C:\Users\Administrator\AppData\Local\Microsoft\WindowsApps\pwsh.exe`，事前确认7.6.5 Core，UTF-8。Windows10专业版10.0.19045 x64；命令Node24.19.0/npm11.17.0；Electron44.9.1/Chromium152.0.7977.167/Node24.22.0/ABI149。无新依赖。

下列证据均相对`evidence/S07/`。UI命令先设置`$env:BOOKKEEP_QA_NODE_MODULES='C:\Users\Administrator\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules'`；仅QA依赖，用户运行应用不依赖它或Codex/DSH。

| 命令/层级 | 实际结果 | 证据 |
|---|---|---|
| npm run typecheck | 退出0 | logs/typecheck.log |
| npm test -- --maxWorkers=2 --reporter=json --outputFile=evidence/S07/unit-results-final.json | 21文件181项通过，新增25项 | unit-results-final.json、logs/test-final.log |
| npm run build | 退出0，含42/42图标验证；五项产物指纹 | logs/build-final.log、BUILD.sha256 |
| node scripts/smoke-s07.mjs | 22/22真实Electron定向检查通过 | ui-workflow.json、logs/ui-workflow.log、screens/ |
| node evidence/S07/replay-s06.mjs | 15/15原S06真实Electron流程通过；证据独立副本 | s06-regression/、logs/s06-regression.log |
| node evidence/S07/startup-probe.mjs | 首启/重启各28/28，默认账本/epoch/34分类/schema保持 | startup-result.json、selftest-dev*.json、logs/startup.log |
| 源码/构建/输入指纹及敏感模式检查 | 无匹配密钥/完整Bearer/base64，最终指纹见清单 | final-check.json、sensitive-pattern-check.json |

首次全并发回归9项旧磁盘重操作超过默认5秒；保留`unit-results.json`，限制2 workers后179/179，新增2项读取器回归后最终181/181。未延长超时、未删弱断言。首次启动自检旧白名单未含statistics为27/28，更新精确允许键/方法后28/28，失败报告及日志保留。UI前次失败和成功记录在`attempt-history.json`及`ui-workflow-previous-*.json`，问题修复不覆盖原失败JSON。

## 4. 数值与交互核对

| 数据/操作 | 期望及本次实际 |
|---|---|
| F02六笔 | 09-08=4426分，09-09=92104分，共96530分=965.30元；9月日均÷30=32.18 |
| F02三个视图 | 周7点/月30点/年12点；series、summary、全分类排行、全范围明细、图点整数和均96530分；业务测试还逐个有效点核对同范围明细 |
| 9月分类前三 | 维修85000/数码5554/餐饮4350分；水果1626第四；年9月点同额，非前三笔交易。比例88.06/5.75/4.51/1.68% |
| F03-A/B | 第四笔计总额/Top3截断、多日同类先聚合、跨月周及月内分类不串额，少于3项按实际 |
| F03-S/C | 同额日交易与列表采用各自全序；分类并列按ID、改名/调序/停用不改排序依据及历史额 |
| F03-L | 闰年2月29点、普通年28点、跨年周2024-12-30～2025-01-05共7点9000分；历史年分母366/365，受控上海午夜刷新分母 |
| F03-F | 固定T0当前周/月/年分母2/20/293，只计3000分；4笔含未来明细为10000分；未来详情直接拒绝 |
| 编辑/删除/恢复 | 维修85000→86000：总97530；软删11530；恢复97530，周/月/年均与明细一致。真实备份恢复回96530及新epoch有业务测试 |
| UI故障/刷新 | 点详情发现revision过期整组重读；真实query响应门控时显示loading，切年后迟到旧月响应不回写；注入DB_BUSY不假显0，重试恢复 |
| UI键盘/小屏/重启 | 单Tab图入口、左右/Home/End、Enter/Space、Tab进入关闭/Esc；hover移入详情持续、点击固定/解除；1280×900/640×480与200%缩放定向检查、同值表、重启持久化 |

FIXTURES T0固定2026-10-20（当前年293天/3.29元）用注入业务时钟验证。本机UI实测上海今天2026-10-21，当前年294天/3.28元；如实分别记录，不用过期“今天”套数值。UI最终扩展到97530分（6正式笔，另1已删除触发快照用测试笔），不是基线96530；quick_check=ok、外键违规0。

## 5. 覆盖、问题及未执行项

| REQ / AC | S07自测子层结果 | 接收状态 |
|---|---|---|
| REQ-007 / AC04、AC07 | 正式未删、全范围同源；编辑删除恢复、分类及列表独立范围、三视图一致 | 子层通过，整项待S08 |
| REQ-008/010 / AC03、AC05、AC07 | 点数、补0/未来、周期操作、日均分母、排行金额比例、闰月/跨年 | 子层通过，整项待S08 |
| REQ-009 / AC06、AC07 | 日交易Top3、月分类Top3、并列/不足3/空点、总额含第四项 | 子层通过，整项待S08 |
| REQ-011 / AC21及相关AC22 | 真实Electron交互、无框架overlay/空壳、截图/两视口/200%应用缩放 | 定向通过；人类读屏/IME、完整系统DPI矩阵未执行 |
| AC10审核隔离、AC08/13真实图片、AC15完整安全、AC16 CSV/正式恢复、AC17～20/22完整交付 | 当前候选/识图/CSV/数据框架及正式ZIP等尚未实施或不是S07范围 | 未执行，不由SQL只读范围或构建推断通过 |

- BK-S07-001 P2：固定viewBox刻度缩小，改ResizeObserver匹配逻辑宽度/14px刻度；真实缩放回归通过。
- BK-S07-002 P2：极低高度状态栏挤占统计区域，仅该页低高限20vh并可滚动；详情正常流/内部可滚，回归通过。
- BK-S07-003 P2：滚动enter覆盖键盘选点，键盘模式需实际鼠标移动/点击才解除；原复现流程回归通过。
- BK-S07-004 P2：S04继承CSP meta `frame-ancestors`忽略提示，单列`inheritedPolicyNotices`，交S15；未在S07修复。其余console error及pageerror为0，不称完整安全验收或控制台完全无消息。
- 本次Browser插件/browser技能不可用，按frontend-testing-debugging技能使用既有Playwright Electron测试真实本地应用；不是IAB模拟页。完整视觉检查见VISUAL-REVIEW.md。
- 未执行真人鼠标/中文IME/读屏、真实系统时钟跨午夜、Win11/干净机、完整DPI矩阵、正式ZIP中文路径解压、S08全AC/G1、真实AI或训练质量；没有模型权重训练/真实样本或密钥。

## 6. 数据隔离、回滚与S08输入

UI、启动和业务测试的LOCALAPPDATA/StorageLayout均独立临时合成目录，实际路径在JSON记录；未向真实用户账本灌数据。生产数据库、附件/备份仍在原用户目录，运行位置规则不变。测试临时数据留作复核，未递归删除来源不明目录；需要清理先核实明确路径。

回滚：先备份用户数据/保留本地改动，审阅本实现提交的revert；本步无迁移，不自动回滚账本。当前旧S04骨架ZIP不代表S07，未重建release ZIP。SOURCE/BUILD只是本地开发构建指纹，不是应用发布包。

交出时无本项目运行的Electron/Vite/构建任务，无其他写入Agent。交接/证据提交后工作区状态用`git status --short`核对，停止本步写入。下一Agent可在用户明确启动S08后接管。

S08先核对本实现commit、SOURCE/BUILD、OUTPUTS和现有S06-R1接收，再单列固定版本/文件哈希、停止后台写入；该轮只验收S04～S07完整基础链路与G1，不能把本表自测直接复写为通过。缺陷保留失败证据，转对应Codex实现步骤修复后以新版本复验。若同一会话兼任实现/验收须披露，不称不同作者独立审查。S08未启动，不自动进入S09或发布。
