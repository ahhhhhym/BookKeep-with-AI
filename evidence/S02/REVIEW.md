# S02 文档自查与实际检查记录

日期：2026-10-20｜检查者：Codex（本次作者自查，待S03接收，不是独立软件验收）

## 1. 环境、输入和证据

工作目录D:\BookKeep with AI。每条PowerShell显式指定C:\Users\Administrator\AppData\Local\Microsoft\WindowsApps\pwsh.exe；首条执行`$v = $PSVersionTable.PSVersion; $e = $PSVersionTable.PSEdition; Write-Output "PowerShell=$v Edition=$e"; if ($v.Major -lt 7 -or $e -ne 'Core') { throw 'PowerShell 7 Core required' }`，退出0，实际输出PowerShell=7.6.5 Edition=Core。没有回退powershell.exe。全部文本UTF-8。

开始只读盘点及输入核对：rg --files确认无S02任务/产物及无软件代码；Get-Content -Raw -Encoding utf8读取AGENTS、看板、开发方案、交接规范、PRD、S01 HANDOFF，分段补读完整原方案/PRD/ACCEPTANCE及S01任务/REVIEW/INPUTS/OUTPUTS。S01接收记录单列S01-RECEIPT.md。S02输入指纹INPUTS.sha256；唯一被修改的旧文件是看板，原文保留执行看板.before.md。没有改写S01历史规格或输出清单。

Git检查：`git status --short --branch`本次工具返回exit_code=1，实际文本fatal: not a git repository；无分支/commit/未提交语义，不初始化Git。未启动DSH/后台构建或测试/其他写入Agent。本次无schema、SQL、源代码、依赖、测试/脚本文件，无软件ZIP。

## 2. 实际检查命令/摘录与结果

仅使用一次性命令核对文档和文件，不落地检查程序。下列代码标记是已执行核对表达式的记录，不是交付自动化脚本。

| 实际命令或准确表达式摘录 | 退出码/实际结果 |
|---|---|
| `Get-Content -Encoding utf8 'evidence/S01/OUTPUTS.sha256'`逐行按两个空格分出hash/path，再`Get-FileHash -Algorithm SHA256 -LiteralPath $parts[1]`比较 | 哈希循环退出0，8/8 MATCH；同次后接git检查导致该工具整条exit_code=1，原因仅无Git，不隐瞒 |
| REQ行匹配`'^\| REQ-\d{3} \|'`，AC行匹配`'^\| AC\d{2} '`；按竖线分列，分别匹配`AC\d{2}`和`REQ-\d{3}`双向检查 | 0，30REQ/22AC双向一致；所有AC状态未执行 |
| `Get-Content -Encoding utf8 'evidence/S01/INPUTS.sha256'`逐项Get-FileHash；原执行看板路径换为evidence/S01/执行看板.before.md | 0，9/9原输入匹配，AGENTS/方案/规范/五图未漂移 |
| 开发方案“必须定义请求”行匹配`[a-z]+\.[A-Za-z]+(?:/[A-Za-z]+)*`，按斜线展开同一前缀，在CONTRACTS逐项找精确表格操作名 | 0，Original IPC coverage: 34/34 |
| 逐项找`trainingAdapter.prepare/validate/submit/status/evaluate` | 0，Training adapter: 5/5；另有recognitionProvider.capabilities/recognize |
| `Get-Item 'docs/ARCHITECTURE.md','docs/CONTRACTS.md','docs/DECISIONS.md','tasks/S02.md'`及`rg -n`定位unknown/amountBasis/mutationId/completed等关键规则 | 0，4项存在，实际内容可读；后续已修正如下自洽性项，最终文件以OUTPUTS哈希为准 |

## 3. 人工交叉审阅（文档推演，不是运行测试）

| 风险/推演输入 | 自查结论及落点 |
|---|---|
| 最大单笔及合计超过JS精确整数范围 | 单笔999999999分；合计64位检查并字符串传输，显示两位与输入拒绝超精度分开；ARCH§2/6 |
| 同日同额有已知/未知时刻、时间相同 | 列表和日Top3各自全序；月类按汇总/ID；不拿创建/导入时间伪造发生时刻；ARCH§6 |
| 今天仍在周期中、未来手工日期、名称搜索跨页 | 统计effectiveEnd到今日含今日；未来点零值+future无详情；列表可查未来、过滤小计为全筛选集，CSV范围明确；ARCH§6/7 |
| approve事务中途失败、commit成功响应丢失、并发双击、软删后再次approve | 唯一sourceCandidateId包括软删，事务含候选/交易/审计/收据；重发返回原关联，批量全成功/全回滚；ARCH§5/CONTRACTS§5 |
| 取消/超时先提交、迟到响应、完成先提交、重启processing | status+generation+requestId栅栏；完成/取消事务先后明确；重启INTERRUPTED且不自动收费续发；ARCH§4/CONTRACTS§4/8 |
| 实付合计与商品行、多笔一图、商户无商品、缺年、商品照片 | CONTRACTS§7的6个合成例；未知业务值null；precision unknown仅元状态；总计歧义必须人审且禁止组内合计明细双批 |
| 缺证据/非支出/未处理重复的警告能否随意忽略 | candidate.update细化resolve_warning与逐类解除条件/理由/审计；金额/名称/date/category/expense仍须合法；新字段/组成员变化使旧处理失效 |
| 预处理与原图保留、图片引用后的二次编辑 | job固定prepared hash，编辑生成新asset，引用禁止delete；prepared_only要先成功预处理再删原图；CONTRACTS§4 |
| renderer想读key、任意文件/URL，secret错误后留在表单 | 白名单顶层窗口/epoch/载荷校验，token与受限resource协议；保存key不回读，提交清空，系统加密不可用session；S09独立最小入口；ARCH§8/CONTRACTS§1/6 |
| 已锁test标签后改、导出子集冒充完整版本、撤回与在途评测 | DatasetVersion完整不可变sampleSnapshots；子集另manifest/parent范围，当前撤回优先旧grant并取消任务；训练submit/status UNSUPPORTED；ARCH§3/4、CONTRACTS§6/7 |
| 恢复中断、DB WAL、附件失配、schema过新、旧token重放 | 一致快照+逐文件hash，staging/active切换日志，旧generation/pre_restore保留，新epoch拒绝旧请求；不裸拷贝活动db；ARCH§7 |
| 可执行交付/工具运行被误报成软件完成 | 仅Markdown/hash/看板快照，S01接收非软件门；S02待验收；全部AC/G门未执行；任务/看板/HANDOFF一致 |

复算采用合成数字：1800+1626+1000=4426；85000+5554+1550=92104；合计96530分；餐饮1800+1000+1550=4350；日均965.30/30四舍五入32.18。S03扩展夹具不得污染此六笔。

## 4. 官方来源核实与限制

工具web.open实际成功读取DeepSeek更新记录/JSON Output、Electron Security、SQLite Backup；DeepSeek Vision两次超时。链接及采用范围在ARCH§10/CONTRACTS§9。当前model deepseek-flash已核实；没有使用任何真实密钥/请求/图上传，未验证图片+JSON组合。采用图片能力沿用方案来源，S09须复核官方参数及真实图片探针；不编造HTTP参数/接口可用性。

## 5. 最终文件检查输出

本节后附最后一次实际检查结果。检查范围：严格UTF-8/Markdown相对链接、34原IPC/五训练操作/决策编号、输入原版及S01文件保留、金额复算、看板20步状态、当前新增只为文档/哈希记录、敏感模式、全部输出SHA256。模式扫描只能证明给定模式无匹配，结合人工内容检查，不替代未来AC15软件/包安全验收。

2026-10-20实际检查（退出0）：

- UTF8/links/sensitive-pattern check: 10 files PASS。
- Original IPC 34/34; training adapter 5/5 PASS。
- Decisions D01-D29 and V01-V05 PASS。
- S02 inputs 9/9; S01 outputs 8/8 with board-before substitution PASS。
- Board 20 rows: S01 receipt pass; S02 pending; S03-S20 not started; all 22 software AC unexecuted PASS。
- Amount baseline 4426/92104/96530/4350 fen; daily average 32.18 PASS。
- Document/hash-only artifacts PASS。

随后仅收紧两项文字：provider结构安全整数与业务Money范围分层；保存session/remove时清除旧持久blob，避免旧key重现。一次apply_patch上下文定位失败未写入，改为精确段落后成功，无实现/脚本生成。最终哈希在上述文档写完后统一生成并逐项复核，实物绑定OUTPUTS.sha256；最终复核输出附本文末尾。

## 6. 软件执行状态与交接

AC01～AC22全部未执行，G1～G6均未执行/未通过；无数据库/桌面/自动化/mock程序/真实API/构建/干净ZIP/跨系统/真实质量/训练结果。当前无实现可建P0/P1缺陷单；后续H01～H04/VFY01/02见DECISIONS，S03接收本步后才能继续交互规格，DSH全部编码留S04以后。下一负责人只有Codex，无外部消息交接授权。本次作者自查不能自动视为S03接收通过。

最终写入后复核：10项正文/输入/快照严格UTF-8及相对链接有效，敏感模式无匹配，退出0；随后生成OUTPUTS并对10项实物逐一比对SHA256一致。该哈希复核不构成软件测试。

