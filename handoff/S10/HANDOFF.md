# S10 交接：图片、队列与识别草稿

2026-10-21｜Codex｜**实现自测完成，待本阶段单列接收**。同一Codex实现、修复、自测；不声称不同作者独立审查。未执行S11/G3、S17/S19。

起点 `d1dcc337954f2800128a8efb0704770d9d607480`；交付分支 `codex/s10-image-queue`，base为实际默认 `main`，无前置开放PR依赖。实现源码/构建固定清单在 [SOURCE](../../evidence/S10/SOURCE.sha256)、[BUILD](../../evidence/S10/BUILD.sha256)；本轮提交与PR另记[DELIVERY](DELIVERY.md)，避免自引用commit哈希。原有D51规则变更逐字保留，只暂存本轮状态/决策内容。

## 输入已核实

已读AGENTS、执行看板、S09 HANDOFF与最新ACCEPTANCE-R1/G2、CONTRACTS、UX、ARCHITECTURE、相关开发方案/验收以及tasks/S11强制待办。S09源码147/147、构建6/6，最新输出49项中48匹配，唯一AGENTS差异为既存D51规则变更，详见[输入核验](../../evidence/S10/input-verification.json)。历史接收证据和失败证据原样保留。指定PowerShell 7.6.5 Core，UTF-8。

## 本步产物

- schema v2新增image_asset/import_job/candidate，v1原迁移checksum不变；主进程ImageService/RecognitionService、逐项/批次receipt、受限IPC/preload/resource协议。
- 真实选择入口和File拖放、签名/完整解码/10MiB/8192/20图限制、裁剪/不透明遮盖/去元数据、original/prepared SHA256、独立上传快照、原图保留/处理后清理。主进程使用sharp0.35.5，更新锁文件、外部模块及Windows原生依赖/许可包含规则，未打包。
- 持久五态、并发2、90秒/次、最多3次、2/4秒退避及受限Retry-After；只有调度器重试。取消先写generation/requestId栅栏再abort；整图schema校验/规范化/候选落库原子提交，超时/取消后的迟到结果无权写入。
- processing重启failed/INTERRUPTED，queued须重新同意；缺key/离线不影响手工记账。同图默认复用；forceNew理由与新同意，候选出现重复阻断。金额/日期/商品未知null，保留proposal/current/evidence/missing/warnings/模型prompt版本，非支出默认排除，合计/明细歧义阻断。
- 导入/任务/只读候选页面绑定真实操作及持久状态；核对上传图、原图限制、键盘/指针区域编辑、费用确认、真实loading/状态筛选/分页。保留历史无写入的skeleton诊断API兼容既有自检，产品页面已不使用它。

实现前决策/影响清单：[D52实施说明](../../docs/S10-IMPLEMENTATION.md)；任务书：[S10](../../tasks/S10.md)。完整文件集合以本轮git提交和OUTPUTS清单为准。BK-S10-001隐私/异步世代竞态已修复自测；BK-S10-002以显式拒绝防止DB-only静默遗漏附件，完整能力仍交S15。

## 实测结果与边界

详见[QA](../../evidence/S10/QA.md)：typecheck/build退出0，**256/256**自动测试、**16/16** Electron交互/IPC/真实SQLite、首启/重启各**28/28**。真实File WebP、鼠标/键盘裁剪、实际黑色遮盖像素、恶意文本惰性渲染、重复复用、非法JSON、取消竞态、离线3次、重启INTERRUPTED及正式统计不变均有证据；HTTP故障为mock，不冒充真实异常网络。

最终真实DeepSeek一次请求把公开合成PNG识别为 **3742分 / 2026-08-19 / 燕麦饼干**，pending_review真实入库且重启保留、正式0笔，同图复用不二次HTTP。最终主进程SHA256 `1f1ada8d889e87e070c101acbb1d0359beb80bcb5b692c06b102e99116b96294` 与 real-api.json一致；prompt bk-receipt.s10.v1，响应deepseek-flash。全轮3次真实HTTP/5401tokens，之前2次隔离配置准备失败均0HTTP；没有真实错误网络或自动重试实测。密钥仅本机应用加密状态，测试复制文件已清理，未进入项目/日志/PR。

## S11输入与AC07-C

schema/来源关联和SQL见[schema-v2.sql](../../evidence/S10/schema-v2.sql)、[真实持久化前置报告](../../evidence/S10/AC07-C-selftest.json)。`node scripts/fixture-s10.mjs`注入合成provider输出但使用真实生产仓储/SQLite，创建固定正式6笔96530分、待审9900分和failed任务。落库前后及关库重开后，列表/日期小计/周月年序列/排行/日Top3/月分类Top3/日均均不变，绝非临时mock不写库。保留数据的位置在本地忽略文件 `.tmp/S10-LOCAL.json`；数据库/图片不进Git，另一机器先重建。

S11须先接收本步，再按[tasks/S11.md](../../tasks/S11.md)补8800拒绝、9900人工批准、唯一来源/事务审计/并发重试重启幂等；批准后才应7笔106430分、日102004、餐饮14250，并另轮接收/G3验证，S17复验。S10候选只读，未实现拒绝、批准或数据集授权/训练。**AC07-C仍未执行，待S11/G3验证、S17复验；AC07父项和G3～G6未通过。**

## 未执行、风险和交出

未做：S11审核闭环、真实私有消费样本质量/训练、真人OS文件对话框/IME/读屏、完整DPI/Win11/干净机、真实90秒网络故障、完整附件备份/S15加固、最终软件ZIP/Release/发布。当前有附件时旧DB-only备份/恢复明确拒绝，UI已说明；已有无附件备份回归保持。npm audit的8个moderate为开发构建链，交S15；既有CSP meta提示仍保留。不把构建或PR当作阶段验收。

最终未留项目后台应用/构建。合成fixture留在隔离临时目录，原用户数据库与加密配置未用于测试写入。回退应基于本轮提交逐项审阅，先保全实际数据：schema v2用户不得直接运行只识别v1的旧程序；可用迁移前备份在对应旧版本隔离恢复，不能覆盖/删除真实数据。不得回退既有D51工作区变更。

下一唯一负责人：**Codex S10本阶段单列接收**；通过后S11由用户另行启动。本轮按D51提交/推送并创建PR，不合并、不发布、不启动下一步、不向其他聊天发送消息。
