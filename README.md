# BookKeepAI（S04 工程骨架）

中文 Windows 桌面 AI 辅助记账软件。**当前提交只是 S04 工程骨架**：可运行、可构建、
可打包 Windows x64 ZIP，安全边界与 mock provider 已生效；账本、统计、真实识图与
审核业务尚未实现（S05 起逐步落地）。

- 完成状态：骨架自测通过（22/22，含解压后 ZIP 运行），**不是业务验收**；G1～G6 均未执行。
- 规格来源：`docs/PRD.md`、`docs/ARCHITECTURE.md`、`docs/CONTRACTS.md`、`docs/UX.md`、
  `docs/ICON-MAP.md`、`docs/FIXTURES.md`、`docs/DECISIONS.md`。
- 本步骤交接：`tasks/S04.md`、`handoff/S04/HANDOFF.md`、`evidence/S04/`。

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
| `npm test` | Vitest 单元测试（契约、校验、安全边界、mock provider 等） |
| `npm run verify:icons` | 核验 42 个 Lucide slug 存在，写 `resources/licenses/lucide/ICON-SLUGS.sha256` |
| `npm run licenses` | 收集第三方许可原文到 `resources/licenses/` |
| `npm run build` | 构建 `dist/main`、`dist/preload`、`dist/renderer`，并刷新许可/图标清单 |
| `npm run smoke:electron` | 启动真实 Electron 执行 22 项骨架自检，报告写入 `.tmp/selftest-dev.json` |
| `npm run verify` | 上述检查的串联（不含打包） |
| `npm run capture:ui` | 启动窗口逐页截图到 `evidence/S04/screens/`（开发自检证据） |
| `npm run package:zip` | 构建 + electron-builder 生成 `release/BookKeepAI-0.1.0-win-x64.zip` 并核验 |
| `npm run smoke:packaged` | 把 ZIP 解压到 `.tmp/unpacked-smoke`，从解压结果启动 EXE 自检 |
| `npm run verify:zip` | 单独核验最新 ZIP 的必需产物、禁止项与 asar 顶层清单 |
| `npm run clean` | 删除 `dist`、`release`、`.tmp`、`coverage` |

自检覆盖（`src/main/selftest.ts`）：renderer 无 `require/process/module/global`、无
`ipcRenderer`、preload 仅暴露 4 个命名空间、CSP 生效、样式生效、8 个导航项、
`settings.ai`/`readStatus` 真实返回、未知载荷被拒、`saveSecret` 明确 `NOT_IMPLEMENTED`、
mock 两场景、DeepSeek 能力 `unverified`、better-sqlite3 在 Electron ABI 下建表查询、
`window.open` 与远端导航被拦截、单实例锁。

## 6. 运行期数据位置

- 数据根目录固定 `%LOCALAPPDATA%\BookKeepAI`（`data/`、`secrets/`、`backups/`、`logs/`、
  `temp/` 及 Chromium 状态 `shell/`）。**不写入程序解压目录**。
- S04 只创建 `shell/`（Electron 自身状态），没有数据库、附件或真实账本。
- 移动或重新解压程序不会移动账本；跨设备使用备份（S05/S15 实现）。

## 7. 安全边界（骨架已生效）

- 渲染进程：`nodeIntegration=false`、`contextIsolation=true`、`sandbox=true`、禁用 `webview`、
  禁止新窗口与远端导航、拒绝全部权限请求、拒绝浏览器下载。
- 生产页面通过自定义协议 `bookkeep://app/` 提供，拒绝目录穿越与未知文件；CSP
  `default-src 'none'` + 仅本地脚本、无外部连接。
- 渲染层只能访问 preload 白名单：`settings.readAi/readStatus/saveSecret`、
  `provider.capabilities`、`skeleton.mockRecognition`；每次都校验发送方（主窗口主 frame +
  来源白名单 + 当前 dataEpoch）、信封、契约版本、载荷键与取值。
- UI 不接触密钥：S04 的 `settings.saveSecret` 校验载荷后返回 `NOT_IMPLEMENTED`，不保存、
  不回显；密码框提交后立即清空。真实加密存储与探针由 S09 实现。
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
src/main/        主进程：单实例、协议、窗口硬化、IPC 路由与校验、provider、自检
src/preload/     受限 preload（contextBridge，无 ipcRenderer 原生对象）
src/renderer/    React 渲染层：导航空壳、8 个页面、mock 演示
src/shared/      契约常量、错误码、DTO、通道白名单、分类/图标种子、候选 schema
tests/unit/      单元测试（77 例）
scripts/         构建、开发、自检、打包、核验、图标/许可脚本
resources/       第三方许可与图标 slug 清单
build/           应用图标（原创生成，scripts/make-icon.mjs）
docs/ tasks/ handoff/ evidence/   规格、任务书、交接与证据（不进入软件 ZIP）
```
