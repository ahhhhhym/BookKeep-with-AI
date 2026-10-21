# BookKeepAI（S09 安全配置与图片探针接收版）

当前进度（2026-10-21）：**S09-R1接收通过，G1、G2通过**，见[最新接收](handoff/S09/ACCEPTANCE-R1.md)和[本轮证据](evidence/RECEIPT-S09-R1/RECEIPT.md)。214测试、配置/IPC/重启与新真实图片868b8828验证通过。基础AC01～AC06、AC07-A/B依据[S08-R2](handoff/S08/ACCEPTANCE-R2.md)保留；C仍“未执行，待S11/G3验证、S17复验”，AC07父项未通过。S10等待用户另行启动，G3～G6未通过、正式ZIP未生成。原失败/自测证据保留。

中文 Windows 桌面 AI 辅助记账软件。**当前为 S09 阶段接收版**：沿用 S05 SQLite
迁移、默认账本与 34 个分类种子、分类/交易仓储与受限 IPC、版本冲突、软删除与审计、
一致快照备份与恢复基础，并接入手工记账表单、日期列表与筛选、同源统计图表及安全密钥配置/固定合成图真实探针。业务图片导入、队列/候选、审核入账与 CSV 导出尚未实现。

- 完成状态：S01～S03文档、S04工程骨架、S05数据/仓储已通过对应阶段接收，最新为
  [S05-R2接收](handoff/S05/ACCEPTANCE-R2.md)。该轮148项测试、13项定向回归及两次28/28启动自检
  属于既有S05接收证据；S06/S07亦通过本阶段接收。S08-R2本轮重新执行181测试、15+22+15+7组既有流程、28+28启动及123范围；新增D49 29组和补充13组，G1通过，AC07-C/父项未通过。
- 后续负责人：**S06～S20全部交给Codex**，包括编程、测试、修复、验收、构建打包与说明；
  DSH保留S04/S05历史实现归属。见[AGENTS](AGENTS.md)、[决策D43](docs/DECISIONS.md)和
  [分步中文提示词](分步中文提示词.md)。下一步S10由用户另行启动，本轮未实施。
- 实现自测与S08/S17/S19验收分轮，验收固定版本且当轮不改被验代码；失败返回对应Codex实现步骤。
  同一会话兼任实现/验收须披露；人类仍提供样本/真值、本地密钥、必要补验并决定最终发布。
- 规格来源：`docs/PRD.md`、`docs/ARCHITECTURE.md`、`docs/CONTRACTS.md`、`docs/UX.md`、
  `docs/ICON-MAP.md`、`docs/FIXTURES.md`、`docs/DECISIONS.md`。
- S06交接：`tasks/S06.md`、`handoff/S06/HANDOFF.md`、`evidence/S06/`。
- S07交接：`tasks/S07.md`、`handoff/S07/HANDOFF.md`、`evidence/S07/`。
- S07接收：`handoff/S07/ACCEPTANCE-R1.md`、`evidence/RECEIPT-S07-R1/`，不替代S08/G1。
- S09接收：[ACCEPTANCE-R1](handoff/S09/ACCEPTANCE-R1.md)、[验收报告](evidence/RECEIPT-S09-R1/RECEIPT.md)；原实现自测在`handoff/S09/HANDOFF.md`，两者分开保留。
- 历史S05交接：`tasks/S05.md`、`handoff/S05/HANDOFF.md`、`handoff/S05/REWORK-R1.md`、
  `handoff/S05/REWORK-R2.md`、`evidence/S05/`、`evidence/S05-R1/`、`evidence/S05-R2/`。

## 1. 技术栈与锁定版本

| 组件 | 版本 | 说明 |
|---|---|---|
| Electron | 44.9.1 | Chromium 152 / Node 24.22 / ABI modules 149，win32-x64 官方构建 |
| React / React DOM | 19.3.1 | 渲染层（Vite 打包进本地资源） |
| TypeScript | 5.9.3 | 仅类型检查（`--noEmit`）；未采用 7.0 原生预览，避免工具链风险 |
| Vite | 8.3.4 | 渲染层构建与 dev server |
| esbuild | 0.28.2 | 主进程 / preload 打包（强制 CJS） |
| better-sqlite3 | 13.0.3 | Node-API 预编译二进制，无需 MSVC、无需 electron-rebuild |
| electron-builder | 26.15.3 | Windows x64 ZIP |
| Vitest | 5.0.5 | 单元测试 |
| lucide-react / lucide-static | 1.60.0 | 本地图标（ISC + Feather 衍生 MIT），42 个 slug 已逐项核验 |

版本全部精确固定，锁文件为 `package-lock.json`；`package.json` 的 `allowScripts`
显式允许 `electron`、`esbuild` 的安装脚本（npm 11 默认拦截安装脚本，否则 Electron
二进制不会下载）。

## 2. 环境要求

- Windows 10/11 x64（本轮实测 Windows 10 22H2 19045，未执行 Win11）。
- Node.js ≥ 22.12（实测构建机：`C:\Program Files\nodejs\node.exe` v24.19.0，npm 11.17.0）。
- 不需要 Visual Studio / Windows SDK / Python：better-sqlite3 使用预编译 N-API 二进制。
- 不需要安装 DSH；软件运行不依赖任何开发工具。

## 3. 安装

```powershell
cd "D:\BookKeep with AI"
npm install
```

> 说明：本机执行 `npm install` 时已用 `npm approve-scripts electron esbuild --allow-scripts-pin`
> 把两个安装脚本写入 `package.json.allowScripts`。若在干净机器上 Electron 二进制缺失，
> 执行 `node node_modules/electron/install.js` 补下载。

## 4. 开发运行

```powershell
npm run dev
```

- Vite dev server 固定 `http://127.0.0.1:5273`，Electron 通过 `BOOKKEEP_DEV_SERVER_URL`
  加载该地址；修改渲染层代码热更新，修改主进程/preload 会自动重启窗口。
- 开发模式允许 DevTools（仅 dev server 分支），CSP 仅对本地 dev server 放宽。
- 关闭终端或 `Ctrl+C` 会停止 dev server 与 Electron。

## 5. 构建、测试与自检

| 命令 | 作用 |
|---|---|
| `npm run typecheck` | 主进程 / 渲染层 / 测试三套 tsconfig 类型检查 |
| `npm test` | Vitest 单元/集成测试（契约、校验、安全边界、mock provider、SQLite 迁移/仓储/备份） |
| `npm run verify:icons` | 核验 42 个 Lucide slug 存在，写 `resources/licenses/lucide/ICON-SLUGS.sha256` |
| `npm run licenses` | 收集第三方许可原文到 `resources/licenses/` |
| `npm run build` | 构建 `dist/main`、`dist/preload`、`dist/renderer`，并刷新许可/图标清单 |
| `npm run smoke:electron` | 连续两次启动真实 Electron 执行 28 项自检，并比较重启后默认账本/dataEpoch 是否稳定 |
| `npm run verify` | 上述检查的串联（不含打包） |
| `npm run capture:ui` | 启动窗口逐页截图到 `evidence/S05/screens/`（可传入目录参数覆盖；开发自检证据） |
| `npm run package:zip` | 构建 + electron-builder 生成 `release/BookKeepAI-0.1.0-win-x64.zip` 并核验 |
| `npm run smoke:packaged` | 把 ZIP 解压到 `.tmp/unpacked-smoke`，从解压结果启动 EXE 自检 |
| `npm run verify:zip` | 单独核验最新 ZIP 的必需产物、禁止项与 asar 顶层清单 |
| `npm run clean` | 删除 `dist`、`release`、`.tmp`、`coverage` |

自检覆盖（`src/main/selftest.ts`）：renderer 无 `require/process/module/global`、无
`ipcRenderer`、preload 仅暴露白名单命名空间、CSP 生效、样式生效、8 个导航项、
`settings.ai`/`readStatus` 真实返回、未知载荷被拒、`saveSecret` 明确 `NOT_IMPLEMENTED`、
mock 两场景、DeepSeek 能力 `unverified`、better-sqlite3 在 Electron ABI 下建表查询、
默认账本 34 分类、`ledger.ensureDefault`/`category.list`/`transaction.list`/`backup.list`
真实返回、数据库位于 `data/generations/<id>/ledger.db` 且不在程序目录、
`window.open` 与远端导航被拦截、单实例锁。

## 6. 运行期数据位置与恢复

- 数据根目录固定 `%LOCALAPPDATA%\BookKeepAI`（`data/`、`secrets/`、`backups/`、`logs/`、
  `temp/` 及 Chromium 状态 `shell/`）。**不写入程序解压目录**；自检会断言二者不重叠。
- `data/active.json` 指向当前 generation；`data/generations/<uuid>/ledger.db` 为账本数据库
  （WAL、外键、`synchronous=FULL`），`data/restore-log.jsonl` 为恢复切换日志。
- 默认账本与 34 个分类（33 消费分类 + “其他”）在首次启动同一事务内建立；重启只读取，
  不会重复插入，也不会重置用户改名/停用。
- 备份：`backups/<backupId>.bkdb` 为 `VACUUM INTO` 一致快照 + `bk-backup.v1` 清单；
  `backups/catalog.json` 为独立保留目录，恢复旧账本后仍可发现/校验/再次恢复已保留档案
  （包括所选档案、较新档案与 pre_restore；合并只重建维护元数据，不复制交易/审计）；
  已知创建 hash 是校验基准，目录丢失/扫描/恢复不得用档案当前 hash 覆盖；DB 与目录冲突时
  明确标错并拒绝恢复；
  **不含密钥/日志**。恢复前校验 hash、清单、schema 与完整性，失败不切换、不覆盖当前数据；
  成功切换 generation 并更换 `dataEpoch`，旧 generation 与 pre_restore 快照保留。
- 迁移：当前 schema v1；未来升级先做 pre_migration 备份，失败回滚并标记
  `recovery_required`（业务写入停止，可用备份恢复）。检测到比应用更新的 schema 拒绝启动。

## 7. 安全边界（骨架已生效）

- 渲染进程：`nodeIntegration=false`、`contextIsolation=true`、`sandbox=true`、禁用 `webview`、
  禁止新窗口与远端导航、拒绝全部权限请求、拒绝浏览器下载。
- 生产页面通过自定义协议 `bookkeep://app/` 提供，拒绝目录穿越与未知文件；CSP
  `default-src 'none'` + 仅本地脚本、无外部连接。
- 渲染层只能访问 preload 白名单：`settings.*`、`provider.capabilities`、`ledger.ensureDefault`、
  `category.list/create/update/disable`、`transaction.create/update/softDelete/restore/list`、
  `backup.create/list/restore`、`skeleton.mockRecognition`；每次都校验发送方（主窗口主 frame +
  来源白名单 + 当前 dataEpoch）、信封、契约版本、载荷键与取值。所有变更走主进程事务，
  渲染层不能指定 source/sourceCandidateId/状态/版本。
- UI 不接触密钥：S04 的 `settings.saveSecret` 校验载荷后返回 `NOT_IMPLEMENTED`，不保存、
  不回显；密码框提交后立即清空。S09真实加密存储与固定图探针已接收，后续S15继续加固。
- mock provider 明确标注“本地模拟，不代表真实识图”，`actualModel=null`，不出网、不写库。

## 8. 常见问题

1. **窗口没打开、进程立刻退出**：本机 DSH 环境会注入 `ELECTRON_RUN_AS_NODE=1`，使
   `electron.exe` 按纯 Node 运行。`scripts/dev.mjs`、`smoke-electron.mjs`、
   `smoke-packaged.mjs` 已在启动前移除该变量；手工启动 Electron 时也要移除。
2. **`npm run smoke:packaged` 报 “Invalid package ...app.asar”**：说明脚本跑在
   Electron-as-Node 下，fs 被 asar 包装接管。脚本已通过 `ensurePlainNode()` 切回真实 Node，
   自定义脚本若直接读写 `.asar` 也需同样处理。
3. **Electron 下载慢/失败**：可设置 `ELECTRON_MIRROR` 或代理后重新执行
   `node node_modules/electron/install.js`。
4. **原生模块加载失败**：确认 `node_modules/better-sqlite3/prebuilds/win32-x64.node` 存在；
   本项目不需要 `electron-rebuild`，请勿对 better-sqlite3 执行 `node-gyp rebuild`。
5. **端口 5273 被占用**：`vite.config.ts` 设置了 `strictPort`，修改端口时需同步
   `src/shared/csp.ts` 中的 `DEV_SERVER_PORT`。

## 9. 目录

```text
src/main/        主进程：单实例、协议、窗口硬化、IPC 路由与校验、provider、自检、SQLite 存储
src/main/db/     schema/迁移、连接、分类/交易/审计/幂等收据仓储、完整性检查
src/main/services/ 账本事务边界、签名 token/游标、备份恢复、存储生命周期
src/main/storage/  generation/active 指针、备份档案、恢复日志
src/preload/     受限 preload（contextBridge，无 ipcRenderer 原生对象）
src/renderer/    React 渲染层：8 个页面，分类维护与备份/恢复读取真实 IPC
src/shared/      契约常量、错误码、DTO、通道路由、金额/日期/文本域、分类/图标种子
tests/unit/      单元 + 集成测试（148 例；`tests/unit/db/` 为 SQLite 真实文件测试）
scripts/         构建、开发、自检、打包、核验、图标/许可脚本
resources/       第三方许可与图标 slug 清单
build/           应用图标（原创生成，scripts/make-icon.mjs）
docs/ tasks/ handoff/ evidence/   规格、任务书、交接与证据（不进入软件 ZIP）
```
