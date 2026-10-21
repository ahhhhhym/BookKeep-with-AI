# S08-R2 基础功能复验记录

日期：2026-10-21｜执行者：Codex｜目录：D:\BookKeep with AI。

**结论：按现行D49，G1通过。AC01～AC06、AC07-A/B及相关基础持久化均有本轮真实通过证据，无基础链路阻断缺陷。AC07-C为“未执行，待S11/G3验证、S17复验”；AC07父项未通过。** BK-S08-001复核关闭仅解除原验收前置冲突。S09的G1前置已满足，本轮未启动S09；后续由用户另行启动。

## 固定版本、输入和执行者边界

- 实际HEAD：`65d2e16fa316f8a58797a5842942d9b0c1b7916b`，分支`codex/s07-statistics`。它是本轮工作区基线，不冒称HEAD为47b60fe。产品与S08-R1被验`47b60fe503c38e05497e0252879587f2dfc6d5bc`和S07实现`ecc97950b62cf6eb71dddc69c15039e2374f6ed0`逐文件无差异；历史三提交均为HEAD祖先。D49未提交文档按本轮INPUTS/FROZEN-D49固定版本。
- 首先显式启动`C:\Users\Administrator\AppData\Local\Microsoft\WindowsApps\pwsh.exe`，其自身7.6.7 Core，实际进程`C:\Program Files\WindowsApps\Microsoft.PowerShell_7.6.7.0_x64__8wekyb3d8bbwe\pwsh.exe`。工具shell参数另落7.6.5，因此任务脚本均再通过指定路径直接调用，未用powershell.exe。UTF-8。详见[freeze](freeze.json)与各命令记录。
- Windows10专业版10.0.19045 x64；Node24.19.0/npm11.17.0；Electron44.9.1、Chromium152.0.7977.167、Electron Node24.22.0、ABI149；app0.1.0/schema1/bookkeep.v1。实际上海日期2026-10-21；未改Windows系统时间。
- 已核对AGENTS/看板/tasks S08、方案/交接规范、PRD/ACCEPTANCE/FIXTURES/DECISIONS D49、相关ARCHITECTURE/CONTRACTS/UX；S04～S07原交接及最新通过接收、S07返工REVIEW/input-verification/final-check/OUTPUTS/before、S08原交接/报告/freeze/final-check/OUTPUTS及问题单，S11/S17 C强制登记。关键33项文件哈希见[INPUTS](INPUTS.sha256)。
- S07 SOURCE150/150、BUILD5/5；D49 OUTPUTS41/41；旧S08 OUTPUTS143/143。旧清单的看板/问题单合法差异用S07返工before验证原哈希，当前文件哈希亦记录，不重算旧清单。S04原130项、S05原74项、S06 SOURCE144项均在对应不可变Git对象核验。首次S05采集错误选29f0a51修复提交，改为原清单所属e20badf4后74/74；原失败记录不删除，见[input-resolution](input-resolution.json)。
- 初始13项已修改文档及原未跟踪返工材料来自D49，逐项OUTPUTS匹配；本轮新增preflight属于自身采集器。全部保留，无reset/clean或覆盖未知变更。原750项跟踪文件及D49新增材料、产品、5项构建产物分别冻结；开始没有项目后台进程，无其他写入Agent。最终差异分类见[final-check](final-check.json)。
- Codex此前参与实现；本轮为独立阶段及独立证据，**不声称不同作者独立审查或真人验收**。本轮只写验收采集器/证据/接收与当前状态。未改产品、原测试、原脚本、资源、依赖、锁文件、迁移和验收口径。

## 本轮命令及实际结果

入口均由指定pwsh.exe的`-NoLogo -NoProfile -File`直接执行；[command-results](command-results.json)、[additional-commands](additional-commands.json)、[d49-command-run3](d49-command-run3.json)、[supplemental-command](supplemental-command.json)、[final-commands](final-commands.json)记录参数、起止时间与退出码。失败和恢复见[采集问题记录](ISSUES.md)。

| 检查/命令 | 本轮实际 | 原始证据 |
|---|---|---|
| npm run typecheck | 退出0，三套配置 | logs/typecheck.log |
| npm test -- --maxWorkers=2 --reporter=json --outputFile=evidence/S08-R2/unit-results.json | 21文件181/181，0失败 | unit-results.json、logs/tests.log |
| npm run verify:icons / npm run build | 42/42，均退出0；5构建文件前后相同 | logs/icons.log、logs/build.log、final-check.json |
| startup-probe.mjs | 首启/重启各28/28，1默认账本/34类/epoch与generation保持 | startup/startup-result.json、logs/startup.log |
| replay-s06.mjs | 15/15真实Electron手工流程 | manual/ui-workflow.json、manual/screens |
| replay-s07.mjs（纠正路由后） | 22/22真实Electron统计流程 | statistics/ui-workflow.json、statistics/screens、logs/statistics-reroute.log |
| replay-s06-probes.mjs | 15/15金额/筛选/分页/并发等 | manual-probes/additional-probes.json |
| replay-s07-probes.mjs | 7组通过，123整数范围对照，15范围逐个有效点Top3 | statistics-probes/additional-probes.json |
| d49-probes-run3.mjs | 29组通过，9独立环境、25快照、75周/月/年范围、563次IPC记录、17次进程启动 | d49/run3/results.json、logs/d49-run3.log |
| supplemental-probes.mjs | 13组通过，5独立环境、10快照、30范围、217次IPC、10次启动 | supplemental/results.json、logs/supplemental.log |
| visual-review.mjs / scripts/db-report.mjs | 退出0，只读观察既有合成数据 | visual/review.json、db-report.json、schema.sql |

这些是本轮实跑数量，不把历史数字直接复制为通过。重放脚本保留原kind说明其来源用途，本报告评价当轮结果，不将重放组数说成新设计的独立用例数。只做输出路由变更，见[replay-routing](replay-routing.json)与[routing-incident](routing-incident.json)最终修正diff；所有原断言保持。未安装或升级依赖，未构建正式ZIP。

## 逐AC与必需子场景

下表“通过”指本机真实Electron UI、受限preload/IPC、原生SQLite及明确标注的受控时钟层。后期人类/系统项目在后表逐项保留。完整操作/请求响应/SQL/手算在对应JSON，不以截图或构建单独代替功能。

| 项目 | 操作与期望 | 本轮实际/状态 | 证据（本目录相对路径） |
|---|---|---|---|
| AC01 首启与默认项 | 空目录首启；重复初始化、退出重开 | **通过**：仅1默认账本，CNY/Asia/Shanghai，34类无设置分类；设置独立导航；ID/分类不重复 | startup；d49/run3/results.json AC01分支，AC01-34-categories.png；每快照SQL ledgers/categories |
| AC02 三笔及增删改恢复 | F01独立3笔480+1500+1350；编辑3350、删1850、恢复3350、改回3330重启 | **通过**：全程UI/SQL整数与周/月/年同范围一致，最终3笔3330；日均与分母独立计算 | manual/ui-workflow.json；d49/run3/results.json F01的5快照及PNG |
| AC02 边界和无效输入 | 各自空环境录0.01和9999999.99；8非法文本拒绝 | **通过**：独立1笔1分/999999999分并重启；空、0、负、3位小数、abc、科学计数、千分位、超限均定位错误，原F02仍6笔96530；无舍入写库 | supplemental/results.json minimum/maximum/invalid分支；各输入/错误截图；manual-probes前4组；SQL typeof全部integer |
| AC03 日期与精度 | 日期分组/星期/跨年/已知未知排序/折叠，真实今天昨天；受控跨午夜 | **通过（受控时钟与实际日期分列）**：F02星期二/三、未知null/date，F01已知19:00/18:00/12:00倒序；组折叠不改总额；实际10/21今天、10/20昨天；受控跨年午夜刷新通过 | manual第3/12/15组、manual-probes跨年编辑；d49 actual-current SQL与ledgerText；unit-results S06/S07午夜/闰年/跨年；真实系统跨夜未执行 |
| AC04 CRUD与查询 | 新增/编辑所有字段、软删/恢复、组合筛选、分类、多页、冲突、持久化 | **通过**：全字段保存正确；AND含尾日期、分类OR、字面%/_、ASCII搜索；66条UI分页不漏重、跨页组小计全额、游标失效重读；并发CAS只成功一次/旧version拒绝；原幂等键回放不多记；恢复旧epoch表单被拒 | manual15组、manual-probes15组；d49五个F03-I-B独立分支与重启 |
| AC04 分类改名停用 | 改餐饮为用餐、停用，新建不可选，原编辑/恢复保留，其他受保护 | **通过**：原3笔cat_food关联/4350不变，F02仍96530；新建无停用类，旧编辑保存/原交易恢复成功；保护其他返回拒绝 | d49/run3 F03-I-B-category及SQL/IPC/PNG；statistics-probes停用/筛选；重启快照 |
| AC05 完整周期与空未来 | 周7、月28/29/30/31、年12；零点/未来、切换、日均 | **通过**：真实UI选择闰/平2月、跨年周和前后/回当前；空点0/空排行；未来周期/点被拒且UI尚未到来无Top3；历史自然日数、当前含今天/无消费日分母正确 | statistics22组；statistics-probes123范围；unit-results F03-L/F/午夜；d49 current周/月/年及future详情 |
| AC06 日交易/月分类Top3 | F02日Top3、年9月聚合；第四笔/并列/不足3/空点 | **通过**：9/8为18/16.26/10，9/9为850/55.54/15.50；月为维修850/数码55.54/餐饮43.50；第四笔8元计入52.26仍不列前三；同额已知时刻/id与分类id全序正确；1/2/0项正常 | statistics/screens/day-top3-detail.png、month-category-top3-detail.png；statistics-probes第四笔；supplemental F03-S/C及visual；unit-results并列/空项；d49各scope.details |
| AC07-A 固定六笔 | F02独立，列表/日额/周月年/排行/Top3/日均/重启 | **通过**：4426/92104/96530；85000/5554/4350/1626；9月30日均32.18、周7日均137.90；实际当前年294日均3.28；重启仍6笔96530 | d49/run3 F02两快照，全部SQL/原始IPC/独立算法；F02-baseline-list/month/year PNG；statistics月周年对照 |
| AC07-B 已删隔离 | 独立重装F02，再添加并软删T24110000分 | **通过**：正式仍6笔96530，删除集合独立1笔10000；列表及各统计不混入；重启相同 | d49/run3 F03-I-B-T241三快照及deletedList |
| AC07-B 删恢复重复恢复 | 独立重装F02，软删T00485000，恢复再重复 | **通过**：96530→11530→96530→96530，重启仍96530；重复新请求STATE_CONFLICT/NOT_DELETED，金额/数量不变，符合既有契约 | d49/run3 F03-I-B-delete-restore五快照/IPC/SQL/PNG；unit-results相应回归 |
| AC07-B 编辑版本冲突 | 独立重装F02，T0061550→2000，旧version改回 | **通过**：总96980、9/9=92554、餐饮4800；旧version返回VERSION_CONFLICT且仍96980，重启相同；75范围包含每次变更后所有三视图/排行/Top3/日均 | d49/run3 F03-I-B-edit四快照、old-version请求响应、F03-I-B-edit-edited-list.png |
| 基础持久化 | 每环境单账本、整数SQL、完整性/外键、重启与恢复 | **通过**：各快照integrity_check/quick_check=ok、foreign_key_check空，typeof(amount_fen)=integer；真实进程重启、真实备份恢复新epoch；数据在仓库外 | d49/run3及supplemental全部sql与launches；db-report/schema；startup；manual/statistics-probes恢复 |
| AC07-C | 真实持久化待审/拒绝/failed、人工批准增量及原子幂等 | **未执行，待S11/G3验证、S17复验**。未调用C业务、伪建表或用诊断mock推定隔离；S11/S17原待办字节及未勾选状态保留 | tasks/S11.md、tasks/S17.md（仓库根相对）；final-check.json任务哈希；D49 |
| AC07父项 | A/B/C均真实通过才通过 | **未通过（A/B通过，C未执行）**，与G1独立记录 | 本表、result-summary.json |

注：F02实际主进程生成UUID及createdAt，FIXTURES中的T编号由aliases映射，未伪造业务ID/创建时刻。同日未知时刻列表按真实createdAt倒序；不把视觉列表顺序误当按金额的Top3。F03-S的固定createdAt差异排序由既有真实SQLite业务测试覆盖；补充UI分支使用真实创建时序并按实际ID核对并列。

## 整数复算和隔离路径

独立复算明细见[calculations](calculations.json)、[isolation](isolation.json)；数据库/附件始终留在绝对临时LOCALAPPDATA路径，各F01/F02/F03主分支独立装载。F03扩展不与96530基线混算；边界最小与最大分别独立空库。旧重放脚本的复合场景通过专属备份恢复空快照后才装F02，原标签保留。业务测试使用原有专属StorageLayout。

| 分支 | 手算及本轮一致结果（分） |
|---|---|
| F01 | 480+1500+1350=3330；+20=3350；-1500=1850；+1500=3350；-20=3330，重启3笔 |
| F02 | 1800+1626+1000=4426；85000+5554+1550=92104；合96530；分类85000+5554+4350+1626=96530 |
| F02日均 | 96530/30分→32.18元；/7→137.90；实际10/21当前年/294→3.28，T0旧293只用于明确受控业务测试 |
| F03-I-B | 96530-85000=11530；恢复96530，重复不增；1550→2000增450，总96980，日92554，餐饮4800 |
| F03-A | 96530+800+2000=99330；9/8=5226但第四800不列Top3，餐饮7150；旧重放该分支有独立scope |
| F03-S/C | 五笔同额合5000/Top3合3000但总5000；分类并列6000，总含第四水果1000，前三cat_books/cat_study/cat_food |
| 实际当前 | 昨1000+今2000+明3000+下月4000=列表10000；只已到来3000，周/月/年分母3/21/294，日均10.00/1.43/0.10 |

## 未执行项、影响与补验步骤

| 项目 | 原因和本轮G1影响 | 下一负责人及可操作步骤 |
|---|---|---|
| AC07-C完整持久化/批准 | S10/S11未实现，D49移至后续，不阻断本轮G1；AC07父项未通过 | Codex S10/S11先实现真实存储/审核；用户启动后S11/G3按C-0～4执行，再S17冻结重新验；待办未关闭 |
| 真人中文IME/读屏/鼠标键盘完整体验 | 本轮自动化键盘/合成IME及图像观察，无法替代真人，属AC21后期，不阻断已明确基础范围 | 人类S17/S19在真实微软拼音输入/候选选择、NVDA或系统读屏下走新增编辑/筛选/图点流程，记录版本/录屏/读出结果 |
| 真实Windows跨午夜/焦点事件 | 无真实跨夜时间窗；受控渲染及业务时钟有本轮通过证据，未称系统级通过 | 人类S17保持今天/昨天与当前统计到上海23:59→00:01，记录前后日期/日均，切走再聚焦重读 |
| 完整系统DPI矩阵 | 仅内容视口1280×720/1280×900/640×480、200%应用缩放定向结果；未改系统DPI | 人类S17/S19按UX矩阵100/125/150/200%系统DPI与应用缩放分别验表单/图点/滚动/按钮可达 |
| Win11/干净机/正式ZIP | 本轮Win10开发构建；S18未正式打包；不构成基础研发门G1的包验收 | Codex S18在G5后构建可追溯ZIP；人类S19 Win10/11干净机中文空格路径解压，核对SHA256、首启重启/离线/SQLite/数据目录 |
| 真实API/密钥/识图、审核/CSV/完整附件恢复/训练质量/发布 | 本轮未实施S09～S20，不推定G2～G6或正式发布 | 用户另步启动对应步骤；G2须真实图片探针；G3/G5须C；人类最终决定发布 |

既有[BK-S07-004](../../issues/BK-S07-004.md) P2 CSP meta frame-ancestors提示仍留S15；它没有使本轮基础流程失效，不声明控制台零消息或安全门通过。新增采集器pageerror为0；所有新业务必需断言完成。没有新增产品金额/日期/统计/丢失/自动入账阻断缺陷。

## 历史字节、采集失败与交出

完整事件见[ISSUES](ISSUES.md)：包含S05历史ref选择错误、统计副本输出路由遗漏、D49文件写入UNKNOWN、重复恢复的采集器预期错误。日志/JSON/截图和各运行子目录全部保留。统计路由遗漏曾暂时覆盖旧S08的ui-workflow.json；先保全新结果，再以冻结哈希验证HEAD原blob逐字节恢复，脚本自动生成的原文件备份移到R2保全；纠正副本路由后重跑22项。**不声称本轮从未写入旧目录**；最终所有历史S08与旧HANDOFF原字节相同，无新增路径遗留，未重算旧清单。该采集错误没有进入产品或成为业务缺陷；最终结果使用本轮独立正确路由的运行。

最终仅更新当前看板/状态入口和BK-S08-001，先保存修改前字节于before；D49原OUTPUTS不改，预期状态差异在final-check中映射到本轮before。冻结规格的验收定义不变；DECISIONS/FIXTURES/任务及ARCH/CONTRACTS/UX原字节保持。全部产品/原测试/脚本/依赖/迁移/资源及5构建哈希相同。

输出[OUTPUTS.sha256](OUTPUTS.sha256)排除清单自身及其随后生成的output-verification回执，避免循环哈希；覆盖其余本轮证据、交接和更新状态文件。回执另记录清单自身SHA256及逐项核验，见[output-verification](output-verification.json)；验收前后文件和进程在[final-check](final-check.json)。本轮没有DB/附件/密钥/图片base64落仓库，无真实个人账本写入，合成临时库保留供复核，无来源不明清理；有限敏感模式检查不能替代S19完整审计。

下一唯一负责人：**Codex（S09，等待用户另行启动）**。本轮停止应用/构建，无运行任务，不发消息到其他聊天，不发布软件。接收交接见[ACCEPTANCE-R2](../../handoff/S08/ACCEPTANCE-R2.md)。本轮未自动提交Git；HEAD保持65d2e16，文档版本以输出SHA256追溯。若回退本轮状态，先保全后续改动，再审阅before和差异逐项恢复状态材料；产品及个人账本不需要回退。
