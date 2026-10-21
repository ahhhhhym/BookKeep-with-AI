# S07 视觉与交互自测

目标流程：统计入口 → 周/月/年和周期/分类选择 → 同源金额及图点 → 悬停/键盘/点击固定 → 日交易或月分类Top3 → 查看明细/刷新。

Browser插件及browser技能未提供；使用已安装Playwright Electron，真实bookkeep://app/index.html、受限preload/IPC、原生SQLite，隔离合成LOCALAPPDATA。截图由Electron capturePage生成；已实际查看参考图3及本轮截图。窗口1280×900、640×480，200%应用缩放（最窄逻辑320×240）；系统为Windows10，不能当Win11/全DPI/人类读屏验收。

| 参考/规格 | 实现与证据 | 结论 |
|---|---|---|
| 图3蓝白、折线、周月年、总额/日均、排行 | month-F02-day-top3.png/year-September-category-top3.png | 采用桌面导航及蓝白token，不照抄移动截图排版和错误数值 |
| 日总额在上、三笔具体消费在下 | day-top3-detail.png，09-09为921.04及850/55.54/15.50 | F02数值与SQL一致；长名换行、金额独立 |
| 年图月点须前三分类 | month-category-top3-detail.png，09月965.30，维修850/数码55.54/餐饮43.50 | 全月聚合后截断，水果第四仍计总额 |
| 小屏/缩放与提示不遮控件 | viewport-640x480.png、zoom-200-detail.png、ui-workflow布局值 | 图下正常流卡片，14px刻度；状态栏低高限20vh，详情内部可滚 |
| hover/键盘/固定 | ui-workflow.json的22项交互检查 | 可移入阅读；Home/End/左右、Enter/Space、Tab关闭/Esc，滚动不覆盖键盘选择 |
| 同值表、前后/当前、失败与迟到 | 同JSON及脚本 | 完整点表；真实查询门控测试loading、迟到丢弃、DB_BUSY不假显0、重试 |

UI首次发现的刻度缩小、低高状态栏及鼠标覆盖键盘问题，登记BK-S07-001～003并修复，失败JSON/日志保留。CSP meta frame-ancestors继承提示单独登记BK-S07-004交S15，pageerror/其他console error为0，不称控制台完全无消息。

实际上海今天2026-10-21，当前年分母294、F02日均3.28；FIXTURES固定T0=2026-10-20对应293/3.29，由注入业务时钟单元集成测试验证。不是改规则或套用过期“今天”。
