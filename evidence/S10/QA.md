# S10 实现自测

日期：2026-10-21（上海）。执行者 Codex。**实现与自测完成，待本阶段单列接收；不是 S11/G3 或 S17 验收。** 本轮没有不同作者独立审查声明。

## 输入、版本与环境

起点 `d1dcc337954f2800128a8efb0704770d9d607480`；origin `ahhhhhym/BookKeep-with-AI`，远端默认 `main`，开始没有开放 PR。既存 AGENTS/DECISIONS/分步提示词的 D51 变更保留，只暂存 S10 自己的内容。初始状态在 before/git-status.txt，完整既存 diff 仅本地 `.tmp/S10-pre-existing.patch`。

指定 WindowsApps pwsh.exe 实测 7.6.5 Core。S09 SOURCE 147/147、BUILD 6/6 匹配；最新接收 OUTPUTS 49 项中 48 匹配，AGENTS 一项为已知既存 D51 变更（并非篡改冻结实现），详见 input-verification.json。最新通过入口为 handoff/S09/ACCEPTANCE-R1.md，G2 通过；没有以聊天结论代替实物核查。

本机 Windows 10 x64、Electron 44.9.1、SQLite N-API、sharp 0.35.5；现有依赖保持锁定，仅新增图片解码依赖及生产许可/打包包含规则。最终主进程 SHA256：`1f1ada8d889e87e070c101acbb1d0359beb80bcb5b692c06b102e99116b96294`。完整源码/构建清单见 SOURCE.sha256/BUILD.sha256；提交号见 HANDOFF 与 DELIVERY。

## 已执行命令

| 命令 | 实际结果 | 证据边界 |
|---|---|---|
| npm run typecheck | 退出0 | TypeScript 主进程、preload、共享、renderer、tests |
| npm test -- --maxWorkers=2 --reporter=json --outputFile=evidence/S10/tests-final.json | **256/256**，新增42项 | 真实生产 SQLite/迁移/服务层；provider/故障/短时timeout为明确模拟 |
| npm run build | 退出0，42图标，14项许可收集 | Electron/React构建；不是最终软件ZIP或许可发布审核 |
| node scripts/smoke-s10.mjs | **16/16**，页面错误0 | 真实 Electron/preload/IPC/SQLite；HTTP全mock，原生选择器返回值由测试注入，真实File拖放/裁剪键盘与指针/黑色像素已验证 |
| node scripts/selftest-s10.mjs | 首启/重启各 **28/28** | 隔离合成目录，默认账本/epoch/分类保持，原生SQLite加载 |
| node scripts/fixture-s10.mjs | 退出0，AC07-C前置自测通过 | 合成provider输出，**真实持久化SQLite与关库重开**，不是临时mock不写库 |
| node scripts/real-s10.mjs | 最终退出0，真实HTTP **1次**，已落库并重启 | 官方DeepSeek图片+JSON/schema；详见下一节；本命令会产生费用，不循环运行 |
| npm audit --json | 8 moderate，0 high/critical | 全是既有开发/构建链（electron-builder/@electron/get等），不属于新增sharp；待S15审查，未盲目升级依赖 |

最终命令日志在 logs/，测试结构结果与截图在本目录。旧失败和中间通过报告保留，未覆盖历史 S08/S09 证据。首轮8项测试失败来自schema版本/IPC数量断言和迁移测试起点：已明确用v1测试基线保留真实升级与失败恢复测试，没有放宽业务断言。前两轮桌面采集失败为 Playwright main evaluate 无 require/动态import回调，改为主进程 getBuiltinModule，非产品故障；失败 JSON/截图保留。既有 CSP meta frame-ancestors 提示仍交 S15。

## 真实 API 与模拟证据分列

最终真实任务 `c943b267-9302-4258-8d15-5bd94c9f4ad0`，2026-10-21 **22:01:05～07 上海时间**。只发送21204字节prepared PNG及当前启用分类；原图是项目自制无隐私PNG，源SHA256 `0136644513a3a9ebebec66bf893d81c31694f01d95057856190d965b5133d2d8`，处理SHA256 `93b1be421672810225a3977eeb63a350185525e47ff93e62c647dff173e12034`。

官方 `https://api.deepseek.com/chat/completions`，请求/实际响应 `deepseek-flash`，prompt `bk-receipt.s10.v1`、schema `bk-candidate.v1`；一次实际请求，1540输入/251输出=**1791 tokens**。字段 **3742分 / 2026-08-19 / 燕麦饼干**均匹配，候选 `d4d8b7dc-1dfc-44f9-8c9c-51a2a01faeeb` 为pending_review，来源关联/quick_check/外键有效，正式账本0笔0分，同图复用未二次出网，真实进程重启后仍存在。最终报告 real-api.json 带同一主进程hash。

本轮合计 **3次真实请求**（初始链路1793 tokens、清理复核1817 tokens、最终构建1791 tokens，共5401 tokens；前两次报告分别为 real-api-r3-passed.json / real-api-r4-passed.json），没有真实失败HTTP或真实自动重试。之前2次隔离配置准备失败均为0次HTTP：仅复制加密blob不足以解密，补齐本应用自身的同用户OSCrypt Local State后成功；未读取/打印明文key。隔离测试只在系统临时目录复制本应用加密状态，全部测试复制的密钥文件与Local State已清除，原用户配置未动。

并发2、15ms注入timeout/取消迟到、401/余额/非法JSON/1MiB响应/离线等故障由单测或mock HTTP执行，不冒充真实90秒网络故障或准确率评测。单张清晰合成图不代表真实消费截图质量、模型训练或达到准确率目标。[官方Vision](https://api-docs.deepseek.com/guides/vision/)及[Chat Completions](https://api-docs.deepseek.com/api/create-chat-completion/)本轮复核；像素处理依据[sharp constructor](https://sharp.pixelplumbing.com/api-constructor/)与[metadata](https://sharp.pixelplumbing.com/api-input/)。

## AC07-C：真实持久前置与正式统计隔离

`AC07-C-selftest.json` 对同一生产 schema v2 写入：六笔固定正式交易96530分、**一笔9900分 pending_review**、一个 `failed/OUTPUT_SCHEMA_INVALID` 任务；候选→任务→图片/hash为真实外键关联。`schema-v2.sql`从实际sqlite_master导出，SQL与查询结果都在报告中。

持久化前、后、关库重开后：列表6笔96530分；日期小计4426/92104；周/月/年series、summary、排行、日Top3、年9月分类Top3和日均均相同。9月日均32.18元；待审/失败影响为0。这个结果来自真实落库和查询对照。另有16组桌面链路，实际进程重启前后也是6笔96530分，原生SQL quick_check=ok、外键0。

可重建合成fixture的命令为 `node scripts/fixture-s10.mjs`，保留的本地数据路径在忽略文件 `.tmp/S10-LOCAL.json`，没有数据库进Git。S11应先核实哈希/ID或重新生成，再实现8800候选的拒绝、9900的人工批准及增量；本轮没实现这些动作，也没关闭 AC07-C/G3 强制待办。

## 限制与下一轮

S10只读草稿，S11补字段编辑/逐项确认/reviewDigest/重复处置、拒绝/重开、ReviewEvent、原子幂等批准及失败回滚。AC07-C最终仍 **未执行，待S11/G3验证、S17复验**；AC07父项和G3～G6不升级。先S10单列接收，通过后S11由用户另行启动。

有附件时DB-only备份/恢复明确拒绝，S15要做完整附件档案及恢复；详情 BK-S10-002。8项开发依赖moderate、CSP提示及进一步安全/性能加固交S15。真人原生文件选择器/IME/读屏、真实网络90秒异常、Win11/干净机、完整系统DPI、最终ZIP/Release/发布未执行。本轮没有生成或上传应用ZIP，没有自动合并或发送其他聊天。

OUTPUTS中的AGENTS.md与docs/DECISIONS.md按本步已提交版本记录；本地仍存在用户进入前的D51规则差异。接收时用Git对象复核这两项，不覆盖本地D51内容。终端日志保留原CRLF及末尾空行；差异检查以cr-at-eol且忽略日志EOF空行为准。
