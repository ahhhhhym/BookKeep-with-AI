# S05-R2 返工任务书

日期：2026-10-20｜负责人：DSH｜独立复验：Codex｜状态：待修复。

先读AGENTS、看板、handoff/S05/REWORK-R1.md、evidence/RECEIPT-S05-R1/RECEIPT.md及ISSUES.md、CONTRACTS§10.2新增hash保留规则、DECISIONS D41。输入基线7c17aa1（修复代码a330096）。

只修BK-S05-003 P1：目录重建必须保留已登记档案的原hash，不能把档案当前内容hash重新登记为已知原始基准；数据库、目录、扫描结果有冲突时明确拒绝/标错，不由读取顺序静默选择。保持原BK-S05-001/002回归通过，不合并交易、旧审计或多账本。

按问题单“B1→B2→合法SQLite改B2金额→目录丢失→重启→恢复B1→再预览B2”组合序列补失败回归，再修复；验证恢复前后均拒绝变动B2、当前数据不被覆盖。覆盖有效/丢失/损坏目录、重启、已知hash冲突及正常B1/B2/P再次恢复。

运行typecheck、全量测试、针对性回归、build、smoke:electron及db-report，记录真实命令/退出码/数量/commit/证据。无需新增正式软件ZIP或提前做S06/S15全量功能。新增handoff/S05/REWORK-R2.md、evidence/S05-R2/及修复前后结果，不改写原交接/证据；停止写入及后台任务后交Codex复验，整步通过才进S06。
