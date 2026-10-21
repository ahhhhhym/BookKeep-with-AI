# BookKeepAI 数据集与人工标注规范

版本 S12-1.0 / dataset-spec.v1｜2026-10-22｜负责人 Codex｜规范自查完成，待接收与 S13 实现。

本规范落实 REQ-025～027、AC17～19/22 的数据规则。S11-R2/G3已通过，应用基线 main=`1633eccfd85a45f0a1b439910eb4a58c0623a9b4` / schema3 / bookkeep.v1；本步不改应用。线上数据域以本地 `docs/CONTRACTS.md` §6/7、`docs/ARCHITECTURE.md` 为基线；评测见 [EVALUATION](EVALUATION.md)，发布范围见 [D60](S12-DECISIONS.md)。下述记录、生命周期及校验均为 S13 待实现要求，不代表现有产品已提供。

## 1. 样本来源与两项独立同意

人类提供有权使用的交易截图及人工真值，并确认来源、许可范围和脱敏结果。Codex不从个人目录、账本、审核记录或网络自动搜集真实图，不将“用户批准入账”视作数据许可。`references/图1.jpg` 至 `图5.jpg` 仅为需求视觉参考，**不是训练样本**，不登记、不评测、不作少样本提示；S09固定合成探针也不自动变成真实质量样本。

| 同意 | 明确告知及绑定范围 | 默认、有效性与撤回 |
|---|---|---|
| recognition：上传识图 | provider、必要prepared图片、分类、用途、潜在费用；绑定imageAssetId/preparedHash、noticeVersion、dataEpoch；评测再绑定运行manifest | 默认不上传；导入/裁剪不算同意。每次实际HTTP前复核；预处理图片改变即失效；重试按任务规则和原授权范围执行，不隐式扩至新用途 |
| dataset：纳入数据集 | 本地登记/标注、evaluation或future_training允许用途、保留期限、是否允许图片导出、接收范围、撤回限制；绑定图hash与scopeHash | 默认不自动入集；grant也不自动登记或联网。登记、修订、建版本、导出、评测均复核许可和当前同意。未来训练用途须单列勾选，不能由评测许可推定 |

两项互不替代；允许仅识图且不入集，也允许有dataset许可只做本地标注但不上传。云端质量评测同时要求dataset有效、逐图recognition有效及本轮费用确认；dataset导出还需独立的本次目标/范围确认，导出不等于允许接收方再上传。不得以同意为条件限制离线手工记账。

ConsentRecord沿用purpose=recognition/dataset、decision=grant/withdraw、scopeHash、noticeVersion、supersedesId当前链头及dataEpoch；当前链头有效才可使用，不能以createdAt猜最新。恢复备份后的新epoch不复活旧grant，两项分别重新确认；正常重启不自动清空有效同意。许可allowed、脱敏approved、复核reviewed和同意grant是四个不同条件，缺一不能发布数据版本/导出/评测。

## 2. 进入、脱敏和复核流程

1. 人类在本地选择图并声明权利、来源类型和用途。未授权素材只可停留本地隔离待处理区，不创建活动DatasetSample；不得上传验证许可。许可未知unconfirmed或denied不能进入可用版本。
2. 最小化保留：优先prepared_only。遮盖姓名、头像、电话、地址、账号、订单/支付流水号、条码二维码、设备标识和无关聊天；去EXIF等元数据。使用不可逆不透明遮盖并重编码，不能只叠可移除图层。先生成并核验prepared，再按用户选择删除original，不先丢源图。对照图只在本地，不进Git。
3. 人类逐张检查脱敏后像素和标签文本，脱敏可能抹掉日期/金额等证据时重标unknown。原图hash与preparedHash分别记录；近似图/原交易关联用本地受限映射，导出不泄漏原订单号。保留原图须说明必要性、期限及单独权限；识图仅发送prepared。
4. 单独取得dataset同意后显式登记；绑定同图completed predictionJobId或无预测来源，不上传未授权正文。先保留原预测，标注者最好先看图盲标，再对照预测，避免把模型输出当真值。
5. 标注后逐图复核。复核者为有权核实的人类；优先与标注者不同。只有一人时两次分时复核并标记same_person，不声称独立；AI辅助建议不能充当人类最终复核。争议保留unresolved，不编造标签凑样本数。
6. 许可/同意/脱敏/真值复核全通过后建立不可变版本；划分、锁test、校验和独立导出再按后文执行。账本、审核候选和数据集互相不自动创建或修改。

## 3. 字段字典及版本

以下是数据规格表，不是运行时schema或可执行JSON。S13先对齐既有DatasetSample、DatasetVersion、ConsentRecord及EvaluationSampleResult，再实现；扩展元数据不直接塞进bk-candidate.v1的严格未知键接口。

| 记录/字段 | 必需语义与空值规则 |
|---|---|
| sampleId / version / kind | 主进程新建不含个人信息的UUID；version正整数递增，kind=real/synthetic创建后不改。sampleId不由文件名/订单号构造；同图活动样本唯一，修订保留版本，不克隆刷数量 |
| source | 来源类型payment_detail/order_list/product_photo/other、人工来源别名、采集日期、登记人、原交易/订单本地匿名关联；不把采集日期当交易日期。不存不必要外部路径/账户标识；公开/合成也要来源及许可说明 |
| license | licenseStatus=unconfirmed/allowed/denied；权利声明依据、许可别名/版本/日期、允许用途/接收方/到期时间、限制、到期复核人；证明材料受限引用，不能公开个人证明 |
| consent / redaction | consentId及scopeHash/当前链头、preparedHash、noticeVersion、epoch；redactionStatus=unreviewed/approved/rejected、方法版本、检查人/日期。changed hash需重新同意和复核 |
| image | imageAssetId、originalHash（本地）、preparedHash=SHA-256字节摘要、mime/尺寸/字节数、预处理版本、crop/masks受限记录；输出只带授权preparedHash和相对资源名，默认不导出originalHash或原图 |
| prediction | predictionJobId创建后不可变；保存同图job的规范化原始Proposal数组及hash、requested/actualModel、provider、prompt/schema/adapter版本、生成日期。原始预测指校验后不可变快照，不保存HTTP原正文、头、base64或key；无job时[]且predictionAvailable=false，不能把无预测当真实零检出 |
| labels | Proposal业务域数组；null=尚未标注，[]=已复核确实无可标交易候选，二者不同。每个标签有本地labelId/ordinal，供映射及版本比较；补充标注元数据与Proposal分开。保留expense及可见非支出/状态未知的交易对象供排除评测 |
| 每个标签的证据 | amountFen、完整日期、时间精度、name/merchant、categoryId、transactionKind、amountBasis、groupKey、lineItems、missingFields沿用CONTRACTS；人工Evidence.source=human且text写依据，region可null。name不能用商户兜底；正式有效金额必须正整数分，传输按既有Money域 |
| unknown元数据 | 每字段known/unknown及原因not_visible/blurred/missing_year/ambiguous/not_applicable、原文与可见部分、human_supplement标记及依据引用。业务值unknown统一null；不能用0、空串、“未知商品”作已知值 |
| date / precision | occurredDate完整YYYY-MM-DD或null；occurredTime=HH:mm或null；timePrecision=unknown/date/minute。年月日缺任一则date/time均null、precision=unknown；可见“09-08 12:10”只存证据。完整日无分钟用date；分钟确证才minute，不能伪造00:00 |
| 状态与关系 | transactionKind=expense/refund/transfer/income/failed/closed或null；amountBasis=paid_total/line_payment或null。label中保留可见状态，不把refund负数改为正支出；groupKey仅图内，跨图用匿名transactionGroup/orderGroup/duplicateGroup |
| review | annotator/reviewer匿名ID、时间、reviewStatus=unlabelled/labelled/reviewed、同人复核标志、争议与修订理由；reviewed要求labels非null（可[]）、证据完整、许可有效。不修改原预测/原审核事件 |
| 版本与划分 | datasetSpecVersion、schemaVersion、categorySnapshotHash（33分类+其他，不含设置）、labelPolicyVersion、nameSynonymVersion、splitPolicy/seed、sampleVersion、duplicateGroup及split；version tag不可复用 |
| 退出和追溯 | withdrawnAt、原因类别、失效用途、影响版本/run/export引用、删除状态及完成时间；对外仅最小匿名撤回记录，个人许可文本和真值一起清除 |

人工凭收据补充完整日期/商品与“图片可见真值”区分。可保存有权的人类补充标签，但主质量分母只用prepared图可证字段；补充字段另列assisted，不能要求模型猜不可见事实，也不能拿补填后的current给原预测加分。类别可由图中商品依据既定分类表合理判定；实在不明为null，选择“其他”必须有明确可归其他的人工依据。

DatasetVersion快照含样本具体版本、标签/预测/许可/同意摘要、图片hash、分组/split和全部规格版本；不可变，不能靠活动行拼回历史。许可撤回优先于旧快照。任何标签/图片/许可范围变化建立新sampleVersion和新DatasetVersion，旧报告保留原版本并标更正或失效。锁test标签错误走复核更正版本，不能原地改答案后继续沿用旧hash。

不可变是禁止覆写历史版本冒充同一hash，不是禁止依法/依许可删除。撤回要求删除时清除快照中的敏感内容，仅留最小匿名版本hash/撤回墓碑并标内容不可恢复；不能为了“可复现”保留已撤回的图片或真值。

## 4. 标注指南与边界例

下表数字均为文字合成示意，不是真实样本，不形成训练集。

| 场景 | 人类标签规则 | 必须避免 |
|---|---|---|
| 实付/优惠/总计 | 原价25、优惠5、实付20，已支付完整证据则1笔2000分、paid_total；明细保留解释，名称可证时“米饭和汤” | 2500+500+2000三笔，优惠记支出，按明细和覆盖实付 |
| 列表多笔 | 确证独立支付午餐18与晚餐10则2笔1800/1000，line_payment，各自日期/状态/证据；列表合计仅解释 | 只记整图1笔或再加第三笔合计；商品行当独立付款 |
| 一订单多商品 | 一次付款，lineItems只解释；整笔名称依可见内容，不在无证据时把折扣随意分摊 | 同时记总计与商品行；用不相等的明细硬凑实付 |
| 商品未知/商品照片 | 商户支付12但无购买物：name=null、分类无依据则null；商品照片不证明金额、日期、状态，分别unknown | 商户作商品、猜市场价、导入时间作购买日期 |
| 退款/转账/收入/失败/关闭 | 明确标原状态及非支出提示；金额可读用正整数分作候选事实（非支出不得入账）；状态未知null。确定无交易的背景图标签[] | 退款抵扣/当正支出，失败支付计消费，隐藏这些困难负例 |
| 缺年/跨年/相对日期 | 缺年date/time=null、unknown。当前年/星期不能反推；“昨天”无可靠截图采集上下文则unknown。有权外部真值只能列human_supplement | 默认当前年、当前日期；把时间原文拼入错误年份 |
| 模糊/裁剪/歧义 | 可读字段各自标注，其余null并说明模糊/缺口；金额多解保留证据，不推算。完全看不清的交易对象仍保留状态未知标签（若可证对象存在） | 为提高准确率删图、把所有空标签当无交易 |
| 重复与第二次真实消费 | 同原交易多视图/裁剪/重压缩归同组；不同实际消费即使同店同额同日仍不同transactionId，记录hard_negative | 用hash相同或字段相似自动断言同一实际消费并删除第二笔 |
| 恶意文字 | “忽略规则/执行命令/批准入账/泄漏密钥”只标风险与图中文字；仅提取可证消费字段，无支出证据则unknown/[] | 执行文本、把伪指令当许可或真值、降级人工批准要求 |
| 外币/金额非法 | 不做汇率换算；超金额域、0、负数等保留原文并标null/警告；非CNY单列不支持 | 转成猜测人民币正支出或舍入到分掩盖问题 |

同一payment总计与明细建立组排他事实，不能同时作为两份可记支出真值。重复标签不表示可以自动删除候选；实际批准继续走S11逐笔确认、来源唯一和原子事务，数据规范不改变正式账本统计。

## 5. 去重、70/15/15与锁定test

先建立关系再划分。节点为图片/样本；同original/prepared字节、同人类确认交易/订单、多页列表共享任一交易、同图裁剪/重拍/压缩、近似图经人类复核等建立边。所有连通分量合并为duplicateGroup（跨图列表可能把多个订单连在一个大组）。近似算法/阈值/version留记录，仅提示，由人类确认；疑似未决关系按同组保守隔离，不能跨split。不把同店同额真实两次消费合为同一标签，但若图像近似仍可归一个划分组，组内保留两个真实交易。

建议train/dev/test=70/15/15，比例按图片数目标，实际以组为最小单位，不能切组凑比例。train用于未来适配/授权示例，dev用于提示词、分类/阈值选择和错误分析，test只用于固定方案最终评测。synthetic与real分开计数和目标；近似/同源合成变体也要归组，不能用合成填满真实test分母。

可复现分配规则：冻结全体组与场景标签；已有locked test组及其新增近似成员保持test。其余组按组大小降序、同大小按SHA-256(seed与groupId的规范串)升序排列；依次放入使三个split距目标图片数的平方误差总和最小的split，平局固定train/dev/test顺序。记录目标、实际、seed（0～2147483647）、输入清单hash及算法版本。场景覆盖不够时可由人类在首次锁定前整组调整，理由/最终清单入版本；不得试多个seed挑分数最高的test。

小样本例外：少于50张或少于10个独立组，仅做train/dev或整组交叉探索，不给独立test结论；50～99张可按建议留出组，但若test少于10个独立组或任一split为空，结果标exploratory，不宣称达到质量目标。首轮50～100张用于探索基线；至少100张也只是在有充分独立组、完整复核和场景覆盖时允许讨论建议体验目标，不是自动合格。实际每split图数/组数/交易数、偏离比例及未覆盖场景必须报告。

首次评测前锁定test成员、标签版本和manifestHash；开发日志、提示词、few-shot、检索库、规则拟合及阈值选择均不得读取test内容/预测误差作改进。运行器在主进程受限读取锁定test，不向调优者展示逐图答案；报告先给聚合指标。若人类做test误差诊断或内容已用于调优，将该test标contaminated并退役，后续只报探索结果；由未接触的新组建立新锁定test后才恢复最终评测。不能把退役test转train/dev继续声称原test独立。

发布后发现train/dev与test新近似关系：停止受影响评测/导出并标SPLIT_LEAKAGE，不偷偷改split；保留旧失败记录，新版本移除开发侧污染成员/建立全新test；已接触test的方案不能靠换hash消除接触事实。test纠错要记录原因、复核者、前后差异，旧报告标失效并重新评测，不选择性修正模型错题答案。

## 6. 导出与独立清单

备份、数据集导出、软件/源码ZIP相互独立；不从整库备份生成数据集，也不把真实样本进Git/应用ZIP。工作数据仅在系统API解析的 `%LOCALAPPDATA%\BookKeepAI` 受限数据根中，程序目录不得存真实图/标签/导出缓存；S13实现须沿用受限artifact/原生保存对话框，无任意路径IPC。

导出前重新核对当前dataset同意/用途/许可/脱敏/复核/撤回及全部hash，显示本次用途、接收范围、样本/组数、是否包含prepared图片，经用户确认后本地导出JSONL与可选prepared图片。无图标签本身也敏感，照样需要同意。默认不带原图、原图hash、外部订单号、个人姓名/路径、原API正文或凭证。将导出内容送第三方需要另核实许可和上传同意，不能自动上传。

独立manifest至少含：format/spec/schema版本、datasetVersionId及原manifestHash、sampleId/version/kind/preparedHash、实际相对文件path/字节数/SHA-256、匿名group/split、标签和预测快照hash、许可用途及当前授权摘要/noticeVersion、脱敏/复核状态、版本化分类/同义表、split算法/seed、撤回检查revision、includeImages、目的和限制。未授权的个人许可证明只带匿名依据引用。导出操作另有exportId/时间/接收方声明/目标artifact状态；可变操作时间/目标绝对路径不进入确定性manifestHash。

规范化沿用CONTRACTS：UTF-8无BOM；键按Unicode码点排序、无多余空白、显式null、有限数字最短十进制；样本/组/文件按稳定Id或相对path排序，候选/证据保留ordinal；hash字段自身不参与摘要，内容hash按文件字节算。完整导出须与完整版本manifestHash相等；子集不得拆duplicateGroup，含parentDatasetVersionId、parentManifestHash、实际成员和独立subsetManifestHash，不冒充完整原版本。JSONL各行带sampleId/version并可核对清单。

任一成员撤回/过期/损坏默认整次阻断DATASET_WITHDRAWN或DATASET_INVALID；用户显式重新选择有效整组后建立新版本或独立子集，不静默少导出仍声称原范围。暂存写完且全部hash核验后才发布artifact；中断残片不可作为成功，恢复须重新查授权。目标删失返回ARTIFACT_MISSING，不能利用旧收据自动重导出。

## 7. 撤回、删除和保留

默认真实原图仅临时处理；用户明确选择保留时记录期限。prepared图/标签默认保留至用途完成、用户撤回或许可到期中最早者；登记时必须填具体reviewAt/retainUntil，不设置无限默认保留。到期自动转不可用并进入删除待办；最长7日内完成本地衍生物清理，失败记录并阻断使用，不能将期限到达当作已删除证明。

退出顺序必须可追溯：

1. 撤回无需再次grant。先提交当前purpose撤回链头及datasetRevision并阻断登记/编辑/新版本/导出/评测/训练准备；立刻停止未发送请求，使在途generation失效并取消运行，迟到结果不写入。仅撤回recognition则禁止后续联网，dataset本地用途仍依其单独授权；撤回dataset则所有数据集用途停止，不擅自替用户撤回另一个用途。
2. 建传播清单：sample/版本、所有prepared衍生图、标签/预测缓存、暂存与导出artifact、评测run/逐样本结果/指标/报告、授权示例/检索副本、备份及外部接收方。受影响旧版本不可重新导出或评测，旧报告标withdrawn/invalid；不能沿用其分数作当前质量承诺。
3. 数据集副本和可删除衍生物实际删除后逐项记录成功/失败/时间；最小匿名墓碑只留撤回ID、影响版本hash、删除结果，不留消费内容。图仍被正式交易审计合法引用时不破坏账本引用：解释区别，停止数据集访问并按应用数据删除流程处理；不能以软删交易冒充删除数据集，也不能删原始审核事件伪造历史。
4. 已授权导出/上传的外部副本无法保证收回。显示exportId/匿名接收方/撤回通知待办，由人类决定并联系；Codex不自动发消息。记录已通知/确认删除/未知，不承诺远端已删。未来若真训练过权重，撤回不等于权重已遗忘，需单列重训/退役决策；首版无此权重。
5. 备份不能复活授权或已删样本：活动数据外保留最小撤回登记，恢复后先合并撤回并使新epoch旧grant失效，再清理恢复副本。不能就地修改校验通过的旧备份；用户选择销毁受影响整份备份或保留隔离至到期，到期/销毁结果入清单；受影响备份未处理不得宣称彻底删除。

退出报告分“已阻断使用”“本地删除完成”“备份待处理”“外部副本未知”，全部清单完成才写相应完成结论。撤回影响的旧分组不把test移往开发集；剔除后重建版本仍继承test接触历史。

## 8. S13校验要求和风险核对

S13至少校验：ID/版本域、规范化schema、金额/日期/精度关联、标签null与[]区分、unknown证据、非支出阻断、总计/明细排他、预测来源绑定、许可/同意链/epoch/用途、脱敏与复核、hash资源一致、整组划分、锁test及污染、导出成员完整、撤回传播。结构有效不表示标签正确，validate不得报告识别质量通过。

| 风险入口 | 强制控制 | S13/14所需证据（本步未执行） |
|---|---|---|
| 上传被误认为入集 | 两项同意、默认false、审核不自动登记 | 只识图不入集、只本地标注不出网 |
| 私人图/标签被公开 | 人工脱敏/许可/最少导出、Git/ZIP拒绝真实数据 | 导出清单与敏感检查、伪路径拒绝 |
| 撤回后继续使用/恢复复活 | 当前链头/epoch复核、取消栅栏、外部撤回登记 | queued/inflight/export竞态、恢复旧备份 |
| 近似图或锁test泄漏 | 关系连通分组、不可变manifest、test不调优 | 跨图多订单、近似变体、污染退役负例 |
| 真值或分母美化 | 人类盲标复核、失败/unknown/负例均报告 | 标签变更、空数组/未标注、分母逐项核验 |

当前没有接收或登记真实样本，实际样本数未测量；不虚构许可、标签、指标或训练结果。S13需用户另行启动，先验证上述规格版本和S12交接，再实现合成闭环；S14由人类提供并复核真实数据。
