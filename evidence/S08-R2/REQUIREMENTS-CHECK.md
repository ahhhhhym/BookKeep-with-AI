# 用户任务逐条完成复核

本表在所有业务执行及最终冻结哈希检查后编写。实际结论G1通过，AC07父项未通过，C未执行。Codex曾参与实现，本轮阶段/证据单列，无不同作者独立审查声明。

| 要求 | 完成情况与证据 |
|---|---|
| 指定pwsh直接启动、自身版本/Edition/真实路径、UTF-8 | freeze及各execute/run脚本；7.6.7 Core；不只依赖工具shell参数 |
| 必读输入/历史版本/来源核对 | INPUTS33项；input-verification、input-resolution；实际HEAD65d2e16完整commit，47b60fe/ecc9795产品相同 |
| S04～S07/返工/旧S08清单核验 | 历史对象130/74/144；S07 SOURCE150/BUILD5；D49 OUTPUTS41；旧S08 OUTPUTS143。旧看板/问题单按返工before，不改旧清单 |
| 既有未提交改动保留、单写入、停止后台 | freeze初始Git/来源；final-check原750跟踪项、D49新增项/6个状态文档差异分类；无reset/clean、无其他Agent或项目进程 |
| 固定产品/测试/脚本/依赖/锁/迁移/构建/D49哈希 | FROZEN系列、INPUTS及final-check；150产品项/5构建相同，D49的状态变更按本轮before复核41项原清单，验收定义不改 |
| F01/F02/F03隔离/单默认账本/外部DB绝对路径 | isolation.json；main9+supplemental5独立环境；旧重放含原专属空快照恢复；无DB/附件/密钥入仓库 |
| AC01首启、34分类、设置、重复初始化/重启 | startup28+28；d49 AC01分支与分类PNG、SQL |
| AC02金额/边界/无效不改总额 | F01五快照、supplemental独立min/max/8无效输入截图和SQL；本轮181测试 |
| AC03日期/星期/未知/排序/折叠/跨年 | manual15组、d49 actual-current、supplemental F03-S、业务测试受控时钟；真实Windows跨夜未执行，单列后期补验 |
| AC04CRUD/搜索/改名停用/版本/分页/重启 | manual-probes15组及d49五个F03-I-B独立分支；旧version拒绝，相关UI/SQL/IPC |
| AC05完整周月年/补0/未来/周期/日均 | statistics22组、123范围、main75+supplemental30范围；实际10/21分母3/21/294，T0受控293不混用 |
| AC06日交易Top3/月分类Top3/第四/并列/少于3/空 | 原真实UI重放、F03-A/S/C/独立整数oracle、visual阅读；每月点先聚合后Top3 |
| AC07-A六笔完整同源与重启 | d49 F02基线/重启各列表+三视图快照；96530/4426/92104、分类85000/5554/4350/1626，9月32.18 |
| AC07-B真实正式交易分支 | T241已删10000不入正式；T004删11530/恢复96530/重复拒绝不增；T00620元总96980/日92554/餐饮4800，旧version拒绝；每分支重启 |
| C及父项状态/强制待办不关闭 | final-check tasks/S11/S17原哈希及openCheckboxes；C未执行/父项未通过；未伪建候选表或将mock作为C证据 |
| 工程类型检查/回归/构建/首启/重启/Electron | command-results及各日志有起止/退出码；181/181，28+28，59既有组和29+13补充组；非沿用历史结果 |
| UI前后/受限IPC/SQLite/独立手算/完整性 | d49/run3和supplemental的35状态快照/105范围/780次IPC；各快照SQL绝对路径、readonly查询、integrity/quick/外键/整数类型；相应PNG、calculations及重启 |
| 历史脚本副本仅改输出/必要相对引用 | replay-routing与routing-incident最终diff；原脚本前后不变；没有弱化原断言 |
| 所有失败留证、不边修产品边验 | ISSUES、attempt1-routing、d49首轮/run2、日志/失败PNG；均为采集问题，按既有契约更正本轮新采集器，产品/原测试零修改 |
| 历史S08/HANDOFF原字节 | final-check历史556项相同。曾发生路由误写，保全新数据后用冻结验证的Git字节恢复，并正确路由重跑；原清单未重算，事件不隐瞒 |
| 人类/系统/Win11/ZIP边界 | ACCEPTANCE未执行表给原因、G1影响、下一负责人和具体补验步骤；不将受控时钟/合成IME/模拟离线/截图等冒称真人/完整系统证据 |
| G1非凭无新增P0/P1放行 | AC01～06/A/B逐项真实通过及基础持久化无阻断，C待办保留，才判G1通过；BK-S08-001只关闭原前置冲突 |
| 当前状态入口/看板/问题单更新且先快照 | before保存6份原字节；当前6文档只改状态，不改验收定义；R1历史结论保留，D49旧清单差异映射到before |
| 输出哈希/运行状态/下一负责人 | OUTPUTS及其核验回执；final-check无项目进程；handoff/S08/ACCEPTANCE-R2；下一唯一负责人Codex S09等待用户另行启动 |
| 不越步/不调用真实图API/不发消息/不发布 | 本轮只验收与证据状态更新；S09未启动，G2～G6未通过，无其他聊天工具消息/发布/真实图片请求 |

该复核不新增产品测试；收尾阶段仅生成文档/哈希并校验文件，没有再次修改或运行产品构建。
