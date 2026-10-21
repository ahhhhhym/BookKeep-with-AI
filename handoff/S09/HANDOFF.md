# S09 最小真实图片探针交接

日期：2026-10-21｜执行者：Codex｜结论：**S09实现自测及G2真实图片探针通过**。下一唯一负责人：Codex（S10，等待用户另行启动）。本轮只做S09，没有启动S10，也未执行S08/S17/S19验收或软件打包/发布。

## 输入与版本

已读AGENTS、执行看板、最新S08-R2接收、原S08 HANDOFF、D43/D49、CONTRACTS及开发方案DeepSeek来源；tasks/S09原不存在，本轮建立。S08-R2 OUTPUTS **454/454**匹配，实际HEAD `65d2e16fa316f8a58797a5842942d9b0c1b7916b`，原分支codex/s07-statistics，无项目后台进程。G1按AC01～06、AC07-A/B及基础持久化通过；不要求C提前实现，AC07父项未通过。输入核验见[input-verification](../../evidence/S09/input-verification.json)。

进入时已有D49/S08-R2未提交文件，原样接续，不reset/clean、未自动提交Git；本轮改过的既有规格/状态原字节保存在evidence/S09/before。实现以[SOURCE.sha256](../../evidence/S09/SOURCE.sha256)、[BUILD.sha256](../../evidence/S09/BUILD.sha256)及OUTPUTS清单追溯。原S08-R1/R2证据、S11/S17强制待办保持。未启动或读取DSH凭证/workspace。

## 实现范围与安全边界

- 设置页可保存Windows当前用户绑定加密密钥、仅会话、移除和查看安全状态。safeStorage在主进程使用；加密不可用仅会话，不能明文回退；切换/移除撤掉旧blob，写失败保留原文件/模式/version。存储在`%LOCALAPPDATA%\BookKeepAI\secrets`，不进仓库、数据库备份或应用资源。
- 密码框为瞬时输入ref，进入受限IPC前清空；不入localStorage/React持久状态，已有key不返回UI/掩码/片段。CAS expectedVersion、每分钟5次提交、主进程会话mutationId安全收据，不保存key摘要/payloadHash。界面和底部配置状态同步刷新。JS内存不承诺物理零化，S15继续加固。
- 新受限`provider.probe`只允许固定fixtureId+本次上传/费用同意，无URL/path/key/base64输入能力；重发同mutationId复用同Promise/报告，单在途、无自动重试。只在主进程从本应用安全存储取key；固定HTTPS、redirect=error、90秒超时覆盖正文、响应≤1MiB。导入/队列/候选及业务recognize句柄调度仍在S10，不能将探针当这些功能完成。
- 图为自制无隐私PNG，来源/许可/真值见[assets/probe](../../assets/probe/README.md)。请求文本不含金额/日期/购买物答案，只发图片实际字节、结构提示和必要分类；不上传账本，不入正式交易或数据集。图片SHA256为`0136644513a3a9ebebec66bf893d81c31694f01d95057856190d965b5133d2d8`，960×680，26450字节。
- provider返回先JSON解析、严格bk-candidate.v1校验及归一化，再核对可见字段。报告只含有限安全DTO；字段仅回显与公开合成真值相同部分，自由模型文本不落日志/UI。schema诊断只保留已知字段路径和受控错误码。无原请求/响应、头部、key或图片base64落盘。
- 本会话readiness/能力verified必须绑定同key版本的真实成功报告；重启重新needs_probe。历史G2以本轮真实报告为准，不是mock能力声明，也不承诺每次启动自动发收费请求。

## 真实API与G2

当天官方来源见[OFFICIAL-SOURCES](../../evidence/S09/OFFICIAL-SOURCES.md)。固定base `https://api.deepseek.com`，Chat Completions，model `deepseek-flash`，user.image_url内联PNG，detail=high，response_format=json_object，thinking disabled，max_tokens4096。未测试其它模型/API/参数组合。

用户在应用密码框保存本应用密钥，配置过程中无输入读取/截图/trace；开发探针脚本只看configured/mode/version，再调用同一主进程入口。本轮共**3次真实单请求**，未自动重试：

| 报告id（real-probe-*.json） | 上海时间 | 实测 | 耗时/用量 |
|---|---|---|---|
| d52389ff-6b40-4078-9de1-f81ed50336b9 | 18:21:41～43 | v1，HTTP200，契约失败；首轮未保留结构诊断，原始响应已丢弃，不编造原因 | 1805ms；847+256=1103 |
| 894497e1-d81d-4a11-89b3-d9d955a0be37 | 18:23:23～24 | v1同参数，只补安全诊断；HTTP200，JSON合法/stop，missingFields UNKNOWN_FIELD | 1487ms；847+234=1081 |
| **75e4eb46-1128-4a71-a258-4e10ee51b4ca** | **18:24:30～31** | **v2明确核心缺失字段枚举，HTTP200、schema/归一化通过，三个可见字段匹配** | **1415ms；952+229=1181** |

三次响应model均为**deepseek-flash**；官方更新记录的1017是映射说明，不是本响应返回的内部模型标识。合计3365 tokens，不估算费用。最终成功字段：**3742分（37.42元）、2026-08-19、燕麦饼干**；无精确时刻，不能填导入时间。成功报告：[real-probe-75e4eb46](../../evidence/S09/real-probe-75e4eb46-1128-4a71-a258-4e10ee51b4ca.json)。**G2通过来自实际图片+JSON+schema+真值，非HTTP200、文本请求或mock推断。**

BK-S09-002先登记、补诊断定位、加强提示词后复测关闭；未放宽schema。v1源码快照和两次失败证据保留。real-probe-build.json记录成功调用时构建指纹；后续仅同步设置UI状态，主进程构建hash另复核。

## 自测、命令与复现

指定`C:\Users\Administrator\AppData\Local\Microsoft\WindowsApps\pwsh.exe`直接调用，实际7.6.7 Core；UTF-8。无新依赖/迁移。命令日志、214项结构结果、UI各轮JSON、首启/重启报告均在[evidence/S09](../../evidence/S09)。

| 检查 | 结果与边界 |
|---|---|
| npm run typecheck；npm test -- --maxWorkers=2；npm run build | 退出0；214/214测试、22文件，其中33项S09；42图标/12许可收集与构建通过 |
| node scripts/smoke-s09.mjs | 最终11组真实Electron/IPC/DPAPI操作通过；其中探针按钮等待/错误为明确mock HTTP401，**不计G2**。合成key未出网；跨进程解密只返回布尔 |
| node scripts/selftest-s09.mjs | 隔离合成LOCALAPPDATA，首启/重启各28/28，默认账本/epoch/分类保持 |
| HTTP异常/输出测试 | 401/403/402/400/404/422/429/503、超时/网络/空/坏/截断/超限/schema、诊断防泄漏、同键回放与G2升级条件为mock单测；无真实错误网络实验 |
| 页面QA | bookkeep://app、BookKeepAI、非空、无框架覆盖层；1280×1000及640×600无横向溢出；页面错误0，既有CSP meta提示原BK-S07-004交S15 |

复现开发探针（**会真实收费，不要循环**）：先构建，然后在指定PowerShell7中执行下面命令。Playwright仅为开发诊断依赖；软件运行不依赖Codex/DSH，正常入口为应用“设置→真实图片探针”。

```powershell
Set-Location -LiteralPath 'D:\BookKeep with AI'
$env:BOOKKEEP_QA_NODE_MODULES='C:\Users\Administrator\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules'
node scripts/probe-s09.mjs
```

该命令打开本应用设置页；没有key时等待用户本地输入；已有key时只发送一次固定图。不在参数/环境变量中放key。再次验证必须明确一次新动作；缺key/余额/网络就记失败/未执行，不能引用本次成功掩盖新失败。

## 问题、限制与交出

BK-S09-001（骨架CAS/空白/提交清空及状态刷新）已修复；BK-S09-002（missingFields枚举）已真实复测关闭。第一轮UI采集点击小视口隐藏导航超时，原记录保留，采集器恢复视口后重跑通过，详见[QA](../../evidence/S09/QA.md)。

同一Codex会话实现、修复并自测，未声称不同作者独立审查。单张干净合成图不代表真实业务截图质量/总体准确率；未测试真实余额/401/超时、Win11/干净机、跨用户DPAPI、全DPI/人工IME/读屏、S15安全加固、正式ZIP与发布。当前无S10候选持久化，AC07-C仍“未执行，待S11/G3验证、S17复验”，AC07父项和G3～G6不升级。

产物：tasks/S09.md、D50/CONTRACTS补充、安全存储/transport/probe及受限IPC、设置UI、PNG来源与构建复制、测试/复现脚本、两张问题单、逐次脱敏真实报告、QA/日志和输入/源码/构建/输出哈希。最终状态见final-check.json；无项目后台应用/构建，不自动发其他聊天、提交Git或打包。用户密钥留在本机系统加密配置，未删除。回退先保全现有变更，以本轮before和SOURCE清单审阅，只回退S09源码/状态；不要回退D49/S08-R2或删除个人数据。停用密钥请通过应用“移除密钥”。
