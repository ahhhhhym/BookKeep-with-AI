# BookKeepAI IPC、provider与候选契约

2026-10-20职责变更（DECISIONS D43）：S01～S05已通过对应阶段接收，S06～S20全部由Codex负责，包括编程、测试、修复、验收和打包。DSH仅保留S04/S05历史归属；旧文档中的后续DSH指派由D43覆盖。历史阶段的“本次/未执行/待验收”描述保留当时证据边界，当前进度以执行看板及S05-R2接收记录为准。业务/接口口径不因本次分工调整改变。

版本：S02-1.2（含hash保留澄清）｜日期：2026-10-20｜作者：Codex｜状态：原S02已接收；S05-R2实现复验通过，阶段限制见§10及RECEIPT-S05-R2

本文件仅用文字、表格及不可执行的数据例子定义接口；不是TypeScript声明、JSON Schema、SQL或HTTP示例代码。Codex接续编写并验证正式schema。基础域、实体和事务见[ARCHITECTURE](ARCHITECTURE.md)，有冲突先登记[DECISIONS](DECISIONS.md)再改实现。方案§3.3全部操作保留；补充CSV/批量审核/数据维护入口以落实已确认功能，不开放通用文件、SQL或HTTP能力。

## 1. 通用信封、版本、权限与重试

请求共同字段：contractVersion固定bookkeep.v1；requestId为新UUID，仅关联本次IPC；dataEpoch为启动取得的UUID；payload为下表严格白名单对象。首次ledger.ensureDefault及settings.ai允许dataEpoch=null用于取启动状态，其他必须匹配。所有变更另带mutationId:UUID；编辑/删除/恢复另带expectedVersion:整数；批量用逐项version及previewToken。UI不能指定成功状态、创建时间、source、provider实际模型或审计者。

成功信封：ok=true、requestId、contractVersion、dataEpoch、dataRevision（非负安全整数）、data；失败：ok=false及error={code:枚举,message:固定本地文案键,fieldErrors:字段path/code数组,details:受限对象,retryable:bool,retryAfterMs:非负整数或null}，其余共同字段同成功。失败无data；不返回栈、SQL、磁盘绝对路径、完整响应/请求、key或图片编码。details只允许currentVersion、missingFields、warningCodes、affectedIds、maxBytes/maxCount、jobId及安全providerStatus等已定义字段；敏感输入原值不得带回。contract不匹配CONTRACT_VERSION_UNSUPPORTED；epoch不匹配STALE_EPOCH，UI重置所有缓存并重新读取。

| 权限标签 | 主进程每次必须核实 |
|---|---|
| R | 只读本地业务：受信本地顶层WebContents和固定origin/主frame，当前账本归属、载荷/对象类型/大小、epoch；iframe/远端窗口禁止 |
| W | R+业务校验、version/幂等；主进程事务唯一写入，数据维护锁时MAINTENANCE_MODE |
| F | W+本地用户明确选择/保存对话框或本次拖放File换发的临时文件选择token；token由主进程管理、绑定窗口/用途、5分钟一次消费，拒绝路径字符串/任意URL |
| U | W+每张preparedHash的recognition同意、固定provider profile、可用secret；每次实际HTTP之前复核。远端内容不能触发 |
| S | W+用户密码输入/移除动作、系统加密检查及专用限流（每窗口每分钟≤5次提交），不经通用日志/收据存secret |
| D | W+独立dataset授权及许可/脱敏/复核状态；新登记/标签处理/版本创建/导出/评测必须当前有效同意；元数据读取、结构失败报告及撤回允许在授权失效后本地执行以供处理，仍校验账本归属；导出再确认本次目标范围，评测上传另验U |

所有入口都要R校验；表中的W/F/U/S/D为附加权限，不是renderer可自行传入的权限开关。文件选择token由preload仅对实际File/原生对话框请求主进程换发，不能从字符串构造；UI只得到图片assetId、只读resourceToken、备份artifactId等业务句柄，无通用读盘权。主进程保存对话框取消为USER_CANCELLED，无副作用。

幂等规则：变更在同事务保存MutationReceipt，唯一(ledgerId,operation,mutationId)；相同键/规范化payload重发返回原业务结果及replayed=true，原提交revision与当前水位分离（§10.1），不同payload报IDEMPOTENCY_CONFLICT。超时或连接断开后先查状态或原键重发，禁止盲目换键。提交前失败无成功收据，可原键重试；业务修正需新键；expectedVersion属于payload，不能同键换version。请求ID不是幂等键。已批准候选的独立唯一来源兜底比收据更强，见§5。重放旧结果不使主进程或UI当前revision回退，须按当前revision刷新。

settings.saveSecret为例外：不持久化secret、secret摘要或payloadHash；只在主进程会话内记mutationId及安全结果，重发同id不重新保存（不比较或回显新secret），更换输入必须新id。重启后以settings.readStatus确认，不自动重发明文。设置更改仍CAS防过期覆盖；加密文件先临时写/校验/原子换名后更新安全元数据，失败恢复旧blob和模式，不谎报已保存。

下表“重试I”=可在瞬时失败后原幂等键重试本地命令（不表示重发网络）；“重试R”=可重读；“重试U”=产生潜在收费请求，只有recognition调度器按§4规则/用户重试授权执行；“否”=不能自动重试，需要修改/重新确认。read本身无持久副作用，启动ensureDefault除外；不要求只读传mutationId。

## 2. 公共DTO、过滤和分页

实体DTO使用ARCHITECTURE§2/3字段，去掉内部路径、secret引用、文件字节和原始provider文本。Id/日期/金额/文本的nullable规则不能由单个接口放宽。每次返entity带version。

| DTO | 完整语义 |
|---|---|
| TransactionInput | amountFen、occurredDate、occurredTime、timePrecision、name、categoryId、merchant、note；amountFen/occurredDate/timePrecision/name/categoryId非null，occurredTime/merchant/note可null，timePrecision=date/minute；create所有键必有，update为非空白名单patch，互相关联字段改变时需同时满足约束 |
| TransactionFilter | dateStart/dateEnd:Date或null（end允许边界哨兵），categoryIds:Id数组≤500（[]不限）、nameQuery:Text≤100或null、deleted:active/deleted/all默认active。dateStart<dateEnd；null为无该侧边界；只作用本账本；名称是字面子串不是通配/正则 |
| PageInput | limit整数1～100默认50、cursor为主进程签发opaque字符串≤2048或null；游标绑定scope、排序、epoch、revision，5分钟有效；不得接受客户端SQL或排序字段 |
| PageResult | items数组、nextCursor:string或null、totalCount:非负安全整数、snapshotRevision；空页[]/null/0。分页采用§6全序，revision变化报SNAPSHOT_STALE并从第一页重取；不静默漏/重行 |
| StatisticsScope | period:week/month/year、anchorDate:非未来有效Date、categoryIds:Id数组≤500；snapshotRevision:可空安全整数（首读null，其余用首次revision）；服务返回scopeId、start/end、effectiveEnd、today、timezone、revision。名称搜索/删除筛选不接受 |
| TaskDTO | id/version/status/generation/attempt/totalAttempts/provider/model/actualModel/promptVersion/schemaVersion/errorCode/startedAt/finishedAt/nextAttemptAt/candidateCount；另imageAssetId/preparedHash；不返回网络头/base64/provider正文。attempt来自真实发送次数，不是假进度 |
| EditableFields | amountFen、occurredDate、occurredTime、timePrecision、name、merchant、categoryId、transactionKind、amountBasis、groupKey；类型见§7；缺失可null（timePrecision保留unknown元状态），状态非支出不能直接批准 |
| Confirmation | amount/date/name/category逐项true；confirmedVersion:正整数；reviewDigest:主进程根据当前字段及blocking/duplicate集合签发的hash。人工确认不能跨version复用；一次勾选整批须逐笔可复核，batch token包含各项digest |
| ArtifactDTO | artifactId、displayName、sha256、byteSize、recordCount（无记录概念时null）、createdAt；对话框保存位置由主进程掌控，UI不获得任意路径能力 |
| Warning | code枚举、field为字段枚举或null、message:安全本地文案/模型文本≤500、severity:info/blocking、resolved:bool、resolutionNote:Text500或null；模型不能设置resolved，主进程只按规则派生 |
| DuplicateMatch | targetType:transaction/candidate/job；targetId:Id；basis:exact_hash/amount_date_merchant/amount_date_name；targetVersion:整数；不输出整个账本。match集合去重稳定按targetType/id升序，digest用于复核 |

所有列表带page规则（category.list为≤500全量字典的显式例外）。其他输出为单对象/≤100固定数组/完整周期点，写“无分页”即不可暗自截断。大文件导出使用快照流式写磁盘，不在IPC传整文件。通用载荷上限256KiB；图片通过受控文件token输入不以base64过IPC。拖放/裁剪指令/候选各自有限制，见下文。

载荷字节上限和数组/字段数量上限同时满足，超过任一均PAYLOAD_INVALID，不静默截断。key为opaque输入，禁止NFC/trim/大小写改写，首尾含空白或任何控制字符直接SECRET_INVALID要求用户核对；不把普通文本规范化规则应用于key。所有returned资源token绑定assetId/variant/窗口/epoch，只读且5分钟到期，可经image.prepare的只读资源模式（readOnly=true，仅assetId与variant，禁止crop/masks）换新；此模式R/无mutationId、不创建asset，输出resourceToken/metadata，仍无任意路径读盘权。

## 3. 账本、分类、交易及统计IPC（方案原名）

每行输入均隐含请求信封与账本ledgerId（ensureDefault例外）；每行变更均隐含mutationId，更新隐含expectedVersion。标准错误见§8，“特有”仅列最相关错误，仍可能出现权限/epoch/存储类通用错误。

| 操作 | 输入payload | 输出data | 权限；分页；幂等/重试；特有错误 |
|---|---|---|---|
| ledger.ensureDefault | 空对象，启动epoch可null；mutationId必填 | ledger、categories全量、contract readiness、dataEpoch | W；无；defaultKey+种子systemKey事务唯一、I；DB_BUSY/INTEGRITY_ERROR。即使不同键多次也仅一个默认账本 |
| category.list | includeDisabled:bool默认true | categories≤500（sortOrder升序、id升序）、revision | R；全量无分页，超过500禁止新建；R |
| category.create | name、iconKey、sortOrder（对应域） | Category | W；无；I；CATEGORY_NAME_EXISTS/CATEGORY_LIMIT/ICON_INVALID。systemKey主进程null |
| category.update | id、expectedVersion、patch仅name/iconKey/sortOrder/enabled=true | Category | W；无；I；VERSION_CONFLICT/CATEGORY_NAME_EXISTS。enabled=false只用disable，以免绕过其他保护 |
| category.disable | id、expectedVersion | Category（enabled=false） | W；无；I；CATEGORY_PROTECTED（其他）/VERSION_CONFLICT；同一键回放不加版本 |
| transaction.create | TransactionInput | Transaction | W；无；I；AMOUNT_INVALID/DATE_INVALID/CATEGORY_DISABLED；source固定manual、candidateId字段禁止 |
| transaction.update | id、expectedVersion、patch为TransactionInput的非空子集 | Transaction | W；无；I；VERSION_CONFLICT/TRANSACTION_DELETED/CATEGORY_DISABLED（改选时）。source等不可变 |
| transaction.softDelete | id、expectedVersion | Transaction（deletedAt为主进程时间） | W；无；I；VERSION_CONFLICT/STATE_CONFLICT（不同键对已删，原键则回放） |
| transaction.restore | id、expectedVersion | Transaction（deletedAt=null） | W；无；I；VERSION_CONFLICT/STATE_CONFLICT；保留停用分类及原source关联 |
| transaction.list | filter:TransactionFilter、page:PageInput | PageResult(TransactionDTO)、filteredTotalFen字符串、dateGroups（本页出现各日的全筛选计数/总额，不限本页）、filterEcho | R；分页；R；SNAPSHOT_STALE。deleted≠active时输出清楚label，不供正式统计使用 |
| statistics.series | StatisticsScope | scope、totalFen字符串、points数组：pointKey/label/start/end/amountFen字符串/isFuture；7/28～31/12点 | R；无分页；R；FUTURE_PERIOD/RANGE_INVALID/SNAPSHOT_STALE/AMOUNT_TOTAL_OVERFLOW |
| statistics.topTransactions | StatisticsScope（period只week/month）、pointDate:该周期已到来日 | scope、pointTotalFen字符串、items≤3：transactionId/name/amountFen/occurredTime/timePrecision；按日Top3全序 | R；无分页/固定3；R；POINT_OUTSIDE_SCOPE/FUTURE_POINT；总额含当日全部筛选交易 |
| statistics.topCategories | StatisticsScope、pointMonth:YYYY-MM或null | scope、totalFen字符串、items：categoryId/name/iconKey/totalFen/ratioPercent；pointMonth非null只允许year内月且≤当前月，取≤3；null取整周期全部≤500排行 | R；无分页；R；POINT_OUTSIDE_SCOPE/FUTURE_POINT；类别按聚合总额降序/id升序 |
| statistics.summary | StatisticsScope | scope、totalFen、count、dailyAverage={numeratorFen字符串,denominatorDays整数,displayYuan两位字符串}、categoryTotals（≤500）、ratio显示两位 | R；无分页；R；同series。scope和revision一致时series/summary/排行金额必须相等 |
| transaction.exportCsv（补充） | filter（deleted必须active）、range:all/filtered；all时其余filter为空；exportConfirmed=true | ArtifactDTO及normalizedFilter、snapshotRevision | F；无分页/全量快照；I；EXPORT_FAILED/USER_CANCELLED；CSV规则ARCHITECTURE§7 |

统计只有正式未删，未来点补零但不是已经发生的零消费；未来点请求详情直接FUTURE_POINT。summary日均与占比显示规则不得由ECharts替换。列表日期分组分页可能拆在两页，UI合并同日，不能把page小计当日总额。

## 4. 图片与识别任务IPC（方案原名）

| 操作 | 输入payload | 输出data | 权限；分页；幂等/重试；特有错误 |
|---|---|---|---|
| image.import | selectionTokens:1～20本窗口文件token；retention:keep_original/prepared_only | 每项result：asset或错误、reused:bool、exactMatches（已有asset/job Id），按输入顺序；batchId | F；固定≤20无分页；按mutationId+ordinal幂等、I；BATCH_LIMIT/IMAGE_FORMAT/IMAGE_DECODE/IMAGE_TOO_LARGE/IMAGE_DIMENSION。逐文件原子，失败项不影响成功项；重放同键不重复消耗token |
| image.prepare | imageAssetId、expectedVersion、crop:{x,y,width,height}或null（原图像素整数、在范围内）、masks:最多50个同域矩形、retainOriginal:bool | 新预处理assetDTO、preparedHash、resourceToken（只读原图/预处理图） | F（已有asset内读写无需外部token）；无分页；I；IMAGE_REGION_INVALID/IMAGE_IN_USE/IMAGE_TOO_LARGE。像素操作顺序裁剪后遮盖，masks坐标相对裁剪后图，主进程重编码去元数据；无处理也生成安全prepared版本 |
| image.delete | imageAssetId、expectedVersion、confirmed=true | id、deleted=true | W；无；I；IMAGE_IN_USE/FILE_BUSY。无引用才清理文件及元数据（哈希审计可留），失败保留可用状态或待清理日志，不留下损坏引用 |
| recognition.start | images数组1～20：imageAssetId/preparedHash；provider:deepseek/mock；promptVersion（仅本地已安装白名单）；uploadConsent逐图{confirmed:true,noticeVersion,preparedHash}；forceNew:bool默认false；reason可空 | jobs:TaskDTO数组、reusedIds、createdIds；每图一个job | U（mock不出网，仍有明确本地模拟动作）；无分页；I/U；SECRET_REQUIRED/CONSENT_REQUIRED/IMAGE_NOT_PREPARED/PROVIDER_NOT_READY。本地job创建整批事务；任一输入坏则0新job，不启动HTTP |
| recognition.cancel | jobId、expectedVersion | TaskDTO（cancelled或失败冲突） | W；无；I；STATE_CONFLICT/VERSION_CONFLICT；取消先写栅栏再abort，不保证撤回已发送数据/费用 |
| recognition.retry | jobId、expectedVersion、possibleChargeAccepted=true、本图当前uploadConsent | TaskDTO（queued、新generation） | U；无；I/U；STATE_CONFLICT/CONSENT_REQUIRED/SECRET_REQUIRED；只failed/cancelled；completed必须start forceNew且注明原因 |
| recognition.status | jobId:Id或null；null时传statusFilter数组和PageInput | 单个TaskDTO；或PageResult(TaskDTO)+各状态计数 | R；jobId非null无分页，否则按createdAt降序/id升序分页；R；NOT_FOUND/SNAPSHOT_STALE |

图导入不自动上传，prepare不自动识别。真正上传前主进程确认授权与当前preparedHash相同，修改图片导致原授权失效。原图字节即使保留也不发送。限制对原图及prepared均执行：JPEG/PNG/WebP、≤10MiB、最长边≤8192、像素数≤67,108,864；不符先拒绝，超限用户外部裁剪或重选，不承诺能先加载超限图。模型支持限制小于本地限制时S09固定更严格值并登记变更，不编造官方限制。

image.import为逐文件原子：成功文件记录收据operation=image.import.item.<ordinal>、mutationId为本批原id；最终批收据operation=image.import保存有序全部结果。中断重放时先查已成功项收据，不再次消耗对应token，未完成项从本地staging/恢复日志继续；失败项在最终批结果固定，用户重选后以新批id处理。prepared_only在prepared文件及元数据提交成功前临时保留originalRef，之后才删除原文件；绝不先丢原图再生成预处理图。操作日志/staging不记录秘密或外部任意路径到UI。

精确同图：默认以本账本originalHash或preparedHash寻找已有未删asset，import复用并提示；start在相同preparedHash已有job时默认返回最近job（createdAt降序/id升序），不收费；失败/取消请走retry。forceNew要求用户理由和再确认，可显式区分“确实第二笔”或“重新识别”，审计且所有新候选出现exact_hash阻断疑点，不能因复用机制吞掉真实第二次消费。即使不同裁剪/哈希仍要做字段疑似重复提示。

调度及五态按ARCHITECTURE§4；attempt=0表示尚未请求，attempt最多3，timeout=90,000ms/真实发送。临时网络/限流/服务错误退避2秒/4秒，自动重试仍复核授权；无key/401/403/余额/输入/结构错误不自动重试。provider不内嵌第二层重试。返回completed只表示整图schema/业务规范化完成且候选已落库（可0笔），不是入账。取消/timeout后的迟到响应无提交权，禁止部分候选写入。

主进程事件task.changed只推送{dataEpoch,revision,jobId,version,status,attempt,nextAttemptAt,candidateCount}；ledger.changed只推{dataEpoch,revision,changedEntityIds}。事件是提示，UI重新status/list；断线重开可完全用持久状态恢复。不得通过普通事件携带secret、路径或图片。未完成总耗时未知时显示不定进度，批量进度显示真实已终态图数/总图数，不按时间模拟百分比。

## 5. 候选审核IPC（方案原名，模式补齐批量与重开）

| 操作 | 输入payload | 输出data | 权限；分页；幂等/重试；特有错误 |
|---|---|---|---|
| candidate.list | jobId可null、reviewStates枚举数组默认pending_review、PageInput | PageResult(CandidateDTO)：proposal/current/evidence/missing/warnings/duplicateMatches/状态/version/postedTransactionId及reviewDigest | R；createdAt降序、jobId升序、ordinal升序、id升序分页；R |
| candidate.update | id、expectedVersion、action:edit/reopen/resolve_duplicate/resolve_warning；edit为EditableFields patch+reason（证据不足或风险改正时必填）；reopen必须reason无patch；resolve_duplicate为duplicateResolution:distinct/duplicate及非空reason；resolve_warning为warningCode/field/reason及当前reviewDigest | CandidateDTO、reviewDigest、blockingReasons | W；无；I；VERSION_CONFLICT/STATE_CONFLICT/FIELD_INVALID。仅pending可edit/resolve，rejected只reopen；approve后只能编辑正式交易 |
| candidate.approve | mode:single，id/expectedVersion/Confirmation/mutationId；或mode:preview，items≤100（id/version/Confirmation）；或mode:commit，previewToken及mutationId | single：transaction/Candidate状态、alreadyApproved、replayed；preview：eligibleIds/versions/digests、excluded(id/reasons)、count、totalFen字符串、previewToken（60秒）；commit：transactions≤100、candidateIds、count/totalFen | W；无分页；single/commit I，preview R且不写账；REVIEW_INCOMPLETE/REVIEW_STALE/NON_EXPENSE/DUPLICATE_UNRESOLVED/VERSION_CONFLICT；ARCHITECTURE§5全部原子规则 |
| candidate.reject | id、expectedVersion、reason:Text500非空 | CandidateDTO（rejected）、ReviewEvent Id | W；无；I；STATE_CONFLICT/VERSION_CONFLICT，无正式金额变化 |

approve preview不传mutationId也不落库，可返短期只读token；确认入口必须由用户动作触发。commit token绑定窗口、epoch、ledgerId、revision、全部eligible字段/version/digest和总额，不能改写成员；没有eligible则token=null/count=0不能提交。过期TOKEN_EXPIRED；revision或候选/重复集合变更REVIEW_STALE整批不入账。single已approved返回原关联，忽略待提交旧改值但附alreadyApproved=true（数据有改动需交易编辑）；approved且交易已软删仍返回原软删对象，不生成/恢复第二笔。

重复检测在候选规范化、编辑及批准事务中重算：完全同图匹配关联job/交易；字段疑似要求同amountFen+完整occurredDate且merchant或name规范化完全一致，规范化仅NFC、trim、ASCII小写；金额/日期未知时不作已确认重复而显示无法判断。匹配不做物理删除。distinct需用户理由和当前匹配digest；duplicate必须reject或继续pending，不可批准。新交易/编辑使匹配集合变化，旧处理digest失效。相似不是有权删除第二笔消费的证据。

非支出风险必须用户改transactionKind=expense并填写核实理由，金额、日期、购买物仍逐项确认；原proposal及warning不删除，风险可标已处理并审计。缺字段warnings只有合法补填才消除阻断。仅点击“忽略警告”不能改变non_expense/未知字段为合法。未知分类须明确选类（可选其他），不自动兜底。

resolve_warning只写处理原因，实际resolved由主进程验证：缺字段/类别/日期/金额必须合法补填；NON_EXPENSE要求current.kind=expense和核实理由；EVIDENCE_MISSING/BLURRY/NAME_UNKNOWN要求用户对照图或自身事实补填并逐项确认，原因作为human审计；INSTRUCTION_IN_IMAGE仅标“已知图中文字不执行”，不授予执行权。TOTAL_DETAIL_AMBIGUOUS要求明确amountBasis与groupKey：同一job/group中如存在paid_total，只允许该组唯一保留的合计候选批准，其余明细候选须先rejected；不能在同组已有approved合计后批准明细。确认实际独立付款时用户可更正为不同groupKey+line_payment并写理由，仍做重复核实。OTHER及AMOUNT_AMBIGUOUS必须理由+合法字段，不允许无解释清空；派生CODE如重复只按重复规则解除。字段或组成员状态变化使相关resolution/digest失效，需要重审。

## 6. 设置、备份、数据与评测IPC（含必要补充）

| 操作 | 输入payload | 输出data | 权限；分页；幂等/重试；特有错误 |
|---|---|---|---|
| settings.ai | 空对象；允许启动epoch=null | provider=deepseek、model=deepseek-flash、prompt/schemaVersion、readiness:stub/ready/needs_probe、secret配置状态、settingsVersion、dataEpoch/当前账本Id可null | R；无；R；不能读取key/密文/secretRef。它是AI配置摘要读取，不是通用settings对象或任意配置写入 |
| settings.readStatus | 空对象 | configured:bool、mode:absent/encrypted/session、encryptionAvailable:bool、version、lastErrorCode可null | R；无；R；无掩码/片段/明文；加密blob存在但解不开应configured=false并返回SECRET_UNREADABLE |
| settings.saveSecret | expectedVersion、action:save/remove；save时secret:1～512密码字符串、persistence:encrypted/session；remove不含secret；mutationId | configured/mode/version（均不含secret）；encrypted不可用时success为session且提示SECRET_SESSION_ONLY | S；无；专用会话幂等/I；SECRET_INVALID/SECRET_UNREADABLE/VERSION_CONFLICT/SECRET_RATE_LIMIT；提交后UI立即清空，即使错误也不回显 |
| backup.create | kind:manual（内部可pre_restore/pre_migration）、containsPrivateDataAcknowledged=true | BackupRecord成功状态+ArtifactDTO；取消/失败错误，留失败任务记录 | F；无；I；BACKUP_FAILED/BACKUP_LIMIT/STORAGE_FULL；一致快照及全部DB引用附件，排除secrets；不支持删掉数据集附件却仍带引用的残缺备份；手动保存可复制到用户选择位置但不接受自由路径payload |
| backup.restore | mode:preview，selectionToken；或mode:commit，restoreToken、currentDataWillBeReplaced=true、mutationId | preview：manifest摘要/兼容性/敏感内容/警告、restoreToken（5分钟）；commit：ledgerId/newDataEpoch/revision、preRestoreBackupId、appliedBackupHash | F；无；preview R，commit I但切换后仅以恢复操作状态核实，旧epoch请求STALE_EPOCH；BACKUP_INVALID/HASH_MISMATCH/SCHEMA_TOO_NEW/SCHEMA_UNSUPPORTED/RESTORE_FAILED/FILE_BUSY。token绑定档案hash、旧epoch和revision，变动需重预览 |
| dataset.export | datasetVersionId、sampleIds数组≤1000或null代表全版本、includeImages:bool、purpose:evaluation/future_training、consentConfirmed=true | ArtifactDTO、manifestHash、exportedCount、excludedIds/reasons、datasetRevision；manifest含版本/许可/withdrawal摘要与图片hash | D+F；文件全量无分页；I；CONSENT_REQUIRED/DATASET_INVALID/DATASET_WITHDRAWN；重新核对授权，失效成员默认阻断整次导出，显式新选范围后重试，不悄悄删成员仍宣称原版本 |
| dataset.validate | datasetVersionId或sampleIds（互斥，≤1000；全版本不受1000选择数限制） | valid:bool、errors/warnings按sampleId/field/code、sample/group/split/kind计数、manifestHash可null、datasetRevision | D；报告≤1000问题，超出返回reportArtifactId+真实totalIssueCount，不能假称全量有效；R；SPEC_NOT_READY（S12前仅结构/许可基础检查可返回scope=structural_only） |
| evaluation.run | datasetVersionId、scope:framework/quality、provider:mock/deepseek、promptVersion、seed、uploadConsent（deepseek逐图manifestHash同意）、possibleChargeAccepted（deepseek必须true） | EvaluationRun queued，runId | D，deepseek另U；无；I/U；SPEC_NOT_READY/DATASET_INVALID/DATASET_WITHDRAWN/CONSENT_REQUIRED/SECRET_REQUIRED；先校验锁定版本，不在UI计算指标 |
| evaluation.status | runId | EvaluationRunDTO、metrics、reportArtifactId、processed/failed/total、sourceBreakdown、限制 | R（数据集权限仍检查）；无；R；NOT_FOUND；所有状态/指标持久且真实，未返回用量/费用为null |
| consent.record（补充） | imageAssetId、purpose:recognition/dataset、decision:grant/withdraw、scopeHash、noticeVersion、supersedesId可null | ConsentRecord Id及当前两种授权摘要 | W；无；I；VERSION_CONFLICT/CONSENT_REQUIRED；withdraw使未发请求停下、在途generation失效及评测取消，不承诺收回已上传数据 |
| dataset.sampleList（补充） | filter:kind/split/reviewStatus/withdrawn、PageInput | PageResult(DatasetSampleDTO) | D；createdAt降序/id升序分页；R；SNAPSHOT_STALE绑定datasetRevision |
| dataset.sampleUpsert（补充） | create为imageAssetId/kind/predictionJobId（可null）/consentId/licenseStatus/licenseNote/redactionStatus/duplicateGroup；update为id/expectedVersion及同域patch或labels/annotator/reviewer/reviewStatus/withdraw=true | DatasetSampleDTO、新datasetRevision、受影响版本Id列表 | D；无；I；DATASET_LOCKED/CONSENT_REQUIRED/LICENCE_REQUIRED/VERSION_CONFLICT；锁test不原地改label，撤回可立刻失效；prediction由指定同图completed job快照取，无job则[]，不接受UI伪造预测，predictionJobId创建后不可变 |
| dataset.versionCreate（补充） | tag、sampleVersions（id/version）≤1000、groupSplits≤1000、lockTest=true、parentVersionId可null | DatasetVersion摘要/hash | D；无；I；DATASET_INVALID/SPLIT_LEAKAGE/DATASET_LOCKED；同group不跨split、已有locked test成员不能移到train/dev；S12定义划分算法/seed记录 |
| evaluation.cancel（补充） | runId、expectedVersion | EvaluationRun cancelled | D；无；I；STATE_CONFLICT；取消栅栏同识别，在途迟到不写最终指标 |

dataset同意不存在时允许显示“未加入数据集”和同意入口，拒绝实际登记/导出/评测；consent.record(dataset grant)也不自动登记样本或出网。sampleUpsert的kind、预测来源创建后不可改；标签Proposal里证据可注明human，金额/日期unknown保持null。标签采集及指标/划分细则S12负责，S13前不得用随意规则报quality通过。此处补充接口只落实PRD既定流程，不授权本阶段实现。

dataset.export选sampleIds子集时，输出独立subsetManifestHash和parentDatasetVersionId、实际sample/group清单及范围标签，不将子集哈希宣称为原完整版本哈希；不得拆散duplicateGroup，同组只选部分报DATASET_INVALID。未选择子集时manifestHash必须等于完整版本规范化清单哈希。锁定版本的快照含当时标签/预测/许可，不靠可变样本重建；但当前撤回优先，撤回后不再导出/评测旧版本，给新版本重新选范围。

所有用于版本比较的manifest/digest使用确定性规范化数据：UTF-8无BOM，JSON对象键按Unicode码点升序、无多余空白，有限数字最短十进制、null显式保留；样本/文件/group清单按稳定Id或相对path升序，候选/证据保留ordinal顺序；排除本次导出路径/新时间/散列字段自身。SHA-256作用于这些规范化字节；文件内容hash另按原字节。Codex提供规范化夹具与重复导出hash相等证据，不由UI自行拼接摘要。备份清单同规则但包含固定备份时createdAt，备份ZIP hash与manifestHash分开。

备份restore是维护操作：任务和事务静止后切换；进度通过同类task事件只报真实阶段。archive不含key；恢复后epoch变化，重试commit必须先重读settings.ai确认账本/epoch和恢复结果，不能再次覆盖。恢复切换日志持久保留restore mutationId/backupHash/结果（不含secret），主进程可在新epoch通过同档案preview返回lastAppliedRestoreId供核实。文件输出的幂等收据若成功但目标文件被用户删/移，返回原artifact及ARTIFACT_MISSING提示，不再自动重新导出；用户明确新操作新id。

恢复后历史grant不适用于新dataEpoch，recognition与dataset用途分别重新征得同意；正常重启的epoch保持不变。consent.record的supersedesId必须指向当前链头（首次为null），并发提交过期头报VERSION_CONFLICT；可读授权摘要包含currentConsentId供UI带回，不按createdAt猜最新授权。

## 7. provider操作与规范化输出文字schema

### 7.1 provider接口（仅主进程内部，不直接暴露给UI）

provider不读数据库、不生成实体ID/已批准状态；调度器授予本次受限imageBytes句柄及取消信号。输出后还经主进程业务校验，不以JSON正确代替识别正确。所有操作无隐式分页；文件清单可能大时返回受限artifact句柄，不将全文件送UI。

| 操作 | 输入 | 输出/权限/幂等/可重试 |
|---|---|---|
| recognitionProvider.capabilities | providerId、adapterVersion | supportsImage、structuredOutputStatus:unverified/verified/unsupported、trainingSubmitSupported=false、model、probeEvidenceId可null；只本地已安装配置读取，R、无副作用；官方文档有图片能力不等于本机组合verified |
| recognitionProvider.recognize | requestId、jobId、generation/attempt、model=deepseek-flash、promptVersion、bk-candidate.v1、prepared imageBytes/mime/hash、categories(id/name≤500)、timeoutMs=90000、abortSignal、secretHandle（主进程不可序列化）、consentScopeHash | ProviderResult或规范化错误；U；无分页；没有服务端幂等保证，每次发送可能收费；内部不重试，交job调度；mock同结构并provider=mock，不得伪造actualModel或requestId |
| trainingAdapter.prepare | datasetVersionId、exportManifestHash、purpose:future_training、authorized sample/artifact句柄、adapterVersion | preparedArtifactId、formatVersion、sample/group/kind计数；D、本地转换、不出网；按manifestHash+adapterVersion幂等；本地临时错误可重试，不产生权重 |
| trainingAdapter.validate | preparedArtifactId、manifestHash、schemaVersion | valid、issue列表/报告句柄及真实计数；D、本地只读/R；S12前SPEC_NOT_READY，不能报质量通过 |
| trainingAdapter.submit | preparedArtifactId、manifestHash、targetProvider、explicitTrainingConsent | 首版固定错误UNSUPPORTED（wire code固定大写，reason=unsupported，retryable=false），无remoteJobId/权重/任务/进度/费用；D、无副作用；禁止编造DeepSeek微调endpoint/参数 |
| trainingAdapter.status | remoteJobId、targetProvider | 首版固定UNSUPPORTED、retryable=false；不存在的训练不能返回completed；D、无副作用/无分页 |
| trainingAdapter.evaluate | datasetVersionId、promptVersion、provider、seed、scope、授权句柄及abortSignal | 交本地EvaluationRun runner，返回runId及真实五态/逐样本结果清单/版本与Metrics；D，deepseek另U；只评推理，不声称训练；runId幂等，收费样本重试按job规则，合成与真实分列。状态经evaluation.status读取 |

ProviderResult元数据（适配器可信部分）：provider=deepseek/mock、adapterVersion、requestedModel、actualModel:string或null（仅真实返回才填）、providerRequestId:string或null、startedAt/finishedAt、Usage或null、result:下面模型语义对象。模型不能自报并覆盖可信元数据；模型返回的schema字段只是待校验内容。配置名deepseek-flash不能代填actualModel。无key不尝试网络；不复用DSH凭证。provider HTTP原响应只在内存解析，记录安全错误码与计数，不持久化完整正文。

### 7.2 模型语义对象（非官方HTTP参数）

根必需键只有schemaVersion=bk-candidate.v1、candidates数组0～100、warnings数组0～20。所有模型输出≤256KiB UTF-8，嵌套深度≤8（root算1，数组算层），未知键/多余正文/Markdown围栏/重复JSON键/截断/超长均OUTPUT_SCHEMA_INVALID整图失败，不从自由文本“抢救”部分金额。warnings是code/message/field三字段对象，主进程不信任模型的severity/resolved。以下Proposal为candidates每项完整字段；所有键都须存在，未知显式null。

| Proposal字段 | 类型/nullable与长度 | 校验语义 |
|---|---|---|
| amountFen | 规范化后Money整数或null；结构层先接受安全整数再做业务范围校验 | 已知实付金额；不确定/非CNY/超本地范围为null并警告，不能隐式汇率换算。格式非法（字符串/小数/超安全整数）整图schema失败；业务范围外整数（含0或负数）规范化为null并保留原文证据，不据负数作退款抵扣 |
| occurredDate / occurredTime / timePrecision | Date或null / HH:mm或null / unknown,date,minute | 规则ARCHITECTURE§2，日期或年份无法证实即date/time=null、unknown；部分原文保留evidence；合法格式但不存在日期规范化null+DATE_UNCERTAIN，不能自动修日 |
| name | Text100或null | 明确购买物/服务名；商户名不能自动填name；无可证购买物为null |
| merchant | Text100或null | 与商品分开，不能作为name兜底 |
| categoryId | 所给分类ID或null | 模型不认识的ID规范化null+CATEGORY_UNKNOWN，原证据留存；不自动改其他 |
| transactionKind | expense/refund/transfer/income/failed/closed或null | 无法证实交易状态为null；非expense（含null）阻断审核，须人工核实改正或拒绝 |
| amountBasis | paid_total/line_payment或null | paid_total用于一个订单/支付合计；line_payment仅证据表明独立付款的多笔；未知为null，不能把订单商品行都作付款 |
| groupKey | ASCII 1～64或null | 本图候选所属同一订单/支付组，仅本图局部标签，非正式订单ID；无可证关系为null |
| lineItems | 0～100个{name:Text100或null,amountFen:Money或null,evidenceIndexes:整数索引数组} | 是候选的解释明细，永不自动变成正式交易；优惠/原价可在evidence文本保存，不能作可批准明细金额或与实付重复累计 |
| evidence | 0～50个Evidence对象 | 每个非null金额/日期/名称/商户/分类/交易状态都要相应证据；缺证据主进程加EVIDENCE_MISSING阻断，允许用户对照原图补填并写human原因，模型不能虚构证据 |
| missingFields | amountFen/occurredDate/name/categoryId字段枚举去重数组 | 主进程根据current null/合法性重新生成，与模型自报不一致追加MODEL_MISSING_MISMATCH；可选time/merchant未知不阻止仅日期交易 |
| warnings | 0～20个{code,message≤500,field枚举或null} | code仅AMOUNT_AMBIGUOUS/DATE_UNCERTAIN/NAME_UNKNOWN/CATEGORY_UNKNOWN/NON_EXPENSE/TOTAL_DETAIL_AMBIGUOUS/BLURRY/INSTRUCTION_IN_IMAGE/OTHER；主进程派生阻断等级，不接受模型宣称“安全” |
| confidence | 0～1有限数字或null | 仅提示，无自动批准权；无法取得为null，禁止拿高分掩盖缺字段 |

Evidence对象固定字段：field（上述字段名或lineItems/transactionKind/amountBasis）、text:string≤500或null、region:{x,y,width,height}或null、source:枚举image。region为相对于实际上传prepared图的0～1有限小数；width/height>0、x/y≥0且x+width/y+height≤1。text和region至少一个非null；无定位用原文，不能伪造坐标。AI坐标只是提示，不具OCR真值保证；主进程补imageAssetId/preparedHash，模型不能指定另一图。用户修改另写FieldChange={field,before,after,origin=human,reason≤500,at:Instant}进ReviewEvent，不改原evidence。

主进程合并Proposal到Candidate：id/job/image/ordinal由本地产生；proposal不可变，current复制可编辑字段；missing由实际值计算，warnings加入模型/本地派生，缺失/非支出/重复/总计歧义均blocking。warnings不认识code不是默默清掉，而是OUTPUT_SCHEMA_INVALID；可读无意义文本按纯数据处理。共用paid_total group同时有总计候选和其商品行候选时，整组加TOTAL_DETAIL_AMBIGUOUS，保留待用户核实，不能同时批量批准。若无法可靠确定关系，amountFen=null并保留原文/歧义，不猜拆单规则。

### 7.3 不可执行数据例子（均为合成示意，局部列示）

下面表省略的字段仍须按§7.2补齐；不是可直接传provider的JSON、正式schema或真实消费样本。分类ID使用“餐饮对应的S03稳定ID”等文字，S03落定后再生成真实测试夹具。

| 例子及可见事实 | 应形成的Proposal/current | 不允许的结果/批准条件 |
|---|---|---|
| A 一张订单：米饭18.00、汤7.00，原价25.00、优惠5.00、实付20.00；日期2026-09-08；明确已支付 | candidates只有1项：amountFen=2000、date=2026-09-08、time=null、precision=date、name=米饭和汤、merchant可null、categoryId=餐饮稳定ID、kind=expense、basis=paid_total、groupKey=本图订单1；lineItems保留1800/700和证据 | 不生成1800+700+2000三笔，不把优惠500记正支出；明细总和不等实付并不自动改变2000；人工确认实付/日期/名称/分类后才入账 |
| B 同张消费列表：2026-09-08 12:10午餐18.00已支付、18:30晚餐10.00已支付，证据表明独立付款 | candidates两项，各amountFen=1800/1000、独立region/text、timePrecision=minute、kind=expense、basis=line_payment、不同groupKey或null；同图job但ordinal分别0/1 | 不能因同图只建一笔，也不能默认把总计2800再建第三笔；分别确认，各唯一候选来源；批量preview count=2/totalFen="2800" |
| C 某商户支付12.00已支付，完整日期2026-09-08，但没有购买内容 | amountFen=1200、date已知、time=null、name=null、merchant=可读商户、categoryId=null、missingFields至少name/categoryId；NAME_UNKNOWN | 不把商户复制为确定商品，不猜“日用品”。用户输入“早餐”并选餐饮、有human原因后重新确认；仅将类改其他也不能跳过缺名称 |
| D 商品照片只有商品外观，没有金额/购买时间/支付状态 | amountFen=null、date=null、time=null、precision=unknown、name可读且可证时填否则null、merchant=null、categoryId可null、kind=null、basis=null；缺amount/date等 | 商品照不证明发生支出；用户必须补有效金额/完整日期/购买物/分类并核实expense；不得用导入当天、0分或自猜市场价 |
| E 支付图写09月08日12:10，缺年份；实付18.00，名称午餐 | amountFen=1800、occurredDate=null、occurredTime=null、precision=unknown、name=午餐；原文“09月08日12:10”放evidence；DATE_UNCERTAIN | 不按当前2026年补年份，不用星期反推；用户填完整日期后可以选择只保留date（time=null）或确认12:10后minute |
| F “合计100.00”旁有若干看不清的订单/退款状态 | amountFen=null、kind=null、basis=null，TOTAL_DETAIL_AMBIGUOUS/NON_EXPENSE，保留合计证据 | 不把合计直接当已支付10000分，不同时导入疑似明细；人工核对或拒绝。若可证退款，kind=refund、已知金额可正值保留作候选证据，仍不可入账为支出 |

这些例子只解释结构与审计边界。S03提供完整可手算夹具，S09提供有使用权合成探针图片，S12/14提供独立授权的人类真值/质量分母；五张视觉参考图不成为样本。

## 8. 错误码、回滚与可重试性字典

实现不得把未知异常转换ok=true。以下分组内每个斜线分隔值都是单独稳定code；默认retryable=false，只有明确标R/I/U的暂时错误可true。字段错误的fieldErrors定位具体字段；永久错误改输入/密钥/状态后是新的用户操作，不是自动重试。

| code | 意义与用户处理 | retryable/提交规则 |
|---|---|---|
| CONTRACT_VERSION_UNSUPPORTED / PAYLOAD_INVALID / FIELD_INVALID / PERMISSION_DENIED | 版本/未知键/类型/越权，拒绝IPC | false；0写入，不输出危险原值 |
| STALE_EPOCH / SNAPSHOT_STALE / TOKEN_EXPIRED / REVIEW_STALE | 恢复后世代、分页快照、确认有效期或复核数据变化 | false；重新读取/预览后新操作，不自动套旧人工确认 |
| NOT_FOUND / STATE_CONFLICT / VERSION_CONFLICT / VERSION_EXHAUSTED / COUNTER_EXHAUSTED / IDEMPOTENCY_CONFLICT | 对象/状态/CAS/版本或计数上限/同键改载荷 | false；0写入，只有VERSION_CONFLICT返安全currentVersion；已批准重发特例返原结果 |
| AMOUNT_INVALID / AMOUNT_TOTAL_OVERFLOW / DATE_INVALID / RANGE_INVALID / FUTURE_PERIOD / FUTURE_POINT / POINT_OUTSIDE_SCOPE | 单笔或累计、日期/周期错误 | false；整操作拒绝不舍入/截断 |
| CATEGORY_DISABLED / CATEGORY_NAME_EXISTS / CATEGORY_PROTECTED / CATEGORY_LIMIT / ICON_INVALID / TRANSACTION_DELETED | 分类/交易操作不合法 | false；修改选择或刷新 |
| IMAGE_FORMAT / IMAGE_DECODE / IMAGE_TOO_LARGE / IMAGE_DIMENSION / IMAGE_REGION_INVALID / IMAGE_NOT_PREPARED / BATCH_LIMIT / IMAGE_IN_USE | 图片/数量/引用约束 | false；本地失败不上传；一图失败无半asset，batch import按逐文件结果 |
| REVIEW_INCOMPLETE / DUPLICATE_UNRESOLVED / NON_EXPENSE / EVIDENCE_MISSING | 缺字段/重复未核实/非支出或证据缺失 | false；修正并留人审事件，不能只关警告 |
| SECRET_REQUIRED / SECRET_INVALID / SECRET_UNREADABLE / SECRET_RATE_LIMIT / CONSENT_REQUIRED / PROVIDER_NOT_READY | 本地凭证/授权/provider就绪问题 | false（限频可返retryAfterMs但不自动重提secret）；手工可用。SECRET_SESSION_ONLY为成功结果提示码非失败code |
| PROVIDER_AUTH / PROVIDER_FORBIDDEN / PROVIDER_BALANCE / PROVIDER_INPUT / PROVIDER_UNSUPPORTED | HTTP鉴权/权限/账户/输入或能力问题，映射按已核实状态，不猜所有账户错误同为余额不足 | false；不自动重发图片，安全providerStatus可返；未知账户错误用PROVIDER_ERROR |
| NETWORK_ERROR / PROVIDER_RATE_LIMIT / PROVIDER_TEMPORARY / REQUEST_TIMEOUT | 网络、429、已确认临时服务问题、90秒超时 | true/U；job调度最多2次自动重试；取消/失效generation不能重试，超限failed |
| PROVIDER_ERROR / OUTPUT_SCHEMA_INVALID / OUTPUT_TOO_LARGE | 非临时未知provider错误、格式/业务结构异常、输出超限 | false；失败整图不写候选；用户明确重试可可能收费，不静默再调用“修JSON” |
| INTERRUPTED / CANCELLED | 重启中断/用户取消或授权撤回导致中止 | false；持久终态，手动retry才新generation；迟到响应丢弃 |
| DB_BUSY / FILE_BUSY | 有界等待后锁或临时占用 | true/I；全部事务回滚，原键可重试；不能重新发已有成功HTTP来解决DB_BUSY |
| STORAGE_FULL / STORAGE_UNAVAILABLE / INSTANCE_LOCKED / MAINTENANCE_MODE / INTEGRITY_ERROR | 空间/目录/多实例/维护/一致性失败 | false；保留旧数据，INTEGRITY_ERROR停止业务写入，按恢复处理 |
| SCHEMA_TOO_NEW / SCHEMA_UNSUPPORTED / MIGRATION_FAILED / RECOVERY_REQUIRED | 版本或迁移失败 | false；回旧快照/正确版本，禁止覆盖空库 |
| BACKUP_INVALID / BACKUP_LIMIT / HASH_MISMATCH / BACKUP_FAILED / RESTORE_FAILED | 备份损坏/限额/校验/快照/切换错误 | false；旧active不动，保留pre_restore；人工处理后新预览 |
| EXPORT_FAILED / ARTIFACT_MISSING / USER_CANCELLED | 导出失败/外部副本不再存在/用户取消对话框 | false；未成功不落成功收据；已有成功收据返原artifact，要求显式新导出 |
| DATASET_INVALID / DATASET_WITHDRAWN / DATASET_LOCKED / LICENCE_REQUIRED / SPLIT_LEAKAGE / SPEC_NOT_READY | 标签/授权/版本/许可/组泄漏/后续指标规范未就绪 | false；整版本导出/评测不偷跳过无效样本；结构校验不报质量通过 |
| UNSUPPORTED / NOT_IMPLEMENTED / INTERNAL_ERROR | 首版训练明确不支持/S04未实现入口/未分类内部故障 | false；无假任务/进度；INTERNAL_ERROR仅安全关联ID，写入失败全回滚 |

DB提交失败如已拿到有效provider结果，可在本次主进程内暂存受限规范化结果、原栅栏不变时只重试本地事务（最多5秒内），不重新HTTP。持久提交最终失败则job置failed（若磁盘无法写则启动恢复为INTERRUPTED），无候选；不能出现completed但候选只写一半。所有文件变更先临时写/校验/换名，有引用后才清孤儿；事务与外部文件不能假称同一个SQLite事务，需要恢复日志/可重复本地提交保证。

## 9. DeepSeek事实、项目选择和S09待验证清单

2026-10-20重新读取[官方更新记录](https://api-docs.deepseek.com/updates/)：当前调用名deepseek-flash；该别名可能改变底层版本，运行记录requestedModel和实际返回actualModel。重新读取[JSON Output](https://api-docs.deepseek.com/guides/json_mode/)确认JSON输出与业务校验分开；本次不据此推定图片+JSON组合可用。[Vision官方页面](https://api-docs.deepseek.com/guides/vision/)本次两次抓取超时，图片输入继承开发方案2026-10-20的来源记录，S09必须现场重读并用项目账户实测。

项目选择固定HTTPS api.deepseek.com profile，方案拟用/chat/completions和内联预处理图；本文件的schemaVersion/candidates是项目内部协议，绝非声称官方原生字段。HTTP内容块、JSON模式、输出长度、思考/流式等参数只使用S09当时官方说明和探针验证过的组合，不在S02猜值或写可执行请求。S09记录所用官方来源日期、adapter/prompt/schema版本、合成图hash、请求是否含图、返回可核对字段、requested/actualModel、耗时/Usage（未知null）、脱敏错误及是否真正通过G2。探针无真实key、完整headers、图片base64或真实账本。配置无效/未获上传费用同意则未执行，不用mock替代。

## 10. S04/S05 接收补充（2026-10-20，修订 S02-1.1）

本节是 Codex 对 DSH 交接缺口的文字裁定，优先于前文同项简写。bookkeep.v1 保留，以下给出显式输出映射及阶段适配。S05经R1/R2修复后已由Codex接收通过，见evidence/RECEIPT-S05-R2/RECEIPT.md；此接收不升级AC整项或G门，后续步骤要求仍按本节执行。

### 10.1 原提交修订号与当前水位

MutationReceipt 可以有内部 revision_at_commit，回放原对象/version 时不得将该值赋给当前账本水位。成功/失败信封 dataRevision 表示响应时当前持久账本修订号；同 epoch 内不能因回放倒退。恢复后的新 epoch 可有较低 revision，客户端须按 epoch 分开处理。

§3 的 Category/Transaction 变更输出简写正式映射为 data 对象：分别含 category 或 transaction、replayed:boolean、committedRevision:非负安全整数。首次提交与同键回放的 committedRevision 均为该次原提交值；业务对象仍为原提交快照。这样既保留幂等结果，又不将历史修订号混入当前信封。category.list 的 revision、transaction.list 的 snapshotRevision 仍是各自读取的当前快照，不因其他请求回放而降低。该元数据已由DSH在R1实现，本次R2重复回归通过；完整IPC写入交错仍未动态执行。

恢复令牌的 epoch/revision 必须与 commit 时当前持久事实源比较；缓存只能在可证明同步时使用，不能由历史收据回写。预览后任何业务变更即使随后回放旧请求，也必须重新预览。成功恢复后旧 epoch 请求按原规则 STALE_EPOCH；不要为了“幂等”允许旧确认跨 epoch 覆盖。

### 10.2 S05 备份阶段适配与保留规则

S05 基础阶段允许 backup.create 在应用内部 backups 目录生成 DB-only 档案，仍必须 containsPrivateDataAcknowledged=true；backup.restore preview 暂以已登记 backupId 选择，commit 仍需 restoreToken/currentDataWillBeReplaced=true/mutationId。这些内部操作只需 W/R 校验；§6 的对外保存/选择 token 流程和 F 权限仍是 S15 完整目标，不接受任意路径参数。

backup.list 正式登记为受限只读操作；S05 暂可空输入返回现有 records，输出与实体同名字段对应且不含任意路径。该全量目录是阶段例外，S15 须按 §2 分页，不能静默截断或因此删除备份；分页规格由Codex在S15任务书先固化，再实现与回归，不静默改变契约。

独立备份目录不应随账本回退而不可访问：恢复后必须保留所选备份、较新备份及 pre_restore 的可发现/可校验/可选择状态；坏档案显示错误，不能伪造可恢复。不得通过合并旧交易/审计来保留目录。此项适用于 S05 基础验收，见 BK-S05-002。

S05-R1复验补充（D41/BK-S05-003）：重建目录须保留已有创建记录中的原始archiveHash。数据库/目录已有可信记录时，文件当前实算hash只作比较，不能因目录缺失、扫描先行或恢复旧快照而重新采纳为原始基准。同id记录冲突必须保留原基准并明确标错/拒绝；不能由读取顺序静默改写。只在没有已知创建基准的独立档案发现路径，才按导入/发现规则处理；不能将“已知档案不匹配”伪装为新发现来绕过校验。此项是既有坏hash拒绝的澄清，不要求S05提前完成S15全部加固。

S10/S11 在附件/候选建立后扩展备份清单与关联校验；S15 补对外选择/保存、恢复操作状态核实、文件/收据补偿、维护锁、故障注入、限额及孤儿处理。当前 .bkdb 内嵌 manifest 的 files 记录的是加 manifest 前 DB 快照 hash/size，仅为 S05 内部格式适配，不能声称符合最终逐文件清单校验；S15 必须统一正式格式并保留对已有基础档案的显式兼容/转换说明。

### 10.3 其他交接裁定

- 单账本阶段由主进程绑定当前 ledgerId，现有载荷无需重复传入 ledgerId；对象仍需校验同账本归属，恢复后旧 epoch 失效，不放宽为多账本操作。
- transaction.list 省略 filter/page 时默认无日期、无分类、无名称过滤、deleted=active、limit=50、cursor=null。category.create 省略 sortOrder 时按当前最大值与340的较大值加10生成，最小350；超999999拒绝 FIELD_INVALID，不越界或回绕。
- S04 错误 details 可增加受限 capability/step/reason；现有 operation/counter 只允许本地操作名/计数器名，不能携带用户原文、SQL、路径或模型正文。未知键/结构错误用 PAYLOAD_INVALID，已知字段取值用 FIELD_INVALID 或已有 AMOUNT_INVALID/DATE_INVALID 等领域错误。
- mock 的 structuredOutputStatus=verified 只表示本地结构校验，不代表 DeepSeek 图片支持、质量或 G2；skeleton.mockRecognition 不落正式账，S10 替换后移除临时通道。
- sourceCandidateId 的唯一索引可作为 S05 内部预留，S11 必须加入真实候选关联和批准原子事务，现状不能算 AC10/11 通过。S09 前的 secret stub 不扩展成真实存储。
- UI 失败重试必须持有原 mutationId；S06 记账表单落实，备份维护 UI 最迟 S15 同步，不以禁用按钮代替持久幂等。

S06落实补充（D45）：preload向渲染层ApiResult透传既有信封dataEpoch/dataRevision元数据（旧调用方可忽略）；MutationOptions允许显式dataEpoch覆盖桥接缓存，表示调用方打开表单/确认操作时读取的世代，不是放宽主进程校验。S06列表读取保存信封epoch；新增/编辑/软删/恢复都绑定该值，STALE_EPOCH后只重读，保留输入对照且要求关闭重开。不同epoch分页即使revision相同也不能合并。来自旧请求的迟到信封不允许把已切换的preload缓存改回旧epoch。无新增通道或业务字段。

## 11. S07统计运行时映射（D47，2026-10-21）

既定四个statistics通道均为R/只读、要求当前epoch、不要求mutationId。payload严格要求period、anchorDate、categoryIds、snapshotRevision；topTransactions另要求pointDate，topCategories另要求pointMonth（整周期null）。拒绝未知键、名称/删除筛选、超过500分类与非法revision；日期/周期领域错误由服务返回。

scope完整字段：scopeId（规范字段SHA256）、period、anchorDate（规范为周期start）、categoryIds（去重ASCII排序）、ledgerId、dataEpoch、revision、today、timezone、start/end/effectiveEnd。snapshotRevision=null首读；后续请求带首次revision。相同周期内anchor等价；scopeId还绑定today和epoch，因此恢复或午夜不能混用旧序列/详情，即使revision相同。渲染校验series/summary/排行/分类字典的revision/epoch，点详情额外核对scopeId和点总额；冲突整组重取，最多3次后明确错误，不显示0冒充成功。

summary.categoryTotals和topCategories(pointMonth=null)为实际有支出的全分类排行，零支出返回[]，不补虚假项目。pointMonth非null先全月聚合再截3项，其ratioPercent以该月全额为分母。金额/日均/占比精确整数半入四舍五入，只有图形像素与progress宽度用近似数。接口与数据库版本仍bookkeep.v1/schema1；完整类型见src/shared/statistics.ts，运行时白名单见src/shared/ipc.ts。S07仅实现自测，S08另轮验收。
