# S12交接：数据与评测规范

2026-10-22｜交出Codex → 接收Codex S13（须用户另行启动）。状态：**规范编制及文档自查完成，待接收**。本轮不编写训练/评测代码，不做S08/S17/S19或S11复验；同一Codex负责规范和自查，不声称不同作者独立审查。

## 基线、输入及前置实物

- 工作目录 `D:\BookKeep with AI`；指定pwsh.exe先验证7/Core、UTF-8。开始时main=`1633eccfd85a45f0a1b439910eb4a58c0623a9b4`、Git干净、origin为目标仓库，Git ls-remote与GitHub连接器均确认实际默认main。PR5 merged，无未合并前置PR。
- S11-R2接受head=`f4d2aa39bc9bb427beab4a14e004665bc2709614`，合并tree与被验tree=`710e11d72ff14191ba84cf2e8df0ed41966f137f`一致；本轮重新逐项核对176源码/6构建均匹配，非只采信聊天。S11-R1失败/返工/R2历史实物保留。
- 已读AGENTS/看板、S11原HANDOFF与最新ACCEPTANCE-R2及merge-verification/ACCEPTANCE、CONTRACTS、ARCHITECTURE相关实体、开发方案、PRD、交接与验收、DECISIONS与数据要求。tasks/S12、DATASET、EVALUATION在开始时不存在。
- S11-R2/G3通过；AC07-C为G3已验证、待S17复验，AC07父项不升级，S17 A/B/C强制待办开放；G4～G6未通过。本轮不重做G3，不把S11合成传输称为私有样本质量证明。

## 产物与需求覆盖

| 文件 | 内容/对应要求 |
|---|---|
| [DATASET](../../docs/DATASET.md) | REQ-025、AC17/22规范：人类权利/真值、双同意默认不入集、参考图排除、脱敏、ID/hash/预测/标签/unknown/精度/状态/复核/版本、场景指南、70/15/15整组与锁test、独立清单、撤回/删除传播 |
| [EVALUATION](../../docs/EVALUATION.md) | REQ-026/027、AC17～19规范：固定匹配与端到端分母、失败/unknown/N/A、指标/场景配额、50～100探索与至少100后的建议目标、报告、prepare/validate/submit/status/evaluate首版边界 |
| [D60](../../docs/S12-DECISIONS.md) | 最新用户要求覆盖D53/D55的本步六文件例外、影响清单、旧状态解释；无应用契约wire或schema变更 |
| [任务书](../../tasks/S12.md) | 前置、需求自查映射、范围/交付和下一步 |
| 本交接、[QA](../../evidence/S12/QA.md) | 版本/证据/未执行/接收动作；仅脱敏摘要上传 |

本地还更新AGENTS/执行看板当前入口、DECISIONS D60和CONTRACTS规范索引；保留修改前副本 `evidence/S12/before`。旧文件不上传，六项新文档按D60精确白名单提交，不更改.gitignore放开目录。应用src/tests/scripts/依赖/迁移/构建配置均不变。

## 验证、证据及保密

文档自查的命令/退出码、链接/覆盖检查、样本计划加总、敏感检查和Git清单见[QA](../../evidence/S12/QA.md)。本地 `evidence/S12/preflight.json`、`verification.json`、`history-before.json`、`safety-scan.json`、`OUTPUTS.sha256`保留原始结果；输出清单不包含自身以避免循环。此处路径是本地证据，远端仅发布QA摘要。

未接收真实截图或人工真值、未扫描个人样本目录、未读取key/数据库；本轮没有数据集登记、训练、评测或收费HTTP。文档中的例子为明确标记的文字合成示意。无真实密钥、头、base64、数据库、个人图片、真实标签或用户许可证明进入六项发布文件。PR版本/remote/base/head核验在本地 `handoff/S12/DELIVERY.md`，最终commit由该交付记录及PR承载，避免文档自引用commit。

## 问题、未执行和门禁

无本步已知阻断规格问题。人类样本及真值未提供，因此无法验证许可实际有效性、标注一致性、场景实际数量或任何识别准确率。当前产物只定义规则，不实现S13校验器、runner、接口、数据库或UI；所有S13框架测试和S14真实评测均未执行。未重新运行不变应用的279测试/build/桌面测试；不声称本轮软件验收、训练或新G门通过。Win11/干净机、真人输入/读屏、完整备份与S15加固、S17/S19、正式ZIP/Release/发布均未执行。

数据进入风险有双同意/许可/脱敏/人类复核门；退出风险有当前链头与epoch、在途取消、清单删除、备份不复活及外部副本未知边界；泄漏风险有近似组/订单连通分组、锁test、不用test调提示词、污染退役与标签纠错留痕。详见DATASET §8和EVALUATION §7。正式记账仍须逐笔人工批准，数据集操作不得写正式账本。

## 接收与工作区

下一唯一负责人Codex S13，须用户另行启动。先检查Git分支/commit、六份规范及本地OUTPUTS/交付记录，再核对S11-R2/G3仍有效并给S12接收结论；不要把本次自查当作接收。实现前对照现有schema3与CONTRACTS，若新增元数据/DTO/迁移先登记S13影响清单。首个实现目标为固定合成样本的登记→标注→校验→整组划分→导出→评测可手算闭环，submit/status明确UNSUPPORTED；人类真实质量交S14。

任务分支 `codex/s12-data-spec`、base main=`1633ecc`，无叠加PR依赖。结束状态与PR见本地DELIVERY；被忽略开发材料是有意保留，不能清理。只此Codex写入，未启动应用/构建/后台任务，不向其他聊天发消息；本轮结束后停止写入。不合并、不发布、不自动启动S13。
