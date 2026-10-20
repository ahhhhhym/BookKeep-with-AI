# S03 文档自查与实际检查记录

日期：2026-10-20｜检查者：Codex（作者自查；S03待DSH接收，不是软件验收）

## 1. 环境与实物接收

首条工具显式使用C:\Users\Administrator\AppData\Local\Microsoft\WindowsApps\pwsh.exe，先检查`$PSVersionTable.PSVersion.Major -lt 7 -or $PSVersionTable.PSEdition -ne 'Core'`则throw，实际7.6.5/Core，退出0。后续命令均同一路径，文本UTF-8，无powershell.exe回退。

rg --files盘点、Get-Content分段读取全部任务所需材料（过长输出截断部分分段补读），view_image实际逐张查看references图1～图5。图4/5工具仅显示缩放至2048像素高，原文件未修改。重点业务/统计/审核语义已与S02交叉检查。内存注册表定向搜索BookKeep/S03/965.30无相关命中，未引用旧项目事实。

前置检查一次性PowerShell表达式：逐行`-split '  ',2`分出SHA256/path，`Get-FileHash -LiteralPath $target -Algorithm SHA256`与原值比较，失配throw。实际S01 OUTPUTS 8/8、S02 OUTPUTS 10/10及S01原INPUTS 9/9匹配，退出0。S01看板替代evidence/S02/执行看板.before.md；原输入看板替代evidence/S01/执行看板.before.md。随后保存本步两份before和22项INPUTS，检查.git不存在，未初始化仓库。接收结论另见RECEIPT.md。

## 2. 算术与日期检查（仅文档数值核对）

先逐行手算FIXTURES的整数分，再以一次性表达式`[Math]::Round(([decimal]$numerator/[decimal]$days),2,[MidpointRounding]::AwayFromZero)`复核显示；不落地测试程序。实际命令退出0，输出：

| 数据 | 实际核对值 |
|---|---|
| F01 | 480+1500+1350=3330分，编辑3350，删1830，恢复3350 |
| F02 | 4426+92104=96530；餐饮4350；965.30÷30=32.18，÷293=3.29 |
| F02占比 | 85000/96530=88.06%、5554=5.75%、4350=4.51%、1626=1.68% |
| F03-A | 99330分、9月8日5226分、餐饮7150分；993.30÷30=33.11 |
| F03-B | 114530分（12000+97530+5000）；9月975.30÷30=32.51；年÷293=3.91；三周130/7=18.57、965.30/7=137.90、50/7=7.14 |
| F03-S/C | 5000分÷30日→1.67元；6000分÷30日→2.00元；两个全序人工逐键比较，类别ID打破并列 |
| F03-L | 2024年100.00÷366=0.27；2025年50.00÷365=0.14；周60/7=8.57、90/7=12.86 |
| F03-F | 列表10000分/当前统计3000分；月÷20=1.50，周÷2=15.00，年÷293=0.10 |
| F04/F05 | eligible 1800+1626=3426分，四候选合计5226不当入账；扣850元为115.30；加1元当前966.30、恢复965.30 |

日期实际用`([datetime]$d).DayOfWeek`及DayOfYear核对：2026-09-08星期二、09-09星期三、09-27星期日、10-20星期二/年内293日、10-19星期一、2024-02-29星期四、2026-08-31星期一。闰年/跨年星期及分母还在最终检查重核。没有更改用户系统时钟。

## 3. 来源/图标核对与已修正事项

web.open实际读取https://lucide.dev/license及上游raw LICENSE，确认ISC及列出的Feather衍生MIT需保留原文。只引用许可名称/要求及来源，不复制资源；许可版本/生产SVG/依赖安装留DSH S04。

用Invoke-RestMethod读取GitHub官方仓库recursive tree元数据，再从ICON-MAP匹配`lucide:([a-z][a-z-]+)`去重，并检查`icons/$name.svg`路径存在。第一次实际退出1：Missing icon book-marked。随即读取相关上游路径，发现当前为book-bookmark；在种子尚未实现时改正文档，再以固定commit `02eb9161b57917ccaa262f1bf070507cddde3b08`重新核对，实际退出0、35/35 mapped slugs PASS；未复制SVG/写组件。此错误及修正不隐瞒，也不构成应用运行验证。

同次逐行解析分类表`^\| \d+ \| cat_`并比较唯一ID，34条/34唯一PASS；严格UTF8解码6项正文PASS。完整最终检查另列下节。

## 4. 人工规格交叉审阅

- P01～P09各自有正常、加载、空状态和适用异常/取消/本地恢复；状态矩阵逐页可定位，不为本地页凭空添加网络请求/超时。现有CONTRACTS操作逐动作绑定，无新增schema/代码。
- 蓝白/细线/日期/折线来源五图，V01～V05裁定保持。图示错金额/错类不作为真值；日总在Top3上方，年点为分类聚合。
- 统计两套全序分别给固定ID/createdAt；前三笔不代替全部总额，少于三项不造行。T0上海293天，已到来空点与未来0语义分开，未来交易可列表/CSV但不挤进截至今天统计。
- 图片先本地处理/不透明遮盖/去元数据，prepared坐标不误画在原图；原图未保留明示限制；图版本/授权hash绑定；指令文本无执行权。
- 缺四字段/非支出/证据问题/未处理重复不能批准；四字段逐笔确认、版次变化重核对；batch精确条数/总额/排除清单/60秒/全原子；重复批准/软删关联不造第二笔。
- 小屏不强制不可见窗口；640×480/系统与应用缩放矩阵，窄屏仍可并排/横滚与可选切页；鼠标键盘/IME/焦点/模态与提示翻转/下置卡有规则。未实际运行UI，不声称像素/无障碍合格。
- key提交即清空/无回读，session及恢复epoch限制准确；CSV/完整备份/数据集导出用途和同意分开，质量规范S12未完成不编造准确率或训练。
- 原S01/S02文档保留，仅修改决策和看板且有before；当前待验收不自批，不自动发DSH/其他聊天；H01～H04与门禁边界保持。

未发现阻断S04接收的文字冲突；当前无实现可报实际P0/P1清零。所有AC01～AC22软件状态逐条见HANDOFF，均未执行。

## 5. 最终实物检查

检查只覆盖文档/算术/文件，不是运行软件。最终OUTPUTS包含12项实物（不列清单自身），哈希在所有文档定稿后生成并逐项再比对；旧资料ZIP/根旧清单未更新。

实际最终检查命令为一次性PowerShell表达式，未写脚本文件：UTF8Encoding(false,true)逐文件解码；正则提取Markdown本地链接再Test-Path；Get-FileHash比对三个清单；按`^\| AC\d{2} \|`和`^\| S\d{2} \|`计行；18组整数分加减期望比较、18组decimal日均半入舍入比较；DayOfWeek/DayOfYear比较。敏感模式仅扫描疑似key、Authorization Bearer完整值及data image base64正文，不打印匹配内容。

首次链接检查退出1：把evidence/S03/DECISIONS.before.md里的相对PRD.md按快照目录解析，报Broken link。该文件是原决策的逐字节快照，原链接基准应是docs/，未修改快照；修正检查基准后重跑，退出0，实际输出：

- UTF8/local links/sensitive-pattern: 12 PASS (snapshot links use original base)。
- S01 manifest MATCH 8；S02 manifest MATCH 10（决策/看板以S03 before替代）；S03 INPUTS MATCH 22。
- AC01-AC22 software unexecuted: 22 rows；Board: 20 steps PASS。
- Integer-fen calculations: 18 PASS；Average display calculations: 18 PASS。
- Calendar/leap/cross-year weekday PASS。

另一次已核实的上游图标35/35、分类34唯一、UTF8 6项PASS见§3。人工核对9页状态矩阵/键盘/提示框和全部数值分支，文档没有未写完的TODO/TBD占位。最终再确认每条AC软件状态为未执行、看板S01/S02通过文档/S03待验收/S04～20未开始，生成并逐一核验12项OUTPUTS哈希；结果仅代表对应最终文字/文件，不扩大为软件通过。

## 6. 未执行

无业务/界面/SQL/schema/脚本/自动化实现，无现有软件测试可运行；未发图片API/上传/付费/读取真实key，未配置密钥/训练/做真实质量评测；未测DB/幂等故障/恢复/桌面小屏/键盘/系统缩放/Win10或Win11/原生ABI/构建/软件ZIP。S03只有规格与来源核验，G1～G6全未执行/未通过。DSH接收S03后负责S04及后续编码，Codex只在有真实产物后独立验收。
