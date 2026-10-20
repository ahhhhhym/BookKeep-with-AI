# S04 工程骨架与打包冒烟交接

版本：S04-1.0｜日期：2026-10-20｜交出者：DSH｜接收者/下一唯一负责人：Codex（独立验收 S04，通过后转 S05 由 DSH 实现）｜
状态：**待验收（DSH 自测完成，非通过）**

## 1. 目标与结论

按用户任务完成 S04：在保留现有文档的前提下初始化 Git 与 Electron + React + TypeScript 工程，锁定兼容
Windows 10/11 x64 的依赖与锁文件，建立 `src/tests/scripts/resources` 目录，主进程/受限 preload/渲染边界与
contextIsolation、sandbox、无 Node 集成、发送方校验从骨架起生效，建立 mock provider 与可演示导航空壳，
预留受限密钥配置接口与设置入口供 S09，定义脚本入口并写开发运行说明，完成 Windows x64 ZIP 构建冒烟并验证
SQLite 原生模块与 Electron ABI。

实际结论：工程可运行、可构建、可打包；**dev 与解压后 ZIP 各 22/22 骨架自检通过**；better-sqlite3 13.0.3
（Node-API）在 Electron 44.9.1 主进程加载并完成建表/插入/查询。业务功能（账本、统计、真实识图、审核）
尚未实现；G1～G6 全部未执行；骨架自测与 ZIP 冒烟**不是业务验收**，也**不是** AC20/AC22 的通过。

## 2. 基线与工作区

- 仓库：`D:\BookKeep with AI`，分支 `main`，Git 2.56.0.windows.2（便携 MinGit，未写入系统 PATH）。
- 提交（按时间顺序）：
  1. `2440947` docs: 基线文档入库（S01～S03 交付原样保留，45 文件；`.gitattributes` 关闭换行转换，历史 SHA256 可复算）
  2. `7ffbed3` feat(S04): Electron + React + TypeScript 工程骨架（107 文件）
  3. 后续一次文档提交：`tasks/S04.md`、本 HANDOFF、`evidence/S04/`（本文所在提交，见
     `git log -1 --format=%H -- handoff/S04/HANDOFF.md`）
- 代码基线 commit：`7ffbed3`；软件 ZIP 与证据均对应该 commit 的源码。
  ZIP 只含 `src→dist` 构建产物与运行依赖；`scripts/` 为开发脚本、不进入 ZIP（含 dev 初次构建去重修复）。
- 工作区：交出时应为干净（`git status --short` 无输出）；无运行中的 Electron/Vite/electron-builder 进程；
  无后台任务遗留。`.tmp/`、`dist/`、`release/`、`node_modules/` 均在 `.gitignore` 中，不入库。
- 既有文档未被改写：`docs/`、`tasks/S01～S03`、`handoff/S01～S03`、`evidence/S01～S03`、`references/`、
  `执行看板.md` 与根规范文件的字节与 S01～S03 证据一致（§4）。`执行看板.md` 的 S04 状态仍为“未开始”，
  由 Codex 验收后更新。

## 3. 已读取输入

- 根规范：`AGENTS.md`、`执行看板.md`、`开发方案.md`、`交接与验收.md`。
- 交接：`handoff/S01/HANDOFF.md`、`handoff/S02/HANDOFF.md`、`handoff/S03/HANDOFF.md`。
- 规格：`docs/PRD.md`、`docs/ARCHITECTURE.md`、`docs/CONTRACTS.md`、`docs/UX.md`、`docs/ICON-MAP.md`、
  `docs/DECISIONS.md`、`docs/ACCEPTANCE.md`。
- 任务/证据：`tasks/S03.md`、`evidence/S03/RECEIPT.md`、`evidence/S03/{INPUTS,OUTPUTS}.sha256`、
  `evidence/S02/OUTPUTS.sha256`、`evidence/S01/OUTPUTS.sha256`。
- 20 项输入的逐文件 SHA256 见 `evidence/S04/INPUTS.sha256`；核验结果见 `evidence/S04/REVIEW.md` §2。
- 未查看五张参考图（S03 已裁定并固化到 UX/ICON-MAP，S04 不据此改视觉语义）；未读取任何 DSH 凭证或配置。

## 4. 实际产物

全部新文件位于 `7ffbed3` 与后续文档提交；最终文件清单与 SHA256 见 `evidence/S04/OUTPUTS.sha256`。

| 路径 | 用途 |
|---|---|
| `.gitattributes`、`.gitignore` | `-text` 保历史字节；忽略 node_modules/dist/release/.tmp/密钥与运行数据 |
| `package.json`、`package-lock.json` | 精确版本 + 锁文件；`allowScripts` 固定 electron/esbuild 安装脚本 |
| `tsconfig.base/main/renderer/tests.json` | 三套类型检查边界（主进程、渲染层、测试） |
| `vite.config.ts`、`vitest.config.ts` | 渲染层构建（含 CSP 注入插件）、单元测试 |
| `electron-builder.yml` | Windows x64 ZIP、asar、better-sqlite3 解包、许可 extraResources |
| `README.md` | 技术栈、安装、开发、构建、打包、自检、数据位置、安全边界、故障排查 |
| `build/icon.png` | 原创 512×512 应用图标（`scripts/make-icon.mjs` 生成，无外部素材） |
| `src/shared/*` | 契约常量、错误码字典、信封/DTO/通道白名单、分类与图标种子、`bk-candidate.v1` 校验与规范化、CSP |
| `src/main/*` | 单实例、`bookkeep://app` 协议、窗口/会话硬化、IPC 路由与请求校验、发送方校验、限流、provider 注册表、设置状态、自检、截图 |
| `src/preload/*` | contextBridge 白名单 API（4 命名空间），不含 ipcRenderer/Node |
| `src/renderer/*` | 8 页导航空壳、34 分类图标展示、mock 演示、设置页受限密钥入口、CSP 兼容样式、响应式导航 |
| `tests/unit/*` | 11 个文件、77 例：契约/校验/通道/发送方/安全配置/mock/schema/路径/限流/导航/图标 |
| `scripts/*` | `dev`、`build`、`typecheck` 之外的 `smoke-electron`、`package-zip`、`smoke-packaged`、`verify-zip`、`verify-icons`、`collect-licenses`、`capture-ui`、`make-icon`、`clean` 及 `lib/{paths,zip,ts-module}` |
| `resources/licenses/*` | 12 个第三方许可原文 + `summary.json` + `THIRD-PARTY-NOTICES.md` + `lucide/ICON-SLUGS.sha256` |
| `tasks/S04.md`、本 HANDOFF、`evidence/S04/*` | 任务书、交接、证据（含 8 张页面截图、两份自检 JSON、日志、ZIP 清单与哈希） |

## 5. 验证（环境、命令、退出码、证据）

环境：Windows 10 22H2 19045 x64；pwsh 7.6.7 Core / UTF-8；系统 Node v24.19.0；npm 11.17.0；
Electron 44.9.1（Chromium 152 / Node 24.22 / ABI 149）。完整记录与命令见 `evidence/S04/REVIEW.md`，
环境见 `evidence/S04/build-env.txt`。

| 验证 | 命令 | 退出码 | 结果 | 证据 |
|---|---|---|---|---|
| 输入核验 | 逐文件 SHA256 | 0 | S01 8/8、S02 10/10、S03 12/12、S03 输入 22/22 | REVIEW §2 |
| 类型检查 | `npm run typecheck` | 0 | 三套 tsconfig 通过 | logs/verify.log |
| 单元测试 | `npm test` | 0 | 11 files / 77 tests | logs/verify.log |
| 图标核验 | `npm run verify:icons` | 0 | 42/42 slug 存在 | resources/licenses/lucide/ICON-SLUGS.sha256 |
| 构建 | `npm run build` | 0 | dist/{main,preload,renderer} | logs/verify.log |
| 骨架自检（dev） | `npm run smoke:electron` | 0 | 22/22 | selftest-dev.json |
| 打包 | `npm run package:zip` | 0 | 147.30 MiB / 134 条目 | logs/package-zip.log |
| 解压冒烟 | `npm run smoke:packaged` | 0 | 解压 112 文件，EXE 自检 22/22 | selftest-packaged.json |
| ZIP 核验 | `npm run verify:zip` | 0 | 必需项齐全、禁止项 0 | zip-listing.txt |
| 页面截图 | `npm run capture:ui` | 0 | 8 张 | screens/*.png |
| 单实例 | 手工启动两次 EXE | 0 | 第二实例 151 ms 退出，第一实例继续运行 | REVIEW §5 #15 |
| 开发模式 | `npm run dev` | 手工 | dev server 配置端口 5273；Electron 窗口标题 `BookKeepAI` 实际出现 | REVIEW §5 #16（手工观察，dev 日志未保存） |
| ABI | Electron 主进程加载 better-sqlite3 | 0 | 建表/插入/查询通过，SQLite 3.53.4 | selftest JSON `sqlite.better-sqlite3` |

软件 ZIP：`release/BookKeepAI-0.1.0-win-x64.zip`
SHA256 `3B15315A7D0AFDDB530F5188E2A547262B4E1221685451B6FEFC8F6385A5B013`（154,459,657 B）。
该文件是本机构建产物，`release/` 已被 `.gitignore` 排除、**未入库**；可追溯证据为
`evidence/S04/zip-sha256.txt`（SHA256）与 `evidence/S04/zip-listing.txt`（134 条目清单），
重新生成的 ZIP 因时间戳不同可能哈希不同，S18 以正式构建清单为准。
**这是 S04 骨架冒烟包，不是 S18 正式软件包**：未签名、未做干净系统验收，版本 0.1.0。

## 6. 需求覆盖（AC 逐项）

S04 只覆盖工程/边界/打包准备。除下表“部分证据”外，全部 AC 仍为**未执行**；不给任何 G 门结论。

| AC | S04 相关落点 | 状态 |
|---|---|---|
| AC01 默认账本/分类/重启 | 分类种子与 34 ID 已固化并展示；账本/落库未实现 | 未执行（S05/S08） |
| AC02 金额 | 金额工具函数与候选 schema 结构校验；表单/持久化未实现 | 未执行（S06/S08） |
| AC03 日期 | 账本时区展示工具；日期逻辑未实现 | 未执行（S06/S07） |
| AC04 修改删除恢复/搜索 | 仅导航空壳 | 未执行（S05～S07） |
| AC05 周/月/年 | 周期切换控件占位，无数据 | 未执行（S07） |
| AC06 日/月 Top3 | 未实现 | 未执行（S07） |
| AC07 固定数字账本 | 未实现 | 未执行（S07/S08） |
| AC08 真实图片 API | DeepSeek 适配器为 stub（`unverified`），无任何网络调用 | 未执行（S09/G2） |
| AC09 缺字段/多笔/合计 | mock 三场景演示候选结构与阻断；真实链路未实现 | 未执行（S10/S11） |
| AC10 审核隔离 | 无候选表、无入账路径；审核页为空态 | 未执行（S11） |
| AC11 幂等/并发 | 唯一约束与事务未实现 | 未执行（S11/S16） |
| AC12 重复截图 | 未实现 | 未执行（S10/S11） |
| AC13 API 异常 | 错误码字典与限流骨架；无真实请求 | 未执行（S09/S15） |
| AC14 无效/危险图片 | `bk-candidate.v1` 结构与长度上限校验；图片校验未实现 | 未执行（S10/S15） |
| AC15 密钥与 IPC | **部分证据**：renderer 无 Node/ipcRenderer、发送方+信封+载荷校验、密钥接口 NOT_IMPLEMENTED、无密钥入库 | 未执行（S09/S15；ZIP/日志检查在 S19） |
| AC16 CSV/备份恢复 | 数据管理页入口占用；文件操作为 NOT_IMPLEMENTED | 未执行（S15） |
| AC17 数据集闭环 | 未实现 | 未执行（S12～S14） |
| AC18 框架真实性 | 未实现（训练 submit 未定义，不得称支持） | 未执行（S13） |
| AC19 错误训练声明 | UI/README/HANDOFF 明确“AI 实验性、未验收、未训练” | 未执行（S14/S20） |
| AC20 软件 ZIP | **部分证据**：ZIP 可解压运行、原生 SQLite 随包加载、无开发依赖；仅 Windows 10 本机、非干净系统、骨架包 | 未执行（S18/S19） |
| AC21 UI 交互 | **部分证据**：8 导航、图标+文字、跳过链接、抽屉 Esc 关闭、两种宽度截图；真实业务交互/缩放/IME 未验收 | 未执行（S17/S19） |
| AC22 发布可追踪 | **部分证据**：commit、锁文件、许可、ZIP 哈希、asar 清单、禁止项检查；非正式包 | 未执行（S18/S19/S20） |

## 7. 已知问题、偏差与需 Codex 处理项

自测未发现 P0/P1 级实现缺陷；以下为实现补充/登记项（严重度按交接规范由 Codex 复核确认）：

| 编号 | 严重度 | 内容 | 建议处理 |
|---|---|---|---|
| N01 | P3（范围） | `skeleton.mockRecognition` 为 S04 诊断通道（本地 mock、不出网、不写库，已与业务通道分离并有单测断言） | 记为临时通道，S10 由 `recognition.start` 取代后删除 |
| N02 | P3（实现） | 会话级 `dataEpoch`（每次启动随机 UUID），仅用于验证“非启动操作必须携带当前世代” | S05 用 `AppMeta.dataEpoch` 持久化世代替换 |
| N03 | P3（文档） | 导航新增 7 个 Lucide slug（合计 42，已逐项核验存在与许可） | 在 ICON-MAP 补登记导航图标 |
| N04 | P3（契约） | 失败信封 details 允许 `capability`/`step`/`reason` 三个安全键 | CONTRACTS §1 details 白名单补记 |
| N05 | P2（语义） | mock 的 `structuredOutputStatus=verified` 只表示本地适配器输出符合 `bk-candidate.v1`，**不是** G2 证据；DeepSeek 为 `unverified` | CONTRACTS §7.1 注明 mock 语义；UI 已显著标注“本地模拟” |
| N06 | P3（契约） | 取值/语义错误用 `FIELD_INVALID`，信封/键结构错误用 `PAYLOAD_INVALID` | CONTRACTS §8 明确分界 |
| N07 | P3（技术选型） | TypeScript 选 5.9.3 而非 7.0.2 原生预览 | Codex 决定是否后续升级 |
| N08 | P3（环境） | Git 为便携 MinGit（`%LOCALAPPDATA%\BookKeepAI-tools`），未装系统 Git | 人类/Codex 决定是否安装 Git for Windows |
| N09 | P2（发布） | ZIP 未签名；EXE 246 MB / ZIP 147 MiB | S18 决定签名策略与体积优化 |

环境特异性（不属软件缺陷，已修复并写入 README §8）：DSH 注入 `ELECTRON_RUN_AS_NODE=1`、npm 脚本运行在
Electron-as-Node 下、Electron 的 ASAR fs 包装会让写 `app.asar` 失败、npm 11 默认拦截安装脚本。

## 8. 未执行 / 限制

- Windows 11、干净机器、双系统、中文空格路径的解压启动（本机路径含空格已验证）、离线场景：**未执行**。
- 人工桌面观察（缩放 100/125/150/200%、小屏 640×480、IME、键盘全流程、读屏、并排审核）：**未执行**。
- 代码签名、安装包、自动更新、正式 ZIP/源码 ZIP 与构建清单：**未执行**（S18）。
- 真实 DeepSeek 图片请求、密钥安全存取、真实探针：**未执行**（S09/G2）。
- 数据库、迁移、备份恢复、CSV、统计、审核、数据集/评测：**未实现**（S05～S15）。
- 参考图未在 S04 重新查看；S04 未改动任何业务/契约语义。

## 9. 接收动作（Codex）

1. 先读 `AGENTS.md`、`执行看板.md`、`tasks/S04.md`、本 HANDOFF，再按 `evidence/S04/INPUTS.sha256` 与
   `evidence/S04/OUTPUTS.sha256` 复核实物哈希（`git status` 应干净，`git log --oneline` 应含 `2440947`、`7ffbed3`
   与文档提交）。
2. 复跑（不影响源码，仅生成 dist/release）：`npm ci`（可选，需重新下载 Electron）→ `npm run typecheck` →
   `npm test` → `npm run build` → `npm run smoke:electron`；再 `npm run verify:zip` 复核 ZIP 与
   `evidence/S04/zip-listing.txt` 一致。
3. 核对 `evidence/S04/REVIEW.md` §10 的 N01～N09，决定哪些需要在 `docs/DECISIONS.md`/`CONTRACTS` 登记；
   N05/N09 建议在 S09/S18 前定稿。
4. 若通过：更新 `执行看板.md`（S04 通过），把唯一写权限与任务交回 DSH 执行 S05（SQLite、默认账本、分类、
   迁移、仓储），并保留“骨架冒烟≠业务验收”的证据分层。若不通过：写问题单（编号/严重度/复现/证据），
   由 DSH 修复后回本步复验。

## 10. 保密自查

- 未读取或复制 DSH 凭证/配置；未使用真实 API key；未进行任何真实识图请求。
- 代码、测试、日志、截图、ZIP、本文与 `evidence/S04/*` 均无密钥、完整请求头、图片 base64、真实账本或
  个人消费数据；mock 与测试数据全部为合成。
- 敏感模式扫描（`sk-`、`Bearer`、私钥头、`AKIA`、`api_key=`）0 命中；无 `.env`/证书/密钥文件；
  ZIP 禁止项检查 0 命中（`evidence/S04/REVIEW.md` §8）。
- 未向任何聊天或外部系统发送交接内容；由开发者手动转交。
