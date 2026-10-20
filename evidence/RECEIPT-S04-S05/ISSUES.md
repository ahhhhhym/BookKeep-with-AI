# S04/S05 独立验收问题单

日期：2026-10-20｜审查者：Codex｜代码 `075c475`｜交接提交 `e20badf`｜环境：Windows 10 x64 build 19045、pwsh 7.6.7 Core、Node 24.19.0。

结论：S04 工程骨架接收通过；S05 返工。以下两项是代码审查发现，**本次没有编写新复现程序，也没有实际执行会覆盖账本的缺陷复现**。复现步骤是交给 DSH 的回归输入，不是已执行结果。135 项现有测试全部通过，不能覆盖以下缺口。

## BK-S05-001｜P1｜回放旧收据使当前 revision 回退，可能使过期恢复预览重新有效

- 影响：REQ-004/024/030，AC04/11/16；S05 的幂等、快照与恢复安全边界。状态：开放，阻断 S05 接收及进入 S06。
- 代码证据：`src/main/services/ledger-service.ts:161-173` 回放返回 `existing.revision_at_commit`；`src/main/services/ledger-store.ts:408-410` 将该值直接赋给当前 `this.revision`；`src/main/services/backup-service.ts:283-290,341-343` 签发/校验恢复令牌均使用该缓存值，没有在 commit 校验时读取当前数据库 revision；`src/main/ipc/registry.ts` 的信封同样读取该缓存。
- 最小复现输入（DSH 在隔离合成数据目录执行）：创建交易 A，保留 mutationId M（revision=1）；创建备份 B 并预览 B（令牌绑定 revision=1）；创建交易 C（revision=2）；以原键 M 和原载荷重发 A；不调用 list/ensureDefault 等刷新缓存，立即提交原恢复令牌。
- 静态路径推导：A 回放后数据库仍为 revision=2，但 store 缓存回到 1；原令牌中的 1 与缓存 1 相等，校验可继续恢复 B。预览后新增的 C 可能被覆盖，违背“数据变化须重新预览”。普通回放也会使 IPC 当前修订号倒退。
- 期望：历史提交修订号与当前账本水位分离。回放不新增记录，不改变当前 revision；恢复 commit 用当前持久事实源检查 epoch/revision，旧预览返回 TOKEN_EXPIRED/RESTORE_CONTEXT_STALE，C 保持存在。原提交 revision 可以作为回放结果元数据返回，不能覆盖 store 当前值。
- DSH 修复及回归要求：新增上述交错顺序回归；验证连续多次回放、分类变更回放、重启回放、IPC 当前水位、正常恢复和过期预览拒绝；金额/审计/收据均不重复。附新 commit、修复前失败/修复后通过证据，交 Codex 复验。
- 契约裁定：见 CONTRACTS §10.1、DECISIONS D36；Codex 不改业务代码。

## BK-S05-002｜P2｜恢复旧快照后，已保留的备份档案从可操作目录中消失

- 影响：REQ-024/030，AC16；S05 基础备份目录及恢复后的再次操作。状态：开放，本轮与 P1 一并返工。
- 代码证据：`src/main/services/backup-service.ts:145-167` 先生成快照，后登记本次备份；所以 B 的快照不含 B 自己的 backup_record。`src/main/services/ledger-store.ts:645` 恢复时只补入 pre_restore 记录，没有保留当前备份目录或补入选中的 B。`backup-service.ts:65-72,249-263` 列表/预览只能依靠当前 DB 的 backup_record。
- 复现输入（DSH 隔离执行）：创建 B1，之后创建 B2；预览并恢复 B1；列出备份，再尝试预览 B1/B2；重启后重复查询。
- 静态路径推导：新库来自创建 B1 之前的快照，B1/B2 的记录均不在其中；代码仅复制恢复前备份 P。B1/B2 文件仍在 backups，但 UI 列表不再提供它们，按原 backupId 预览返回 NOT_FOUND。当前没有 selectionToken 导入路径，不能直接重新选择这些档案。
- 期望：恢复替换账本内容，不能让独立保留的备份档案失去可发现/可校验/可恢复的入口。可采用独立目录索引、受限重建目录，或等效方案；不得把恢复后的交易数据与旧库交易混合。丢失文件/坏 hash 必须显示失败，不能伪造 completed。
- DSH 回归：恢复后 B1、B2、P 均有明确可操作状态；再次恢复、重启保持、hash 校验、损坏档案拒绝；同时验证不同 ledgerId 的外部备份兼容路径不会靠复制业务行混账。
- 契约裁定：见 CONTRACTS §10.2、ARCHITECTURE §11、DECISIONS D37。

## 未列为缺陷的边界

恢复成功后旧 epoch 请求被拒绝是 CONTRACTS §6 的既定规则；不能要求旧 restoreToken 在新 epoch 直接重放。恢复操作状态核实入口属于 S15 补齐项，需按操作 ID 查询持久结果，不能靠再次覆盖推测成功。

S05 未做正式 ZIP、S09 前无真实识图/密钥存储、S11 前无候选外键、S15 前附件完整备份与故障加固，均按阶段登记，不冒充完成。截图静态复核不等于鼠标键盘流程通过。
