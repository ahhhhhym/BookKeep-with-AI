# S12 决策与交付范围（D60）

版本 S12-1.0｜2026-10-22｜Codex｜规范编制与文档自查完成，待后续接收；不是应用或质量验收。

用户本轮明确启动 S12，要求不编写训练或评测代码，并要求按 D51 提交本步规范、任务、交接和脱敏证据 PR。这是本步骤对 D53/D55 开发资料仅本地规则的明确例外，不恢复全部历史资料上传。只上传下列六个新文件，逐文件强制暂存；不放开目录忽略规则：

- `docs/DATASET.md`、`docs/EVALUATION.md`、本文件。
- `tasks/S12.md`、`handoff/S12/HANDOFF.md`、`evidence/S12/QA.md`。

AGENTS、执行看板、既有 DECISIONS/CONTRACTS、S11历史交接及全部图片、原始日志/扫描/哈希清单保留本地。新文档中提及的旧基线文件路径为本机证据定位，不承诺在当前远端源码树存在。未来步骤继续遵守 D53/D55，除非用户另行变更。

影响清单：六份新文档；本地 `docs/DECISIONS.md` 追加 D60、`docs/CONTRACTS.md` 追加 S12 规范索引、执行看板及 AGENTS 更新当前入口。无 src/tests/scripts、依赖、数据库迁移、IPC、打包配置或既有业务语义变化。本规范定义 S13 待实现的数据元数据、指标和验证口径，不声称当前 schema3 已实现数据集实体或训练能力。

前置实物：main=`1633eccfd85a45f0a1b439910eb4a58c0623a9b4`，S11-R2接受 head=`f4d2aa39bc9bb427beab4a14e004665bc2709614`，PR5已合并；176源码/6构建逐项匹配。origin 为 `https://github.com/ahhhhhym/BookKeep-with-AI.git`，实际默认分支 main；无未合并前置 PR。S11/G3通过，AC07-C仍待S17复验，父项不升级，G4～G6未通过。

冲突解释：S11旧 HANDOFF 与看板历史段落中“G3未通过/S12未启动”保留当时记录；当前状态以 S11-R2 接收及本步新入口为准。DATASET/EVALUATION 是 CONTRACTS §6/7 的细化：沿用 null、三档时间精度、交易状态、权限 D/U、独立同意、UNSUPPORTED 和锁 test，不改变线上候选契约。未来实现若需 DTO/schema 扩展，须先登记 S13 影响清单和迁移方案再编码。

S12不做S08/S17/S19或S11重新验收；同一Codex负责规范与自查，不称不同作者独立审查。不调用收费API，不接收真实数据，不生成权重或质量结果，不合并PR/发布/启动S13/向其他聊天发消息。
