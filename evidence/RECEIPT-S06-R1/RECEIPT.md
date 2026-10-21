# S06-R1 手工记账阶段验收记录

日期：2026-10-21｜接收者：Codex｜结果：**本阶段通过**。

## 范围与固定版本

本次由用户单独发起“验收S06”。仅接收手工支出、日期分组、筛选、软删除/恢复与列表持久化；S07和S08不在本轮实施范围。S06阶段通过不代表AC整项或G1通过。

被验main HEAD：`c431de8b61384062e8967808ff40cec691e906a2`；实现：`fa034a3434fc45089627c4f2745c925c8816c032`。开工无未提交改动、无项目Node/Electron后台进程。旧交接SOURCE144/144、OUTPUTS57/57匹配（input-verification.json）。冻结143项源码/原测试/脚本/配置/资源（FROZEN.sha256），运行结束0差异（frozen-verification.json）；重建五项dist文件与旧BUILD清单逐项相同（BUILD.sha256）。

Codex曾实现并自测该产品，本轮验收阶段、脚本和证据单列；没有不同作者/人类独立审查声明。新增探针只存在本目录，不修改原测试、脚本或被验代码。replay-s06.mjs由原smoke-s06.mjs复制，仅替换相对import、证据输出目录及报告kind；复跑结果与新增检查分列，不把复跑称为新设计测试。

已读AGENTS、执行看板、tasks/S06、S06 HANDOFF、S05 ACCEPTANCE-R2与原HANDOFF，相关开发方案/交接矩阵、PRD、ARCHITECTURE§6/11、CONTRACTS§10、UX§2/3/4、FIXTURES F01/F02、ACCEPTANCE、D44～46及BK-S06-001～003。原历史职责不覆盖当前D43授权。reference图1仅作视觉来源。

## 环境及精确命令

Windows10专业版19045 x64；指定pwsh.exe 7.6.5 Core，UTF-8；Node24.19.0、npm11.17.0；锁定Electron44.9.1、better-sqlite3 13.0.3。本次未安装或升级依赖。命令工作目录均为D:\BookKeep with AI，详见environment.json和commands.json。

| 命令 | 退出码 | 实测 | 证据 |
|---|---|---|---|
| npm run typecheck | 0 | 三套配置通过 | logs/typecheck.log |
| npm run test | 0 | 20文件156项 | logs/test.log |
| npm run verify:icons | 0 | 42/42 | logs/verify-icons.log |
| npm run build | 0 | main/preload/renderer生成，哈希复现 | logs/build.log、BUILD.sha256 |
| node evidence/RECEIPT-S06-R1/startup-probe.mjs | 0 | 隔离LOCALAPPDATA，首启28/28、重启28/28及账本/epoch/34分类幂等 | logs/startup.log、startup-result.json、selftest-dev*.json |
| node evidence/RECEIPT-S06-R1/replay-s06.mjs | 0 | 原15项定向流程全部通过，renderer异常0 | logs/ui-workflow.log、ui-workflow.json、screens/ |
| node evidence/RECEIPT-S06-R1/acceptance-probes.mjs | 0 | 新增15项全部通过，renderer异常0 | logs/additional-probes.log、additional-probes.json、screens-additional/ |

两个UI命令先设置BOOKKEEP_QA_NODE_MODULES为environment.json列明的开发工具node_modules（包含playwright）；产品没有该依赖。测试均启动真实Electron，使用真实受限preload、主进程IPC和原生SQLite；context.setOffline(true)是浏览器网络离线仿真，没有关闭Windows网络。没有key或真实API请求。

## 逐项验收及实际数值

| S06检查/关联AC | 状态 | 实际结果 |
|---|---|---|
| F01金额链路/AC02 | S06层通过 | UI新增4.80/15/13.50，总3330分=33.30；编辑4.80→5.00后3350，删15后1850，恢复3350；改回4.80并真实进程重启仍3笔3330，SQL一致 |
| 无效金额与必填/AC02 | S06层通过 | 空/0/负/三位小数/abc/科学计数/千分位/超上限8种逐项拒绝；名称、分类及日期缺失定位错误且无新增SQL；0.01和9999999.99写入整数分1和999999999 |
| 日期/AC03 | S06层通过 | 日期/星期/跨年组正确；受控renderer时钟跨上海午夜，“今天”变“昨天”；仅日期存null未知时刻；未来2099-01-01未核实时不保存，核实后保存原日期 |
| 编辑删恢复/AC04 | S06层通过 | 原流程金额编辑、取消删除、软删及恢复小计即时变化；新增探针改名称/日期/分类/精确时刻/商户/多行备注均持久回读正确 |
| F02列表及筛选/AC04相关 | S06层通过 | 从隔离空快照加载六笔96530分；09-08为4426、09-09为92104；“午餐”2笔3350；叠加09-09与餐饮得1550；维修+数码90554；ASCII“IPAD”亦90554；字面%无结果；清空回96530 |
| 分页/AC04相关 | S06层通过 | F02明确扩展60笔×100分后102530，第一页50行仍显示09-09整组98104；加载后66个唯一ID、同日1组；中途新增7分使旧cursor失效，重读第一页50行、总102537，再加载67行，无混页 |
| 并发及幂等/AC11子层 | S06层通过 | 真实新增提交应答被闸门延迟/丢失，UI保存中禁用，原mutationId重放replayed=true且仅1笔；新增并发update一个成功、一个VERSION_CONFLICT，原键回放不重复，不升级AI批准幂等整项 |
| 恢复/epoch与旧分类/AC04/16子层 | S06层通过 | 真备份恢复后旧表单保存STALE_EPOCH，输入保留、禁止跨代提交且SQL无旧笔；停用原分类可原样编辑，改名水果后历史categoryId及金额不变 |
| 键盘和视口/AC21子层 | S06层通过 | Ctrl+N/F/Enter、Esc未保存提示、原生dialog焦点限制；640×480关闭抽屉不可Tab进入，1280×720页面无横向溢出；200%应用缩放可滚到保存且矩形完整可见；合成isComposing事件不触发保存 |
| 默认数据/AC01子层 | S06层通过 | 两次28项启动自检，默认账本/epoch稳定、34分类；UI重启保留交易 |

F01复跑最后另加长名/跨年/受控午夜等合成记录为5笔3530分，与3笔3330基线分列。新增probe的金额边界及未来分支执行后恢复空快照才加载F02，未混入六笔96530断言；F02扩展分页后67笔最终102538分（并发修改7→8多1分）。最终quick_check=ok、外键违规0。新增事务ID/创建时间由真实服务生成，没有伪造固定ID，因此F02同日未知时间行遵循真实createdAt全序，不冒充夹具相同createdAt下的指定ID序。

本轮目视查看真实原生截图f01-3330、F02-96530、640×480、200%表单及stale-epoch，并对照图1：日期星期/组总额、分类图标文字、两位小数负金额和细分隔线可读；列表顺序按ARCH全序，不照抄参考图排列。不声明像素级复刻或完整系统缩放兼容。

## 完整AC与门禁边界

| AC | 本轮范围及整项状态 |
|---|---|
| AC01 | 默认/重启自动化子层通过；完整S08仍待验 |
| AC02 | S06手工金额子层通过；S08另轮接收 |
| AC03 | S06日期子层通过；S07周边界、真实系统午夜等待验 |
| AC04 | 列表/CRUD/筛选/关联子层通过；S07统计同步未实现，整项待验 |
| AC05～AC07 | 统计/周期/Top3未执行（S07/S08）；F02列表金额通过不等于统计通过 |
| AC08～AC10 | 真实图片API、候选、审核隔离未执行 |
| AC11 | 手工原键/版本冲突子层通过；AI批准/崩溃并发整项未执行 |
| AC12～AC14 | 重复图/API异常/危险图片未执行；离线手工仅相关子层 |
| AC15 | 已有边界回归/启动隔离自检通过；安全密钥与完整安全验收未执行 |
| AC16 | 基础备份恢复及旧表单栅栏子层通过；CSV/完整附件恢复与故障矩阵未执行 |
| AC17～AC20 | 数据集/训练评测/质量/正式ZIP未执行 |
| AC21 | S06键盘、小屏、应用缩放子层通过；真人IME/读屏/完整系统矩阵及审核等未执行 |
| AC22 | 固定源码/构建/本轮证据可追溯；正式软件/源码ZIP与发布整项未执行 |

S07/S08仍未开始，G1～G6全部未通过。未执行Win11、干净机、软件ZIP解压启动、真人鼠标键盘/IME/读屏、真实系统跨夜和完整系统缩放矩阵。自动化合成IME事件不是安装输入法实测；受控时钟不是Windows时钟实测；开发目录中文空格与临时数据中文空格不是S19干净ZIP路径验收。

## 缺陷、状态与交接

原BK-S06-001正确1850分、002旧epoch拒绝、003关闭抽屉Tab排除本轮相关检查通过，维持关闭；S08仍复核受影响全链路。未发现新P0/P1产品缺陷。

BK-S06-004：docs/ACCEPTANCE AC16残留“S06导出”，与D46/PRD已生效阶段不一致。结束产品冻结检查后，仅同步为S15实现CSV及加固，未改业务规格/被验代码，不要求重建。修改前见before/ACCEPTANCE.md。执行看板与AGENTS仅更新接收状态，原HANDOFF/tasks/自测证据保留。

真实用户LOCALAPPDATA未写合成数据；临时隔离目录见报告JSON，库及备份未复制进证据仓库。无真实图片/训练集/密钥/完整请求头/base64；敏感扫描见sensitive-pattern-check.json。未向任何聊天/外部服务发消息，未安装依赖/启动DSH，未生成正式包、上传或发布。

下一唯一负责人Codex（S07），由用户另步启动。先读取handoff/S06/ACCEPTANCE-R1.md及原HANDOFF§6，核验本轮OUTPUTS与实现版本；统计必须取全量正式未删数据、同scope/epoch/revision/today，不从分页UI累加。S08另轮验完整G1。结束Git/进程与源码复核见final-check.json，新增证据文件清单见OUTPUTS.sha256。
