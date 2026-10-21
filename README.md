# BookKeepAI

中文 Windows 桌面 AI 辅助记账应用，基于 Electron、React、TypeScript 和 SQLite。面向 Windows 10/11 x64，本地单用户，人民币记账，账本时区为 Asia/Shanghai。

已实现手工记账、编辑与软删除恢复、分类筛选、周/月/年统计，以及 DeepSeek 密钥安全配置、图片裁剪遮盖、持久化识别队列和待审草稿。AI 结果不会自动进入正式账本。

当前 S10 实现已完成自测，尚待本阶段接收。人工审核批准、完整附件备份、CSV 导出等后续功能尚未完成；目前有图片附件时会拒绝使用旧版仅数据库备份。正式发布包尚未生成。

## 本地开发

需要 Windows 10/11 x64、Node.js 22.12 或更高版本及 npm。在项目目录运行：

```sh
npm ci
npm run dev
```

构建和检查：

```sh
npm run typecheck
npm test -- --maxWorkers=2
npm run build
npm run smoke:electron
```

`npm run build` 生成 `dist/`。自动化测试使用合成数据；上述命令不会主动调用收费识图接口。

## 数据与密钥

账本、附件和本地配置保存在 `%LOCALAPPDATA%\BookKeepAI`。DeepSeek 密钥在应用设置页输入，由 Windows 当前用户绑定加密保存；系统加密不可用时仅在会话内保留。真实识图需要网络及用户确认，手工记账可离线使用。

本仓库仅包含应用源码、构建配置、必要资源、第三方许可及自动化测试。开发文档、参考截图、阶段交接和验收记录保留在本地。`assets/probe/` 中的合成收据是应用图片探针所需资源，不包含真实消费信息。
