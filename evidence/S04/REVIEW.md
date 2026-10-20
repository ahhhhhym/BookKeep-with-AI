# S04 自测与证据记录

版本：S04-1.0｜日期：2026-10-20｜执行者：DSH｜结论：自测通过，待 Codex 独立验收；G1～G6 未执行

本文件记录 S04 实际执行的命令、退出码与结果。**骨架自测与 ZIP 冒烟不是业务验收**：账本、统计、
真实识图、审核入账均未实现，AC01～AC22 的软件用例除下列“部分证据”外全部未执行。

## 1. 命令环境

| 项 | 实际值 |
|---|---|
| PowerShell | `C:\Users\Administrator\AppData\Local\Microsoft\WindowsApps\pwsh.exe`，7.6.7 Core |
| 编码 | 控制台输出/输入 UTF-8 |
| 操作系统 | Microsoft Windows 10 专业版 10.0.19045 x64 |
| 系统 Node（构建/测试/打包） | v24.19.0 @ `C:\Program Files\nodejs\node.exe` |
| npm | 11.17.0 |
| npm 脚本运行时 | DSH 的 Electron-as-Node shim（`ELECTRON_RUN_AS_NODE=1`，内部 Node 24.17.0），见 §4 |
| Git | 2.56.0.windows.2（便携 MinGit v2.56.0.2，位于 `%LOCALAPPDATA%\BookKeepAI-tools`） |
| Electron | 44.9.1（Chromium 152.0.7977.167 / Node 24.22.0 / ABI modules 149 / napi 10） |
| SQLite | 3.53.4（better-sqlite3 13.0.3 内置） |

完整环境记录：`evidence/S04/build-env.txt`。

## 2. 输入接收核验（S01～S03）

用固定 pwsh 执行逐文件 SHA256 比对；历史文档的“修改前快照”作为别名参与核对：

| 清单 | 条目 | 结果 |
|---|---|---|
| `evidence/S03/OUTPUTS.sha256` | 12 | 12/12 匹配 |
| `evidence/S03/INPUTS.sha256` | 22 | 22/22 匹配（`执行看板.md`→S03 before，`docs/DECISIONS.md`→S03 before） |
| `evidence/S02/OUTPUTS.sha256` | 10 | 10/10 匹配（决策/看板用 S03 before 快照） |
| `evidence/S01/OUTPUTS.sha256` | 8 | 8/8 匹配（看板用 S02 before 快照） |

结论：S03 交付实物与哈希一致，S01/S02 历史接收可通过快照复核，未发现阻断 S04 的契约冲突。
本步直接读取的 20 个输入文件指纹见 `evidence/S04/INPUTS.sha256`。

## 3. 依赖查询与版本决策

`npm view` 实际查询（2026-10-20，官方仓库 dist-tags）：

| 组件 | 选择 | 理由 |
|---|---|---|
| Electron | 44.9.1 | 当日 latest 稳定版；正式支持 Windows 10 1809+，官方提供 win32-x64 产物；Node 24.22 / Chromium 152 |
| React / React DOM | 19.3.1 | latest；`lucide-react` peer 兼容 |
| TypeScript | 5.9.3 | **未采用 7.0.2 原生预览**：本项目要求稳定 tsc 行为，降低工具链风险；由 Codex 决定是否升级 |
| Vite | 8.3.4 | latest；engines `^20.19 || >=22.12`，与构建机 Node 24.19 兼容 |
| @vitejs/plugin-react | 6.1.2 | 与 Vite 8 peer 兼容（其余 peer 均可选） |
| better-sqlite3 | 13.0.3 | 13.x 改为 Node-API（`node-addon-api`）+ 预置 `prebuilds/`，无需 MSVC；`engines node>=22` |
| electron-builder | 26.15.3 | Windows x64 ZIP 目标 |
| Vitest | 5.0.5 | 与 Vite 8 peer 兼容；Node 24 满足 engines |
| lucide-react / lucide-static | 1.60.0 | 同一版本双包：运行时组件 + slug/许可核验源 |

锁文件：`package-lock.json`（提交入库）。所有直接依赖为精确版本，无 `^`/`~`。
`package.json.allowScripts` 固定允许 `electron@44.9.1`、`esbuild@0.28.2` 的安装脚本（npm 11 默认拦截）。

## 4. 环境特异性问题与修复（重要，不代表软件依赖 DSH）

1. **`ELECTRON_RUN_AS_NODE=1` 被注入**：首次直接运行 `electron.exe` 时进程按纯 Node 执行
   （报 `Cannot find module 'electron'`，打印 Node 24.22）。移除该变量后正常。
   → `scripts/lib/paths.mjs::electronSafeEnv()` 在启动 Electron 前删除该变量；
   `scripts/smoke-packaged.mjs`、`scripts/smoke-electron.mjs` 均使用它。
2. **npm 脚本运行在 Electron-as-Node 下**：`process.execPath` 是 DSH 桌面端可执行文件，
   直接 `spawn(process.execPath, cli)` 会启动 GUI 而不是 Node（首次 `package:zip` 因此失败，
   日志出现 “Another instance is already running”）。
   → `nodeExecutable()` 只接受 basename 为 `node.exe` 的路径，回退系统 Node；
   `package:zip` 用真实 Node 启动 electron-builder。
3. **Electron 的 ASAR fs 包装**：在 Electron-as-Node 下写 `resources/app.asar` 会被 fs 包装拦截
   （`Error: Invalid package ...app.asar`）。
   → `ensurePlainNode()` 让需要接触 `.asar` 的脚本先切回真实 Node；`smoke:packaged` 已接入。
4. **npm 11 安装脚本拦截**：`npm install` 未执行 electron/esbuild 的 postinstall（Electron 二进制缺失）。
   → `npm approve-scripts electron esbuild --allow-scripts-pin` 写入 `package.json.allowScripts`，
   并以 `node node_modules/electron/install.js` 补齐二进制；干净机器按 README 复现。
5. **无 MSVC / Windows SDK / Python**：better-sqlite3 13.0.3 使用 Node-API 预编译二进制，
   未执行 `electron-rebuild`、未编译 C++；ABI 验证见 §6。

以上均属开发/构建环境适配，**软件运行不依赖 DSH、Node、Python 或任何开发工具**（ZIP 内含 Electron 运行时）。

## 5. 命令、退出码与结果

| # | 命令 | 退出码 | 关键结果 |
|---|---|---|---|
| 1 | `git init -b main` + 三种提交（基线/工程/文档） | 0 | 基线 `2440947`；工程 `7ffbed3`；文档提交见 `git log -1 -- handoff/S04` |
| 2 | `npm install --no-audit --no-fund` | 0 | 329 包，57 s |
| 3 | `node node_modules/electron/install.js` | 0 | `electron.exe` 246,588,416 B |
| 4 | Electron ABI 探测（临时最小 main） | 0 | `{"electron":"44.9.1","node":"24.22.0","modules":"149","napi":"10","betterSqlite3":"13.0.3","sqliteVersion":"3.53.4","queryOk":true,"ok":true}` |
| 5 | `npm run typecheck` | 0 | 三套 project 全通过 |
| 6 | `npm test` | 0 | 11 files / 77 tests 通过 |
| 7 | `npm run verify:icons` | 0 | 42/42 slug（34 分类 + 8 导航），lucide-static 1.60.0 |
| 8 | `npm run build` | 0 | `dist/main/index.cjs`、`dist/preload/index.cjs`、`dist/renderer/*` |
| 9 | `npm run smoke:electron` | 0 | 22/22 通过（`.tmp/selftest-dev.json`） |
| 10 | `npm run package:zip` | 0 | 147.30 MiB / 134 条目，ZIP 核验通过 |
| 11 | `npm run smoke:packaged` | 0 | 解压 112 文件；EXE 自检 22/22 通过 |
| 12 | `npm run verify:zip` | 0 | 必需项齐全、禁止项 0 |
| 13 | `npm run capture:ui` | 0 | 8 张页面截图 |
| 14 | `npm run verify`（串联 5～9） | 0 | 13.1 s |
| 15 | 单实例手工验证 | 0 | 第二实例 151 ms 退出（code 0），第一实例继续运行 |
| 16 | `npm run dev` 手工验证 | 手工结束 | dev server 配置端口 5273；Electron 窗口标题 `BookKeepAI` 实际出现（9 个 electron 进程，其中 4 个属于本项目，已只终止本项目进程）；dev 日志未保存 |

日志：`evidence/S04/logs/{verify,package-zip,smoke-packaged,verify-zip,capture}.log`。

## 6. ABI 与 ZIP 冒烟证据

- better-sqlite3 加载发生在 **Electron 主进程**：`:memory:` 建表 → 插入 4426 分 → 查询一致；
  报告项 `sqlite.better-sqlite3` 记录 `sqliteVersion=3.53.4`、`modules=149`、`napi=10`。
- 软件 ZIP：`release/BookKeepAI-0.1.0-win-x64.zip`
  - SHA256：`3B15315A7D0AFDDB530F5188E2A547262B4E1221685451B6FEFC8F6385A5B013`
  - 大小 154,459,657 B（147.30 MiB），134 条目，`evidence/S04/zip-listing.txt`
  - `app.asar` 顶层仅 `dist`、`node_modules`、`package.json`
  - 原生部分 `resources/app.asar.unpacked/node_modules/better-sqlite3/prebuilds/win32-x64.node`
  - `resources/licenses/` 含第三方许可与 `lucide/ICON-SLUGS.sha256`
  - 禁止项检查 0 命中：无顶层 `node_modules/`、无 `src|tests|scripts|docs|handoff|evidence|tasks|references`、
    无 `.map`、无 `.env`、无 `.pem/.key/.pfx`、无 `.db`、无 `package-lock.json`、无构建配置、无开发工具链
  - EXE 元数据：FileVersion 0.1.0、ProductName BookKeepAI；**签名状态 NotSigned**（无证书）
- 解压冒烟：`.tmp/unpacked-smoke` 解压 112 文件 → 运行 `BookKeepAI.exe --self-test` → 22/22；
  报告 `evidence/S04/selftest-packaged.json`。

## 7. 自检覆盖（22 项，dev 与解压后 ZIP 均通过）

`environment.versions`、`storage.localAppDataRoot`、`window.webPreferences`、`app.singleInstanceLock`、
`renderer.nodeIsolation`（`require/process/module/global` 全部 undefined）、`preload.bridgeSurface`
（仅 4 个命名空间 + 2 个常量）、`renderer.mounted`（8 导航项）、`renderer.stylesApplied`、
`renderer.contentSecurityPolicy`（`default-src 'none'` 等 5 条必需指令）、`renderer.noRemoteResources`、
`ipc.settingsAi`、`ipc.settingsReadStatus`、`ipc.rejectsUnknownPayloadKey`、`ipc.saveSecretStub`、
`provider.mockTwoExpenses`、`provider.mockMissingFieldsBlock`、`provider.deepseekStub`、
`ipc.channelWhitelist`（5 通道且无 `ipcRenderer`）、`sqlite.better-sqlite3`、`window.openDenied`、
`navigation.remoteBlocked`、`renderer.origin`（`bookkeep://app`）。

## 8. 敏感信息自查

- `grep` 规则（源码/脚本/配置/文档，排除 node_modules/dist/release/.tmp）：
  `sk-[A-Za-z0-9]{8,}`、`Bearer <token>`、`-----BEGIN … PRIVATE KEY-----`、`AKIA[0-9A-Z]{16}`、
  `api_key = "…"` → **0 命中**。
- 无 `.env`、`*.pem`、`*.key`、`*.pfx`、`credentials*`、`*secret*` 文件。
- 未读取、未复制 DSH 凭证或配置；未写入任何真实 API key；mock 与测试数据均为合成。
- ZIP 禁止项检查 0 命中（见 §6）；`resources/licenses` 只含许可原文与版本/哈希清单。
- 本记录、HANDOFF 与截图中不含密钥、完整请求头、图片 base64 或真实账本。

## 9. 未执行项（不得由上述结果推断通过）

| 项 | 原因 | 下一执行者 |
|---|---|---|
| G1～G6 任一软件门 | 业务功能尚未实现 | S05～S19 |
| Windows 11、干净机器、双系统 | 本机只有 Windows 10 22H2 | Codex S19/人类 |
| 人工桌面验收（缩放/IME/键盘/读屏/并排审核） | 骨架无业务页面，且属人工观察 | Codex/人类 S17/S19 |
| 代码签名 | 无证书 | 人类/S18 |
| 真实 DeepSeek 图片请求 | S04 不实现，需 S09 本地密钥 | DSH S09（G2） |
| 密钥加密存储 | S04 明确 NOT_IMPLEMENTED | DSH S09 |
| 数据库/迁移/备份恢复/CSV | 未实现 | S05/S06/S15 |
| 安装包/自动更新/正式 ZIP 清单 | 不在 S04 范围 | S18 |

## 10. 需 Codex 确认或登记的偏差（实现补充，未改契约语义）

| 编号 | 内容 | 建议 |
|---|---|---|
| N01 | `skeleton.mockRecognition` 通道（S04 诊断，本地 mock、不出网、不写库，已排除在业务通道外） | 在 CONTRACTS/DECISIONS 记为 S04 临时通道，S10 由 `recognition.start` 取代后删除 |
| N02 | 会话级 `dataEpoch`（每次启动随机 UUID，仅用于验证“非启动操作必须带当前世代”） | S05 起由 `AppMeta.dataEpoch` 持久化世代替换 |
| N03 | 导航图标新增 7 个 slug（notebook-pen、chart-line、image-plus、list-checks、clipboard-check、layout-grid、database），合计 42 | 在 ICON-MAP 补登记导航图标与许可范围 |
| N04 | 失败信封 `details` 允许 `capability`/`step`/`reason` 三个安全键 | 在 CONTRACTS §1 details 白名单补记 |
| N05 | mock 的 `structuredOutputStatus=verified`（仅指本地适配器输出符合 bk-candidate.v1），DeepSeek 为 `unverified` | 在 CONTRACTS §7.1 注明 mock 语义，避免被当成 G2 证据 |
| N06 | 语义/取值错误用 `FIELD_INVALID`，信封与键结构错误用 `PAYLOAD_INVALID` | 在 CONTRACTS §8 明确该分界 |
| N07 | TypeScript 选择 5.9.3 而非 7.0.2 | 由 Codex 决定是否在后续步骤升级 |
| N08 | 便携 MinGit 未安装到系统 PATH；`git` 命令需用完整路径或由开发者安装 Git for Windows | 人类/Codex 决定是否装系统 Git |
| N09 | ZIP 未签名；EXE 246 MB、ZIP 147 MiB（Electron 44 + Chromium 152） | S18 决定签名与体积优化 |
