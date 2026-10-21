# BookKeepAI

中文 Windows 桌面 AI 辅助记账应用，基于 Electron、React、TypeScript 和 SQLite。面向 Windows 10/11 x64，本地单用户，人民币记账，账本时区为 Asia/Shanghai。

已实现手工记账、编辑与软删除恢复、分类筛选、周/月/年统计，以及 DeepSeek 密钥安全配置、图片裁剪遮盖、持久化识别队列和待审草稿。AI 结果不会自动进入正式账本。

当前 S10 已通过本阶段接收，S11 尚未启动。人工审核批准、完整附件备份、CSV 导出等后续功能尚未完成；目前有图片附件时会拒绝使用旧版仅数据库备份。正式发布包尚未生成。

## 怎么运行起来

1. 安装 Node.js 22.12 或更高版本（含 npm），系统使用 Windows 10/11 x64。
2. 克隆仓库并进入项目目录：

```sh
git clone https://github.com/ahhhhhym/BookKeep-with-AI.git
cd BookKeep-with-AI
```

3. 按锁文件安装依赖，先构建，再启动开发窗口：

```sh
npm ci --ignore-scripts
npm rebuild electron esbuild
node node_modules/electron/install.js
npm run build
npm run dev
```

构建和检查：

```sh
npm run typecheck
npm test -- --maxWorkers=2
npm run build
npm run smoke:electron
```

依赖安装先跳过自动脚本，再执行 Electron 和 esbuild 的安装步骤；SQLite 使用依赖自带的 Windows 预编译模块，避免当前 npm 自动触发 C++ 编译。安装需联网，下载 Electron 较慢时请等待完成。

`npm run build` 生成 `dist/`，首次构建会放置应用所需的合成图片探针。开发窗口关闭后，在终端按 Ctrl+C 停止开发服务。自动化测试使用合成数据；上述命令不会主动调用收费识图接口。

## 数据与密钥

账本、附件和本地配置保存在 `%LOCALAPPDATA%\BookKeepAI`。DeepSeek 密钥在应用设置页输入，由 Windows 当前用户绑定加密保存；系统加密不可用时仅在会话内保留。真实识图需要网络及用户确认，手工记账可离线使用。

`.env.example` 仅列出可选开发变量名并留空，默认无需填写。Electron 主进程不会自动加载 `.env`；DeepSeek 密钥通过应用设置页配置，不放入该文件。不要把真实密钥写入源码或提交到 Git。

本仓库仅包含应用源码、构建配置、必要资源、第三方许可及自动化测试。开发文档、参考截图、阶段交接和验收记录保留在本地。`assets/probe/` 中的合成收据是应用图片探针所需资源，不包含真实消费信息。

`assets/app/icon.png` 是原创应用图标，由 `npm run icon:generate` 生成；界面图标通过锁定版本的 Lucide 依赖提供，许可位于 `resources/licenses/`。`node_modules/`、`dist/`、`build/`、本地数据库、日志和备份均不上传。
