# BookKeepAI

中文 Windows 桌面 AI 辅助记账应用，基于 Electron、React、TypeScript 和 SQLite。面向 Windows 10/11 x64，本地单用户，人民币记账，账本时区为 Asia/Shanghai。

已实现手工记账、编辑与软删除恢复、分类筛选、周/月/年统计，以及 DeepSeek 密钥安全配置、图片裁剪遮盖、持久化识别队列和待审草稿。AI 结果不会自动进入正式账本。

S11 审核闭环已通过单列接收/G3，数据库为 schema v3。每笔候选必须由用户核对，置信度不免审；高风险项逐笔处理。S12 数据规范已接收；S13 提供独立同意后的样本、人工标签、导出与评测框架，当前为实现自测交付、待单列接收。真实识别质量、S14及G4～G6未通过。完整附件备份、CSV 导出等后续功能尚未完成，目前有图片附件时会拒绝使用旧版仅数据库备份。正式发布包尚未生成。

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

## S13 样本与评测框架

“数据管理”提供显式的许可/脱敏声明、独立数据集同意、样本登记、多笔人工真值与纠错历史、二次人工复核、整组固定划分、JSONL及图片清单导出。未标注是`null`，明确无交易是`[]`；不可见字段为unknown，人类外部补充须标assisted。AI预测从同图已完成任务冻结，与人工标签分开；无预测来源不代表零检出。默认不从账本或候选自动建立数据集。

最小合成闭环（零外部HTTP，不需要密钥）：

```sh
npm run dataset:demo
npx vitest run dataset
```

可指定新的本地目录，例如 `npm run dataset:demo -- ".tmp/S13 合成演示"`。脚本生成6张明确标记的合成图片、人工真值和预定盲对齐，实际执行登记→校验→整组划分→导出→prepare/validate→两次mock评测，并核对可手算分子/分母。输出目录含`demo-result.json`、`report.json`与独立manifest/JSONL/图片；请使用新目录重复演示。合成样本不足50张，只做train/dev探索；不能从这些分数推断真实模型质量。

应用中的mock为空预测基线，真实质量评测使用已安装DeepSeek图片transport；须另行同意所选版本/split的逐图上传并确认费用。推理结束后先按隐藏被评字段值的证据定位导入人工盲对齐，再计分；不得按得分选匹配。提示词在`src/main/services/dataset/prompt.ts`版本化，报告记录源码/prompt/manifest hash、实际模型、分母、场景、失败、真实耗时与用量缺失。输入冻结和指标可复算不保证远端模型每次输出相同。默认每图只发送一次，无自动收费重试。

test锁定后拒绝开发/调优访问和普通导出；最终评测只给聚合结果与盲定位，接触test误差调优必须登记污染退役。版本中的同图、同交易/订单及人类声明近似关系通过连通分组隔离；同店同额真实第二笔仍保留独立交易标签。新增跨split近似关系会失效旧版本，不静默移动test。

test接触记录独立保存在匿名`test-contacts.json`中，旧state回拷、新样本ID或同源裁剪图不会清除污染；旧格式已丢失来源快照时，保守退役其锁定test范围。恢复后的旧授权不能读取标签/预测或继续展示有效报告，需重新授权。取消已发送的评测请求会保留发送计数、耗时和已知用量，迟到预测仍丢弃；尚未发送的图片保持0次。

数据集独立存储为 `%LOCALAPPDATA%\BookKeepAI\datasets\<ledgerId>`，不进入Git或应用ZIP，也不属于现有账本备份。不要手工回拷该目录恢复授权；账本恢复后的新epoch需要新同意和显式重新绑定样本版本。撤回先持久化独立匿名墓碑，再清理图片、标签、历史版本、训练准备和报告；保留正式账本合法审计引用，外部已导出副本状态为未知，由人类处理。过期样本在下一次访问/启动时立即阻断并执行清理；关闭应用期间不会声称完成删除。

未来训练适配器支持本地授权格式`prepare/validate`，产物包含实际图片及`training.jsonl`。`submit/status`固定返回`UNSUPPORTED`、`reason=unsupported`、不可重试；没有远端任务、训练进度、权重或费用。UI与报告均明确：**框架运行不等于模型已训练**。人工审核活动计时/修改成本、实际账单费用尚未采集，报告为N/A；外部真实训练不在本步范围。

本仓库仅包含应用源码、构建配置、必要资源、第三方许可及自动化测试。开发文档、参考截图、阶段交接和验收记录保留在本地。`assets/probe/` 中的合成收据是应用图片探针所需资源，不包含真实消费信息。

`assets/app/icon.png` 是原创应用图标，由 `npm run icon:generate` 生成；界面图标通过锁定版本的 Lucide 依赖提供，许可位于 `resources/licenses/`。`node_modules/`、`dist/`、`build/`、本地数据库、日志和备份均不上传。
