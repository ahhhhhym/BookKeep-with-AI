# S05 返工任务书

版本：S05-R1｜日期：2026-10-20｜实现负责人：DSH｜独立复验：Codex｜状态：待 DSH 修复。

先读 AGENTS.md、执行看板.md、原 tasks/S05.md / handoff/S05/HANDOFF.md、本轮 evidence/RECEIPT-S04-S05/RECEIPT.md 与 ISSUES.md、CONTRACTS §10、ARCHITECTURE §11、DECISIONS D36～D40。

1. 修复 BK-S05-001（P1）：原提交 revision 与当前账本水位分离；恢复令牌必须依当前持久 revision 检查，回放旧请求不能使过期预览重新生效。按问题单补失败回归再修复，保留修复前后结果。
2. 修复 BK-S05-002（P2）：恢复后的备份目录仍能发现/校验/选择此前保留的档案（包括所选档案自身和较新档案），不得通过合并交易来保留目录。附恢复、再次恢复、重启、损坏拒绝的真实 SQLite 证据。
3. 实现与新补充规格一致；如方案有冲突，先记录问题交 Codex，不静默改接口，不扩大到 S06/统计/真实 API。S15 的外部 token/分页/恢复状态核实等后续项保持明确，不把阶段适配写成 AC16 完成。
4. 运行已有 typecheck/test/build/smoke:electron/db:report 及新增针对性回归；记录命令、退出码、数量、commit、受影响文件和限制。当前无需重做正式包，S04 旧 ZIP 继续标骨架历史版本。
5. 不改写旧 HANDOFF/旧哈希作“原本通过”；新增 handoff/S05/REWORK-R1.md 及 evidence/S05-R1/，交出前停止所有写入和后台任务。Codex 复验通过后才进入 S06。

Codex 本轮只做审查、运行已有检查及文档规格，不代写实现。问题详情和精确代码证据以 ISSUES.md 为准；本轮未动态执行新增缺陷序列，DSH 须提供回归证据。
