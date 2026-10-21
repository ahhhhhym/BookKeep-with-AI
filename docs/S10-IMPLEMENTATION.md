# S10 实施与影响清单（D52）

2026-10-21。实现前固化。遵循既有 CONTRACTS §4、UX §6/7；以下仅补充实现落点。

- SQLite schema v2：image_asset、import_job、candidate；原 v1 校验和不变。图片在当前 generation 的 attachments 受限目录；asset 记录相对内部引用，IPC 无路径。新增主进程 ImageService/RecognitionService，LedgerStore 只提供内部事务回调，恢复时重绑定当前 generation。
- 以 sharp 0.35.5 做内容解码/像素上限/裁剪/纯色遮盖/PNG重编码；首次导入先按签名、字节、metadata 拒绝超限，再完整解码。动画多帧拒绝。prepared 图仍受10MiB限制，不改变首版格式边界。依赖锁、许可、外部原生模块构建同步。
- `image.select` 为主进程原生对话框（公开API无路径），preload `image.drop(File[])` 仅用 Electron webUtils 为真实 File 换临时 token；主进程绑定唯一窗口、epoch、用途和5分钟。image.import/prepare 使用持久化 mutation receipt；处理为另存新 asset，不覆盖已有上传快照。
- 预览走 bookkeep://app/image/<短时只读token>，主进程校验世代/窗口/有效期；无任意读盘，无 base64 IPC。原始格式只本地存储，预览重编码为 PNG；网络只发已核验 prepared PNG。
- 队列 `recognition.status`/`candidate.list` 用 limit≤100 和签名游标分页；UI 真实轮询补齐失联状态，不造进度。重启 processing→failed/INTERRUPTED，queued 保留但同意失效；增加 `recognition.resume`（仅queued，用户重新同意/费用提示），与 retry 区分。恢复会中止旧世代任务并重建服务，旧响应无权写新世代。
- 业务 prompt `bk-receipt.s10.v1` 使用 S09 已验证的固定 endpoint/model/schema 传输；分类只发送本账本启用分类。无训练授权，不上传正式交易。实际模型/用量仅由响应填入；provider 不重试，调度器唯一负责重试。
- 候选持久 proposal/current/evidence/missing/warnings/duplicateMatches，保留 job→asset→hash/version 来源链。字段不足不猜，非支出标阻断/默认排除；同组总额+明细和缺 groupKey 的混合总额/明细均阻断。相同图默认复用，forceNew 要理由及再同意；字段重复含正式交易及候选，仅提示不删数据。
- 本步候选只读展示；拒绝/补全/原子批准与审计由 S11 实现，不通过任何 IPC 暴露 createAiTransaction。AC07-C 仅提供真实 SQLite 待审和 failed 前置及隔离自测。
- S05 内部备份仍为 DB-only，S10 有附件后必须拒绝创建/恢复带附件的 DB-only 档案，避免伪称完整；S15 完整附件备份仍待实现。已有无附件备份回归须保持。

影响：CONTRACTS、UX、ARCHITECTURE、迁移、IPC/preload、主进程文件/队列/provider、导入/队列/草稿 UI、原生依赖与许可、自检白名单、测试和交接。G2 保留 S09 已接收依据；新增链路需本轮实际调用证据，不能以继承 G2 代替。G3～G6 不升级。
