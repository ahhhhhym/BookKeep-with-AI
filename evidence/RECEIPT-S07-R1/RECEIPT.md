# S07-R1 本阶段验收记录

2026-10-21｜用户任务：验收S07｜执行：Codex｜结论：**S07本阶段接收通过**。未启动完整S08，G1～G6均未通过。

## 固定范围和输入

被验HEAD `e13d96413eeeed7b7673c71440986e6ea65c152b`，分支`codex/s07-statistics`；S07实现`ecc97950b62cf6eb71dddc69c15039e2374f6ed0`。开始时工作区干净且无本项目后台进程。冻结前核验SOURCE150/150、BUILD5/5、OUTPUTS110/110；原S06-R1接收记录存在。冻结源码与结束源码150/150相同，重建产物5/5匹配原指纹，见freeze.json、input-verification.json、FROZEN-SOURCE/BUILD.sha256、post-verification.json。

本轮不改产品、原测试、原构建/自测脚本、锁文件或迁移；只在本轮目录建立验收探针及原流程的证据输出副本，最后更新四份入口状态文档和接收记录。原evidence/S07、HANDOFF及tasks保留；原OUTPUTS在状态更新前核验，旧入口文本在before/，按历史版本核验旧哈希。

已依据AGENTS、执行看板、S07任务和交接、S06 HANDOFF/ACCEPTANCE-R1、开发方案§2.3、交接与验收、PRD统计需求、CONTRACTS§11、ARCHITECTURE§12、UX§5、FIXTURES F02/F03及D47/D48核对。无业务口径/契约变更，无新决策替代原规格。

## 环境和执行命令

Windows10 x64本机开发构建；PowerShell7.6.5 Core（指定pwsh.exe），Node24.19.0/npm11.17.0，Electron44.9.1/Chromium152.0.7977.167/Node24.22.0/ABI149。协议bookkeep://app/index.html，标题BookKeepAI。Browser plugin not available；按frontend-testing-debugging技能使用已装Playwright Electron，不新增依赖。`BOOKKEEP_QA_NODE_MODULES`仅QA使用，应用不依赖Codex或DSH。

流程：统计入口→周期/分类选择→hover/键盘/点击固定Top3→查看同范围明细→修改/删除/恢复/重启与故障处理→整数核对。原22项/15项流程的副本仅改导入相对路径、输出目录及验收标签；没有削弱断言。LOCALAPPDATA全部独立临时合成目录，路径写入各JSON；离线设置在真实Electron上下文生效，不发API请求。

| 命令（工作目录均为项目根） | 实测 | 证据 |
|---|---|---|
| npm run typecheck | 退出0 | logs/typecheck.log |
| npm test -- --maxWorkers=2 --reporter=json --outputFile=evidence/RECEIPT-S07-R1/unit-results.json | 21文件181/181，0失败 | unit-results.json、logs/test.log |
| npm run build | 退出0，42/42图标；五项产物相同 | logs/build.log、post-verification.json |
| node evidence/RECEIPT-S07-R1/replay-s07.mjs | 22/22真实统计界面检查 | s07-replay/ui-workflow.json、logs/s07-replay.log |
| node evidence/RECEIPT-S07-R1/replay-s06.mjs | 15/15手工流程回归 | s06-regression/ui-workflow.json、logs/s06-regression.log |
| node evidence/RECEIPT-S07-R1/startup-probe.mjs | 首启/重启各28/28 | startup-result.json、selftest-dev*.json、logs/startup.log |
| node evidence/RECEIPT-S07-R1/acceptance-probes.mjs | 7组新增检查；120范围+恢复后3范围=123；15范围遍历所有有效点Top3 | additional-probes.json、logs/additional-probes.log |

## 按AC记录实际结果

| AC / 范围 | 真实结果 | 本阶段判断 |
|---|---|---|
| AC03相关日期 | 原业务测试复跑上海午夜scope/today变化、周一始、闰年和跨年；新探针真实IPC核对1900边界、2024闰年、2024/2025跨年和实际今天2026-10-21；未来正式行排除 | S07相关子层通过；未实测系统跨午夜 |
| AC04相关联动 | 编辑/软删/恢复后三视图与全范围明细一致；多分类年点跳月明细并返回；改名/停用保留关联；真实备份恢复回8笔99330及新epoch | S07子层通过 |
| AC05周期/日均 | 周7点/月28～31点/年12点，补0/未来标记；当前范围只到上海今天；历史完整自然日及当前已过日数精确半入；120独立算法范围全部匹配 | S07子层通过 |
| AC06 Top3 | 日点按金额/已知时间/时刻/ID；年图月点按分类汇总/ID，保留不足3项和空点；第四笔5226总额但Top3仍1800/1626/1000；多日餐饮聚合7150 | S07子层通过 |
| AC07固定数值 | 独立F02六笔96530分，日4426/92104；9月日均32.18，前三类85000/5554/4350，水果1626第四；F03-A99330、双分类8776；列表limit1仍给全额 | S07子层通过；候选/批准闭环待S11/S17 |
| AC21相关界面 | 页面身份/非空/无错误overlay、实际控件和键盘、同值表、空/未来/错误/迟到响应、离线和重启；1280×900/640×480/200%应用缩放定向复跑 | 定向通过；真人读屏/IME及全DPI未执行 |
| AC01/02等基础回归 | 首启/重启28+28、原手工15项流程和全量181测试 | 作为回归保留，不替代S08完整验收 |
| 完整AC及G门 | 本轮只有S07接收 | 整项状态不升级，G1～G6未通过 |

新增独立对照脚本不导入产品统计/日期算法。预期由合成输入记录和独立日历/整数聚合计算，经真实preload读取四统计接口与list全额。132行混合最小/最大单笔、软删、精确/未知时间、同额、闰日、跨年、当前和未来，10锚点×3周期×4分类集合=120范围（含重复分类ID）；15范围（含恢复后3个）逐点核对交易/分类Top3。每组同时核对范围边界、点序列、未来标记、总额、笔数、日均、排行榜金额/百分比、统一scope和limit1明细全额。新探针不是只复写实现自测结论。

恢复后SQL：8笔99330分，quick_check=ok、foreign_key_check为空。原流程副本最终6笔97530是编辑扩展后的独立数据集；不是F02基线。固定T0=2026-10-20测试来自业务时钟，真实UI截至2026-10-21，年分母294；两种时钟证据分开。

## 界面检查和问题

| 检查 | 结果 |
|---|---|
| 页面身份 | bookkeep://app/index.html / BookKeepAI匹配 |
| 非空 | 统计卡片、图表、排行和真实SQLite数据均出现 |
| 框架错误遮罩 | 0 |
| 控制台 | pageerror和其他console error/warning为0；既有CSP meta提示单列 |
| 截图 | 已查看F02月图、年点分类Top3、640×480和200%详情、新增双分类停用和恢复后日Top3；见s07-replay/screens及screens-additional |
| 交互 | 原22项+新增UI/恢复/IPC探针，状态和值实际变化 |

BK-S07-001～003原复现路径定向回归通过。BK-S07-004 P2的frame-ancestors meta忽略提示仍存在，跟踪S15；未以本轮接受代表安全门通过。没有新产品阻断问题/P0/P1。

新增探针第一轮在从明细返回统计后，没有展开默认折叠的分类区域，就等待停用分类标签可见而超时。DOM已找到正确隐藏标签，原因是验收脚本前提缺失。只增加展开步骤，全部新探针随后通过；原additional-probes-attempt1.json、logs/additional-probes-attempt1.log、screens-additional/probe-attempt1-failure.png保留，另将最终脚本移除这一行，复原首轮脚本为acceptance-probes-attempt1.reconstructed.mjs。失败没有修改产品或原测试，未重写原S07自测证据。

## 结论和限制

S07本阶段接收通过，允许下一轮由用户启动S08。Codex此前负责实现，本轮验收阶段/证据分开；不称不同作者、人类独立审查。源码150项与五项构建产物前后相同；本次只新增验收证据和修改入口状态，无应用包、源码ZIP或公开发布。

未执行：S08完整基础AC/G1、真人IME/读屏、真实系统跨午夜、Win11/干净机、完整系统DPI矩阵、正式ZIP中文路径解压、真实API/审核/训练、CSV及发布。候选隔离只有现有数据库只读范围/未实现占位等子层证据，不声称真实审核闭环通过。

不向真实用户账本灌样本、不把测试数据库/附件拷入仓库、不清理来源不明目录、不发其他聊天消息。既有release S04骨架ZIP未重建。最终进程、敏感模式、链接/指纹及Git状态见final-check.json；INPUTS.sha256/OUTPUTS.sha256为本轮输入/产物清单。
