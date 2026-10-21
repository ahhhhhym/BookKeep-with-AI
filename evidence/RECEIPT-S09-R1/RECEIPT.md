# S09-R1 单列验收报告

日期：2026-10-21（Asia/Shanghai）｜执行者：Codex｜用户指令：验收S09。

**结论：S09本阶段接收通过，G2通过。** 本轮真实图片报告为 `868b8828-537c-4e51-b0e3-473d9abad53c`。AC08在S09/G2范围通过，S17须复验；AC13/AC15仅本阶段安全配置及错误子层通过，整项仍待后续任务和验收。AC07-C仍“未执行，待S11/G3验证、S17复验”，AC07父项未通过。S10未启动，G3～G6未通过，不生成正式软件ZIP或发布。

## 版本和前置

- 指定WindowsApps `pwsh.exe`已直接验证为7.6.7 Core；UTF-8。Windows10专业版10.0.19045 x64，Node24.19.0/npm11.17.0；Electron44.9.1，内置Node24.22.0，ABI149，应用0.1.0、bookkeep.v1/schema1。环境见windows.json与startup.json。
- HEAD `65d2e16fa316f8a58797a5842942d9b0c1b7916b`，分支codex/s07-statistics。S09源码尚未提交Git，必须结合文件清单追溯，不能把HEAD当作已包含S09代码的提交。
- 阅读AGENTS、执行看板、tasks/S09、S09 HANDOFF、最新S08-R2接收及相关方案/契约/架构/PRD/UX/验收/决策。G1有既有S08-R2真实证据；D49的S11/S17待办保持开放。
- 开始无项目Electron/Node后台进程；原工作区未提交变更保留。固定1294项原有文件；S09 SOURCE **147/147**、BUILD **6/6**、OUTPUTS **79/79**现场全部匹配。见input-verification.json、INPUTS.sha256和SOURCE/BUILD-before.sha256。
- 主进程SHA256：`6b8e888c7984fde5b17baf45e8a22187bdc075fcf51bd7a616650643a60a4408`。与原成功探针real-probe-build.json及本轮重建一致；其余六项构建清单同样前后核对。
- 验收期间不修改产品代码、原测试、原脚本、锁文件、依赖或迁移；新增采集器仅放本轮证据目录。状态文档的修改前字节在before中，旧S09/S08证据与清单不重写。

## 逐项结果

| 需求/验收层 | 实际操作与结果 | 本轮证据与结论 |
|---|---|---|
| REQ-013/029，AC08/G2 | 设置页勾选上传及费用同意，按钮发起一次实际Chat Completions；图片字节hash、JSON、schema及三个可见字段通过 | real-probe-868b8828*.json、real-acceptance-*.json、real-success.png；S09范围通过 |
| REQ-021，AC15安全入口 | 密码框提交在主进程响应返回前清空；Windows safeStorage真实加密，重启同用户可解密（仅合成密钥且只输出布尔）；状态无密钥 | ui-selftest-*.json，11组复跑全通过；单测模拟不可加密时只会话，无明文回退 |
| REQ-021，配置恢复 | 旧version拒绝；移除撤销磁盘blob；切会话不保存明文/旧加密key，重启失效；保存/加密/换名失败保留原状态 | 真实UI/IPC与214单测分层通过；故障注入属于mock，不称真实系统故障 |
| REQ-022，受限IPC | 经真实preload传入缺上传同意、缺费用同意、错误fixture及额外URL/path/key均拒绝；无密钥请求数0；mock provider不提升deepseek状态 | isolated-acceptance-*最终成功14组，isolated.log；通过 |
| REQ-013/020，重复收费防护 | 单在途，不同mutation并发STATE_CONFLICT；同mutation并发及完成后重放复用同报告。真实请求重放后fetch总计仍1 | 并发为mock HTTP；真实成功重放另有实时计数；通过 |
| REQ-007/022，不直接入账 | 隔离mock与真实探针前后全部8张业务表行数和逐表内容hash一致；重启后同样一致；quick_check=ok，外键0 | 两份acceptance JSON；通过。当前尚无S10候选/job表，不能代替AC07-C |
| REQ-013/020，AC13错误子层 | 无密钥零请求；真实Electron UI的mock401错误与真实pending绑定；401/403/402/400/404/422/429/503、网络/超时/空/截断/超限/schema等单测通过 | ui.log、unit-results.json；只有mock错误证据，完整任务恢复/取消等待S10/S15/S17 |
| REQ-021/022，日志与数据边界 | 审阅存储/transport/probe/preload数据流：主进程取本应用key，固定HTTPS、禁止重定向、90秒覆盖正文、1MiB响应限制；只存受限报告，未知正文丢弃；扫描无key样式/base64长串命中 | sensitive-scan.json；启发式扫描和定向审阅，不称完整安全审计 |
| 回归/构建 | typecheck退出0，214/214测试；22个测试文件（JSON按describe汇总65 suites）；42图标/12许可/build退出0；首启/重启各28/28 | typecheck/build/unit/startup日志及JSON；通过。重建6产物与原清单相同 |
| 页面/小视口 | bookkeep://app、BookKeepAI、非空、无覆盖层；1280×1000与640×600无横向溢出，页面错误0 | UI JSON和三张隔离截图；真实成功界面已人工式视觉复核（Codex看图），不是人类操作验收 |

### 本轮真实API

上海时间 **2026-10-21 18:39:51～18:39:53**，HTTP200，耗时**1565ms**；requested/actualModel均为**deepseek-flash**，prompt=`bk-prompt.v2-s09`，schema=`bk-candidate.v1`。用量**952+252=1204 tokens**，不估算费用。本轮只发送**1次**，无自动重试。

PNG为内置自制无隐私图，960×680，26450字节，SHA256 `0136644513a3a9ebebec66bf893d81c31694f01d95057856190d965b5133d2d8`。本轮视觉核对图片：实付37.42元、支付日期2026-08-19、购买物燕麦饼干；返回**3742分、2026-08-19、燕麦饼干**，schemaValid=true、三个matches=true、passed=true。无精确时刻，不补导入时间。

采集器在主进程对原fetch作透传计数，只提取固定参数、图片长度/hash及请求文本是否含真值的布尔，不保存headers、key、请求正文或编码。真实请求仍调用原fetch而非mock响应。请求文本无金额/日期/购买物答案，未含ledgerId；本轮调用正常生产ProbeService/transport及用户已配置安全存储。采集器未读取/导出密钥或加密blob。

为验证完成后重放，采集器仅在运行时将真实IPC请求的mutationId绑定为同一UUID，原真实event、发送者校验、载荷校验及业务handler均保留；重放未第二次HTTP。并发错误的实验在隔离环境使用mock HTTP，明确不计G2。上述运行时观测不修改磁盘上的被验代码。

本轮ready/verified绑定868b8828报告，关闭重开后needs_probe/unverified，未自动发新请求。历史75e4eb46成功及v1两次失败保留原字节，不拿旧成功替代本轮实测。单图探针通过不证明业务截图总体准确率或模型训练。

### 官方资料现场复核

2026-10-21现场读取[DeepSeek Vision](https://api-docs.deepseek.com/guides/vision/)确认用户图像块/内联图；[JSON Output](https://api-docs.deepseek.com/guides/json_mode/)确认json_object及结构提示要求。实际组合以本轮真实响应为依据，不推定其它模型/API/参数组合。

[Electron safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage)说明Windows同步接口基于DPAPI、按用户保护；同用户其他应用不在该保证内。本轮仅同Windows用户跨进程重启，跨用户/跨设备未执行。已锁Electron的同步接口可用，本轮不升级依赖。

## 问题和证据保全

- 原BK-S09-001：本轮DPAPI/提交清空/CAS/重启/会话/移除检查通过。原BK-S09-002：本轮同v2严格schema再次真实通过。原问题单与实现证据保持字节，不改写成验收作者的实现。
- 新BK-S09-003（P2状态文档冲突）：README/开始阅读/验收计划当前入口仍写S09未开始、G2未通过。仅同步当前状态及历史边界后关闭；不变更业务契约/AC要求。
- 新采集器前两轮失败：Playwright Electron main evaluate中的require/动态import不适用，网络观测包装器提前异常，导致并发断言无法拿到预期冲突。均在隔离合成环境、无真实网络；两份失败JSON与isolated-attempt1/2.log保留。改为Node全局Web Crypto计算hash，并等待实际handler调用后再切换mutationId；只修本轮采集器，最终14组通过。产品和原测试未修改。
- 读取时曾查询不存在的router/active路径及Windows通配搜索失败，随后按rg实存文件完成定向审阅；属于阅读命令错误，未影响源码/数据或G2结论。
- 真实key仍留在本应用系统加密存储中，未读取到聊天/仓库，未移除。需要停用可用设置中的“移除密钥”。未将个人DB复制进证据，快照只包含行数和hash。

## 未执行和交出

未执行：真实401/余额不足/超时/断网收费实验；真实系统加密不可用/跨用户DPAPI；Win11/干净机、全系统DPI、真人IME/读屏；S10导入队列/任务与候选持久化、S11审核幂等及AC07-C；S15完整加固、S17全候选、S19正式ZIP。既有BK-S07-004 P2 CSP meta提示交S15；本轮未发现新的S09产品P0/P1或未解决的本阶段阻断问题。

Codex此前承担S09实现与自测，本轮另由Codex在固定文件版本上单列验收，阶段和证据独立；不声称不同作者或人类独立审查。原交接是实现自测，新增handoff/S09/ACCEPTANCE-R1.md为本轮接收；两者分开保留。

只更新验收报告、当前状态入口和新状态问题单，未改产品或原交接；无提交/重置Git、无新应用ZIP、无发布、无向其他聊天发消息。最终源码/构建/历史证据不变和无后台进程以final-check.json为准，新增输出见OUTPUTS.sha256。下一唯一负责人：**Codex S10，等待用户另行启动**。
