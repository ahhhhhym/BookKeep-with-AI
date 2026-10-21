# S08-R1 基础链路验收记录

日期：2026-10-21｜执行者：Codex｜目录：`D:\BookKeep with AI`。

**本轮验收已执行；G1未通过，S09不可开始。** 已执行的手工记账、日期、统计、整数金额及持久化检查通过；AC07要求的持久化待审/拒绝/失败数据隔离缺少当前运行时前置，整项保持“未执行（部分通过）”。问题[ BK-S08-001 ](../../issues/BK-S08-001.md)为验收覆盖/依赖冲突，不是已发现统计金额错误。本轮没有P0/P1新缺陷，仍不能把未执行项写成通过。

## 1. 固定版本、前置与证据边界

- 冻结分支`codex/s07-statistics`，HEAD **47b60fe503c38e05497e0252879587f2dfc6d5bc**；S07实现`ecc97950b62cf6eb71dddc69c15039e2374f6ed0`。
- PowerShell按要求显式使用`C:\Users\Administrator\AppData\Local\Microsoft\WindowsApps\pwsh.exe`，预检**7.6.5 Core**通过；UTF-8。开始工作区干净，无本项目Electron/Vite/构建后台进程。一次只有本验收执行者写证据。
- Windows10专业版10.0.19045 x64；命令Node24.19.0/npm11.17.0；Electron44.9.1/Chromium152.0.7977.167/Electron Node24.22.0/ABI149。应用0.1.0，schema1、bookkeep.v1。上海实际日期2026-10-21。
- 已读AGENTS、执行看板、S04～S07原HANDOFF及S05-R2/S06-R1/S07-R1通过接收记录、开发方案、交接规范、PRD S01-1.0、ACCEPTANCE S01-1.0、UX/FIXTURES S03-1.0及D43～D48。`tasks/S08.md`原先不存在，以用户本轮任务为任务书；没有虚构既有文件。
- S04 OUTPUTS在原交接commit核对130/130；S05原OUTPUTS74/74；S06原SOURCE144/144；S04/S05修复/S06/S07提交均为HEAD祖先。当前S07 SOURCE150/150、BUILD5/5、最新接收OUTPUTS63/63，共218/218匹配。详见[历史核对](historical-verification.json)、[当前核对](input-verification.json)。
- 冻结607个原跟踪文件，5项dist产物，见[FROZEN-TRACKED](FROZEN-TRACKED.sha256)、[FROZEN-BUILD](FROZEN-BUILD.sha256)。重建后两清单均无差异；最终只允许执行看板的验收状态变更，结果见[最终复核](final-check.json)。原代码、测试、脚本、锁文件、资源、迁移、规格及历史证据不变。
- 原S04骨架ZIP仍存在，SHA256 `3B15315A7D0AFDDB530F5188E2A547262B4E1221685451B6FEFC8F6385A5B013`匹配。它不是当前S07应用包；本轮没有重新打包、解压验收或发布。
- Codex在此前阶段承担过实现；本次单列S08阶段和证据，本轮没有实现/修复工作。**不声称不同作者独立审查或人类验收。** Browser plugin not available，依frontend-testing-debugging技能使用已有Playwright Electron观察真实本地应用/preload/IPC/原生SQLite。

## 2. 隔离与执行命令

每个UI/首启流程创建独立临时LOCALAPPDATA，只有合成记录；实际目录分别写在各JSON的`localAppData`。业务测试使用其既有临时StorageLayout。没有向真实个人账本灌数据；没有复制真实或合成数据库/附件进仓库。`observe-runtime.mjs`仅为本轮原始观察采集器，不参与产品构建。

既有脚本固定写旧evidence目录，为保留历史材料，本轮复制到evidence/S08，**仅调整输出路径及相对import路径**，断言、数据隔离、操作流程均未改。原脚本SOURCE哈希不变；映射及两份文件哈希见[replay-routing.json](replay-routing.json)。副本JSON的旧`kind: ... not S08 acceptance`原样保留，表示脚本原始用途；本报告记录本轮的独立执行和评价，不冒称新增59项独立设计测试。

下列命令均从项目根目录执行，退出码全部0，详见`logs/`。所有Electron重放前设置：

```powershell
$env:BOOKKEEP_QA_NODE_MODULES='C:\Users\Administrator\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules'
```

| 命令 | 本轮实际结果 | 证据 |
|---|---|---|
| `npm run typecheck` | 三套类型检查通过 | logs/typecheck.log |
| `npm test -- --maxWorkers=2 --reporter=json --outputFile=evidence/S08/unit-results.json` | 21文件181测试通过，0失败 | unit-results.json、logs/test.log |
| `npm run verify:icons` | 42/42 | logs/verify-icons.log |
| `npm run build` | 构建通过，重建5项哈希与冻结前一致 | logs/build.log、postbuild-comparison.json |
| `node evidence/S08/startup-probe.mjs` | 调用既有smokeElectron，首启/重启各28/28 | startup/、logs/startup.log |
| `node evidence/S08/replay-s06.mjs` | 15项真实手工记账流程通过 | manual/ui-workflow.json、logs/manual.log |
| `node evidence/S08/replay-s07.mjs` | 22项统计交互通过 | statistics/ui-workflow.json、logs/statistics.log |
| `node evidence/S08/replay-s06-probes.mjs` | 15项边界/筛选/分页/并发检查通过 | manual-probes/additional-probes.json、logs/manual-probes.log |
| `node evidence/S08/replay-s07-probes.mjs` | 7组检查通过，123个独立整数对照范围，其中15个逐点检查Top3 | statistics-probes/additional-probes.json、logs/statistics-probes.log |
| `node evidence/S08/observe-runtime.mjs` | 原始UI/IPC/SQL采集完成；重复初始化、F02重启、实际当周未来点与审核未实现页 | observation/observations.json、logs/observation.log |
| `node scripts/db-report.mjs --json=evidence/S08/db-report.json --schema=evidence/S08/schema.sql` | 在上行隔离LOCALAPPDATA中执行，schema1、1账本、34分类、quick_check=ok、外键违规0 | db-report.json、schema.sql、logs/db-report.log |

没有安装/升级依赖。首轮冻结时`git ls-files`将中文路径quote，Get-FileHash拒绝后停止，尚未执行被验命令；改用`git -c core.quotepath=false ls-files`完成冻结，保留logs/freeze-attempt1.log。没有产品测试失败被覆盖。

## 3. AC01～AC07逐项结果

本表的“通过”限定本机真实应用自动化、截图观察、IPC/SQLite层；受控时钟场景按FIXTURES执行，不称真实Windows跨夜。扩展人类/双系统项目单列第6节。

| AC / REQ | 子场景、操作与实际 | 状态 | 实际证据 |
|---|---|---|---|
| AC01 / REQ-002/006/030 | 空目录首启仅1个默认账本、CNY/Asia/Shanghai、0交易、34分类；含33参考类+其他，设置为独立导航；重复ensureDefault及真实进程重启不增加账本/分类，epoch/ID稳定；数据库在隔离用户目录 | 通过 | startup/selftest-dev*.json、startup/startup-result.json；observation/observations.json的empty/ensureRepeated/categoryPage，default-categories.png |
| AC02 / REQ-003 | UI录4.80/15/13.50=33.30；编辑后33.50→删15得18.50→恢复33.50→改回33.30；0.01与9,999,999.99保存，空/0/负/科学计数/非数/千分位/3位小数/超上限拒绝，SQL数量不变；SQLite typeof(amount_fen)=integer，UI两位显示 | 通过 | manual/ui-workflow.json；manual-probes/additional-probes.json前4项；calculations.json；observation原始SQL |
| AC03 / REQ-005/008 | 日期倒序分组/星期/折叠；F02未知时间保持null/date并显示时间未记录；已知时间倒序。真实今天/昨天标签；受控上海跨午夜/跨年标签刷新，日期不按24小时替代；闰年/跨年周一始边界 | 通过（含受控时钟） | manual第3/12/15项、manual-probes跨年编辑；unit-results.json S06/S07日期/午夜用例；observation的ledgerText/current.ledgerText及today-yesterday-unknown-time.png |
| AC04 / REQ-004/006/007/030 | UI新增/编辑金额日期分类与其他字段；软删/恢复立即更新；版本冲突输入保留，原mutationId回放不重复；名称/含尾日期/分类AND、多分类OR、字面%及ASCII大小写；分页66条去重/整组小计、游标失效重读；分类改名/停用保留历史额；重启保持 | 通过 | manual15项；manual-probes15项；statistics编辑删除恢复及statistics-probes停用/恢复；unit-results.json恢复/重复恢复用例 |
| AC05 / REQ-008/010 | 周7、平/闰2月28/29、9月30、10月31、年12点；空点0、空排行/日均0；前后/回当前/选择日期；当前未来点空心虚线且无明细，未来周期被拒；历史完整日数/当前含今日及无消费日，年按自然日 | 通过 | statistics22项；unit-results.json F03-L/F；statistics-probes的123范围；observation.current与current-week-future-point.png |
| AC06 / REQ-009 | 9/8前三笔18/16.26/10；9/9为850/55.54/15.50；年9月为前三分类850/55.54/43.50；第四笔8元仍进日总52.26但不进前三，多日同类先聚合；同额全序、少于3项/空点、上方总额含全部 | 通过 | statistics截图day-top3-detail/month-category-top3-detail；statistics-probes第四笔及逐点整数对照；unit-results.json F03-A/S/C |
| AC07-A / REQ-007/009/010 | F02六笔与数据库、明细、周/月/年、排行整数和一致：4426/92104/96530；9月日均32.18，四类85000/5554/4350/1626；重启6笔96530；未照搬948.41 | 通过 | calculations.json；observation.f02/f02Restart完整SQL/DTO；statistics月周年reconciliation；F02-list-96530.png |
| AC07-B / REQ-007 | 正式交易软删不计、恢复仅原笔；编辑/删除/恢复三视图分别97530/11530/97530，与全范围明细一致 | 通过 | statistics第16项、unit-results.json编辑/软删/恢复，原生SQL检查 |
| AC07-C / REQ-007（与AC10关联） | 临时mock返回2候选，SQL仍6笔96530可观察；但无法创建持久化待审99/拒绝88/失败识别任务，审核页明确尚未实现，SQLite无candidate/import_job表。没有凭静态SQL来源或mock推断真实状态隔离 | **未执行：前置缺失** | observation.mock/reviewPage/f02.sql.tables，review-not-implemented.png；schema.sql；BK-S08-001 |
| **AC07整项** | A/B通过，C未执行；遵守ACCEPTANCE“部分通过不能使整条自动通过” | **未执行（部分通过），阻断G1** | 同上 |

## 4. 独立手算与软件/数据库对比

全部用整数分计算，再半入四舍五入显示元。原始SQL包括COUNT、SUM、按日/分类分组及typeof，保存于observation/observations.json；对照公式及实际值见[calculations.json](calculations.json)。

| 数据 | 手算 | 软件与数据库实际 |
|---|---|---|
| F01三笔 | 480+1500+1350=3330分 | 3笔/33.30；真实进程重启SQL3330，逐行1500/480/1350对应正确 |
| F01编辑删恢复 | 3330+20=3350；3350-1500=1850；1850+1500=3350 | UI依次33.50/18.50/33.50，最后改回33.30。未使用旧1830笔误 |
| F02日额 | 1800+1626+1000=4426；85000+5554+1550=92104 | SQL分组/列表44.26与921.04，星期二/三，未知时刻无伪造 |
| F02总额 | 4426+92104=96530 | 初次及重启SQL6笔96530，周/月/年series/summary/ranking一致 |
| F02分类 | 餐饮1800+1000+1550=4350；85000+5554+4350+1626=96530 | 维修850.00、数码55.54、餐饮43.50前三，水果16.26第四 |
| F02历史日均 | 96530÷30=3217.666…分→3218分 | 32.18，分母30；历史周96530÷7=13790分→137.90 |
| F02实际当前年 | 2026-10-21累计294天；96530÷294≈328.333分 | 3.28；T0=10/20业务测试分母293→3.29，未混用日期 |
| F03-A扩展 | 96530+800+2000=99330；9/8总5226；餐饮7150 | SQL8笔99330；第四笔不入Top3，月日均33.11；与F02分开 |
| 实际当前周期独立账本 | 10/20=1000、10/21=2000、10/22=3000、11/1=4000；列表10000，已发生3000 | 当前周7点/3日分母→10.00，月21日→1.43，年294日→0.10；未来4日点0且标尚未到来，10/22真实有未来交易也无已发生详情 |

隔离恢复后才切换数据集，F01/F02/F03/当前周期没有混算。各流程最终扩展额分别为3530、97530、102538、99330等，在对应JSON标明，不能将它们冒称仍是F01/F02原基线。

## 5. 相关界面观察与控制台

真实界面：bookkeep://app/index.html、标题BookKeepAI、非空、无框架报错层；本轮检查的渲染pageerror为0。真实读取响应门控时显示loading、迟到结果不覆盖新周期；错误显示DB_BUSY并可重试，不假显0。断网由context.setOffline(true)模拟，手工和本地统计照常，无真实网络请求。

已查看本轮PNG：F01 33.30、日详情921.04、月前三分类965.30、当前周未来点、候选尚未实现、640×480与200%应用缩放的表单/统计详情。总额在Top3上方、金额完整、分类含文字；小窗口可通过页面/详情内部滚动访问按钮。截图是本机应用渲染捕获，不能称真人桌面操作。

内容视口1280×900、1280×720、640×480与200%应用缩放为定向结果；观察采集器记录devicePixelRatio=1.25。未改变系统缩放或Windows时间。完整系统DPI与应用双重缩放矩阵不据此通过。

控制台仍有既有CSP meta `frame-ancestors`被忽略提示，对应[BK-S07-004](../../issues/BK-S07-004.md) P2交S15；本轮保留原始消息，不称控制台零消息或完整安全通过。

## 6. 未执行、问题与后续

| 项目 | 状态/原因 | 负责人及影响 |
|---|---|---|
| 持久化候选待审/拒绝/失败状态隔离 | 未执行，当前业务前置不存在；临时mock不能替代 | BK-S08-001，Codex退回S07先处理规格/依赖冲突；S10/S11实际实现按后续正式任务安排；本轮阻断G1 |
| 真人鼠标/中文IME输入、读屏、完整系统缩放矩阵 | 未执行，自动化输入与合成IME事件只证明其路径 | 人类后续桌面补验；AC21全项未通过 |
| 真实Windows系统跨午夜 | 未执行；受控renderer/业务时钟测试已通过 | 人类补验实际系统事件，不将受控时钟称实地跨夜 |
| Win11/干净机/正式ZIP中文空格路径解压运行 | 未执行，本轮只有Win10开发构建 | S17/S19对应环境，不能声称双系统兼容或G6 |
| 真实图片API/本地密钥安全配置/识别/审核/CSV/完整附件恢复/数据训练质量 | 不属于本轮已实现基础范围，未执行 | S09～S20按门禁逐步启动，G2～G6保持未通过 |

**结论复核：AC01～06在本轮明确证据层通过；AC07-A/B通过，C未执行；没有新P0/P1产品缺陷；仍有1项G1覆盖阻断，G1未通过。S09不具备开始条件。** 不因181测试或59组交互检查通过而豁免缺失子场景。

下一唯一负责人为Codex，返回S07的验收输入/规格处理轮处理BK-S08-001。先明确G1与后续候选持久化的前置关系；新范围/门禁调整须有人类明确裁定，先更新决策/规格/影响清单，再做必要实现及受影响回归，以新版本回S08复验。当前不越步实现S09/S10/S11、不擅改原AC、不自动向其他聊天发消息。

## 7. 产物、保密与回退

新产物为本目录报告/冻结清单/原始JSON/日志/截图/重放副本及观察采集器、issues/BK-S08-001.md、handoff/S08/HANDOFF.md；只更新执行看板的当前验收状态。逐文件输出SHA256见OUTPUTS.sha256，最终原文件/构建对比见final-check.json。原始看板在before/保留。

证据只有合成交易和临时目录/技术版本；没有真实密钥、完整Authorization头、图片base64、真实个人账本/附件或训练样本。运行时截图通过内存编码后落PNG，没有把base64写入JSON/日志。临时合成数据库留在JSON标明的隔离目录，未清理来源不明文件。

本轮本地接收材料提交可用`git log -1 --format=%H -- handoff/S08/HANDOFF.md`查询；被验代码始终固定47b60fe/ecc9795。若只回退本轮验收材料，先保留当前改动，再审阅本轮文档/证据差异；无需回退产品或真实账本。最终没有本项目后台运行任务。
