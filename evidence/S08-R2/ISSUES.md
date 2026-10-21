# S08-R2 问题、失败与处置

产品新阻断问题：无。既有BK-S07-004 P2留S15；BK-S08-001在本轮全部G1必需证据和C待办核对后关闭，仅关闭原前置冲突。

| 编号/级别 | 实际/期望及复现 | 证据与处置 | 是否阻断最终G1 |
|---|---|---|---|
| QA-R2-01 P3 输入采集 | preflight将S05原OUTPUTS与后续修复29f0a51比较，7个预期差异，退出1；应比较清单所属原commit | input-verification保留失败；resolve-input在e20badf4验证74/74，input-resolution明确修正原因 | 已解决；无产品变更 |
| QA-R2-02 P2 证据输出路由 | prepare-replays遗漏S07分段拼接'evidence','S08','statistics'，首次新运行写旧ui-workflow，原脚本自动备份旧JSON；应仅写R2 | 新结果保全attempt1-routing；原Git blob先核验与FROZEN-TRACKED相同再恢复；新生成原备份移入R2；routing-incident保留最初未全解决状态，routing-resolution记录归档；正确路由副本重跑22/22，final-check确认历史全部原字节与无新路径 | 已恢复并重新采集；不隐瞒临时写入，不以旧结果冒充新结果 |
| QA-R2-03 P3 采集存储 | D49首轮重复writeFileSync results.json发生UNKNOWN/open，退出1，停在F02重启采集；期望证据正常写入 | logs/d49.log、d49/results.json及截图保留；新run2改独立序号checkpoint写入，业务操作/期望不改；run3完整通过 | 已解决；未发现产品DB错误 |
| QA-R2-04 P3 采集器预期 | run2对已恢复T004的新restore请求误期望ok=true；实际STATE_CONFLICT reason NOT_DELETED，原契约允许；业务要求为金额不增 | d49/run2/results.json、失败截图及logs/d49-run2；run3 diff仅路由和对重复恢复拒绝响应按既有CONTRACTS断言，再测UI/SQL仍96530及重启；不改产品/原测试/原断言 | 已解决，run3全部29组通过；不是产品缺陷 |
| QA-R2-05 P3 收尾脚本 | 自定义Compare与PowerShell内置别名Compare-Object冲突，缺DifferenceObject停止，尚未生成最终清单 | 原工具退出1；改为唯一函数名Get-FrozenHashComparison，仅本轮收尾脚本；随后按全部原哈希条件复核 | 已解决；不涉及产品/验收预期 |

被验产品始终为65d2e16工作区的ecc9795实现，产品哈希与47b60fe一致。所有采集失败没有通过修改产品来消除，未删除原失败记录。若后续发现新基础缺陷，应按实际步骤登记BK问题、修复后另轮S08复验，不在本轮继续改产品。
