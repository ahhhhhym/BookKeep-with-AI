# BookKeepAI 评测与未来训练适配规范

版本 S12-1.0 / evaluation-spec.v1｜2026-10-22｜Codex｜规范自查完成，待接收；无训练或评测代码。

本规范与 [DATASET](DATASET.md) 配套，细化本地CONTRACTS §6/7及开发方案§5，覆盖REQ-026/027和AC17～19。S11-R2/G3证明审核、事务与持久化闭环，不证明私有截图识别质量。本轮没有运行评测、调用收费API或训练模型，所有配额和门槛都是计划值，不能当实际成绩。运行权限、保留与撤回规则一律先满足DATASET；[D60](S12-DECISIONS.md)规定本次公开文件边界。

## 1. 两种评测与不可变运行输入

| scope | 可以证明 | 不能证明 |
|---|---|---|
| framework + mock | 合成真值的登记、校验、分组、导出、指标计算、状态和取消/重试可复现 | 真实模型识别能力、真实API用量/费用、训练权重效果 |
| quality + deepseek | 当前有效授权的真实prepared图与盲标真值，在固定版本/场景上的实际推理结果 | 未覆盖人群/截图、未来模型版本、未经验证的跨系统体验、完成权重训练 |

quality必须真实provider；mock+quality拒绝，不能把预填预测作为真实API本轮结果。synthetic+真实provider可报合成图推理质量，仍不进入real分母。无预测来源的DatasetSample.prediction=[]不等于本次评测返回零候选；本轮预测必须来自EvaluationSampleResult（completed空数组才是有效零检出）。原预测快照仅用于独立的before-review对比，不能混入新run。

主结果评的是版本化“provider推理→规范化/缺失与风险派生→候选”链路，必须标outputLevel=pipeline；派生missingFields、应用重复检测和人审指标不能宣称为模型裸输出能力。若另外分析provider层，只用实际保留的安全规范化预测字段并单列outputLevel和适用指标，不储存HTTP正文来做旁路评分。

每个run冻结：runId、应用/runner commit与构建版本、datasetVersionId/manifestHash、样本具体版本/hash、group/split/锁test及接触历史、数据/标注/评测/schema/adapter版本、分类快照与购买物同义表、prompt文本hash/版本、provider请求model与实际返回actualModel集合、白名单安全配置、seed、开始/结束UTC、账本时区Asia/Shanghai、授权/费用确认摘要。配置可变的模型别名不能冒充不可变模型版本；实际model未返回写null及限制，不自行填猜测内部名。

运行前记录planned图片数、组数、可见交易对象数、目标支出数、非支出/状态未知数、每指标可用机会数及场景数。执行记录completed/failed/cancelled/unprocessed、实际attempt与失败码、有效评测结果hash、授权revision。重复重试不重复增加计划图片数或真值分母，所有真实attempt均计耗时/费用；默认重试沿用CONTRACTS识别调度上限，不为挑最好结果重跑。

结果仅使用统一固定的最后一次有效规范化响应；重试选取规则预先锁定，不以分数择优。schema失败/输出超限整图failed，不能抢救正确金额来加分。partial报告不能称全量完成；撤回/取消导致运行终止时标partial/invalid，已处理子集只供诊断，不用于质量达标结论。

## 2. 真值、匹配与unknown统一规则

图片可见且人类复核可确定的字段为known；不可读、缺年、无商品证据等为unknown=null。人工凭外部收据补填的值为assisted，不入图片可读字段分母。未标注labels=null不得参与质量评测；reviewed的[]为确定无交易对象，可参加空图误报率。GT支出集合G为可证expense且是独立支付的对象，即使金额/商品/日期未知也可作为一个应检出的不完整候选；非支出和状态未知单独计数，不混作支出FN。

匹配先于字段评分，禁止按模型金额/日期是否正确挑选对应真值。基线采用冻结的人工盲对齐清单：复核者只看prepared图区域/来源行、预测证据定位与候选序号，隐藏被评的金额/日期/名称/分类值；建立predictionOrdinal→labelId一对一映射并留理由和复核标志。证据区域相同/来源行明确才对齐，完全无法定位则不匹配；重复输出同一对象最多一个TP，其余FP。图内相同重复区域时用预先标注的阅读顺序/ordinal作平局规则，不能按得分选最佳。S13先支持有预定映射的合成夹具及人工确认映射导入，不假定已有自动语义匹配器。

候选规范化后transactionKind=expense或null均算“可能支出建议”P，防止把不确定候选藏出误报分母；已正确标refund/transfer/income/failed/closed不进P，另评非支出提示。对齐到expense的P为交易TP；对齐非支出/不明状态、无对应对象或重复多出候选为FP；未对齐的expense真值为FN。误把真实expense标成refund等不进P，但该expense算FN。

主字段准确率采用端到端分母：G中该字段图片可读known的所有机会，包含漏检图、请求失败和未知预测；只有正确对齐且值完全合规匹配才进分子。这样不能靠丢掉难图获得高准确率。同时可报matched-only诊断指标，必须标条件分母并并排主指标，不能替代主指标。

未知预测对已知真值是错误；对unknown真值的非null猜测不是正确答案，计unknown误填。unknown对unknown不计入已知字段准确率，而计缺失提示指标。日期/金额/名称/分类各自决定unknown，不能因一字段不明删整张图。所有比率报告整数numerator/denominator与值，分母0则value=null、显示N/A，绝不能写0%或100%。

## 3. 指标公式、分母及输出

记K_f为G中字段f图片可读known的真值集合，M为一对一已匹配集合；C_f为K_f中预测合规且正确的数量。N为本次固定计划图片数。所有总体指标按real/synthetic分列，并按split与场景分列；标签版本、unknown/assisted数以及failed必须一起报告。

| 指标key | 公式及分母 | unknown/失败/例外 |
|---|---|---|
| amount_exact | C_amount / \|K_amount\|；正整数分完全相同，无容差、无四舍五入纠错 | 漏检/请求失败/预测null均分母保留、分子0；原价/优惠/重复合计错误不算对；外币不支持列排除原因数 |
| date_exact | C_date / \|K_date\|；完整YYYY-MM-DD逐字相等 | 缺年真值不入K_date，进缺失指标；模型补当前年算unknown误填。完整日正确但乱猜分钟另被精度指标惩罚 |
| time_precision_exact | 正确(date,time,precision)三元组数 / \|K_date\| | date真值预测minute即失败，minute要求HH:mm精确；unknown另报安全保留率，不用00:00代替 |
| category_exact | C_category / \|K_category\|；冻结分类ID相同（33项+其他） | 不明类null另计缺失；停用/未知ID不等于其他。报告每类真值数、预测数和混淆计数，不用仅多数类掩盖覆盖 |
| item_acceptable | C_name / \|K_name\|；标准名或冻结同义表允许的等价购买物/服务 | 不接受只写商户、泛称“消费/商品”。只做预定Unicode NFC、去首尾空白和连续空白归一，不模糊字符串猜匹配；新同义由人类盲复核，需版本更新，不能看test错误临时放宽 |
| missing_recall | Σ_f TP_missing_f / Σ_f U_f，f=amountFen/occurredDate/name/categoryId；U_f为G中该必填字段图片证据确实缺失的机会 | 命中须候选对齐、字段null且missingFields含该字段；只有空值没提示不命中；无候选/failed亦不命中。按字段各报，不能只报合并值掩盖金额/日期 |
| missing_precision | Σ_f TP_missing_f / 所有P中这些字段被提示缺失的机会数 | 对known误报缺失、无对应对象的缺失提示算FP；zero分母N/A。补报unknown_fill_rate=对齐unknown字段被非null填充数/ΣU_f（仅这项未匹配不计误填，需并报召回） |
| transaction_precision / recall / f1 | TP/(TP+FP)；TP/(TP+FN)；2TP/(2TP+FP+FN) | 按§2的固定匹配；失败图的GT expense均FN，[]背景预测支出均FP。precision无预测N/A，不能因recall=0以N/A隐瞒；数量附后 |
| non_expense_recall | 正确识别状态且给NON_EXPENSE阻断提示的非支出对象数 / 可证refund/transfer/income/failed/closed真值对象数 | 同时报告各状态分母、误报为expense/null的数；状态未知独立报应提示需核实数，不猜成failed |
| duplicate_precision / recall / f1 | TP_d/(TP_d+FP_d)；TP_d/(TP_d+FN_d)；2TP_d/(2TP_d+FP_d+FN_d) | 固定评测重复对池，见下文；自动提示只是风险提醒，人工最终决定不能反过来修饰算法分数 |
| empty_image_fp_rate | reviewed []图片中至少产生一个P的图片数 / reviewed []图片数 | failed不算正确空图，另报empty_completion_rate=completed空图数/计划空图数；不拿未标注null当[] |
| manual_edits_per_image | 必填/可选业务字段实质修改事件总数 / 完成人工审核会话的图片数 | 同字段改两次算2次，明确保存/确认的变化才算事件，不按键次数；无修改会话计0；排除会话数/原因另报，不能除以候选数冒充每图 |
| images_needing_edits | 至少一次上述实质修改的会话图片数 / 完成人审会话图片数 | 批准、拒绝、勾核对、格式显示变化不算字段修改；拒绝率/补填率/重开率另计，避免拒绝坏图使修改率看似降低 |
| latency_e2e / review_active | 逐图t_final_result−t_start_accepted（含排队/重试/实际网络及解析）；人审活动时间=各实际交互活动段总和 | 报n、总ms/n均值、p50/p95；最近秩法p分位取排序后ceil(p*n)项。成功/失败分列，取消单列；完成审核总耗时另含人审，不把推理时长叫完整记账耗时 |
| api_usage / cost | input/output/total tokens分别求实际attempt总和；人民币已确认费用总和 / completed图片数，并另报 /planned图片数 | 所有失败/重试有用量也计；provider未给usage为null与缺失attempt数，不能当0；费用未取得为null，估算需另报pricing来源/日期/币种与假设，不宣称实际账单 |
| completion_rate | completed / N；failed、cancelled、unprocessed各自 / N | completed只代表协议完成，[]可completed，不代表质量正确；partial/withdrawn运行不能据此宣称质量通过 |

`missing_recall`主指标覆盖四个必填字段；方案的≥99%体验目标针对金额/日期/购买物三项，须分别报告三项及其合并值，分类缺失也必须报告但不偷偷改动目标。transactionKind/amountBasis不在既有missingFields枚举中，另报状态/金额依据的风险提示召回，不能向严格Proposal新增枚举。

重复对池在模型运行前固定：同一真实交易/订单的多视图作为positive pairs；独立真实消费但同店/同额/同日的hard negative pairs及普通negative pairs作为negative。同一划分组含不同真实交易时按transactionId判正负，不能按duplicateGroup一概算正。多交易图片以已标注匿名交易对象对建池，不按整图相同来判；无模型候选的positive记FN_d。报告pairPoolHash、positive/negative/hard-negative数量及配对生成规则版本；不得只挑系统已经提示的对当分母，不跨train/dev/test构造评测对。提示输出映射到池外对单列并人工复核，不静默当真负；池不完整则duplicate指标只能探索。重复提示不授权删图、删候选或自动拒绝第二次真实消费。

人工修改必须比较首次规范化prediction/current与人类最终审核值的版本化事件，原proposal不改。分类、商品、金额、日期分别报告修改计数，缺失补填算修改；取消未完成会话不进完成分母但报告总数。human_active采用实际获得焦点并有交互的活动段，连续60秒无交互暂停累积，下次交互恢复，记录规则版本；不能用假计时器制造任务进度。S14明确人审计时是否真实采集，缺数据写未执行。

每个run每张图仅以首次完整审核会话计入主人工成本分母；多笔候选全部得到明确审核结果才算该图完整。后续重开/重复审核另列会话与成本，不重复摊薄每图修改数；未处理完的图片数量及已花费时间单列，不能丢弃。

耗时主结果与人工审核分开，网络失败有真实终态时间；若只测provider时间则明确字段provider_ms。总tokens核对provider返回语义，不假设缺失部分可从他项推断。没有实际费用不得引用过时单价编造，本步不提供任何价格或官方微调能力断言。

指标存储沿用Metric={key,numerator,denominator,value,scene,kind}。比率/均值用整数计数或总ms与n；分位数使用独立汇总记录（n、nearest_rank、valueMs）而非伪造准确率Metric；用量/费用也用独立summary（币种、小数金额、knownAttemptCount/totalAttemptCount、是否估算）。S13如需扩展DTO/迁移，先做契约影响记录；此文不是已实现接口。

## 4. 首轮50～100张计划与场景样本数

下表为人类采样建议，实际数量一律由 S14 清单计算。本步没有真实样本集；不得把计划填到结果栏。每图指定唯一primaryScene供配额去重，同时允许多个secondaryScene；secondary场景相加可能超过图片总数，必须明确重叠。图数、独立组数、expense数、非支出数、每字段known/unknown/assisted分母都需按scene列报。

| primaryScene | 50张探索建议 | 100张建议基线 | 重点真值与限制 |
|---|---:|---:|---|
| 单笔支付详情 | 10 | 20 | 实付、完整日、商品可见与不可见分开 |
| 订单优惠/实付/总计 | 6 | 12 | 明细不重复累计、折扣不作正支出 |
| 列表独立多笔/多人 | 6 | 12 | 每图笔数、每笔日期/状态、不可混用订单总计 |
| 商品未知或商品照片 | 4 | 8 | 缺金额/日期/购买物等机会数 |
| 退款/转账/收入/失败/关闭 | 7 | 14 | 五种状态尽可能各≥2图（100计划），不够逐项披露 |
| 跨年/缺年/相对日期 | 5 | 10 | 完整跨年与缺年份分别计数 |
| 模糊/裁剪/金额歧义 | 4 | 8 | 不删难图，逐字段unknown |
| 重复变体/相似真实第二笔 | 5 | 10 | 100计划至少3个正重复对及3个hard-negative对；与其他scene可交叉标记 |
| 恶意文字/无支出背景 | 3 | 6 | 指令只作数据，至少有[]背景和含真实字段两类 |
| 合计 | 50 | 100 | 计划值；不能据此声称样本已到位 |

100张仍可能缺少足够重复对、某分类或test场景；优先补新独立组，不复制近似图凑量。报告每split的primaryScene表与secondary覆盖，test仅15%左右意味着很多场景只有0～2图，不能据整体100张宣称各场景稳定。未达表中建议不一定阻断框架交付，但缺项必须列入质量限制。

少于50张：仅试流程和标签一致性；50～99张：探索基线，dev改提示词，test满足隔离仍只给探索结论；至少100张人类复核授权真实图后，可评估体验目标，但必须同时满足锁test有效、分组独立、分母充足并公示统计不确定性。开发train/dev分数不能替代test成绩；按DATASET的小样本例外不能建test时，不出“独立质量达标”结论。

## 5. 体验目标与硬门分开

| 类别 | 待验证要求 | 判定边界 |
|---|---|---|
| 建议体验：金额 | 可读支出amount_exact≥98% | 锁test实际known金额分母、匹配/失败数及区间并报 |
| 建议体验：日期 | 可读完整日期date_exact≥95% | 缺年不猜，缺年样本仍进missing召回 |
| 建议体验：分类 | 可判类别category_exact≥90% | 分类覆盖/混淆表必报，不用人工补类成绩 |
| 建议体验：缺失 | 金额/日期/购买物missing_recall各≥99% | 各自U_f及合并值并报；unknown机会不足/0则不能判该目标通过 |
| 尚未定阈值 | 购买物可接受、检出、去重、人改、耗时/成本 | 先给实际n/指标，不自造通过线 |
| 硬门 | 100%正式AI交易人工批准；未审核统计影响0；重复批准新增0；必填校验完整；固定账本金额/Top3正确；无凭证泄漏 | 由业务/安全测试与S17/S19相应真实证据判定，不用体验平均分豁免 |

至少100张是讨论建议体验目标的样本起点，不是训练足够、统计充分或产品承诺。准确率附95% Wilson区间：n>0、p=k/n、z=1.96，中心=(p+z²/(2n))/(1+z²/n)，半宽=z×sqrt[p(1−p)/n+z²/(4n²)]/(1+z²/n)。该区间仅作未调整组相关性的描述；同组多图并非独立样本，必须报独立组数，不能据此宣称泛化保证。n=0则区间N/A。99%目标遇极少unknown机会即使全对也仅标“该分母观察到全对，证据不足”。

建议目标用固定test点估计逐项比较，同时披露区间/组数/场景不足，不用总体分数包办某字段。框架通过与识别质量结论分开写；质量未执行/不足/未达目标都维持AI实验性，不编造准确率，不将G4框架通过说成识图质量通过。

## 6. 首版训练适配能力边界

首版只做数据与评测/未来训练接口框架。API推理、提示词/分类规则改进、少样本提示和人工纠错**不是权重训练**；不自动后台训练，不生成假权重/假进度。S12仅规定，S13才实现以下行为：

| 操作 | 允许输入、输出和副作用 | 首版约束 |
|---|---|---|
| prepare | 有效datasetVersionId/exportManifestHash、future_training用途和受限artifact、adapter版本；本地转换，输出真实preparedArtifact/format及sample/group/kind计数 | 重新查dataset许可/用途/撤回，不联网、不生成权重；manifest+adapter幂等，相同输入不能产出不同未说明格式 |
| validate | artifact+manifest+schema/spec版本；只读检查结构、资源/hash/授权/分组/test锁，输出实际错误/警告计数与报告句柄 | structural valid不等于识别质量；规则未实现返回SPEC_NOT_READY，不能假valid；最多1000问题摘要及完整报告真实总数 |
| submit | 未来prepared artifact/manifest、targetProvider、独立训练同意 | 首版固定wire code=UNSUPPORTED、reason=unsupported、retryable=false；0网络/0费用/0远端job/0权重/0训练任务，不能创建queued训练再假失败 |
| status | targetProvider/remoteJobId | 首版固定UNSUPPORTED、reason=unsupported、retryable=false；不能返回training/completed/百分比，空job也不伪造不存在训练 |
| evaluate | datasetVersion、prompt/provider/seed/scope及授权句柄，交本地EvaluationRun runner | 只评推理；真实queued/processing/completed/failed/cancelled及逐图结果；mock分列，不以evaluate名义训练；通过evaluation.status读取 |

所有入口仍校验R/D；deepseek评测另U及费用确认。撤回可取消、到期阻断、重试不能越过generation栅栏；评测结果不自动入账。未来若开展微调，须另步重新核实目标提供商官方支持、账户权限、模型/格式/端点、训练资源/算力/费用、许可与撤回影响、安全和新的人工范围授权，先更新决策/契约，再实施；本规范不声称DeepSeek当前提供或不提供某项微调服务。

## 7. 可复现报告和S13/14接收清单

每份报告必须具备：版本与manifest/prompt/runner hash、scope/provider/actualModel、real/synthetic分列、train/dev/test及是否污染、计划/完成/失败/取消/未处理图数、组/交易/场景表、known/unknown/assisted分母、匹配清单hash及人审标志、所有指标分子/分母/N/A、失败码、时延分布、attempt/token/费用缺失与重试、限制、问题及下一负责人。未完成run不生成伪completed报告；不储存完整请求头、base64、原HTTP正文、个人图片或真值到Git。

S13先以固定合成材料验证以下框架（本步均未执行）：已知/unknown/assisted/null与[]、漏检/误检/重复输出、失败图FN和字段分母不消失、无分母N/A、状态精度与名称同义版本、重复pair池和hard negative、70/15/15整组不泄漏、锁test更正/污染拒绝、撤回在途/导出/恢复、prepare/validate实际清单、submit/status零副作用UNSUPPORTED、真实计时/用量缺失null。不得仅用镜像实现断言推断框架正确，预置可手算真值并核对分子/分母。

S14由人类提供有权样本和真值、复核脱敏/许可与标签，先登记实际样本数和差异，再运行S13已实现框架。没有真实数据时仅报告框架证据和质量待验证；不得将合成回归或S11审核通过当准确率结果。S17/S19仍须独立候选/ZIP验收；本步不升级G4～G6、不自动执行下一步。
