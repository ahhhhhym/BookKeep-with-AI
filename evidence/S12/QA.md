# S12 文档自查与脱敏交付摘要

2026-10-22｜Codex｜**规范编制及自查完成，待接收**。本轮不是应用、真实识图质量、训练或S08/S17/S19验收；同一Codex编制与自查，不声称不同作者独立审查。

## 输入与环境核对

指定 `C:\Users\Administrator\AppData\Local\Microsoft\WindowsApps\pwsh.exe` 首先执行 `$PSVersionTable.PSVersion.Major` 与 `$PSVersionTable.PSEdition`，结果7/Core、退出0；全程UTF-8。

`git status --short`开始为空；`git branch --show-current`为main；`git rev-parse HEAD`和`git ls-remote --symref origin HEAD`同为1633eccfd85a45f0a1b439910eb4a58c0623a9b4，实际默认main。`git remote -v`为目标仓库；GitHub连接器交叉核对仓库/default_branch、PR5 merged及无open前置PR。`git switch -c codex/s12-data-spec`退出0。

S11-R2 SOURCE.sha256 176项和BUILD.sha256 6项使用 `Get-FileHash -Algorithm SHA256`逐项核对，全部匹配；原合并tree与被验tree均710e11d72ff14191ba84cf2e8df0ed41966f137f。原始本地preflight.json和history-before.json记录实际输入，不上传旧证据或图片。

## 检查命令与结果

文档检查使用一次性PowerShell命令，仅检查文档/文件/Git；没有编写训练或评测代码、测试runner或数据处理程序。

| 检查 | 命令/方法 | 结果 |
|---|---|---|
| 需求覆盖 | 对DATASET/EVALUATION必需规则执行逐项短语存在检查，再人工对照任务书逐条审读 | 授权、退出、泄漏、字段和标注场景、指标分母/unknown、适配边界均有明确规则 |
| 文档链接与文本 | 六项UTF-8解码、Markdown本地相对链接存在性、无替换字符；核对同版本S12-1.0 | 通过；链接只指向六项新文档，旧基线路径明确为本地定位 |
| 配额 | 50计划10+6+6+4+7+5+4+5+3；100计划20+12+12+8+14+10+8+10+6 | 分别50/100；只是计划，实际真实数据未提供 |
| 应用与历史不变 | 重新核对176源码/6构建；逐项重算history-before.json指定历史文件 | 匹配；无src/tests/scripts/依赖/迁移/打包配置变化，S11失败和复验材料原样保留 |
| 范围与敏感检查 | 全项目文本关键词计数、凭证格式候选扫描；六项发布白名单及完整Git差异/提交复核 | 不上传真实密钥、数据库、图片、真实样本、原始日志或软件ZIP；只强制暂存六项Markdown |
| Git空白/提交 | `git diff --cached --check`；`git diff --cached --stat`、`git diff --cached`及提交清单逐项审读 | 退出0；版本/推送/PR结果写本地DELIVERY并在最终回复报告 |

本地原始结果为 `verification.json`、`safety-scan.json`、`OUTPUTS.sha256`；这些不是训练/评测结果，也不随PR上传。六项名单为docs/DATASET.md、docs/EVALUATION.md、docs/S12-DECISIONS.md、tasks/S12.md、handoff/S12/HANDOFF.md及本文件；D60仅作为本次用户D51要求的例外，不放开旧目录。看板/AGENTS/CONTRACTS索引/DECISIONS继续本地维护并留before副本。

实际检查摘要：24/24覆盖检查、10/10相对链接，50/100配额加总正确；176源码/6构建匹配，73项S11交接及R2历史文件原字节不变。首次短语检查有4项因预期措辞与等价实际措辞不同报缺，人工核对后修正检查短语，原verification-first.json保留，最终24/24；未靠该检查改写业务口径。全项目扫描976项文本（排除依赖/构建/运行私有目录），敏感格式候选0、六项发布文件候选0；关键词sk-/api_key/password/token出现143/27/21/2574次，均只计数不输出原值，关键词术语命中不等于真实凭证。此次扫描在本段摘要写入前执行，不把摘要新增长度冒充扫描覆盖。

## 人类数据进入、退出与泄漏审读

- 进入：人类权利与真值、两项独立同意、默认不入集、逐图preparedHash、许可/脱敏/复核分别有门；五张参考图不是训练样本，审核入账不等于入集。
- 退出：撤回先阻断和取消在途；清单覆盖版本、报告、导出、缓存、备份与外部副本；旧备份不复活grant；删除敏感快照只留最小墓碑；外部副本未知不能说已收回。
- 泄漏：同交易/订单/近似图连通分组；70/15/15不拆组；锁test不调提示词/同义表/阈值，不进示例/检索库；污染退役，纠错版本化，不能换hash洗掉接触历史。
- 指标：失败/漏检保留已知字段分母，unknown不能当正确值，未标注null不同于[]；配对和同义规则在运行前固定，真实/合成分列；50～100探索与至少100后的建议目标分开，不伪造结果。

## 门禁与未执行项

S11-R2/G3保持通过，AC07-C待S17复验、父项不升级，S17 A/B/C强制复验开放，G4～G6未通过。S12本轮仅规范与文档自查完成、待接收；S13未启动。AC17～19/22这里只做规格覆盖，不宣称正式应用AC通过。

未执行：真实样本登记/许可人工确认/标签一致性/样本数量盘点、质量评测、任何权重训练/微调、收费识图HTTP、S13实现或合成runner、应用测试/build/桌面重测、跨系统/干净ZIP验收、软件ZIP/Release/发布。没有因文档变化重复运行不变的279应用测试；既有S11实测属于历史证据。PR仅交付规范，不替代验收；不合并、不启动下一步、不向其他聊天发消息。
