# BookKeepAI 架构与数据字典

2026-10-20职责变更（DECISIONS D43）：S01～S05已通过对应阶段接收，S06～S20全部由Codex负责，包括编程、测试、修复、验收和打包。DSH仅保留S04/S05历史归属；旧文档中的后续DSH指派由D43覆盖。历史阶段的“本次/未执行/待验收”描述保留当时证据边界，当前进度以执行看板及S05-R2接收记录为准。业务/接口口径不因本次分工调整改变。

版本：S02-1.2（含hash基准澄清）｜日期：2026-10-20｜负责人：Codex｜状态：原S02已接收；S05-R2阶段复验通过，限制见§11及RECEIPT-S05-R2

本文件是规范性文字，不是运行时schema、SQL、源码或实现证明。输入为开发方案v1.0、S01-1.0 PRD/ACCEPTANCE及S01交接；S01接收结论见[接收记录](../evidence/S02/S01-RECEIPT.md)。接口以[CONTRACTS](CONTRACTS.md)为准，细化理由及影响见[DECISIONS](DECISIONS.md)。S04/S05历史实现归属保留；后续依赖维护、数据库DDL、校验器、自动化测试及构建由Codex实现。

## 1. 组件职责与信任边界

| 组件 | 唯一职责/输入输出 | 禁止事项/实现步骤 |
|---|---|---|
| Electron主进程 | 单实例/数据目录锁、启动及迁移、IPC身份和载荷校验、业务事务、附件、系统加密、HTTP、备份恢复、任务调度；返回受限DTO | 不把凭证、完整请求头、图片base64、任意路径或原始provider文本返回UI；S04骨架、S05持久化、S09/10/11业务 |
| 受限preload | 每个白名单操作一个类型化入口，传递普通数据、脱敏错误；只订阅明确的进度事件 | 不暴露ipcRenderer/send/invoke本体、Node、SQL、shell、任意channel/文件/URL；S04 |
| React渲染 | 表单、日期分组、筛选、图表呈现、原图证据与候选并排、人工确认；UI内存状态 | 关闭nodeIntegration，开启contextIsolation和sandbox；不直接读DB/文件/密钥，不做最终金额/状态裁定；密码输入例外见§8 |
| TypeScript | Codex接续实现各层编译期类型及受限DTO；运行时仍双端校验且主进程最终负责 | 类型断言不能替代不可信模型/IPC校验；S04～S13 |
| SQLite仓储 | 主进程唯一写入边界、外键/检查/唯一约束、事务、版本条件写入、迁移；正式交易为统计唯一事实源 | 不由renderer直连、不将图表缓存当账本；better-sqlite3为建议，版本/ABI由S04核实 |
| 统计服务 | 同一筛选语义和只读快照计算小计、序列、总额、日均、排行与Top3 | ECharts只画已计算点/提示，不在UI重算另一套排序或金额；S07 |
| provider适配器 | 主进程内把已授权预处理图片与分类转换为外部请求，映射脱敏错误；输出本项目规范化结果 | 无数据库入账权、无文件任意访问、无模型工具执行权、不得全量上传账本；DeepSeek/mock必须标来源 |
| 审核服务 | 唯一AI转正式交易入口；执行§5原子事务和幂等规则 | 识别完成、schema正确、高置信度均不触发入账；S11 |
| 数据/评测服务 | 独立同意、标签版本、导出清单、分组锁test和可复现评测；训练submit首版unsupported | 不自动把候选/参考图纳入数据集；S12规范、S13实现 |

调用流：UI → preload白名单 → 主进程鉴权/校验 → 业务服务 → 仓储或provider → DTO。截图及模型输出始终是数据。窗口仅加载打包本地资源；拒绝外部导航、新窗口、远端脚本及非白名单网络请求。CSP不允许执行模型/名称/证据中的HTML；图表标签按文本渲染，不插入不可信HTML。附件由主进程只读资源协议按assetId和variant授权，校验规范化路径/类型/大小，不接受UI提供磁盘路径。

首版Windows 10/11 x64，Vite/Electron/React/TypeScript/SQLite/ECharts作为架构选择，S04核对官方支持、锁依赖、验证Electron与原生SQLite ABI和ZIP冒烟；本文件不承诺某个尚未验证版本能运行。DSH不是运行依赖。默认单写入Agent；本次没有启动DSH。

## 2. 通用数据域（全部实体和接口共同遵守）

| 域 | 类型/nullable/规则 |
|---|---|
| Id | 非空字符串；主进程生成UUID v4小写。Category允许S03定义的系统稳定ASCII ID（1～64字符）；外键必须存在且同账本。模型不能生成数据库ID |
| Row | 可变实体统一有id:Id、version:整数1～2,147,483,647、createdAt:Instant、updatedAt:Instant，均非null；创建version=1，每次成功改变实体+1，失败/幂等回放不加；上限拒绝VERSION_EXHAUSTED。以下表“Row”表示继承全部四字段，不省略nullable规则 |
| AppendRow | 追加不改实体有id:Id、createdAt:Instant，非null；无version/updatedAt。修正以新增事件/版本实现，不覆写历史 |
| Instant | 非空UTC字符串，固定YYYY-MM-DDTHH:mm:ss.SSSZ，主进程时钟生成；不是交易发生时间。时间倒退时排序仍由稳定ID打破并列 |
| Date | 有效公历YYYY-MM-DD；业务日期1900-01-01～9998-12-31，账本时区Asia/Shanghai。范围末端允许9999-01-01仅作exclusive end；不作为交易日期 |
| Time/precision | occurredTime为HH:mm或null；timePrecision仅unknown/date/minute。unknown：date和time皆null（只限候选）；date：有效日期且time=null；minute：有效日期且有效time。缺年份/部分时间只留证据，不拼接今天/导入时间 |
| 单笔Money | amountFen为整数1～999,999,999（0.01～9,999,999.99元），正式非null，候选可null；CNY支出正值。IPC整数不能是字符串/浮点/NaN；用户金额文本仅允许无千分位十进制正数最多2位小数，精确换算，不舍入接受3位小数 |
| 汇总MoneyTotal | SQLite有符号64位安全范围0～9,223,372,036,854,775,807分，运算检查溢出；跨IPC/文件用十进制数字字符串（含0，无前导零）。主进程精确整数累计，renderer用精确十进制格式化；超限AMOUNT_TOTAL_OVERFLOW，不近似、不截断 |
| 文本 | 长度按Unicode码点；保存前NFC、首尾空白去除，空可选文本转null；拒绝NUL及除备注/证据内换行Tab外的控制字符。name交易1～100、商户1～100可null、分类名1～20、账本名1～40、备注0～500可null；图标key 1～64 ASCII白名单 |
| 列表/结构 | 缺少必需键是格式错误，nullable未知值显式null；空数组为[]。补丁中省略表示不改，null表示清空且须字段可空。禁止未知键、原型相关键及任意嵌套对象；模型输出限制见CONTRACTS§7 |
| Hash/VersionTag | SHA-256小写64位十六进制字符串；schema/prompt/provider/dataset版本为1～64 ASCII标识，首版契约版本bookkeep.v1、候选schema bk-candidate.v1；不等同Row.version或DB schemaVersion |
| 布尔/枚举 | IPC为真布尔，不接受0/1字符串；SQLite映射由Codex维护/实现；枚举严格白名单，未知状态拒绝而不默认为成功 |

交易有效日期范围允许已明确的未来日期，不自动改为今天；当前统计只取截至今天的已到来范围，未来记录仍可在日期筛选列表/CSV找到。不得因此把未来日期的候选直接认定已发生，人工须明确核实日期。UI提示“所选日期在未来，当前周期统计尚不计入”，由S03固化。

## 3. 实体字典、关系与约束

表内“非空”即不可null；“可空”即显式null。JSON结构只代表逻辑存储域，Codex负责后续正式表/JSON校验与索引实现。

### 3.1 Ledger、Category、Transaction

| 实体 | 字段（除Row外） | 约束及索引 |
|---|---|---|
| Ledger（Row） | name:Text40非空；currency:枚举CNY非空；timezone:枚举Asia/Shanghai非空；defaultKey:枚举default非空；dataRevision:非负安全整数；datasetRevision:非负安全整数 | defaultKey唯一，首版只一账本；初始化和初始分类同事务，不能仅一半。dataRevision对交易/分类/候选/任务等可见业务变更+1，datasetRevision对授权/标签/划分变更+1；每事务各加一次，不接受UI写值 |
| Category（Row） | ledgerId:Id非空；name:Text20非空；iconKey:Key64非空；sortOrder:整数0～999999非空；enabled:bool非空；systemKey:Key64可空 | 同账本规范化名称唯一（NFC+首尾去空白+ASCII小写），停用也占名；(ledgerId,systemKey)非null时唯一；索引ledgerId/enabled/sortOrder/id。系统“其他”不可停用，初始33及其他ID/图标S03固化；不提供物理删除 |
| Transaction（Row） | ledgerId:Id；amountFen:Money；currency:CNY；occurredDate:Date；occurredTime:Time可空；timePrecision:date/minute；name:Text100；categoryId:Id；merchant:Text100可空；note:Text500可空；source:manual/ai；sourceCandidateId:Id可空；deletedAt:Instant可空 | 未标可空均非空；source=manual时候选关联必须null，source=ai必须非null且唯一（包含软删记录）；外键RESTRICT，不级联删。索引(ledgerId,deletedAt,occurredDate,id)、(ledgerId,categoryId,deletedAt,occurredDate)。版本条件更新；禁止后改source/sourceCandidateId/ledgerId/createdAt |

分类停用后历史交易、分类排行仍展示该类别；历史编辑若categoryId未改可保留停用类，新增/改选/AI批准只能选enabled=true分类。恢复软删交易可保留原停用分类。分类改名/图标不改旧交易金额，当前名称用于列表/统计；审计差异保存当时值。首版无需分类迁移接口，采用停用方案即可满足旧关联；如以后增加批量迁移，须先补契约。

### 3.2 ImageAsset、ImportJob、候选与审计

| 实体 | 字段（除Row外） | 约束及索引 |
|---|---|---|
| ImageAsset（Row） | ledgerId:Id非空；originalHash:Hash非空；originalRef:受限相对引用可空；preparedHash:Hash可空；preparedRef:受限引用可空；mime:jpeg/png/webp非空；width,height:整数1～8192非空；byteSize:整数1～10,485,760非空；preparedMime/width/height/byteSize:同域可空；retention:keep_original/prepared_only非空；deletedAt:Instant可空 | originalHash描述实际导入内容，默认保留本地原图供审核；prepared_only为显式隐私选择，删除原文件后originalRef=null但哈希仍留。prepared四字段与hash/ref同时全有或全null；上传仅prepared。索引ledgerId/originalHash及ledgerId/preparedHash（非唯一，以支持人工区分真实两笔） |
| ImportJob（Row） | ledgerId,imageAssetId:Id非空；status:queued/processing/completed/failed/cancelled；generation:整数≥1；attempt:整数0～3；totalAttempts:非负安全整数；provider:deepseek/mock；model:Key64；promptVersion:VersionTag；outputSchemaVersion:bk-candidate.v1；preparedHash:Hash；categorySnapshot:分类id/name数组；uploadConsentId:Id；requestId:Id可空；providerRequestId:Text128可空；actualModel:Text128可空；errorCode:错误枚举可空；startedAt/finishedAt/nextAttemptAt:Instant可空；retryOfJobId:Id可空；duplicateReason:Text500可空 | 未标可空均非空。类别快照≤500启用类，只含id/name；模型实际标识不能用配置名冒充。generation/attempt/fence见§4；(id,generation,attempt)请求唯一。job引用不可变预处理版本；队列索引(status,nextAttemptAt,createdAt,id)、(imageAssetId,preparedHash)。cancelled不再提交候选 |
| Candidate（Row） | ledgerId,jobId,imageAssetId:Id；ordinal:整数0～99；proposal:Proposal不可变；current:EditableFields；missingFields:字段枚举数组；warnings:Warning数组；warningResolutions:处理对象数组（code/field/reason/atVersion/inputDigest，最多50项）；duplicateMatches:重复对象数组；duplicateResolution:unresolved/distinct/duplicate/none；resolutionNote:Text500可空；reviewState:pending_review/approved/rejected；postedTransactionId:Id可空 | 未标可空均非空。UNIQUE(jobId,ordinal)，postedTransactionId非null唯一；候选和job/图同账本；索引(ledgerId,reviewState,createdAt,id)。Proposal/current/证据详见CONTRACTS§7；missing/warnings由主进程派生，不能由UI伪造清空。approved当且仅当关联一笔sourceCandidateId=本id的交易（软删后仍成立） |
| ReviewEvent（AppendRow） | ledgerId:Id；candidateId:Id；action:update/approve/reject/reopen/resolve_duplicate/resolve_warning；actor:local_user；beforeVersion/afterVersion:整数≥1；diff:字段前后值数组；transactionId:Id可空；mutationId:Id；reason:Text500可空 | 未标可空均非空；索引candidateId/createdAt/id；同一批准只一approve事件（candidateId+action=approve唯一）。diff每项field固定白名单、before/after按字段域可null；不含图片字节、密钥或provider整段原文 |
| AuditEvent（AppendRow） | ledgerId:Id；entityType:ledger/category/transaction/image/job/settings/backup/dataset/evaluation；entityId:Id可空；action:Key64；actor:local_user/system；diff:受限前后值数组；mutationId:Id可空；reason:Text500可空 | 未标可空均非空；索引entityType/entityId/createdAt；记录手工CRUD、重试/取消、同图强制区分、备份恢复及授权变更；secret仅记模式变化，绝不记前后值。失败不写成功事件 |

prepared文件不可原地覆盖。有job引用时image.prepare生成新asset版本/新Id，旧job保留旧图、哈希和证据坐标；候选显示对应旧图，不能悄悄换底图。删除image仅允许无job、候选、dataset引用且无在途上传；否则IMAGE_IN_USE。不得为解除引用删除正式交易或审计。隐私撤回不自动删除账本事实，见§8。

### 3.3 数据集、评测和支撑记录

| 实体 | 字段及nullable | 索引/生命周期 |
|---|---|---|
| ConsentRecord（AppendRow） | ledgerId,imageAssetId:Id非空；dataEpoch:Id非空；purpose:recognition/dataset非空；decision:grant/withdraw非空；scope:本图+预处理hash或数据用途的受限对象非空；supersedesId:Id可空；noticeVersion:VersionTag非空 | 索引(imageAssetId,purpose,createdAt,id)；同图/purpose仅一个初始null根，非null supersedesId唯一；事务要求supersedesId等于当前链头，冲突拒绝。当前授权取链头且grant的epoch必须为当前epoch，避免时钟倒退或恢复旧备份复活grant；每次HTTP/导出复核。不同purpose互不替代，不承诺收回已发数据 |
| DatasetSample（Row） | ledgerId,imageAssetId:Id；kind:synthetic/real；predictionJobId:Id可空；prediction:Proposal数组；labels:Proposal数组可空；licenseStatus:unconfirmed/allowed/denied；licenseNote:Text500可空；consentId:Id可空；redactionStatus:unreviewed/approved/rejected；annotator/reviewer:Text64可空；reviewStatus:unlabelled/labelled/reviewed；split:unassigned/train/dev/test；duplicateGroup:Id；schemaVersion:bk-candidate.v1；datasetVersionId:Id可空；withdrawnAt:Instant可空 | 未标可空均非空。样本不因审核自动创建；索引imageAssetId、duplicateGroup、split/withdrawnAt；一个图可有标签新版本但活动样本唯一；reviewed要求labels（可为空数组表示确定无交易）、annotator/reviewer非null、独立数据许可有效；test锁定后原版本只读 |
| DatasetVersion（AppendRow） | ledgerId:Id；tag:VersionTag；schemaVersion:VersionTag；manifestHash:Hash；sampleVersions:sampleId/version数组；sampleSnapshots:对应样本的不可变完整字段快照（含labels/prediction/许可/图片hash，不含图片字节）；groupSplits:groupId/split数组；testLocked:bool；parentVersionId:Id可空 | 未标可空均非空；tag同账本唯一；引用不可变快照，一group只一split；后改活动样本不得覆写旧快照。撤回使相关版本不可再导出/评测，创建剔除后的新版本，不改旧清单冒充原哈希 |
| EvaluationRun（Row） | ledgerId,datasetVersionId:Id；status:五态同job；provider:deepseek/mock；model,promptVersion,outputSchemaVersion:VersionTag；actualModels:Text128数组；providerConfigSummary:安全白名单对象；sampleCount,processedCount,failedCount:非负安全整数；kindCounts:synthetic/real计数；metrics:Metric数组可空；usage:Usage可空；startedAt/finishedAt:Instant可空；errorCode:错误码可空；reportRef:受限引用可空；seed:整数0～2,147,483,647 | 未标可空均非空。索引datasetVersionId/createdAt及status；0≤processed+failed≤sampleCount；实际调用每次留模型标识。Metric={key:Key64,numerator:非负整数,denominator:非负整数,value:十进制字符串或null,scene:Key64,kind:real/synthetic}，分母0时value=null；S12固化各指标语义，未固化返回SPEC_NOT_READY不猜分母 |
| EvaluationSampleResult（AppendRow） | runId,sampleId:Id；sampleVersion:正整数；kind:synthetic/real；status:completed/failed；prediction:Proposal数组可空；actualModel:Text128可空；errorCode:错误码可空；durationMs:非负安全整数；usage:Usage可空；resultHash:Hash | 其他非空；UNIQUE(runId,sampleId,sampleVersion)；completed的prediction非null（可[]），failed必须errorCode非null；只保留规范化输出。cancel后迟到不追加，已有部分结果仅partial报告，不能充当全量质量报告 |
| MutationReceipt（AppendRow） | ledgerId:Id；operation:Key64；mutationId:Id；payloadHash:Hash；resultType:Key64；resultIds:Id数组；resultSnapshot:脱敏结果对象 | 均非空；UNIQUE(ledgerId,operation,mutationId)。业务事务同提交，包含原version/revision；恢复后改变dataEpoch，旧请求不可重放；不储存secret载荷或哈希。结果有限、无图片字节 |
| AppMeta（单例） | id固定app；dbSchemaVersion:整数≥1；contractVersion:bookkeep.v1；dataEpoch:Id；activeGeneration:Id；migrationState:clean/migrating/recovery_required；lastMigrationId:Id可空 | 未标可空均非空；单例；用于IPC世代、恢复切换与启动门禁；schema版本非Row.version |
| MigrationRecord（AppendRow） | fromVersion/toVersion:正整数；appVersion:VersionTag；checksum:Hash；status:completed/failed；backupId:Id；errorCode:可空错误码 | 其余非空；toVersion的completed唯一；开始/崩溃恢复由AppMeta与磁盘切换日志控制；失败记录写在已回滚旧库的独立诊断位置，不破坏旧库 |
| BackupRecord（Row） | ledgerId:Id；kind:manual/pre_migration/pre_restore；status:五态；manifestVersion:固定bk-backup.v1；dbSchemaVersion:正整数；appVersion:VersionTag；archiveHash:Hash可空；archiveRef:受限引用可空；errorCode:可空错误码；finishedAt:Instant可空 | 其他非空；成功要求hash/ref/finishedAt非null。索引createdAt/id；档案不把自身包含进去形成循环；清单以备份时快照为准 |
| AISettings（Row，固定单例） | provider:deepseek；model:固定deepseek-flash；promptVersion:VersionTag；secretMode:absent/encrypted/session；secretRef:主进程内部引用可空 | 其他非空。session/absent时磁盘secretRef=null；configured由实际可解密性派生，不信任旧flag；secretMode/session运行态退出清除。secretRef/ciphertext不在UI DTO或通用备份 |

Usage非空时：inputTokens/outputTokens为非负安全整数或null、costAmount为非负精确十进制字符串或null、costCurrency为币种字符串或null；提供商未返回的不填0、不推算费用。providerConfigSummary仅含providerId、endpointProfile、model、timeoutMs、prompt/schema版本；不含header、key、图片、账本。数据集授权/标签管理补充操作见CONTRACTS§6，S12细化流程而非重定底层域。

通用上限：所有未单列上限的计数（含attempt累计、revision、样本数）均为0～9,007,199,254,740,991安全整数，递增溢出拒绝COUNTER_EXHAUSTED；generation为1～同上限。引用字符串/版本均应用§2域；schemaVersion、manifestVersion、promptVersion分开保存，不能把模型别名作为不可变版本。count不传浮点。真实调用质量报告的分母只能来自已固定指标规范，不能因计数域已定义便自行发明指标。

DatasetSample.labels沿用Proposal业务域，只有人工标签的Evidence.source允许human，此时text必填（说明人工真值依据），region可null；模型输出仍只能image。DatasetVersion创建时快照化整份样本，不靠可变行的旧version号恢复旧标签。Sample复核通过及版本发布必须再次核对当前授权；同意撤回优先于任何旧快照中的grant。

所有外键启用校验；启动/恢复执行引用与业务不变量检查。实体主键唯一；实体间循环关联候选/交易由同事务延迟校验或等效约束实现，Codex须证明不存在半关联。默认不物理清除交易/候选/审核事件。审计是本地操作记录，不声称防系统管理员篡改。

warningResolutions.atVersion为处理时写入后的Candidate.version，只供追溯；有效性由inputDigest绑定该warning涉及的字段/证据/组成员状态，后续无关warning处理不使先前有效处理全部失效。inputDigest为主进程SHA-256，客户端不能指定；任何相关字段、重复集合或组成员状态变化重新派生blocking，不沿用旧resolved。

## 4. 两套状态机、队列与取消栅栏

| ImportJob原状态 | 允许动作→新状态 | 同事务效果/禁止 |
|---|---|---|
| 新建 | start→queued | 固定asset/hash/provider/prompt/schema/分类快照/本图识图同意，attempt=0；无候选 |
| queued | 调度→processing；cancel→cancelled | 每图最多一个活跃job（显式真实第二次除外），全局并发2。实际请求前attempt+1、totalAttempts+1、requestId换新；写入后才发网络 |
| processing | 有效整份结果→completed | 在事务中重新验证status、generation、requestId、授权有效及schema；写全部候选+job completed+revision。任何一候选结构坏整图失败，不部分写入 |
| processing | 临时错误且attempt<3→queued | 记录error/nextAttemptAt，保留本generation；退避第一次2秒、第二次4秒；服务端合法Retry-After可更长但单次≤60秒。真实调度时钟，仅等候提示，不伪装识别进度 |
| processing | 非重试错误/次数耗尽→failed | finishedAt/errorCode非null，无候选；DB提交失败全部回滚，不能保留“已完成”标志 |
| queued/processing | cancel→cancelled | 先原子改变状态、generation+1（失效所有在途响应），finishedAt、审计；再尽力abort网络。取消不保证不计费，不把abort成功当唯一防线 |
| failed/cancelled | retry→queued | 必须用户明确重试和费用提示，同一job generation+1、attempt=0、清错误/时间，固定原图快照；重新取得上传同意，旧generation永远失效 |
| completed | cancel/retry均不改变 | cancel返回STATE_CONFLICT；重跑须显式新job+原因+费用/重复制约，不能覆写原候选 |

单次请求90秒，最多两次自动重试即每generation最多3次实际发送；内部provider不再重试，避免乘法请求。processing重启统一转failed/INTERRUPTED、generation+1，queued保留待调度但在下次上传前恢复同意提示；session key丢失则等用户输入。未知是否已收费的请求不自动续发。超时先使requestId失效，后中止；迟到响应不生成候选，日志仅记录“丢弃”与ID。

任务字段互约束：新queued的requestId/startedAt/finishedAt/nextAttemptAt/errorCode均null；退避queued保留最后错误和nextAttemptAt，requestId失效为null；processing的requestId/startedAt非null、finishedAt/nextAttemptAt/errorCode=null；startedAt表示本次真实请求开始，不是导入时刻。completed的finishedAt非null且errorCode=null；failed的finishedAt/errorCode非null；cancelled的finishedAt非null/errorCode=CANCELLED，requestId失效。每次retry重置本generation的时间/错误字段，totalAttempts不清零；可信实际provider标识仅有真实响应才填。

取消与完成竞争以DB事务先提交者为准：取消先提交则任何迟到结果无写入权；完成先提交则cancel明确冲突，候选保留待审，不自动拒绝或入账。取消按job整图，不影响其他图；completed允许candidates=[]并显示“未找到可确认支出”，不伪造一条空交易。失败和取消后无孤儿候选。

| Candidate原状态 | 动作→结果 | 规则 |
|---|---|---|
| pending_review | update/处理重复→pending_review | expectedVersion匹配，保存current/派生校验/ReviewEvent，version+1；原proposal与证据不可改 |
| pending_review | approve→approved | §5同事务生成一笔；非支出/疑点未处理/字段缺失不可批准 |
| pending_review | reject→rejected | 原子写状态/原因及事件，无正式交易 |
| rejected | reopen→pending_review | candidate.update的显式reopen动作，必须reason/version，保留原拒绝记录，重新算校验 |
| approved | 重发同一批准→已入账结果 | 不创建、恢复或修改交易；编辑走transaction.update；软删交易不能再次批准制造替身，恢复走transaction.restore |

“稍后”不改候选状态；无后台自动批准。拒绝不是物理删除；批准不能撤回到待审，避免破坏唯一来源。未来若要重建交易应新范围决策。

EvaluationRun同样queued→processing→completed/failed/cancelled；每图规范化结果持久化并累计真实processed/failed计数，全部已尝试且汇总成功才completed（允许有失败样本，但必须分列数量/原因）；基础设施/授权/规范错误可令整run failed，不把部分报告写成完整质量结论。cancel/撤回先持久失效run generation栅栏再abort，已经记录的部分结果可作为partial证据但不再改为completed；重启processing变failed/INTERRUPTED，需显式新evaluation.run（新mutationId并提示费用）才能重跑。run另有generation:正安全整数和partial:bool非空，遵守job栅栏规则；processedCount指成功图数，failedCount指已失败图数，二者不重复。

## 5. 批准的事务和并发语义

批准请求携带candidateId、expectedVersion、人工逐笔确认金额/日期/名称/分类的确认集合、重复/风险处理结果、mutationId及dataEpoch。主进程不能相信UI标记“有效”。

1. 校验调用身份、epoch/幂等键。相同操作+mutationId且载荷相同先返回原结果；载荷不同报IDEMPOTENCY_CONFLICT。候选若已approved，独立于旧expectedVersion返回既有transaction关联及alreadyApproved=true，不再次恢复软删记录；传入改值不偷偷应用。
2. 在同一写事务读取候选/job/账本/分类和最新疑似重复匹配；仅completed job的pending_review可入账。核对expectedVersion、完整合法current、分类启用、支出状态已人工核实、每个blocking warning已按规定解决。重复匹配集合变化则REVIEW_STALE，要求重新看后确认。
3. 以sourceCandidateId唯一约束插入正式Transaction（source=ai），同笔更新Candidate为approved并绑定transactionId、version+1；插入唯一approve ReviewEvent及MutationReceipt，dataRevision+1。任一步失败所有变更回滚，不仅回滚交易。
4. commit后发变更事件再刷新列表/统计。commit成功但响应丢失，重发同键或按候选状态读回既有结果；崩溃重启不重复。唯一约束竞争失败后重读关联返回既有结果；若关联不完整报INTEGRITY_ERROR并阻止写入，不能补插第二笔掩盖损坏。

候选/交易编辑同样要求expectedVersion条件写入，0行则VERSION_CONFLICT；失败返回安全currentVersion，UI重读后让用户复核，不自动覆盖。多实例被数据目录排他锁禁止，但仍须测试同一实例并发IPC。

批量批准是candidate.approve的batch模式，最多100笔：preview阶段主进程筛选eligible（缺字段、blocking/duplicate未解决、非pending皆排除），返回精确ID/version/复核快照token、条数、totalFen字符串和排除原因。用户看清后commit仅提交这批及token，不自动添加新候选。commit重新校验全部成员及revision/重复集合；任一变化整批REVIEW_STALE，0笔入账，重新preview。全部合格时一个事务、每笔一个唯一关联/approve事件；整批全成功或全回滚。并发中的单笔先批准会使batch token失效；单笔重发幂等结果不改变batch条数。

手工transaction.create没有候选id输入；renderer不能把source改ai绕过审核。所有影响统计的mutation成功后更新dataRevision。渲染仅接受commit后的通知；迟到旧统计结果按epoch/revision抛弃。

AI批准将current的金额/日期/时间/精度/名称/商户/分类复制到Transaction，currency=CNY、note=null，创建/更新时间由主进程生成；transactionKind/amountBasis/groupKey仅作审核控制不成为可由UI伪造的source。分类/日期等确认后变更必须重新确认。人工警告处理的具体解除条件见CONTRACTS§5，不能只把resolved置true绕过。

## 6. 唯一统计口径与严格全序

| 项目 | 规范 |
|---|---|
| 数据集合 | 账本相同、Transaction.deletedAt=null；候选/审核/识别表绝不求和。时间筛选按账本Date，start包含/end不含。当前统计有效end=min(周期end,今天+1日)，未来交易仅在列表/CSV的明确日期范围可见 |
| 日期列表排序 | occurredDate降序；同日“已知时间在前、未知在后”；已知按occurredTime降序，再createdAt降序、id ASCII升序；未知按createdAt降序、id ASCII升序。日期组小计覆盖全部符合筛选项（跨页同一组也完整），不是当前页小计 |
| 日Top3交易排序 | amountFen降序；同额已知时间在前、未知在后；已知occurredTime降序，最后id ASCII升序；未知同额直接id ASCII升序。日内不引入createdAt改变金额并列口径。与列表是两个有名全序，不混用 |
| 月Top3/排行 | 同周期全量正式交易按categoryId聚合，金额降序、categoryId ASCII升序；停用分类仍计。不是取3笔再聚合；所有分类排行用同排序 |
| 日均 | 历史总额÷完整自然日数；当前总额÷周期开始至今天含今日自然日数（含无消费日）；年也按日。输出exact numeratorFen/denominatorDays，显示元两位，半入四舍五入；0分显示0.00，无消费日不删 |
| 占比 | 分类总额/同scope周期总额×100，显示两位百分比；精确整数比值半入四舍五入；总额0统一0.00%。只舍入显示，不改金额。前三不足3项按实际，空暂无支出 |
| 选择周期 | week/month/year+anchorDate，主进程定周一/自然月/年；anchorDate不得晚于今天，周期返回start/end/calendarDays/elapsedDays/today。范围越界拒绝（如周首早于1900），不截断周点数 |
| 图点 | 7/28～31/12完整点；已到来无消费为0，未来点amountFen="0"且isFuture=true、Top3=[]、禁止已发生详情；年当前月为截至今天累计，未来月标future。总额先于Top3显示 |
| 筛选/快照 | 列表支持日期+分类集合+名称字面子串（NFC及ASCII大小写不敏感，无SQL通配语义），条件AND；统计只接受周期+分类集合，无名称过滤，UI分别标明作用范围。四个统计接口必须同scope/dataRevision/today，否则整组重取 |

例：2026-09-08的1800/1626/1000分=4426分；09-09的85000/5554/1550=92104分；六笔96530分；9月分类85000/5554/4350/1626，Top3维修/数码/餐饮；历史日均96530÷30分=32.18元。列表搜索“午餐”仅两笔3350分及各日筛选小计，不再暗示整日4426/92104；图表无名称搜索标签。

## 7. 文件、迁移、备份恢复及保留

根目录固定为系统API解析的%LOCALAPPDATA%\BookKeepAI（无法访问则STORAGE_UNAVAILABLE，不回退程序目录）。程序ZIP只存应用和许可。根下secrets放系统加密blob；data/generations/<Id>为一组db、attachments、dataset快照与审计；backups、logs、temp在同根，active清单指向当前generation。锁覆盖整个根，第二实例聚焦已有窗口或报INSTANCE_LOCKED，不再打开可写库。

AISettings（含安全模式元数据）属于本机secrets配置，独立于账本generation及可移机DB备份；secretRef不可出现在账本DB/backup。恢复后重新从本机解密能力派生configured，不采用备份的旧模式标志。仅安全设置变更事件可以进入账本审计，不记录key/密文。

启动：取得锁→检查恢复/迁移切换日志→验证active→开启外键/事务持久性→迁移→幂等默认账本→UI。建议WAL及充分持久写入，由Codex验证实际配置与崩溃恢复；不能以裸拷贝打开中的db文件做备份。短事务串行、busy等待上限5秒，之后DB_BUSY，可同幂等键重试；provider/文件对话框不占DB长事务。

迁移按单调dbSchemaVersion逐级执行，有checksum/适用app版本，不允许静默降级；发现比应用新的schema报SCHEMA_TOO_NEW，只读诊断及换正确版本，不初始化空库覆盖。迁移前在线一致快照+附件清单备份并验证可读；失败回滚事务/切回旧generation，标recovery_required并停止业务写入。不可事务化变更在staging新generation完成再切换；Codex提供后续N-1→N及故障注入结果。未获支持的旧版SCHEMA_UNSUPPORTED，当前首版仅schema=1；后续支持版本显式列入迁移清单。

备份清单bk-backup.v1：backupId、createdAt、appVersion、dbSchemaVersion、contractVersion、ledgerId、snapshotRevision、files数组（受限相对path、size、sha256），及数据集授权/撤回版本摘要；不包含备份自身、secret/DSH配置/logs/temp、运行ZIP。包含一致数据库、所有被引用原图/预处理图、候选/审计、已获同意的本地数据集登记与附件；默认不包含未获同意的额外真实样本。备份复制用户数据须明确告知敏感内容，本地保管，不自动上传。

恢复只替换账本数据generation，保留本机secrets且不导入备份密钥；跨设备须重新输入。流程：用户在主进程对话框选备份→先校验格式/manifest/hash/路径/大小/schema→取得维护锁并取消/等待在途任务→备份当前数据并验证→解压到同盘staging→完整性/外键/唯一/批准关联/文件哈希验证→新版本需要时在staging迁移→持久记录切换意图→原子切换active清单→新epoch并重新开库→验证通过后才成功。每档案≤10GiB、文件≤100000、总展开≤20GiB；拒绝绝对路径、..、重复规范化路径、设备名、链接/junction及越界文件；超额报BACKUP_LIMIT。恢复不会合并两份账本。

任何阶段失败保留旧active和pre_restore快照；崩溃后依据切换日志检查新旧generation完整性，未确认提交则回旧，不能混合新库旧附件。切换后新dataEpoch使所有旧token/请求失效（STALE_EPOCH）；先前processing统一failed/INTERRUPTED、queued等待用户重新同意上传，不自动补发。已批准关联和幂等收据随备份保留。成功后的旧generation/pre_restore仍保留，用户显式清理前不删除。

恢复的ConsentRecord保留历史审计，但其grant不属于新dataEpoch，不能直接用于新图片上传、数据集导出或评测；用户必须分别重新同意，避免恢复旧备份复活已撤回用途。正常重启不改变dataEpoch，恢复成功才更换。恢复后本地手工记账/查看历史/拒绝候选不受此授权失效影响。

保留默认：交易（含软删）、候选、审核、授权、幂等收据和被引用图片长期本地保留；不自动删用户备份/迁移快照；未引用导入图可经image.delete清理；临时无引用文件启动核对后清理，最长24小时；脱敏诊断日志最多30天/50MiB先到为准；输出原始provider正文只在校验内存中暂存，不落普通日志。图片撤回数据集用途使后续导出/评测排除，不删除其合法账本审核引用；要清除账本附件须另设计隐私清理操作，首版明确提示引用限制，不假称已彻底删除。备份是用户主动生成的独立副本，撤回登记传播到后续导出，不能承诺消除已导出副本。

CSV使用transaction.exportCsv（补足方案功能未命名的IPC），仅正式未删；范围显式all或当前filter，服务一次快照全量输出（不是仅当前页）。列固定id、date、time、timePrecision、name、categoryId、categoryName、merchant、amountYuan、currency、source，time/merchant空值为空单元格。amountYuan为无分组正十进制两位，UTF-8带BOM、CRLF、RFC4180引号转义。文本单元格首个非空白字符若为=、+、-、@或控制前缀，前置单引号再CSV转义；金额是服务生成受限正数，不接受外来公式。导出不含图片/候选/secret，不提供任意CSV导入。

## 8. 密钥、同意与阶段边界

密钥仅主进程调用系统用户绑定加密接口，保存前检查可用性并验证能解密；不可用明确返回session模式，本次会话内存保留、退出即失效，禁止明文回退。密码框允许用户输入/提交时短暂持有明文；提交进入受限IPC即清空输入及UI状态，失败重输；不写localStorage、React持久状态、崩溃报告或分析埋点。已存key任何操作不得回读UI，状态只返回configured/mode/lastErrorCode，不返前后缀掩码。JS/Electron内存不能承诺物理零化，须缩短存活且禁调试日志。

settings.saveSecret仅受信本地顶层窗口、用户操作、限长1～512、无控制字符；返回状态不回显；主进程不读DSH配置。只向固定HTTPS DeepSeek profile请求；不跟随跨域重定向传递授权，不允许UI任意baseURL。上传前核对当前图片hash和识图同意，只发prepared图及分类id/name，排除全账本、审计、商户历史；评测上传同样单图逐次授权。数据集同意独立且默认无，许可/脱敏/人工真值是额外条件。

saveSecret切为session（含加密不可用回退）时必须停用并删除此前持久blob，磁盘安全元数据标absent，当前进程返回session；否则下次启动会错误复活旧key。remove同时清除会话引用/持久blob/配置标志；切换失败保留旧完整配置并返回失败，不报告已删除或已会话化。encrypted保存成功后不长期持有多份旧明文，HTTP仅在需要时取受限句柄，退出清理引用。

S04只搭安全IPC及明确NOT_IMPLEMENTED/UNSUPPORTED stub、不保存真实密钥；S09提供可独立打开的最小密码输入/保存或会话选择/状态/移除入口与合成图真实探针，使用同一受限settings接口，不等待完整设置页；S15再做故障、日志、导出与依赖安全加固。S09探针不开放任意HTTP入口，不把密钥写命令行或交接；探针图片和JSON组合必须真实验证。S09前deepseek provider调用明确NOT_IMPLEMENTED，mock显著标识且不通过G2。

## 9. 实现验证与证据计划

| 责任步骤/需求 | Codex须提供的实现自测证据；另设验收轮复核 |
|---|---|
| S04；REQ-001/022/028/030 | 版本锁/Windows兼容/原生ABI、单实例锁、preload越权拒绝、ZIP骨架启动；不等于正式软件G6 |
| S05/06→S08；REQ-002～007/023/024 | 1与999999999分边界/非法数/超精度、重启和CAS冲突、软删恢复、默认幂等、停用旧分类、CSV公式/中文、迁移回滚 |
| S07→S08；REQ-008～011 | F02六笔及S03扩展、全序/闰日/跨年/未来/过滤/跨页小计、精确累计及显示舍入；不可只测图能画 |
| S09→G2；REQ-013/020～022 | 真图片+可核对字段/日期模型标识/安全存取和session降级、JSON组合与失败、无完整请求日志；缺key写未执行 |
| S10/11/15/16→S17；REQ-012～022 | 多笔与合计、字段null、非支出/恶意图、并发双批/单批冲突/commit后响应丢失、取消/timeout迟到/重启、备份切换断电故障；0重复/0未经审核入账 |
| S12/13→S14；REQ-025～027 | 授权隔离、撤回、分组锁test、合成/真实分列、seed/版本重现、unsupported训练；缺真实数据不报质量达标 |
| S17/18/19/20；REQ-024/028/029/030 | G5失败修复后重验，正式ZIP绑定SHA256；干净Win10/11、中文空格路径、离线、附件/原生SQLite/备份，敏感排除和最终人类决定 |

本次只有文档及哈希检查，没有执行上述软件用例。S03还需完整UI流程/分类图标映射/固定数据/缩放矩阵；它不应再改变本文件金额、状态、排序、权限及原子边界。任何实现疑点由Codex先补契约，再编程与回归；验收轮保持被验版本只读，修复另轮复验。

## 10. 已读官方来源与证据边界

2026-10-20重新读取[Electron Security](https://www.electronjs.org/docs/latest/tutorial/security)与[SQLite Backup](https://www.sqlite.org/backup.html)，据此采用隔离与一致快照原则；本文具体业务限额/恢复流程是项目决策，不宣称官方默认。DeepSeek核实记录见CONTRACTS§9。未锁定库版本、未运行数据库/桌面/API/打包，不把设计视为兼容或安全验收结果。

## 11. S04/S05 接收补充（2026-10-20）

本节更新当前工程事实；前文“未实现/未锁定”是 S02 历史时点。当前 S04 工程骨架已接收，S05经R1/R2修复后阶段接收通过；最新实际复跑和限制见 evidence/RECEIPT-S05-R2/RECEIPT.md，G1～G6不因本节通过。

当前账本修订号以持久 Ledger.dataRevision 为事实源。MutationReceipt 内部 revision_at_commit 保存历史提交值，不能回写当前 store 水位；IPC 当前信封和恢复令牌使用当前事实源，历史提交值作为独立 committedRevision 元数据。输出映射及回归要求见 CONTRACTS §10.1、BK-S05-001。

备份档案及其可发现目录属于独立保留的维护资源。恢复旧账本后仍须可发现、校验并选择此前保留的所选档案、较新档案和 pre_restore；不得靠合并交易/旧审计来保留备份目录。实现可将目录与 generation 分离或采用受限校验重建等效方案，需证明路径受限、坏档案不伪造成功。见 CONTRACTS §10.2、BK-S05-002。

R1新增目录重建不能削弱hash校验：已知创建hash须作为基准持续保留，扫描当前内容hash只能比较，不能压过DB/目录中已有基准。已知元数据冲突需明确拒绝/标错，不能因恢复到更早generation而让不匹配文件变成新基准。见CONTRACTS§10.2、DECISIONS D41/D42和BK-S05-003；R1静态发现的问题已由DSH补真实SQLite回归，R2本次复跑5项通过并关闭。

S05 的 DB-only .bkdb、内部 backupId 选择与全量目录仅作为基础阶段适配；S15 统一最终文件格式、分页、外部选择 token、恢复操作状态核实、孤儿补偿和故障恢复，需兼容或明确转换已有档案。S11 前 sourceCandidateId 仅唯一约束预留，候选外键/批准关联后补；这些阶段边界不等于 AC11/16 已通过。

S06按D45落实客户端世代栅栏：列表快照与编辑/删除/恢复意图保存读取时dataEpoch，preload发送显式世代，主进程原有校验拒绝旧表单；桥接透传既有信封epoch/revision，跨代分页不能混拼，迟到旧响应不回写新缓存。详见CONTRACTS§10.3；不改变schema/IPC业务载荷，S08另轮复核。

## 12. S07统计实现选择（D47/D48）

统计服务使用现有LedgerStore上下文和正式transaction表，在单次DEFERRED只读事务中读取revision、日聚合和分类/Top3。只读取本账本deleted_at为空且在[start,effectiveEnd)的记录；类别停用不删历史额。SQL SUM转十进制字符串，BigInt累计及显示，SQLite整数溢出及跨组64位超限统一AMOUNT_TOTAL_OVERFLOW。所有视图、排行、点详情以相同scope绑定；不从列表已加载分页计算。

S04依赖未锁ECharts，S07选择本地SVG，避免为有限折线引入新运行依赖，保留建议架构的主进程统计与受限渲染职责。图形只把服务已计算的整数额换成像素坐标；可访问性采用单Tab图入口、键盘导航、正常流详情及同值数据表。无迁移、无新依赖、无网络/API调用。
