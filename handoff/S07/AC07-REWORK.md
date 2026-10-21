# AC07规格与任务衔接返工交接

日期：2026-10-21｜交出者：Codex｜状态：规格/依赖已修订，待S08按新口径复验。

**下一唯一负责人：Codex执行单独一轮S08-R2复验，由用户另步启动[tasks/S08.md](../../tasks/S08.md)。本次G1仍未通过，S09仍未开始。** 未写业务代码、未执行S08复验、未启动S09或发布/发送其他聊天消息；本次是文档检查，不是软件验收。

## 输入与保全

实际指定PowerShell7.6.7 Core、真实进程路径已记录；初始工作区干净，分支codex/s07-statistics，HEAD `65d2e16fa316f8a58797a5842942d9b0c1b7916b`。重新核对S08-R1被验`47b60fe503c38e05497e0252879587f2dfc6d5bc`、统计实现`ecc97950b62cf6eb71dddc69c15039e2374f6ed0`、材料65d2e16均为实际Git对象和HEAD祖先。S08 OUTPUTS143、S07 SOURCE150、BUILD5共298项输入哈希全部匹配；未以提示词数字代替核对。

所列材料均已读取，750项原跟踪文件冻结哈希在[BASELINE.json](../../evidence/S07-AC07-REWORK/BASELINE.json)，13份修改前原字节在[before](../../evidence/S07-AC07-REWORK/before)，关键[INPUTS](../../evidence/S07-AC07-REWORK/INPUTS.sha256)与[input-verification](../../evidence/S07-AC07-REWORK/input-verification.json)记录版本/环境/命令。历史evidence和handoff包括S08-R1全部保留，失败结论不改写。旧S08输出清单的看板/问题单哈希现应对照本次before；旧清单不改。

## D49与追踪

先追加[D49](../../docs/DECISIONS.md)引用用户本轮明确授权，再同步规格和入口；无待人类决定的方案。原依赖是完整AC07/G1→S09→S10/S11，而完整AC07又需S10/S11，现改如下：

| 项目 | 实现步骤 | 验收步骤 | 真实证据要求 | 当前状态 |
|---|---|---|---|---|
| AC07-A六笔固定账本 | S05～S07 | S08；S17全量复核 | 列表/日期小计、周月年、排行、日Top3交易、月Top3分类、日均；F02=96530分，真实UI/IPC/SQLite/重启 | R1有通过证据，R2未执行 |
| AC07-B正式编辑/软删/恢复同源 | S05～S07 | S08；S17全量复核 | F03-I-B独立分支、整数预期和原生SQLite与UI一致，重复恢复不增加 | R1有通过证据，R2未执行 |
| AC07-C持久化隔离与批准增量 | S10真实任务/候选；S11审核/原子幂等自测 | S11单列接收/G3验证；S17必须复验 | 待审99/拒绝88/failed重启后0影响；批准99后只增9900至106430分；真实UI/IPC/SQL/关联审计，失败回滚/重复新增0 | 未执行，待S11/G3验证、S17复验 |

G1现在仅需AC01～AC06、AC07-A/B及相关基础持久化通过，无基础链路阻断缺陷；不代表AC07整项或审核隔离通过。AC07整项须A/B/C都有真实证据，C强制待办及关闭条件在[tasks/S11.md](../../tasks/S11.md)与[tasks/S17.md](../../tasks/S17.md)，看板亦登记。G3需C真实证据，G5需重新验证C，不能以临时mock不写库替代。业务不变量、每笔人工批准、原子幂等、安全/密钥、样本授权、P0/P1和人类最终发布规则均保持。

## 文件、验证与当前问题

修改13份现有文档：AGENTS、开发方案、交接与验收、执行看板、分步中文提示词、PRD/ACCEPTANCE/FIXTURES/DECISIONS、README/开始阅读/文档审阅记录、issues/BK-S08-001。新建tasks/S08/S11/S17、本交接和evidence/S07-AC07-REWORK证据。原tasks/S01～S07、产品/原测试/脚本/依赖/锁/迁移均未改；没有伪候选表或个人账本操作。ARCHITECTURE/CONTRACTS/UX没有受影响契约，无须修改。

静态文档与链接检查、全当前G1/AC07检索、依赖无环、历史字节保全/保护范围核对见[REVIEW](../../evidence/S07-AC07-REWORK/REVIEW.md)、[document-check](../../evidence/S07-AC07-REWORK/document-check.json)、[final-check](../../evidence/S07-AC07-REWORK/final-check.json)。精确脚本入口/UTF-8与检查边界在REVIEW；输入验证298/298，当前修改差异[diff.patch](../../evidence/S07-AC07-REWORK/diff.patch)、[完整文件清单](../../evidence/S07-AC07-REWORK/changed-files.txt)、[输出SHA256](../../evidence/S07-AC07-REWORK/OUTPUTS.sha256)。输出清单排除自身，最后另行核验全匹配。

BK-S08-001仍为P2验收前置冲突，不是已复现金额错误；现状态“范围/依赖已修订，待S08按新口径复验”。规格修订不等于关闭或自动通过G1。R1的181测试/59交互/28+28启动和数值正确仅作为原证据保留，本轮未重跑业务测试或构建。Codex同一会话修改文档并静态检查，不声称不同作者独立审查。

## 接收动作、未执行与回退

下一轮先读本交接与tasks/S08.md，核对实际Git/本轮OUTPUTS、源文件/构建和历史清单，记录未提交文档变更（本轮未自动提交）；固定实际产品与D49规格哈希，停止后台写入，独立证据目录S08-R2验AC01～06与A/B及基础持久化，不覆盖R1，不直接沿用旧报告放行。只有新G1真实通过且C待办仍在，才可复核关闭BK-S08-001，再报告S09是否具备前置，仍由用户另步启动。

未执行：S08-R2、S09真实API/密钥、S10/S11及C隔离、S17、真实人类桌面/双系统/干净ZIP等，不作升级声明。交出时无本项目运行任务、无其他写入Agent，最终Git/进程见final-check；允许下一负责人在用户启动后接管。证据只有文档与技术元数据/合成期望，无真实key、完整请求头、图片base64、个人DB/附件或训练样本。回退本次仅需先保存后续改动，再按before/和diff逐项审阅恢复这些文档及新增材料；不自动回滚产品/账本，不覆盖未知修改。
